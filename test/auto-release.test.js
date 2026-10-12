// Unit tests for scripts/auto-release.js — the decision logic behind automatic
// patch releases from the daily refresh (issue #26, option 2). No network: the
// CLI's I/O wrappers are not exercised here, only the pure functions they call.

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import {
  AUTO_MARKER,
  nextPatch,
  parseVersion,
  versionAtLeast,
  shortThrough,
  corpusMoves,
  releaseEntry,
  findReleaseSection,
  isAutoRelease,
  insertReleaseEntry,
  setPackageVersion,
  setLockVersion,
  parsePublishedVersions,
  decideEnsure,
  decidePrepare,
  newYorkDate,
  releaseMarker,
  findBumpCommit,
} from "../scripts/auto-release.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

const RELEASES = `# Releases

## Format

\`\`\`markdown
## vX.Y.Z — YYYY-MM-DD

- Summary.
\`\`\`

---

## v0.3.0 — 2026-10-12

- Manual release.

## v0.2.0 — 2026-07-22

- Older.
`;

describe("versions", () => {
  test("nextPatch bumps only the patch", () => {
    assert.equal(nextPatch("0.3.0"), "0.3.1");
    assert.equal(nextPatch("1.9.9"), "1.9.10");
  });
  test("parseVersion rejects prerelease and junk", () => {
    assert.throws(() => parseVersion("0.3.0-beta.1"));
    assert.throws(() => parseVersion("v0.3.0"));
    assert.throws(() => parseVersion(""));
  });
  test("versionAtLeast compares numerically, not lexically", () => {
    assert.equal(versionAtLeast("11.5.1", "11.5.1"), true);
    assert.equal(versionAtLeast("11.10.0", "11.5.1"), true);
    assert.equal(versionAtLeast("11.5.0", "11.5.1"), false);
    assert.equal(versionAtLeast("10.9.2", "11.5.1"), false);
    assert.equal(versionAtLeast("22.9.0", "22.14.0"), false);
    assert.equal(versionAtLeast("v22.14.0", "22.14.0"), true);
    assert.equal(versionAtLeast("24.0.0-pre", "22.14.0"), true);
  });
});

describe("dates and the bump-commit marker", () => {
  test("newYorkDate uses America/New_York, not UTC", () => {
    assert.equal(newYorkDate(new Date("2026-10-12T02:51:55Z")), "2026-10-11"); // v0.3.0's publish time
    assert.equal(newYorkDate(new Date("2026-10-12T11:00:00Z")), "2026-10-12"); // the refresh cron
    assert.equal(newYorkDate(new Date("2026-01-15T04:59:00Z")), "2026-01-14"); // EST
  });
  test("findBumpCommit matches the marker in the subject, exactly", () => {
    const commits = [
      { sha: "c3", commit: { message: "chore: refresh index — data only" } },
      { sha: "c2", commit: { message: "chore: refresh index 2026-10-13 — x (release v0.3.10)" } },
      { sha: "c1", commit: { message: `chore: refresh index 2026-10-12 — x ${releaseMarker("0.3.1")}\n\nbody` } },
    ];
    assert.equal(findBumpCommit(commits, "0.3.1"), "c1");
    assert.equal(findBumpCommit(commits, "0.3.10"), "c2");
    assert.equal(findBumpCommit(commits, "0.3.2"), null);
    assert.equal(findBumpCommit([], "0.3.1"), null);
  });
});

