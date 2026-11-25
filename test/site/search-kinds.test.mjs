// Browser tests for the search page's filters and kinds of result (issue #65). Run with:
// npm run test:site. Builds the Charter, Administrative Code (test/fixtures/site-admin/) and Rules
// fixtures with their Pagefind index, serves them on 127.0.0.1 and opens headless Chromium.
// Offline: nothing loads from outside the site.

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { buildThreeBookFixtureSite } from "./fixture-site.mjs";
import { startServer } from "../../scripts/lib/site/serve.js";
import { parseSnapshot, controlProblems, linkProblems, focusableProblems, CHROMIUM_ARGS } from "./a11y-tree.mjs";

let site, server, base, browser, admin;
const outside = [];

before(async () => {
  site = await buildThreeBookFixtureSite({ search: true });
  admin = site.books.find((b) => b.corpus === "admin_code");
  ({ server, url: base } = await startServer(site.outDir));
  browser = await chromium.launch({ args: CHROMIUM_ARGS });
});

after(async () => {
  await browser?.close();
  server?.close();
});

async function open(path, { width = 1200, js = true } = {}) {
  const ctx = await browser.newContext({ viewport: { width, height: 900 }, javaScriptEnabled: js });
  const page = await ctx.newPage();
  const problems = [];
  page.on("console", (m) => m.type() === "error" && problems.push(`console: ${m.text()}`));
  page.on("pageerror", (e) => problems.push(`page error: ${e.message}`));
  page.on("requestfailed", (r) => problems.push(`failed: ${r.url()}`));
  page.on("request", (r) => {
    if (!r.url().startsWith(base)) outside.push(r.url());
  });
  await page.goto(base + path, { waitUntil: "networkidle" });
  return { page, ctx, problems };
}

const settled = (page) => page.getByRole("status").filter({ hasText: /results? for|No results for/ }).waitFor();
const checkbox = (page, name) => page.locator("#filters").getByRole("checkbox", { name, exact: true });
const hitPaths = (page) => page.locator("ol.hits > li.hit h2 a").evaluateAll((as) => as.map((a) => a.getAttribute("href")));
const kinds = (page) => page.locator("ol.hits .where").allInnerTexts();
// Whether the element has focus, looking through shadow roots (NYSDS keeps its inputs in one).
const focused = (loc) =>
  loc.evaluate((el) => {
    let a = document.activeElement;
    while (a?.shadowRoot?.activeElement) a = a.shadowRoot.activeElement;
    return a === el || el.contains(a) || el.shadowRoot?.contains(a) === true;
  });
const BOOKS = ["Charter", "Administrative Code", "Rules"];
const KINDS = ["Sections", "Chapters", "Local laws"];

const note = () => admin.sections.find((s) => s.citation === "L.L. 2016/002");
const section = () => admin.sections.find((s) => s.citation === "§ 10-172");

test("filters: Book (Charter, Administrative Code, Rules) and Kind of page (Sections, Chapters, Local laws), each named once", async () => {
  for (const width of [1200, 390]) {
    const { page, ctx, problems } = await open("/search?q=turnstile", { width });
    await settled(page);
    const groups = page.locator("#filters nys-checkboxgroup");
    assert.deepEqual(await page.locator("#filters").getByRole("group").evaluateAll((g) => g.length), 2);
    for (const [label, names] of [["Book", BOOKS], ["Kind of page", KINDS]]) {
      const group = page.locator("#filters").getByRole("group", { name: label, exact: true });
      const found = parseSnapshot(await group.ariaSnapshot()).filter((n) => n.role === "checkbox").map((n) => n.name);
      assert.deepEqual(found, names, `${label} at ${width}px`);
      for (const n of names) assert.equal(await checkbox(page, n).isChecked(), true, `${n} starts checked`);
    }
    assert.equal(await groups.count(), 2);
    // Agents on the page: every control has a name, none shares one, every focusable thing has a role.
    assert.deepEqual(await focusableProblems(page), [], `focusable at ${width}px`);
    const nodes = parseSnapshot(await page.locator("body").ariaSnapshot());
    const c = controlProblems(nodes);
    assert.deepEqual(c.unnamed, [], `unnamed at ${width}px`);
    assert.deepEqual(c.duplicates, [], `duplicates at ${width}px`);
    assert.deepEqual(linkProblems(nodes).conflicting, [], `links at ${width}px`);
    assert.deepEqual(problems, []);
    await ctx.close();
  }
});

