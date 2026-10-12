// End-to-end test of `scripts/auto-release.js prepare` and `ensure` in a
// throwaway git repo with a local bare "origin" and stub `npm` / `gh`
// executables on PATH. No network, no real registry, no real GitHub.
//
// Covers the refresh-day sequence (prepare -> commit -> ensure), plus the
// rerun cases: ensure again while the release is queued (no double dispatch,
// no re-tag), prepare again (no double bump), a tag pushed on a later run
// landing on the bump commit, and `prepare --soft` never blocking the data
// commit.

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, copyFileSync, readFileSync, writeFileSync, rmSync, chmodSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const skip = process.platform === "win32" ? "POSIX shell stubs" : false;

let dir, work, origin, bin, ghLog, bumpSha;

function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, {
    cwd: opts.cwd ?? work,
    encoding: "utf8",
    env: {
      ...process.env,
      PATH: `${bin}:${process.env.PATH}`,
      GH_LOG: ghLog,
      STUB_DIR: dir,
      GITHUB_REPOSITORY: "BetaNYC/nyc-charter-laws-rules",
      GITHUB_OUTPUT: join(dir, "github_output"),
      ORIGIN: origin,
      ...opts.env,
    },
  });
  if (opts.check !== false && r.status !== 0) {
    throw new Error(`${cmd} ${args.join(" ")} exited ${r.status}\n${r.stdout}\n${r.stderr}`);
  }
  return r;
}
const git = (...a) => run("git", a).stdout.trim();
const auto = (args, opts = {}) => run(process.execPath, [join(opts.cwd ?? work, "scripts/auto-release.js"), ...args], opts);

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
  // gh stub: log every call. `run list` -> runs.json. `api --method POST
  // .../git/refs -f ref=R -f sha=S` creates R in the bare origin, as GitHub
  // would server-side (it has every object, unlike a depth-1 checkout). Other
  // `api` calls -> commits.json, or exit 1 if $STUB_DIR/commits.fail exists.
  writeFileSync(
    join(bin, "gh"),
    [
      "#!/bin/sh",
      'echo "$*" >> "$GH_LOG"',
      '[ "$1 $2" = "run list" ] && exec cat "$STUB_DIR/runs.json"',
      'if [ "$1 $2 $3" = "api --method POST" ]; then',
      '  for a in "$@"; do case "$a" in ref=*) R="${a#ref=}";; sha=*) S="${a#sha=}";; esac; done',
      '  git --git-dir "$ORIGIN" rev-parse -q --verify "$R" >/dev/null && { echo "Reference already exists (HTTP 422)" >&2; exit 1; }',
      '  exec git --git-dir "$ORIGIN" update-ref "$R" "$S"',
      "fi",
      'if [ "$1" = api ]; then [ -e "$STUB_DIR/commits.fail" ] && { echo "HTTP 502" >&2; exit 1; }; exec cat "$STUB_DIR/commits.json"; fi',
      "exit 0",
      "",
    ].join("\n"),
  );
  chmodSync(join(bin, "npm"), 0o755);
  chmodSync(join(bin, "gh"), 0o755);
  writeFileSync(join(dir, "published.json"), '["0.2.0","0.3.0"]');
  writeFileSync(join(dir, "runs.json"), "[]");
  writeFileSync(join(dir, "commits.json"), "[]");

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
  const head = git("rev-parse", "HEAD");
  bumpSha = head;
  writeFileSync(join(dir, "commits.json"), JSON.stringify([{ sha: head, commit: { message: "chore: refresh index 2026-10-13 — x (release v0.3.1)" } }]));

  auto(["ensure"]);
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

