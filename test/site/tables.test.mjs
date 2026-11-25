// Tables in a browser (issue #65): the Rules' tables as real tables through NYSDS's nys-table, a
// wide one scrolling inside its own named box at 390px and 320px while the page does not, the box
// reached and scrolled by keyboard, and the same table with JavaScript off and in print. Run
// with: npm run test:site.
//
// The data: the Charter and Rules fixtures plus test/fixtures/tables/rules/ (two of American
// Legal Publishing's Rules files: Title 2's Appendix A, a 9-column table; Title 28 Chapter 32,
// § 32-04's table with a two-row head). Fixtures, so a refresh of the law text cannot change the
// result. The committed data's table pages are opened at 390px by overflow.test.mjs.

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { startServer } from "../../scripts/lib/site/serve.js";
import { buildRulesFixtureSite } from "./fixture-site.mjs";
import { parseSnapshot, controlProblems, linkProblems, focusableProblems, CHROMIUM_ARGS } from "./a11y-tree.mjs";

const TABLES_XML = join(dirname(fileURLToPath(import.meta.url)), "..", "fixtures", "tables", "rules");

let out, site, server, base, browser, rules, wide, headed, chapter;

before(async () => {
  const extra = readdirSync(TABLES_XML).filter((f) => f.endsWith(".xml")).sort().map((f) => readFileSync(join(TABLES_XML, f), "utf8"));
  site = await buildRulesFixtureSite({ extra });
  out = join(site.outDir, "..");
  rules = site.books.find((b) => b.corpus === "rules");
  wide = rules.ordered.find((r) => r.citation === "Appendix A" && r.titleNumber === "2");
  headed = rules.ordered.find((r) => r.citation === "§ 32-04");
  chapter = rules.chapters.find((c) => c.titleNumber === "28" && /Chapter 32/.test(c.citation));
  assert.ok(wide && headed && chapter, "the table fixtures are on the site");
  ({ server, url: base } = await startServer(site.outDir));
  browser = await chromium.launch({ args: CHROMIUM_ARGS });
});

after(async () => {
  await browser?.close();
  server?.close();
  if (out) rmSync(out, { recursive: true, force: true });
});

async function open(path, { width = 1200, js = true } = {}) {
  const ctx = await browser.newContext({ viewport: { width, height: 900 }, javaScriptEnabled: js, reducedMotion: "reduce" });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(base + path, { waitUntil: "networkidle" });
  if (js) await page.waitForFunction(() => customElements.get("nys-table") && [...document.querySelectorAll("nys-table")].every((t) => t.shadowRoot));
  return { page, ctx, errors };
}

// The table's cells, row by row, as the page shows them.
const cellsOf = (page) => page.evaluate(() => [...document.querySelectorAll(".table-scroll tr")].map((tr) => [...tr.children].map((c) => `${c.tagName}:${c.textContent.trim()}`)));

test("a section's table: nys-table keeps the publisher's rows in order, two head rows in <thead>, headers scoped", async () => {
  const js = await open(headed.path);
  const off = await open(headed.path, { js: false });
  // nys-table rebuilds a table that lacks <thead> or <tbody>; ours has both, so it is left as written.
  assert.deepEqual(await cellsOf(js.page), await cellsOf(off.page));
  const shape = await js.page.evaluate(() => {
    const t = document.querySelector(".table-scroll nys-table table");
    return { head: t.tHead.rows.length, body: t.tBodies[0].rows.length, scopes: [...t.tHead.querySelectorAll("th")].map((th) => th.getAttribute("scope")) };
  });
  assert.deepEqual(shape, { head: 2, body: 15, scopes: ["col", "col", "col", "col", "col", "col", "col"] });
  // A header spanning two columns keeps scope="col" after nys-table runs (it sets a scope only
  // where one is missing), and the table has no <colgroup>, so no header is in the column group
  // state that would apply to nothing. Under the HTML table model a column header covers every
  // column it spans. (Playwright's aria snapshot does not list a cell's headers, so this reads
  // the table's DOM.)
  const covered = await js.page.evaluate(() => {
    const t = document.querySelector(".table-scroll table");
    const th = [...t.tHead.rows[0].cells].find((c) => c.colSpan > 1);
    return { scope: th.scope, span: th.colSpan, colgroups: t.querySelectorAll("colgroup").length };
  });
  assert.deepEqual(covered, { scope: "col", span: 2, colgroups: 0 });
  // The accessibility tree: a table with column headers. At 1200px it fits its box, so the box is
  // no region and no tab stop (law.js wireTables).
  const snap = await js.page.locator("main").ariaSnapshot();
  assert.match(snap, /- table:/);
  assert.match(snap, /- columnheader "/);
  assert.doesNotMatch(snap, /- region "Table/);
  assert.equal(await js.page.locator(".table-scroll").evaluate((e) => [e.scrollWidth <= e.clientWidth, e.getAttribute("role"), e.getAttribute("tabindex")].join()), "true,,");
  const nodes = parseSnapshot(await js.page.locator("body").ariaSnapshot());
  assert.deepEqual(controlProblems(nodes).duplicates, []);
  assert.deepEqual(linkProblems(nodes).conflicting, []);
  assert.deepEqual(await focusableProblems(js.page), []);
  assert.deepEqual(js.errors, []);
  await js.ctx.close();
  await off.ctx.close();
});

test("a wide table scrolls inside its own box at 390px and 320px; the page does not scroll sideways", async () => {
  for (const width of [390, 320]) {
    for (const path of [wide.path, headed.path, chapter.path]) {
      const { page, ctx } = await open(path, { width });
      const [sw, cw] = await page.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.clientWidth]);
      assert.ok(sw <= cw, `${path} at ${width}px is ${sw - cw}px wider than the screen`);
      if (path === wide.path) {
        const box = await page.locator(".table-scroll").evaluate((e) => [e.scrollWidth, e.clientWidth]);
        assert.ok(box[0] > box[1], `at ${width}px the 9-column table is wider than its box (${box[0]} > ${box[1]}), so the box scrolls`);
      }
      await ctx.close();
    }
  }
});

