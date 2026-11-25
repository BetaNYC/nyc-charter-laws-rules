// Jump to a citation (issue #62): "§ 259", "259", "charter 259", "Section 259(a)", "chapter 11".
// Shared by the browser (law.js, search.js) and the build (scripts/lib/site/outputs.js writes
// each citation's keys with recordKeys), so the two cannot disagree. No dependencies; it
// fetches nothing itself.

/** Lowercased, any dash a hyphen, spaces collapsed: how keys and queries are compared. */
function fold(s) {
  return String(s ?? "").toLowerCase().replace(/[‐-―−]/g, "-").replace(/\s+/g, " ").trim();
}

// The Construction Codes' and the Fire Code's letters, as the Administrative Code cites their
// sections ("Section FC 102", "Section BC E104"): Plumbing, Building, Mechanical, Fuel Gas,
// Electrical, Existing Building, Fire. src/corpus.ts CODE_SUBSECTION has the same list.
const CODES = "pc|bc|mc|fgc|ec|ebc|fc";
const CODE_CITATION = new RegExp(`^(?:section|§)\\s*(${CODES})\\s+([a-z]?\\d+)$`);

/**
 * The keys a reader might type for a citation, lowercased: "§ 259" → ["259"]. A building or fire
 * code section is keyed by its code and number, "Section FC 102" → ["fc 102"] (issue #76). A
 * record in a title (the Administrative Code's and the Rules') also gets the title's form, "title
 * 28 chapter 1", which both books share; a Rules record gets the Rules' own form too, since each
 * Rules title restarts its numbers: "§ 1-01" in Title 15 → ["1-01", "title 15 1-01", "15 rcny
 * 1-01"] ("15 RCNY § 1-01", parseQuery). Any other citation is its own key ("RS 18-1" → ["rs
 * 18-1"], "D302 Conversions to a multiple dwelling (MDL 9(2))").
 * @param {string} citation
 * @param {string} [title]          the record's title number ("15", "38-A")
 * @param {{ rules?: boolean }} [o] a Rules record
 */
export function citationKeys(citation, title, { rules = false } = {}) {
  const c = fold(citation);
  const sec = /^§\s*(\S+)$/.exec(c);
  const ch = /^chapter\s+(\S+)$/.exec(c);
  const code = CODE_CITATION.exec(c);
  const key = sec ? sec[1] : ch ? `chapter ${ch[1]}` : code ? `${code[1]} ${code[2]}` : c;
  if (!title) return [key];
  const t = titleKey(title);
  return rules ? [key, `title ${t} ${key}`, `${t} rcny ${key}`] : [key, `title ${t} ${key}`];
}

/**
 * Every key a record has in citations.json: its citationKeys, and the key its own full citation
 * (`full`, what "Copy citation" gives) reads as, when that is not one of them. So a citation the
 * site gives always leads back to its page: "15 RCNY Chapter 19.1, Appendix", "NYC
 * Administrative Code Local laws, 1985".
 * @param {string} citation
 * @param {string} [title]
 * @param {{ rules?: boolean }} [o]
 * @param {string} [full]
 */
