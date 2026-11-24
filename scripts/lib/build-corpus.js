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
//
// `onSection` (optional, issue #61) is called once per indexed section, right after it is
// pushed, with what the site structure needs and the index drops: the LEVEL style, the heading
// RECORD, the body RECORDs whose PARAs make up `text`, and the enclosing LEVELs that carry a
// heading (outermost first), and the section's own LEVEL (`levelNode`), whose other child levels
// (a "Subsection" in the Construction Codes) the index does not read. It is only told about a section: it cannot change one, so the
// index is the same with or without it (test/structure.test.js checks this byte for byte).
// `ancestors` is the recursion's own state; callers leave it out.
export function collectSections(node, corpus, sections, onSection = null, ancestors = []) {
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
        const bodyRecords = [];
        const childLevels = childrenByTag(level, "LEVEL");
        for (const child of childLevels) {
          if ((getAttr(child, "style-name") || "") === "Normal Level") {
            const childRecords = childrenByTag(child, "RECORD");
            for (const cr of childRecords) {
              bodyRecords.push(cr);
              const paras = childrenByTag(cr, "PARA");
              bodyParts.push(...paras.map((p) => normalize(extractText(p))));
            }
          }
        }

        const citation = extractCitation(heading);
        const section = {
          corpus,
          id: getAttr(record, "id") || "",
          citation,
          heading,
          text: normalize(bodyParts.join(" ")),
        };
        sections.push(section);
        if (onSection) {
          onSection(section, { level: styleName, record, bodyRecords, ancestors, levelNode: level });
        }
      }
    }

    // Recurse into nested levels. A LEVEL that is not body text and has a heading is an
    // ancestor of what it holds (a Title, Chapter, Subchapter, Article...).
    let inner = ancestors;
    if (onSection && styleName !== "Normal Level") {
      for (const record of records) {
        const heading = normalize(childrenByTag(record, "HEADING").map(extractText).join(""));
        if (heading) inner = [...inner, { level: styleName, record, heading }];
      }
    }
    collectSections(level, corpus, sections, onSection, inner);
  }
}

// A section-number token: starts with a digit, may contain letters and
// hyphens ("14-151", "10-110.1", "22-a"), and may carry one or more decimal
// suffixes ("11-602.1", "19-533.1.1"). A "." is only consumed when followed
// by another digit, so the sentence period after "§ 11-602. Definitions"
// terminates the token instead of truncating decimal sections.
const SECTION_NUMBER = String.raw`\d[\dA-Za-z-]*(?:\.\d[\dA-Za-z-]*)*`;

// A chapter or title number: a section-number token, which may start with one letter ("K1").
const CHAPTER_NUMBER = String.raw`[A-Za-z]?${SECTION_NUMBER}`;
// "Chapter 18-A: ..." / "Title 6: ..." at the START of the heading. Checked before "§": a
// chapter heading can name a section ("Chapter 51: ... Program (§ 421-a)"). Through 0.6.0 the
// chapter and title patterns were [\d-]+ and matched anywhere in the heading, so "Chapter 18-A"
// became "Chapter 18-", "Chapter 19.1" "Chapter 19", "D305 Light and air (MDL 3, Title 1)."
// "Title 1", and 19 Rules chapters whose heading names a section took that section's citation.
const LEADING_LABEL = new RegExp(`^(chapter|title)\\s+(${CHAPTER_NUMBER})`, "i");

// Pull the citation out of a heading string.
// e.g. "§ 11-602.1 Application of this subchapter." → "§ 11-602.1"
// e.g. "Section 259. Independent budget office." → "§ 259"
// e.g. "Chapter 11: Independent Budget Office" → "Chapter 11"
// e.g. "Chapter 18-A: Civilian Complaint Review Board" → "Chapter 18-A"
export function extractCitation(heading) {
  const leading = heading.match(LEADING_LABEL);
  if (leading) return `${leading[1].toLowerCase() === "title" ? "Title" : "Chapter"} ${leading[2]}`;
  // "§ 11-602.1 ..." / "§§ 27-2004 ..." (admin code & rules style)
  const symbolMatch = heading.match(new RegExp(`§§?\\s*(${SECTION_NUMBER})`));
  if (symbolMatch) return `§ ${symbolMatch[1]}`;
  // "Section 259. ..." (charter style, spelled out, no "§")
  const sectionMatch = heading.match(
    new RegExp(`[Ss]ection\\s+(${SECTION_NUMBER})`)
  );
  if (sectionMatch) return `§ ${sectionMatch[1]}`;
  return fallbackLabel(heading);
}

// A Local Law appendix record: "L.L. 2016/002" (the 2016 law numbered 2).
const LOCAL_LAW_LABEL = /^L\.\s?L\.\s*\d{4}\/\d+[A-Za-z]?/;
// A label with dots inside it: a letter or a section number, then one or more ".digit" parts:
// "G.1.2", "E.3", "1.0", "10-1104.1". "A. Glossary" is not one (no digit after the dot).
const DOTTED_LABEL = /^(?:[A-Z]|\d[\dA-Za-z-]*)(?:\.\d[\dA-Za-z-]*)+/;

// The citation for a heading with no §, Section, Chapter or Title: the text before a colon, cut
// at the first period. A period inside a label is not cut there (#49 review): before, "L.L.
// 2016/002" became "L" (1,883 Administrative Code records), "G.1.2 Certificate of fitness."
// became "G", "1.0 PURPOSE" became "1", and "10-1104.1 Civil cause…" became "10-1104". A period
// that ends a word still cuts: "Article 1. Authority." is "Article 1", "A. Glossary" is "A".
export function fallbackLabel(heading) {
  const head = heading.split(":")[0].trim();
  const localLaw = head.match(LOCAL_LAW_LABEL);
  if (localLaw) return localLaw[0].replace(/\s+/g, " ");
  const dotted = head.match(DOTTED_LABEL);
  if (dotted) return dotted[0];
  return head.split(".")[0].trim();
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
//
// `hooks` (optional, issue #61): { onDocument(documentNode), onSection(section, info) }, used by
// scripts/lib/build-structure.js to record the structure the index drops. See collectSections.
export function collectSectionsFromXml(xml, corpusKey, sections, onError, hooks = null) {
  const cleaned = xml.replace(/^﻿/, ""); // strip BOM
  let parsed;
  try {
    parsed = makeParser().parse(cleaned);
  } catch (e) {
    if (onError) onError(e);
    return false;
  }
  const doc = findDocument(parsed);
  if (hooks?.onDocument && doc) hooks.onDocument(doc);
  collectSections(doc, corpusKey, sections, hooks?.onSection ?? null);
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
