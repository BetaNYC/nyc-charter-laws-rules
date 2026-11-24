// The site structure (issue #61): what a law page needs that the index's flat `text` drops.
//
// For every indexed record, in index order (a section, a chapter, or since issue #78 a group
// level's own text, such as a reference standard or an appendix: see build-corpus.js), the
// structure file records
//   - level:    the publisher's level for it ("Section", "Chapter", "Appendix", "Part"...);
//   - parents:  the Title, Chapter, Subchapter, Article... it sits in, outermost first, with
//               each one's heading. A file that starts at a Chapter has no Title wrapper, so its
//               Title is found from the publisher's anchor name for it (see assignTitles below);
//   - blocks:   the paragraphs that make up `text`, each as a [start, end) slice of `text`,
//               with its subdivision label ("a.", "(1)"), depth and anchor ("(b)(1)"); a
//               Subsection's heading line ("102.4 Smoking.") is a block of type "subheading"
//               anchored at its number ("102.4"), and the subdivisions under it are anchored
//               under that number ("102.4(1)");
//   - links:    each cross-reference, as a [start, end) slice of `text` and its target;
//   - marks:    the publisher's bold and italic runs (issue #78 follow-up), each [start, end,
//               "b" | "i" | "bi"], a slice of `text` (left out when none). Display only;
//               see paraFormatting;
//   - pictures:    how many <PICTURE> elements the section has (left out when none). A picture
//                  has no text, so the index cannot show it; the site says so and links to the
//                  section's page at American Legal Publishing.
//   - subsections: how many levels inside the section the index does not read (left out when
//                  none). Since issue #76 the index reads the Construction Codes' "Subsection"
//                  levels (build-corpus.js readBody), so this counts only what is still skipped:
//                  a level inside a section that is not its body, a Subsection or an indexed
//                  record, and a level inside a Subsection that is not a "Normal Level" (none in
//                  July 2026). The site says so and links out.
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

// Child levels of a section that the index reads (its body and its Subsections, issue #76) or
// indexes on their own.
const INDEXED_OR_BODY = new Set(["Normal Level", "Subsection", "Section", "Chapter"]);

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

// A subsection's number, from the start of its heading line (issue #76): "102.4 Smoking." →
// "102.4", "E104.2.2 Group I-3." → "E104.2.2", "§ 19.1-01.1 Applicability." → "19.1-01.1",
// "3.1.1. Definition." → "3.1.1". Null when the line does not start with one ("Appendix A").
// The number starts the anchors of the subsection's parts; jump.js citeWithAnchor turns
// "Section FC 102" and "102.4(1)" into the citation "Section FC 102.4(1)".
const SUBSECTION_KEY = /^(?:§\s*)?([A-Za-z]{0,3}\d[\dA-Za-z-]*(?:\.\d[\dA-Za-z-]*)*)(?=$|[\s.:,])/;
export function subsectionKey(text) {
  return SUBSECTION_KEY.exec(String(text ?? ""))?.[1] ?? null;
}

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

// Bold and italic, as the publisher's <CHARFORMAT bold="1">/<CHARFORMAT italic="1"> mark them
// (Noel, 2026-11-24, on RS 18-1: whole bold lines act as headings, "Modifications.—" leads a
// paragraph in bold, notes are in italics). Display only: the index's `text` never changes.
// Each CHARFORMAT states bold and italic itself (July 2026: every one), so a run's look is its
// nearest CHARFORMAT's; one that leaves an attribute out takes it from the CHARFORMAT around it.
// Marks go inside each CHARFORMAT, as paraWithLinks does for links, so the separator rules in
// extractText see the same siblings. One character per look opens a run; FMT_CLOSE ends it.
const FMT_OPEN = { "": "\uE010", b: "\uE011", i: "\uE012", bi: "\uE013" };
const FMT_CLOSE = "\uE014";
const FMT_OF = Object.fromEntries(Object.entries(FMT_OPEN).map(([k, v]) => [v, k]));

function markFormatting(node, outer = "") {
  if (Array.isArray(node)) return node.map((n) => markFormatting(n, outer));
  if (!node || typeof node !== "object" || "#text" in node) return node;
  const tag = tagOf(node);
  if (!tag) return node;
  const kids = Array.isArray(node[tag]) ? node[tag] : [];
  if (tag !== "CHARFORMAT") return { ...node, [tag]: markFormatting(kids, outer) };
  const flag = (name, k) => {
    const v = getAttr(node, name);
    return v === "" ? outer.includes(k) : v === "1";
  };
  const look = `${flag("bold", "b") ? "b" : ""}${flag("italic", "i") ? "i" : ""}`;
  return { ...node, [tag]: [{ "#text": FMT_OPEN[look] }, ...markFormatting(kids, look), { "#text": FMT_CLOSE }] };
}

