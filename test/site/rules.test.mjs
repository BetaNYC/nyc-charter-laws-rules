// Browser tests for the Rules (issue #65): the titles-first menu, a section page and its Copy
// citation, the page to pick a title for a bare number, and a phone's width. Run with:
// npm run test:site (test.yml only; not the daily refresh, not the deploy).
//
// The data: the committed Charter and Rules when the Rules index names each record's title (0.6.3
// and later; built without Pagefind, a few seconds); else the Charter and Rules fixtures
// (test/site/fixture-site.mjs), so these tests run before the first refresh after 0.6.3 too.
// Pages and names come from the data, not from today's counts.

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { chromium } from "playwright";
import { buildSite } from "../../scripts/lib/site/build.js";
import { rulesReady } from "../../scripts/lib/site/model.js";
import { startServer } from "../../scripts/lib/site/serve.js";
import { buildRulesFixtureSite } from "./fixture-site.mjs";
import { parseSnapshot, controlProblems, linkProblems, focusableProblems, CHROMIUM_ARGS } from "./a11y-tree.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

/** True when data/ holds a Rules index with titles and the structure built from it. */
function realRulesReady() {
  const idx = join(ROOT, "data", "index", "json", "rules.json");
  const st = join(ROOT, "data", "structure", "rules.json");
  if (!existsSync(idx) || !existsSync(st)) return false;
  const text = readFileSync(idx, "utf8");
  if (JSON.parse(readFileSync(st, "utf8")).indexSha256 !== createHash("sha256").update(text).digest("hex")) return false;
  return rulesReady(JSON.parse(text));
}

let out, site, server, base, browser, rules;
let section, otherTitle, failTitle, pick, oneTitleNumber;

before(async () => {
  if (realRulesReady()) {
    out = mkdtempSync(join(tmpdir(), "law-reader-rules-"));
    site = await buildSite({ outDir: join(out, "site"), search: false, commit: "test", books: ["charter", "rules"] });
  } else {
    site = await buildRulesFixtureSite();
    out = join(site.outDir, "..");
  }
  rules = site.books.find((b) => b.corpus === "rules");
  // A section numbered in several titles (§ 1-01), in a title with more than one chapter if there is one.
  pick = rules.picks.reduce((a, b) => (b.sections.length > a.sections.length ? b : a));
  section = pick.sections.find((s) => s.titleNode.chapters.length > 1) ?? pick.sections[0];
  const others = rules.titles.filter((t) => t !== section.titleNode && t.chapters.length);
  [otherTitle, failTitle] = [others[0], others[1]];
  oneTitleNumber = Object.keys(rules.numbers)[0];
  ({ server, url: base } = await startServer(site.outDir));
  browser = await chromium.launch({ args: CHROMIUM_ARGS });
});

after(async () => {
  await browser?.close();
  server?.close();
  if (out) rmSync(out, { recursive: true, force: true });
});

