// Browser tests for the Administrative Code (issue #65): the title-card front page, the
// titles-first contents tree and split chapters. Run with: npm run test:site (test.yml only;
// not the daily refresh, not the deploy). Pages and names come from the data, not today's counts.
//
// Builds the real Charter and Administrative Code (no Pagefind) into a temporary folder: about
// 360 MB, a few seconds. Skipped when data/structure/admin_code.json is missing.

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { buildSite } from "../../scripts/lib/site/build.js";
import { startServer } from "../../scripts/lib/site/serve.js";
import { parseSnapshot, controlProblems, linkProblems, focusableProblems, CHROMIUM_ARGS } from "./a11y-tree.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const skip = existsSync(join(ROOT, "data", "structure", "admin_code.json")) ? false : "no data/structure/admin_code.json";

let out, site, server, base, browser, admin, charter;
// Pages picked from the data, not from today's numbers (test.yml runs this on every push).
let splitSection, closedTitle, failTitle, splitChapter;

before(async () => {
  if (skip) return;
  out = mkdtempSync(join(tmpdir(), "law-reader-admin-"));
  site = await buildSite({ outDir: join(out, "site"), search: false, commit: "test" });
  admin = site.books.find((b) => b.corpus === "admin_code");
  charter = site.books.find((b) => b.corpus === "charter");
  splitChapter = admin.chapters.find((c) => c.parts && c.parts.length >= 3);
  splitSection = splitChapter.parts[0].sections.at(-1);
  const others = admin.titles.filter((t) => t !== splitChapter.titleNode && t.chapters.length && !t.synthetic);
  [closedTitle, failTitle] = [others[0], others[1]];
  ({ server, url: base } = await startServer(site.outDir));
  browser = await chromium.launch({ args: CHROMIUM_ARGS });
});

after(async () => {
  await browser?.close();
  server?.close();
  if (out) rmSync(out, { recursive: true, force: true });
});

async function open(path, { width = 1200, js = true, route } = {}) {
  const ctx = await browser.newContext({ viewport: { width, height: 900 }, javaScriptEnabled: js, reducedMotion: "reduce" });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  if (route) await route(page);
  await page.goto(base + path, { waitUntil: "networkidle" });
  return { page, ctx, errors };
}

const named = async (page) => {
  const nodes = parseSnapshot(await page.locator("body").ariaSnapshot());
  return { c: controlProblems(nodes), l: linkProblems(nodes) };
};

test("a section page: one button per title, the reader's open; every control named once", { skip }, async () => {
  const { page, ctx, errors } = await open(splitSection.path);
  const buttons = page.locator("#contents .tree > li > button.tw");
  assert.equal(await buttons.count(), admin.titles.length);
  const own = splitChapter.titleNode;
  assert.equal(await page.getByRole("button", { name: `Chapters in ${own.name}`, exact: true }).getAttribute("aria-expanded"), "true");
  assert.equal(await page.getByRole("button", { name: `Chapters in ${closedTitle.name}`, exact: true }).getAttribute("aria-expanded"), "false");
  for (const t of admin.titles.filter((x) => !x.chapters.length)) {
    assert.equal(await page.getByRole("button", { name: `Sections in ${t.name}`, exact: true }).count(), 1, t.name);
  }
  const { c, l } = await named(page);
  assert.deepEqual(c.unnamed, []);
  assert.deepEqual(c.duplicates, []);
  assert.deepEqual(l.conflicting, []);
  assert.deepEqual(await focusableProblems(page), []);
  // The Charter's own pages say only what is true of the Charter (review finding 2).
  const box = await page.locator(".copy-box").textContent();
  assert.doesNotMatch(box, /The Charter:|official Charter/);
  assert.deepEqual(errors, []);
  await ctx.close();
});

test("a Charter page's box names the Charter alone, not both books", { skip }, async () => {
  const { page, ctx } = await open("/charter/");
  const box = await page.locator(".copy-box").textContent();
  assert.match(box, /The official Charter is at American Legal Publishing\./);
  assert.doesNotMatch(box, /Administrative Code|official texts/);
  await ctx.close();
});

