// Jump to a citation (issue #62): "§ 259", "259", "charter 259", "Section 259(a)", "chapter 11".
// Shared by the browser (law.js, search.js) and the build (scripts/lib/site/outputs.js writes
// each citation's keys with citationKeys), so the two cannot disagree. No dependencies; it
// fetches nothing itself.

/**
 * The keys a reader might type for a citation, lowercased: "§ 259" → ["259"]. A Rules record
 * also gets its title's form, since each title restarts its numbers: "§ 1-01" in Title 15 →
 * ["1-01", "15 rcny 1-01"] ("15 RCNY § 1-01", parseQuery).
 */
export function citationKeys(citation, title) {
  const c = String(citation).trim().toLowerCase();
  const sec = /^§\s*(\S+)$/.exec(c);
  const ch = /^chapter\s+(\S+)$/.exec(c);
  const key = sec ? sec[1] : ch ? `chapter ${ch[1]}` : c;
  return title ? [key, `${titleKey(title)} rcny ${key}`] : [key];
}

/** "15", "38-A", "38a", "015" → "15", "38-a": a Rules title number as keys hold it. */
function titleKey(t) {
  return String(t).toLowerCase().replace(/^0+(?=\d)/, "").replace(/^(\d+)-?([a-z])$/, "$1-$2");
}

// "15 RCNY § 1-01", "15 R.C.N.Y. 1-01", "Title 15 § 1-01", "RCNY Title 15, Chapter 18",
// "24 RCNY Health Code § 81.08", "Health Code § 81.08" (the Health Code is in Title 24). As
// src/corpus.ts parseTitledCitation reads them, lowercased.
const RCNY = String.raw`r\.?\s?c\.?\s?n\.?\s?y\b\.?`;
const TNUM = String.raw`\d+(?:-?[a-z](?![a-z]))?`;
const RCNY_FIRST = new RegExp(`^(${TNUM})\\s*${RCNY}[\\s,]*(.*)$`);
const TITLE_FIRST = new RegExp(`^(?:${RCNY}[\\s,]*)?title\\s+(${TNUM})(?=[\\s,§]|$)[\\s,]*(?:${RCNY}[\\s,]*)?(.*)$`);
const HEALTH_CODE = /^(?:(?:the\s+)?new york city\s+)?health code\b[\s,]*(.*)$/;

// Words a reader may put before a number, taken off one at a time.
const PREFIXES = [/^nyc\b\.?/, /^new york city\b/, /^city\b/, /^charter\b/, /^the\b/, /^sections?\b\.?/, /^sec\b\.?/, /^§+/];

/**
 * What a typed query asks for, or null when it is words to search: { key, anchor }.
 * "Section 259(a)(1)" → { key: "259", anchor: "(a)(1)" }; "Ch. 2-A" → { key: "chapter 2-a" }.
 */
export function parseQuery(query) {
  let q = String(query ?? "").toLowerCase().replace(/[\u2010-\u2015\u2212]/g, "-").replace(/\s+/g, " ").trim();
  // A Rules citation with its title: the title, then the rest as any citation.
  const titled = RCNY_FIRST.exec(q) ?? TITLE_FIRST.exec(q);
  const hc = HEALTH_CODE.exec(titled ? titled[2] : q);
  if (titled || hc) {
    const rest = hc ? hc[1] : titled[2];
    const inner = rest ? parseQuery(rest) : null;
    if (!inner) return null;
    return { key: `${titled ? titleKey(titled[1]) : "24"} rcny ${inner.key}`, anchor: inner.anchor };
  }
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

/**
 * A citation for a part of a section, as a reader writes it: the section's citation and the
 * part's anchor. A subdivision anchor is added on ("NYC Charter § 259" + "(b)(1)"). A subsection
 * anchor (issue #76) starts with the subsection's number, which repeats the section's: it takes
 * the section number's place, so "… Section FC 102" + "102.4(1)" is "… Section FC 102.4(1)",
 * never "… Section FC 102102.4(1)". A subsection number that does not start with the section's
 * (a publisher's typo, or the Rules' "3.1.1" under "SECTION I") follows a comma.
 */
export function citeWithAnchor(cite, anchor) {
  const c = String(cite ?? "");
  const a = String(anchor ?? "");
  if (!a) return c;
  if (a.startsWith("(")) return c + a;
  const at = a.indexOf("(");
  const key = at < 0 ? a : a.slice(0, at);
  const num = /(\S+)$/.exec(c)?.[1] ?? "";
  if (num && key.toLowerCase().startsWith(`${num.toLowerCase()}.`)) return c.slice(0, c.length - num.length) + a;
  return c ? `${c}, ${a}` : a;
}

/**
 * The id of a part of a section in a chapter page's copy: "s-4" + "(b)(1)" is "s-4(b)(1)". A
 * subsection anchor starts with a digit or letter, so "_" (never in a slug) marks where the slug
 * ends: "s-fc-102_102.4(1)", which splitCopyId reads back.
 */
export function copyId(slug, anchor = "") {
  return !anchor || anchor.startsWith("(") ? `s-${slug}${anchor}` : `s-${slug}_${anchor}`;
}

/** A copy's id without its "s-", split into the section's slug and the anchor: "fc-102_102.4(1)" → { slug: "fc-102", anchor: "102.4(1)" }. */
export function splitCopyId(rest) {
  const u = rest.indexOf("_");
  if (u >= 0) return { slug: rest.slice(0, u), anchor: rest.slice(u + 1) };
  const at = rest.indexOf("(");
  return at < 0 ? { slug: rest, anchor: "" } : { slug: rest.slice(0, at), anchor: rest.slice(at) };
}
