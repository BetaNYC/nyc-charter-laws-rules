// Build idempotence test (commit-churn fix, 2026-06).
//
// Guards the invariant that a rebuild with NO source-content change produces
// byte-identical tracked outputs (zero git diff). Before this fix, build-index.js
// stamped a fresh wall-clock `indexedAt` into versions.json on every run, and
// update-changelog.js prepended a duplicate entry + re-stamped the README every
// run — so a no-op refresh still churned versions.json, changelog.json,
// CHANGELOG.md, and README.md, forcing manual exclusion from refresh commits.
//
// Two layers, both ZIP-free so they run in CI (no data/raw/*.zip on the runner):
//   1. mergeVersions() unit tests — the pure indexedAt-preservation core.
//   2. An end-to-end double-run of update-changelog.js as a subprocess against a
//      temp fixture tree, asserting the second run leaves every output byte-
//      identical (the real stamping/append path, no multi-MB ZIPs).
//
// Run with: node --test

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { mergeVersions } from "../scripts/lib/merge-versions.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const UPDATE_CHANGELOG = join(__dirname, "..", "scripts", "update-changelog.js");

// ── Layer 1: mergeVersions() — the indexedAt-preservation core ─────────────────

const FRESH = {
  charter: {
    currentThrough: "Current through Local Law 2026/110, enacted June 13, 2026,",
    indexedAt: "2026-06-17T15:00:00.000Z", // freshly stamped this run
    sectionCount: 854,
  },
  rules: {
    currentThrough: "Current through rules effective June 17, 2026.",
    indexedAt: "2026-06-17T15:00:05.000Z",
    sectionCount: 8660,
  },
};

test("mergeVersions: unchanged content preserves the prior indexedAt", () => {
  const prior = {
    charter: {
      currentThrough: "Current through Local Law 2026/110, enacted June 13, 2026,",
      indexedAt: "2026-06-09T20:00:00.000Z", // older — must be kept
      sectionCount: 854,
    },
    rules: {
      currentThrough: "Current through rules effective June 17, 2026.",
      indexedAt: "2026-06-09T20:00:05.000Z",
      sectionCount: 8660,
    },
  };
  const merged = mergeVersions(FRESH, prior);
  assert.equal(merged.charter.indexedAt, "2026-06-09T20:00:00.000Z");
  assert.equal(merged.rules.indexedAt, "2026-06-09T20:00:05.000Z");
  // Content fields pass through unchanged.
  assert.equal(merged.charter.currentThrough, FRESH.charter.currentThrough);
  assert.equal(merged.charter.sectionCount, 854);
  // Output shape is exactly the three MCP-surfaced fields.
  assert.deepEqual(Object.keys(merged.charter), [
    "currentThrough",
    "indexedAt",
    "sectionCount",
  ]);
});

test("mergeVersions: a changed currentThrough adopts the fresh indexedAt", () => {
  const prior = {
    charter: {
      currentThrough: "Current through Local Law 2026/102, enacted May 30, 2026,", // older version
      indexedAt: "2026-06-09T20:00:00.000Z",
      sectionCount: 854,
    },
    rules: FRESH.rules, // unchanged
  };
  const merged = mergeVersions(FRESH, prior);
  assert.equal(merged.charter.indexedAt, FRESH.charter.indexedAt, "version advanced → fresh stamp");
  assert.equal(merged.rules.indexedAt, FRESH.rules.indexedAt, "unchanged rules keeps prior (== fresh here)");
});

test("mergeVersions: a changed sectionCount adopts the fresh indexedAt", () => {
  const prior = {
    charter: {
      currentThrough: FRESH.charter.currentThrough, // same version string
      indexedAt: "2026-06-09T20:00:00.000Z",
      sectionCount: 850, // but section count changed
    },
    rules: FRESH.rules,
  };
  const merged = mergeVersions(FRESH, prior);
  assert.equal(merged.charter.indexedAt, FRESH.charter.indexedAt, "sectionCount changed → fresh stamp");
});

test("mergeVersions: first build (no prior) keeps the fresh indexedAt", () => {
  const merged = mergeVersions(FRESH, null);
  assert.equal(merged.charter.indexedAt, FRESH.charter.indexedAt);
  assert.equal(merged.rules.indexedAt, FRESH.rules.indexedAt);
});

test("mergeVersions: a corpus absent from prior keeps the fresh indexedAt", () => {
  const prior = { charter: FRESH.charter }; // rules is new
  const merged = mergeVersions(FRESH, prior);
  assert.equal(merged.charter.indexedAt, FRESH.charter.indexedAt, "unchanged charter keeps prior (== fresh)");
  assert.equal(merged.rules.indexedAt, FRESH.rules.indexedAt, "new corpus keeps fresh");
});