/**
 * A PARA's bold and italic runs, as [start, end, "b" | "i" | "bi"] slices of its flattened text
 * (normalize(extractText(para)), the index's text for it), trimmed of spaces at their ends and
 * merged when they touch. Null when the marks moved the text in any way (then the paragraph
 * shows plain, as before), and [] when nothing in it is bold or italic.
 */
export function paraFormatting(para) {
  const plain = normalize(extractText(para));
  const marked = normalize(extractText(markFormatting(para)));
  const stack = [];
  const looks = []; // per character of out
  let out = "";
  for (const ch of marked) {
    if (ch in FMT_OF) stack.push(FMT_OF[ch]);
    else if (ch === FMT_CLOSE) {
      if (!stack.length) return null;
      stack.pop();
    } else if (/\s/.test(ch)) {
      if (out.length > 0 && !out.endsWith(" ")) {
        out += " ";
        looks.push(stack.at(-1) ?? "");
      }
    } else {
      out += ch;
      looks.push(stack.at(-1) ?? "");
    }
  }
  while (out.endsWith(" ")) {
    out = out.slice(0, -1);
    looks.pop();
  }
  if (out !== plain || stack.length) return null;
  const runs = [];
  for (let i = 0; i < out.length; i++) {
    const look = looks[i];
    if (!look) continue;
    // A space takes the look of the run around it only when both sides have it.
    if (out[i] === " ") continue;
    const last = runs.at(-1);
    if (last && last[2] === look && out.slice(last[1], i).trim() === "" && looks.slice(last[1], i).every((l) => l === look)) last[1] = i + 1;
    else runs.push([i, i + 1, look]);
  }
  return runs;
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
// A level may be numbered with a single capital letter instead ("Subchapter A: General
// Provisions", "Appendix A"), when the letter ends the heading or a colon or period follows it.
const GROUP_LABEL = /^([A-Za-z]+)\s+([A-Za-z]?\d[\dA-Za-z-]*(?:\.\d[\dA-Za-z-]*)*|[A-Z](?=[:.]|$))/;
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

    onSection(section, { level, record, parts = [], unread: unreadInSubsections = [], ancestors, levelNode = null }) {
      const parents = ancestors.map((a) => addGroup(a.level, a.record, a.heading));
      if (level === "Chapter") addGroup(level, record, section.heading);
      const entry = { id: section.id, level, parents, blocks: [], links: [], marks: [] };
      if (level === "Chapter") {
        const own = [];
        collectDestinations(record, null, own);
        entry.titleKey = own.map((d) => titleKeyOf(d.name)).find(Boolean) ?? null;
      }

      // Blocks: the non-empty body parts (build-corpus.js readBody), which the index joins with
      // one space: paragraphs, and each Subsection's heading line.
      // Pictures (figures, equations, some tables) carry no text, so a paragraph holding only
      // a picture adds no block and the picture is lost from the text. Count every one in the
      // section, so the site can say what its copy leaves out and link to the official page:
      // in its own paragraphs, anywhere in its Subsections (a picture can sit in a Subsection's
      // heading PARA, which the index may not read when the HEADING says the same), and in the
      // levels it does not read.
      // Levels the index does not read are counted too: a section's own child levels other than
      // its body, Subsections and indexed records (a chapter's other levels hold its sections:
      // Subchapter, Article..., so only a section's count), and any level inside a Subsection
      // that is not a "Normal Level".
      const own = levelNode && level === "Section" ? childrenByTag(levelNode, "LEVEL").filter((l) => !INDEXED_OR_BODY.has(getAttr(l, "style-name") || "")) : [];
      const unread = [...own, ...unreadInSubsections];
      const subsectionLevels = levelNode ? childrenByTag(levelNode, "LEVEL").filter((l) => getAttr(l, "style-name") === "Subsection") : [];
      const pictures =
        parts.reduce((n, part) => n + (part.para && !part.subsection ? countTag(part.para, "PICTURE") : 0), 0) +
        countTag(subsectionLevels, "PICTURE") +
        countTag(own, "PICTURE");
      if (pictures) entry.pictures = pictures;
      if (unread.length) entry.subsections = unread.length;
      const stack = []; // open subdivisions: { depth, key }
      const used = new Map(); // anchor → times used in this section
      let scope = ""; // the open subsection's number ("102.4"), which starts its parts' anchors
      const unique = (anchor) => {
        const n = (used.get(anchor) ?? 0) + 1;
        used.set(anchor, n);
        return n === 1 ? anchor : `${anchor}-${n}`;
      };
      const records = []; // [body RECORD id, its first block]
      let offset = 0;
      let ok = true;
      for (const part of parts) {
        const { text, links } = part.para ? paraWithLinks(part.para) : { text: part.text, links: [] };
        if (!text) continue;
        const rid = getAttr(part.record, "id");
        const start = offset === 0 ? 0 : offset + 1;
        if (section.text.slice(start, start + text.length) !== text) {
          ok = false;
          break;
        }
        const p = part.para;
        const style = p ? getAttr(p, "style-name") : "";
        const block = { start, end: start + text.length, type: "text" };
        if (part.kind === "subheading") {
          // A Subsection's heading line. Its body is a new list: subdivisions under it do not
          // nest in the ones before it, and their anchors start with its number, so item (1) of
          // 102.4 is "102.4(1)", not the section's third "(1)" ("(1)-3"). The heading's own
          // anchor is its number. One with no number ("Appendix A") opens no scope.
          block.type = "subheading";
          stack.length = 0;
          scope = subsectionKey(text) ?? "";
          if (scope) block.anchor = unique(scope);
        } else if (style === "EdNote" || style === "EdNoteSm") {
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
              block.anchor = unique(scope + path);
            }
          } else if (tabs > 0) {
            block.depth = tabs;
          }
        }
        if (p && hasTag(p, "TABLE")) block.table = true;
        if (p && hasTag(p, "PICTURE")) block.picture = true;
        if (!records.some(([r]) => r === rid)) records.push([rid, block]);
        for (const l of links ?? []) {
          entry.links.push({ start: start + l.start, end: start + l.end, target: linkTarget(l.attrs, corpus) });
        }
        for (const [a, b, look] of (p ? paraFormatting(p) : null) ?? []) entry.marks.push([start + a, start + b, look]);
        if (links === null) entry.unplacedLinks = (entry.unplacedLinks ?? 0) + countTag(p, "LINK");
        entry.blocks.push(block);
        offset = block.end;
      }
      if (!ok || offset !== section.text.length) {
        // The paragraphs do not slice `text` exactly; keep the section as one block, no links.
        entry.blocks = section.text ? [{ start: 0, end: section.text.length, type: "text" }] : [];
        entry.links = [];
        entry.marks = [];
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
        if (e.marks.length) s.marks = e.marks;
        if (e.flat) s.flat = true;
        if (e.unplacedLinks) s.unplacedLinks = e.unplacedLinks;
        if (e.pictures) s.pictures = e.pictures;
        if (e.subsections) s.subsections = e.subsections;
        return s;
      });
      const usedGroups = new Set(entries.flatMap((e) => e.parents));
      const targets = out.flatMap((s) => (s.links ?? []).map((l) => l.to));
      const own = collector.resolver();
      const linkStats = {
        links: targets.length,
        unresolved: targets.filter((t) => t.resolved === false).length,
        ambiguous: targets.filter((t) => t.ambiguous).length,
        ambiguousIds: own.ambiguousIds.size,
        ambiguousNames: own.ambiguousNames.size,
      };
      return {
        format: STRUCTURE_FORMAT,
        corpus,
        indexSha256,
        sectionCount: sections.length,
        titleStats,
        linkStats,
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
      // The publisher reuses some anchor ids and names on more than one record (July 2026: the
      // Rules' § 2-01.1 carries § 2-01's id and name). A link to one of those could mean either
      // record, so it is ambiguous and left unresolved, never pointed at whichever was read
      // last. Every <DESTINATION> counts, including ones on records no target can be made of.
      const recordsOf = (key) => {
        const m = new Map();
        for (const d of destinations) {
          const k = d[key];
          if (!m.has(k)) m.set(k, new Set());
          m.get(k).add(d.record);
        }
        return new Set([...m].filter(([, rs]) => rs.size > 1).map(([k]) => k));
      };
      const ambiguousIds = recordsOf("id");
      const ambiguousNames = recordsOf("name");
      const byId = new Map();
      const byName = new Map();
      for (const d of destinations) {
        const w = where(d);
        if (!w) continue;
        if (!ambiguousIds.has(d.id) && !byId.has(d.id)) byId.set(d.id, w);
        if (!ambiguousNames.has(d.name) && !byName.has(d.name)) byName.set(d.name, w);
      }
      resolved = { byId, byName, ambiguousIds, ambiguousNames };
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

// A link's target in the corpus it names. A link that carries an anchor id is found by that
// id, and by its name only when the id is not found at all; an id or name the publisher put on
// two records is `ambiguous` and stays unresolved.
export function resolveTarget(t, resolvers) {
  if (t.kind !== "section") return t;
  const out = { corpus: t.corpus, name: t.name };
  const r = t.corpus ? resolvers[t.corpus] : null;
  if (!r) return { ...out, resolved: false };
  if (t.destination && t.destination !== "0-0-0-0") {
    if (r.ambiguousIds.has(t.destination)) return { ...out, resolved: false, ambiguous: true };
    const hit = r.byId.get(t.destination);
    if (hit) return { ...out, ...hit };
  }
  if (r.ambiguousNames.has(t.name)) return { ...out, resolved: false, ambiguous: true };
  const hit = r.byName.get(t.name);
  return hit ? { ...out, ...hit } : { ...out, resolved: false };
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
