// No page scrolls sideways on a phone (issue #65 review): every page whose text has a run with no
// space in it long enough to pass a 390px line, or a breadcrumb that long (long-runs.mjs finds
// them all from the HTML), is opened at 390px, and its page must be no wider than the screen.
// Every page that shows a table (issue #65) is opened at 390px and 320px (a wide table scrolls in
// its own box, never the page) and printed at 720px (every table fits the paper's width).
// Run with: npm run test:site.
//
// Builds the committed data's whole site (every book it can: the Rules once their index names
// titles), without Pagefind, into a temporary folder. Skipped when data/structure/ is missing.
// LAW_READER_SITE=<folder> checks a site already built there instead (a July build, say).

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { buildSite } from "../../scripts/lib/site/build.js";
import { startServer } from "../../scripts/lib/site/serve.js";
import { pagesWithLongRuns, pagesWithTables, longestRun, longestCrumb, LONG_RUN } from "./long-runs.mjs";
import { CHROMIUM_ARGS } from "./a11y-tree.mjs";
import { closeBrowser, closeServer } from "./cleanup.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const given = process.env.LAW_READER_SITE ? resolve(process.env.LAW_READER_SITE) : null;
const skip = given || ["charter", "admin_code"].every((c) => existsSync(join(ROOT, "data", "structure", `${c}.json`))) ? false : "no data/structure/";

let out, siteDir, server, base, browser;
before(async () => {
  if (skip) return;
  if (given) siteDir = given;
  else {
    out = mkdtempSync(join(tmpdir(), "law-reader-overflow-"));
    siteDir = (await buildSite({ outDir: join(out, "site"), search: false, commit: "test" })).outDir;
  }
  ({ server, url: base } = await startServer(siteDir));
  browser = await chromium.launch({ args: CHROMIUM_ARGS });
});

after(async () => {
  await closeBrowser(browser);
  closeServer(server);
  if (out) rmSync(out, { recursive: true, force: true });
});

test("longestRun reads <main>'s text, across tags and entities", () => {
  const html = `<nav>${"x".repeat(80)}</nav><main id="main"><p>a <a href="#">b${"_".repeat(10)}</a><strong>${"_".repeat(25)}</strong>&amp;c d</p></main>`;
  assert.equal(longestRun(html), `b${"_".repeat(35)}&c`);
  assert.ok(LONG_RUN <= 30);
  assert.equal(longestCrumb(`<nys-breadcrumbs class="crumbs"><ol><li><a href="/">Home</a></li><li><span aria-current="page">Owner&#39;s form</span></li></ol></nys-breadcrumbs>`), "Owner's form");
});

test("at 390px, no page with a long unbroken run or a long breadcrumb scrolls sideways", { skip }, async (t) => {
  const pages = pagesWithLongRuns(siteDir);
  t.diagnostic(`${pages.length} pages have a run of ${LONG_RUN} or more characters with no space, or a breadcrumb that long`);
  const ctx = await browser.newContext({ viewport: { width: 390, height: 800 }, reducedMotion: "reduce" });
  const page = await ctx.newPage();
  const wide = [];
  for (const { path } of pages) {
    await page.goto(base + path, { waitUntil: "load" });
    const [sw, cw] = await page.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.clientWidth]);
    if (sw > cw) wide.push(`${path} (${sw}px)`);
  }
  await ctx.close();
  t.diagnostic(`${wide.length} of them scroll sideways`);
  assert.deepEqual(wide, []);
});

test("at 390px and 320px, no page with a table scrolls sideways (the table's box does)", { skip }, async (t) => {
  const pages = pagesWithTables(siteDir);
  if (!pages.length) return t.skip("no page shows a table as a table: the structure has no rows yet (built before #65)");
  t.diagnostic(`${pages.length} pages show ${pages.reduce((n, p) => n + p.tables, 0)} tables`);
  const wide = [];
  let scrolling = 0;
  for (const width of [390, 320]) {
    const ctx = await browser.newContext({ viewport: { width, height: 800 }, reducedMotion: "reduce" });
    const page = await ctx.newPage();
    for (const { path } of pages) {
      await page.goto(base + path, { waitUntil: "load" });
      const [sw, cw, boxes] = await page.evaluate(() => [
        document.documentElement.scrollWidth,
        document.documentElement.clientWidth,
        [...document.querySelectorAll(".table-scroll")].filter((b) => b.scrollWidth > b.clientWidth).length,
      ]);
      if (sw > cw) wide.push(`${path} at ${width}px (${sw}px)`);
      if (width === 320) scrolling += boxes;
    }
    await ctx.close();
  }
  t.diagnostic(`${wide.length} scroll sideways; at 320px, ${scrolling} tables scroll inside their own box`);
  assert.deepEqual(wide, []);
});

// US Letter less Chromium's default margins is about 739 CSS px; 720px is a little narrower.
test("in print, every table fits the paper's width: its cells wrap rather than run off the page", { skip }, async (t) => {
  const pages = pagesWithTables(siteDir);
  if (!pages.length) return t.skip("no page shows a table as a table: the structure has no rows yet (built before #65)");
  const ctx = await browser.newContext({ viewport: { width: 720, height: 1000 }, reducedMotion: "reduce" });
  const page = await ctx.newPage();
  await page.emulateMedia({ media: "print" });
  const cut = [];
  for (const { path } of pages) {
    await page.goto(base + path, { waitUntil: "load" });
    const [right, width] = await page.evaluate(() => [
      Math.max(0, ...[...document.querySelectorAll(".table-scroll table")].map((x) => x.getBoundingClientRect().right)),
      document.documentElement.clientWidth,
    ]);
    if (right > width) cut.push(`${path} (${Math.round(right)}px)`);
  }
  await ctx.close();
  t.diagnostic(`${pages.length} pages with tables printed at 720px; ${cut.length} cut off`);
  assert.deepEqual(cut, []);
});
