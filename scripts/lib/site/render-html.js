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
// The text inside each <p> or <hN>, with tags removed and entities decoded, is the block's text exactly:
// the history class and the <strong> change how the words look, never the words.
// Cross-references become links when linkFor returns an address, and stay plain text otherwise.
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
 */
export function bodyHtml(blocks, { fullCitation, linkFor, copyOf = null, nameNote = "", headingLevel = 2 }) {
  const caseNotes = anchorCaseNotes(blocks);
  return blocks.map((b, n) => blockHtml(b, n, { fullCitation, linkFor, copyOf, nameNote, headingLevel, caseNote: caseNotes.get(b.anchor) })).join("\n");
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


function blockHtml(b, n, { fullCitation, linkFor, copyOf, nameNote, headingLevel = 2, caseNote }) {
  const attrs = [];
  let cls = "txt";
  let tag = "p";
  if (b.type === "subheading") {
    cls = "subhead";
    tag = `h${Math.min(Math.max(Number(headingLevel) || 2, 2), 6)}`;
  } else if (b.type === "subdivision") cls = "sub";
  else if (b.type === "note") cls = "ednote";
  else if (isHistoryLine(b)) cls = "txt history";
  attrs.push(`class="${cls}"`);
  if (b.depth) attrs.push(`data-depth="${Math.min(Number(b.depth), 8)}"`);
  const id = b.anchor ? (copyOf ? copyId(copyOf, b.anchor) : b.anchor) : null;
  if (id) {
    attrs.push(`id="${escapeHtml(id)}"`);
    if (!copyOf) attrs.push(`data-pagefind-title="${escapeHtml(citeWithAnchor(fullCitation, b.anchor))}"`);
  }
  if (b.table) attrs.push(`data-table`);
  if (!copyOf) attrs.push(`data-block="${n}"`);

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
    spans.push({ start: lead.start, end: lead.end, open: "<strong>", close: "</strong>" });
    last = lead.end;
  }
  for (const l of links) {
    if (l.start < last) continue; // overlapping marks: keep the first
    const target = linkFor(l.to);
    if (!target) continue;
    const { href, label } = typeof target === "string" ? { href: target } : target;
    const external = /^https?:\/\//i.test(href);
    const words = b.text.slice(l.start, l.end).trim();
    const name = label && words !== label ? ` aria-label="${escapeHtml(`${words}, ${label}`)}"` : "";
    spans.push({
      start: l.start,
      end: l.end,
      open: `<a class="${external ? "external" : "xref"}" href="${escapeHtml(href)}"${name}>`,
    });
    last = l.end;
  }
  let html = "";
  let at = 0;
  for (const s of spans) {
    html += escapeHtml(b.text.slice(at, s.start)) + s.open + escapeHtml(b.text.slice(s.start, s.end)) + (s.close ?? "</a>");
    at = s.end;
  }
  html += escapeHtml(b.text.slice(at));
  return `<${tag} ${attrs.join(" ")}>${html}</${tag}>`;
}

/** Read the blocks back from a page's HTML (tests): [{ n, tag, cls, id, text }], in page order. */
export function readBlocks(html, unescape) {
  const out = [];
  const re = /<(p|h[2-6]) ([^>]*\bdata-block="(\d+)"[^>]*)>([\s\S]*?)<\/\1>/g;
  for (const m of html.matchAll(re)) {
    const cls = /class="([^"]*)"/.exec(m[2])?.[1] ?? "";
    const id = /\bid="([^"]*)"/.exec(m[2])?.[1];
    out.push({ n: Number(m[3]), tag: m[1], cls, id: id === undefined ? undefined : unescape(id), text: unescape(m[4].replace(/<[^>]*>/g, "")) });
  }
  return out;
}