test("the box: reached by Tab, named, shows the focus ring, and the arrow keys scroll it", async () => {
  const { page, ctx } = await open(wide.path, { width: 390 });
  const box = page.locator(".table-scroll");
  for (let i = 0; i < 80 && !(await box.evaluate((e) => e === document.activeElement)); i++) await page.keyboard.press("Tab");
  assert.ok(await box.evaluate((e) => e === document.activeElement), "Tab reaches the table's box");
  assert.equal(await box.evaluate((e) => e.computedName), `Table, ${wide.fullCitation}`);
  assert.equal(await box.evaluate((e) => getComputedStyle(e).outlineStyle), "solid");
  const before = await box.evaluate((e) => e.scrollLeft);
  await page.keyboard.press("ArrowRight");
  await page.waitForFunction((b) => document.querySelector(".table-scroll").scrollLeft > b, before);
  await ctx.close();
});

test("a box is a region and a tab stop only while its table is wider than it, and again after a resize", async () => {
  const { page, ctx } = await open(headed.path, { width: 1200 });
  const box = page.locator(".table-scroll");
  const state = () => box.evaluate((e) => ({ scrolls: e.scrollWidth > e.clientWidth, role: e.getAttribute("role"), tab: e.getAttribute("tabindex"), name: e.computedName }));
  assert.deepEqual(await state(), { scrolls: false, role: null, tab: null, name: "" });
  await page.setViewportSize({ width: 320, height: 900 });
  await page.waitForFunction(() => document.querySelector(".table-scroll").getAttribute("role") === "region");
  assert.deepEqual(await state(), { scrolls: true, role: "region", tab: "0", name: `Table, ${headed.fullCitation}` });
  await page.setViewportSize({ width: 1200, height: 900 });
  await page.waitForFunction(() => !document.querySelector(".table-scroll").hasAttribute("role"));
  assert.deepEqual(await state(), { scrolls: false, role: null, tab: null, name: "" });
  await ctx.close();
});

test("a focused box that stops scrolling keeps its tab stop and name until the focus leaves it", async () => {
  const { page, ctx } = await open(headed.path, { width: 320 });
  const box = page.locator(".table-scroll");
  await page.waitForFunction(() => document.querySelector(".table-scroll").getAttribute("role") === "region");
  await box.focus();
  await page.setViewportSize({ width: 1200, height: 900 });
  await page.waitForFunction(() => { const b = document.querySelector(".table-scroll"); return b.scrollWidth <= b.clientWidth; });
  // Give the ResizeObserver its turn, then the focus must still be on the box, which keeps its name.
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  assert.deepEqual(await box.evaluate((e) => [e === document.activeElement, e.getAttribute("tabindex"), e.getAttribute("role"), e.computedName]), [true, "0", "region", `Table, ${headed.fullCitation}`]);
  // Once the focus leaves, the box that fits is no region and no tab stop.
  await page.keyboard.press("Tab");
  await page.waitForFunction(() => !document.querySelector(".table-scroll").hasAttribute("tabindex"));
  assert.equal(await box.evaluate((e) => e.hasAttribute("role") || e.hasAttribute("aria-label")), false);
  await ctx.close();
});

