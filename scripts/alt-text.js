#!/usr/bin/env node
// Picture descriptions for the Administrative Code and the Rules (issue #87).
//
//   npm run alt:inventory    -- [--check-map <picture-map.csv>]
//   npm run alt:draft        -- [--limit N] [--book rules] [--force] [--model id] [--yes]
//   npm run alt:review       -- [--port 8765]
//   npm run alt:build-static -- --out <folder> [--include-drafts]
//
// Every command reads American Legal Publishing's files from a source per book: by default
// data/raw/<book>.zip (npm run fetch-data), or a folder or zip given with --admin-code and
// --rules (a folder holds XML/ and IMAGES/). --book limits a command to one book.
// Descriptions are stored in data/alt-text/<book>.json (--store-dir to change).

import { resolve, join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync, readFileSync } from "node:fs";
import { BOOKS, openSource } from "./lib/alt-text/source.js";
import { buildInventory, loadIndex, parseCsv, compareWithMap } from "./lib/alt-text/inventory.js";
import { readStore, staleEntries } from "./lib/alt-text/store.js";
import { DEFAULT_MODEL, DEFAULT_EFFORT, PRICES, ASSUMED_OUTPUT_TOKENS, pendingJobs, estimate, makeClient, runDrafts, buildRequest } from "./lib/alt-text/draft.js";
import { imageBytes } from "./lib/alt-text/inventory.js";
import { startReviewServer } from "./lib/alt-text/server.js";
import { buildStatic } from "./lib/alt-text/static-build.js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const [command, ...args] = process.argv.slice(2);
const flag = (name) => args.includes(name);
const opt = (name, dflt) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] !== undefined ? args[i + 1] : dflt;
};

const USAGE = `Usage: node scripts/alt-text.js <inventory|draft|review|build-static> [options]
Sources: --admin-code <folder|zip> --rules <folder|zip> (default data/raw/<book>.zip), --book <admin_code|rules>
Also: --index-dir (default data/index/json), --store-dir (default data/alt-text)`;

function setup() {
  const only = opt("--book", null);
  if (only && !BOOKS.includes(only)) throw new Error(`--book must be one of ${BOOKS.join(", ")}`);
  const books = only ? [only] : BOOKS;
  const indexDir = resolve(opt("--index-dir", join(ROOT, "data/index/json")));
  const storeDir = resolve(opt("--store-dir", join(ROOT, "data/alt-text")));
  const sources = {};
  const inventories = [];
  for (const book of books) {
    const given = opt(book === "admin_code" ? "--admin-code" : "--rules", null);
    const path = resolve(given ?? join(ROOT, "data/raw", `${book}.zip`));
    if (!existsSync(path)) throw new Error(`No source for ${book}: ${path} is missing. Run npm run fetch-data, or pass ${book === "admin_code" ? "--admin-code" : "--rules"} <folder|zip>.`);
    sources[book] = openSource(path);
    const inv = buildInventory(book, sources[book], loadIndex(book, indexDir));
    inventories.push(inv);
  }
  return { books, sources, inventories, storeDir };
}

function summary(inv, storeDir) {
  const ids = new Set(inv.images.flatMap((i) => i.image_ids));
  const uses = inv.images.flatMap((i) => i.uses);
  const store = readStore(storeDir, inv.book);
  const entries = inv.images.map((i) => store.images[i.sha256]);
  const count = (s) => entries.filter((e) => e?.status === s).length;
  console.log(`${inv.book}: ${inv.tags} picture tags, ${ids.size} image files, ${inv.images.length} distinct images (by sha256), ${uses.filter((u) => u.inline).length} tags inside a sentence, ${inv.missing.length} tags with no image file.`);
  console.log(`  Descriptions: ${entries.filter((e) => e?.draft).length} drafted, ${count("needs-work")} need work, ${count("reviewed")} reviewed, ${entries.filter((e) => !e).length} not started.`);
  const stale = staleEntries(store, inv);
  if (stale.length) console.log(`  ${stale.length} stored description(s) match no current image (the image changed or is no longer used): ${stale.map((s) => s.image_ids?.join("+")).join(", ")}`);
  for (const m of inv.missing.slice(0, 10)) console.log(`  missing image file: ${m.picture_id} (${m.citation})`);
}

