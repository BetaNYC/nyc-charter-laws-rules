// The site structure (issue #61): what a law page needs that the index's flat `text` drops.
//
// For every indexed section, in index order, the structure file records
//   - parents:  the Title, Chapter, Subchapter, Article... it sits in, outermost first, with
//               each one's heading. A file that starts at a Chapter has no Title wrapper, so its
//               Title is found from the publisher's anchor name for it (see assignTitles below);
//   - blocks:   the paragraphs that make up `text`, each as a [start, end) slice of `text`,
//               with its subdivision label ("a.", "(1)"), depth and anchor ("(b)(1)");
//   - links:    each cross-reference, as a [start, end) slice of `text` and its target.
//
// The text itself is not repeated: every offset points into the section's `text` in
// data/index/json/<corpus>.json, the file the MCP server answers from, and the structure file
// names that file's sha256. So the site and the MCP cannot disagree about a word: a structure
// file built from other text fails the check in test/structure.test.js.
//
// What the publisher's XML marks, and what is read from the text (checked 2026-11-22 against
// American Legal's bulk XML; the PR for #61 has the counts):
//   - Subdivisions are not elements. Each one is its own PARA; its depth is the number of
//     <TAB/> elements before the label, and the label ("a.", "(1)", "(i)") is a short text run
//     followed by another <TAB/>. Both come from the markup; nothing is guessed from wording.
//   - Cross-references are <LINK> elements: type "Jump" (same document, destination-id names a
//     <DESTINATION>), "Inter Infobase Jump" (another document, named by destination-name and
//     the document's .nfo file name), "Web" (url) and "Data" (an attached file).
//   - Editor's notes are PARAs styled "EdNote" or "EdNoteSm".
//   - History lines ("(Am. L.L. 2019/215, 12/11/2019, eff. 12/11/2019)") are plain PARAs with no
//     style. They are kept as ordinary text blocks here, not labeled: the markup does not say
//     what they are.
//   - Tables and pictures appear in the Administrative Code and the Rules only; a block holding
//     one says so (`table`, `picture`), and its text is the flattened text the index has.

import {
  tagOf,
  getAttr,
  childrenByTag,
  extractText,
  normalize,
} from "./extract-text.js";

export const STRUCTURE_FORMAT = 1;

// Two private-use characters that never occur in the source mark where a <LINK> starts and
// ends while its paragraph is flattened, so its position survives normalize().
const OPEN = "";
const CLOSE = "";

// The publisher's file names for each document (the .nfo in destination-infobase-uil).
const INFOBASE_CORPUS = { "charter.nfo": "charter", "admin.nfo": "admin_code", "rules.nfo": "rules" };

export function infobaseCorpus(uil) {
  const file = String(uil || "").split(/[\\/]/).pop().toLowerCase();
  return INFOBASE_CORPUS[file] ?? null;
}

// A subdivision label as the source writes it: "a.", "1.", "4-a.", "(a)", "(1)", "(iv)",
// "A)", or a bullet. It must be followed by a <TAB/> in the markup to count (labelOf).
const LABEL = /^(?:\(([0-9A-Za-z][0-9A-Za-z.-]{0,5})\)|([0-9A-Za-z][0-9A-Za-z-]{0,5})[.)]|•)$/;

// The anchor key for a label: "a." and "(a)" are both "a". A bullet has none.
export function labelKey(label) {
  const m = LABEL.exec(label);
  if (!m) return null;
  return m[1] ?? m[2] ?? null;
}

function isBlank(node) {
  return "#text" in node && !String(node["#text"]).trim();
}

// Depth and label of one PARA, read from its markup: the <TAB/> elements before the first
// text (their tab-count added up), then a label-shaped text run followed by a <TAB/>.
export function labelOf(para) {
  const kids = para[tagOf(para)];
  if (!Array.isArray(kids)) return { tabs: 0, label: null };
  let tabs = 0;
  let i = 0;
  for (; i < kids.length; i++) {
    if (isBlank(kids[i])) continue;
    if (tagOf(kids[i]) === "TAB") {
      tabs += Number(getAttr(kids[i], "tab-count")) || 1;
      continue;
    }
    break;
  }
  const first = kids[i];
  if (!first) return { tabs, label: null };
  // The label is a lone text run, or one wrapped in formatting (<CHARFORMAT bold>(a)</CHARFORMAT>).
  const raw = "#text" in first ? String(first["#text"]) : tagOf(first) === "CHARFORMAT" ? extractText(first) : null;
  if (raw === null) return { tabs, label: null };
  const label = normalize(raw);
  let j = i + 1;
  while (kids[j] && isBlank(kids[j])) j++;
  if (!LABEL.test(label) || !kids[j] || tagOf(kids[j]) !== "TAB") return { tabs, label: null };
  return { tabs, label };
}

