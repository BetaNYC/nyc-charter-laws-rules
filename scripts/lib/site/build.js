// The site build (issue #62): reads the index and structure, writes the static site. The only
// I/O in the site code is here; everything it calls is pure. It never fetches anything.

import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, statSync, copyFileSync, rmSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { loadBook } from "./model.js";
import { readFooter, disclaimerParagraphs } from "./disclaimer.js";
import { newYorkLongDate, newYorkIso, newYorkDay } from "./clock.js";
import {
  sectionPage,
  chapterPage,
  sharedNumberPage,
  contentsPage,
  homePage,
  searchPage,
  aboutPage,
  notFoundPage,
} from "./pages.js";
import { redirectsJson, indexJson, citationsJson, metadataJson, sitemaps, robotsTxt } from "./outputs.js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

/** The marker the build leaves in its folder, so it only ever clears a folder it made. */
export const BUILD_MARKER = ".law-reader-build";

const ASSETS = [
  ["site/template/site.css", "assets/site.css"],
  ["site/template/nav.js", "assets/nav.js"],
  ["site/template/betanyc-wordmark-white.svg", "assets/betanyc-wordmark-white.svg"],
  ["site/template/betanyc-wordmark-blue.svg", "assets/betanyc-wordmark-blue.svg"],
  ["site/template/favicon.svg", "assets/favicon.svg"],
  ["site/assets/law.css", "assets/law.css"],
  ["site/assets/law.js", "assets/law.js"],
  ["site/assets/jump.js", "assets/jump.js"],
  ["site/assets/search.js", "assets/search.js"],
  ["site/assets/not-found.js", "assets/not-found.js"],
];

// The two packages the site copies files from. Both are devDependencies of this repo; a missing
// one fails the build here, with the fix, rather than leaving a page without its parts.
function packageDir(name) {
  const dir = join(ROOT, "node_modules", ...name.split("/"));
  if (!existsSync(join(dir, "package.json"))) throw new Error(`${name} is not installed: run npm install`);
  return dir;
}
const nysdsDir = () => packageDir("@nysds/components");
const pagefindDir = () => packageDir("pagefind");

/** "Current through Local Law 2026/165, enacted November 19, 2026," → "... 2026." */
export function currentThroughLine(currentThrough) {
  const t = String(currentThrough ?? "").trim().replace(/[,;:\s]+$/, "");
  if (!t) throw new Error("versions.json has no currentThrough line");
  return t.endsWith(".") ? t : `${t}.`;
}

function gitCommit() {
  if (process.env.GITHUB_SHA) return process.env.GITHUB_SHA;
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return "unknown";
  }
}

function prepareOut(outDir) {
  if (existsSync(outDir)) {
    const entries = readdirSync(outDir);
    if (entries.length && !entries.includes(BUILD_MARKER)) {
      throw new Error(`${outDir} is not empty and was not made by build-site (no ${BUILD_MARKER}); not clearing it`);
    }
    rmSync(outDir, { recursive: true, force: true });
  }
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, BUILD_MARKER), "Made by scripts/build-site.js; safe to delete.\n");
  writeFileSync(join(outDir, ".nojekyll"), "");
}

function write(outDir, rel, content) {
  const p = join(outDir, rel);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, content);
}

function folderStats(dir) {
  let files = 0;
  let bytes = 0;
  const walk = (d) => {
    for (const name of readdirSync(d)) {
      const p = join(d, name);
      const st = statSync(p);
      if (st.isDirectory()) walk(p);
      else {
        files++;
        bytes += st.size;
      }
    }
  };
  if (existsSync(dir)) walk(dir);
  return { files, bytes };
}

/** The Charter's entry in DATA-SOURCES.json: where the official text is, and the credit line. */
export function sourceFacts(dataSources, corpus) {
  const s = dataSources.sources?.find((x) => x.id === corpus);
  if (!s?.verify_at || !s?.terms?.credit_line) throw new Error(`DATA-SOURCES.json has no verify_at or credit line for ${corpus}`);
  return { officialUrl: s.verify_at, creditLine: s.terms.credit_line };
}

/**
 * Build the site. Returns counts, sizes and timings.
 * @param {object} [o]
 * @param {string} [o.indexDir]       data/index/json
 * @param {string} [o.structureDir]   data/structure
 * @param {string} [o.outDir]         _site
 * @param {boolean} [o.search=true]   build the Pagefind index
 * @param {Date} [o.now]              the build's clock (tests fix it)
 * @param {string} [o.commit]         this repo's commit (default: GITHUB_SHA, then git)
 */
