// The site's HTML writer for a law section's text (issue #62), written from renderSection's
// blocks (scripts/lib/render-section.js), the same blocks the Markdown index is written from.
// test/site-build.test.js reads each page back and checks it shows the same blocks, in the same
// order, with the same text, as the Markdown.
//
// Each body block is one <p> with data-block="<n>" (its place among the body blocks):
//   subdivision  <p class="sub" data-depth="2" id="(b)(1)" data-pagefind-title="NYC Charter § 259(b)(1)">
//                its label ("(1)") is a link to its own anchor
//   text         <p class="txt" data-depth="1">     (data-depth only when the source indents it)
//                <p class="txt history">            an amendment history line, "(Am. L.L. 2016/019, ...)"
//   note         <p class="ednote">                  an editor's note; its "Editor's note:" is in <strong>
//   subheading   <h2 class="subhead" id="102.4" data-pagefind-title="… Section FC 102.4">
//                a Subsection's heading line, "102.4 Smoking." (issue #76): a real heading, one
//                level below the heading it sits under (ctx.headingLevel); its id is the
//                subsection's number, when its line starts with one
// A part's citation (search titles, link names, Copy citation in law.js) is jump.js
// citeWithAnchor: "NYC Charter § 259" + "(b)(1)", and "… Section FC 102" + "102.4(1)" →
// "… Section FC 102.4(1)".
// The publisher's bold and italic runs (block `marks`) are <strong> and <em>, split around links
// so tags nest; a paragraph wholly in bold that reads as a heading line also gets class
// "boldline" (isBoldLine), the subheading's look, as a <p>.
// The text inside each <p> or <hN>, with tags removed and entities decoded, is the block's text exactly:
// the history class, <strong> and <em> change how the words look, never the words.
// Cross-references become links when linkFor returns an address, and stay plain text otherwise.
//
// A table block with `rows` (issue #65; the structure's cells, build-structure.js paraTable) is
//   <div class="table-scroll" data-table-name="Table 1 of 2, 15 RCNY § 1-01" data-block="<n>">
//   <nys-table bordered><table><thead>…</thead><tbody>…</tbody></table></nys-table></div>
// a real <table>, so it reads as one with JavaScript off and in print; NYSDS's nys-table
// (1.23.2) only enhances it in place. The div scrolls a wide table inside itself, so the page
// never scrolls sideways. While its table is wider than it, law.js (wireTables) makes the box a
// region named from data-table-name, unique on the page, with tabindex="0", so a keyboard can
// scroll it; a box whose table fits is neither (most tables fit on a wide screen, and a page
// can hold hundreds). With JavaScript off the box has no name and no tabindex: Chromium (and
// Firefox) let the keyboard reach a box that scrolls on their own. Both <thead> and <tbody> are always written: nys-table
// rebuilds a table that lacks either, moving the first row that holds a <th> into a new <thead>
// (its _normalizeTableDOM), which would reorder a table whose header cells are not at the top.
// The leading rows whose every cell is a header cell are the <thead>; their <th>s get
// scope="col", spanning ones too: under the HTML table model a column header covers every column
// it spans (the scan for a data cell's headers runs up each of its columns and finds a slot the
// spanning cell covers), while scope="colgroup" applies only inside a <colgroup>, which these
// tables do not have (HTML Living Standard, "Forming relationships between data cells and header
// cells"; a th "must not be in the Column Group state if the element is not anchored in a column
// group"). A header cell further down is a <th>
// with no scope. With its tags removed, the table's HTML is the block's text: the HTML has a
// line break between two cells exactly where the text has a space.
// A table block without `rows` (a structure built before #65) is one <p data-table>, as before.
//
// A chapter page shows its sections' text a second time (pages.js chapterPage). That copy is
// written with `copyOf`: its ids carry the section's prefix ("s-4(b)(1)", "s-fc-102_102.4(1)",
// jump.js copyId, so they stay unique on the page), and it has no data-block and no data-pagefind-title (the block-order test and
// Pagefind read only the record's own text).

import { escapeHtml } from "./html.js";
import { citeWithAnchor, copyId } from "../../../site/assets/jump.js";

export { copyId };

/**
 * The amendment history line at the end of a section: one text block, wholly in parentheses,
 * that opens with how the text was made or changed. Matched on the three books' real lines
 * (2026-11-23): every parenthesized text block in the Charter (274), 3,602 of 3,614 in the
 * Administrative Code and 4,105 of 4,183 in the Rules. What it leaves out is law text that
 * happens to sit in parentheses ("(This table is intended ...)", "(Tenant Signature)") and the
 * Rules' statutory-authority lines ("(§ 11-605(1), Administrative Code)").
 */