// Copy an ordered node, putting OPEN and CLOSE inside each <LINK> and noting its attributes in
// `links`, in document order. The marks go inside the element, so the separator rules in
// extractText (which look at a node's siblings) see the same siblings as before.
function markLinks(node, links) {
  if (Array.isArray(node)) return node.map((n) => markLinks(n, links));
  if (!node || typeof node !== "object" || "#text" in node) return node;
  const tag = tagOf(node);
  if (!tag) return node;
  const kids = Array.isArray(node[tag]) ? node[tag] : [];
  if (tag === "LINK") {
    links.push(node[":@"] ?? {});
    return { ...node, [tag]: [{ "#text": OPEN }, ...markLinks(kids, links), { "#text": CLOSE }] };
  }
  return { ...node, [tag]: markLinks(kids, links) };
}

// Flatten a PARA the way the index does (normalize(extractText(p))) and find where each <LINK>
// landed in the result. Returns null spans when the marks moved the text in any way, so a link
// is never placed on the wrong words; the caller then keeps the paragraph without links.
export function paraWithLinks(para) {
  const plain = normalize(extractText(para));
  const attrs = [];
  const marked = normalize(extractText(markLinks(para, attrs)));
  const spans = [];
  const open = [];
  let out = "";
  for (const ch of marked) {
    if (ch === OPEN) {
      open.push(spans.length);
      spans.push({ start: out.length, end: -1 });
    } else if (ch === CLOSE) {
      const k = open.pop();
      if (k === undefined) return { text: plain, links: null };
      spans[k].end = out.length;
    } else if (/\s/.test(ch)) {
      if (out.length > 0 && !out.endsWith(" ")) out += " ";
    } else {
      out += ch;
    }
  }
  // A trailing space left by a mark at the very end ("word <CLOSE>").
  while (out.endsWith(" ")) out = out.slice(0, -1);
  if (out !== plain || open.length || spans.length !== attrs.length) return { text: plain, links: null };
  const links = [];
  spans.forEach((s, k) => {
    let { start, end } = s;
    end = Math.min(end, out.length);
    while (start < end && out[start] === " ") start++;
    while (end > start && out[end - 1] === " ") end--;
    if (end > start) links.push({ start, end, attrs: attrs[k] });
  });
  return { text: plain, links };
}

// The raw target of a <LINK>, before it is resolved to a section.
function linkTarget(attrs, corpus) {
  const a = (k) => attrs[`@_${k}`] ?? "";
  const type = a("type");
  if (type === "Web") return { kind: "web", url: a("url") };
  if (type === "Data") return { kind: "file", file: a("filename") || a("href") };
  if (type === "Inter Infobase Jump") {
    return { kind: "section", corpus: infobaseCorpus(a("destination-infobase-uil")), name: a("destination-name") };
  }
  return { kind: "section", corpus, destination: a("destination-id"), name: a("destination-name") };
}

// Every <DESTINATION> under a node, with the RECORD it sits in.
function collectDestinations(node, recordId, out) {
  if (Array.isArray(node)) {
    for (const n of node) collectDestinations(n, recordId, out);
    return;
  }
  if (!node || typeof node !== "object" || "#text" in node) return;
  const tag = tagOf(node);
  if (!tag) return;
  const rid = tag === "RECORD" ? getAttr(node, "id") : recordId;
  if (tag === "DESTINATION") out.push({ id: getAttr(node, "id"), name: getAttr(node, "name"), record: rid });
  collectDestinations(node[tag], rid, out);
}

// "Title 72: Office of Emergency Management" → "Title 72"; "Subchapter 1: [No Title]" →
// "Subchapter 1". The level's own word and number, read from the start of its heading.
const GROUP_LABEL = /^([A-Za-z]+)\s+([A-Za-z]?\d[\dA-Za-z-]*(?:\.\d[\dA-Za-z-]*)*)/;
export function groupLabel(heading) {
  const m = GROUP_LABEL.exec(heading);
  return m ? `${m[1][0].toUpperCase()}${m[1].slice(1).toLowerCase()} ${m[2]}` : null;
}

