// Jump to a citation (issue #62): "§ 259", "259", "charter 259", "Section 259(a)", "chapter 11".
// Shared by the browser (law.js, search.js) and the build (scripts/lib/site/outputs.js writes
// each citation's keys with citationKeys), so the two cannot disagree. No dependencies; it
// fetches nothing itself.

/**
 * The keys a reader might type for a citation, lowercased: "§ 259" → ["259"]. A record in a
 * title (the Administrative Code's and the Rules') also gets the title's form, "title 28 chapter
 * 1", which both books share; a Rules record gets the Rules' own form too, since each Rules title
 * restarts its numbers: "§ 1-01" in Title 15 → ["1-01", "title 15 1-01", "15 rcny 1-01"]
 * ("15 RCNY § 1-01", parseQuery).
 * @param {string} citation
 * @param {string} [title]          the record's title number ("15", "38-A")
 * @param {{ rules?: boolean }} [o] a Rules record
 */
export function citationKeys(citation, title, { rules = false } = {}) {
  const c = String(citation).trim().toLowerCase();
  const sec = /^§\s*(\S+)$/.exec(c);
  const ch = /^chapter\s+(\S+)$/.exec(c);
  const key = sec ? sec[1] : ch ? `chapter ${ch[1]}` : c;
  if (!title) return [key];
  const t = titleKey(title);
  return rules ? [key, `title ${t} ${key}`, `${t} rcny ${key}`] : [key, `title ${t} ${key}`];
}

/** "15", "38-A", "38a", "015" → "15", "38-a": a Rules title number as keys hold it. */
function titleKey(t) {
  return String(t).toLowerCase().replace(/^0+(?=\d)/, "").replace(/^(\d+)-?([a-z])$/, "$1-$2");
}

// The Rules' own forms, as src/corpus.ts parseTitledCitation reads them, lowercased: "15 RCNY §
// 1-01", "15 R.C.N.Y. 1-01", "RCNY Title 15, Chapter 18", "Title 15 RCNY § 1-01", "24 RCNY Health
// Code § 81.08", "Health Code § 81.08" (the Health Code is in Title 24). These name the Rules.
// "Title 28, Chapter 1" alone does not: the Administrative Code's pages cite its chapters that
// way too (TITLE_ONLY), so it is a key both books share, and never jumps straight to the Rules.
const RCNY = String.raw`r\.?\s?c\.?\s?n\.?\s?y\b\.?`;
const TNUM = String.raw`\d+(?:-?[a-z](?![a-z]))?`;
const RCNY_FIRST = new RegExp(`^(${TNUM})\\s*${RCNY}[\\s,]*(.*)$`);
const TITLE_RCNY = new RegExp(`^(?:${RCNY}[\\s,]*title\\s+(${TNUM})(?=[\\s,§]|$)[\\s,]*(?:${RCNY}[\\s,]*)?|title\\s+(${TNUM})(?=[\\s,§]|$)[\\s,]*${RCNY}[\\s,]*)(.*)$`);
const TITLE_ONLY = new RegExp(`^title\\s+(${TNUM})(?=[\\s,§]|$)[\\s,]*(.*)$`);
const HEALTH_CODE = /^(?:(?:the\s+)?new york city\s+)?health code\b[\s,]*(.*)$/;

// Words a reader may put before a number, taken off one at a time.
const PREFIXES = [/^nyc\b\.?/, /^new york city\b/, /^city\b/, /^charter\b/, /^the\b/, /^sections?\b\.?/, /^sec\b\.?/, /^§+/];

/**
 * What a typed query asks for, or null when it is words to search: { key, anchor }, and
 * `shared: true` for "Title 28, Chapter 1", a form both titled books use (see lookup).
 * "Section 259(a)(1)" → { key: "259", anchor: "(a)(1)" }; "Ch. 2-A" → { key: "chapter 2-a" };
 * "15 RCNY § 1-01" → { key: "15 rcny 1-01" }; "Title 28, Chapter 1" → { key: "title 28 chapter 1", shared: true }.
 */
export function parseQuery(query) {
  let q = String(query ?? "").toLowerCase().replace(/[\u2010-\u2015\u2212]/g, "-").replace(/\s+/g, " ").trim();
  // A Rules citation with its title: the title, then the rest as any citation.
  let m = RCNY_FIRST.exec(q);
  let title = m?.[1];
  let rest = m?.[2];
  if (!m && (m = TITLE_RCNY.exec(q))) [title, rest] = [m[1] ?? m[2], m[3]];
  const hc = HEALTH_CODE.exec(m ? rest : q);
  if (m || hc) {
    const inner = hc ? (hc[1] ? parseQuery(hc[1]) : null) : rest ? parseQuery(rest) : null;
    if (!inner || inner.shared) return null;
    return { key: `${m ? titleKey(title) : "24"} rcny ${inner.key}`, anchor: inner.anchor };
  }
  // "Title 28, Chapter 1": the Administrative Code's or the Rules'.
  const plain = TITLE_ONLY.exec(q);
  if (plain) {
    const inner = plain[2] ? parseQuery(plain[2]) : null;
    if (!inner || inner.shared) return null;
    return { key: `title ${titleKey(plain[1])} ${inner.key}`, anchor: inner.anchor, shared: true };
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
  const ch = /^(?:chapter|ch\.?)\s*([0-9]+(?:\.[0-9]+)?(?:-?[a-z]+)?)$/.exec(q);
  if (ch) return { key: `chapter ${ch[1]}`, anchor: "" };
  const sec = /^([0-9][0-9a-z.-]*?)\.?\s?((?:\([0-9a-z]+\))*)$/.exec(q);
  if (sec) return { key: sec[1], anchor: sec[2] ?? "" };
  return null;
}

/** The Rules' book name in citations.json (`b`). */
export const RULES_BOOK = "Rules";

/**
 * The citation list's entries the query names, the subdivision anchor it asked for, and `jump`:
 * whether to go straight to the one match. "Title 28, Chapter 1" (shared) goes straight only to
 * an Administrative Code page; when the Rules have one, the reader picks (the search page's
 * list), since only "28 RCNY …" names the Rules. `list` is citations.json:
 * [{ k: keys, c: citation, h: heading, p: path, b: book }].
 */
export function lookup(list, query) {
  const parsed = parseQuery(query);
  if (!parsed) return { matches: [], anchor: "", jump: false };
  const matches = list.filter((e) => e.k.includes(parsed.key));
  const jump = matches.length === 1 && !(parsed.shared && matches[0].b === RULES_BOOK);
  return { matches, anchor: parsed.anchor, jump };
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
