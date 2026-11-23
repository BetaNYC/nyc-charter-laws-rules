#!/usr/bin/env node
// CLI: builds the BetaNYC Law Reader, a static website for the Charter (issue #62, epic #68),
// from the index and its structure. It never fetches anything.
//
//   npm run build-site                      reads data/index/json/ and data/structure/, writes _site/
//   node scripts/build-site.js --index-dir <dir> --structure-dir <dir> --out <dir> [--no-search]
//
// The output folder is git-ignored and is never committed (epic #68, decision 5). --no-search
// skips the Pagefind index (the unit tests use it to stay fast).

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
    else if (a === "--help" || a === "-h") {
      console.log("Usage: node scripts/build-site.js [--index-dir DIR] [--structure-dir DIR] [--out DIR] [--no-search] [--commit SHA]");
      process.exit(0);
    } else throw new Error(`unknown option ${a}`);
  }
  return opts;
}

try {
  const result = await buildSite(parseArgs(process.argv.slice(2)));
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
