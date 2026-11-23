// Small HTML helpers for the site build. Every value that comes from the data goes through
// escapeHtml before it reaches a page.

const ESC = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };

export function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ESC[c]);
}

/** JSON for a <script type="application/ld+json"> block: "<" escaped so text cannot end it. */
export function jsonForScript(value) {
  return JSON.stringify(value).replace(/</g, "\\u003c");
}

/** Decode the entities escapeHtml writes (tests read pages back with this). */
export function unescapeHtml(s) {
  return String(s)
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&");
}
