// The site build (issues #62 and #65): reads the index and structure, writes the static site. The only
// I/O in the site code is here; everything it calls is pure. It never fetches anything.

import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, statSync, copyFileSync, rmSync } from "node:fs";
import { join, dirname, resolve, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { loadBook, rulesReady } from "./model.js";
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
  chapterSectionsPath,
  chapterSectionsJson,
} from "./pages.js";
import { redirectsJson, indexJson, citationsJson, metadataJson, sitemaps, robotsTxt } from "./outputs.js";
import { BOOKS, DEFAULT_BOOKS } from "./config.js";
import { adminPageMakers, titleChaptersPath, titleChaptersJson } from "./pages-admin.js";
import { rulesPageMakers, rulesNumbersPath } from "./pages-rules.js";
import { parseSourceErrors, visibleErrors } from "./source-errors.js";
import { sha256, imageSize } from "../alt-text/image-info.js";
import { sourceErrorsPage } from "./pages-source-errors.js";

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
  ["site/assets/filters.js", "assets/filters.js"],
  ["site/assets/not-found.js", "assets/not-found.js"],
  ["site/assets/source-errors.js", "assets/source-errors.js"],
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

/**
 * The Charter's entry in DATA-SOURCES.json: where the official text is, and the credit line.
 * verify_at is the book's first record at American Legal Publishing (".../NYCcharter/0-0-0-1");
 * officialBase is the same address without that id, so a law page can link to its own record
 * there (copy review S2).
 */
export function sourceFacts(dataSources, corpus) {
  const s = dataSources.sources?.find((x) => x.id === corpus);
  if (!s?.verify_at || !s?.terms?.credit_line) throw new Error(`DATA-SOURCES.json has no verify_at or credit line for ${corpus}`);
  const m = /^(https:\/\/codelibrary\.amlegal\.com\/codes\/newyorkcity\/latest\/[A-Za-z]+\/)\d+(?:-\d+)*$/.exec(s.verify_at);
  if (!m) throw new Error(`DATA-SOURCES.json verify_at for ${corpus} is not a record at American Legal Publishing: ${s.verify_at}`);
  return { officialUrl: s.verify_at, officialBase: m[1], creditLine: s.terms.credit_line };
}

/**
 * The facts each page needs about its book (issue #65 review): `perBook`, corpus → that book's own
 * facts, for its law and contents pages; and `shared`, for the home, search, About and 404 pages,
 * which also lists every book (`books`) when there is more than one, so their bottom box, "current
 * through" line and no-JavaScript links name each. A book's own pages never carry `books`: a
 * Charter page says only what is true of the Charter, even when the two books' dates differ.
 */
export function siteFacts(books, dataSources) {
  const navBooks = books.length > 1 ? books.map((b) => ({ slug: b.book.slug, short: b.book.short })) : undefined;
  const siteFor = (b) => {
    const { officialUrl, officialBase, creditLine } = sourceFacts(dataSources, b.book.source ?? b.corpus);
    return {
      currentThrough: currentThroughLine(b.version.currentThrough),
      // versions.json's indexedAt: when BetaNYC's index last picked up a change in the text
      // (scripts/lib/merge-versions.js keeps it when a rebuild changes nothing). Not a download date.
      copyChangedOn: newYorkLongDate(b.version.indexedAt),
      officialUrl,
      officialBase,
      officialName: b.book.official,
      // Where the City posts current rules (the Rules only).
      ...(b.book.latestUrl ? { latestUrl: b.book.latestUrl } : {}),
      creditLine,
      contentsPath: `/${b.book.slug}/`,
      ...(navBooks ? { navBooks } : {}),
    };
  };
  const perBook = new Map(books.map((b) => [b.corpus, siteFor(b)]));
  const first = perBook.get(books[0].corpus);
  const shared = books.length > 1 ? { ...first, books: books.map((b) => ({ ...perBook.get(b.corpus), long: b.book.long, name: b.book.name })) } : first;
  return { perBook, shared };
}