describe("corpus moves (from versions.json)", () => {
  test("shortThrough shortens the two AML shapes", () => {
    assert.equal(shortThrough("Current through Local Law 2026/147, enacted September 12, 2026,"), "LL 2026/147");
    assert.equal(shortThrough("Current through rules effective October 4, 2026."), "eff. October 4, 2026");
  });
  test("only corpora whose currentThrough changed are listed", () => {
    const prev = JSON.parse(readFileSync(join(ROOT, "data/index/json/versions.json"), "utf8"));
    const cur = structuredClone(prev);
    cur.rules.currentThrough = "Current through rules effective October 18, 2026.";
    cur.charter.indexedAt = "2099-01-01T00:00:00Z"; // indexedAt alone is not a move
    assert.deepEqual(corpusMoves(prev, cur), ["Rules eff. October 4, 2026 -> eff. October 18, 2026"]);
  });
  test("a corpus new to versions.json is listed without an arrow", () => {
    assert.deepEqual(corpusMoves({}, { charter: { currentThrough: "Current through Local Law 2026/1, x" } }), ["Charter LL 2026/1"]);
  });
  test("releaseEntry carries the auto marker and the date", () => {
    const e = releaseEntry("0.3.1", "2026-10-13", ["Charter LL 2026/147 -> LL 2026/150"]);
    assert.match(e, /^## v0\.3\.1 — 2026-10-13\n\n- /);
    assert.ok(e.includes(AUTO_MARKER));
    assert.ok(e.includes("Charter LL 2026/147 -> LL 2026/150"));
    assert.ok(releaseEntry("0.3.1", "2026-10-13", []).includes("no corpus"));
  });
});

describe("RELEASES.md editing", () => {
  test("insertReleaseEntry goes above the newest release, below the Format block", () => {
    const out = insertReleaseEntry(RELEASES, releaseEntry("0.3.1", "2026-10-13", []), "0.3.1");
    const lines = out.split("\n");
    const i31 = lines.indexOf("## v0.3.1 — 2026-10-13");
    const i30 = lines.indexOf("## v0.3.0 — 2026-10-12");
    const fmt = lines.indexOf("## vX.Y.Z — YYYY-MM-DD");
    assert.ok(fmt < i31 && i31 < i30, "order: format example, new entry, previous release");
    assert.equal(lines[i30 - 1], "", "blank line before the previous release");
  });
  test("insertReleaseEntry refuses a duplicate version (no double entry on rerun)", () => {
    const once = insertReleaseEntry(RELEASES, releaseEntry("0.3.1", "2026-10-13", []), "0.3.1");
    assert.throws(() => insertReleaseEntry(once, releaseEntry("0.3.1", "2026-10-14", []), "0.3.1"), /already has/);
  });
  test("findReleaseSection does not confuse 0.3.1 with 0.3.10", () => {
    const md = insertReleaseEntry(RELEASES, releaseEntry("0.3.10", "2026-10-13", []), "0.3.10");
    assert.equal(findReleaseSection(md, "0.3.1"), null);
    assert.ok(findReleaseSection(md, "0.3.10"));
  });
  test("isAutoRelease is true only for marked entries", () => {
    const md = insertReleaseEntry(RELEASES, releaseEntry("0.3.1", "2026-10-13", []), "0.3.1");
    assert.equal(isAutoRelease(md, "0.3.1"), true);
    assert.equal(isAutoRelease(md, "0.3.0"), false);
    assert.equal(isAutoRelease(md, "9.9.9"), false);
  });
  test("the real RELEASES.md accepts an insert", () => {
    const real = readFileSync(join(ROOT, "RELEASES.md"), "utf8");
    const out = insertReleaseEntry(real, releaseEntry("99.0.0", "2026-10-13", []), "99.0.0");
    assert.ok(out.indexOf("## v99.0.0") < out.indexOf("## v0.3.0"));
    assert.ok(out.indexOf("## v99.0.0") > out.indexOf("## vX.Y.Z"));
  });
});

describe("package.json / package-lock.json version rewrite", () => {
  test("only the version changes, formatting preserved (real files)", () => {
    const pkgText = readFileSync(join(ROOT, "package.json"), "utf8");
    const from = JSON.parse(pkgText).version;
    const to = nextPatch(from);
    const out = setPackageVersion(pkgText, from, to);
    assert.equal(JSON.parse(out).version, to);
    assert.equal(out.replace(`"version": "${to}"`, `"version": "${from}"`), pkgText);

    const lockText = readFileSync(join(ROOT, "package-lock.json"), "utf8");
    const lockOut = setLockVersion(lockText, from, to);
    const back = setLockVersion(lockOut, to, from);
    assert.equal(back, lockText, "lock round-trips byte-identically");
    const lock = JSON.parse(lockOut);
    assert.equal(lock.version, to);
    assert.equal(lock.packages[""].version, to);
  });
  test("a stale 'from' version fails instead of writing", () => {
    assert.throws(() => setPackageVersion('{"version": "0.3.0"}', "0.2.0", "0.2.1"));
    assert.throws(() => setLockVersion('{"version":"0.3.0","packages":{"":{"version":"0.3.0"}}}', "0.2.0", "0.2.1"));
  });
  test("npm view versions --json: string for one version, array for many", () => {
    assert.deepEqual(parsePublishedVersions('"0.1.0"'), ["0.1.0"]);
    assert.deepEqual(parsePublishedVersions('["0.1.0","0.2.0"]'), ["0.1.0", "0.2.0"]);
    assert.throws(() => parsePublishedVersions("npm error 404"));
  });
});

describe("decidePrepare", () => {
  const published = ["0.2.0", "0.3.0"];
  test("published current version -> bump patch", () => {
    assert.deepEqual(decidePrepare({ version: "0.3.0", published, nextTagExists: false, releasesMd: RELEASES }), { bump: true, next: "0.3.1" });
  });
  test("unpublished current version (pending manual or in-flight release) -> no bump, warn", () => {
    const d = decidePrepare({ version: "0.4.0", published, nextTagExists: false, releasesMd: RELEASES });
    assert.equal(d.bump, false);
    assert.equal(d.warn, true);
  });
  test("next version already tagged -> fail loudly", () => {
    assert.throws(() => decidePrepare({ version: "0.3.0", published, nextTagExists: true, releasesMd: RELEASES }), /already exists/);
  });
  test("next version already on npm -> fail loudly", () => {
    assert.throws(() => decidePrepare({ version: "0.3.0", published: [...published, "0.3.1"], nextTagExists: false, releasesMd: RELEASES }), /already on npm/);
  });
  test("next version already in RELEASES.md -> fail loudly", () => {
    const md = insertReleaseEntry(RELEASES, releaseEntry("0.3.1", "2026-10-13", []), "0.3.1");
    assert.throws(() => decidePrepare({ version: "0.3.0", published, nextTagExists: false, releasesMd: md }), /RELEASES/);
  });
});

describe("decideEnsure", () => {
  const base = { version: "0.3.1", auto: true, published: false, remoteTagSha: null, runs: [] };
  const run = (status, conclusion, id = 1, headBranch = "v0.3.1") => ({ databaseId: id, headBranch, status, conclusion });

  test("manual release, published -> nothing", () => {
    assert.equal(decideEnsure({ ...base, auto: false, published: true }).action, "none");
  });
  test("manual release, unpublished -> nothing, but warn (never auto-tag a human's release)", () => {
    const d = decideEnsure({ ...base, auto: false });
    assert.equal(d.action, "none");
    assert.equal(d.tag, false);
    assert.equal(d.warn, true);
  });
  test("auto release already on npm -> nothing (the common no-change day)", () => {
    assert.deepEqual(decideEnsure({ ...base, published: true }).action, "none");
  });
  test("fresh auto release: no tag, no runs -> tag + dispatch", () => {
    const d = decideEnsure(base);
    assert.equal(d.action, "dispatch");
    assert.equal(d.tag, true);
  });
  test("rerun after the tag was pushed but dispatch failed -> dispatch without re-tagging", () => {
    const d = decideEnsure({ ...base, remoteTagSha: "abc" });
    assert.equal(d.action, "dispatch");
    assert.equal(d.tag, false);
  });
  test("release already queued or running -> nothing (no double dispatch)", () => {
    for (const s of ["queued", "in_progress", "waiting", "requested", "pending"]) {
      const d = decideEnsure({ ...base, remoteTagSha: "abc", runs: [run(s, null)] });
      assert.equal(d.action, "none", s);
      assert.equal(d.tag, false, s);
    }
  });
  test("release succeeded but registry lags -> nothing", () => {
    assert.equal(decideEnsure({ ...base, remoteTagSha: "abc", runs: [run("completed", "success")] }).action, "none");
  });
  test("every release run failed -> fail loudly, naming the run to rerun", () => {
    const d = decideEnsure({ ...base, remoteTagSha: "abc", runs: [run("completed", "failure", 42), run("completed", "cancelled", 41)] });
    assert.equal(d.action, "fail");
    assert.match(d.reason, /gh run rerun 42/);
  });
  test("a dispatched run is matched by the tag's commit even if head_branch differs", () => {
    const d = decideEnsure({ ...base, remoteTagSha: "abc", runs: [{ databaseId: 5, headBranch: "main", headSha: "abc", status: "in_progress", conclusion: null }] });
    assert.equal(d.action, "none");
  });
  test("runs for other tags are ignored", () => {
    const d = decideEnsure({ ...base, remoteTagSha: "abc", runs: [run("completed", "failure", 7, "v0.3.0")] });
    assert.equal(d.action, "dispatch");
  });
});
