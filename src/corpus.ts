import { existsSync, readFileSync } from "fs";
import { join, dirname, resolve } from "path";
import { homedir } from "os";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

// The index shipped inside the package. npm installs carry the text as of the
// release that bundled it; the daily refresh only updates `main` (issue #26).
export const BUNDLED_INDEX_DIR = join(__dirname, "..", "data", "index", "json");

// Set this to a directory laid out like the repo's data/index/json/ (for
// example a sparse clone kept current with `git pull`) to serve that text
// instead of the bundled copy.
export const INDEX_DIR_ENV = "NYC_LAWS_INDEX_DIR";

// Resolve the index directory once, at startup. An override that does not hold
// a versions.json fails loudly here rather than on the first tool call, and is
// never silently replaced by the bundled index.
export function resolveIndexDir(
  env: NodeJS.ProcessEnv = process.env
): string {
  const override = env[INDEX_DIR_ENV]?.trim();
  if (!override) return BUNDLED_INDEX_DIR;
  // A leading "~/" is expanded here because MCP clients pass env values
  // through without a shell. Other relative paths resolve against the
  // server process's working directory, which the MCP client chooses.
  const expanded =
    override === "~" || override.startsWith("~/")
      ? join(homedir(), override.slice(1))
      : override;
  const dir = resolve(expanded);
  if (!existsSync(join(dir, "versions.json"))) {
    throw new Error(
      `${INDEX_DIR_ENV} is set to "${override}", but ${join(dir, "versions.json")} ` +
        `does not exist. Point it at a directory laid out like data/index/json/ ` +
        `(versions.json, charter.json, admin_code.json, rules.json), or unset it ` +
        `to use the index bundled with this package.`
    );
  }
  return dir;
}

export const INDEX_DIR = resolveIndexDir();

export type Corpus = "charter" | "admin_code" | "rules";

export interface Section {
  corpus: Corpus;
  id: string;
  citation: string;
  heading: string;
  text: string;
  /**
   * The publisher's level for the record (issue #78), left out for a section inside a chapter,
   * nearly every record: "Chapter" for a chapter; "Section" for a section with no chapter around
   * it; or a group level such as "Appendix", "Part", "Subchapter" or "Article" for text held
   * outside a section (the Title 27 Building Code Reference Standards, the Rules' appendices and
   * schedules, editor's notes). Absent on every record of an index built before 0.7.0.
   */
  level?: string;
  /**
   * Administrative Code and Rules only (issue #59): the number of the Title the record is in, as
   * the publisher's Title heading writes it ("15", "16-A", "38-A"). Each title of the Rules
   * restarts its numbers, so "15 RCNY § 1-01" is `titleNumber` + " RCNY " + `citation`. Absent
   * for the Charter (no titles), for records in no numbered title (the Administrative Code's
   * unconsolidated local laws), and on every record of an index built before 0.7.0.
   * scripts/lib/build-corpus.js ("Titles") says where it is read from.
   */
  titleNumber?: string;
  /** On a chapter record with a `titleNumber`: that Title's heading ("Title 15: Department of Environmental Protection"). */
  titleHeading?: string;
}

export interface CorpusVersion {
  currentThrough: string;
  indexedAt: string;
  sectionCount: number;
}

export interface Versions {
  charter: CorpusVersion;
  admin_code: CorpusVersion;
  rules: CorpusVersion;
}

// Lazy-loaded per-corpus index.
const cache: Partial<Record<Corpus, Section[]>> = {};
let versionsCache: Versions | null = null;

const CORPUS_NAMES: Record<Corpus, string> = {
  charter: "New York City Charter",
  admin_code: "New York City Administrative Code",
  rules: "Rules of the City of New York",
};

// A missing or unreadable index file. The message goes to the person asking, so it names the
// document and what to do, never a path on the server: the path and the cause go to stderr,
// where the operator sees them (stdout carries the protocol).
function indexUnavailable(what: string, path: string, err: unknown): Error {
  const cause = err instanceof Error ? err.message : String(err);
  console.error(`nyc-charter-laws-rules: cannot read ${path}: ${cause}`);
  return new Error(
    `The index for ${what} is missing or unreadable on this server, so it cannot answer from it. ` +
      `Whoever runs this server should reinstall the package, or rebuild the index with ` +
      `"npm run build-index"; if ${INDEX_DIR_ENV} is set, check that it points at a complete index.`
  );
}

function readIndexJson<T>(what: string, file: string): T {
  const path = join(INDEX_DIR, file);
  try {
    return JSON.parse(readFileSync(path, "utf8")) as T;
  } catch (err) {
    throw indexUnavailable(what, path, err);
  }
}

function loadCorpus(corpus: Corpus): Section[] {
  if (cache[corpus]) return cache[corpus]!;
  cache[corpus] = readIndexJson<Section[]>(`the ${CORPUS_NAMES[corpus]}`, `${corpus}.json`);
  return cache[corpus]!;
}

function loadVersions(): Versions {
  if (versionsCache) return versionsCache;
  versionsCache = readIndexJson<Versions>("the document dates (versions.json)", "versions.json");
  return versionsCache;
}