test("a local-law note is labeled as one, and ranks below the section on the same subject", async () => {
  const { page, ctx, problems } = await open("/search?q=turnstile");
  await settled(page);
  assert.deepEqual(await hitPaths(page), [section().path, note().path]);
  assert.deepEqual((await kinds(page)).map((k) => k.replace(/\s+/g, " ").trim().toLowerCase()), ["nyc administrative code section", "nyc administrative code local law"]);
  assert.equal(await page.locator("ol.hits > li.hit").nth(1).locator("h2 a").innerText(), "L.L. 2016/002");
  // A year of local laws says so. Its heading is what search reads ("Local laws, 2016"; the year
  // page's copies of the notes are not indexed).
  await page.goto(`${base}/search?q=${encodeURIComponent("local laws 2016")}`, { waitUntil: "networkidle" });
  await settled(page);
  const hits = await page.locator("ol.hits > li.hit").evaluateAll((lis) =>
    lis.map((li) => [li.querySelector(".where").textContent.replace(/\s+/g, " ").trim().toLowerCase(), li.querySelector("h2 a").textContent.trim()])
  );
  const year = admin.chapters.find((c) => c.citation === "2016");
  assert.ok(
    hits.some(([where, title]) => where === "nyc administrative code local laws by year" && title === year.longName),
    hits.map((h) => h.join(": ")).join(" | ")
  );
  assert.deepEqual(problems, []);
  await ctx.close();
});

test("keyboard: Space on a checkbox filters the results, the address keeps it, and Back undoes it", async () => {
  const { page, ctx, problems } = await open("/search?q=turnstile");
  await settled(page);
  await checkbox(page, "Local laws").focus();
  await page.keyboard.press("Space");
  await page.waitForURL(/kind=Section&kind=Chapter$/);
  await page.getByRole("status").filter({ hasText: /^1 result for “turnstile”/ }).waitFor();
  assert.deepEqual(await hitPaths(page), [section().path]);
  assert.equal(await checkbox(page, "Local laws").isChecked(), false);
  // Tab from Go reaches the boxes, in order: Charter, then Administrative Code; Space works there too.
  await page.getByRole("button", { name: "Go", exact: true }).focus();
  await page.keyboard.press("Tab");
  assert.ok(await focused(checkbox(page, "Charter")), "Tab from Go lands on Charter");
  assert.equal(await focused(checkbox(page, "Rules")), false, "and only there");
  await page.keyboard.press("Tab");
  assert.ok(await focused(checkbox(page, "Administrative Code")), "then Administrative Code");
  await page.keyboard.press("Space");
  await page.waitForURL(/book=Charter&book=Rules/);
  await page.getByRole("status").filter({ hasText: "No results for “turnstile”." }).waitFor();
  // Back: the address, the results and the boxes all go back a step; Forward, the same.
  await page.goBack();
  await page.getByRole("status").filter({ hasText: /^1 result for/ }).waitFor();
  assert.equal(await checkbox(page, "Administrative Code").isChecked(), true, "after Back");
  assert.equal(await checkbox(page, "Local laws").isChecked(), false, "after Back");
  await page.goBack();
  await page.getByRole("status").filter({ hasText: /^2 results for/ }).waitFor();
  for (const n of [...BOOKS, ...KINDS]) assert.equal(await checkbox(page, n).isChecked(), true, `${n} after two Backs`);
  await page.goForward();
  await page.getByRole("status").filter({ hasText: /^1 result for/ }).waitFor();
  assert.equal(await checkbox(page, "Local laws").isChecked(), false, "after Forward");
  assert.equal(await checkbox(page, "Administrative Code").isChecked(), true, "after Forward");
  // The next toggle starts from the restored boxes, not the ones left from before Back.
  await checkbox(page, "Chapters").focus();
  await page.keyboard.press("Space");
  await page.waitForURL(/\?q=turnstile&kind=Section$/);
  assert.deepEqual(problems, []);
  await ctx.close();
});

test("the last box in a group stays checked, and the status line says why", async () => {
  const { page, ctx, problems } = await open("/search?q=turnstile");
  await settled(page);
  for (const n of ["Sections", "Chapters"]) {
    await checkbox(page, n).focus();
    await page.keyboard.press("Space");
    await page.waitForURL(n === "Sections" ? /kind=Chapter&kind=Local\+law$/ : /kind=Local\+law$/);
  }
  await page.getByRole("status").filter({ hasText: /^1 result for/ }).waitFor();
  const url = page.url();
  await checkbox(page, "Local laws").focus();
  await page.keyboard.press("Space");
  await page.getByRole("status").filter({ hasText: "At least one box under “Kind of page” stays checked." }).waitFor();
  assert.equal(await checkbox(page, "Local laws").isChecked(), true);
  assert.equal(page.url(), url, "the address is unchanged");
  assert.deepEqual(await hitPaths(page), [note().path], "and so are the results");
  // The results line stays, with the reason after it.
  assert.match(await page.locator("#search-status").innerText(), /^1 result for “turnstile”\. Showing 1 to 1\. At least one box under “Kind of page” stays checked\.$/);
  assert.deepEqual(problems, []);
  await ctx.close();
});