/**
 * Build the site. Returns counts, sizes and timings.
 * @param {object} [o]
 * @param {string} [o.indexDir]       data/index/json
 * @param {string} [o.structureDir]   data/structure
 * @param {string} [o.outDir]         _site
 * @param {boolean} [o.search=true]   build the Pagefind index
 * @param {string[]} [o.books]        corpora to build, the Charter first (default DEFAULT_BOOKS, less
 *                                    the Rules when their index has no titles: see below)
 * @param {Date} [o.now]              the build's clock (tests fix it)
 * @param {string} [o.commit]         this repo's commit (default: GITHUB_SHA, then git)
 * @param {string} [o.sourceErrorsFile] data/source-errors.json: errors in the publisher's text
 * @param {string} [o.sourceErrorImagesDir] their pictures (default: data/source-errors/images/ beside the file)
 * @param {boolean} [o.includeUnconfirmedErrors=false] also show the errors only found, not yet
 *                                    checked (a preview build: --include-unconfirmed-errors)
 */
export async function buildSite(o = {}) {
  const t0 = performance.now();
  const indexDir = resolve(o.indexDir ?? join(ROOT, "data", "index", "json"));
  const structureDir = resolve(o.structureDir ?? join(ROOT, "data", "structure"));
  const outDir = resolve(o.outDir ?? join(ROOT, "_site"));
  const now = o.now ?? new Date();
  // The books to build: the Charter and the Administrative Code (DEFAULT_BOOKS), or the Charter
  // alone (--charter-only; the fixture tests). The Charter always comes first: the home, search,
  // About and 404 pages are built around it.
  let corpora = o.books ?? DEFAULT_BOOKS;
  if (corpora[0] !== "charter") throw new Error(`the first book must be the Charter, not ${corpora[0]}`);
  for (const c of corpora) if (!BOOKS[c]) throw new Error(`no site settings for "${c}"`);

  const versionsFile = join(indexDir, "versions.json");
  const need = [versionsFile, ...corpora.flatMap((c) => [join(indexDir, `${c}.json`), join(structureDir, `${c}.json`)])];
  for (const f of need) {
    if (!existsSync(f)) {
      throw new Error(
        `missing ${f}. data/structure/ comes from npm run build-index (after npm run fetch-data), or from the daily refresh on main.`
      );
    }
  }
  const versions = JSON.parse(readFileSync(versionsFile, "utf8"));
  // The Rules need each record's title (`titleNumber`, in the index since 0.7.0, #59): their
  // paths and citations come from it. An index built before then has none, and the Rules are left
  // out (`skipped`, also in metadata.json, and printed by build-site.js), so the deploy that runs
  // before the first refresh after 0.7.0 still publishes the Charter and the Administrative Code,
  // and no Rules page with a wrong path. An index that names a title on some records only stops
  // the build (rulesReady).
  const indexText = new Map(corpora.map((c) => [c, readFileSync(join(indexDir, `${c}.json`), "utf8")]));
  const skipped = {};
  if (corpora.includes("rules") && !rulesReady(JSON.parse(indexText.get("rules")))) {
    skipped.rules = "the Rules index has no titles (titleNumber): it was built before 0.7.0";
    corpora = corpora.filter((c) => c !== "rules");
  }
  const dataSources = JSON.parse(readFileSync(join(ROOT, "DATA-SOURCES.json"), "utf8"));
  // Errors in the publisher's text. A file that does not match its schema stops the build.
  const sourceErrorsFile = resolve(o.sourceErrorsFile ?? join(ROOT, "data", "source-errors.json"));
  const preview = o.includeUnconfirmedErrors === true;
  const allSourceErrors = parseSourceErrors(readFileSync(sourceErrorsFile, "utf8"), sourceErrorsFile).errors;
  const shownErrors = visibleErrors(allSourceErrors, { includeUnconfirmed: preview });
  // Each shown error's pictures, from the committed copies (npm run source-errors:images), checked
  // against the sha256 its entry records. A missing or changed file stops the build: the page must
  // show the very picture the error was found in.
  const sourceErrorImagesDir = resolve(o.sourceErrorImagesDir ?? join(dirname(sourceErrorsFile), "source-errors", "images"));
  const errorPictures = new Map();
  for (const e of shownErrors) {
    errorPictures.set(
      e.id,
      e.evidence.images.map((i) => {
        const name = basename(i.file);
        const from = join(sourceErrorImagesDir, name);
        if (!existsSync(from)) throw new Error(`${e.id}: ${i.file} is not in ${sourceErrorImagesDir}. Run npm run source-errors:images.`);
        const bytes = readFileSync(from);
        if (sha256(bytes) !== i.sha256) throw new Error(`${e.id}: ${from} does not match the sha256 its entry records`);
        const size = imageSize(bytes);
        return { file: i.file, from, src: `/source-errors/img/${name}`, width: size?.width ?? null, height: size?.height ?? null };
      })
    );
  }
  const books = corpora.map((c) =>
    loadBook({
      corpus: c,
      indexJsonText: indexText.get(c),
      versions,
      structure: JSON.parse(readFileSync(join(structureDir, `${c}.json`), "utf8")),
    })
  );
  // Cross-references between books link when the build has both.
  if (books.length > 1) for (const b of books) b.others = new Map(books.filter((x) => x !== b).map((x) => [x.corpus, x]));
  const [book, ...extra] = books;
  const { perBook, shared: site } = siteFacts(books, dataSources);
  // Each shown error on its section's page (pages.js sectionPage, pages-admin.js adminSectionPage):
  // book.sourceErrors maps American Legal's id to the entries for that section. An entry for a
  // book this build has whose id is not one of its records is `unresolved`: still listed, with no
  // link to our page, and named on stderr (build-site.js) so a person can fix its amlegal_id.
  const unresolvedErrors = [];
  for (const b of books) b.sourceErrors = new Map();
  const bookOf = (e) => books.find((b) => b.corpus === e.book);
  const oursFor = (e) => {
    const r = bookOf(e)?.byId.get(e.amlegal_id);
    return r?.path ? { path: r.path } : null;
  };
  for (const e of shownErrors) {
    const b = bookOf(e);
    if (!b) continue;
    if (!oursFor(e)) {
      unresolvedErrors.push(e.id);
      continue;
    }
    b.sourceErrors.set(e.amlegal_id, [...(b.sourceErrors.get(e.amlegal_id) ?? []), e]);
  }
  // "Check at American Legal": the section's own page there, as a law page's bottom box links it
  // (pages.js officialRecordUrl), from DATA-SOURCES.json's address for the book, built or not.
  const amlegalUrl = (e) => `${sourceFacts(dataSources, BOOKS[e.book].source ?? e.book).officialBase}${encodeURIComponent(e.amlegal_id)}`;
  const paragraphs = disclaimerParagraphs(readFooter(join(ROOT, "src", "tools.ts")));
  const metadata = metadataJson({
    books,
    builtAt: newYorkIso(now),
    builtOn: newYorkDay(now),
    commit: o.commit ?? gitCommit(),
    structureFormat: 1,
    skipped,
  });
  // What the errors page shows: how many, how many of those are not yet checked, and whether this
  // is a preview build (never deployed: deploy-site.yml runs build-site without the flag).
  metadata.sourceErrors = {
    shown: shownErrors.length,
    unchecked: shownErrors.filter((e) => e.status === "found").length,
    includeUnconfirmed: preview,
    ...(unresolvedErrors.length ? { unresolved: unresolvedErrors } : {}),
  };

  prepareOut(outDir);
  for (const [from, to] of ASSETS) {
    mkdirSync(dirname(join(outDir, to)), { recursive: true });
    copyFileSync(join(ROOT, from), join(outDir, to));
  }
  for (const pics of errorPictures.values()) {
    for (const p of pics) {
      mkdirSync(join(outDir, "source-errors", "img"), { recursive: true });
      copyFileSync(p.from, join(outDir, p.src.slice(1)));
    }
  }
  mkdirSync(join(outDir, "assets", "nysds"), { recursive: true });
  copyFileSync(join(nysdsDir(), "dist", "nysds.js"), join(outDir, "assets", "nysds", "nysds.js"));
  mkdirSync(join(outDir, "licenses"), { recursive: true });
  copyFileSync(join(nysdsDir(), "LICENSE.md"), join(outDir, "licenses", "nysds-LICENSE.md"));
  copyFileSync(join(pagefindDir(), "LICENSE", "LICENSE"), join(outDir, "licenses", "pagefind-LICENSE.txt"));

  const pages = [
    homePage(book, site, extra),
    // The Charter's own pages speak for the Charter alone (its box, its "current through" line).
    contentsPage(book, perBook.get(book.corpus)),
    ...book.chapters.map((c) => chapterPage(c, book, perBook.get(book.corpus))),
    ...book.sections.map((s) => sectionPage(s, book, perBook.get(book.corpus))),
    ...book.shared.map((sh) => sharedNumberPage(sh, book, perBook.get(book.corpus))),
    searchPage(book, site, extra),
    aboutPage(book, site, { paragraphs, metadata: { builtOnLong: newYorkLongDate(now) }, others: extra }),
    notFoundPage(book, site, extra),
    sourceErrorsPage({ entries: shownErrors, preview, ours: oursFor, amlegalUrl, pictures: (e) => errorPictures.get(e.id) ?? [], site }),
  ];
  for (const p of pages) write(outDir, p.file, p.html);
  for (const b of extra) {
    const bsite = perBook.get(b.corpus);
    if (!b.book.titles) throw new Error(`${b.corpus}: only a book laid out by titles can follow the Charter for now`);
    for (const make of (b.book.rcny ? rulesPageMakers : adminPageMakers)(b, bsite)) {
      const p = make();
      write(outDir, p.file, p.html);
      pages.push({ path: p.path, file: p.file, kind: p.kind, book: b.book.slug, bytes: Buffer.byteLength(p.html) });
    }
  }
  for (const b of extra) for (const t of b.titles) write(outDir, titleChaptersPath(b, t).slice(1), JSON.stringify(titleChaptersJson(t)));
  // The Rules' numbers that are in one title only, for the 404 page (/rules/sections/3-01).
  for (const b of extra) if (b.numbers) write(outDir, rulesNumbersPath(b).slice(1), JSON.stringify(b.numbers));
  // Each chapter's sections, for the contents tree: a page carries only its own chapter's list,
  // and law.js loads another chapter's when the reader opens it (pages.js contentsTree).
  for (const c of book.chapters) if (c.sections.length) write(outDir, chapterSectionsPath(book, c).slice(1), JSON.stringify(chapterSectionsJson(c)));

  write(outDir, "redirects.json", JSON.stringify(redirectsJson(books)));
  write(outDir, "index.json", JSON.stringify(indexJson(books)));
  write(outDir, "citations.json", JSON.stringify(citationsJson(books)));
  write(outDir, "metadata.json", JSON.stringify(metadata, null, 2) + "\n");
  // The errors page is in the sitemap, except in a preview build (which is noindex).
  const other = pages.filter((p) => p.kind === "home" || p.kind === "about" || (p.kind === "source-errors" && !preview)).map((p) => p.path);
  for (const [f, xml] of Object.entries(sitemaps(books, other))) write(outDir, f, xml);
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
    books,
    pages,
    pageCount: pages.length,
    lawPageCount,
    fileCount: total.files,
    bytes: total.bytes,
    pagefind,
    metadata,
    skipped,
    sourceErrors: { shown: shownErrors, unresolved: unresolvedErrors },
    seconds: Number(((t2 - t0) / 1000).toFixed(2)),
    pagesSeconds: Number(((t1 - t0) / 1000).toFixed(2)),
    searchSeconds: Number(((t2 - t1) / 1000).toFixed(2)),
  };
}
