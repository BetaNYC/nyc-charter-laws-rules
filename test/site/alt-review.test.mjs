// The picture description page in a real browser (issue #87): every control has a name,
// nothing focusable is unnamed, the keyboard can do everything, focus moves to the picture's
// heading on Next, Save (Control+Enter) writes the sidecar, and the static (GitHub Pages)
// build turns Save into a prefilled GitHub issue link. Runs with npm run test:site.

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { chromium } from "playwright";
import { openSource } from "../../scripts/lib/alt-text/source.js";
import { buildInventory, loadIndex } from "../../scripts/lib/alt-text/inventory.js";
import { saveDraft, saveReview, readStore, storePath } from "../../scripts/lib/alt-text/store.js";
import { startReviewServer } from "../../scripts/lib/alt-text/server.js";
import { buildStatic } from "../../scripts/lib/alt-text/static-build.js";
import { startServer } from "../../scripts/lib/site/serve.js";
import { parseSnapshot, controlProblems, focusableProblems, CHROMIUM_ARGS } from "./a11y-tree.mjs";
import { makeFixture } from "../alt-text/fixture.js";

let fx, inv, source, review, browser, staticSrv;
const extra = [];

// Text from the law with HTML in it must show as text. The fixture's paragraph and heading
// carry markup that would run (window.__xss) or render (an <img>, a <b>) if inserted as HTML.
const MARKUP = '<img src=x onerror="window.__xss=1"> & <b>bold</b>';
const escXml = (t) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
function makeMarkupFixture() {
  const f = makeFixture();
  const xmlPath = join(f.source, "XML", "0-0-0-1.xml");
  writeFileSync(xmlPath, readFileSync(xmlPath, "utf8").replace("means the item is salty.", `means the item is salty ${escXml(MARKUP)}.`));
  const indexPath = join(f.indexDir, "rules.json");
  writeFileSync(indexPath, readFileSync(indexPath, "utf8").replace("§ 1-01 Signs.", "§ 1-01 Signs <i>and</i> symbols."));
  return f;
}

/** A server on its own copy of the fixture, for tests that change what is on disk. */
async function freshServer() {
  const f = makeMarkupFixture();
  const src = openSource(f.source);
  const i = buildInventory("rules", src, loadIndex("rules", f.indexDir));
  await saveDraft(f.storeDir, "rules", i.images[0], { draft: { alt: "draft icon", long: "", unsure: "" }, model: "claude-fable-5-2" });
  const srv = await startReviewServer({ inventories: [i], sources: { rules: src }, storeDir: f.storeDir, port: 0 });
  extra.push(srv);
  return { f, i, src, srv, entry: (n = 0) => readStore(f.storeDir, "rules").images[i.images[n].sha256] };
}

