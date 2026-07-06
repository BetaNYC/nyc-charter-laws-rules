// Pure corpus-building logic for the AML bulk XML indexer.
//
// This module holds the parsing/section-building core that turns a set of AML
// XML document strings into the array of indexed section objects. It is the
// importable, unit-testable counterpart to the build-index.js CLI: build-index.js
// reads the ZIPs, strips BOMs, extracts the version string, and writes JSON +
// Markdown; everything *between* "here is the XML" and "here are the sections"
// lives here so it can be exercised on a tiny hand-authored fixture without the
// multi-MB ZIPs.
//
// Parsing note (fix #3, 2026-06): we parse with `preserveOrder: true` so that
// inline cross-reference elements (<LINK>, <CHARFORMAT>) stay in document order
// relative to the surrounding running text. See scripts/lib/extract-text.js for
// the full rationale and the ordered-tree shapes used below.

import {
  makeParser,
  tagOf,
  getAttr,
  childrenByTag,
  extractText,
  normalize,
} from "./extract-text.js";

// Extract the "Current through..." version string from the root document's
// raw XML text. The text lives in CHARFORMAT nodes inside Introduction-style
// PARAs. Historical note: this used to run a regex over JSON.stringify(parsedTree),
// where the match stopped at the first `"` or `\` in the JSON encoding — i.e. at
// the end of the text node OR at the first escaped control character (newline,
// tab, etc.). The stop-set below ( `<` for tag boundaries plus `"` `\` and
// control whitespace) reproduces that behavior exactly over the raw XML, so the
// extracted string — including any historical mid-sentence truncation — is
// byte-identical to what the committed versions.json already contains.
export function extractVersion(xml) {
  const match = xml.match(/Current through[^<"\\\n\r\t]*/);
  if (match) {
    return match[0].replace(/\[ALP.*?\]/g, "").replace(/\s+/g, " ").trim();
  }
  return "Unknown";
}

// Walk the LEVEL tree and collect sections.
// `node` is an ordered element object (DOCUMENT, then each LEVEL as we recurse).
export function collectSections(node, corpus, sections) {
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
    collectSections(level, corpus, sections);
  }
}

// Pull the citation out of a heading string.
// e.g. "Section 259. Independent budget office." → "§ 259"
// e.g. "Chapter 11: Independent Budget Office" → "Chapter 11"
export function extractCitation(heading) {
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
export function findDocument(parsed) {
  if (!Array.isArray(parsed)) return null;
  return parsed.find((n) => tagOf(n) === "DOCUMENT") || null;
}

// Parse one AML XML document string and append its sections to `sections`.
// Mirrors the per-file body of the CLI loop: strip BOM, parse, find DOCUMENT,
// collect. Parse failures are reported via the `onError` callback (the CLI logs
// a warning and continues) rather than thrown, preserving today's resilience.
// Returns true if the file was parsed (whether or not it yielded sections),
// false if it was skipped due to a parse error.
export function collectSectionsFromXml(xml, corpusKey, sections, onError) {
  const cleaned = xml.replace(/^﻿/, ""); // strip BOM
  let parsed;
  try {
    parsed = makeParser().parse(cleaned);
  } catch (e) {
    if (onError) onError(e);
    return false;
  }
  collectSections(findDocument(parsed), corpusKey, sections);
  return true;
}

// Pure builder: turn an array of AML XML document strings into the indexed
// section array for one corpus. This is the unit-testable core used by both the
// build-index CLI (over the real ZIP contents) and the build-smoke test (over a
// tiny hand-authored fixture). It performs NO I/O.
//
// Each entry of `xmlStrings` is the full text of one AML XML file. Sections are
// accumulated in document order across the files, exactly as the CLI loop does.
export function buildSectionsFromXml(xmlStrings, corpusKey, onError) {
  const sections = [];
  for (const xml of xmlStrings) {
    collectSectionsFromXml(xml, corpusKey, sections, onError);
  }
  return sections;
}
