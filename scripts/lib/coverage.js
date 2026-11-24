// Index coverage (issue #78): where every word of the publisher's XML ends up.
//
// One XML file is read the way the index reads it (collectSectionsFromXml), and every text node
// the builder used is marked, by object identity: a record's heading, and each paragraph or
// heading line in its text. Then every text node in the file is visited, at any depth, and is
// either used, or dropped with a reason:
//
//   repeat         a record's own PARA that repeats its HEADING, or a Subsection's HEADING or
//                  PARA when the other copy was kept: the same characters are in the index
//                  (spaces and case aside). Left out on purpose.
//   group heading  the HEADING of a group level (Title, Subchapter, Article, Part...) with no
//                  text of its own. Not an index record by design; the site's structure has it.
//   title          text held by a Title level: front matter in each document's root file
//                  ("Published by: American Legal Publishing"), and a few editor's notes. The
//                  index has no Title records.
//   unread         anything else: law text the index does not have. Each one is a bug to fix,
//                  and the reason names where it sits ("Normal Level in Appendix").
//
// `twice` counts text nodes read into the text of two records; it must be 0.
//
// Characters are counted without whitespace, after entities are decoded and American Legal's
// "[ALP S-nnn]" edit markers removed (normalize() removes them from the index too).
// Pictures have no text in the XML, so they are counted apart, not as dropped text.
//
// Pure: no I/O. scripts/audit-coverage.js reads data/raw and prints the report;
// test/group-records.test.js runs it over every XML fixture in the repo.

import { collectSectionsFromXml, recordHeading } from "./build-corpus.js";
import { tagOf, getAttr, childrenByTag, extractText, normalize, decodeEntities, stripAlpMarkers } from "./extract-text.js";

export const EXPECTED_REASONS = new Set(["repeat", "group heading", "title"]);

const nonws = (s) => s.replace(/\s+/g, "").length;
const squash = (s) => normalize(s).replace(/\s+/g, "").toLowerCase();
const isText = (n) => n && typeof n === "object" && "#text" in n;
const styleOf = (level) => getAttr(level, "style-name") || "";
const headingText = (record) => normalize(childrenByTag(record, "HEADING").map(extractText).join(""));

function eachText(node, fn) {
  if (Array.isArray(node)) return node.forEach((n) => eachText(n, fn));
  if (!node || typeof node !== "object") return;
  if ("#text" in node) return fn(node);
  const t = tagOf(node);
  if (t) eachText(node[t], fn);
}

function countTag(node, tag) {
  if (Array.isArray(node)) return node.reduce((n, k) => n + countTag(k, tag), 0);
  if (!node || typeof node !== "object" || "#text" in node) return 0;
  const t = tagOf(node);
  if (!t) return 0;
  return (t === tag ? 1 : 0) + countTag(node[t], tag);
}

/** A new, empty tally for one book. */
export function emptyTally() {
  return { files: 0, records: 0, chars: 0, alpChars: 0, text: 0, heading: 0, twice: 0, dropped: { repeat: 0, "group heading": 0, title: 0, unread: 0 }, pictures: { indexed: 0, dropped: 0 }, unread: [] };
}

/**
 * Account for one XML file. Adds to `tally` (emptyTally()) and returns it. `file` names the file
 * in the list of unread text.
 */
