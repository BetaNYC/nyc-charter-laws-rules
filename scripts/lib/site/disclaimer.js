// The full disclaimer for the "About this copy" page: the MCP server's own FOOTER, read from
// src/tools.ts at build time and never retyped here (issue #62), so the site and the MCP cannot
// say different things. test/site-build.test.js checks the parsed text against the FOOTER the
// compiled server exports.

import { readFileSync } from "node:fs";
import { escapeHtml } from "./html.js";

/** The FOOTER template literal in src/tools.ts, as the server's `.trim()` leaves it. */
export function readFooter(toolsTsPath) {
  const src = readFileSync(toolsTsPath, "utf8");
  const m = /export const FOOTER = `([\s\S]*?)`\.trim\(\);/.exec(src);
  if (!m) throw new Error(`FOOTER not found in ${toolsTsPath}: the site cannot build its disclaimer page`);
  if (m[1].includes("${")) throw new Error("FOOTER uses interpolation; build-site cannot read it as text");
  return m[1].trim();
}

/**
 * The FOOTER's paragraphs for the site: the leading "---" rule dropped, and the last paragraph
 * ("Built by BetaNYC...") left out, because the page footer already says who built the site.
 */
export function disclaimerParagraphs(footer) {
  const paras = footer.split(/\n\s*\n/).map((p) => p.replace(/^---\s*\n?/, "").trim()).filter(Boolean);
  // The last paragraph must be the "Built by BetaNYC" line this page leaves out. If FOOTER
  // changes shape, stop the build so a person decides what the page should show.
  const last = paras[paras.length - 1] ?? "";
  if (!last.startsWith("Built by BetaNYC")) {
    throw new Error(`FOOTER's last paragraph no longer starts "Built by BetaNYC" ("${last.slice(0, 40)}..."); check scripts/lib/site/disclaimer.js`);
  }
  const out = paras.slice(0, -1).filter((p) => !p.startsWith("Built by BetaNYC"));
  if (out.length === 0) throw new Error("FOOTER has no disclaimer paragraphs");
  return out;
}

/** The plain text a reader sees for one paragraph: the Markdown bold marks removed. */
export function plainParagraph(p) {
  return p.replace(/\*\*/g, "");
}

/** One paragraph as HTML: **bold**, web addresses and email addresses as links. */
export function paragraphHtml(p) {
  const parts = p.split(/(\*\*[^*]+\*\*)/);
  return parts
    .map((part) => {
      const bold = /^\*\*([^*]+)\*\*$/.exec(part);
      const html = linkify(bold ? bold[1] : part);
      return bold ? `<strong>${html}</strong>` : html;
    })
    .join("");
}

// Links a bare https:// address or an email address. A sentence's final period is not part
// of the address.
function linkify(text) {
  const re = /(https?:\/\/[^\s]+?)(?=[.,;:)]?(?:\s|$))|([A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,})(?=[.,;:)]?(?:\s|$))/g;
  let out = "";
  let last = 0;
  for (const m of text.matchAll(re)) {
    out += escapeHtml(text.slice(last, m.index));
    const t = m[0];
    const href = m[1] ? t : `mailto:${t}`;
    out += `<a href="${escapeHtml(href)}">${escapeHtml(t)}</a>`;
    last = m.index + t.length;
  }
  return out + escapeHtml(text.slice(last));
}
