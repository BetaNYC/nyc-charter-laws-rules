// The site built from real fixtures, for the site tests (issue #62).
//
// The fixtures are American Legal Publishing's own Charter XML, unchanged: the 44 files in
// test/fixtures/diff/xml/ (Current through Local Law 2026/086). They are built the way
// scripts/build-index.js builds them (index JSON, versions.json, structure), into a temporary
// folder, and the site is built from those. Offline: no network, no data/raw, and the build's
// clock is fixed.

import { mkdtempSync, mkdirSync, writeFileSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { collectSectionsFromXml, extractVersion, createTitleIndex, finishTitles } from "../../scripts/lib/build-corpus.js";
import { createStructureCollector, structureJson } from "../../scripts/lib/build-structure.js";
import { buildSite } from "../../scripts/lib/site/build.js";

const HERE = dirname(fileURLToPath(import.meta.url));
export const ROOT = join(HERE, "..", "..");
export const CHARTER_XML = join(ROOT, "test", "fixtures", "diff", "xml");
/**
 * The Rules fixtures (issue #59): hand-made in the publisher's shape, not the publisher's text.
 * Title 15 (§ 1-01, and a chapter named only by its anchor), Title 24 (a § 1-01, the Health Code,
 * and a chapter with no Title record), Title 30 (two yearly orders that each have a "Notice"),
 * Title 38-A, and Title 62 (two chapters that both number a § 6-01).
 */
export const RULES_XML = join(ROOT, "test", "fixtures", "titles", "rules");

/** The build's fixed clock: 2026-11-23 03:30 UTC is 10:30 pm on November 22 in New York. */
export const FIXED_NOW = new Date("2026-11-23T03:30:00Z");
/** The fixture index's own indexedAt (UTC). In New York it is still November 22. */
export const FIXTURE_INDEXED_AT = "2026-11-23T02:05:49.061Z";

/** Index JSON text, versions and structure for the Charter fixtures. */
export function buildFixtureData() {
  const files = readdirSync(CHARTER_XML).filter((f) => f.endsWith(".xml")).sort();
  const collector = createStructureCollector("charter");
  const sections = [];
  let version = "Unknown";
  for (const f of files) {
    const xml = readFileSync(join(CHARTER_XML, f), "utf8");
    collectSectionsFromXml(xml, "charter", sections, (e) => { throw e; }, collector.forFile({ root: f === "0-0-0-1.xml" }));
    if (f === "0-0-0-1.xml") version = extractVersion(xml);
  }
  const json = JSON.stringify(sections, null, 2);
  const sha256 = createHash("sha256").update(json).digest("hex");
  const structure = collector.finish(sections, sha256, {});
  const versions = { charter: { currentThrough: version, indexedAt: FIXTURE_INDEXED_AT, sectionCount: sections.length, sha256 } };
  return { json, sections, structure, versions };
}

/** Write the fixture data to a temporary folder: { indexDir, structureDir, root }. */
export function writeFixtureData(data = buildFixtureData()) {
  const root = mkdtempSync(join(tmpdir(), "law-reader-data-"));
  const indexDir = join(root, "index", "json");
  const structureDir = join(root, "structure");
  mkdirSync(indexDir, { recursive: true });
  mkdirSync(structureDir, { recursive: true });
  writeFileSync(join(indexDir, "charter.json"), data.json);
  writeFileSync(join(indexDir, "versions.json"), JSON.stringify(data.versions, null, 2));
  writeFileSync(join(structureDir, "charter.json"), structureJson(data.structure));
  return { root, indexDir, structureDir, data };
}

/** Build the fixture site into a new temporary folder. */
export async function buildFixtureSite({ search = false } = {}) {
  const d = writeFixtureData();
  const outDir = join(mkdtempSync(join(tmpdir(), "law-reader-site-")), "site");
  const result = await buildSite({ indexDir: d.indexDir, structureDir: d.structureDir, outDir, search, now: FIXED_NOW, commit: "0123456789abcdef", books: ["charter"] });
  return { ...result, data: d.data, dataDirs: d };
}

/**
 * Index JSON text, versions entry and structure for the Rules fixtures, built the way
 * scripts/build-index.js builds them (a title index finished after the last file). `titles:
 * false` takes `titleNumber` and `titleHeading` off every record: an index from before 0.6.3.
 */
export function buildRulesFixtureData({ titles = true } = {}) {
  const files = readdirSync(RULES_XML).filter((f) => f.endsWith(".xml")).sort();
  const collector = createStructureCollector("rules");
  const index = createTitleIndex();
  let sections = [];
  let version = "Unknown";
  for (const f of files) {
    const xml = readFileSync(join(RULES_XML, f), "utf8");
    collectSectionsFromXml(xml, "rules", sections, (e) => { throw e; }, collector.forFile({ root: f === "0-0-0-1.xml" }), index);
    if (f === "0-0-0-1.xml") version = extractVersion(xml);
  }
  finishTitles(index);
  if (!titles) sections = sections.map(({ titleNumber, titleHeading, ...r }) => r);
  const json = JSON.stringify(sections, null, 2);
  const sha256 = createHash("sha256").update(json).digest("hex");
  const structure = collector.finish(sections, sha256, {});
  return { json, sections, structure, version: { currentThrough: version, indexedAt: FIXTURE_INDEXED_AT, sectionCount: sections.length, sha256 } };
}

/** Build the Charter and the Rules fixtures into a new temporary folder. */
export async function buildRulesFixtureSite({ search = false, titles = true, books = ["charter", "rules"] } = {}) {
  const d = writeFixtureData();
  const rules = buildRulesFixtureData({ titles });
  writeFileSync(join(d.indexDir, "rules.json"), rules.json);
  writeFileSync(join(d.structureDir, "rules.json"), structureJson(rules.structure));
  writeFileSync(join(d.indexDir, "versions.json"), JSON.stringify({ ...d.data.versions, rules: rules.version }, null, 2));
  const outDir = join(mkdtempSync(join(tmpdir(), "law-reader-site-")), "site");
  const result = await buildSite({ indexDir: d.indexDir, structureDir: d.structureDir, outDir, search, now: FIXED_NOW, commit: "0123456789abcdef", books });
  return { ...result, data: d.data, rules, dataDirs: d };
}