/**
 * Collects the structure of one corpus while build-corpus.js collects its sections. Pass
 * `collector.forFile({ root })` to collectSectionsFromXml for each file; then call `finish`.
 */
export function createStructureCollector(corpus) {
  const entries = []; // one per indexed section, in index order
  const groups = new Map(); // record id → { level, heading, label }
  const titles = []; // every Title record outside the root file: { id, heading, names }
  const destinations = []; // { id, name, record }
  const bodyRecordOf = new Map(); // body RECORD id → { entry, block }
  let resolved = null;

  function addGroup(level, record, heading) {
    const id = getAttr(record, "id");
    if (!groups.has(id)) {
      groups.set(id, { level, heading, label: groupLabel(heading) });
    }
    return id;
  }

  const collector = {
    // The hooks for one XML file, to pass to collectSectionsFromXml. `root` marks the
    // document's root file (0-0-0-1.xml), whose Title record is the whole document, not a
    // title in it.
    forFile({ root = false } = {}) {
      return {
        onDocument: (documentNode) => {
          collectDestinations(documentNode, null, destinations);
          if (!root) collectTitles(documentNode, titles);
        },
        onSection: (section, info) => collector.onSection(section, info),
      };
    },

    onSection(section, { level, record, bodyRecords, ancestors }) {
      const parents = ancestors.map((a) => addGroup(a.level, a.record, a.heading));
      if (level === "Chapter") addGroup(level, record, section.heading);
      const entry = { id: section.id, level, parents, blocks: [], links: [] };
      if (level === "Chapter") {
        const own = [];
        collectDestinations(record, null, own);
        entry.titleKey = own.map((d) => titleKeyOf(d.name)).find(Boolean) ?? null;
      }

      // Blocks: the non-empty paragraphs, which the index joins with one space.
      const paras = [];
      for (const r of bodyRecords) {
        for (const p of childrenByTag(r, "PARA")) paras.push({ p, record: getAttr(r, "id") });
      }
      const stack = []; // open subdivisions: { depth, key }
      const used = new Map(); // anchor → times used in this section
      const records = []; // [body RECORD id, its first block]
      let offset = 0;
      let ok = true;
      for (const { p, record: rid } of paras) {
        const { text, links } = paraWithLinks(p);
        if (!text) continue;
        const start = offset === 0 ? 0 : offset + 1;
        if (section.text.slice(start, start + text.length) !== text) {
          ok = false;
          break;
        }
        const style = getAttr(p, "style-name");
        const block = { start, end: start + text.length, type: "text" };
        if (style === "EdNote" || style === "EdNoteSm") {
          block.type = "note";
        } else {
          const { tabs, label } = labelOf(p);
          if (label) {
            const depth = Math.max(tabs, 1);
            block.type = "subdivision";
            block.depth = depth;
            block.label = label;
            while (stack.length && stack[stack.length - 1].depth >= depth) stack.pop();
            const key = labelKey(label);
            stack.push({ depth, key });
            if (key !== null) {
              const path = stack.filter((s) => s.key !== null).map((s) => `(${s.key})`).join("");
              const n = (used.get(path) ?? 0) + 1;
              used.set(path, n);
              block.anchor = n === 1 ? path : `${path}-${n}`;
            }
          } else if (tabs > 0) {
            block.depth = tabs;
          }
        }
        if (hasTag(p, "TABLE")) block.table = true;
        if (hasTag(p, "PICTURE")) block.picture = true;
        if (!records.some(([r]) => r === rid)) records.push([rid, block]);
        for (const l of links ?? []) {
          entry.links.push({ start: start + l.start, end: start + l.end, target: linkTarget(l.attrs, corpus) });
        }
        if (links === null) entry.unplacedLinks = (entry.unplacedLinks ?? 0) + countTag(p, "LINK");
        entry.blocks.push(block);
        offset = block.end;
      }
      if (!ok || offset !== section.text.length) {
        // The paragraphs do not slice `text` exactly; keep the section as one block, no links.
        entry.blocks = section.text ? [{ start: 0, end: section.text.length, type: "text" }] : [];
        entry.links = [];
        entry.flat = true;
        for (const r of records) r[1] = entry.blocks[0];
      }
      for (const [rid, block] of records) if (!bodyRecordOf.has(rid)) bodyRecordOf.set(rid, { entry, block });
      entries.push(entry);
    },

    /**
     * Finish after every file: name each section's Title, resolve link targets (pass the
     * other corpora's collectors as `others` to resolve links into them), and return the
     * structure file's object for `sections`, the index records built alongside.
     */
    finish(sections, indexSha256, others = {}) {
      if (sections.length !== entries.length || sections.some((s, i) => s.id !== entries[i].id)) {
        throw new Error(`structure for ${corpus} does not line up with its index (${entries.length} vs ${sections.length} records)`);
      }
      const titleStats = assignTitles(entries, groups, titles);
      const resolvers = { [corpus]: collector.resolver(), ...Object.fromEntries(Object.entries(others).map(([k, c]) => [k, c.resolver()])) };
      const out = entries.map((e) => {
        const s = { id: e.id, level: e.level, parents: e.parents, blocks: e.blocks };
        if (e.links.length) s.links = e.links.map((l) => ({ start: l.start, end: l.end, to: resolveTarget(l.target, resolvers) }));
        if (e.flat) s.flat = true;
        if (e.unplacedLinks) s.unplacedLinks = e.unplacedLinks;
        return s;
      });
      const usedGroups = new Set(entries.flatMap((e) => e.parents));
      return {
        format: STRUCTURE_FORMAT,
        corpus,
        indexSha256,
        sectionCount: sections.length,
        titleStats,
        groups: Object.fromEntries(
          [...groups].filter(([id]) => usedGroups.has(id)).map(([id, g]) => [id, { level: g.level, label: g.label, heading: g.heading }])
        ),
        sections: out,
      };
    },

    // Where a DESTINATION id or name points in this corpus: the indexed section, and the
    // subdivision when it is in one; or a Title, Chapter or other heading that is not a
    // section. Call it only after every file is read (finish does).
    resolver() {
      if (resolved) return resolved;
      const sectionIds = new Set(entries.map((e) => e.id));
      const titleIds = new Set(titles.map((t) => t.id));
      const where = (d) => {
        if (sectionIds.has(d.record)) return { id: d.record };
        const b = bodyRecordOf.get(d.record);
        if (b) return b.block.anchor ? { id: b.entry.id, anchor: b.block.anchor } : { id: b.entry.id };
        if (groups.has(d.record) || titleIds.has(d.record)) return { id: d.record, group: true };
        return null;
      };
      const byId = new Map();
      const byName = new Map();
      for (const d of destinations) {
        const w = where(d);
        if (!w) continue;
        byId.set(d.id, w);
        // A name used twice is ambiguous: keep neither (counted in the PR, 2026-11-22).
        byName.set(d.name, byName.has(d.name) ? null : w);
      }
      resolved = { byId, byName };
      return resolved;
    },
  };
  return collector;
}