export function coverFile(xml, corpus, file, tally = emptyTally()) {
  const sections = [];
  let doc = null;
  const used = new Map(); // text node → "text" | "heading"
  const keptFor = new Map(); // RECORD → what the index kept from it, squashed
  // A text node read into two records' text is counted in `twice`: no record may take text another
  // record has (a group record and a section inside it, say).
  const inText = new Set();
  const mark = (node, kind) =>
    eachText(node, (t) => {
      if (kind === "text") {
        if (inText.has(t) && nonws(String(t["#text"]))) tally.twice++;
        inText.add(t);
      }
      if (!used.has(t) || kind === "text") used.set(t, kind);
    });
  const keep = (record, text) => keptFor.set(record, (keptFor.get(record) ?? "") + squash(text));
  // A record's heading: its HEADING, or its PARA when recordHeading took that (issue #78).
  const markHeading = (record, kind) => {
    const fromPara = recordHeading(record) !== headingText(record);
    mark(childrenByTag(record, fromPara ? "PARA" : "HEADING"), kind);
    keep(record, recordHeading(record));
  };
  const ok = collectSectionsFromXml(xml, corpus, sections, null, {
    onDocument: (d) => { doc = d; },
    onSection: (s, info) => {
      markHeading(info.record, "heading");
      for (const part of info.parts) {
        if (part.para) {
          mark(part.para, "text");
          keep(part.record, part.text);
        } else if (part.subsection) {
          mark(childrenByTag(part.record, "HEADING"), "text");
          keep(part.record, part.text);
        } else {
          markHeading(part.record, "text");
        }
      }
    },
  });
  if (!ok || !doc) throw new Error(`${file}: the XML does not parse`);
  tally.files++;
  tally.records += sections.length;

  // Every text node, with the levels above it.
  const levels = [];
  const walk = (node, record, part) => {
    if (Array.isArray(node)) return node.forEach((n) => walk(n, record, part));
    if (!node || typeof node !== "object") return;
    if (isText(node)) {
      const raw = decodeEntities(String(node["#text"]));
      const clean = stripAlpMarkers(raw);
      const c = nonws(clean);
      tally.alpChars += nonws(raw) - c;
      if (!c) return;
      tally.chars += c;
      const kind = used.get(node);
      if (kind) {
        tally[kind] += c;
        return;
      }
      const reason = classify(levels, record, part, clean, keptFor);
      tally.dropped[reason.kind] += c;
      if (reason.kind === "unread") {
        tally.unread.push({ file, record: record ? getAttr(record, "id") : null, where: reason.where, chars: c, text: normalize(clean) });
      }
      return;
    }
    const tag = tagOf(node);
    if (!tag) return;
    if (tag === "PICTURE") tally.pictures[record && keptFor.has(record) ? "indexed" : "dropped"]++;
    if (tag === "LEVEL") {
      levels.push(node);
      walk(node[tag], null, null);
      levels.pop();
      return;
    }
    if (tag === "RECORD") return walk(node[tag], node, null);
    walk(node[tag], record, part ?? (record ? tag : null));
  };
  walk(doc, null, null);
  return tally;
}

function classify(levels, record, part, text, keptFor) {
  const level = levels.at(-1);
  const style = level ? styleOf(level) : "";
  const chain = levels.map(styleOf);
  const own = record ? style : null;
  if (record && keptFor.has(record) && keptFor.get(record).includes(squash(text))) return { kind: "repeat" };
  // A group level's HEADING, or its PARA when that repeats the HEADING (it always does in July 2026).
  if (record && !["Section", "Chapter", "Subsection", "Normal Level"].includes(style)) {
    if (part === "HEADING" || (part === "PARA" && squash(headingText(record)).includes(squash(text)))) return { kind: "group heading" };
  }
  // Held by a Title level itself: front matter and title notes.
  if (own === "Title" || (own === "Normal Level" && chain.at(-2) === "Title")) return { kind: "title" };
  const holder = own === "Normal Level" ? chain.at(-2) ?? "(document)" : own ?? "(document)";
  const what = !record ? "text outside any RECORD" : own === "Normal Level" ? "Normal Level" : `${part ?? "RECORD"} of a ${own} record`;
  return { kind: "unread", where: `${what} in ${holder} (${chain.join(" > ")})` };
}

/** Percentages for a tally: indexed share of all text, and of the text once repeats are taken out. */
export function percentages(t) {
  const indexed = t.text + t.heading;
  const net = t.chars - t.dropped.repeat;
  return {
    indexed: t.chars ? (100 * indexed) / t.chars : 100,
    indexedNet: net ? (100 * indexed) / net : 100,
    unreadNet: net ? (100 * t.dropped.unread) / net : 0,
  };
}
