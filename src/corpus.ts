import { readFileSync, existsSync } from "fs";
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
  if (!existsSync(path)) {
    throw new Error(
      `Index for "${corpus}" not found. Run: npm run build-index`
    );
  }
  cache[corpus] = JSON.parse(readFileSync(path, "utf8")) as Section[];
  return cache[corpus]!;
}

function loadVersions(): Versions {
  if (versionsCache) return versionsCache;
  const path = join(INDEX_DIR, "versions.json");
  if (!existsSync(path)) {
    throw new Error("Version index not found. Run: npm run build-index");
  }
  versionsCache = JSON.parse(readFileSync(path, "utf8")) as Versions;
  return versionsCache;
}

export function getVersions(): Versions {
  return loadVersions();
}

export function searchCorpus(
  query: string,
  corpus: Corpus | "all" = "all",
  limit = 10
): Section[] {
  const corpora: Corpus[] =
    corpus === "all" ? ["charter", "admin_code", "rules"] : [corpus];

  const q = query.toLowerCase();
  const results: Section[] = [];

  for (const c of corpora) {
    const sections = loadCorpus(c);
    for (const s of sections) {
      if (
        s.heading.toLowerCase().includes(q) ||
        s.text.toLowerCase().includes(q) ||
        s.citation.toLowerCase().includes(q)
      ) {
        results.push(s);
        if (results.length >= limit) return results;
      }
    }
  }

  return results;
}

export function getSection(citation: string): Section | null {
  const corpora: Corpus[] = ["charter", "admin_code", "rules"];
  const q = citation.toLowerCase().trim();

  for (const c of corpora) {
    const sections = loadCorpus(c);
    const match = sections.find(
      (s) =>
        s.citation.toLowerCase() === q ||
        s.heading.toLowerCase().includes(q)
    );
    if (match) return match;
  }
  return null;
}

export function listTitles(corpus: Corpus): { citation: string; heading: string }[] {
  const sections = loadCorpus(corpus);
  return sections
    .filter((s) => s.heading.toLowerCase().startsWith("chapter") || s.heading.toLowerCase().startsWith("title"))
    .map(({ citation, heading }) => ({ citation, heading }));
}

export function getTitle(corpus: Corpus, title: string): Section[] {
  const sections = loadCorpus(corpus);
  const q = title.toLowerCase();
  return sections.filter(
    (s) =>
      s.citation.toLowerCase().includes(q) ||
      s.heading.toLowerCase().includes(q)
  );
}
