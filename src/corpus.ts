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
   * schedules, editor's notes). Absent on every record of an index built before 0.6.3.
   */
  level?: string;
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

// Every section matching the phrase, best first (searchCorpus without the cut), so a
// response can say how many matched in all (issue #42).
function rankPhrase(query: string, corpus: Corpus | "all"): Section[] {
  const corpora: Corpus[] =
    corpus === "all" ? ["charter", "admin_code", "rules"] : [corpus];

  const q = query.toLowerCase();
  const wordRe = new RegExp(`\\b${escapeRegExp(q)}\\b`, "i");
  const scored: { s: Section; score: number }[] = [];

  for (const c of corpora) {
    const sections = loadCorpus(c);
    for (const s of sections) {
      const inHeading = s.heading.toLowerCase().includes(q);
      const inCitation = s.citation.toLowerCase().includes(q);
      const inText = s.text.toLowerCase().includes(q);
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
function termRegExp(term: string): RegExp {
  const stem =
    term.length > 3 && term.endsWith("s") && !term.endsWith("ss")
      ? term.slice(0, -1)
      : term;
  return new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegExp(stem)}`, "iu");
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
  const phraseAll = rankPhrase(stripSurroundingQuotes(query), corpus);
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
  };
}

// Normalize a citation for comparison: strip "§"/"section" prefixes, lowercase,
// collapse whitespace. "§ 11-602.1", "Section 11-602.1", "11-602.1" all
// normalize to "11-602.1"; "Chapter 3" stays "chapter 3".
export function normalizeCitation(input: string): string {
  return input
    .toLowerCase()
    .replace(/§§?\s*/g, "")
    .replace(/^section\s+/, "")
    .replace(/\s+/g, " ")
    .trim();
}

export type GetSectionResult =
  | { kind: "match"; section: Section }
  | { kind: "ambiguous"; candidates: Section[] }
  | { kind: "none" };

// Exact-citation lookup with normalization and disambiguation.
// - Input is normalized (with/without "§", case, whitespace).
// - Exact citation matches are preferred over heading substring matches.
// - If `corpus` is given, only that corpus is consulted.
// - If multiple sections tie (e.g. charter "Chapter 3" vs rules "Chapter 3"
//   when no corpus is given), a disambiguation list is returned instead of
//   silently picking the first hit.
export function getSection(
  citation: string,
  corpus?: Corpus
): GetSectionResult {
  const corpora: Corpus[] = corpus
    ? [corpus]
    : ["charter", "admin_code", "rules"];
  const q = normalizeCitation(citation);
  if (!q) return { kind: "none" };

  // Pass 1: exact (normalized) citation match across the corpora in scope.
  const exact: Section[] = [];
  for (const c of corpora) {
    for (const s of loadCorpus(c)) {
      if (normalizeCitation(s.citation) === q) exact.push(s);
    }
  }
  if (exact.length === 1) return { kind: "match", section: exact[0] };
  if (exact.length > 1) return { kind: "ambiguous", candidates: exact };

  // Pass 2: heading substring fallback (legacy behavior, kept for queries
  // like "Independent budget office").
  const raw = citation.toLowerCase().trim();
  const loose: Section[] = [];
  for (const c of corpora) {
    for (const s of loadCorpus(c)) {
      if (s.heading.toLowerCase().includes(raw)) {
        loose.push(s);
        if (loose.length > 10) break; // cap the disambiguation list
      }
    }
  }
  if (loose.length === 1) return { kind: "match", section: loose[0] };
  if (loose.length > 1) return { kind: "ambiguous", candidates: loose };
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
// Files come in no particular order, so chapters are sorted: Charter and Rules chapters by
// number ("Chapter 1" first, "Chapter 18" before "Chapter 18-A"), Administrative Code chapters
// by their first section (§ 1-101 first). Administrative Code titles are not in the index, but
// its sections are numbered by title (§ 24-163 is in Title 24), so "Title 24" finds the chapters
// whose sections are numbered 24-…. A lettered title shares its parent's numbers (Title 16-A's
// sections are § 16-501 on), so "Title 16" brings 16-A and 16-B too, and several Administrative
// Code chapters share a number; each is labeled with its section range, which tells them apart.
// The Charter has no titles, and the index does not record which title a Rules chapter is in.

// Same token as CHAPTER_NUMBER in scripts/lib/build-corpus.js: "18-A", "19A", "19.1", "9-a", "K1".
const LABEL_NUMBER = String.raw`[A-Za-z]?\d[\dA-Za-z-]*(?:\.\d[\dA-Za-z-]*)*`;
const HEADING_LABEL = new RegExp(`^(chapter|title)\\s+(${LABEL_NUMBER})`, "i");
const TITLE_QUERY = new RegExp(`^(?:title\\s+(${LABEL_NUMBER})\\s*,?\\s*)?(?:chapter\\s+(${LABEL_NUMBER}))?$`, "i");
const ADMIN_CODE_TITLE = /^§ (\d+[A-Za-z]?)-/;

export interface ChapterGroup {
  kind: "Chapter" | "Title";
  number: string;
  /** Administrative Code only: the title number most of its § sections start with ("24"). */
  title: string | null;
  /** "Chapter 18-A"; in the Administrative Code, with its range: "Chapter 1 (§ 3-101 to § 3-120)". */
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
  //   - a chapter record with no number ("Preamble", "2016", "New York City Health Code") ends
  //     the chapter before it, and its records belong to no chapter here, as does a section with
  //     no chapter around it (level "Section": the Administrative Code's Title 31);
  //   - a group record (an appendix, a reference standard, a note) is in the chapter around it,
  //     even when its heading reads like one ("CHAPTER 1 – GENERAL" in RS 13-1).
  // search and get_section still find the records in no chapter. An older index has no `level`:
  // there a heading opens a chapter as before, and every other record joins the one before it.
  let current: ChapterGroup | null = null;
  for (const s of loadCorpus(corpus)) {
    const m = s.level && s.level !== "Chapter" ? null : HEADING_LABEL.exec(s.heading);
    if (m) {
      const kind = m[1].toLowerCase() === "title" ? "Title" : "Chapter";
      current = { kind, number: m[2], title: null, label: "", records: [s] };
      groups.push(current);
    } else if (s.level === "Chapter" || s.level === "Section") {
      current = null;
    } else if (current) {
      current.records.push(s);
    }
  }
  const first = new Map<ChapterGroup, string | null>();
  for (const g of groups) {
    g.label = `${g.kind} ${g.number}`;
    first.set(g, null);
    if (corpus === "admin_code") {
      g.title = adminCodeTitle(g.records);
      const numbered = g.records.slice(1).filter((s) => s.citation.startsWith("§ "));
      if (numbered.length > 0) {
        const [a, b] = [numbered[0].citation, numbered[numbered.length - 1].citation];
        first.set(g, a);
        g.label += a === b ? ` (${a})` : ` (${a} to ${b})`;
      }
    }
    g.records[0] = { ...g.records[0], citation: g.label };
  }
  // Administrative Code: by first section; chapters with no § section go last. Otherwise, and
  // between those, by kind (Title first) then number. Array.prototype.sort is stable.
  groups.sort((a, b) => {
    const fa = first.get(a) ?? null;
    const fb = first.get(b) ?? null;
    if (fa !== null || fb !== null) {
      if (fa === null) return 1;
      if (fb === null) return -1;
      return compareLabels(fa, fb);
    }
    if (a.kind !== b.kind) return a.kind === "Title" ? -1 : 1;
    return compareLabels(a.number, b.number);
  });
  groupCache[corpus] = groups;
  return groups;
}

export function listTitles(corpus: Corpus): { citation: string; heading: string }[] {
  return chapterGroups(corpus).map((g) => ({ citation: g.label, heading: g.records[0].heading }));
}

/** True for "Title 6" or "Title 3, Chapter 1": a query that names a title. */
export function namesTitle(query: string): boolean {
  return Boolean(TITLE_QUERY.exec(query.trim().replace(/\s+/g, " "))?.[1]);
}

// "Chapter 70": that chapter's heading, then every record in it. "Title 24" (Administrative
// Code): every chapter whose sections are numbered 24-…. "Title 3, Chapter 1": only the
// chapters numbered 1 among those.
// Numbers match whole ("Chapter 1" is not "Chapter 10" or "Chapter 1-A"), in any case. Anything
// else ("§ 259", "Preamble") falls back to records whose citation or heading starts with it.
export function getTitle(corpus: Corpus, title: string): Section[] {
  const q = title.trim().replace(/\s+/g, " ");
  if (!q) return [];
  const m = TITLE_QUERY.exec(q);
  if (m && (m[1] || m[2])) {
    const [, t, c] = m;
    const same = (a: string | null, b: string) => a !== null && a.toLowerCase() === b.toLowerCase();
    return chapterGroups(corpus)
      .filter((g) =>
        c
          ? g.kind === "Chapter" && same(g.number, c) && (!t || same(g.title, t))
          : (g.kind === "Title" && same(g.number, t)) || same(g.title, t),
      )
      .flatMap((g) => g.records);
  }
  const sections = loadCorpus(corpus);
  // Match at the start of the citation or heading, requiring a token
  // boundary after the query (so "Chapter 1" ≠ "Chapter 10").
  const re = new RegExp(`^${escapeRegExp(q)}(?![\\w.-])`, "i");
  return sections.filter((s) => re.test(s.citation) || re.test(s.heading));
}