export function recordKeys(citation, title, o, full) {
  const keys = citationKeys(citation, title, o);
  const own = full ? parseQuery(full) : null;
  if (own && !keys.includes(own.key)) keys.push(own.key);
  return keys;
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

// A book named first, as the site's "Copy citation" writes it ("NYC Charter § 1133", "NYC
// Administrative Code § 27-506") or a person does ("Admin. Code § 27-506", "New York City
// Charter § 1133"), the way src/corpus.ts parseBookName reads it.
const BOOK = /^(?:the\s+)?(?:(?:nyc|n\.\s?y\.\s?c\.?|new york city|city)\s+)?(?:(charter)|(?:administrative|admin\.?)\s*code)\b\.?[\s,]*(.*)$/;
/** The Charter's and the Administrative Code's book names in citations.json (`b`): config.js `short`. */
export const CHARTER_BOOK = "Charter";
export const ADMIN_BOOK = "Admin Code";

// A subdivision's anchor after a citation, lowercased: labels in parentheses as
// scripts/lib/build-structure.js writes them ("(b)(1)", "(h-1)", "(4-a)"), and the "-2" it adds
// to the second anchor of the same name in a section ("(3)-2"). Or nothing.
const ANCHOR = String.raw`(?:(?:\([0-9a-z][0-9a-z.-]{0,5}\))+(?:-\d+)?)?`;
// A section number and its anchor: "259", "259(a)(1)", "11-245.1-a", "3501(3)-2".
const SEC_QUERY = new RegExp(String.raw`^([0-9][0-9a-z.-]*?)\.?\s?(${ANCHOR})$`);

// A Rules section number with a subsection's after it: "1-01" + ".1", "19.1-01" + ".1.2". A Rules
// title may also have a section "§ 1-01.1" of its own, so this is only tried when it has none.
const RULES_SUBSECTION = /^(.*\d-\d+[a-z]?)((?:\.\d+[a-z]?)+)(?:-\d+)?$/;
// A citation that is its own key, and the anchor that may end it: "e.2(1)", "chapter 4, § 4-11(a)".
const LITERAL = new RegExp(String.raw`^(.*?\S)\s?(${ANCHOR})$`);

/** A citation that is its own key ("2 rcny appendix a"), and as a `part`, the same without an anchor at its end. */
function literal(prefix, text) {
  const m = LITERAL.exec(text);
  const key = `${prefix}${text}`;
  return m && m[2] ? { key, anchor: "", part: { key: `${prefix}${m[1]}`, anchor: m[2] } } : { key, anchor: "" };
}

// Words a reader may put before a number, taken off one at a time.
const PREFIXES = [/^nyc\b\.?/, /^new york city\b/, /^city\b/, /^charter\b/, /^the\b/, /^sections?\b\.?/, /^sec\b\.?/, /^§+/];

// A building or fire code section, once "Section" or "§" is taken off: "fc 102", "fc102", "bc
// e104", "fc 102.4(1)" (subsection 102.4, item (1)), "bc 908.10-2" (the second subsection 908.10
// in its section: build-structure.js adds "-2" to an anchor's second use).
const CODE_QUERY = new RegExp(`^(${CODES})\\s*([a-z]?\\d+)((?:\\.\\d+[a-z]?)*)(-\\d+)?\\s?(${ANCHOR})$`);
// A reference standard: "rs 18-1", "reference standard rs 18-1", "reference standard 18-1".
const RS_QUERY = new RegExp(String.raw`^(?:reference standards?\s+(?:rs[\s-]*)?|rs[\s-]*)(\d[0-9a-z.[\]-]*?)\s?(${ANCHOR})$`);

/**
 * What a typed query asks for, or null when it is words to search: { key, anchor }; `shared:
 * true` for "Title 28, Chapter 1", a form both titled books use (see lookup); `book` when it
 * names one ("NYC Charter § 259" → "Charter": lookup looks only there); and `part` for a part of
 * a section with no record of its own, tried when no record has the key itself: a building or
 * fire code subsection, a Rules subsection ("2 RCNY § 1-01.1"), or an anchor at the end of a
 * citation that is its own key ("NYC Administrative Code E.2(1)").
 * "Section 259(a)(1)" → { key: "259", anchor: "(a)(1)" }; "Ch. 2-A" → { key: "chapter 2-a" };
 * "15 RCNY § 1-01" → { key: "15 rcny 1-01" }; "Title 28, Chapter 1" → { key: "title 28 chapter 1", shared: true };
 * "Section FC 102.4(1)" → { key: "fc 102.4", anchor: "(1)", part: { key: "fc 102", anchor: "102.4(1)" } }.
 * After a book's name or a title's ("2 RCNY Appendix A"), a citation that is not a number is its
 * own key ("NYC Administrative Code D302 Conversions ..."); with neither, words are words.
 */
export function parseQuery(query) {
  const q = fold(query);
  const b = BOOK.exec(q);
  if (b) {
    if (!b[2]) return null;
    const { shared: _shared, ...inner } = parseCitation(b[2]) ?? literal("", b[2]);
    return asTyped(query, { ...inner, book: b[1] ? CHARTER_BOOK : ADMIN_BOOK });
  }
  return asTyped(query, parseCitation(q));
}

// Labels in parentheses in the case they were typed: anchors keep the publisher's case
// ("(d)(2)(C)"), and a citation the site copied has it. Keys are compared lowercased.
function asTyped(query, parsed) {
  if (!parsed) return parsed;
  const typed = String(query).replace(/[\u2010-\u2015\u2212]/g, "-").replace(/\s+/g, " ").trim();
  const keepCase = (a) => {
    const tail = typed.slice(typed.length - a.length);
    if (!a || tail.toLowerCase() !== a.toLowerCase()) return a;
    let depth = 0;
    let out = "";
    for (let i = 0; i < a.length; i++) {
      if (a[i] === "(") depth++;
      out += depth > 0 ? tail[i] : a[i];
      if (a[i] === ")") depth--;
    }
    return out;
  };
  const out = { ...parsed, anchor: keepCase(parsed.anchor) };
  if (parsed.part) out.part = { ...parsed.part, anchor: keepCase(parsed.part.anchor) };
  return out;
}

// parseQuery for a query that names no book, folded.
function parseCitation(query) {
  let q = query;
  // A Rules citation with its title: the title, then the rest as any citation.
  let m = RCNY_FIRST.exec(q);
  let title = m?.[1];
  let rest = m?.[2];
  if (!m && (m = TITLE_RCNY.exec(q))) [title, rest] = [m[1] ?? m[2], m[3]];
  const hc = HEALTH_CODE.exec(m ? rest : q);
  if (m || hc) {
    const inner = hc ? (hc[1] ? parseCitation(hc[1]) : null) : rest ? parseCitation(rest) : null;
    if (inner?.shared) return null;
    // "2 RCNY Appendix A", "24 RCNY New York City Health Code": the rest is the citation.
    if (!inner) return m && rest ? literal(`${titleKey(title)} rcny `, rest) : null;
    const t = m ? titleKey(title) : "24";
    const out = { key: `${t} rcny ${inner.key}`, anchor: inner.anchor };
    // "2 RCNY § 1-01.1" with no section of that number: subsection 1-01.1 of § 1-01.
    const sub = inner.part ? null : RULES_SUBSECTION.exec(inner.key);
    if (sub) out.part = { key: `${t} rcny ${sub[1]}`, anchor: `${inner.key}${inner.anchor}` };
    return out;
  }
  // "Title 28, Chapter 1": the Administrative Code's or the Rules'.
  const plain = TITLE_ONLY.exec(q);
  if (plain) {
    const inner = plain[2] ? parseCitation(plain[2]) : null;
    if (inner?.shared) return null;
    // "Title 6, Chapter 2, Subchapter B": a record's own citation is its key.
    if (!inner) return plain[2] ? literal("", q) : null;
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
  const sec = SEC_QUERY.exec(q);
  if (sec) return { key: sec[1], anchor: sec[2] ?? "" };
  const code = CODE_QUERY.exec(q);
  if (code) {
    const [, letters, number, points, again = "", parens] = code;
    const key = `${letters} ${number}`;
    if (!points) return again ? null : { key, anchor: parens };
    // No code section's own number has a point, so "fc 102.4" is subsection 102.4 of FC 102,
    // whose anchor is its number as the publisher writes it ("102.4", "E104.2.2").
    const sub = `${number.replace(/^[a-z]/, (l) => l.toUpperCase())}${points}`;
    return { key: `${key}${points}`, anchor: parens, part: { key, anchor: `${sub}${again}${parens}` } };
  }
  const rs = RS_QUERY.exec(q);
  if (rs) return { key: `rs ${rs[1]}`, anchor: rs[2] };
  return null;
}

/** The Rules' book name in citations.json (`b`). */
export const RULES_BOOK = "Rules";

/**
 * The citation list's entries the query names, the subdivision anchor it asked for, and `jump`:
 * whether to go straight to the one match. A query that names a book looks only there: "NYC
 * Administrative Code § 1133" never goes to the Charter's § 1133. "Title 28, Chapter 1" (shared)
 * goes straight only to an Administrative Code page; when the Rules have one, the reader picks
 * (the search page's list), since only "28 RCNY …" names the Rules. A building or fire code
 * subsection with no record of its own ("FC 102.4(1)") goes to its section's page, at the
 * subsection. `list` is citations.json: [{ k: keys, c: citation, h: heading, p: path, b: book }].
 */
export function lookup(list, query) {
  const parsed = parseQuery(query);
  if (!parsed) return { matches: [], anchor: "", jump: false };
  const find = (key) => list.filter((e) => e.k.includes(key) && (!parsed.book || e.b === parsed.book));
  let matches = find(parsed.key);
  let anchor = parsed.anchor;
  if (!matches.length && parsed.part) {
    matches = find(parsed.part.key);
    anchor = parsed.part.anchor;
  }
  const jump = matches.length === 1 && !(parsed.shared && matches[0].b === RULES_BOOK);
  return { matches, anchor, jump };
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
