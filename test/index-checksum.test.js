// The bundled index records how it was built (issue #45): versions.json carries, per
// document, the date it was indexed and the sha256 of its JSON file, written by
// build-index.js. A shipped file that does not match its checksum fails here, and the daily
// refresh runs this suite before it commits.

import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { mergeVersions } from "../scripts/lib/merge-versions.js";

const DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "data", "index", "json");
const PRESENT = existsSync(join(DIR, "versions.json"));

test("every bundled index file matches the sha256 in versions.json", { skip: !PRESENT && "index not built" }, () => {
  const versions = JSON.parse(readFileSync(join(DIR, "versions.json"), "utf8"));
  assert.deepEqual(Object.keys(versions).sort(), ["admin_code", "charter", "rules"]);
  for (const [corpus, v] of Object.entries(versions)) {
    assert.match(v.sha256 ?? "", /^[0-9a-f]{64}$/, `${corpus} has a sha256`);
    assert.ok(!Number.isNaN(Date.parse(v.indexedAt)), `${corpus} has an indexedAt date`);
    const actual = createHash("sha256").update(readFileSync(join(DIR, `${corpus}.json`))).digest("hex");
    assert.equal(actual, v.sha256, `${corpus}.json does not match its checksum`);
  }
});

const BASE = { currentThrough: "Current through Local Law 2026/164", sectionCount: 856 };

test("mergeVersions keeps the sha256 and the prior indexedAt when nothing changed", () => {
  const prior = { charter: { ...BASE, indexedAt: "2026-11-01T00:00:00.000Z", sha256: "a".repeat(64) } };
  const fresh = { charter: { ...BASE, indexedAt: "2026-11-18T00:00:00.000Z", sha256: "a".repeat(64) } };
  assert.deepEqual(mergeVersions(fresh, prior).charter, prior.charter);
});

test("mergeVersions: new text under the same version line and count moves indexedAt", () => {
  const prior = { charter: { ...BASE, indexedAt: "2026-11-01T00:00:00.000Z", sha256: "a".repeat(64) } };
  const fresh = { charter: { ...BASE, indexedAt: "2026-11-18T00:00:00.000Z", sha256: "b".repeat(64) } };
  const m = mergeVersions(fresh, prior).charter;
  assert.equal(m.indexedAt, "2026-11-18T00:00:00.000Z");
  assert.equal(m.sha256, "b".repeat(64));
});

test("mergeVersions: a prior entry from before checksums is compared the old way", () => {
  const prior = { charter: { ...BASE, indexedAt: "2026-11-01T00:00:00.000Z" } };
  const fresh = { charter: { ...BASE, indexedAt: "2026-11-18T00:00:00.000Z", sha256: "a".repeat(64) } };
  const m = mergeVersions(fresh, prior).charter;
  assert.equal(m.indexedAt, "2026-11-01T00:00:00.000Z");
  assert.equal(m.sha256, "a".repeat(64));
});
