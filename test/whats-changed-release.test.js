// The What's changed release gate, end to end, in a throwaway git repo with a stub `npm`
// (no network). It walks one hand release and the automatic releases around it:
//
//   1. The hand bump is on main, unpublished, with "## Unreleased:" in WHATS-CHANGED.md and
//      RELEASES.md. The daily refresh commits law text without a version bump, and CI's
//      check passes; the release gate (check-whats-changed --release) fails.
//   2. Release day: one commit dates both headings. The gate passes, and the append-only
//      check accepts the dating.
//   3. After the publish, the next refresh makes an automatic release with no
//      WHATS-CHANGED.md entry, and the gate passes for it too.
//   4. A broken state (Unreleased entry beside a published version): the refresh commits
//      data but prepares no release and goes red, and CI's check rejects the state.
//
// Uses this repo's own WHATS-CHANGED.md, RELEASES.md and version files as the starting point,
// pinned to 0.5.0, so it does not drift when later releases ship. Needs git and python3
// (scripts/whats_changed.py); skips without python3.

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, copyFileSync, readFileSync, writeFileSync, rmSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const hasPython = spawnSync("python3", ["--version"]).status === 0;
const skip = process.platform === "win32" ? "POSIX shell stubs" : !hasPython ? "python3 not on PATH" : false;
const V = "0.5.0";
// A fixed day in the past: check rejects a future date, and later entries are cut off below.
const RELEASE_DAY = "2026-11-12";

let dir, work, bin;

function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, {
    cwd: work,
    encoding: "utf8",
    env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, STUB_DIR: dir, GITHUB_OUTPUT: join(dir, "github_output") },
  });
  if (opts.check !== false && r.status !== 0) {
    throw new Error(`${cmd} ${args.join(" ")} exited ${r.status}\n${r.stdout}\n${r.stderr}`);
  }
  return r;
}
const git = (...a) => run("git", a).stdout.trim();
const auto = (args, opts) => run(process.execPath, [join(work, "scripts/auto-release.js"), ...args], opts);
const read = (f) => readFileSync(join(work, f), "utf8");
const write = (f, text) => writeFileSync(join(work, f), text);
const version = () => JSON.parse(read("package.json")).version;
const published = (list) => writeFileSync(join(dir, "published.json"), JSON.stringify(list));
const newLaw = (through) => {
  const v = JSON.parse(read("data/index/json/versions.json"));
  v.rules.currentThrough = `Current through rules effective ${through}.`;
  write("data/index/json/versions.json", JSON.stringify(v, null, 2) + "\n");
};

