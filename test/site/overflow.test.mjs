// No page scrolls sideways on a phone (issue #65 review): every page whose text has a run with no
// space in it long enough to pass a 390px line, or a breadcrumb that long (long-runs.mjs finds
// them all from the HTML), is opened at 390px, and its page must be no wider than the screen. Run with: npm run test:site.
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
import { pagesWithLongRuns, longestRun, longestCrumb, LONG_RUN } from "./long-runs.mjs";
import { CHROMIUM_ARGS } from "./a11y-tree.mjs";

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
  await browser?.close();
  server?.close();
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
