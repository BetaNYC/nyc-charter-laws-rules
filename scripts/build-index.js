#!/usr/bin/env node
// CLI: parses the three AML bulk XML ZIPs and builds JSON + Markdown indexes, and the site
// structure that goes with them (data/structure/, issue #61).
// Run after fetch-data: npm run build-index
//
// This file is the thin I/O wrapper. The parsing/section-building core lives in
// scripts/lib/build-corpus.js (importable + unit-tested via test/build-smoke.test.js);
// the ordered-tree extraction helpers live in scripts/lib/extract-text.js; the structure in
// scripts/lib/build-structure.js; the Markdown writer in scripts/lib/serialize-markdown.js,
// which writes from renderSection's blocks (scripts/lib/render-section.js).
//
// Parsing note (fix #3, 2026-06): we parse with `preserveOrder: true` so that
// inline cross-reference elements (<LINK>, <CHARFORMAT>) stay in document order
// relative to the surrounding running text. In the default (non-ordered) mode a
// node's direct text collapsed into a single "#text" and child elements were
// grouped by tag, so extractText() emitted all the running text first and then
// appended the inline elements — relocating spelled-out section numbers to the
// end of the sentence and running adjacent words together ("sectionof").

import AdmZip from "adm-zip";
import { writeFileSync, readFileSync, mkdirSync, existsSync } from "fs";
import { createHash } from "crypto";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import {
  extractVersion,
  collectSectionsFromXml,
} from "./lib/build-corpus.js";
import { mergeVersions } from "./lib/merge-versions.js";
import { createStructureCollector, structureJson } from "./lib/build-structure.js";
import { corpusMarkdown } from "./lib/serialize-markdown.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, "..", "data");
const RAW_DIR = join(DATA_DIR, "raw");
const JSON_DIR = join(DATA_DIR, "index", "json");
const MD_DIR = join(DATA_DIR, "index", "markdown");
// The site structure (issue #61) is kept out of data/index/, so it does not ship in the npm
// package (package.json `files`): the MCP server does not read it.
const STRUCTURE_DIR = join(DATA_DIR, "structure");

mkdirSync(JSON_DIR, { recursive: true });
mkdirSync(MD_DIR, { recursive: true });
mkdirSync(STRUCTURE_DIR, { recursive: true });

const CORPORA = [
  { key: "charter", zip: "charter.zip", xmlDir: "XML" },
  { key: "admin_code", zip: "admin_code.zip", xmlDir: "XML" },
  { key: "rules", zip: "rules.zip", xmlDir: "XML" },
];

const versions = {};
// Per corpus built: its sections, version line, JSON sha256 and structure collector. The
// Markdown and structure are written after every corpus is read, so links between the
// documents can be resolved.
const built = {};

for (const corpus of CORPORA) {
  const zipPath = join(RAW_DIR, corpus.zip);
  if (!existsSync(zipPath)) {
    console.error(`Missing ${zipPath} — run npm run fetch-data first.`);
    continue;
  }

  console.log(`\nParsing ${corpus.key}...`);
  const zip = new AdmZip(zipPath);
  const entries = zip.getEntries().filter(
    (e) => e.entryName.startsWith(`${corpus.xmlDir}/`) && e.entryName.endsWith(".xml")
  );

  console.log(`  Found ${entries.length} XML files`);

  let version = "Unknown";
  const sections = [];
  const structure = createStructureCollector(corpus.key);
  let fileCount = 0;

  for (const entry of entries) {
    const xml = entry.getData().toString("utf8");

    const ok = collectSectionsFromXml(
      xml,
      corpus.key,
      sections,
      (e) => {
        console.warn(`  Skipping ${entry.entryName}: ${e.message}`);
      },
      structure.forFile({ root: entry.entryName.endsWith("0-0-0-1.xml") })
    );
    if (!ok) continue;

    // Extract version from root file.
    if (entry.entryName.endsWith("0-0-0-1.xml")) {
      version = extractVersion(xml);
      console.log(`  Version: ${version}`);
    }

    fileCount++;
    if (fileCount % 50 === 0) process.stdout.write(`  Parsed ${fileCount}/${entries.length} files...\r`);
  }

  console.log(`  Indexed ${sections.length} sections from ${fileCount} files`);

  // Write JSON index. Its sha256 goes in versions.json, so a shipped index file can be
  // checked against the build that made it (issue #45, test/index-checksum.test.js).
  const json = JSON.stringify(sections, null, 2);
  writeFileSync(join(JSON_DIR, `${corpus.key}.json`), json);

  const sha256 = createHash("sha256").update(json).digest("hex");
  versions[corpus.key] = {
    currentThrough: version,
    indexedAt: new Date().toISOString(),
    sectionCount: sections.length,
    sha256,
  };
  console.log(`  Saved data/index/json/${corpus.key}.json`);
  built[corpus.key] = { sections, version, sha256, structure };
}

// Structure and Markdown, per corpus. Links into another document resolve only when that
// document was built in the same run (all three are, unless a ZIP is missing).
for (const [key, b] of Object.entries(built)) {
  const others = Object.fromEntries(
    Object.entries(built).filter(([k]) => k !== key).map(([k, o]) => [k, o.structure])
  );
  const structure = b.structure.finish(b.sections, b.sha256, others);
  writeFileSync(join(STRUCTURE_DIR, `${key}.json`), structureJson(structure));
  const flat = structure.sections.filter((s) => s.flat).length;
  const ls = structure.linkStats;
  console.log(
    `\n${key}: saved data/structure/${key}.json (${structure.sections.length} sections, ` +
      `${flat} kept as one block; titles ${JSON.stringify(structure.titleStats)})\n` +
      `  links: ${ls.links}, ${ls.unresolved} unresolved, of which ${ls.ambiguous} ambiguous; ` +
      `anchor ids on more than one record: ${ls.ambiguousIds}; anchor names on more than one record: ${ls.ambiguousNames}`
  );

  // Markdown index: one file per corpus, one section per heading, written from the blocks.
  writeFileSync(
    join(MD_DIR, `${key}.md`),
    corpusMarkdown({ corpus: key, version: b.version, sections: b.sections, structure })
  );
  console.log(`  Saved data/index/markdown/${key}.md`);
}

// Idempotence (commit-churn fix, 2026-06): `indexedAt` means "as of when the
// content was last indexed", not "when this process ran". Preserve the prior
// timestamp for any corpus whose content (currentThrough + sectionCount) did
// not change, so a no-op rebuild produces a byte-identical versions.json and
// no git diff. See scripts/lib/merge-versions.js.
const VERSIONS_PATH = join(JSON_DIR, "versions.json");
const priorVersions = existsSync(VERSIONS_PATH)
  ? JSON.parse(readFileSync(VERSIONS_PATH, "utf8"))
  : null;
const stableVersions = mergeVersions(versions, priorVersions);

writeFileSync(VERSIONS_PATH, JSON.stringify(stableVersions, null, 2));
console.log("\nVersions saved to data/index/versions.json:");
console.log(JSON.stringify(stableVersions, null, 2));
console.log("\nIndex build complete.");