async function open(path, { width = 1200, js = true, route, permissions } = {}) {
  const ctx = await browser.newContext({ viewport: { width, height: 900 }, javaScriptEnabled: js, reducedMotion: "reduce", ...(permissions ? { permissions } : {}) });
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

test("a Rules section page: its title's citation, Copy citation copies it, and every control is named once", async () => {
  const { page, ctx, errors } = await open(section.path, { permissions: ["clipboard-read", "clipboard-write"] });
  assert.match(section.fullCitation, /^\S+ RCNY /);
  assert.equal((await page.locator("h1 .cite").textContent()).trim(), section.fullCitation);
  assert.ok((await page.title()).startsWith(section.fullCitation));
  await page.getByRole("button", { name: "Copy citation", exact: true }).click();
  await page.getByRole("status").filter({ hasText: "Copied the citation" }).waitFor();
  assert.equal(await page.evaluate(() => navigator.clipboard.readText()), section.fullCitation);
  // The tree: one button per title, the reader's open, this page marked.
  assert.equal(await page.locator("#contents .tree > li > button.tw").count(), rules.titles.length);
  assert.equal(await page.getByRole("button", { name: `Chapters in ${section.titleNode.name}`, exact: true }).getAttribute("aria-expanded"), "true");
  assert.equal(await page.locator(`#contents a[aria-current="page"]`).getAttribute("href"), section.path);
  // The box at the bottom: the record at American Legal, and the City's rules site.
  const box = await page.locator(".copy-box").textContent();
  assert.match(box, new RegExp(`The official text of ${section.fullCitation.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} is at American Legal Publishing\\. The City posts the latest rules at rules\\.cityofnewyork\\.us\\.`));
  const { c, l } = await named(page);
  assert.deepEqual(c.unnamed, []);
  assert.deepEqual(c.duplicates, []);
  assert.deepEqual(l.conflicting, []);
  assert.deepEqual(await focusableProblems(page), []);
  assert.deepEqual(errors, []);
  await ctx.close();
});

test("the titles menu by keyboard: Loading… in the status line, then the chapters; focus stays; presses while loading do nothing", async () => {
  let release;
  let fetches = 0;
  const held = new Promise((ok) => (release = ok));
  const { page, ctx } = await open(section.path, {
    route: (p) =>
      p.route(`**/rules/contents/titles/${otherTitle.slug}.json`, async (r) => {
        fetches++;
        await held;
        await r.continue();
      }),
  });
  const b = page.getByRole("button", { name: `Chapters in ${otherTitle.name}`, exact: true });
  await b.focus();
  await page.keyboard.press("Enter");
  await page.waitForFunction(() => document.querySelector(".tree-status")?.textContent === "Loading…");
  assert.equal(await page.getByRole("status").filter({ hasText: "Loading…" }).count(), 1);
  await page.keyboard.press("Enter");
  await page.keyboard.press("Space");
  release();
  await page.waitForFunction((id) => document.getElementById(id)?.children.length > 0, `toc-${otherTitle.slug}`);
  await page.waitForTimeout(200);
  assert.equal(fetches, 1, "one fetch");
  assert.equal(await page.locator(`#toc-${otherTitle.slug} > li`).count(), otherTitle.chapters.length + otherTitle.sections.length, "the list once");
  assert.equal(await b.getAttribute("aria-expanded"), "true");
  assert.equal(await page.locator(".tree-status").textContent(), "");
  assert.ok(await b.evaluate((el) => el === document.activeElement), "focus stays on the button");
  // Tab goes on into the title's first chapter link.
  await page.keyboard.press("Tab");
  assert.equal(await page.evaluate(() => document.activeElement?.getAttribute("href")), `/rules/titles/${otherTitle.slug}`);
  await page.keyboard.press("Tab");
  assert.equal(await page.evaluate(() => document.activeElement?.getAttribute("href")), otherTitle.chapters[0].path);
  await ctx.close();
});

test("a title that fails to load says so, stays closed and keeps focus; the next press tries again", async () => {
  if (!failTitle) return;
  let fail = true;
  const { page, ctx } = await open(section.path, {
    route: (p) => p.route(`**/rules/contents/titles/${failTitle.slug}.json`, (r) => (fail ? r.abort() : r.continue())),
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
  await ctx.close();
});

test("a bare number in several titles: a page to pick one; in one title, the 404 page goes to it", async () => {
  const { page, ctx, errors } = await open(pick.path);
  assert.equal(await page.locator("main ul.pick-titles > li").count(), new Set(pick.sections.map((s) => s.titleNode)).size);
  for (const s of pick.sections.slice(0, 5)) {
    assert.equal(await page.getByRole("link", { name: s.title ? `${s.fullCitation}. ${s.title}` : s.fullCitation, exact: true }).getAttribute("href"), s.path);
  }
  const { c, l } = await named(page);
  assert.deepEqual(c.duplicates, []);
  assert.deepEqual(l.conflicting, []);
  // Follow one.
  await page.locator(`main a[href="${section.path}"]`).click();
  await page.waitForURL(`${base}${section.path}`);
  // /rules/sections/<n> for a number in one title only goes to its page (the static server serves 404.html).
  await page.goto(`${base}/rules/sections/${oneTitleNumber}`);
  await page.waitForURL(`${base}${rules.numbers[oneTitleNumber]}`);
  // An American Legal id goes to its record.
  await page.goto(`${base}/NYCrules/${section.id}`);
  await page.waitForURL(`${base}${section.path}`);
  assert.deepEqual(errors, []);
  await ctx.close();
});

test("the jump box: '<title> RCNY § <number>' goes to its page", async () => {
  const { page, ctx } = await open("/");
  const box = page.getByRole("searchbox", { name: /Go to a section/ }).or(page.getByRole("textbox", { name: /Go to a section/ })).first();
  await box.fill(`${section.titleNumber} RCNY ${section.citation}`);
  await box.press("Enter");
  await page.waitForURL(`${base}${section.path}`);
  await ctx.close();
});

test("the jump box: 'Title <n>, Chapter <m>' does not open the Rules; it offers them on the search page", async () => {
  const c = section.chapter.kind === "title" ? rules.chapters[0] : section.chapter;
  const { page, ctx } = await open("/");
  const box = page.getByRole("searchbox", { name: /Go to a section/ }).or(page.getByRole("textbox", { name: /Go to a section/ })).first();
  await box.fill(`Title ${c.titleNumber}, ${c.citation}`);
  await box.press("Enter");
  await page.waitForURL(/\/search\?q=/);
  await page.locator("#pick").waitFor({ state: "visible" });
  assert.equal(await page.locator(`#pick a[href="${c.path}"]`).count(), 1, "the Rules chapter is offered");
  await ctx.close();
});

test("at 390px: no sideways scroll on the Rules' pages; the cards are one column; Contents opens the menu", async () => {
  const pages = ["/rules/", section.titleNode.path, section.path, pick.path, rules.chapters.find((c) => c.parts)?.parts?.[0]?.path ?? section.chapter.path];
  for (const path of pages) {
    const { page, ctx, errors } = await open(path, { width: 390 });
    const [sw, cw] = await page.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.clientWidth]);
    assert.ok(sw <= cw, `${path}: no sideways scroll at 390px (${sw} > ${cw})`);
    if (path === "/rules/") {
      const cols = await page.locator("ol.title-cards").evaluate((el) => getComputedStyle(el).gridTemplateColumns.split(" ").length);
      assert.equal(cols, 1);
      assert.equal(await page.locator("ol.title-cards > li > a").count(), rules.titles.length);
    }
    if (path === section.path) {
      const open = page.locator("button.contents-open");
      assert.equal(await open.getAttribute("aria-expanded"), "false");
      await open.click();
      assert.equal(await open.getAttribute("aria-expanded"), "true");
      assert.ok(await page.locator("#contents").isVisible());
    }
    assert.deepEqual(errors, [], path);
    await ctx.close();
  }
});

test("without JavaScript: the titles are links, and a title's page lists its chapters", async () => {
  const { page, ctx } = await open(section.path, { js: false });
  assert.equal(await page.locator("#contents button.tw").count(), 0);
  await ctx.close();
  const { page: tp, ctx: tctx } = await open(otherTitle.path, { js: false });
  for (const c of otherTitle.chapters.slice(0, 20)) assert.equal(await tp.locator(`main a[href="${c.path}"]`).count(), 1, c.path);
  await tctx.close();
});

test("pages that hold records sharing a citation, and the page to pick one: every control and link named apart", async () => {
  const pages = rules.shared.map((sh) => sh.path);
  for (const sh of rules.shared) {
    const holders = new Set(sh.sections.map((s) => s.part ?? s.chapter));
    for (const h of holders) if (sh.sections.filter((s) => (s.part ?? s.chapter) === h).length > 1) pages.push(h.path);
  }
  assert.ok(pages.length > 0, "the data has such pages");
  for (const path of [...new Set(pages)].slice(0, 8)) {
    const { page, ctx, errors } = await open(path);
    const { c, l } = await named(page);
    assert.deepEqual(c.duplicates, [], path);
    assert.deepEqual(l.conflicting, [], path);
    assert.deepEqual(errors, [], path);
    await ctx.close();
  }
});
