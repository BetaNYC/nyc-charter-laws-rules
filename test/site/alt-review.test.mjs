// The picture description page in a real browser (issue #87): every control has a name,
// nothing focusable is unnamed, the keyboard can do everything, focus moves to the picture's
// heading on Next, Save (Control+Enter) writes the sidecar, and the static (GitHub Pages)
// build turns Save into a prefilled GitHub issue link. Runs with npm run test:site.

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { chromium } from "playwright";
import { openSource } from "../../scripts/lib/alt-text/source.js";
import { buildInventory, loadIndex } from "../../scripts/lib/alt-text/inventory.js";
import { saveDraft, storePath } from "../../scripts/lib/alt-text/store.js";
import { startReviewServer } from "../../scripts/lib/alt-text/server.js";
import { buildStatic } from "../../scripts/lib/alt-text/static-build.js";
import { startServer } from "../../scripts/lib/site/serve.js";
import { parseSnapshot, controlProblems, focusableProblems, CHROMIUM_ARGS } from "./a11y-tree.mjs";
import { makeFixture } from "../alt-text/fixture.js";

let fx, inv, source, review, browser, staticSrv;

before(async () => {
  fx = makeFixture();
  source = openSource(fx.source);
  inv = buildInventory("rules", source, loadIndex("rules", fx.indexDir));
  await saveDraft(fx.storeDir, "rules", inv.images[0], { draft: { alt: "draft icon", long: "", unsure: "the exact color" }, model: "claude-fable-5-2" });
  review = await startReviewServer({ inventories: [inv], sources: { rules: source }, storeDir: fx.storeDir, port: 0 });
  const out = join(mkdtempSync(join(tmpdir(), "alt-static-")), "site");
  buildStatic({ inventories: [inv], sources: { rules: source }, storeDir: fx.storeDir, outDir: out, includeDrafts: true });
  staticSrv = await startServer(out, 0);
  browser = await chromium.launch({ args: CHROMIUM_ARGS });
});

after(async () => {
  await browser?.close();
  await review?.close();
  staticSrv?.server?.close();
});

async function open(url) {
  const page = await (await browser.newContext({ viewport: { width: 1100, height: 900 } })).newPage();
  const problems = [];
  page.on("console", (m) => m.type() === "error" && problems.push(m.text()));
  page.on("pageerror", (e) => problems.push(e.message));
  await page.goto(url);
  await page.waitForFunction(() => !document.getElementById("item").hidden);
  return { page, problems };
}

test("local page: every control is named, nothing focusable is unnamed, no errors", async () => {
  const { page, problems } = await open(`${review.url}/`);
  const c = controlProblems(parseSnapshot(await page.locator("body").ariaSnapshot()));
  assert.ok(c.controls.length >= 12, `the page shows its controls (${c.controls.length})`);
  assert.deepEqual(c.unnamed, []);
  assert.deepEqual(c.duplicates, []);
  assert.deepEqual(await focusableProblems(page), []);
  assert.deepEqual(problems, []);
  // The draft is read only; the review starts as a copy of it.
  assert.equal(await page.getByLabel("AI draft: alt text (read only)").inputValue(), "draft icon");
  assert.equal(await page.getByLabel("AI draft: alt text (read only)").getAttribute("readonly"), "");
  assert.equal(await page.getByLabel("Alt text", { exact: true }).inputValue(), "draft icon");
  assert.match(await page.locator("#draft-unsure").textContent(), /the exact color/);
  assert.match(await page.locator("#progress").textContent(), /0 of 3 pictures reviewed; 1 have an AI draft/);
  // The text around each use opens and closes, and says which state it is in.
  const toggle = page.getByRole("button", { name: "Show the text around use 2" });
  assert.equal(await toggle.getAttribute("aria-expanded"), "false");
  await toggle.click();
  assert.equal(await page.getByRole("button", { name: "Hide the text around use 2" }).getAttribute("aria-expanded"), "true");
  assert.ok(await page.locator("#use-context-2").isVisible());
});

test("local page: the keyboard reaches the controls in order, and focus is visible", async () => {
  const { page } = await open(`${review.url}/`);
  const order = [];
  for (let i = 0; i < 40; i++) {
    await page.keyboard.press("Tab");
    const id = await page.evaluate(() => document.activeElement?.id || document.activeElement?.getAttribute("name") || document.activeElement?.tagName);
    order.push(id);
  }
  const pos = (id) => order.indexOf(id);
  for (const id of ["filter-book", "filter-status", "next", "draft-alt", "review-alt", "review-long", "review-note", "status", "save"]) assert.ok(pos(id) >= 0, `${id} is reachable: ${order.join(",")}`);
  assert.ok(pos("filter-book") < pos("next") && pos("next") < pos("review-alt") && pos("review-alt") < pos("save"), order.join(","));
  await page.locator("#review-alt").focus();
  const outline = await page.evaluate(() => getComputedStyle(document.activeElement).outlineStyle);
  assert.equal(outline, "solid");
});

test("local page: Next moves focus to the picture's heading, and Control+Enter saves to disk", async () => {
  const { page } = await open(`${review.url}/`);
  await page.locator("#next").click();
  assert.equal(await page.evaluate(() => document.activeElement.id), "item-heading");
  assert.match(await page.locator("#position").textContent(), /Picture 2 of 3/);
  await page.locator("#prev").click();
  const box = page.getByLabel("Alt text", { exact: true });
  await box.fill("the sodium warning icon");
  await box.press("Control+Enter");
  await page.waitForFunction(() => /Saved/.test(document.getElementById("save-status").textContent));
  const stored = JSON.parse(readFileSync(storePath(fx.storeDir, "rules"), "utf8")).images[inv.images[0].sha256];
  assert.equal(stored.review.alt, "the sodium warning icon");
  assert.equal(stored.status, "reviewed");
  assert.match(await page.locator("#progress").textContent(), /1 of 3 pictures reviewed/);
});

test("local page: leaving with unsaved changes warns once, in the status line", async () => {
  const { page } = await open(`${review.url}/`);
  await page.getByLabel("Alt text", { exact: true }).fill("changed");
  await page.locator("#next").click();
  assert.match(await page.locator("#save-status").textContent(), /unsaved changes/);
  assert.match(await page.locator("#position").textContent(), /Picture 1 of 3/);
  await page.locator("#next").click();
  assert.match(await page.locator("#position").textContent(), /Picture 2 of 3/);
});

test("local page: the status filter narrows the list", async () => {
  const { page } = await open(`${review.url}/`);
  await page.getByLabel("Status").selectOption("none");
  assert.match(await page.locator("#position").textContent(), /of 2/);
});

test("static page: Save becomes a prefilled GitHub issue link, and controls stay named", async () => {
  const { page, problems } = await open(`${staticSrv.url}/`);
  assert.deepEqual(problems, []);
  assert.equal(await page.locator("#save").isVisible(), false);
  const link = page.getByRole("link", { name: /Suggest a better description/ });
  assert.ok(await link.isVisible());
  await page.getByLabel("Alt text", { exact: true }).fill("a much better description");
  const href = await link.getAttribute("href");
  assert.ok(href.startsWith("https://github.com/BetaNYC/nyc-charter-laws-rules/issues/new?"));
  assert.match(new URL(href).searchParams.get("body"), /a much better description/);
  const c = controlProblems(parseSnapshot(await page.locator("body").ariaSnapshot()));
  assert.ok(c.controls.length >= 8, `the page shows its controls (${c.controls.length})`);
  assert.deepEqual(c.unnamed, []);
  assert.deepEqual(c.duplicates, []);
  assert.deepEqual(await focusableProblems(page), []);
});
