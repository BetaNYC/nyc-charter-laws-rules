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

const styleOf = (level) => getAttr(level, "style-name") || "";
const headingOf = (record) => normalize(childrenByTag(record, "HEADING").map(extractText).join(""));
const squash = (s) => s.replace(/\s+/g, "");

function hasLink(node) {
  if (Array.isArray(node)) return node.some(hasLink);
  if (!node || typeof node !== "object" || "#text" in node) return false;
  const tag = tagOf(node);
  return tag === "LINK" || (tag ? hasLink(node[tag]) : false);
}

// The body of a Chapter or Section level (issue #76): its child levels in document order.
//   - A "Normal Level" child gives each PARA of its RECORDs, as the index always read it.
//   - A "Subsection" child (the Construction Codes in Title 28 of the Administrative Code, and
//     90 Rules sections, keep most of a section's text in them) gives its heading line, then
//     the PARAs of its own "Normal Level" children.
// Every other child level is skipped: a Section or Chapter inside is indexed on its own, and a
// Subchapter, Article... holds sections. A level inside a Subsection that is not a "Normal Level"
// is not read; it is returned in `unread` so the structure can count it (none in July 2026).
//
// A Subsection's RECORD has a HEADING ("80.1 Title.") and, in July 2026, one PARA that repeats
// it. Its heading line is chosen so nothing is lost and nothing is said twice:
//   - the HEADING, when the PARAs say the same characters (spaces aside: 81.2.2 vs "81. 2.2"),
//     or only the start of it ("705.2" under "705.2 ABS plastic."), and hold no
//     cross-reference: the publisher's heading is the clean copy;
//   - the PARAs, when the HEADING is empty (19 in the Administrative Code) or the PARAs start
//     with it and say more ("705.2" vs "705.2 ABS plastic."), or hold a cross-reference (23):
//     they are what the publisher's page shows, links included;
//   - otherwise (none in July 2026) both: the HEADING as the heading line, then the PARAs as
//     ordinary paragraphs (and a PARA with a cross-reference that is only the start of a longer
//     HEADING: the link is kept, at the cost of the number twice).
//
// Returns { parts, unread }. Each part is { kind: "para" | "subheading", text, para?, record,
// subsection? }: `text` is what goes into the index's `text`, in order; `para` is the PARA it
// was read from, if any; `subsection` is the Subsection LEVEL it came from, if any.
export function readBody(level) {
  const parts = [];
  const unread = [];
  for (const child of childrenByTag(level, "LEVEL")) readBodyLevel(child, parts, unread);
  return { parts, unread };
}

// One child level of a body, for readBody and readGroupBody: a "Normal Level" or a "Subsection"
// is read into `parts` (see readBody); any other level is left alone. Returns true when read.
function readBodyLevel(child, parts, unread) {
  const style = styleOf(child);
  if (style === "Normal Level") {
    readNormalLevel(child, null, parts);
    return true;
  }
  if (style !== "Subsection") return false;
  for (const record of childrenByTag(child, "RECORD")) {
    const heading = headingOf(record);
    const paras = childrenByTag(record, "PARA").filter((p) => normalize(extractText(p)));
    const said = normalize(paras.map((p) => normalize(extractText(p))).join(" "));
    const headingPart = { kind: "subheading", text: heading, record, subsection: child };
    if (!said) {
      if (heading) parts.push(headingPart);
    } else if (heading && squash(heading).startsWith(squash(said)) && !hasLink(paras)) {
      // The same characters, or the HEADING says more ("705.2 ABS plastic." over a PARA
      // of "705.2"): the HEADING alone, so the number is not said twice.
      parts.push(headingPart);
    } else if (!heading || squash(said).startsWith(squash(heading))) {
      parts.push(paraPart(paras[0], record, child, "subheading"));
      for (const p of paras.slice(1)) parts.push(paraPart(p, record, child));
    } else {
      parts.push(headingPart);
      for (const p of paras) parts.push(paraPart(p, record, child));
    }
  }
  for (const inner of childrenByTag(child, "LEVEL")) {
    if (styleOf(inner) === "Normal Level") readNormalLevel(inner, child, parts);
    else unread.push(inner);
  }
  return true;
}

function paraPart(para, record, subsection, kind = "para") {
  const part = { kind, text: normalize(extractText(para)), para, record };
  if (subsection) part.subsection = subsection;
  return part;
}

function readNormalLevel(level, subsection, parts) {
  for (const record of childrenByTag(level, "RECORD")) {
    for (const para of childrenByTag(record, "PARA")) parts.push(paraPart(para, record, subsection));
  }
}