test("recovery in a depth-1 checkout: tag lands on the bump commit, which is not in the clone", { skip }, () => {
  spawnSync("git", ["--git-dir", origin, "tag", "-d", "v0.3.1"]);
  writeFileSync(join(dir, "runs.json"), "[]");
  writeFileSync(join(work, "data/index/json/extra.json"), "{}\n");
  git("add", "-A");
  git("commit", "-qm", "chore: refresh index 2026-10-14 — data only");
  git("push", "-q", "origin", "main");

  // Same shape as actions/checkout's default (fetch-depth 1).
  const shallow = join(dir, "shallow");
  const c = spawnSync("git", ["clone", "-q", "--depth", "1", "--branch", "main", `file://${origin}`, shallow], { encoding: "utf8" });
  assert.equal(c.status, 0, c.stderr);
  const sHead = spawnSync("git", ["-C", shallow, "rev-parse", "HEAD"], { encoding: "utf8" }).stdout.trim();
  assert.notEqual(sHead, bumpSha);
  assert.notEqual(spawnSync("git", ["-C", shallow, "cat-file", "-e", bumpSha]).status, 0, "bump commit must be absent from the clone");

  writeFileSync(ghLog, "");
  auto(["ensure"], { cwd: shallow });
  assert.equal(spawnSync("git", ["--git-dir", origin, "rev-parse", "refs/tags/v0.3.1"], { encoding: "utf8" }).stdout.trim(), bumpSha);
  const calls = readFileSync(ghLog, "utf8");
  assert.ok(calls.includes(`api --method POST repos/BetaNYC/nyc-charter-laws-rules/git/refs -f ref=refs/tags/v0.3.1 -f sha=${bumpSha}`));
  assert.ok(calls.includes("workflow run release.yml --ref v0.3.1"));
});

test("commit lookup fails: ensure warns and tags HEAD instead of throwing", { skip }, () => {
  spawnSync("git", ["--git-dir", origin, "tag", "-d", "v0.3.1"]);
  writeFileSync(join(dir, "commits.fail"), "");
  try {
    const r = auto(["ensure"]);
    assert.match(r.stderr, /::warning::.*could not list package\.json commits/);
    assert.equal(spawnSync("git", ["--git-dir", origin, "rev-parse", "refs/tags/v0.3.1"], { encoding: "utf8" }).stdout.trim(), git("rev-parse", "HEAD"));
  } finally {
    rmSync(join(dir, "commits.fail"));
  }
});

test("ensure outside GitHub Actions fails fast", { skip }, () => {
  const r = auto(["ensure"], { check: false, env: { GITHUB_REPOSITORY: "" } });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /GITHUB_REPOSITORY/);
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

test("prepare --soft: registry unreadable -> exit 0, no bump, prepare_failed output", { skip }, () => {
  writeFileSync(join(dir, "published.json"), "not json");
  writeFileSync(join(dir, "github_output"), "");
  const before = ["package.json", "package-lock.json", "RELEASES.md"].map((f) => readFileSync(join(work, f), "utf8"));
  const r = auto(["prepare", "--soft"]);
  assert.equal(r.status, 0);
  assert.equal(r.stdout, "");
  assert.match(r.stderr, /::warning::.*release not prepared/);
  assert.match(readFileSync(join(dir, "github_output"), "utf8"), /^prepare_failed=true$/m);
  const after = ["package.json", "package-lock.json", "RELEASES.md"].map((f) => readFileSync(join(work, f), "utf8"));
  assert.deepEqual(after, before);
});

test("prepare --soft: lockfile version mismatch -> package.json not half-bumped", { skip }, () => {
  writeFileSync(join(dir, "published.json"), '["0.2.0","0.3.0","0.3.1"]');
  writeFileSync(join(dir, "github_output"), "");
  const lockPath = join(work, "package-lock.json");
  const lock = JSON.parse(readFileSync(lockPath, "utf8"));
  lock.packages[""].version = "0.0.9";
  writeFileSync(lockPath, JSON.stringify(lock, null, 2) + "\n");
  const pkgBefore = readFileSync(join(work, "package.json"), "utf8");
  const relBefore = readFileSync(join(work, "RELEASES.md"), "utf8");

  const r = auto(["prepare", "--soft"]);
  assert.equal(r.status, 0);
  assert.equal(r.stdout, "");
  assert.match(readFileSync(join(dir, "github_output"), "utf8"), /prepare_failed=true/);
  assert.equal(readFileSync(join(work, "package.json"), "utf8"), pkgBefore);
  assert.equal(readFileSync(join(work, "RELEASES.md"), "utf8"), relBefore);
});
