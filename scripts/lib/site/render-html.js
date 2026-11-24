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
// The text inside each <p>, with tags removed and entities decoded, is the block's text exactly:
// the history class and the <strong> change how the words look, never the words.
// Cross-references become links when linkFor returns an address, and stay plain text otherwise.
//
// A chapter page shows its sections' text a second time (pages.js chapterPage). That copy is
// written with `copyOf`: its ids carry the section's prefix ("s-4(b)(1)", so they stay unique on
// the page), and it has no data-block and no data-pagefind-title (the block-order test and
// Pagefind read only the record's own text).

import { escapeHtml } from "./html.js";

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
 */
export function bodyHtml(blocks, { fullCitation, linkFor, copyOf = null, nameNote = "" }) {
  return blocks.map((b, n) => blockHtml(b, n, { fullCitation, linkFor, copyOf, nameNote })).join("\n");
}

/** The id of a subdivision in a chapter page's copy of a section: "s-4" + "(b)(1)". */
export function copyId(slug, anchor = "") {
  return `s-${slug}${anchor}`;
}

function blockHtml(b, n, { fullCitation, linkFor, copyOf, nameNote }) {
  const attrs = [];
  let cls = "txt";
  if (b.type === "subdivision") cls = "sub";
  else if (b.type === "note") cls = "ednote";
  else if (isHistoryLine(b)) cls = "txt history";
  attrs.push(`class="${cls}"`);
  if (b.depth) attrs.push(`data-depth="${Math.min(Number(b.depth), 8)}"`);
  const id = b.anchor ? (copyOf ? copyId(copyOf, b.anchor) : b.anchor) : null;
  if (id) {
    attrs.push(`id="${escapeHtml(id)}"`);
    if (!copyOf) attrs.push(`data-pagefind-title="${escapeHtml(fullCitation + b.anchor)}"`);
  }
  if (b.table) attrs.push(`data-table`);
  if (!copyOf) attrs.push(`data-block="${n}"`);

  const links = [...(b.links ?? [])].sort((x, y) => x.start - y.start);
  // The label link covers the label at the start of the text, unless a cross-reference starts there.
  const labelEnd = b.type === "subdivision" && b.anchor && b.label && b.text.startsWith(b.label) ? b.label.length : 0;
  const spans = [];
  if (labelEnd && !links.some((l) => l.start < labelEnd)) {
    const name = `${b.label}, link to ${fullCitation}${b.anchor}${nameNote ? `, ${nameNote}` : ""}`;
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
  return `<p ${attrs.join(" ")}>${html}</p>`;
}

/** Read the blocks back from a page's HTML (tests): [{ n, cls, id, text }], in page order. */
export function readBlocks(html, unescape) {
  const out = [];
  const re = /<p ([^>]*\bdata-block="(\d+)"[^>]*)>([\s\S]*?)<\/p>/g;
  for (const m of html.matchAll(re)) {
    const cls = /class="([^"]*)"/.exec(m[1])?.[1] ?? "";
    const id = /\bid="([^"]*)"/.exec(m[1])?.[1];
    out.push({ n: Number(m[2]), cls, id: id === undefined ? undefined : unescape(id), text: unescape(m[3].replace(/<[^>]*>/g, "")) });
  }
  return out;
}