// A record's heading (issue #78). The HEADING, unless the record's own PARA says more: when the
// HEADING is empty (Building Code § BC 602, whose PARA is "Section BC 602: Construction
// Classification"), or when the PARA starts with the HEADING and goes on ("§ 21-905" over a PARA
// of "§ 21-905 Demographic data of the juvenile justice system."), the PARA is the heading. In
// July 2026 those are the only two Section or Chapter records whose PARA says anything their
// HEADING does not; every other PARA repeats its HEADING, and is left out of the index for that.
export function recordHeading(record) {
  const heading = headingOf(record);
  const para = normalize(childrenByTag(record, "PARA").map((p) => normalize(extractText(p))).join(" "));
  if (!para) return heading;
  if (!heading) return para;
  if (para.length > heading.length && para.startsWith(heading) && /^[\s.:;,]/.test(para.slice(heading.length))) return para;
  return heading;
}

// ---------------------------------------------------------------------------------------------
// Group records (issue #78). The publisher's group levels (Subchapter, Article, Part, Appendix,
// Subarticle...) normally hold sections, but some hold text of their own, in "Normal Level"
// children: the Title 27 Building Code Reference Standards (RS 2-1 to RS 19-3), the Rules'
// appendices and schedules, the Water Board's rate schedule, editor's notes. A group level that
// holds text of its own is indexed as a record, after the levels around it and before the
// sections inside it, in document order:
//   - id: its RECORD's id; heading: its heading (recordHeading); level: its style ("Appendix").
//     (A chapter record's level is "Chapter"; only a section inside a chapter has none.)
//   - text: readGroupBody. Its own "Normal Level" and "Subsection" children as a section's body
//     (readBody); the body of any level with no RECORD inside it (the Health Code's Board of
//     Health resolutions sit in a "Section" level with no RECORD, under "Resolutions"); and a
//     child group level whose heading has no number and that holds no section (the "CONTENTS"
//     of a reference standard), as a subheading and its own body. A Section, a Chapter, and a
//     group level with a number or with sections inside are indexed on their own, so a group
//     record never takes text another record has.
//   - citation: groupCitation.
// A Title is not a group record: the index has no Title records. The text held at Title level
// is front matter in each document's root file, and editor's notes and amendment lines on a
// title (July 2026: 7 in the Administrative Code, 4 in the Rules). npm run audit:coverage counts it.

const NOT_GROUP = new Set(["", "Section", "Chapter", "Subsection", "Normal Level", "Title"]);
export const isGroupStyle = (style) => !NOT_GROUP.has(style);

// The words a group heading's label starts with, and the number after it: "Subchapter 3",
// "Appendix A-1", "Appendix 18-A", "Part I", "RULE I", "Chapter D5", "Schedule A",
// "Subchapter 14.1", "Appendix 1A".
const GROUP_WORDS = new Set([
  "appendix", "article", "chapter", "exhibit", "form", "part", "regulation", "rule", "schedule",
  "section", "subarticle", "subchapter", "subpart", "subtitle", "table", "title",
]);
const DASH = "[-\u2013\u2014]";
const GROUP_NUMBER = [
  `\\d[\\dA-Za-z]*(?:(?:\\.|${DASH})[\\dA-Za-z]+)*`, // 3, 14.1, 18-A, 1A
  `[A-Za-z]{1,2}\\d[\\dA-Za-z]*(?:(?:\\.|${DASH})[\\dA-Za-z]+)*`, // D5
  `[A-Z]${DASH}\\d+[A-Za-z]?`, // A-1
  "[IVXLC]+", // I, II
  "[A-Z]", // A
].join("|");
const GROUP_LABEL = new RegExp(`^([A-Za-z]+)\\s+(${GROUP_NUMBER})(?=$|[\\s:.,;*()\\[\\]]|${DASH})`);
// "REFERENCE STANDARD RS 18–1", "REFERENCE STANDARD RS 5–1C MISCELLANEOUS...", and twice without
// the "RS" ("REFERENCE STANDARD 10–5B"). A bracketed letter is part of the number ("RS 15–8[A]").
const REFERENCE_STANDARD = new RegExp(
  `^REFERENCE STANDARD\\s+(?:RS\\s*)?(\\d+(?:\\s*${DASH}\\s*\\d+[A-Za-z]?)?(?:\\[[A-Za-z]\\])?)(?=$|[\\s:.,;*])`,
  "i"
);