test("a chapter page's copy: its table box is named for its section, and every box on the page has its own name", async () => {
  const { page, ctx } = await open(chapter.path, { width: 320 });
  // At 320px the chapter page links to its sections instead of showing their copies; at 1200px
  // the copies show, and the names are the ones law.js gives a box that scrolls.
  await page.setViewportSize({ width: 1200, height: 900 });
  const names = await page.locator(".table-scroll").evaluateAll((els) => els.map((e) => e.dataset.tableName));
  assert.ok(names.length >= 1);
  assert.equal(new Set(names).size, names.length);
  assert.ok(names.some((n) => n.endsWith(headed.fullCitation) || n.includes(`${headed.fullCitation},`)), names.join(" | "));
  assert.deepEqual(await focusableProblems(page), []);
  await ctx.close();
});

test("JavaScript off and in print: still a plain table, with borders, nothing cut off", async () => {
  const { page, ctx } = await open(wide.path, { js: false, width: 390 });
  assert.equal(await page.evaluate(() => customElements.get("nys-table")), undefined);
  const snap = await page.locator("main").ariaSnapshot();
  assert.match(snap, /- table:/);
  // Without law.js the box has no name and no tabindex, but Chromium lets the keyboard reach a
  // box that scrolls on its own, so the arrow keys still scroll the table.
  const box = page.locator(".table-scroll");
  assert.equal(await box.evaluate((e) => e.hasAttribute("tabindex") || e.hasAttribute("role")), false);
  for (let i = 0; i < 80 && !(await box.evaluate((e) => e === document.activeElement)); i++) await page.keyboard.press("Tab");
  assert.ok(await box.evaluate((e) => e === document.activeElement), "with JavaScript off, Tab still reaches the box that scrolls");
  // (waitForFunction polls in the page, which does not run with JavaScript off: poll from here.)
  let scrolled = 0;
  for (let i = 0; i < 20 && !scrolled; i++) {
    await page.keyboard.press("ArrowRight");
    await page.waitForTimeout(100);
    scrolled = await box.evaluate((e) => e.scrollLeft);
  }
  assert.ok(scrolled > 0, "the arrow keys scroll the box with JavaScript off");
  const border = await page.locator(".table-scroll td").first().evaluate((e) => getComputedStyle(e).borderTopWidth);
  assert.equal(border, "1px");
  await page.emulateMedia({ media: "print" });
  const printed = await page.locator(".table-scroll").evaluate((e) => getComputedStyle(e).overflowX);
  assert.equal(printed, "visible", "on paper the box does not scroll, so nothing is hidden behind it");
  assert.ok(await page.locator(".table-scroll table").isVisible());
  await ctx.close();
});

// US Letter is 8.5 in, Chromium's default print margins about 0.4 in each side: about 7.7 in, or
// 739 CSS px at 96 px per inch. 720px is a little narrower, as the review measured.
const PRINT_WIDTH = 720;

test("in print, a wide table wraps its cells to fit the page: its right edge is inside the paper's width", async () => {
  for (const js of [true, false]) {
    const { page, ctx } = await open(wide.path, { js, width: PRINT_WIDTH });
    await page.emulateMedia({ media: "print" });
    const [right, width] = await page.evaluate(() => [
      Math.max(...[...document.querySelectorAll(".table-scroll table")].map((t) => t.getBoundingClientRect().right)),
      document.documentElement.clientWidth,
    ]);
    assert.ok(right <= width, `JavaScript ${js ? "on" : "off"}: the 9-column table ends at ${right}px, past the ${width}px page`);
    // Its words may break anywhere (9 columns); a 5-column table's stay whole.
    assert.equal(await page.locator(".table-scroll td").first().evaluate((e) => getComputedStyle(e).overflowWrap), "anywhere");
    // And the PDF Chromium makes from it is US Letter.
    if (js) assert.ok((await page.pdf({ format: "Letter" })).length > 1000);
    await ctx.close();
  }
  const { page, ctx } = await open(headed.path, { js: false, width: PRINT_WIDTH });
  await page.emulateMedia({ media: "print" });
  assert.equal(await page.locator(".table-scroll td").first().evaluate((e) => getComputedStyle(e).overflowWrap), "break-word");
  const [right, width] = await page.evaluate(() => [document.querySelector(".table-scroll table").getBoundingClientRect().right, document.documentElement.clientWidth]);
  assert.ok(right <= width, `the 5-column table ends at ${right}px, past the ${width}px page`);
  await ctx.close();
});