async function main() {
  if (!command || flag("--help")) {
    console.log(USAGE);
    return;
  }
  if (command === "inventory") {
    const { inventories, storeDir } = setup();
    for (const inv of inventories) summary(inv, storeDir);
    const mapFile = opt("--check-map", null);
    if (mapFile) {
      const rows = parseCsv(readFileSync(resolve(mapFile), "utf8"));
      let bad = 0;
      for (const inv of inventories) {
        const diffs = compareWithMap(inv, rows);
        bad += diffs.length;
        console.log(`  ${inv.book} against ${mapFile}: ${diffs.length ? `${diffs.length} difference(s)` : "matches"}`);
        for (const d of diffs.slice(0, 20)) console.log(`    ${d}`);
      }
      if (bad) process.exitCode = 1;
    }
    return;
  }

  if (command === "draft") {
    const model = opt("--model", process.env.ALT_TEXT_MODEL || DEFAULT_MODEL);
    const effort = opt("--effort", DEFAULT_EFFORT);
    const limit = opt("--limit", null) === null ? Infinity : Number(opt("--limit"));
    if (!(limit > 0)) throw new Error("--limit must be a positive number");
    const onlyIds = opt("--only", null)?.split(",") ?? null;
    const { sources, inventories, storeDir } = setup();
    const jobs = pendingJobs(inventories, storeDir, { force: flag("--force"), limit, only: onlyIds });
    const est = estimate(jobs, model);
    console.log(`${jobs.length} picture(s) to draft with ${model} (effort ${effort}).`);
    if (!jobs.length) return;
    console.log(
      `Estimate: about ${est.input.toLocaleString("en-US")} input and ${est.output.toLocaleString("en-US")} output tokens (assuming ${ASSUMED_OUTPUT_TOKENS} output tokens per picture, thinking included), ${
        est.dollars === null ? `no price on file for ${model}` : `about $${est.dollars.toFixed(2)} at list price (${PRICES[model].join(" / ")} dollars per million tokens in / out)`
      }. This is a rough estimate, not a quote.`,
    );
    if (flag("--show-request")) {
      const j = jobs[0];
      const req = buildRequest({ book: j.book, image: j.image, bytes: imageBytes(sources[j.book], j.image), model, effort, fallbacks: !flag("--no-fallbacks") });
      req.messages[0].content[0].source.data = `<${req.messages[0].content[0].source.data.length} characters of base64>`;
      console.log(JSON.stringify(req, null, 2));
    }
    if (!flag("--yes")) {
      console.log("Nothing sent. Run again with --yes to send these requests (this costs money).");
      return;
    }
    const client = makeClient({ apiKey: process.env.ANTHROPIC_API_KEY });
    const r = await runDrafts({ jobs, sources, storeDir, client, model, effort, fallbacks: !flag("--no-fallbacks"), concurrency: Number(opt("--concurrency", "2")) || 2 });
    const price = PRICES[model];
    console.log(`Drafted ${r.done}; failed ${r.failed.length}. Tokens used: ${r.usage.input} in, ${r.usage.output} out${price ? ` (about $${((r.usage.input * price[0] + r.usage.output * price[1]) / 1e6).toFixed(2)} at ${model} list price)` : ""}.`);
    if (r.stopped) console.log(`Stopped early: ${r.stopped}`);
    if (r.failed.length) process.exitCode = 1;
    return;
  }

  if (command === "review") {
    const { sources, inventories, storeDir } = setup();
    for (const inv of inventories) summary(inv, storeDir);
    const { url } = await startReviewServer({ inventories, sources, storeDir, port: Number(opt("--port", "8765")) });
    console.log(`Review page: ${url}/ (Ctrl-C to stop). Saves go to ${storeDir}.`);
    return;
  }

  if (command === "build-static") {
    const out = opt("--out", null);
    if (!out) throw new Error("--out <folder> is required");
    const { sources, inventories, storeDir } = setup();
    const r = buildStatic({ inventories, sources, storeDir, outDir: resolve(out), includeDrafts: flag("--include-drafts") });
    console.log(`Wrote ${r.items} pictures (${r.images} image files) to ${resolve(out)}. Not published anywhere.`);
    return;
  }

  console.log(USAGE);
  process.exitCode = 2;
}

main().catch((e) => {
  console.error(`Error: ${e.message}`);
  process.exitCode = 1;
});