export async function buildSite(o = {}) {
  const t0 = performance.now();
  const indexDir = resolve(o.indexDir ?? join(ROOT, "data", "index", "json"));
  const structureDir = resolve(o.structureDir ?? join(ROOT, "data", "structure"));
  const outDir = resolve(o.outDir ?? join(ROOT, "_site"));
  const corpus = "charter";
  const now = o.now ?? new Date();

  const need = [join(indexDir, `${corpus}.json`), join(indexDir, "versions.json"), join(structureDir, `${corpus}.json`)];
  for (const f of need) {
    if (!existsSync(f)) {
      throw new Error(
        `missing ${f}. data/structure/ comes from npm run build-index (after npm run fetch-data), or from the daily refresh on main.`
      );
    }
  }
  const book = loadBook({
    corpus,
    indexJsonText: readFileSync(need[0], "utf8"),
    versions: JSON.parse(readFileSync(need[1], "utf8")),
    structure: JSON.parse(readFileSync(need[2], "utf8")),
  });
  const { officialUrl, creditLine } = sourceFacts(JSON.parse(readFileSync(join(ROOT, "DATA-SOURCES.json"), "utf8")), corpus);
  const paragraphs = disclaimerParagraphs(readFooter(join(ROOT, "src", "tools.ts")));
  const site = {
    currentThrough: currentThroughLine(book.version.currentThrough),
    copiedOn: newYorkLongDate(book.version.indexedAt),
    officialUrl,
    officialName: book.book.official,
    creditLine,
    contentsPath: `/${book.book.slug}/`,
  };
  const metadata = metadataJson({
    books: [book],
    builtAt: newYorkIso(now),
    builtOn: newYorkDay(now),
    commit: o.commit ?? gitCommit(),
    structureFormat: 1,
  });

  prepareOut(outDir);
  for (const [from, to] of ASSETS) {
    mkdirSync(dirname(join(outDir, to)), { recursive: true });
    copyFileSync(join(ROOT, from), join(outDir, to));
  }
  mkdirSync(join(outDir, "assets", "nysds"), { recursive: true });
  copyFileSync(join(nysdsDir(), "dist", "nysds.js"), join(outDir, "assets", "nysds", "nysds.js"));
  mkdirSync(join(outDir, "licenses"), { recursive: true });
  copyFileSync(join(nysdsDir(), "LICENSE.md"), join(outDir, "licenses", "nysds-LICENSE.md"));
  copyFileSync(join(pagefindDir(), "LICENSE", "LICENSE"), join(outDir, "licenses", "pagefind-LICENSE.txt"));

  const pages = [
    homePage(book, site),
    contentsPage(book, site),
    ...book.chapters.map((c) => chapterPage(c, book, site)),
    ...book.sections.map((s) => sectionPage(s, book, site)),
    ...book.shared.map((sh) => sharedNumberPage(sh, book, site)),
    searchPage(book, site),
    aboutPage(book, site, { paragraphs, metadata: { builtOnLong: newYorkLongDate(now) } }),
    notFoundPage(book, site),
  ];
  for (const p of pages) write(outDir, p.file, p.html);

  write(outDir, "redirects.json", JSON.stringify(redirectsJson([book])));
  write(outDir, "index.json", JSON.stringify(indexJson([book])));
  write(outDir, "citations.json", JSON.stringify(citationsJson([book])));
  write(outDir, "metadata.json", JSON.stringify(metadata, null, 2) + "\n");
  const other = pages.filter((p) => p.kind === "home" || p.kind === "about").map((p) => p.path);
  for (const [f, xml] of Object.entries(sitemaps([book], other))) write(outDir, f, xml);
  write(outDir, "robots.txt", robotsTxt());
  const t1 = performance.now();

  let pagefind = null;
  if (o.search !== false) {
    const pf = await import("pagefind");
    try {
      const { index, errors: createErrors } = await pf.createIndex({});
      if (!index) throw new Error(`Pagefind could not start: ${(createErrors ?? []).join("; ")}`);
      const added = await index.addDirectory({ path: outDir });
      if (added.errors?.length) throw new Error(`Pagefind indexing failed: ${added.errors.join("; ")}`);
      const written = await index.writeFiles({ outputPath: join(outDir, "pagefind") });
      if (written.errors?.length) throw new Error(`Pagefind could not write its files: ${written.errors.join("; ")}`);
      pagefind = { indexedPages: added.page_count, ...folderStats(join(outDir, "pagefind")) };
    } finally {
      await pf.close();
    }
  }
  const t2 = performance.now();
  const total = folderStats(outDir);
  const lawPageCount = pages.filter((p) => p.kind === "section" || p.kind === "chapter").length;
  return {
    outDir,
    book,
    pages,
    pageCount: pages.length,
    lawPageCount,
    fileCount: total.files,
    bytes: total.bytes,
    pagefind,
    metadata,
    seconds: Number(((t2 - t0) / 1000).toFixed(2)),
    pagesSeconds: Number(((t1 - t0) / 1000).toFixed(2)),
    searchSeconds: Number(((t2 - t1) / 1000).toFixed(2)),
  };
}
