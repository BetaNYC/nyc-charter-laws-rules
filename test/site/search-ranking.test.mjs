// How search ranks local-law notes on the committed data (issue #65). Run with: npm run test:site
// (test.yml), not test:site-data: Pagefind searches only in a browser (its JavaScript API,
// pagefind.app/docs/api), and the deploy job that runs test:site-data has no browser.
//
// Builds the committed data's whole site with its Pagefind index into a temporary folder (about
// 700 MB and 20 seconds; skipped when data/structure is missing) and searches it in headless
// Chromium with the queries in test/fixtures/search-ranking/queries.json, two measures that pull
// against each other (pages.js LOCAL_LAW_TITLE_WEIGHT and LOCAL_LAW_WEIGHT balance them):
//   - crowding: 20 subject searches where notes, at full weight, crowded the sections out of the
//     first 10 results (24 notes in all on the November 2026 data);
//   - note subjects: 40 notes, each searched by its own "in relation to" subject, where the note
//     is the answer (21 in the first 10 at full weight; at least 45% must be).
// The bounds are loose on purpose (the data changes daily); the measured numbers are printed.

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { buildSite } from "../../scripts/lib/site/build.js";
import { startServer } from "../../scripts/lib/site/serve.js";
import { CHROMIUM_ARGS } from "./a11y-tree.mjs";
import { closeBrowser, closeServer } from "./cleanup.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const QUERIES = JSON.parse(readFileSync(join(ROOT, "test", "fixtures", "search-ranking", "queries.json"), "utf8"));
const skip = existsSync(join(ROOT, "data", "structure", "admin_code.json")) ? false : "no data/structure/admin_code.json";

let out, server, base, browser, page, notes;

before(async () => {
  if (skip) return;
  out = mkdtempSync(join(tmpdir(), "law-reader-ranking-"));
  const site = await buildSite({ outDir: join(out, "site"), commit: "test" });
  notes = new Set(site.books.find((b) => b.corpus === "admin_code").sections.filter((s) => /^L\.L\. /.test(s.citation)).map((s) => s.citation));
  ({ server, url: base } = await startServer(site.outDir));
  browser = await chromium.launch({ args: CHROMIUM_ARGS });
  page = await browser.newPage();
  await page.goto(`${base}/about`);
});

after(async () => {
  await closeBrowser(browser);
  closeServer(server);
  if (out) rmSync(out, { recursive: true, force: true });
});

/** The titles of the first `n` results for a query, as search.js shows them. */
const titles = (q, n) =>
  page.evaluate(
    async ([q, n]) => {
      const pf = await import("/pagefind/pagefind.js");
      const r = await pf.search(q);
      return Promise.all(r.results.slice(0, n).map(async (x) => (await x.data()).meta.title));
    },
    [q, n]
  );
const isNote = (t) => /^L\.L\. \d{4}\/\d+$/.test(t);

test("crowding: subject searches show sections first, not the notes that restate them", { skip }, async () => {
  let total = 0;
  const rows = [];
  for (const q of QUERIES.crowding) {
    const top = await titles(q, 10);
    const n = top.filter(isNote).length;
    total += n;
    rows.push(`${q}: ${n}`);
  }
  console.log(`# crowding: ${total} notes in the first 10 results of ${QUERIES.crowding.length} searches (${rows.join("; ")})`);
  // November 2026: 24 with every note at full weight, 19 with a whole note at 0.5, 13 at 1.5 and
  // 0.1. The bound, fewer than 20, leaves the chosen weights six of room and fails full weight.
  assert.ok(total < QUERIES.crowding.length, `${total} notes in the first 10s: fewer than one a search expected`);
});

test("note subjects: a search for a law's subject still finds its note", { skip }, async () => {
  const present = QUERIES.noteSubjects.filter((x) => notes.has(x.note));
  assert.ok(present.length >= 30, `only ${present.length} of the sample's notes are in the index`);
  let inTop10 = 0;
  const ranks = [];
  for (const { note, query } of present) {
    const rank = (await titles(query, 50)).indexOf(note) + 1;
    ranks.push(rank);
    if (rank && rank <= 10) inTop10++;
  }
  console.log(`# note subjects: ${inTop10} of ${present.length} notes in the first 10 (ranks, 0 = not in the first 50: ${ranks.join(",")})`);
  // November 2026, of 40: 21 with every note at full weight, 21 at 1.5 and 0.1 (two of them at
  // rank 10), 16 with a whole note at 0.5, 15 at 0.25. The bound, 18 of 40, leaves the chosen
  // weights three notes of room for new law text and still fails both whole-note weights.
  const need = Math.ceil(present.length * 0.45);
  assert.ok(inTop10 >= need, `${inTop10} of ${present.length} in the first 10: at least ${need} expected`);
});

test("pinned: three laws whose note is the only answer to their subject stay in the first 10", { skip }, async () => {
  const pins = [
    ["term limits for elected officials", "L.L. 2008/051"],
    ["area name", "L.L. 1990/056"],
    ["childhood lead poisoning prevention", "L.L. 2004/001"],
  ];
  for (const [q, note] of pins) {
    if (!notes.has(note)) continue; // gone from the publisher's appendix
    const top = await titles(q, 10);
    assert.ok(top.includes(note), `"${q}": ${note} not in the first 10 (${top.join(" | ")})`);
  }
});