/**
 * The label a group heading starts with, or null when it has none: "REFERENCE STANDARD RS 18–1"
 * → "RS 18-1" (the code's own name for a reference standard), "Appendix A-1: Standards for..."
 * → "Appendix A-1", "RULE I - DEFINITIONS" → "Rule I", "CHAPTER 1 – GENERAL" → "Chapter 1".
 * Dashes become hyphens, so "RS 18-1" can be typed. "CONTENTS", "Introduction" and
 * "Resolutions" have none.
 */
export function groupLabel(heading) {
  const h = String(heading ?? "").trim();
  const rs = REFERENCE_STANDARD.exec(h);
  if (rs) return { label: `RS ${rs[1].replace(new RegExp(`\\s*${DASH}\\s*`), "-")}`, standard: true };
  const m = GROUP_LABEL.exec(h);
  if (!m || !GROUP_WORDS.has(m[1].toLowerCase())) return null;
  const word = m[1][0].toUpperCase() + m[1].slice(1).toLowerCase();
  return { label: `${word} ${m[2].replace(new RegExp(DASH, "g"), "-")}`, standard: false };
}

/**
 * A group record's citation (issue #78, review fix): the numbered levels above it, then its own
 * label, as a chapter carries its title: "Title 20, Chapter 2, Subchapter 3", "Title 15, Chapter
 * 42, Appendix A, Part I", "Title 27, Chapter 1, Subchapter 4, Article 8". Each publisher's
 * number repeats from chapter to chapter (ten Administrative Code chapters have a "Subchapter
 * 3"), so the label alone would name ten records. `chain` is those numbered levels, outermost
 * first (collectSections keeps it). A reference standard's number is the code's own name for it
 * and unique in it, so it stands alone ("RS 18-1"), and the levels inside one are named from it
 * ("RS 13-1, Chapter 1"). A heading with no label goes after the chain whole ("Title 15, Chapter
 * 20, Appendix"), without a closing period. Only where the publisher repeats a number inside one
 * chapter (its "two subchapters designated as Subchapter 3") do two records share a citation.
 */
export function groupCitation(heading, chain = []) {
  const l = groupLabel(heading);
  if (l?.standard) return l.label;
  const own = l ? l.label : heading.replace(/\.$/, "").trim();
  return [...chain, own].join(", ");
}

// The label a level adds to the chain its group records are named from, or null.
function chainLabel(style, heading) {
  if (style === "Title") {
    const m = heading.match(LEADING_LABEL);
    return m && m[1].toLowerCase() === "title" ? `Title ${m[2]}` : null;
  }
  return groupLabel(heading);
}

// "T20C002" (Administrative Code, Title 20, Chapter 2), "T16-bC001", "T03C007" (Rules): the
// title the publisher's anchor name gives a chapter, for a chapter file with no Title record
// around it (as build-structure.js assignTitles reads it). "20", "16-B", "3"; or null.
const CHAPTER_ANCHOR = /^T(\d+(?:-?[A-Za-z])?)(?:C|App)/i;
function anchorTitle(node) {
  if (Array.isArray(node)) {
    for (const n of node) {
      const t = anchorTitle(n);
      if (t) return t;
    }
    return null;
  }
  if (!node || typeof node !== "object" || "#text" in node) return null;
  const tag = tagOf(node);
  if (tag === "DESTINATION") {
    const m = CHAPTER_ANCHOR.exec(getAttr(node, "name"));
    if (m) return m[1].replace(/^0+(?=\d)/, "").toUpperCase();
  }
  return tag ? anchorTitle(node[tag]) : null;
}

// A level indexed on its own: a Section or Chapter with a RECORD.
const indexedOnItsOwn = (level) => ["Section", "Chapter"].includes(styleOf(level)) && childrenByTag(level, "RECORD").length > 0;
// The RECORD that names a level: its first with a heading.
const namingRecord = (level) => childrenByTag(level, "RECORD").find((r) => recordHeading(r)) ?? null;

function holdsIndexed(level) {
  return childrenByTag(level, "LEVEL").some((c) => indexedOnItsOwn(c) || holdsIndexed(c));
}

/**
 * A group level's own body (see "Group records" above): { parts, unread, merged }. `merged` holds
 * the child group levels read into it, which are not indexed again. A part read from a merged
 * level's heading is { kind: "subheading", text, record } with no PARA.
 */
