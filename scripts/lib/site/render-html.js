// The site's HTML writer for a law section's text (issue #62), written from renderSection's
// blocks (scripts/lib/render-section.js), the same blocks the Markdown index is written from.
// test/site-build.test.js reads each page back and checks it shows the same blocks, in the same
// order, with the same text, as the Markdown.
//
// Each body block is one <p> with data-block="<n>" (its place among the body blocks):
//   subdivision  <p class="sub" data-depth="2" id="(b)(1)" data-pagefind-title="NYC Charter § 259(b)(1)">
//                its label ("(1)") is a link to its own anchor
//   text         <p class="txt" data-depth="1">     (data-depth only when the source indents it)
//   note         <p class="ednote">                  an editor's note
// The text inside each <p>, with tags removed and entities decoded, is the block's text exactly.
// Cross-references become links when linkFor returns an address, and stay plain text otherwise.

import { escapeHtml } from "./html.js";

/**
 * @param {Array} blocks         renderSection's body blocks (bodyBlocks(renderSection(...)))
 * @param {object} ctx
 * @param {string} ctx.fullCitation   "NYC Charter § 259", for subdivision names
 * @param {(to: object) => ({href: string, label?: string}|string|null)} ctx.linkFor
 *        where a cross-reference goes, or null for plain text. `label` names the target
 *        ("NYC Charter § 8"); when the linked words are not already that name, the link's
 *        accessible name is "<words>, <label>", so "eight" linking to Chapter 8 and "eight"
 *        linking to § 8 do not share a name (an agent tells links apart by name).
 */
export function bodyHtml(blocks, { fullCitation, linkFor }) {
  return blocks.map((b, n) => blockHtml(b, n, { fullCitation, linkFor })).join("\n");
}

function blockHtml(b, n, { fullCitation, linkFor }) {
  const attrs = [];
  let cls = "txt";
  if (b.type === "subdivision") cls = "sub";
  else if (b.type === "note") cls = "ednote";
  attrs.push(`class="${cls}"`);
  if (b.depth) attrs.push(`data-depth="${Math.min(Number(b.depth), 8)}"`);
  if (b.anchor) {
    attrs.push(`id="${escapeHtml(b.anchor)}"`);
    attrs.push(`data-pagefind-title="${escapeHtml(fullCitation + b.anchor)}"`);
  }
  if (b.table) attrs.push(`data-table`);
  attrs.push(`data-block="${n}"`);

  const links = [...(b.links ?? [])].sort((x, y) => x.start - y.start);
  // The label link covers the label at the start of the text, unless a cross-reference starts there.
  const labelEnd = b.type === "subdivision" && b.anchor && b.label && b.text.startsWith(b.label) ? b.label.length : 0;
  const spans = [];
  if (labelEnd && !links.some((l) => l.start < labelEnd)) {
    const name = `${b.label}, link to ${fullCitation}${b.anchor}`;
    spans.push({ start: 0, end: labelEnd, open: `<a class="num" href="#${escapeHtml(b.anchor)}" aria-label="${escapeHtml(name)}">` });
  }
  let last = labelEnd;
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
    html += escapeHtml(b.text.slice(at, s.start)) + s.open + escapeHtml(b.text.slice(s.start, s.end)) + "</a>";
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