test("opening a title: Loading… in the status line, then its chapters; focus stays on the button; a second press while loading does nothing", { skip }, async () => {
  let release;
  let fetches = 0;
  const held = new Promise((ok) => (release = ok));
  const { page, ctx } = await open(splitSection.path, {
    route: (p) =>
      p.route(`**/admin-code/contents/titles/${closedTitle.slug}.json`, async (r) => {
        fetches++;
        await held;
        await r.continue();
      }),
  });
  const b = page.getByRole("button", { name: `Chapters in ${closedTitle.name}`, exact: true });
  await b.focus();
  await page.keyboard.press("Enter");
  await page.waitForFunction(() => document.querySelector(".tree-status")?.textContent === "Loading…");
  assert.equal(await page.getByRole("status").filter({ hasText: "Loading…" }).count(), 1);
  // Pressed again while busy (review finding 5): no second fetch, no second list.
  await page.keyboard.press("Enter");
  await b.click();
  release();
  await page.waitForFunction((id) => document.getElementById(id)?.children.length > 0, `toc-${closedTitle.slug}`);
  await page.waitForTimeout(200);
  assert.equal(fetches, 1, "one fetch");
  assert.equal(await page.locator(`#toc-${closedTitle.slug} > li`).count(), closedTitle.chapters.length + closedTitle.sections.length, "the list once");
  assert.equal(await b.getAttribute("aria-expanded"), "true");
  assert.equal(await page.locator(".tree-status").textContent(), "");
  assert.ok(await b.evaluate((el) => el === document.activeElement), "focus stays on the button");
  assert.equal(await page.locator(`#toc-${closedTitle.slug} > li > a`).first().getAttribute("href"), closedTitle.chapters[0].path);
  await ctx.close();
});

test("a title that fails to load says so in the status line, stays closed, and can be tried again", { skip }, async () => {
  let fail = true;
  const { page, ctx } = await open(splitSection.path, {
    route: (p) => p.route(`**/admin-code/contents/titles/${failTitle.slug}.json`, (r) => (fail ? r.abort() : r.continue())),
  });
  const b = page.getByRole("button", { name: `Chapters in ${failTitle.name}`, exact: true });
  await b.click();
  await page.waitForFunction(() => /Could not load/.test(document.querySelector(".tree-status")?.textContent ?? ""));
  assert.ok((await page.locator(".tree-status").textContent()).startsWith(`Could not load the chapters in ${failTitle.name}.`));
  assert.equal(await b.getAttribute("aria-expanded"), "false");
  assert.ok(await b.evaluate((el) => el === document.activeElement), "focus stays on the button");
  fail = false;
  await b.click();
  await page.waitForFunction((id) => document.getElementById(id)?.children.length > 0, `toc-${failTitle.slug}`);
  assert.equal(await b.getAttribute("aria-expanded"), "true");
  assert.equal(await page.locator(".tree-status").textContent(), "");
  await ctx.close();
});

test("without JavaScript: titles are links, and a title's page lists its chapters", { skip }, async () => {
  const { page, ctx } = await open(splitSection.path, { js: false });
  assert.equal(await page.locator("#contents button.tw").count(), 0);
  const { page: tp, ctx: tctx } = await open(closedTitle.path, { js: false });
  for (const c of closedTitle.chapters) assert.equal(await tp.locator(`main a[href="${c.path}"]`).count(), 1, c.path);
  await ctx.close();
  await tctx.close();
});

test("a part page: heading, parts list, previous and next part; every control named once", { skip }, async () => {
  const p = splitChapter.parts[1];
  const { page, ctx, errors } = await open(p.path);
  assert.ok((await page.locator("h1").textContent()).endsWith(`part 2 of ${splitChapter.parts.length}`));
  assert.equal(await page.locator(`nav.parts a[aria-current="page"]`).getAttribute("href"), p.path);
  const pager = page.getByRole("navigation", { name: "Previous and next part" });
  assert.equal(await pager.getByRole("link").count(), 2);
  const { c, l } = await named(page);
  assert.deepEqual(c.duplicates, []);
  assert.deepEqual(l.conflicting, []);
  assert.deepEqual(errors, []);
  await ctx.close();
});

test("pages with two sections of one number and heading: every control and link named apart", { skip }, async () => {
  // Every part or chapter page that holds two sections with one citation (review finding 3).
  const pages = [];
  for (const sh of admin.shared) {
    const holders = new Set(sh.sections.map((s) => s.part ?? s.chapter));
    for (const h of holders) if (sh.sections.filter((s) => (s.part ?? s.chapter) === h).length > 1) pages.push(h.path);
  }
  assert.ok(pages.length > 0, "the data has such pages");
  for (const path of [...new Set(pages)].slice(0, 6)) {
    const { page, ctx } = await open(path);
    const { c, l } = await named(page);
    assert.deepEqual(c.duplicates, [], path);
    assert.deepEqual(l.conflicting, [], path);
    await ctx.close();
  }
});

test("the 404 page: an id in both books offers both; a book in the path picks it", { skip }, async () => {
  const both = admin.records.find((r) => charter.byId.has(r.id));
  if (!both) return;
  const { page, ctx } = await open(`/${both.id}`);
  await page.waitForFunction(() => /more than one book/.test(document.getElementById("redirect-status")?.textContent ?? ""));
  assert.equal(await page.locator(`main a[href="${charter.byId.get(both.id).path}"]`).count(), 1);
  assert.equal(await page.locator(`main a[href="${both.path}"]`).count(), 1);
  const { c, l } = await named(page);
  assert.deepEqual(l.conflicting, []);
  await page.goto(`${base}/admin-code/${both.id}`);
  await page.waitForURL(`${base}${both.path}`);
  await ctx.close();
});