const HISTORY_OPENERS =
  /^\(\s*(?:Am\.|Amended\b|Added\b|Repealed\b|Renumbered\b|L\.L\.?\s|\d{4} N\.Y\. Laws?\b|(?:Title|Chapter) (?:amended|added|repealed)\b|Order Eff\.|City Record\b)/;
export function isHistoryLine(block) {
  if (!block || block.type !== "text" || block.label) return false;
  const t = String(block.text ?? "").trim();
  return t.startsWith("(") && t.endsWith(")") && HISTORY_OPENERS.test(t);
}

/** Where "Editor's note:" (or "Editor's notes:") sits in a note's text, after an optional "* ", or null. */
const EDNOTE_LEAD = /^(\*\s*)?(Editor['’]s notes?:)/;
function ednoteLead(b) {
  if (b.type !== "note") return null;
  const m = EDNOTE_LEAD.exec(b.text);
  return m ? { start: (m[1] ?? "").length, end: m[0].length } : null;
}

/**
 * @param {Array} blocks         renderSection's body blocks (bodyBlocks(renderSection(...)))
 * @param {object} ctx
 * @param {string} ctx.fullCitation   "NYC Charter § 259", for subdivision names
 * @param {(to: object) => ({href: string, label?: string}|string|null)} ctx.linkFor
 *        where a cross-reference goes, or null for plain text. `label` names the target
 *        ("NYC Charter § 8"); when the linked words are not already that name, the link's
 *        accessible name is "<words>, <label>", so "eight" linking to Chapter 8 and "eight"
 *        linking to § 8 do not share a name (an agent tells links apart by name).
 * @param {string} [ctx.copyOf]   the section's slug, when this is a chapter page's copy of it:
 *        ids become "s-<slug><anchor>", and there is no data-block or data-pagefind-title
 * @param {string} [ctx.nameNote] words added to each subdivision link's name, when two sections on
 *        one page share a citation ("a., link to NYC Charter § 530(a), Composition")
 * @param {number} [ctx.headingLevel] the level of a subheading's element: 2 on a section page
 *        (under its h1), 3 in a chapter, part or title page's copy (under the section's h2)
 * @param {(b: object, n: number) => (number|undefined)} [ctx.weightFor] a block's Pagefind
 *        weight (data-pagefind-weight, pagefind.app/docs/weighting), or undefined for none; never
 *        on a copy, which search does not read (a local-law note's paragraphs: pages.js searchKind)
 */
export function bodyHtml(blocks, { fullCitation, linkFor, copyOf = null, nameNote = "", headingLevel = 2, weightFor = null }) {
  const caseNotes = anchorCaseNotes(blocks);
  const tableCount = blocks.filter(isTable).length;
  let tableNo = 0;
  return blocks
    .map((b, n) =>
      isTable(b)
        ? tableHtml(b, n, { fullCitation, linkFor, copyOf, nameNote, number: ++tableNo, count: tableCount, weight: weightFor?.(b, n) })
        : blockHtml(b, n, { fullCitation, linkFor, copyOf, nameNote, headingLevel, caseNote: caseNotes.get(b.anchor), next: blocks[n + 1] ?? null, weight: weightFor?.(b, n) })
    )
    .join("\n");
}

/** A block shown as a table: a table block that carries its cells (structure `rows`). */
export function isTable(b) {
  return Boolean(b?.table && Array.isArray(b.rows) && b.rows.length);
}

/**
 * The fewest columns at which a printed table may break words anywhere (law.css). Measured on the
 * July 2026 files printed at 720px (US Letter less Chromium's margins): with words kept whole
 * (`overflow-wrap: break-word`), 84 of 14,821 table boxes ran past the page, every one of 8 columns
 * or more, and every table fits once its words may break anywhere. Breaking anywhere also lets the
 * table squeeze a short column below its words ("Ye|s"), so it is kept to the tables that need it.
 */
export const PRINT_DENSE_COLUMNS = 8;

/** How many columns a table spans: its widest row, counting each cell's colspan. */
export function tableColumns(rows) {
  return Math.max(0, ...rows.map((row) => row.reduce((n, c) => n + (c[2]?.cs ?? 1), 0)));
}

/** The name of a table's scrolling box: "Table, 15 RCNY § 1-01" or "Table 2 of 3, …". */
export function tableName({ fullCitation, nameNote = "", number = 1, count = 1 }) {
  return `${count > 1 ? `Table ${number} of ${count}` : "Table"}, ${fullCitation}${nameNote ? `, ${nameNote}` : ""}`;
}

/**
 * Anchors that differ only in letter case ("(D)(ii)" and "(D)(II)", in some Administrative Code
 * sections) would give two subdivision links one spoken name. Each such anchor gets a word for its
 * label's case ("capital letters", "small letters"), or, when that does not tell them apart, its
 * place among them ("2 of 2"). Anchor → note; none for an anchor with no twin.
 */
export function anchorCaseNotes(blocks) {
  const byFold = new Map();
  for (const b of blocks) {
    if (!b.anchor) continue;
    const k = b.anchor.toLowerCase();
    if (!byFold.has(k)) byFold.set(k, []);
    if (!byFold.get(k).some((x) => x.anchor === b.anchor)) byFold.get(k).push(b);
  }
  const notes = new Map();
  const caseOf = (label) => (/[A-Z]/.test(label ?? "") && !/[a-z]/.test(label ?? "") ? "capital letters" : /[a-z]/.test(label ?? "") && !/[A-Z]/.test(label ?? "") ? "small letters" : "");
  for (const list of byFold.values()) {
    if (list.length < 2) continue;
    const words = list.map((b) => caseOf(b.label));
    const distinct = words.every((w, i) => w && words.indexOf(w) === i);
    list.forEach((b, i) => notes.set(b.anchor, distinct ? words[i] : `${i + 1} of ${list.length}`));
  }
  return notes;
}


/** True when the publisher set every character of a block's text in bold (structure `marks`). */
export function wholeBold(b) {
  const marks = (b?.marks ?? []).filter(([, , look]) => look.includes("b"));
  if (!marks.length) return false;
  const bold = marks.reduce((n, [x, y]) => n + b.text.slice(x, y).replace(/\s/g, "").length, 0);
  return bold === b.text.replace(/\s/g, "").length;
}

/**
 * A bold line that reads as a heading (Noel, 2026-11-24, on RS 18-1: "Introduction–Section
 * 3—Definitions:", "100.1d Multiple Hoistways."): a paragraph the publisher set wholly in bold,
 * at most 100 characters, that is not a note ("NOTE:", "Exceptions:"), and that text not wholly
 * in bold follows. It gets the subheading's look (spacing and a thin rule), not a heading
 * element: the XML does not mark it as a level, and in the July 2026 files such lines are also
 * table captions, defined terms ("Commercial vehicle.") and lines said twice in one section, so a
 * heading would put noise and guessed levels in a screen reader's outline. Runs of bold lines
 * ("382.10 DELETED." after "382.5 DELETED.") and a bold line that ends its section stay plain bold.
 */
export const BOLD_LINE_MAX = 100;
export function isBoldLine(b, next) {
  if (!b || (b.type !== "text" && b.type !== "subdivision")) return false;
  if (b.text.length > BOLD_LINE_MAX || /^(notes?|exceptions?)\b/i.test(b.text) || !wholeBold(b)) return false;
  return Boolean(next) && next.type !== "subheading" && !wholeBold(next);
}

/**
 * The HTML for text[a, z): escaped, with the publisher's bold and italic runs (block `marks`) as
 * <strong> and <em>. `bold: false` leaves bold out where the element is bold already (a heading,
 * the <strong> "Editor's note:").
 */
function formatted(text, a, z, marks = [], { bold = true } = {}) {
  if (a >= z) return "";
  const cuts = new Set([a, z]);
  for (const [x, y] of marks) {
    if (x > a && x < z) cuts.add(x);
    if (y > a && y < z) cuts.add(y);
  }
  const points = [...cuts].sort((p, q) => p - q);
  const pieces = [];
  for (let i = 0; i < points.length - 1; i++) {
    const [s, e] = [points[i], points[i + 1]];
    const look = marks.find(([x, y]) => x <= s && y >= e)?.[2] ?? "";
    const key = `${bold && look.includes("b") ? "b" : ""}${look.includes("i") ? "i" : ""}`;
    const last = pieces.at(-1);
    if (last && last.key === key) last.end = e;
    else pieces.push({ key, start: s, end: e });
  }
  return pieces
    .map(({ key, start, end }) => {
      let h = escapeHtml(text.slice(start, end));
      if (key.includes("i")) h = `<em>${h}</em>`;
      if (key.includes("b")) h = `<strong>${h}</strong>`;
      return h;
    })
    .join("");
}

function blockHtml(b, n, { fullCitation, linkFor, copyOf, nameNote, headingLevel = 2, caseNote, next = null, weight }) {
  const attrs = [];
  let cls = "txt";
  let tag = "p";
  if (b.type === "subheading") {
    cls = "subhead";
    tag = `h${Math.min(Math.max(Number(headingLevel) || 2, 2), 6)}`;
  } else if (b.type === "subdivision") cls = "sub";
  else if (b.type === "note") cls = "ednote";
  else if (isHistoryLine(b)) cls = "txt history";
  if (isBoldLine(b, next)) cls += " boldline";
  attrs.push(`class="${cls}"`);
  if (b.depth) attrs.push(`data-depth="${Math.min(Number(b.depth), 8)}"`);
  const id = b.anchor ? (copyOf ? copyId(copyOf, b.anchor) : b.anchor) : null;
  if (id) {
    attrs.push(`id="${escapeHtml(id)}"`);
    if (!copyOf) attrs.push(`data-pagefind-title="${escapeHtml(citeWithAnchor(fullCitation, b.anchor))}"`);
  }
  if (b.table) attrs.push(`data-table`);
  if (!copyOf) attrs.push(`data-block="${n}"`);
  if (weight !== undefined && !copyOf) attrs.push(`data-pagefind-weight="${weight}"`);

  const links = [...(b.links ?? [])].sort((x, y) => x.start - y.start);
  // The label link covers the label at the start of the text, unless a cross-reference starts there.
  const labelEnd = b.type === "subdivision" && b.anchor && b.label && b.text.startsWith(b.label) ? b.label.length : 0;
  const spans = [];
  if (labelEnd && !links.some((l) => l.start < labelEnd)) {
    const name = `${b.label}, link to ${citeWithAnchor(fullCitation, b.anchor)}${caseNote ? `, ${caseNote}` : ""}${nameNote ? `, ${nameNote}` : ""}`;
    spans.push({ start: 0, end: labelEnd, open: `<a class="num" href="#${escapeHtml(id)}" aria-label="${escapeHtml(name)}">` });
  }
  // "Editor's note:" in bold, unless a cross-reference starts inside it (none does, 2026-11-23).
  let last = labelEnd;
  const lead = ednoteLead(b);
  if (lead && !links.some((l) => l.start < lead.end)) {
    spans.push({ start: lead.start, end: lead.end, open: "<strong>", close: "</strong>", strong: true });
    last = lead.end;
  }
  linkSpans(b.text, links, linkFor, last, spans);
  // A heading is bold already: only italics inside it.
  const html = spansHtml(b.text, 0, b.text.length, spans, b.marks ?? [], { bold: b.type !== "subheading" });
  return `<${tag} ${attrs.join(" ")}>${html}</${tag}>`;
}

/** Cross-references in text, from `from` on, as spans (pushed onto `spans`); overlapping ones keep the first. */
function linkSpans(text, links, linkFor, from, spans) {
  let last = from;
  for (const l of links) {
    if (l.start < last) continue; // overlapping marks: keep the first
    const target = linkFor(l.to);
    if (!target) continue;
    const { href, label } = typeof target === "string" ? { href: target } : target;
    const external = /^https?:\/\//i.test(href);
    const words = text.slice(l.start, l.end).trim();
    const name = label && words !== label ? ` aria-label="${escapeHtml(`${words}, ${label}`)}"` : "";
    spans.push({
      start: l.start,
      end: l.end,
      open: `<a class="${external ? "external" : "xref"}" href="${escapeHtml(href)}"${name}>`,
    });
    last = l.end;
  }
  return spans;
}

/** text[a, z) as HTML: the spans (links, a bold lead) in order, bold and italic runs around and inside them. */
function spansHtml(text, a, z, spans, marks, { bold = true } = {}) {
  let html = "";
  let at = a;
  for (const s of spans) {
    html += formatted(text, at, s.start, marks, { bold }) + s.open + formatted(text, s.start, s.end, marks, { bold: bold && !s.strong }) + (s.close ?? "</a>");
    at = s.end;
  }
  return html + formatted(text, at, z, marks, { bold });
}

/**
 * A table block (isTable) as a scrolling box (named and focusable by law.js while it scrolls)
 * around NYSDS's nys-table and a plain <table>. Each cell is its slice of the block's text, with the links and bold and italic
 * runs inside it, and a <br> where the publisher starts a new line in the cell. A link that
 * does not sit inside one cell is left as plain text.
 */
function tableHtml(b, n, { fullCitation, linkFor, copyOf, nameNote, number, count, weight }) {
  const attrs = [`class="table-scroll"`, `data-table-name="${escapeHtml(tableName({ fullCitation, nameNote, number, count }))}"`];
  // A table of many columns may break a word anywhere in print (law.css), the only way it fits
  // the paper; a narrower one keeps its words whole there.
  if (tableColumns(b.rows) >= PRINT_DENSE_COLUMNS) attrs.push("data-many-columns");
  if (!copyOf) attrs.push(`data-block="${n}"`);
  // A table in a local-law note takes the note's weight, as its paragraphs do (bodyHtml weightFor).
  if (weight !== undefined && !copyOf) attrs.push(`data-pagefind-weight="${weight}"`);
  const links = [...(b.links ?? [])].sort((x, y) => x.start - y.start);
  const marks = b.marks ?? [];
  const rows = b.rows;
  // The <thead>: the leading rows whose every cell is a header cell, cut back so no row span
  // crosses from it into the body.
  let head = 0;
  while (head < rows.length && rows[head].length && rows[head].every((c) => c[2]?.h)) head++;
  const crosses = (h) => rows.slice(0, h).some((row, i) => row.some((c) => i + (c[2]?.rs ?? 1) > h));
  while (head > 0 && crosses(head)) head--;
  const cellHtml = ([x, y, extra = {}], i, inHead) => {
    const groupEnd = inHead ? head : rows.length;
    const rs = Math.min(extra.rs ?? 1, groupEnd - i);
    const tag = extra.h ? "th" : "td";
    const a = [];
    if (extra.cs > 1) a.push(`colspan="${extra.cs}"`);
    if (rs > 1) a.push(`rowspan="${rs}"`);
    if (inHead) a.push(`scope="col"`);
    // Right-aligned cells take the template's `num` class (site.css: right, tabular figures).
    if (extra.al) a.push(`class="${extra.al === "r" ? "num" : "al-c"}"`);
    // Line starts inside the cell cut it into pieces; links that sit in one piece stay links.
    const cuts = [x, ...(extra.br ?? []).filter((p) => p > x && p < y), y];
    const pieces = [];
    for (let k = 0; k < cuts.length - 1; k++) {
      const [p, q] = [cuts[k], cuts[k + 1]];
      const spans = linkSpans(b.text, links.filter((l) => l.start >= p && l.end <= q), linkFor, p, []);
      pieces.push(spansHtml(b.text, p, q, spans, marks));
    }
    return `<${tag}${a.length ? ` ${a.join(" ")}` : ""}>${pieces.join("<br>")}</${tag}>`;
  };
  // Between two cells the HTML has a line break where the text has its space, and nothing where
  // the publisher's markup ran the two cells' words together, so the table's text, with tags
  // removed, is the block's text (readBlocks).
  let prev = null;
  const gap = ([x, y]) => {
    if (y <= x) return "";
    const sep = prev === null ? "" : b.text.slice(prev, x) === " " ? "\n" : "";
    prev = y;
    return sep;
  };
  const rowsHtml = (list, offset, inHead) =>
    list
      .map((row, i) => {
        const cells = row.map((c) => [gap(c), cellHtml(c, offset + i, inHead)]);
        const lead = cells[0]?.[0] ?? "";
        return `${lead}<tr>${cells.map(([sep, h], k) => (k ? sep : "") + h).join("")}</tr>`;
      })
      .join("");
  const headHtml = rowsHtml(rows.slice(0, head), 0, true);
  const bodyRows = rowsHtml(rows.slice(head), head, false);
  return `<div ${attrs.join(" ")}>\n<nys-table bordered>\n<table>\n<thead>${headHtml}</thead><tbody>${bodyRows}</tbody>\n</table>\n</nys-table>\n</div>`;
}

/**
 * Read the blocks back from a page's HTML (tests): [{ n, tag, cls, id, text }], in page order. A
 * table's text is its HTML without tags, each run of whitespace one space (tableHtml).
 */
export function readBlocks(html, unescape) {
  const out = [];
  const re = /<(p|h[2-6]|div) ([^>]*\bdata-block="(\d+)"[^>]*)>([\s\S]*?)<\/\1>/g;
  for (const m of html.matchAll(re)) {
    const cls = /class="([^"]*)"/.exec(m[2])?.[1] ?? "";
    const id = /\bid="([^"]*)"/.exec(m[2])?.[1];
    // A table's HTML has a line break between two cells where its text has a space; a <br>
    // stands where the text already has its space (or had none), so it adds nothing.
    const plain = unescape(m[4].replace(/<[^>]*>/g, ""));
    const text = m[1] === "div" ? plain.replace(/\s+/g, " ").trim() : plain;
    out.push({ n: Number(m[3]), tag: m[1], cls, id: id === undefined ? undefined : unescape(id), text });
  }
  return out;
}
