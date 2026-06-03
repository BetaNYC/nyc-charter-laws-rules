#!/usr/bin/env node
// Parses the three AML bulk XML ZIPs and builds JSON + Markdown indexes.
// Run after fetch-data: npm run build-index
//
// Parsing note (fix #3, 2026-06): we parse with `preserveOrder: true` so that
// inline cross-reference elements (<LINK>, <CHARFORMAT>) stay in document order
// relative to the surrounding running text. In the default (non-ordered) mode a
// node's direct text collapsed into a single "#text" and child elements were
// grouped by tag, so extractText() emitted all the running text first and then
// appended the inline elements — relocating spelled-out section numbers to the
// end of the sentence and running adjacent words together ("sectionof").
//
// In preserveOrder mode the parsed tree is an array of single-key objects in
// document order. The shapes used below:
//   - text node:      { "#text": "..." }
//   - element node:   { "TAGNAME": [ ...children... ], ":@": { "@_attr": val } }
// Attributes live under the ":@" key (not inline), keyed with the "@_" prefix.

import AdmZip from "adm-zip";
import { writeFileSync, mkdirSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import {
  makeParser,
  tagOf,
  getAttr,
  childrenByTag,
  extractText,
  normalize,
} from "./lib/extract-text.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, "..", "data");
const RAW_DIR = join(DATA_DIR, "raw");
const JSON_DIR = join(DATA_DIR, "index", "json");
const MD_DIR = join(DATA_DIR, "index", "markdown");

mkdirSync(JSON_DIR, { recursive: true });
mkdirSync(MD_DIR, { recursive: true });

const CORPORA = [
  { key: "charter", zip: "charter.zip", xmlDir: "XML" },
  { key: "admin_code", zip: "admin_code.zip", xmlDir: "XML" },
  { key: "rules", zip: "rules.zip", xmlDir: "XML" },
];

const parser = makeParser();

// Extract the "Current through..." version string from the root document.
// The text lives in CHARFORMAT nodes inside Introduction-style PARAs.
function extractVersion(parsed) {
  try {
    const fullText = JSON.stringify(parsed);
    const match = fullText.match(/Current through[^"\\]*/);
    if (match) {
      return match[0].replace(/\\n/g, " ").replace(/\[ALP.*?\]/g, "").replace(/\s+/g, " ").trim();
    }
  } catch {}
  return "Unknown";
}

// Walk the LEVEL tree and collect sections.
// `node` is an ordered element object (DOCUMENT, then each LEVEL as we recurse).
function collectSections(node, corpus, sections, depth = 0) {
  if (!node) return;

  const levels = childrenByTag(node, "LEVEL");
  for (const level of levels) {
    const styleName = getAttr(level, "style-name") || "";
    const records = childrenByTag(level, "RECORD");

    for (const record of records) {
      const headingNodes = childrenByTag(record, "HEADING");
      const heading = normalize(headingNodes.map(extractText).join(""));
      if (!heading) continue;

      // Only index Chapter and Section level records with real headings.
      if (
        (styleName === "Section" || styleName === "Chapter") &&
        heading.length > 3
      ) {
        // Collect body text from child Normal Level records.
        const bodyParts = [];
        const childLevels = childrenByTag(level, "LEVEL");
        for (const child of childLevels) {
          if ((getAttr(child, "style-name") || "") === "Normal Level") {
            const childRecords = childrenByTag(child, "RECORD");
            for (const cr of childRecords) {
              const paras = childrenByTag(cr, "PARA");
              bodyParts.push(...paras.map((p) => normalize(extractText(p))));
            }
          }
        }

        const citation = extractCitation(heading);
        sections.push({
          corpus,
          id: getAttr(record, "id") || "",
          citation,
          heading,
          text: normalize(bodyParts.join(" ")),
        });
      }
    }

    // Recurse into nested levels.
    collectSections(level, corpus, sections, depth + 1);
  }
}

// Pull the citation out of a heading string.
// e.g. "Section 259. Independent budget office." → "§ 259"
// e.g. "Chapter 11: Independent Budget Office" → "Chapter 11"
function extractCitation(heading) {
  const sectionMatch = heading.match(/[Ss]ection\s+([\d\-\.a-zA-Z]+)/);
  if (sectionMatch) return `§ ${sectionMatch[1].replace(/\.$/, "")}`;
  const chapterMatch = heading.match(/[Cc]hapter\s+([\d\-]+)/);
  if (chapterMatch) return `Chapter ${chapterMatch[1]}`;
  const titleMatch = heading.match(/[Tt]itle\s+([\d\-]+)/);
  if (titleMatch) return `Title ${titleMatch[1]}`;
  return heading.split(":")[0].split(".")[0].trim();
}

// Find the DOCUMENT element in the ordered top-level array (which also holds
// processing-instruction nodes like <?xml?> and <?xml-stylesheet?>).
function findDocument(parsed) {
  if (!Array.isArray(parsed)) return null;
  return parsed.find((n) => tagOf(n) === "DOCUMENT") || null;
}

const versions = {};

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
  let fileCount = 0;

  for (const entry of entries) {
    const xml = entry.getData().toString("utf8").replace(/^﻿/, ""); // strip BOM
    let parsed;
    try {
      parsed = parser.parse(xml);
    } catch (e) {
      console.warn(`  Skipping ${entry.entryName}: ${e.message}`);
      continue;
    }

    // Extract version from root file.
    if (entry.entryName.endsWith("0-0-0-1.xml")) {
      version = extractVersion(parsed);
      console.log(`  Version: ${version}`);
    }

    collectSections(findDocument(parsed), corpus.key, sections);
    fileCount++;
    if (fileCount % 50 === 0) process.stdout.write(`  Parsed ${fileCount}/${entries.length} files...\r`);
  }

  console.log(`  Indexed ${sections.length} sections from ${fileCount} files`);

  versions[corpus.key] = {
    currentThrough: version,
    indexedAt: new Date().toISOString(),
    sectionCount: sections.length,
  };

  // Write JSON index.
  writeFileSync(
    join(JSON_DIR, `${corpus.key}.json`),
    JSON.stringify(sections, null, 2)
  );
  console.log(`  Saved data/index/json/${corpus.key}.json`);

  // Write Markdown index — one file per corpus, one section per heading.
  const corpusLabel = {
    charter: "NYC Charter",
    admin_code: "NYC Administrative Code",
    rules: "Rules of the City of New York",
  }[corpus.key];

  const md = [
    `# ${corpusLabel}`,
    ``,
    `> ${version}`,
    ``,
    `_${sections.length} sections indexed. Generated by [nyc-charter-laws-rules](https://github.com/BetaNYC/nyc-charter-laws-rules)._`,
    ``,
    `---`,
    ``,
    ...sections.map((s) =>
      [
        `## ${s.heading}`,
        ``,
        `**Citation:** ${s.citation}`,
        ``,
        s.text || "_No text extracted._",
        ``,
        `---`,
        ``,
      ].join("\n")
    ),
  ].join("\n");

  writeFileSync(join(MD_DIR, `${corpus.key}.md`), md);
  console.log(`  Saved data/index/markdown/${corpus.key}.md`);
}

writeFileSync(join(JSON_DIR, "versions.json"), JSON.stringify(versions, null, 2));
console.log("\nVersions saved to data/index/versions.json:");
console.log(JSON.stringify(versions, null, 2));
console.log("\nIndex build complete.");