before(async () => {
  fx = makeMarkupFixture();
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
  for (const s of extra) await s.close?.();
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
  await page.getByLabel("Reviewed: ready to show").check();
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

test("local page: an unread AI draft is never marked reviewed by one click (no status is chosen for it)", async () => {
  const { srv, entry } = await freshServer();
  const { page } = await open(`${srv.url}/`);
  const checked = () => page.evaluate(() => document.querySelector('input[name="status"]:checked')?.value ?? null);
  assert.equal(await checked(), null, "a drafted picture starts with no status chosen");
  await page.locator("#save-next").click();
  await page.waitForFunction(() => /status/i.test(document.getElementById("save-status").textContent));
  assert.match(await page.locator("#save-status").textContent(), /Choose a status/);
  assert.match(await page.locator("#position").textContent(), /Picture 1 of 3/, "it does not move on");
  assert.equal(entry().status, "drafted");
  assert.equal(entry().review, null, "nothing was saved");
  // A picture with no entry at all starts with none chosen too.
  await page.locator("#next").click();
  assert.equal(await checked(), null);
  await page.locator("#prev").click();
  // Choosing one on purpose saves it.
  await page.getByLabel("Leave it marked as not reviewed").check();
  await page.locator("#save").click();
  await page.waitForFunction(() => /^Saved/.test(document.getElementById("save-status").textContent));
  assert.equal(entry().status, "drafted");
  assert.equal(entry().review.alt, "draft icon");
});

test("local page: a filter change keeps unsaved text, or warns before dropping it; closing the tab asks", async () => {
  const { srv } = await freshServer();
  const { page } = await open(`${srv.url}/`);
  const box = page.getByLabel("Alt text", { exact: true });
  await box.fill("MY UNSAVED EDIT");
  // The picture is still in the list: the text stays.
  await page.getByLabel("Status").selectOption("drafted");
  assert.equal(await box.inputValue(), "MY UNSAVED EDIT");
  assert.match(await page.locator("#position").textContent(), /Picture 1 of 1/);
  // The picture would leave the list: warn once and keep everything as it was.
  await page.getByLabel("Book").selectOption("admin_code");
  assert.equal(await box.inputValue(), "MY UNSAVED EDIT");
  assert.match(await page.locator("#save-status").textContent(), /unsaved changes/);
  assert.equal(await page.getByLabel("Book").inputValue(), "", "the filter is put back");
  // Closing the tab with unsaved text asks first (Chromium asks only after a real click).
  await box.click();
  const dialog = new Promise((resolve) =>
    page.once("dialog", async (d) => {
      resolve(d.type());
      await d.dismiss();
    }),
  );
  await page.close({ runBeforeUnload: true });
  assert.equal(await Promise.race([dialog, new Promise((r) => setTimeout(() => r("no dialog"), 2000))]), "beforeunload");
});

test("local page: after a conflict, Save again is refused; the person must pick a version", async () => {
  const { srv, entry } = await freshServer();
  const one = (await open(`${srv.url}/`)).page;
  const two = (await open(`${srv.url}/`)).page;
  const saveAs = async (page, text) => {
    await page.getByLabel("Alt text", { exact: true }).fill(text);
    await page.getByLabel("Reviewed: ready to show").check();
    await page.locator("#save").click();
    await page.waitForFunction(() => /^(Saved|Not saved)/.test(document.getElementById("save-status").textContent));
  };
  await saveAs(one, "TAB ONE");
  assert.equal(entry().review.alt, "TAB ONE");
  await saveAs(two, "TAB TWO");
  assert.match(await two.locator("#save-status").textContent(), /Not saved/);
  assert.ok(await two.locator("#conflict").isVisible(), "the newer version is shown");
  assert.equal(await two.getByLabel("Their alt text (read only)").inputValue(), "TAB ONE");
  assert.equal(await two.getByLabel("Alt text", { exact: true }).inputValue(), "TAB TWO", "their own text is kept");
  const c = controlProblems(parseSnapshot(await two.locator("body").ariaSnapshot()));
  assert.deepEqual(c.unnamed, []);
  assert.deepEqual(c.duplicates, []);
  assert.deepEqual(await focusableProblems(two), []);
  assert.equal(await two.evaluate(() => document.activeElement.id), "conflict-heading", "focus moves to the conflict");
  // Save again: still refused, nothing overwritten.
  await two.evaluate(() => (document.getElementById("save-status").textContent = ""));
  await two.locator("#save").click();
  await two.waitForFunction(() => /Not saved/.test(document.getElementById("save-status").textContent));
  assert.equal(entry().review.alt, "TAB ONE");
  // Only an explicit choice replaces it.
  await two.getByRole("button", { name: "Replace theirs with mine" }).click();
  await two.waitForFunction(() => /^Saved/.test(document.getElementById("save-status").textContent));
  assert.equal(entry().review.alt, "TAB TWO");
  assert.equal(await two.locator("#conflict").isVisible(), false);
  // The other way: "Use their version" shows the newer text and saves nothing.
  await saveAs(one, "TAB ONE AGAIN");
  assert.ok(await one.locator("#conflict").isVisible());
  await one.getByRole("button", { name: "Use their version" }).click();
  assert.equal(await one.getByLabel("Alt text", { exact: true }).inputValue(), "TAB TWO");
  assert.equal(entry().review.alt, "TAB TWO");
});

test("local page: an address ending in a bad fragment (#%) still loads", async () => {
  const { page, problems } = await open(`${review.url}/#%`);
  assert.match(await page.locator("#position").textContent(), /Picture 1 of 3/);
  assert.deepEqual(problems, []);
});

test("text from the law with HTML in it shows as text, never as HTML", async () => {
  const { page, problems } = await open(`${review.url}/`);
  assert.deepEqual(problems, []);
  assert.equal(await page.evaluate(() => window.__xss), undefined, "no script ran");
  assert.equal(await page.locator("#uses img, #uses b, #item-heading i, #uses i").count(), 0, "no element was made from the text");
  assert.ok((await page.locator("#uses").textContent()).includes(MARKUP), "the markup shows as written");
  assert.match(await page.locator("#uses").textContent(), /Signs <i>and<\/i> symbols/);
  assert.match(await page.locator("#item-heading").textContent(), /<i>and<\/i>/);
});

test("static page without drafts says AI drafts are not shown, not 'No AI draft yet'", async () => {
  const f = makeFixture();
  const src = openSource(f.source);
  const i = buildInventory("rules", src, loadIndex("rules", f.indexDir));
  const d = await saveDraft(f.storeDir, "rules", i.images[0], { draft: { alt: "draft icon", long: "", unsure: "" }, model: "claude-fable-5-2" });
  await saveReview(f.storeDir, "rules", i.images[0], { review: { alt: "the sodium warning icon", long: "" }, status: "reviewed", base: d.updated_at });
  const out = join(mkdtempSync(join(tmpdir(), "alt-static-")), "site");
  buildStatic({ inventories: [i], sources: { rules: src }, storeDir: f.storeDir, outDir: out, includeDrafts: false });
  const srv = await startServer(out, 0);
  try {
    const { page, problems } = await open(`${srv.url}/`);
    assert.deepEqual(problems, []);
    assert.equal(await page.getByLabel("Alt text", { exact: true }).inputValue(), "the sodium warning icon");
    const meta = await page.locator("#draft-meta").textContent();
    assert.doesNotMatch(meta, /No AI draft yet/);
    assert.match(meta, /AI drafts are not shown on this page/);
  } finally {
    srv.server.close();
  }
});