function hasTag(node, tag) {
  return countTag(node, tag) > 0;
}

function countTag(node, tag) {
  if (Array.isArray(node)) return node.reduce((n, k) => n + countTag(k, tag), 0);
  if (!node || typeof node !== "object" || "#text" in node) return 0;
  const t = tagOf(node);
  if (!t) return 0;
  return (t === tag ? 1 : 0) + countTag(node[t], tag);
}

function resolveTarget(t, resolvers) {
  if (t.kind !== "section") return t;
  const out = { corpus: t.corpus, name: t.name };
  const r = t.corpus ? resolvers[t.corpus] : null;
  if (!r) return { ...out, resolved: false };
  const hit = (t.destination && t.destination !== "0-0-0-0" && r.byId.get(t.destination)) || r.byName.get(t.name) || null;
  if (!hit) return { ...out, resolved: false };
  return { ...out, ...hit };
}

// A file that starts at a Chapter has no Title record around it: the publisher puts a Title's
// record only in the file of its first chapter. But the publisher names each chapter's anchor
// for its title and number: the <DESTINATION> on "Chapter 7: Fire-Resistant Rated Construction"
// in the Rules is named "T03C007" (Title 3, Chapter 7), and the Administrative Code's Title 16-B
// chapters are "T16-bC001". A Title record's own anchor is "T16-b" (Administrative Code) or
// "Title 38A" (Rules), and its heading starts "Title 38-A". So a chapter's title is the Title
// record whose key matches. Where nothing matches, the chapter is left without a title rather
// than guessed (counted in `titleStats`).
//
// Record numbers (RECORD `number`) are not used: tried 2026-11-22, a chapter's Title is not
// always the last Title numbered before it (113 of 726 Rules chapters with a key disagreed).
const CHAPTER_KEY = /^T(\d+(?:-?[A-Za-z])?)(?:C|App)/i;
const TITLE_KEY = /^(?:T|Title\s+)(\d+(?:-?[A-Za-z])?)$/i;