before(() => {
  if (skip) return;
  dir = mkdtempSync(join(tmpdir(), "whats-changed-release-"));
  work = join(dir, "work");
  bin = join(dir, "bin");
  mkdirSync(bin);
  mkdirSync(join(work, "scripts"), { recursive: true });
  mkdirSync(join(work, "data/index/json"), { recursive: true });
  // npm stub: `npm view <pkg> versions --json` -> $STUB_DIR/published.json
  writeFileSync(join(bin, "npm"), '#!/bin/sh\n[ "$1" = view ] && exec cat "$STUB_DIR/published.json"\necho "unexpected npm $*" >&2; exit 3\n');
  chmodSync(join(bin, "npm"), 0o755);
  for (const f of ["package.json", "package-lock.json", "server.json", "RELEASES.md", "WHATS-CHANGED.md", "scripts/auto-release.js", "scripts/whats_changed.py", "data/index/json/versions.json"]) {
    copyFileSync(join(ROOT, f), join(work, f));
  }
  // Pin the starting point: the hand release 0.5.0, waiting for its tag. Once 0.5.0 has
  // shipped, the real files are dated, so put the Unreleased headings back.
  const pin = (f, re, to) => write(f, read(f).replace(re, to));
  pin("package.json", /"version": "[^"]+"/, `"version": "${V}"`);
  const lock = JSON.parse(read("package-lock.json"));
  lock.version = V;
  lock.packages[""].version = V;
  write("package-lock.json", JSON.stringify(lock, null, 2) + "\n");
  const server = JSON.parse(read("server.json"));
  server.version = V;
  for (const p of server.packages) p.version = V;
  write("server.json", JSON.stringify(server, null, 2) + "\n");
  const rel = read("RELEASES.md");
  const first = rel.search(/^## v\d/m);
  const mine = rel.indexOf(`## v${V} `);
  write("RELEASES.md", rel.slice(0, first) + rel.slice(mine).replace(/^## v0\.5\.0 — .*$/m, `## v${V} — Unreleased`));
  // Keep the intro and the 0.5.0 entry onward; drop entries added after it.
  const full = read("WHATS-CHANGED.md");
  const title = /^## (?:Unreleased|\d{4}-\d{2}-\d{2}): Two tools that explain the server and list what changed$/m;
  const at = full.search(title);
  assert.ok(at > 0, "WHATS-CHANGED.md carries the 0.5.0 entry");
  const wc = full.slice(0, full.indexOf("\n## ") + 1) + full.slice(at);
  write(
    "WHATS-CHANGED.md",
    wc
      .replace(title, "## Unreleased: Two tools that explain the server and list what changed")
      .replace(/\[nyc-charter-laws-rules 0\.5\.0\]\(RELEASES\.md[^)]*\)/, "[nyc-charter-laws-rules 0.5.0](RELEASES.md)"),
  );
  published(["0.4.4", "0.4.5"]);

  // prepare asks origin whether the next tag exists (git ls-remote), so give it one.
  spawnSync("git", ["init", "-q", "--bare", join(dir, "origin.git")]);
  git("init", "-q", "-b", "main");
  git("remote", "add", "origin", join(dir, "origin.git"));
  git("config", "user.email", "t@example.com");
  git("config", "user.name", "t");
  git("add", "-A");
  git("commit", "-q", "-m", "hand bump 0.5.0");
});

after(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
});

test("1. hand bump waiting: the refresh commits data without a bump; CI passes; the gate fails", { skip }, () => {
  newLaw("November 12, 2026");
  writeFileSync(join(dir, "github_output"), "");
  const p = auto(["prepare", "--soft", "--date", "2026-11-12"]);
  assert.equal(p.stdout, "", "no new version");
  assert.match(p.stderr, /v0\.5\.0 is not on npm yet/);
  assert.equal(readFileSync(join(dir, "github_output"), "utf8"), "", "not a failure: the run stays green");
  assert.equal(version(), V);
  git("commit", "-q", "-am", "chore: refresh index 2026-11-12");

  const ci = auto(["check-whats-changed", "--base-ref", "HEAD~1"], { check: false });
  assert.equal(ci.status, 0, ci.stderr);
  const gate = auto(["check-whats-changed", "--release"], { check: false });
  assert.equal(gate.status, 1);
  assert.match(gate.stderr, /WHATS-CHANGED\.md still has "## Unreleased: Two tools/);
  assert.match(gate.stderr, /RELEASES\.md still says "## v0\.5\.0 — Unreleased"/);
  assert.match(gate.stdout + gate.stderr, /unreleased-entry/, "whats_changed.py's own release gate fails too");
});

test("2. release day: one commit dates both headings; the gate and the append-only check pass", { skip }, () => {
  // The commit also adds the dated anchor to the entry's MCP version link. whats_changed.py
  // treats an Unreleased entry as unpublished until it is dated, so no trailer is needed.
  const before = git("rev-parse", "HEAD");
  write(
    "WHATS-CHANGED.md",
    read("WHATS-CHANGED.md")
      .replace("## Unreleased: Two tools", `## ${RELEASE_DAY}: Two tools`)
      .replace("[nyc-charter-laws-rules 0.5.0](RELEASES.md)", `[nyc-charter-laws-rules 0.5.0](RELEASES.md#v050--${RELEASE_DAY})`),
  );
  write("RELEASES.md", read("RELEASES.md").replace(`## v${V} — Unreleased`, `## v${V} — ${RELEASE_DAY}`));
  git("commit", "-q", "-am", `chore: release v${V}`);
  const gate = auto(["check-whats-changed", "--release"], { check: false });
  assert.equal(gate.status, 0, gate.stdout + gate.stderr);
  const ci = auto(["check-whats-changed", "--base-ref", before], { check: false });
  assert.equal(ci.status, 0, ci.stdout + ci.stderr);
});

test("3. after the publish: an automatic data release, with no entry, passes the gate", { skip }, () => {
  published(["0.4.5", V]);
  newLaw("November 14, 2026");
  writeFileSync(join(dir, "github_output"), "");
  const p = auto(["prepare", "--soft", "--date", "2026-11-14"]);
  assert.equal(p.stdout.trim(), "0.5.1");
  assert.match(read("RELEASES.md"), /## v0\.5\.1 — 2026-11-14\n\n- Automatic data release\./);
  assert.doesNotMatch(read("WHATS-CHANGED.md"), /0\.5\.1/, "daily releases stay out of WHATS-CHANGED.md");
  git("commit", "-q", "-am", "chore: refresh index 2026-11-14 (release v0.5.1)");

  const gate = auto(["check-whats-changed", "--release"], { check: false });
  assert.equal(gate.status, 0, gate.stdout + gate.stderr);
});

test("4. an Unreleased entry beside a published version: no automatic release, a red run, and CI rejects it", { skip }, () => {
  published(["0.4.5", V, "0.5.1"]);
  const base = git("rev-parse", "HEAD");
  const wc = read("WHATS-CHANGED.md");
  const at = wc.indexOf("\n## ");
  write(
    "WHATS-CHANGED.md",
    wc.slice(0, at) +
      "\n## Unreleased: A change merged without a version bump\n\n- **Tags:** MCP\n- **What changed:** Something.\n- **MCP version:** [nyc-charter-laws-rules 0.5.1](RELEASES.md)\n" +
      wc.slice(at),
  );
  git("commit", "-q", "-am", "an entry without a bump");

  const ci = auto(["check-whats-changed", "--base-ref", base], { check: false });
  assert.equal(ci.status, 1);
  assert.match(ci.stderr, /v0\.5\.1 is an automatic data release in RELEASES\.md/);

  newLaw("November 16, 2026");
  writeFileSync(join(dir, "github_output"), "");
  const files = ["package.json", "package-lock.json", "server.json", "RELEASES.md"].map(read);
  const p = auto(["prepare", "--soft", "--date", "2026-11-16"]);
  assert.equal(p.status, 0, "data is still committed");
  assert.equal(p.stdout, "", "no new version");
  assert.match(readFileSync(join(dir, "github_output"), "utf8"), /^prepare_failed=true$/m, "the refresh goes red");
  assert.match(readFileSync(join(dir, "github_output"), "utf8"), /prepare_error=WHATS-CHANGED\.md has an "Unreleased:" entry/);
  assert.deepEqual(["package.json", "package-lock.json", "server.json", "RELEASES.md"].map(read), files);
});
