#!/usr/bin/env node
// Parses the three AML bulk XML ZIPs and builds JSON + Markdown indexes.
// Run after fetch-data: npm run build-index

import { XMLParser } from "fast-xml-parser";
import AdmZip from "adm-zip";
import { writeFileSync, mkdirSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

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

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  textNodeName: "#text",
  isArray: (name) => ["LEVEL", "RECORD", "PARA", "CHARFORMAT"].includes(name),
});

// Recursively extract all text from a node, stripping XML tags.
function extractText(node) {
  if (!node) return "";
  if (typeof node === "string") return node;
  if (typeof node === "number") return String(node);

  let text = "";
  if (node["#text"]) text += node["#text"];

  for (const [key, val] of Object.entries(node)) {
    if (key.startsWith("@_") || key === "#text") continue;
    if (Array.isArray(val)) {
      text += val.map(extractText).join(" ");
    } else if (typeof val === "object") {
      text += extractText(val);
    }
  }
  return text.replace(/\s+/g, " ").trim();
}

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
function collectSections(node, corpus, sections, depth = 0) {
  if (!node) return;

  const levels = [node.LEVEL].flat().filter(Boolean);
  for (const level of levels) {
    const styleName = level["@_style-name"] || "";
    const records = [level.RECORD].flat().filter(Boolean);

    for (const record of records) {
      const heading = extractText(record.HEADING || "");
      if (!heading) continue;

      // Only index Chapter and Section level records with real headings.
      if (
        (styleName === "Section" || styleName === "Chapter") &&
        heading.length > 3
      ) {
        // Collect body text from child Normal Level records.
        const bodyParts = [];
        const childLevels = [level.LEVEL].flat().filter(Boolean);
        for (const child of childLevels) {
          if ((child["@_style-name"] || "") === "Normal Level") {
            const childRecords = [child.RECORD].flat().filter(Boolean);
            for (const cr of childRecords) {
              const paras = [cr.PARA].flat().filter(Boolean);
              bodyParts.push(...paras.map(extractText));
            }
          }
        }

        const citation = extractCitation(heading);
        sections.push({
          corpus,
          id: record["@_id"] || "",
          citation,
          heading,
          text: bodyParts.join(" ").replace(/\s+/g, " ").trim(),
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

    collectSections(parsed.DOCUMENT, corpus.key, sections);
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