export function titleKeyOf(name) {
  const m = CHAPTER_KEY.exec(String(name ?? ""));
  return m ? normalizeTitleKey(m[1]) : null;
}

// "03", "3" → "3"; "16-b", "16B" → "16B".
export function normalizeTitleKey(k) {
  return String(k).replace(/-/g, "").replace(/^0+(?=\d)/, "").toUpperCase();
}

// Every Title LEVEL's record in a file, with the keys it can be found by: its own anchor
// names ("T16-b", "Title 38A") and its heading's number ("Title 38-A: ..." → "38A").
function collectTitles(node, out) {
  for (const level of childrenByTag(node, "LEVEL")) {
    if (getAttr(level, "style-name") === "Title") {
      for (const record of childrenByTag(level, "RECORD")) {
        const heading = normalize(childrenByTag(record, "HEADING").map(extractText).join(""));
        const own = [];
        collectDestinations(record, null, own);
        const keys = new Set();
        for (const d of own) {
          const m = TITLE_KEY.exec(d.name);
          if (m) keys.add(normalizeTitleKey(m[1]));
        }
        const label = groupLabel(heading);
        if (label?.startsWith("Title ")) keys.add(normalizeTitleKey(label.slice(6)));
        out.push({ id: getAttr(record, "id"), record, heading, keys });
      }
    }
    collectTitles(level, out);
  }
}

function assignTitles(entries, groups, titles) {
  const stats = { fromFile: 0, fromKey: 0, none: 0, keyDisagrees: 0 };
  const byKey = new Map();
  for (const t of titles) for (const k of t.keys) byKey.set(k, byKey.has(k) && byKey.get(k).id !== t.id ? null : t);
  const isTitle = (id) => groups.get(id)?.level === "Title";
  // A chapter's title, then each section takes its chapter's.
  const chapterTitle = new Map();
  for (const e of entries) {
    if (e.level !== "Chapter") continue;
    const inFile = e.parents.find(isTitle) ?? null;
    const t = e.titleKey ? byKey.get(e.titleKey) ?? null : null;
    if (inFile) {
      stats.fromFile++;
      if (t && t.id !== inFile) stats.keyDisagrees++;
      chapterTitle.set(e.id, null);
    } else if (t) {
      stats.fromKey++;
      if (!groups.has(t.id)) groups.set(t.id, { level: "Title", heading: t.heading, label: groupLabel(t.heading) });
      chapterTitle.set(e.id, t.id);
      e.parents = [t.id, ...e.parents];
    } else {
      stats.none++;
      chapterTitle.set(e.id, null);
    }
  }
  for (const e of entries) {
    if (e.level === "Chapter" || e.parents.some(isTitle)) continue;
    const chapter = e.parents.find((id) => chapterTitle.has(id));
    const t = chapter ? chapterTitle.get(chapter) : null;
    if (t) e.parents = [t, ...e.parents];
  }
  return stats;
}

// The structure file's text: valid JSON, one group and one section per line, so a refresh's
// git diff shows which sections changed (one long line would hide it, and indenting every
// block would triple the size).
export function structureJson(structure) {
  const { groups, sections, ...head } = structure;
  const lines = ["{"];
  for (const [k, v] of Object.entries(head)) lines.push(`  ${JSON.stringify(k)}: ${JSON.stringify(v)},`);
  const g = Object.entries(groups);
  lines.push(`  "groups": {${g.length ? "" : "},"}`);
  g.forEach(([id, v], i) => lines.push(`    ${JSON.stringify(id)}: ${JSON.stringify(v)}${i < g.length - 1 ? "," : ""}`));
  if (g.length) lines.push("  },");
  lines.push(`  "sections": [${sections.length ? "" : "]"}`);
  sections.forEach((s, i) => lines.push(`    ${JSON.stringify(s)}${i < sections.length - 1 ? "," : ""}`));
  if (sections.length) lines.push("  ]");
  lines.push("}");
  return lines.join("\n") + "\n";
}