export function readGroupBody(level) {
  const parts = [];
  const unread = [];
  const merged = [];
  const walk = (node) => {
    for (const child of childrenByTag(node, "LEVEL")) {
      if (readBodyLevel(child, parts, unread)) continue;
      if (indexedOnItsOwn(child)) continue;
      const record = namingRecord(child);
      if (!record) {
        // No RECORD: not a level of its own (a wrapper the publisher puts around Sections, or the
        // Health Code's "Section" around its resolutions). Its body is this level's.
        walk(child);
        continue;
      }
      const heading = recordHeading(record);
      if (isGroupStyle(styleOf(child)) && !groupLabel(heading) && !holdsIndexed(child)) {
        merged.push(child);
        parts.push({ kind: "subheading", text: heading, record });
        walk(child);
      }
    }
  };
  walk(level);
  return { parts, unread, merged };
}

// Walk the LEVEL tree and collect sections.
// `node` is an ordered element object (DOCUMENT, then each LEVEL as we recurse).
//
// `onSection` (optional, issue #61) is called once per indexed section, right after it is
// pushed, with what the site structure needs and the index drops: the LEVEL style, the heading
// RECORD, the body `parts` that make up `text` and the levels inside a Subsection that were not
// read (`unread`; see readBody), the enclosing LEVELs that carry a heading (outermost first), and
// the section's own LEVEL (`levelNode`). It is only told about a section: it cannot change one,
// so the index is the same with or without it (test/structure.test.js checks this byte for byte).
// `ancestors` is the recursion's own state; callers leave it out.
export function collectSections(node, corpus, sections, onSection = null, ancestors = [], state = { merged: new WeakSet(), chain: [], inChapter: false }) {
  if (!node) return;

  const levels = childrenByTag(node, "LEVEL");
  for (const level of levels) {
    const styleName = getAttr(level, "style-name") || "";
    const records = childrenByTag(level, "RECORD");
    // What the levels inside this one are named from (groupCitation), and whether they sit in a chapter.
    let chain = state.chain;
    let inChapter = state.inChapter;

    if (styleName === "Section" || styleName === "Chapter") {
      for (const record of records) {
        const heading = recordHeading(record);
        if (!heading) continue;

        // Only index Chapter and Section level records with real headings.
        if (heading.length > 3) {
          // The body, in document order: Normal Level paragraphs, and each Subsection's heading
          // line and paragraphs (readBody). A section with no Subsection gets exactly the text it
          // always had: its Normal Level PARAs, in order, joined with one space.
          const { parts, unread } = readBody(level);

          const citation = extractCitation(heading);
          const section = {
            corpus,
            id: getAttr(record, "id") || "",
            citation,
            heading,
            text: normalize(parts.map((p) => p.text).join(" ")),
          };
          // `level` (review of #78): left out only for a section inside a chapter, nearly every
          // record. A chapter says so, and so does a section with no chapter around it in its
          // file (the Administrative Code's Title 31), so get_title can tell where a chapter
          // ends even when its heading has no number (src/corpus.ts chapterGroups).
          if (styleName === "Chapter") section.level = "Chapter";
          else if (!state.inChapter) section.level = "Section";
          sections.push(section);
          if (onSection) {
            onSection(section, { level: styleName, record, parts, unread, ancestors, levelNode: level });
          }
          if (styleName === "Chapter" && !inChapter) {
            const title = state.chain.find((c) => c.startsWith("Title ")) ?? (anchorTitle(record) ? `Title ${anchorTitle(record)}` : null);
            chain = [...(title ? [title] : []), citation];
            inChapter = true;
          }
        }
      }
    } else if (isGroupStyle(styleName) && !state.merged.has(level)) {
      // A group level with text of its own (issue #78): see "Group records" above.
      const record = namingRecord(level);
      const { parts, unread, merged } = record ? readGroupBody(level) : { parts: [] };
      const text = normalize(parts.map((p) => p.text).join(" "));
      if (record && text) {
        for (const m of merged) state.merged.add(m);
        const heading = recordHeading(record);
        const section = { corpus, id: getAttr(record, "id") || "", citation: groupCitation(heading, state.chain), heading, text, level: styleName };
        sections.push(section);
        if (onSection) {
          onSection(section, { level: styleName, record, parts, unread, ancestors, levelNode: level });
        }
      }
    }
    // A numbered level names what is inside it: a title, or a group level ("Subchapter 4"),
    // whether or not it is a record. A reference standard starts the chain over.
    if (styleName === "Title" || isGroupStyle(styleName)) {
      const record = namingRecord(level);
      const label = record ? chainLabel(styleName, recordHeading(record)) : null;
      if (label?.standard) chain = [label.label];
      else if (label) chain = styleName === "Title" ? [label] : [...chain, label.label];
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
    collectSections(level, corpus, sections, onSection, inner, { merged: state.merged, chain, inChapter });
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
