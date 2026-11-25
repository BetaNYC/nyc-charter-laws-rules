// Browser tests for "Errors in the publisher's text" (/source-errors/) and the note on a section
// page. Run with: npm run test:site. Built from the Charter fixtures with a made-up errors file,
// as a preview (--include-unconfirmed-errors), so the page has a found, a confirmed and a
// reported entry; served on 127.0.0.1 and opened in headless Chromium. Offline.

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { writeFileSync, mkdtempSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { chromium } from "playwright";
import { writeFixtureData, FIXED_NOW } from "./fixture-site.mjs";
import { buildSite } from "../../scripts/lib/site/build.js";
import { loadBook } from "../../scripts/lib/site/model.js";
import { startServer } from "../../scripts/lib/site/serve.js";
import { parseSnapshot, controlProblems, linkProblems, focusableProblems, CHROMIUM_ARGS } from "./a11y-tree.mjs";

const PATH = "/source-errors/";
let site, server, base, browser, sections;
const outside = [];

function entry(over) {
  return {
    book: "charter",
    kind: "picture-text-mismatch",
    summary: "The picture says 12; the text says 18.",
    evidence: { text: "The sump shall be 18 inches.", records: ["0-0-0-2"], picture: "A drawing marked 12.", images: [{ image_id: "0-0-0-3", file: "IMAGES/0-0-0-3.png", sha256: "b".repeat(64) }] },
    found: "2026-11-25",
    found_in: "American Legal Publishing's files of July 2026",
    status: "found",
    confirmed_at: null,
    reported_at: null,
    fixed_at: null,
    notes: "",
    ...over,
  };
}

before(async () => {
  const d = writeFixtureData();
  const book = loadBook({ corpus: "charter", indexJsonText: d.data.json, versions: d.data.versions, structure: JSON.parse(readFileSync(join(d.structureDir, "charter.json"), "utf8")) });
  sections = book.sections.filter((s) => s.path).slice(0, 3);
  const dir = mkdtempSync(join(tmpdir(), "source-errors-browser-"));
  const file = join(dir, "source-errors.json");
  const at = (s) => ({ citation: s.fullCitation, amlegal_id: s.id });
  writeFileSync(
    file,
    JSON.stringify({
      about: "test",
      format: 1,
      errors: [
        entry({ id: "SE-0001", ...at(sections[0]), status: "confirmed", confirmed_at: "2026-11-26" }),
        entry({ id: "SE-0002", ...at(sections[1]), kind: "same-picture-twice" }),
        entry({ id: "SE-0003", ...at(sections[2]), kind: "garbled-text", status: "reported", confirmed_at: "2026-11-26", reported_at: "2026-11-27", evidence: { text: "3/8 in. thick 5/8 in. between grooves)", records: ["0-0-0-9"], picture: null, images: [] } }),
      ],
    })
  );
  site = await buildSite({ indexDir: d.indexDir, structureDir: d.structureDir, outDir: join(dir, "site"), search: false, now: FIXED_NOW, commit: "test", books: ["charter"], sourceErrorsFile: file, includeUnconfirmedErrors: true });
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
  if (js) await page.waitForFunction(() => customElements.get("nys-button") !== undefined);
  return { page, ctx, problems };
}

const visibleRows = (page) => page.locator("ol.se-list > li:visible").evaluateAll((els) => els.map((e) => e.id));

test("agents and screen readers: every control and link on the page has its own name, at desktop and phone width", async () => {
  for (const width of [1200, 390]) {
    const { page, ctx, problems } = await open(PATH, { width });
    await page.locator("#se-filters").waitFor({ state: "visible" });
    assert.deepEqual(await focusableProblems(page), [], `${width}px: focusable elements with no role or no name`);
    const nodes = parseSnapshot(await page.locator("body").ariaSnapshot());
    const c = controlProblems(nodes);
    assert.deepEqual(c.unnamed, [], `${width}px: unnamed controls`);
    assert.deepEqual(c.duplicates, [], `${width}px: controls that share a name`);
    const l = linkProblems(nodes);
    assert.deepEqual(l.unnamed, [], `${width}px: unnamed links`);
    assert.deepEqual(l.conflicting, [], `${width}px: one link name for different places`);
    // The three filters are comboboxes named by their visible labels.
    for (const name of ["Book", "Kind of error", "Status"]) assert.equal(await page.getByRole("combobox", { name, exact: true }).count(), 1, name);
    // Each "Check at American Legal" link starts with its visible words and names its row.
    for (const id of ["SE-0001", "SE-0002", "SE-0003"]) {
      const s = sections[Number(id.slice(-1)) - 1];
      const link = page.getByRole("link", { name: `Check at American Legal: ${s.fullCitation} (${id})`, exact: true });
      assert.equal(await link.getAttribute("href"), `https://codelibrary.amlegal.com/codes/newyorkcity/latest/NYCcharter/${s.id}`);
      assert.equal(await link.getAttribute("target"), null, "opens normally");
    }
    assert.deepEqual(problems, [], `${width}px`);
    await ctx.close();
  }
});

test("filters: reached with Tab, they hide the rows they leave out, say how many in a live region, and keep the choice in the address", async () => {
  const { page, ctx } = await open(PATH);
  assert.deepEqual(await visibleRows(page), ["SE-0001", "SE-0002", "SE-0003"]);
  // Tab reaches each select in order.
  const book = page.getByRole("combobox", { name: "Book", exact: true });
  await book.focus();
  await page.keyboard.press("Tab");
  assert.equal(await page.evaluate(() => document.activeElement.id), "se-kind");
  await page.keyboard.press("Tab");
  assert.equal(await page.evaluate(() => document.activeElement.id), "se-status");
  const status = page.getByRole("status").filter({ hasText: /error/ });
  assert.equal((await status.innerText()).trim(), "3 errors, 1 not yet checked.");
  await page.getByRole("combobox", { name: "Status", exact: true }).selectOption("found");
  assert.deepEqual(await visibleRows(page), ["SE-0002"]);
  assert.equal((await status.innerText()).trim(), "Showing 1 of 3 errors.");
  assert.match(page.url(), /\?status=found$/);
  await page.getByRole("combobox", { name: "Kind of error", exact: true }).selectOption("garbled-text");
  assert.deepEqual(await visibleRows(page), []);
  assert.equal((await status.innerText()).trim(), "No errors match these filters. 3 errors in all.");
  await page.getByRole("combobox", { name: "Status", exact: true }).selectOption("");
  assert.deepEqual(await visibleRows(page), ["SE-0003"]);
  // A linked address opens with its filters chosen.
  await page.goto(`${base}${PATH}?kind=same-picture-twice`, { waitUntil: "networkidle" });
  assert.equal(await page.getByRole("combobox", { name: "Kind of error", exact: true }).inputValue(), "same-picture-twice");
  assert.deepEqual(await visibleRows(page), ["SE-0002"]);
  await page.getByRole("combobox", { name: "Kind of error", exact: true }).selectOption("");
  assert.equal((await status.innerText()).trim(), "3 errors, 1 not yet checked.");
  assert.doesNotMatch(page.url(), /\?/);
  await ctx.close();
});

test("with JavaScript off: the whole list, every link, no filters", async () => {
  const { page, ctx } = await open(PATH, { js: false });
  assert.deepEqual(await visibleRows(page), ["SE-0001", "SE-0002", "SE-0003"]);
  assert.equal(await page.locator("#se-filters").isVisible(), false);
  assert.equal(await page.getByRole("link", { name: /^Check at American Legal: / }).count(), 3);
  await page.getByText("Found, not yet checked").first().waitFor({ state: "visible" });
  await page.getByText("Preview build.").waitFor({ state: "visible" });
  await page.getByText("The sump shall be 18 inches.").first().waitFor({ state: "visible" });
  await ctx.close();
});

test("a section page's note links to its row, and the row is there", async () => {
  const { page, ctx, problems } = await open(sections[1].path);
  const note = page.locator(".source-error-note");
  assert.match(await note.innerText(), /BetaNYC found a possible error, not yet checked, in the publisher's text of this section\./);
  await note.getByRole("link", { name: "error SE-0002", exact: true }).click();
  await page.waitForURL(/\/source-errors\/#SE-0002$/);
  assert.ok(await page.locator("#SE-0002").isVisible());
  assert.deepEqual(problems, []);
  await ctx.close();
});

test("reflow: the page does not scroll sideways at 320px (WCAG 1.4.10)", async () => {
  for (const js of [true, false]) {
    const { page, ctx } = await open(PATH, { width: 320, js });
    const [sw, cw] = await page.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.clientWidth]);
    assert.ok(sw <= cw, `${js ? "" : "no JavaScript: "}${sw - cw}px wider than the screen`);
    await ctx.close();
  }
});

test("nothing loads from outside the site", () => {
  assert.deepEqual([...new Set(outside)], []);
});