test("mergeVersions: re-merging its own output is a fixed point (idempotent)", () => {
  // Simulate two consecutive no-op builds: build N produces stable versions;
  // build N+1 stamps fresh timestamps but, seeing identical content, must
  // reproduce build N's output exactly.
  const prior = mergeVersions(FRESH, null); // build N (fresh == prior here)
  const nextFresh = {
    charter: { ...FRESH.charter, indexedAt: "2026-06-25T09:00:00.000Z" },
    rules: { ...FRESH.rules, indexedAt: "2026-06-25T09:00:05.000Z" },
  };
  const merged = mergeVersions(nextFresh, prior); // build N+1, later wall clock
  assert.deepEqual(merged, prior, "no-op rebuild reproduces prior output byte-for-byte");
});

// ── Layer 2: end-to-end update-changelog.js double-run idempotence ─────────────

// Build a minimal fixture tree with the files update-changelog.js reads/writes:
//   data/index/json/versions.json (input), data/changelog.json (created),
//   CHANGELOG.md (created), README.md (stamped via markers).
function makeFixtureRoot() {
  const root = mkdtempSync(join(tmpdir(), "charter-churn-"));
  mkdirSync(join(root, "data", "index", "json"), { recursive: true });
  // A stable versions.json — the kind produced AFTER the mergeVersions fix, with
  // a fixed indexedAt (no wall-clock drift between runs).
  const versions = {
    charter: {
      currentThrough: "Current through Local Law 2026/110, enacted June 13, 2026,",
      indexedAt: "2026-06-17T13:37:02.407Z",
      sectionCount: 854,
    },
    admin_code: {
      currentThrough: "Current through Local Law 2026/110, enacted June 13, 2026,",
      indexedAt: "2026-06-17T13:37:08.235Z",
      sectionCount: 12584,
    },
    rules: {
      currentThrough: "Current through rules effective June 17, 2026.",
      indexedAt: "2026-06-17T13:37:12.812Z",
      sectionCount: 8660,
    },
  };
  writeFileSync(
    join(root, "data", "index", "json", "versions.json"),
    JSON.stringify(versions, null, 2)
  );
  // README with the marker block update-changelog.js stamps between.
  writeFileSync(
    join(root, "README.md"),
    [
      "# NYC Charter, Laws & Rules",
      "",
      "<!-- LATEST_INDEX_UPDATE:START -->",
      "(placeholder — will be stamped)",
      "<!-- LATEST_INDEX_UPDATE:END -->",
      "",
      "Some trailing prose that must be left untouched.",
      "",
    ].join("\n")
  );
  return root;
}

// update-changelog.js resolves its paths from its own location (__dirname/..),
// so we can't point it at a temp root directly. Instead we copy the script into
// the fixture's scripts/ dir so its ROOT resolves to the fixture root.
function installScript(root) {
  mkdirSync(join(root, "scripts"), { recursive: true });
  const src = readFileSync(UPDATE_CHANGELOG, "utf8");
  const dest = join(root, "scripts", "update-changelog.js");
  writeFileSync(dest, src);
  return dest;
}

function runChangelog(scriptPath) {
  execFileSync(process.execPath, [scriptPath], { stdio: "pipe" });
}

function snapshotOutputs(root) {
  return {
    changelogJson: readFileSync(join(root, "data", "changelog.json"), "utf8"),
    changelogMd: readFileSync(join(root, "CHANGELOG.md"), "utf8"),
    readme: readFileSync(join(root, "README.md"), "utf8"),
    versions: readFileSync(join(root, "data", "index", "json", "versions.json"), "utf8"),
  };
}

test("update-changelog: a second no-op run leaves every output byte-identical", () => {
  const root = makeFixtureRoot();
  const script = installScript(root);
  try {
    // First run: bootstraps changelog.json, CHANGELOG.md, stamps README.
    runChangelog(script);
    const after1 = snapshotOutputs(root);

    // Second run with NO content change: must reproduce everything byte-for-byte
    // (no duplicate changelog entry, no re-stamp drift).
    runChangelog(script);
    const after2 = snapshotOutputs(root);

    assert.equal(after2.changelogJson, after1.changelogJson, "changelog.json unchanged on no-op rebuild");
    assert.equal(after2.changelogMd, after1.changelogMd, "CHANGELOG.md unchanged on no-op rebuild");
    assert.equal(after2.readme, after1.readme, "README.md unchanged on no-op rebuild");
    assert.equal(after2.versions, after1.versions, "versions.json untouched by changelog step");

    // And a third run too, for good measure — still a fixed point.
    runChangelog(script);
    const after3 = snapshotOutputs(root);
    assert.equal(after3.changelogJson, after1.changelogJson, "changelog.json still stable on third run");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
