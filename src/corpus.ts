import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const INDEX_DIR = join(__dirname, "..", "data", "index", "json");

export type Corpus = "charter" | "admin_code" | "rules";

export interface Section {
  corpus: Corpus;
  id: string;
  citation: string;
  heading: string;
  text: string;
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

function loadCorpus(corpus: Corpus): Section[] {
  if (cache[corpus]) return cache[corpus]!;
  const path = join(INDEX_DIR, `${corpus}.json`);
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch {
    throw new Error(
      `Index for "${corpus}" not found. Run: npm run build-index`
    );
  }
  cache[corpus] = JSON.parse(raw) as Section[];
  return cache[corpus]!;
}

function loadVersions(): Versions {
  if (versionsCache) return versionsCache;
  const path = join(INDEX_DIR, "versions.json");
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch {
    throw new Error("Version index not found. Run: npm run build-index");
  }
  versionsCache = JSON.parse(raw) as Versions;
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
  return scored.slice(0, limit).map((r) => r.s);
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

export function listTitles(corpus: Corpus): { citation: string; heading: string }[] {
  const sections = loadCorpus(corpus);
  return sections
    .filter((s) => s.heading.toLowerCase().startsWith("chapter") || s.heading.toLowerCase().startsWith("title"))
    .map(({ citation, heading }) => ({ citation, heading }));
}

// Whole-token prefix match: "Chapter 1" matches "Chapter 1: ..." but not
// "Chapter 10". Note: the index is flat (chapter/section records only) — deep
// hierarchy (all sections *within* a title) is not indexed; Title-level
// indexing is a tracked feature, not provided here.
export function getTitle(corpus: Corpus, title: string): Section[] {
  const sections = loadCorpus(corpus);
  const q = title.trim();
  if (!q) return [];
  // Match at the start of the citation or heading, requiring a token
  // boundary after the query (so "Chapter 1" ≠ "Chapter 10").
  const re = new RegExp(`^${escapeRegExp(q)}(?![\\w.-])`, "i");
  return sections.filter((s) => re.test(s.citation) || re.test(s.heading));
}