test("the Admin Code's front page: one card per title, each named once, with a visible focus ring", { skip }, async () => {
  const { page, ctx, errors } = await open("/admin-code/");
  const cards = page.locator("ol.title-cards > li > a");
  assert.equal(await cards.count(), admin.titles.length);
  const t = admin.titles.find((x) => !x.synthetic && x.chapters.length > 1);
  assert.equal(await page.getByRole("link", { name: `Title ${t.number} ${t.title} ${t.chapters.length} chapters`, exact: true }).count(), 1);
  const last = admin.titles.at(-1);
  if (last.synthetic) assert.equal(await page.getByRole("link", { name: `${last.title} ${last.chapters.length} chapters`, exact: true }).count(), 1);
  assert.equal(await page.locator("main a[href*='/chapters/']").count(), 0, "no chapter is listed");
  const { c, l } = await named(page);
  assert.deepEqual(c.duplicates, []);
  assert.deepEqual(l.unnamed, []);
  assert.deepEqual(l.conflicting, []);
  assert.deepEqual(await focusableProblems(page), []);
  // Keyboard focus on a card draws the template's ring.
  await cards.nth(2).focus();
  await page.keyboard.press("Shift+Tab");
  await page.keyboard.press("Tab");
  const outline = await cards.nth(2).evaluate((a) => getComputedStyle(a).outlineStyle + " " + getComputedStyle(a).outlineWidth);
  assert.match(outline, /^solid [1-9]/, outline);
  // One column on a phone.
  await page.setViewportSize({ width: 390, height: 800 });
  const cols = await page.locator("ol.title-cards").evaluate((el) => getComputedStyle(el).gridTemplateColumns.split(" ").length);
  assert.equal(cols, 1);
  assert.deepEqual(errors, []);
  await ctx.close();
});

test("the home page with both books: two Browse buttons, every control named once", { skip }, async () => {
  const { page, ctx, errors } = await open("/");
  assert.equal(await page.getByRole("link", { name: "Browse the Administrative Code" }).count(), 1);
  assert.equal(await page.getByRole("link", { name: "Browse the Charter" }).count(), 1);
  const { c, l } = await named(page);
  assert.deepEqual(c.duplicates, []);
  assert.deepEqual(l.conflicting, []);
  assert.deepEqual(errors, []);
  await ctx.close();
});

// Issue #78: a group record (the longest one in the data: in July 2026, reference standard RS 18-1)
// is a page like any section's: in the contents tree, with Copy link and Copy citation, no
// sideways scroll on a phone, every control named once.
test("a group record's page: in the tree, copy link and citation, fits a phone, every control named once", { skip }, async () => {
  const groups = admin.sections.filter((s) => s.level !== "Section" && s.level !== "Chapter");
  if (!groups.length) return; // data built before #78
  const s = groups.reduce((a, b) => (b.text.length > a.text.length ? b : a));
  for (const width of [1280, 390]) {
    const ctx = await browser.newContext({ viewport: { width, height: 900 }, reducedMotion: "reduce", permissions: ["clipboard-read", "clipboard-write"] });
    const page = await ctx.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(base + s.path, { waitUntil: "networkidle" });
    assert.equal((await page.locator("h1 .cite").textContent()).trim(), s.fullCitation);
    if (width === 1280) {
      assert.equal(await page.locator(`#contents a[aria-current="page"]`).getAttribute("href"), s.path, "the tree marks this page");
    }
    await page.getByRole("button", { name: "Copy citation", exact: true }).click();
    await page.getByRole("status").filter({ hasText: "Copied the citation" }).waitFor();
    assert.equal(await page.evaluate(() => navigator.clipboard.readText()), s.fullCitation);
    await page.getByRole("button", { name: "Copy link", exact: true }).click();
    await page.getByRole("status").filter({ hasText: "Copied the link" }).waitFor();
    assert.ok((await page.evaluate(() => navigator.clipboard.readText())).endsWith(s.path));
    const [sw, cw] = await page.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.clientWidth]);
    assert.ok(sw <= cw, `no sideways scroll at ${width}px (${sw} > ${cw})`);
    const { c, l } = await named(page);
    assert.deepEqual(c.unnamed, []);
    assert.deepEqual(c.duplicates, []);
    assert.deepEqual(l.conflicting, []);
    assert.deepEqual(errors, []);
    await ctx.close();
  }
});