export function getVersions(): Versions {
  return loadVersions();
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Relevance-ranked search. Scoring (documented in the tool description):
//   heading match > citation match > body match; whole-word > substring.
// All matches across the requested corpora are scored and sorted before
// truncating to `limit`, so admin_code/rules results are reachable even when
// charter has many substring hits. Ties keep corpus/document order (stable sort).
export function searchCorpus(
  query: string,
  corpus: Corpus | "all" = "all",
  limit = 10
): Section[] {
  return rankPhrase(query, corpus).slice(0, limit);
}

// Short terms match whole words only (issue #95). A query, or in the word fallback a term, with
// 3 or fewer letters and digits matches only where no letter or digit touches it on either side:
// "x" is the word x, not the x in "wax"; "tax" is not the start of "taxes". A longer one matches
// as before: the phrase anywhere, a term at the start of a word. Through 0.7.x "a" matched inside
// nearly every section (22,150 of 22,637). The same rule, and the same limit, as BetaNYC's
// nyc-budget-mcp text filters. Only letters and digits count, so "s ≥ 4t" is short.
export const SHORT_TERM_MAX = 3;
export function isShortTerm(term: string): boolean {
  const n = term.match(/[\p{L}\p{N}]/gu)?.length ?? 0;
  return n > 0 && n <= SHORT_TERM_MAX;
}

const NOT_AFTER_WORD = "(?<![\\p{L}\\p{N}])";
const NOT_BEFORE_WORD = "(?![\\p{L}\\p{N}])";

/**
 * Where the phrase stage matches `query` (already trimmed, quotes removed): anywhere, or for a
 * short query, as whole words (isShortTerm). A boundary is checked only at an end that is a
 * letter or digit, so a short query that ends in a sign still matches.
 */
export function phraseRegExp(query: string): RegExp {
  const body = escapeRegExp(query);
  if (!isShortTerm(query)) return new RegExp(body, "iu");
  const pre = /^[\p{L}\p{N}]/u.test(query) ? NOT_AFTER_WORD : "";
  const post = /[\p{L}\p{N}]$/u.test(query) ? NOT_BEFORE_WORD : "";
  return new RegExp(`${pre}${body}${post}`, "iu");
}

// Every section matching the phrase, best first (searchCorpus without the cut), so a
// response can say how many matched in all (issue #42).
function rankPhrase(query: string, corpus: Corpus | "all"): Section[] {
  const corpora: Corpus[] =
    corpus === "all" ? ["charter", "admin_code", "rules"] : [corpus];

  const q = query.trim().toLowerCase();
  if (!q) return [];
  const wordRe = new RegExp(`\\b${escapeRegExp(q)}\\b`, "i");
  // A short query matches whole words only (isShortTerm); a longer one anywhere, as through 0.7.x.
  const short = isShortTerm(q) ? phraseRegExp(q) : null;
  const has = (field: string) => (short ? short.test(field) : field.toLowerCase().includes(q));
  const scored: { s: Section; score: number }[] = [];

  for (const c of corpora) {
    const sections = loadCorpus(c);
    for (const s of sections) {
      const inHeading = has(s.heading);
      const inCitation = has(s.citation);
      const inText = has(s.text);
      if (!inHeading && !inCitation && !inText) continue;

      let score = 0;
      if (inHeading) score += 100 + (wordRe.test(s.heading) ? 30 : 0);
      if (inCitation) score += 50 + (wordRe.test(s.citation) ? 15 : 0);
      if (inText) score += 10 + (wordRe.test(s.text) ? 5 : 0);
      scored.push({ s, score });
    }
  }

  scored.sort((a, b) => b.score - a.score); // Array.sort is stable
  return scored.map((r) => r.s);
}

// Words dropped from a query before term matching (issue #30): question words,
// auxiliary verbs, pronouns, articles and common prepositions. Kept short and
// explicit so a reader can see exactly what is ignored. Only the term stages
// use it; a query that matches as a whole phrase is searched exactly as typed.
export const SEARCH_STOPWORDS: ReadonlySet<string> = new Set([
  // question words
  "who", "whom", "whose", "what", "which", "when", "where", "why", "how",
  // auxiliary and modal verbs
  "is", "are", "was", "were", "be", "been", "being", "am",
  "do", "does", "did", "doing", "done",
  "have", "has", "had", "having",
  "can", "could", "shall", "should", "will", "would", "may", "might", "must",
  // pronouns and determiners
  "i", "me", "my", "we", "us", "our", "you", "your", "he", "him", "his",
  "she", "her", "it", "its", "they", "them", "their", "there",
  "this", "that", "these", "those", "a", "an", "the", "any", "some",
  // prepositions and conjunctions
  "of", "to", "in", "on", "at", "for", "by", "with", "about", "from", "into",
  "up", "out", "as", "and", "or", "if", "so", "than", "then",
]);

// Split a query into search terms: lowercase words (letters, digits, and
// inner "." "-" "'" so "28-220.1" and "owner's" stay whole), minus stopwords,
// de-duplicated in query order.
export function queryTerms(query: string): string[] {
  const words = query.toLowerCase().match(/[\p{L}\p{N}](?:[\p{L}\p{N}.'’-]*[\p{L}\p{N}])?/gu) ?? [];
  const terms: string[] = [];
  for (const w of words) {
    if (!SEARCH_STOPWORDS.has(w) && !terms.includes(w)) terms.push(w);
  }
  return terms;
}

// A term matches at the start of a word, and a trailing plural "s" is dropped
// first, so "tanks" matches "tank" and "shed" matches "sheds" but "shed" does
// not match "established" and "long" does not match "belong". There is no
// check at the end of the word, so "car" also matches "carbon" and "card".
// That is on purpose: it is also what lets "appoints" find "appointed". Tried in
// the #49 review: a whole-word check (allowing only a plural s or es) took the
// eval from 15 to 14 of 17 (Q17, the police commissioner, broke), so it is not used.
// A term of 3 or fewer letters and digits (isShortTerm) matches whole words only (issue #95):
// "own" is not "owner", "tax" is not "taxes".
function termRegExp(term: string): RegExp {
  if (isShortTerm(term)) return new RegExp(`${NOT_AFTER_WORD}${escapeRegExp(term)}${NOT_BEFORE_WORD}`, "iu");
  const stem =
    term.length > 3 && term.endsWith("s") && !term.endsWith("ss")
      ? term.slice(0, -1)
      : term;
  return new RegExp(`${NOT_AFTER_WORD}${escapeRegExp(stem)}`, "iu");
}

export type SearchMode = "phrase" | "all-terms" | "some-terms";

export interface SearchOutcome {
  results: Section[];
  // phrase: the whole query matched as typed (searchCorpus, unchanged).
  // all-terms: no phrase match; every result contains every term.
  // some-terms: at least one returned section lacks a term. The caller must say so.
  mode: SearchMode;
  terms: string[];
  // How many of `results` contain every term (all of them unless some-terms). They are not
  // necessarily the first ones: the word fallback sorts by score alone.
  allTermResults: number;
  // How many sections matched in all, before the cut to `limit` (issue #42). In the term
  // modes this counts every section with ANY one term, so it is not a count of good
  // matches: use allTermTotal for that.
  total: number;
  // How many sections contain every term, before the cut to `limit`. Equals `total` for a
  // phrase match.
  allTermTotal: number;
  // What was matched, for a snippet around the first match (issue #95): the phrase's pattern,
  // or one per term. Not global, so exec() always starts at the beginning.
  patterns: RegExp[];
  // The phrase as searched (trimmed, quotes removed), when it matched.
  phrase: string;
  // Which of the phrase (phrase mode) or the terms (term modes) matched as whole words only.
  wholeWords: string[];
}

// Quotes around the whole query mark it as a phrase; they are not part of it.
// Strips one surrounding pair of straight or curly quotes, double or single:
// "open data", “open data”, 'open data', ‘open data’ all become open data.
// A query holding more than one quoted piece ("open" and "data") is left as
// typed; an apostrophe inside a word (owner's) does not count as a quote.
const SURROUNDING_QUOTES = /^\s*["“”'‘’]\s*(.*?)\s*["“”'‘’]\s*$/s;
export function stripSurroundingQuotes(query: string): string {
  const m = SURROUNDING_QUOTES.exec(query);
  if (!m || !m[1]) return query;
  const inner = m[1];
  const withoutApostrophes = inner.replace(/(?<=[\p{L}\p{N}])['’](?=[\p{L}\p{N}])/gu, "");
  return /["“”'‘’]/.test(withoutApostrophes) ? query : inner;
}

// How the word fallback ranks sections (round 2 of the #49 review). Through 0.6.0 a section
// containing more of the query's words always ranked first, before any weight applied, so a
// long definitions section that happened to hold every word beat the one section about the
// question. Now each section gets one score, built from the parts below, and the sort is by
// that score alone. Plain arithmetic, no dependency.

// A word in the heading or citation counts this many times its weight in the body. Headings
// name what a section is about; the body of a long section mentions everything.
export const HEADING_WEIGHT = 3;

// Sections shorter than this many characters are mostly empty headings and "[Repealed]" stubs:
// their heading can hold every word with nothing behind it. Their score is multiplied by
// SHORT_SECTION_FACTOR.
export const SHORT_SECTION_CHARS = 100;
export const SHORT_SECTION_FACTOR = 0.3;

// Local Law appendix records ("L.L. 2016/002"): the text of an amending law, which repeats
// words from the sections it changes. They are rarely the answer, so they count half.
export const LOCAL_LAW_APPENDIX_FACTOR = 0.5;
export const LOCAL_LAW_APPENDIX_HEADING = /^L\.L\. \d{4}\//;

interface TermHit {
  s: Section;
  inHeading: boolean[]; // per term: in the heading or the citation
  inAny: boolean[]; // per term: anywhere in the section
}

// One section's score for a word query, given each term's rarity weight (`rarity[i]`, the
// natural log of sections searched / sections containing term i) and the average text length
// of the sections searched:
//   1. Sum the rarity of each term it contains, times HEADING_WEIGHT when the term is in its
//      heading or citation. A rare word ("idling") counts more than a common one ("city").
//   2. Divide by 1 + log(1 + length / average length), so a very long section is pushed down
//      a little, not out: twice the average length divides by about 2.1.
//   3. Multiply by the share of all the terms' rarity it covers, so a section holding the rare
//      words beats one holding only the common ones.
//   4. Apply SHORT_SECTION_FACTOR and LOCAL_LAW_APPENDIX_FACTOR.
export function termScore(hit: TermHit, rarity: number[], averageLength: number): number {
  const totalRarity = rarity.reduce((a, b) => a + b, 0);
  let weight = 0;
  let covered = 0;
  hit.inAny.forEach((has, i) => {
    if (!has) return;
    weight += rarity[i] * (hit.inHeading[i] ? HEADING_WEIGHT : 1);
    covered += rarity[i];
  });
  let score = weight / (1 + Math.log(1 + hit.s.text.length / Math.max(averageLength, 1)));
  score *= totalRarity > 0 ? covered / totalRarity : 1;
  if (hit.s.text.length < SHORT_SECTION_CHARS) score *= SHORT_SECTION_FACTOR;
  if (LOCAL_LAW_APPENDIX_HEADING.test(hit.s.heading)) score *= LOCAL_LAW_APPENDIX_FACTOR;
  return score;
}

// Search with a fallback for plain-language questions (issue #30).
//   1. The whole query as a phrase (searchCorpus), minus any surrounding
//      quotes. If anything matches, that is the answer, unchanged from earlier
//      releases for an unquoted query.
//   2. Otherwise split it into terms (queryTerms) and score every section
//      that contains at least one of them with termScore(): rare words, words
//      in the heading, and sections of ordinary length count more. Sections
//      are sorted by that score alone, so one with every term can rank below
//      one with fewer, rarer terms in its heading.
//   3. The mode is "all-terms" when every returned section has every term,
//      else "some-terms"; the counts let the response say how many sections
//      hold every term, and how many of those it shows.
// Rarity is counted over the documents searched, so `corpus` can change the order.
export function searchWithFallback(
  query: string,
  corpus: Corpus | "all" = "all",
  limit = 10
): SearchOutcome {
  const asTyped = stripSurroundingQuotes(query).trim();
  const phraseAll = rankPhrase(asTyped, corpus);
  const phrase = phraseAll.slice(0, limit);
  const terms = queryTerms(query);
  if (phrase.length > 0 || terms.length === 0) {
    return {
      results: phrase,
      mode: "phrase",
      terms,
      allTermResults: phrase.length,
      total: phraseAll.length,
      allTermTotal: phraseAll.length,
      patterns: asTyped ? [phraseRegExp(asTyped)] : [],
      phrase: asTyped,
      wholeWords: asTyped && isShortTerm(asTyped) ? [asTyped] : [],
    };
  }

  const corpora: Corpus[] =
    corpus === "all" ? ["charter", "admin_code", "rules"] : [corpus];
  const res = terms.map(termRegExp);
  const hits: TermHit[] = [];
  const containing = terms.map(() => 0); // sections containing each term
  let searched = 0;
  let totalLength = 0;
  for (const c of corpora) {
    for (const s of loadCorpus(c)) {
      searched++;
      totalLength += s.text.length;
      const inHeading = res.map((re) => re.test(s.heading) || re.test(s.citation));
      const inAny = res.map((re, i) => inHeading[i] || re.test(s.text));
      inAny.forEach((has, i) => { if (has) containing[i]++; });
      if (inAny.some(Boolean)) hits.push({ s, inHeading, inAny });
    }
  }
  const rarity = containing.map((n) => Math.log(searched / Math.max(n, 1)));
  const averageLength = totalLength / Math.max(searched, 1);
  const scored = hits.map((h) => ({
    s: h.s,
    matched: h.inAny.filter(Boolean).length,
    score: termScore(h, rarity, averageLength),
  }));
  scored.sort((a, b) => b.score - a.score); // stable: ties keep corpus/document order
  const top = scored.slice(0, limit);
  const allTermResults = top.filter((r) => r.matched === terms.length).length;
  return {
    results: top.map((r) => r.s),
    mode: allTermResults === top.length ? "all-terms" : "some-terms",
    terms,
    allTermResults,
    total: scored.length,
    allTermTotal: scored.filter((r) => r.matched === terms.length).length,
    patterns: res,
    phrase: asTyped,
    wholeWords: terms.filter(isShortTerm),
  };
}

/**
 * True when a search query holds nothing to look for: empty, only spaces, or only quote marks
 * ('""', "“ ”"). Through 0.7.x an empty query matched all 22,637 sections, "   " none, and '""'
 * the few sections that hold two quote marks (issue #95).
 */
export function isEmptyQuery(query: string): boolean {
  return !query.replace(/["“”'‘’\s]/g, "");
}

// Normalize a citation for comparison: strip "§"/"section" prefixes, lowercase,
// collapse whitespace, and make any dash a hyphen. "§ 11-602.1", "Section 11-602.1", "11-602.1"
// and "§ 11–602.1" (en dash, issue #59) all normalize to "11-602.1"; "Chapter 3" stays "chapter 3".
const DASHES = /[\u2010-\u2015\u2212]/g;
export function normalizeCitation(input: string): string {
  return input
    .toLowerCase()
    .replace(DASHES, "-")
    .replace(/§§?\s*/g, "")
    .replace(/^section\s+/, "")
    .replace(/\s+/g, " ")
    .trim();
}

export type GetSectionResult =
  /**
   * `subdivision`: the citation named a part of a section that has no record of its own
   * ("§ 1133(b)(1)", "Section FC 102.4(1)"), and this is the whole section it is in. The part
   * as asked for: "(b)(1)", "102.4(1)".
   */
  | { kind: "match"; section: Section; subdivision?: string }
  | { kind: "ambiguous"; candidates: Section[]; subdivision?: string }
  /**
   * `rulesCitation`: the citation names "RCNY", and another document was asked for.
   * `bookCitation`: the citation names a book ("NYC Charter § 1133"), and another was asked for.
   */
  | { kind: "none"; rulesCitation?: true; bookCitation?: Corpus };

// ---------------------------------------------------------------- titles (issue #59)
//
// Each title of the Rules restarts its chapter and section numbers: "§ 1-01" is the first section
// of about fifty titles. The standard citation names the title first: "15 RCNY § 1-01" (Title 15
// of the Rules of the City of New York). A lettered Administrative Code title shares its parent's
// numbers (Title 16-A's sections are § 16-501 on). Records carry `titleNumber` (build-corpus.js),
// so a citation can name its title, and an answer can name a record's.

/** True when the index records titles for this document (built since 0.7.0; never the Charter). */
const titlesCache: Partial<Record<Corpus, boolean>> = {};
export function hasTitles(corpus: Corpus): boolean {
  return (titlesCache[corpus] ??= loadCorpus(corpus).some((s) => s.titleNumber));
}

/** Each title's heading, from its chapter records: "15" → "Title 15: Department of Environmental Protection". */
const titleNameCache: Partial<Record<Corpus, Map<string, string>>> = {};
export function titleHeadings(corpus: Corpus): Map<string, string> {
  if (titleNameCache[corpus]) return titleNameCache[corpus]!;
  const names = new Map<string, string>();
  for (const s of loadCorpus(corpus)) {
    if (s.titleNumber && s.titleHeading && !names.has(s.titleNumber)) names.set(s.titleNumber, s.titleHeading);
  }
  return (titleNameCache[corpus] = names);
}

// The Health Code is part of Title 24 of the Rules, under a chapter record with no number, and is
// cited "24 RCNY Health Code § 81.08". Its records are the ones after that chapter record, up to
// the next chapter record. Matched on the heading the publisher gives it.
const HEALTH_CODE_HEADING = /^(?:the\s+)?(?:new york city\s+)?health code$/i;
// Keyed by record id (unique in each document), so a copy of a record (getTitle's chapter
// records carry their label as citation) is still found.
const healthCodeCache = new WeakMap<Section[], Set<string>>();
export function inHealthCode(s: Section): boolean {
  if (s.corpus !== "rules") return false;
  const all = loadCorpus("rules");
  let ids = healthCodeCache.get(all);
  if (!ids) {
    ids = new Set();
    let inside = false;
    for (const r of all) {
      if (r.level === "Chapter") inside = HEALTH_CODE_HEADING.test(r.heading.trim());
      if (inside) ids.add(r.id);
    }
    healthCodeCache.set(all, ids);
  }
  return ids.has(s.id);
}

// The chapter record each record sits under: the last chapter record before it in the index
// (numbered or not: a Rent Guidelines Board order, the Health Code), up to a section with no
// chapter around it (level "Section"). Null for a chapter record and for a record in no chapter.
// Keyed by record id, as inHealthCode.
const chapterOfCache = new WeakMap<Section[], Map<string, Section>>();
export function chapterOf(s: Section): Section | null {
  const all = loadCorpus(s.corpus);
  let map = chapterOfCache.get(all);
  if (!map) {
    map = new Map();
    let current: Section | null = null;
    for (const r of all) {
      if (r.level === "Chapter") current = r;
      else if (r.level === "Section") current = null;
      else if (current) map.set(r.id, current);
    }
    chapterOfCache.set(all, map);
  }
  return map.get(s.id) ?? null;
}

// Compared without "§", case, dashes, spacing or commas: "Title 62 Chapter 5 § 6-01" is
// "Title 62, Chapter 5, § 6-01".
const citationKey = (c: string) => normalizeCitation(c).replace(/\s*,\s*/g, " ");

/**
 * A record's citation with its title, the way a person would cite it:
 *   - Rules: "15 RCNY § 1-01"; "24 RCNY Health Code § 81.08"; "Title 15, Chapter 18" for a chapter
 *     and any other record whose citation does not already start with its title.
 *   - Administrative Code: a chapter is "Title 3, Chapter 1"; a section of a lettered title whose
 *     number is its parent's is "Title 16-A, § 16-501". Every other citation already says where it
 *     is ("§ 24-163" is in Title 24; "Section FC 102" is the Fire Code), and is unchanged.
 *   - The Charter, and any record with no `titleNumber`: its citation.
 * Where the publisher repeats a citation inside one title (each yearly Rent Guidelines Board order
 * has its "Notice"; Title 62 numbers sections § 6-01 on in both Chapter 5 and Chapter 6), the
 * chapter is named too: "Title 30, Apartment & Loft Order #49 (2017), Notice", "Title 62, Chapter
 * 5, § 6-01". get_section takes each of these forms.
 */
export function fullCitation(s: Section): string {
  const own = titledCitation(s);
  if (!s.titleNumber || (sharedTitled(s.corpus).get(citationKey(own)) ?? 0) < 2) return own;
  // A citation that already names its title and chapter ("Title 20, Chapter 4, Subchapter 3", a
  // group record), or starts with its chapter's ("New York City Health Code, Title III, ..."),
  // gains nothing from them again: two such records are the publisher's own repeat.
  if (/^title\s/i.test(s.citation)) return own;
  const chapter = chapterOf(s);
  if (!chapter || citationKey(s.citation).startsWith(citationKey(chapter.citation))) return own;
  return `Title ${s.titleNumber}, ${chapter.citation}, ${s.citation}`;
}

// How many records of a document share each titled citation (its key).
const sharedCache = new WeakMap<Section[], Map<string, number>>();
function sharedTitled(corpus: Corpus): Map<string, number> {
  const all = loadCorpus(corpus);
  let counts = sharedCache.get(all);
  if (!counts) {
    counts = new Map();
    for (const r of all) {
      if (!r.titleNumber) continue;
      const k = citationKey(titledCitation(r));
      counts.set(k, (counts.get(k) ?? 0) + 1);
    }
    sharedCache.set(all, counts);
  }
  return counts;
}

function titledCitation(s: Section): string {
  const t = s.titleNumber;
  if (!t || /^title\s/i.test(s.citation)) return s.citation;
  if (s.corpus === "rules") {
    if (s.citation.startsWith("§")) return `${t} RCNY ${inHealthCode(s) ? "Health Code " : ""}${s.citation}`;
    return `Title ${t}, ${s.citation}`;
  }
  if (s.corpus === "admin_code") {
    if (s.level === "Chapter") return `Title ${t}, ${s.citation}`;
    if (/[A-Z]/i.test(t) && s.citation.startsWith("§") && !new RegExp(`^§ ${escapeRegExp(t)}-`, "i").test(s.citation)) {
      return `Title ${t}, ${s.citation}`;
    }
  }
  return s.citation;
}

/** "16a", "16-a", "016" → "16-A", "16": a title number as the publisher's Title headings write it. */
export function canonicalTitle(t: string): string {
  return t.toUpperCase().replace(/^0+(?=\d)/, "").replace(/^(\d+)-?([A-Z])$/, "$1-$2");
}

export interface TitledCitation {
  /** The title asked for ("15", "16-A"), if one was named. */
  title?: string;
  /** "RCNY" was named: a citation of the Rules, and only the Rules. */
  rules: boolean;
  /**
   * The Health Code was named as a citation: "24 RCNY Health Code …" or "Title 24, Health Code …"
   * with anything after it, or "Health Code" followed by "§", a section number, or Title, Article
   * or Part and a number ("Health Code § 81.08", "Health Code Article 81"). Words such as "health
   * code violations" are not a citation and are looked up as typed.
   */
  healthCode: boolean;
  /** The rest of the citation: "§ 1-01", "Chapter 18". */
  rest: string;
  /**
   * When the Health Code was named: the rest with its name, as typed ("New York City Health Code,
   * Title III, Article 48"), which is how the Health Code's own group records are cited.
   */
  named?: string;
}

const TITLE_NUM = String.raw`\d+(?:-?[A-Za-z](?![A-Za-z]))?`;
const RCNY_WORD = String.raw`r\.?\s?c\.?\s?n\.?\s?y\b\.?`;
// "15 RCNY § 1-01", "15 R.C.N.Y. 1-01", "15 RCNY Health Code § 81.08".
const RCNY_FIRST = new RegExp(`^(${TITLE_NUM})\\s+${RCNY_WORD}[\\s,]*(.*)$`, "i");
// "Title 15 § 1-01", "Title 15, § 1-01", "Title 15 RCNY § 1-01", "RCNY Title 15 § 1-01", "Title 16-A § 16-501".
const TITLE_FIRST = new RegExp(`^(?:${RCNY_WORD}[\\s,]*)?title\\s+(${TITLE_NUM})(?=[\\s,§]|$)[\\s,]*(?:(${RCNY_WORD})[\\s,]*)?(.*)$`, "i");
// "RCNY § 1-01".
const RCNY_ONLY = new RegExp(`^${RCNY_WORD}[\\s,]*(.*)$`, "i");
const HEALTH_CODE = /^(?:(?:the\s+)?new york city\s+)?health code\b[\s,]*(.*)$/i;
// What may follow "Health Code" for it to be a citation with no title named.
const HEALTH_CODE_CITATION = /^(?:§|\d|(?:title|article|part)\s+(?:[ivxlc]+|\d+)\b)/i;

/**
 * Read a citation that names a title or the Health Code, or null when it names neither, or names
 * nothing after it ("Title 15" alone is not a section).
 */
export function parseTitledCitation(input: string): TitledCitation | null {
  const q = input.replace(DASHES, "-").replace(/\s+/g, " ").trim();
  let title: string | undefined;
  let rules = false;
  let rest = q;
  let m: RegExpExecArray | null;
  if ((m = RCNY_FIRST.exec(q))) [title, rules, rest] = [m[1], true, m[2]];
  else if ((m = TITLE_FIRST.exec(q))) [title, rules, rest] = [m[1], /^r/i.test(q) || Boolean(m[2]), m[3]];
  else if ((m = RCNY_ONLY.exec(q))) [rules, rest] = [true, m[1]];
  // "Health Code § 81.08": the Health Code's records (see `healthCode`). "Title 24, New York City
  // Health Code" alone names the chapter record, so with nothing after the name it is the rest.
  const hc = HEALTH_CODE.exec(rest);
  const after = hc ? hc[1].trim() : "";
  const named = hc && after && ((title !== undefined && canonicalTitle(title) === "24") || HEALTH_CODE_CITATION.test(after)) ? rest.trim() : null;
  if (named) rest = after;
  if (title === undefined && !rules && !named) return null;
  rest = rest.trim();
  if (!rest) return null;
  return {
    ...(title !== undefined ? { title: canonicalTitle(title) } : {}),
    rules,
    healthCode: Boolean(named),
    rest,
    ...(named ? { named } : {}),
  };
}

// A record is in the title (and the Health Code) a citation names. An Administrative Code or
// Rules index built before 0.7.0 records no titles: there every record counts, so a titled
// citation still finds the records it could mean (and lists them when there are several).
function inNamedTitle(s: Section, t: TitledCitation): boolean {
  if (s.corpus === "charter") return false;
  if (t.healthCode && !inHealthCode(s)) return false;
  if (t.title === undefined || !hasTitles(s.corpus)) return true;
  return s.titleNumber === t.title;
}

// A list of candidates by document, then by title ("6 RCNY § 1-01" before "15 RCNY § 1-01"),
// so a person can find the title they mean; records with no title, and records of one title,
// keep the index's order. An index built before 0.7.0 has no titles: its order is unchanged.
const CORPUS_ORDER: Record<Corpus, number> = { charter: 0, admin_code: 1, rules: 2 };
function byTitle(list: Section[]): Section[] {
  return [...list].sort((a, b) => CORPUS_ORDER[a.corpus] - CORPUS_ORDER[b.corpus] || compareLabels(a.titleNumber ?? "", b.titleNumber ?? ""));
}

// Exact-citation lookup with normalization and disambiguation.
// - Input is normalized (with/without "§", case, whitespace, any dash).
// - A citation may name its title (issue #59): "15 RCNY § 1-01", "15 RCNY 1-01", "Title 15 § 1-01",
//   "Title 15, Chapter 18", "24 RCNY Health Code § 81.08", "Title 16-A § 16-501". Then only that
//   title's records are looked at, and a Health Code citation looks first in the Rules. When that
//   finds nothing, the citation is looked up as typed, as through 0.6.2: "Health Code Lead
//   Abatement Penalty Schedule" is a heading, not a Health Code citation.
// - "RCNY" names the Rules: such a citation is only looked for there. Asked of another document
//   it finds nothing, and says why (`rulesCitation`).
// - Exact citation matches are preferred over heading substring matches.
// - If `corpus` is given, only that corpus is consulted.
// - If multiple sections tie (e.g. charter "Chapter 3" vs rules "Chapter 3"
//   when no corpus is given, or the Rules' many "§ 1-01"), a disambiguation list is returned
//   instead of silently picking the first hit.
//
// Then, only when the citation as typed finds nothing (issue #95):
// - A construction code named in words ("Building Code 722.2.1.1.4", "NYC Fire Code § 102.4") is
//   that code's section in the Administrative Code ("Section BC 722", part 722.2.1.1.4). It is
//   tried first, as a book's name is, and asked of another document it finds nothing and says why.
// - A bare code number ("722.2.1.1.4") is looked for in every construction code by citation: one
//   code has it, that section; several, a list.
// - Trailing punctuation is dropped: "§ 259." is § 259.
export function getSection(
  citation: string,
  corpus?: Corpus
): GetSectionResult {
  const code = parseCodeName(citation);
  if (code) {
    if (corpus && corpus !== "admin_code") {
      const asTyped = getWithParts(citation, corpus);
      return asTyped.kind !== "none" ? asTyped : { kind: "none", bookCitation: "admin_code" };
    }
    const inCode = getWithParts(code, "admin_code", false);
    if (inCode.kind !== "none") return inCode;
  }
  const found = getWithParts(citation, corpus);
  if (found.kind !== "none") return found;
  if (!corpus || corpus === "admin_code") {
    const bare = inEveryCode(citation);
    if (bare.kind !== "none") return bare;
  }
  const trimmed = citation.trim();
  const stripped = trimmed.replace(/[\s.,;:]+$/, "");
  if (stripped && stripped !== trimmed) {
    const again = getSection(stripped, corpus);
    if (again.kind !== "none") return again;
  }
  return found;
}

// getSection as through 0.7.x: the citation as a whole, then, on a miss, a part of a section.
// `headings: false` skips the heading search on the citation as a whole.
function getWithParts(citation: string, corpus: Corpus | undefined, headings = true): GetSectionResult {
  const found = getWholeCitation(citation, corpus, { headings });
  if (found.kind !== "none") return found;
  // Only on a miss (issue #76): a part of a section, as the Law Reader website writes it when a
  // reader copies the citation of a subdivision ("NYC Charter § 1133(b)(1)") or of a Construction
  // Code subsection ("Section FC 102.4(1)"). The index has whole sections, so this is the whole
  // section, marked with the part asked for. Exact citations won above, so "D302 Conversions to a
  // multiple dwelling (MDL 9(2))" and "§ 11-602.1" are what they always were.
  for (const part of splitSubdivision(citation)) {
    // The section by its citation only: a heading that merely contains the stripped text is not
    // the section a part was asked of ("Section FC 10.1" is not FC 101 to FC 109).
    const whole = getWholeCitation(part.section, corpus, { headings: false });
    if (whole.kind !== "none") return { ...whole, subdivision: part.subdivision };
  }
  return found;
}

// ---------------------------------------------------------------- book names
//
// The Law Reader website's "Copy citation" names the book before the citation: "NYC Charter §
// 1133", "NYC Administrative Code § 27-506", "NYC Administrative Code Title 1, Chapter 1". A
// citation may start with the book's name, as a person writes it ("Admin. Code § 27-506",
// "New York City Charter § 1133"); then only that book is looked in. The name counts only when a
// citation follows it: "Charter revision commission" is words, looked up as typed. And a book
// lookup that finds nothing falls back to the lookup as typed, as before.

// "NYC", "N.Y.C.", "New York City", "City", each optional, then the book's name.
const CITY = String.raw`(?:(?:nyc|n\.\s?y\.\s?c\.?|new york city|city)\s+)?`;
const BOOK_NAME = new RegExp(
  `^(?:the\\s+)?${CITY}(?:(charter)|(?:administrative|admin\\.?)\\s*code)\\b\\.?[\\s,]*(.*)$`,
  "i",
);
// What may follow a book's name for it to be a citation: "§", "Section", a number, "Title",
// "Chapter", "Preamble"; a code's letters and number ("FC 102", "BC E104", "RS 18-1", "D302 ...",
// "E.1"), "Reference Standard", or a local law ("L.L. 1985/006").
const AFTER_BOOK = /^(?:§|sections?\b|sec\.|\d|(?:title|chapter|subchapter|article|appendix)\s+\S|preamble\b|introductory\b|[a-z]{1,4}[\s.]*\d|reference standards?\b|l\.\s?l\.|local laws?\b)/i;

/**
 * The book a citation names first, and the rest: "NYC Administrative Code § 27-506" →
 * { corpus: "admin_code", rest: "§ 27-506" }. Null when it names no book, or names one with no
 * citation after it.
 */
export function parseBookName(input: string): { corpus: Corpus; rest: string } | null {
  const q = input.replace(/\s+/g, " ").trim();
  const m = BOOK_NAME.exec(q);
  if (!m) return null;
  const rest = m[2].trim();
  if (!rest || !AFTER_BOOK.test(rest)) return null;
  return { corpus: m[1] ? "charter" : "admin_code", rest };
}

// ---------------------------------------------------------------- construction codes in words
//
// The Administrative Code cites its construction codes' sections by letters ("Section BC 722"),
// the letters CODE_SUBSECTION below knows. A person often names the code in words instead:
// "Building Code 722.2.1.1.4", "NYC Fire Code § 102.4", "Fuel Gas Code section 406" (issue #95).
// The Energy Conservation Code is not in the index, so it has no name here; the Health Code is
// in the Rules and is read by parseTitledCitation.
export const CODE_LETTERS: Readonly<Record<string, string>> = {
  building: "BC",
  fire: "FC",
  plumbing: "PC",
  mechanical: "MC",
  "fuel gas": "FGC",
  electrical: "EC",
  "existing building": "EBC",
};
const CODE_NAME = new RegExp(
  `^(?:the\\s+)?${CITY}(existing\\s+building|building|fire|plumbing|mechanical|fuel\\s+gas|electrical)\\s+code\\b[\\s,]*(?:(?:§+|sections?\\b|sec\\.)\\s*)?([A-Z]?\\d.*)$`,
  "i",
);

/** "Building Code 722.2.1.1.4" → "Section BC 722.2.1.1.4". Null when no code is named, or nothing that starts with a number follows it. */
export function parseCodeName(input: string): string | null {
  const m = CODE_NAME.exec(input.replace(/\s+/g, " ").trim());
  if (!m) return null;
  const letters = CODE_LETTERS[m[1].toLowerCase().replace(/\s+/g, " ")];
  return letters ? `Section ${letters} ${m[2].trim()}` : null;
}

// A bare number as the construction codes number their sections and subsections ("722",
// "722.2.1.1.4", "E104.2"), with "§" or "Section" before it or not, and parts in parentheses
// after it ("102.4(1)").
const BARE_CODE_NUMBER = /^(?:§+\s*|sections?\s+|sec\.\s*)?([A-Z]?\d+(?:\.\d+[A-Z]?)*(?:\([0-9A-Za-z.-]{1,6}\))*)$/i;

/** A bare code number, looked for in every construction code, by citation only. */
function inEveryCode(input: string): GetSectionResult {
  const m = BARE_CODE_NUMBER.exec(input.replace(/\s+/g, " ").trim());
  if (!m) return { kind: "none" };
  const found = new Map<string, Section>();
  const parts = new Set<string>();
  for (const letters of new Set(Object.values(CODE_LETTERS))) {
    const r = getWithParts(`Section ${letters} ${m[1]}`, "admin_code", false);
    if (r.kind === "none") continue;
    for (const s of r.kind === "match" ? [r.section] : r.candidates) found.set(s.id, s);
    parts.add(r.subdivision ?? "");
  }
  const list = [...found.values()];
  const subdivision = parts.size === 1 && [...parts][0] ? { subdivision: [...parts][0] } : {};
  if (list.length === 0) return { kind: "none" };
  if (list.length === 1) return { kind: "match", section: list[0], ...subdivision };
  return { kind: "ambiguous", candidates: list, ...subdivision };
}

// ---------------------------------------------------------------- parts of a section
//
// A subdivision label in parentheses, as the website's anchors write them (scripts/lib/
// build-structure.js LABEL): "(b)", "(1)", "(iv)", "(4-a)", "(h-1)", "(C)". Several in a row, and
// the "-2" the site adds to the second anchor of the same name in a section ("(3)-2"). Words with
// a space in parentheses ("(MDL 9(2))") are not one; a word with none ("(IBO)") counts only after
// a citation with a number in it (splitSubdivision), and only when the whole is not found.
const SUBDIVISION = String.raw`\([0-9A-Za-z][0-9A-Za-z.-]{0,5}\)`;
const TRAILING_SUBDIVISIONS = new RegExp(`^(.*?[^\\s(])\\s?((?:${SUBDIVISION})+(?:-\\d+)?)$`);
// A Construction Code or Fire Code section and a subsection number: "Section FC 102" + ".4"
// ("FC 102.4" is subsection 4 of FC 102); "Section BC E104" + ".2.2". No such section's own
// number has a point, so a point after it starts a subsection. The codes' letters are the ones
// the Administrative Code's index cites: Plumbing, Building, Mechanical, Fuel Gas, Electrical,
// Existing Building, and Fire.
const CODE_SUBSECTION = /^(.*\b(?:PC|BC|MC|FGC|EC|EBC|FC)\s*([A-Z]?\d+))((?:\.\d+[A-Z]?)+(?:-\d+)?)$/i;
// A Rules section and a subsection number: "15 RCNY § 19.1-01" + ".1" (the site's anchor
// "19.1-01.1"). Only with "RCNY" named, since the Administrative Code's "§ 11-602.1" is a section
// of its own, and only on a miss, since a Rules title may have a "§ 1-01.1" too.
const RULES_SUBSECTION = /^(.*\br\.?\s?c\.?\s?n\.?\s?y\b.*?§\s*([\d.]*\d-\d+[A-Z]?))((?:\.\d+[A-Z]?)+(?:-\d+)?)$/i;

/**
 * The ways a citation may name a part of a section, each split into the section and the part,
 * to try in order: "§ 1133(b)(1)" → [{ section: "§ 1133", subdivision: "(b)(1)" }]; "Section FC
 * 102.4(1)" → [{ section: "Section FC 102.4", subdivision: "(1)" }, { section: "Section FC 102",
 * subdivision: "102.4(1)" }] (a subsection, when there is no section of that number). Empty when
 * it names no part. The part is written as the website's anchors write it.
 */
export function splitSubdivision(input: string): { section: string; subdivision: string }[] {
  let base = input.replace(/\s+/g, " ").trim();
  let parens = "";
  const p = TRAILING_SUBDIVISIONS.exec(base);
  if (p) [base, parens] = [p[1].trim(), p[2]];
  const out: { section: string; subdivision: string }[] = [];
  if (parens && /\d/.test(base)) out.push({ section: base, subdivision: parens });
  const c = CODE_SUBSECTION.exec(base) ?? RULES_SUBSECTION.exec(base);
  if (c) out.push({ section: c[1], subdivision: `${c[2]}${c[3]}${parens}` });
  return out;
}

// The Administrative Code's local-law chapters are cited by their year ("1985"); the website
// files them under "Local laws": "NYC Administrative Code Local laws, 1985".
const LOCAL_LAWS_YEAR = /^local laws,?\s+(\d{4})$/i;

// getSection without the subdivision fallback: the citation as a whole. What follows a book's
// name, and a local-law year, are looked up by citation only: the heading search (`headings`)
// runs only on the citation exactly as typed, so "Admin Code 1" is not every heading with a "1"
// in it, and "Charter revision commission" is still a heading.
function getWholeCitation(citation: string, corpus?: Corpus, { headings = true } = {}): GetSectionResult {
  const book = parseBookName(citation);
  if (book && corpus && corpus !== book.corpus) {
    // A heading in the asked-for book may start with another book's name (Rules 1 RCNY § 33-01
    // cites "Administrative Code § 26-212.1 …"): look it up as typed first.
    const asTyped = getCitation(citation, corpus, headings);
    return asTyped.kind !== "none" ? asTyped : { kind: "none", bookCitation: book.corpus };
  }
  const year = LOCAL_LAWS_YEAR.exec((book?.rest ?? citation).trim());
  if (year && (corpus ?? "admin_code") === "admin_code" && (book?.corpus ?? "admin_code") === "admin_code") {
    const chapter = getCitation(year[1], "admin_code", false);
    if (chapter.kind !== "none") return chapter;
  }
  if (book) {
    const inBook = getCitation(book.rest, book.corpus, false);
    if (inBook.kind !== "none") return inBook;
  }
  return getCitation(citation, corpus, headings);
}

// The lookup through 0.7.0's book names: a citation with no book name. `headings: false` skips
// the heading search (lookUp's Pass 2): a citation match or nothing.
function getCitation(citation: string, corpus: Corpus | undefined, headings: boolean): GetSectionResult {
  const titled = parseTitledCitation(citation);
  if (titled?.rules && corpus && corpus !== "rules") return { kind: "none", rulesCitation: true };
  const asked: Corpus[] = corpus ? [corpus] : titled?.rules ? ["rules"] : ["charter", "admin_code", "rules"];
  if (!titled) return lookUp(citation, asked, null, headings);
  const narrowed = lookUp(citation, corpus ? [corpus] : titled.healthCode ? ["rules"] : asked, titled, headings);
  return narrowed.kind === "none" ? lookUp(citation, asked, null, headings) : narrowed;
}

// getSection's two passes over `corpora`; with `titled`, within the title it names. The second,
// the heading search, only with `headings`.
function lookUp(citation: string, corpora: Corpus[], titled: TitledCitation | null, headings = true): GetSectionResult {
  const q = normalizeCitation(citation);
  if (!q) return { kind: "none" };

  // Pass 1: exact (normalized) citation match across the corpora in scope: the whole citation
  // as typed. Failing that, within the title it names, the part after the title, alone or after
  // the record's chapter ("Title 62, Chapter 5, § 6-01"). A record whose own citation is the
  // whole query comes first: "Title 15, Chapter 42, Appendix A" is a record's own citation, and
  // stays that record even though a section in that chapter is cited "Appendix A".
  const exact: Section[] = [];
  const inTitle: Section[] = [];
  const restKeys = new Set(titled ? [titled.rest, titled.named ?? titled.rest].map(citationKey) : []);
  for (const c of corpora) {
    for (const s of loadCorpus(c)) {
      if (normalizeCitation(s.citation) === q) {
        exact.push(s);
        continue;
      }
      if (!titled || exact.length || !inNamedTitle(s, titled)) continue;
      const chapter = chapterOf(s);
      if (restKeys.has(citationKey(s.citation)) || (chapter && restKeys.has(citationKey(`${chapter.citation}, ${s.citation}`)))) inTitle.push(s);
    }
  }
  const found = exact.length ? exact : inTitle;
  if (found.length === 1) return { kind: "match", section: found[0] };
  if (found.length > 1) return { kind: "ambiguous", candidates: byTitle(found) };
  if (!headings) return { kind: "none" };

  // Pass 2: heading substring fallback (legacy behavior, kept for queries
  // like "Independent budget office"), within the title when one is named.
  const raw = (titled ? titled.rest : citation).toLowerCase().trim();
  const loose: Section[] = [];
  for (const c of corpora) {
    for (const s of loadCorpus(c)) {
      if (titled && !inNamedTitle(s, titled)) continue;
      if (s.heading.toLowerCase().includes(raw)) {
        loose.push(s);
        if (loose.length > 10) break; // cap the disambiguation list
      }
    }
  }
  if (loose.length === 1) return { kind: "match", section: loose[0] };
  if (loose.length > 1) return { kind: "ambiguous", candidates: byTitle(loose) };
  return { kind: "none" };
}

// ---------------------------------------------------------------- chapters and titles
//
// The index is flat, but in document order within each source file: every file starts with a
// chapter record, and the chapter's sections follow it up to the next chapter record
// (scripts/lib/build-corpus.js collectSections pushes a record before its children). So a
// chapter is its heading record plus the records after it, up to the next chapter heading.
// The records for text outside a section (issue #78: an appendix, a reference standard, a
// subchapter's note) sit among them in document order, so they are listed in their chapter.
//
// The chapter's number is read from its heading, not its citation. Through 0.6.0 the build cut
// letters off chapter labels ("Chapter 18-A" became "Chapter 18-"); extractCitation is fixed,
// but an index built before that fix still carries the cut labels until it is rebuilt.
//
// Files come in no particular order, so chapters are sorted: Charter chapters by number
// ("Chapter 1" first, "Chapter 18" before "Chapter 18-A"); Rules chapters by title, then number;
// Administrative Code chapters by their first section (§ 1-101 first).
//
// A chapter's title is its chapter record's `titleNumber` (issue #59), so "Title 16" is Title 16
// alone, not 16-A or 16-B, and "Title 15, Chapter 18" is one Rules chapter. Rules chapters are
// labeled with their title ("Title 15, Chapter 18"): every title has its own Chapter 1. Several
// Administrative Code chapters share a number too; each is labeled with its section range, which
// tells them apart. The Charter has no titles.
//
// An index built before 0.7.0 has no `titleNumber`. There an Administrative Code chapter's title
// is worked out from its section numbers (§ 24-163 is in Title 24), which puts Title 16-A's
// chapters (§ 16-501 on) in Title 16; and a Rules chapter has no title.

// Same token as CHAPTER_NUMBER in scripts/lib/build-corpus.js: "18-A", "19A", "19.1", "9-a", "K1".
const LABEL_NUMBER = String.raw`[A-Za-z]?\d[\dA-Za-z-]*(?:\.\d[\dA-Za-z-]*)*`;
const HEADING_LABEL = new RegExp(`^(chapter|title)\\s+(${LABEL_NUMBER})`, "i");
// "Title 15, Chapter 18", "Title 15 Chapter 18", "15 RCNY Chapter 18", "Title 24", "Chapter 70".
const TITLE_QUERY = new RegExp(`^(?:(?:title\\s+(${LABEL_NUMBER})|(${LABEL_NUMBER})\\s+r\\.?c\\.?n\\.?y\\b\\.?)\\s*,?\\s*)?(?:chapter\\s+(${LABEL_NUMBER}))?$`, "i");
const ADMIN_CODE_TITLE = /^§ (\d+[A-Za-z]?)-/;

export interface ChapterGroup {
  kind: "Chapter" | "Title";
  /** The chapter's number ("18-A"), or "" for a chapter with no number (see `numbered`). */
  number: string;
  /**
   * False for a chapter record with no number that the index places in a title (issue #59): the
   * Health Code, the Rent Guidelines Board's yearly orders, "Appendix A to Title 62". Its label is
   * its citation, and "Chapter N" never finds it.
   */
  numbered: boolean;
  /**
   * The title the chapter is in ("24", "16-A"): its record's `titleNumber`; in an Administrative
   * Code index built before 0.7.0, the title most of its § sections are numbered in. Null in the
   * Charter.
   */
  title: string | null;
  /** That title's heading, when the index has it ("Title 15: Department of Environmental Protection"). */
  titleHeading: string | null;
  /**
   * "Chapter 18-A"; in the Rules, with its title: "Title 15, Chapter 18"; in the Administrative
   * Code, with its range: "Chapter 1 (§ 3-101 to § 3-120)".
   */
  label: string;
  /** The heading record (its citation replaced by the label), then its sections in order. */
  records: Section[];
}

const groupCache: Partial<Record<Corpus, ChapterGroup[]>> = {};

/** Natural order: "1" < "2" < "2-A" < "10"; numbers before letters. */
export function compareLabels(a: string, b: string): number {
  const parts = (s: string) => s.toLowerCase().split(/(\d+)/).filter(Boolean);
  const x = parts(a);
  const y = parts(b);
  for (let i = 0; i < Math.min(x.length, y.length); i++) {
    if (x[i] === y[i]) continue;
    const xn = /^\d+$/.test(x[i]);
    const yn = /^\d+$/.test(y[i]);
    if (xn && yn) return Number(x[i]) - Number(y[i]) || x[i].length - y[i].length;
    if (xn !== yn) return xn ? -1 : 1;
    return x[i] < y[i] ? -1 : 1;
  }
  return x.length - y.length;
}

/** The title most of a chapter's § sections are numbered in, or null. */
function adminCodeTitle(records: Section[]): string | null {
  const counts = new Map<string, number>();
  for (const s of records) {
    const m = ADMIN_CODE_TITLE.exec(s.citation);
    if (m) counts.set(m[1], (counts.get(m[1]) ?? 0) + 1);
  }
  let best: string | null = null;
  for (const [t, n] of counts) if (best === null || n > counts.get(best)!) best = t;
  return best;
}

export function chapterGroups(corpus: Corpus): ChapterGroup[] {
  if (groupCache[corpus]) return groupCache[corpus]!;
  const groups: ChapterGroup[] = [];
  // Where a chapter ends (review of #78). The index has no file boundaries, and through 0.6.2 a
  // record went into whichever chapter came before it, from any file: the Health Code (a chapter
  // headed "New York City Health Code", with no number) and its sections sat in Rules Chapter
  // 21, the Administrative Code's local laws by year in Title 5's Chapter 1, and so on. An index
  // built since #78 gives every record but a section inside a chapter a `level`, so:
  //   - a chapter record with "Chapter N" or "Title N" opens a chapter;
  //   - a chapter record with no number ends the chapter before it. If it has a title (issue #59:
  //     the Health Code, the Rent Guidelines Board's orders, the Rules' appendices) it opens a
  //     chapter of its own, labeled with its citation; if not ("Preamble", "2016"), its records
  //     belong to no chapter here, as does a section with no chapter around it (level "Section":
  //     the Administrative Code's Title 31, which getTitle lists with its title);
  //   - a group record (an appendix, a reference standard, a note) is in the chapter around it,
  //     even when its heading reads like one ("CHAPTER 1 – GENERAL" in RS 13-1).
  // search and get_section still find the records in no chapter. An older index has no `level`:
  // there a heading opens a chapter as before, and every other record joins the one before it.
  let current: ChapterGroup | null = null;
  for (const s of loadCorpus(corpus)) {
    const m = s.level && s.level !== "Chapter" ? null : HEADING_LABEL.exec(s.heading);
    if (m) {
      const kind = m[1].toLowerCase() === "title" ? "Title" : "Chapter";
      current = { kind, number: m[2], numbered: true, title: s.titleNumber ?? null, titleHeading: s.titleHeading ?? null, label: "", records: [s] };
      groups.push(current);
    } else if (s.level === "Chapter" && s.titleNumber) {
      current = { kind: "Chapter", number: "", numbered: false, title: s.titleNumber, titleHeading: s.titleHeading ?? null, label: "", records: [s] };
      groups.push(current);
    } else if (s.level === "Chapter" || s.level === "Section") {
      current = null;
    } else if (current) {
      current.records.push(s);
    }
  }
  const first = new Map<ChapterGroup, string | null>();
  for (const g of groups) {
    g.label = g.numbered ? `${g.kind} ${g.number}` : g.records[0].citation;
    first.set(g, null);
    if (g.title && g.kind === "Chapter" && (corpus === "rules" || !g.numbered)) g.label = `Title ${g.title}, ${g.label}`;
    if (corpus === "admin_code") {
      g.title ??= adminCodeTitle(g.records);
      const numbered = g.records.slice(1).filter((s) => s.citation.startsWith("§ "));
      if (numbered.length > 0) {
        const [a, b] = [numbered[0].citation, numbered[numbered.length - 1].citation];
        first.set(g, a);
        g.label += a === b ? ` (${a})` : ` (${a} to ${b})`;
      }
    }
    g.records[0] = { ...g.records[0], citation: g.label };
  }
  // Administrative Code: by first section; chapters with no § section go last. Rules: by title
  // (chapters with none last), then as the Charter, then the title's chapters with no number by
  // their labels ("…Order #47 (2015)" before "…Order #48 (2016)"). Otherwise, and between those,
  // by kind (Title first) then number. Array.prototype.sort is stable.
  groups.sort((a, b) => {
    const fa = first.get(a) ?? null;
    const fb = first.get(b) ?? null;
    if (fa !== null || fb !== null) {
      if (fa === null) return 1;
      if (fb === null) return -1;
      return compareLabels(fa, fb);
    }
    if (corpus === "rules" && a.title !== b.title) {
      if (a.title === null) return 1;
      if (b.title === null) return -1;
      return compareLabels(a.title, b.title);
    }
    if (a.numbered !== b.numbered) return a.numbered ? -1 : 1;
    if (!a.numbered) return compareLabels(a.label, b.label);
    if (a.kind !== b.kind) return a.kind === "Title" ? -1 : 1;
    return compareLabels(a.number, b.number);
  });
  groupCache[corpus] = groups;
  return groups;
}

export interface TitleListEntry {
  citation: string;
  heading: string;
  /** The chapter's title ("15"), or null. */
  title: string | null;
  /** That title's heading, or null when the index does not have it. */
  titleHeading: string | null;
}

export function listTitles(corpus: Corpus): TitleListEntry[] {
  return chapterGroups(corpus).map((g) => ({ citation: g.label, heading: g.records[0].heading, title: g.title, titleHeading: g.titleHeading }));
}

/** True for "Title 6", "Title 3, Chapter 1" or "15 RCNY Chapter 18": a query that names a title. */
export function namesTitle(query: string): boolean {
  const m = TITLE_QUERY.exec(query.trim().replace(/\s+/g, " "));
  return Boolean(m?.[1] || m?.[2]);
}

// "Chapter 70": that chapter's heading, then every record in it (in the Rules, every title's
// Chapter 70). "Title 24": every chapter in Title 24 ("Title 16" is not 16-A or 16-B). "Title 3,
// Chapter 1" or "3 RCNY Chapter 1": only the chapters numbered 1 among those. In an index built
// before 0.7.0, an Administrative Code title is the chapters whose sections are numbered 24-….
// Numbers match whole ("Chapter 1" is not "Chapter 10" or "Chapter 1-A"), in any case. Anything
// else ("§ 259", "Preamble") falls back to records whose citation or heading starts with it.
export function getTitle(corpus: Corpus, title: string): Section[] {
  const q = title.trim().replace(/\s+/g, " ");
  if (!q) return [];
  const m = TITLE_QUERY.exec(q.replace(DASHES, "-"));
  if (m && (m[1] || m[2] || m[3])) {
    const [, t1, t2, c] = m;
    const t = t1 ?? t2;
    const same = (a: string | null, b: string) => a !== null && a.toLowerCase() === b.toLowerCase();
    // A title number is compared as the publisher writes it: "16a" and "16-a" are "16-A".
    const sameTitle = (a: string | null, b: string) => a !== null && canonicalTitle(a) === canonicalTitle(b);
    const groups = chapterGroups(corpus).filter((g) =>
      c
        ? g.kind === "Chapter" && g.numbered && same(g.number, c) && (!t || sameTitle(g.title, t))
        : (g.kind === "Title" && same(g.number, t!)) || sameTitle(g.title, t!),
    );
    const records = groups.flatMap((g) => g.records);
    if (c || !hasTitles(corpus)) return records;
    // A whole title (issue #59): every record the index places in it. Records in no chapter (the
    // Administrative Code's Title 31 has sections and no chapters) come first, in index order,
    // as a title's own sections come before its chapters.
    const listed = new Set(records.map((r) => r.id));
    const own = loadCorpus(corpus).filter((r) => !listed.has(r.id) && r.titleNumber && sameTitle(r.titleNumber, t!));
    return [...own, ...records];
  }
  const sections = loadCorpus(corpus);
  // Match at the start of the citation or heading, requiring a token
  // boundary after the query (so "Chapter 1" ≠ "Chapter 10").
  const re = new RegExp(`^${escapeRegExp(q)}(?![\\w.-])`, "i");
  return sections.filter((s) => re.test(s.citation) || re.test(s.heading));
}
