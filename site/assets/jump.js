// Jump to a citation (issue #62): "§ 259", "259", "charter 259", "Section 259(a)", "chapter 11".
// Shared by the browser (law.js, search.js) and the build (scripts/lib/site/outputs.js writes
// each citation's keys with citationKeys), so the two cannot disagree. No dependencies; it
// fetches nothing itself.

/** The keys a reader might type for a citation, lowercased: "§ 259" → ["259"]. */
export function citationKeys(citation) {
  const c = String(citation).trim().toLowerCase();
  const sec = /^§\s*(\S+)$/.exec(c);
  if (sec) return [sec[1]];
  const ch = /^chapter\s+(\S+)$/.exec(c);
  if (ch) return [`chapter ${ch[1]}`];
  return [c];
}

// Words a reader may put before a number, taken off one at a time.
const PREFIXES = [/^nyc\b\.?/, /^new york city\b/, /^city\b/, /^charter\b/, /^the\b/, /^sections?\b\.?/, /^sec\b\.?/, /^§+/];

/**
 * What a typed query asks for, or null when it is words to search: { key, anchor }.
 * "Section 259(a)(1)" → { key: "259", anchor: "(a)(1)" }; "Ch. 2-A" → { key: "chapter 2-a" }.
 */
export function parseQuery(query) {
  let q = String(query ?? "").toLowerCase().replace(/\s+/g, " ").trim();
  for (let changed = true; changed && q; ) {
    changed = false;
    for (const p of PREFIXES) {
      const next = q.replace(p, "").trim();
      if (next !== q) {
        q = next;
        changed = true;
      }
    }
  }
  if (!q) return null;
  if (q === "preamble" || q === "introductory") return { key: q, anchor: "" };
  const ch = /^(?:chapter|ch\.?)\s*([0-9]+(?:-[a-z]+)?)$/.exec(q);
  if (ch) return { key: `chapter ${ch[1]}`, anchor: "" };
  const sec = /^([0-9][0-9a-z.-]*?)\.?\s?((?:\([0-9a-z]+\))*)$/.exec(q);
  if (sec) return { key: sec[1], anchor: sec[2] ?? "" };
  return null;
}

/**
 * The citation list's entries the query names, and the subdivision anchor it asked for.
 * `list` is citations.json: [{ k: keys, c: citation, h: heading, p: path, b: book }].
 */
export function lookup(list, query) {
  const parsed = parseQuery(query);
  if (!parsed) return { matches: [], anchor: "" };
  return { matches: list.filter((e) => e.k.includes(parsed.key)), anchor: parsed.anchor };
}

/** Where a single match goes: its path, plus the anchor when the reader named a subdivision. */
export function jumpTarget(entry, anchor) {
  return anchor ? `${entry.p}#${anchor}` : entry.p;
}

/**
 * Pagefind gives each result's file ("/charter/sections/259.html"); the site's address has no
 * ".html" (GitHub Pages serves the file at the shorter address, which is the canonical one).
 */
export function pageUrl(url) {
  return String(url ?? "").replace(/\.html(?=$|[#?])/, "");
}
