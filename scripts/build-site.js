#!/usr/bin/env node
// CLI: builds the BetaNYC Law Reader, a static website for the Charter, the Administrative Code
// and the Rules (issues #62 and #65, epic #68), from the index and its structure. It never fetches
// anything. The Rules are left out, with a line on stderr, when their index has no titles yet
// (built before 0.7.0; scripts/lib/site/build.js).
//
//   npm run build-site                      reads data/index/json/ and data/structure/, writes _site/
//   node scripts/build-site.js --index-dir <dir> --structure-dir <dir> --out <dir> [--no-search] [--charter-only]
//
// The output folder is git-ignored and is never committed (epic #68, decision 5). --no-search
// skips the Pagefind index (the unit tests use it to stay fast). --charter-only leaves out the
// other books (a quick local look at the Charter; the deploy builds all three).

import { buildSite } from "./lib/site/build.js";

function parseArgs(argv) {
  const opts = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => {
      const v = argv[++i];
      if (v === undefined) throw new Error(`${a} needs a value`);
      return v;
    };
    if (a === "--index-dir") opts.indexDir = next();
    else if (a === "--structure-dir") opts.structureDir = next();
    else if (a === "--out") opts.outDir = next();
    else if (a === "--no-search") opts.search = false;
    else if (a === "--commit") opts.commit = next();
    else if (a === "--charter-only") opts.books = ["charter"];
    else if (a === "--help" || a === "-h") {
      console.log("Usage: node scripts/build-site.js [--index-dir DIR] [--structure-dir DIR] [--out DIR] [--no-search] [--commit SHA] [--charter-only]");
      process.exit(0);
    } else throw new Error(`unknown option ${a}`);
  }
  return opts;
}

try {
  const result = await buildSite(parseArgs(process.argv.slice(2)));
  for (const [book, why] of Object.entries(result.skipped ?? {})) console.error(`build-site: left out ${book}: ${why}`);
  const mb = (n) => (n / 1024 / 1024).toFixed(2);
  console.log(
    JSON.stringify({
      event: "build-site.done",
      outDir: result.outDir,
      pages: result.pageCount,
      lawPages: result.lawPageCount,
      files: result.fileCount,
      bytes: result.bytes,
      megabytes: Number(mb(result.bytes)),
      books: result.books.map((b) => b.book.slug),
      skipped: result.skipped,
      pagefindFiles: result.pagefind?.files ?? 0,
      pagefindBytes: result.pagefind?.bytes ?? 0,
      seconds: result.seconds,
      pagesSeconds: result.pagesSeconds,
      searchSeconds: result.searchSeconds,
    })
  );
} catch (e) {
  console.error(`build-site: ${e.message}`);
  process.exit(1);
}
