// End-to-end test of `scripts/auto-release.js prepare` and `ensure` in a
// throwaway git repo with a local bare "origin" and stub `npm` / `gh`
// executables on PATH. No network, no real registry, no real GitHub.
//
// Covers the refresh-day sequence (prepare -> commit -> ensure), plus the
// rerun cases: ensure again while the release is queued (no double dispatch,
// no re-tag), and prepare again (no double bump).

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, copyFileSync, readFileSync, writeFileSync, rmSync, chmodSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const skip = process.platform === "win32" ? "POSIX shell stubs" : false;

let dir, work, origin, bin, ghLog;

function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, {
    cwd: work,
    encoding: "utf8",
    env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, GH_LOG: ghLog, STUB_DIR: dir, ...opts.env },
  });
  if (opts.check !== false && r.status !== 0) {
    throw new Error(`${cmd} ${args.join(" ")} exited ${r.status}\n${r.stdout}\n${r.stderr}`);
  }
  return r;
}
const git = (...a) => run("git", a).stdout.trim();
const auto = (args, opts) => run(process.execPath, ["scripts/auto-release.js", ...args], opts);

before(() => {
  if (skip) return;
  dir = mkdtempSync(join(tmpdir(), "auto-release-"));
  work = join(dir, "work");
  origin = join(dir, "origin.git");
  bin = join(dir, "bin");
  ghLog = join(dir, "gh.log");
  mkdirSync(bin);
  mkdirSync(join(work, "scripts"), { recursive: true });
  mkdirSync(join(work, "data/index/json"), { recursive: true });

  // npm stub: `npm view <pkg> versions --json` -> contents of $STUB_DIR/published.json
  writeFileSync(join(bin, "npm"), '#!/bin/sh\n[ "$1" = view ] && exec cat "$STUB_DIR/published.json"\necho "unexpected npm $*" >&2; exit 3\n');
  // gh stub: log every call; `run list` -> $STUB_DIR/runs.json
  writeFileSync(join(bin, "gh"), '#!/bin/sh\necho "$*" >> "$GH_LOG"\n[ "$1 $2" = "run list" ] && exec cat "$STUB_DIR/runs.json"\nexit 0\n');
  chmodSync(join(bin, "npm"), 0o755);
  chmodSync(join(bin, "gh"), 0o755);
  writeFileSync(join(dir, "published.json"), '["0.2.0","0.3.0"]');
  writeFileSync(join(dir, "runs.json"), "[]");

  for (const f of ["package.json", "package-lock.json", "RELEASES.md", "scripts/auto-release.js", "data/index/json/versions.json"]) {
    copyFileSync(join(ROOT, f), join(work, f));
  }
  // Pin the fixture to 0.3.0 regardless of what the real package.json says.
  const pkg = readFileSync(join(work, "package.json"), "utf8").replace(/"version": "[^"]+"/, '"version": "0.3.0"');
  writeFileSync(join(work, "package.json"), pkg);
  const lock = JSON.parse(readFileSync(join(work, "package-lock.json"), "utf8"));
  lock.version = "0.3.0";
  lock.packages[""].version = "0.3.0";
  writeFileSync(join(work, "package-lock.json"), JSON.stringify(lock, null, 2) + "\n");

  spawnSync("git", ["init", "-q", "--bare", origin]);
  git("init", "-q", "-b", "main");
  git("config", "user.email", "t@example.com");
  git("config", "user.name", "t");
  git("remote", "add", "origin", origin);
  git("add", "-A");
  git("commit", "-q", "-m", "base");
  git("push", "-q", "origin", "main");
});

after(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
});

test("refresh day: prepare bumps, ensure tags and dispatches once", { skip }, () => {
  const vPath = join(work, "data/index/json/versions.json");
  const v = JSON.parse(readFileSync(vPath, "utf8"));
  v.rules.currentThrough = "Current through rules effective October 18, 2026.";
  writeFileSync(vPath, JSON.stringify(v, null, 2) + "\n");

  const p = auto(["prepare", "--date", "2026-10-13"]);
  assert.equal(p.stdout.trim(), "0.3.1");
  assert.equal(JSON.parse(readFileSync(join(work, "package.json"), "utf8")).version, "0.3.1");
  const lock = JSON.parse(readFileSync(join(work, "package-lock.json"), "utf8"));
  assert.equal(lock.packages[""].version, "0.3.1");
  const rel = readFileSync(join(work, "RELEASES.md"), "utf8");
  assert.match(rel, /## v0\.3\.1 — 2026-10-13\n\n- Automatic data release\. Bundled law text refreshed: Rules eff\. October 4, 2026 -> eff\. October 18, 2026\./);

  git("commit", "-qam", "chore: refresh index (release v0.3.1)");
  git("push", "-q", "origin", "main");

  auto(["ensure"]);
  const head = git("rev-parse", "HEAD");
  assert.equal(spawnSync("git", ["--git-dir", origin, "rev-parse", "refs/tags/v0.3.1"], { encoding: "utf8" }).stdout.trim(), head);
  const calls = readFileSync(ghLog, "utf8").trim().split("\n");
  assert.deepEqual(calls.filter((c) => c.startsWith("workflow run")), ["workflow run release.yml --ref v0.3.1"]);
});

test("rerun while the release is queued: no re-tag, no second dispatch", { skip }, () => {
  writeFileSync(join(dir, "runs.json"), JSON.stringify([{ databaseId: 9, headBranch: "v0.3.1", status: "queued", conclusion: "" }]));
  writeFileSync(ghLog, "");
  auto(["ensure"]);
  assert.ok(!readFileSync(ghLog, "utf8").includes("workflow run"));
});

test("release run failed: ensure exits non-zero and names the run", { skip }, () => {
  writeFileSync(join(dir, "runs.json"), JSON.stringify([{ databaseId: 9, headBranch: "v0.3.1", status: "completed", conclusion: "failure" }]));
  const r = auto(["ensure"], { check: false });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /::error::.*gh run rerun 9/);
});

test("next refresh while v0.3.1 is still unpublished: prepare does not bump", { skip }, () => {
  const before = readFileSync(join(work, "package.json"), "utf8");
  const r = auto(["prepare", "--date", "2026-10-14"]);
  assert.equal(r.stdout.trim(), "");
  assert.match(r.stderr, /::warning::/);
  assert.equal(readFileSync(join(work, "package.json"), "utf8"), before);
});

test("once published: ensure is a no-op and does not call gh", { skip }, () => {
  writeFileSync(join(dir, "published.json"), '["0.2.0","0.3.0","0.3.1"]');
  writeFileSync(ghLog, "");
  auto(["ensure"]);
  assert.equal(readFileSync(ghLog, "utf8"), "");
});

test("registry unreadable: prepare fails rather than guessing", { skip }, () => {
  writeFileSync(join(dir, "published.json"), "not json");
  const r = auto(["prepare", "--date", "2026-10-15"], { check: false });
  assert.equal(r.status, 1);
  assert.ok(existsSync(join(work, "package.json")));
});