test("the last box stays checked with the mouse too, on screen and in the accessibility tree", async () => {
  const { page, ctx, problems } = await open("/search?q=turnstile&kind=Section");
  await settled(page);
  const url = page.url();
  const sections = checkbox(page, "Sections");
  const treeChecked = async () => /checkbox "Sections" \[checked\]/.test(await page.locator("#filters").ariaSnapshot());
  for (const attempt of [1, 2]) {
    await sections.click();
    // The status is cleared, then set again after the box is redrawn (so a repeat is announced).
    await page.waitForFunction(() => document.getElementById("search-status").textContent.endsWith("At least one box under “Kind of page” stays checked."));
    await page.waitForTimeout(150);
    assert.equal(await sections.isChecked(), true, `click ${attempt}: the box`);
    assert.ok(await treeChecked(), `click ${attempt}: the accessibility tree`);
    assert.equal(await sections.evaluate((el) => el.checked), true, `click ${attempt}: the inner input`);
    assert.equal(page.url(), url, `click ${attempt}: the address`);
  }
  // The next click starts from what the reader sees: Sections still on, Chapters added.
  await checkbox(page, "Chapters").click();
  await page.waitForURL(/\?q=turnstile&kind=Section&kind=Chapter$/);
  assert.equal(await sections.isChecked(), true);
  assert.ok(await treeChecked());
  assert.deepEqual(problems, []);
  await ctx.close();
});

test("a filtered address opens with its boxes set: only the Rules, only local laws", async () => {
  {
    const { page, ctx, problems } = await open("/search?q=turnstile&book=Rules");
    await settled(page);
    assert.equal(await checkbox(page, "Rules").isChecked(), true);
    assert.equal(await checkbox(page, "Charter").isChecked(), false);
    assert.equal(await checkbox(page, "Administrative Code").isChecked(), false);
    await page.getByRole("status").filter({ hasText: "No results for “turnstile”." }).waitFor();
    assert.deepEqual(problems, []);
    await ctx.close();
  }
  {
    const { page, ctx, problems } = await open(`/search?q=turnstile&kind=${encodeURIComponent("Local law")}`);
    await settled(page);
    assert.deepEqual(await hitPaths(page), [note().path]);
    assert.deepEqual(problems, []);
    await ctx.close();
  }
});

test("reflow: the search page with its filters never scrolls sideways at 390px or 320px", async () => {
  for (const width of [390, 320]) {
    const { page, ctx } = await open("/search?q=turnstile", { width });
    await settled(page);
    const [sw, cw] = await page.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.clientWidth]);
    assert.ok(sw <= cw, `${width}px: ${sw - cw}px too wide`);
    assert.ok(await checkbox(page, "Administrative Code").isVisible());
    await ctx.close();
  }
});

test("the jump box is unchanged: a citation still goes straight to its page, filters or not", async () => {
  {
    // The citation Copy citation gives. (A bare "L.L. 2016/002" is searched as words, as before #65.)
    const { page, ctx, problems } = await open(`/search?q=${encodeURIComponent(note().fullCitation)}&kind=Section`);
    await page.waitForURL(`${base}${note().path}`);
    assert.deepEqual(problems, []);
    await ctx.close();
  }
  {
    const { page, ctx } = await open("/search?q=turnstile");
    await settled(page);
    const box = page.getByRole("searchbox", { name: "Go to a section, or search the words", exact: true });
    await box.fill("Admin. Code § 10-172");
    await Promise.all([page.waitForURL(`${base}${section().path}`), box.press("Enter")]);
    await ctx.close();
  }
});

test("without JavaScript the search page shows no filters, and links to the contents", async () => {
  const { page, ctx } = await open("/search?q=turnstile", { js: false });
  assert.equal(await page.getByRole("checkbox").count(), 0);
  assert.equal(await page.locator("#filters").isVisible(), false);
  await page.getByRole("link", { name: /Browse the .*contents/ }).first().waitFor({ state: "visible" });
  await ctx.close();
});

test("nothing loads from outside the site", () => {
  assert.deepEqual(outside, []);
});
