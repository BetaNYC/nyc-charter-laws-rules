// The picture description page as build-site makes it (/describe-pictures/, issue #87), in a real
// browser: the three-book fixture site, with the alt-text fixture's pictures committed the way
// npm run alt:images commits them. The page is in the site's own frame (Noel, 2026-11-26): top
// bar, breadcrumbs, footer. The footer link opens it; every picture loads from the site itself;
// a picture with no description says so and offers the form, with no AI draft shown; the page's
// content security policy blocks nothing it needs; the keyboard alone sends a suggestion. The
// intake is a fake one on 127.0.0.1, and every other request off 127.0.0.1 is aborted and
// counted, so nothing is sent to www.beta.nyc. Runs with npm run test:site.

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright";
import { makeFixture, INDEX } from "../alt-text/fixture.js";
import { openSource } from "../../scripts/lib/alt-text/source.js";
import { buildInventory, loadIndex } from "../../scripts/lib/alt-text/inventory.js";
import { writePictures } from "../../scripts/lib/alt-text/pictures.js";
import { saveDraft } from "../../scripts/lib/alt-text/store.js";
import { startServer } from "../../scripts/lib/site/serve.js";
import { buildThreeBookFixtureSite } from "./fixture-site.mjs";
import { parseSnapshot, controlProblems, linkProblems, focusableProblems, CHROMIUM_ARGS } from "./a11y-tree.mjs";
import { closeBrowser, closeServer, HOOK_TIMEOUT } from "./cleanup.mjs";

let fx, site, server, browser, intake;
let siteOrigin = "";
const seen = [];

/** A fake intake that answers the site's origin as the real one does (CORS, 201). */
function fakeIntake() {
  const srv = createServer((req, res) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      const cors = req.headers.origin === siteOrigin ? { "Access-Control-Allow-Origin": siteOrigin, "Access-Control-Allow-Methods": "POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type", Vary: "Origin" } : { Vary: "Origin" };
      if (req.method === "OPTIONS") {
        res.writeHead(204, cors);
        return res.end();
      }
      seen.push({ url: req.url, origin: req.headers.origin, body: Buffer.concat(chunks).toString("utf8") });
      res.writeHead(201, { ...cors, "Content-Type": "application/json" });
      res.end('{"ok":true}');
    });
  });
  return new Promise((resolve) => srv.listen(0, "127.0.0.1", () => resolve({ srv, url: `http://127.0.0.1:${srv.address().port}` })));
}

before(async () => {
  fx = makeFixture();
  writeFileSync(join(fx.indexDir, "admin_code.json"), JSON.stringify(INDEX.map((r) => ({ ...r, corpus: "admin_code" }))));
  const sources = { admin_code: openSource(fx.source), rules: openSource(fx.source) };
  const inventories = ["admin_code", "rules"].map((b) => buildInventory(b, sources[b], loadIndex(b, fx.indexDir)));
  writePictures({ inventories, sources, outDir: join(fx.root, "pictures") });
  // An AI draft in the store must not reach the page.
  await saveDraft(fx.storeDir, "admin_code", inventories[0].images[0], { draft: { alt: "AN AI DRAFT", long: "", unsure: "" }, model: "claude-fable-5-2" });
  intake = await fakeIntake();
  site = await buildThreeBookFixtureSite({ options: { picturesDir: join(fx.root, "pictures"), altTextDir: fx.storeDir, pictureEndpoint: `${intake.url}/wp-json/betanyc-data/v1/report` } });
  server = await startServer(site.outDir, 0);
  siteOrigin = new URL(server.url).origin;
  browser = await chromium.launch({ args: CHROMIUM_ARGS });
});

after(async () => {
  await closeBrowser(browser);
  closeServer(server?.server);
  closeServer(intake?.srv);
  rmSync(fx.root, { recursive: true, force: true });
  rmSync(join(site.outDir, ".."), { recursive: true, force: true });
}, { timeout: HOOK_TIMEOUT });

async function open(width = 1100, height = 900) {
  const ctx = await browser.newContext({ viewport: { width, height }, reducedMotion: "reduce" });
  const offsite = [];
  await ctx.route("**/*", (route) => {
    const u = new URL(route.request().url());
    if (u.hostname === "127.0.0.1") return route.continue();
    offsite.push(u.href);
    return route.abort();
  });
  const page = await ctx.newPage();
  const problems = [];
  page.on("console", (m) => m.type() === "error" && problems.push(m.text()));
  page.on("pageerror", (e) => problems.push(e.message));
  return { ctx, page, problems, offsite };
}

for (const [name, width, height] of [["phone", 390, 844], ["desktop", 1100, 900]]) {
  test(`/describe-pictures/ (${name}): the site's frame, reached from the footer, every picture loads, no description yet, the form is there`, async () => {
    const { ctx, page, problems, offsite } = await open(width, height);
    await page.goto(`${server.url}/about`);
    await page.locator("footer").getByRole("link", { name: "Picture descriptions" }).click();
    await page.waitForURL(/\/describe-pictures\/(#.*)?$/);
    await page.waitForFunction(() => !document.getElementById("item").hidden);
    assert.equal(await page.title(), "Picture descriptions | BetaNYC Law Reader");
    // The frame every page has: the top bar with the BetaNYC wordmark and "Law Reader", the
    // breadcrumbs, the footer. The page is not in the top bar.
    assert.ok(await page.locator("header.site-bar img[alt='BetaNYC']").isVisible());
    assert.match(await page.locator("header.site-bar").textContent(), /Law Reader/);
    assert.equal(await page.locator("header.site-bar a[href='/describe-pictures/']").count(), 0);
    assert.deepEqual(await page.locator("nys-breadcrumbs li").allTextContents(), ["Home", "Picture descriptions"]);
    assert.equal(await page.locator("main h1").textContent(), "Picture descriptions");
    assert.ok(await page.locator("footer").isVisible());
    assert.match(await page.locator("main .lede").textContent(), /None of the 6 has a text description yet\./);
    assert.equal(await page.locator("#progress").textContent(), "0 of 6 pictures reviewed.");
    assert.deepEqual(await page.locator("#filter-status option").allTextContents(), ["Any status", "No description yet", "Reviewed"]);
    const seenSrc = new Set();
    for (let i = 0; i < 6; i++) {
      const [ok, src] = await page.locator("#picture").evaluate(async (img) => {
        if (!img.complete) await new Promise((r) => img.addEventListener("load", r, { once: true }));
        return [img.naturalWidth > 0, img.getAttribute("src")];
      });
      assert.ok(ok, `${src} loads`);
      seenSrc.add(src);
      assert.equal(await page.locator("#current-label").textContent(), "No reviewed description yet");
      assert.equal(await page.getByLabel("Current alt text (read only)").inputValue(), "");
      assert.equal(await page.getByLabel("Alt text", { exact: true }).inputValue(), "", "the suggestion box starts empty");
      assert.ok(await page.getByRole("button", { name: "Send suggestion" }).isVisible());
      assert.equal(await page.locator("#draft-alt").isVisible(), false, "no AI draft box");
      assert.match(await page.locator("#picture-facts").textContent(), /status: No description yet$/);
      if (i < 5) await page.locator("#next").click();
    }
    assert.equal(seenSrc.size, 3, "three distinct pictures, each book's copy from the same file");
    assert.doesNotMatch(await page.content(), /AN AI DRAFT/);
    const nodes = parseSnapshot(await page.locator("body").ariaSnapshot());
    const c = controlProblems(nodes);
    assert.deepEqual(c.unnamed, []);
    assert.deepEqual(c.duplicates, []);
    assert.deepEqual(linkProblems(nodes).unnamed, []);
    assert.deepEqual(await focusableProblems(page), []);
    const [sw, cw] = await page.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.clientWidth]);
    assert.ok(sw <= cw, `no sideways scrolling: ${sw} > ${cw}`);
    assert.deepEqual(problems, [], "no errors and no blocked loads");
    assert.deepEqual(offsite, [], "nothing was requested from another site");
    await ctx.close();
  });

  test(`/describe-pictures/ (${name}): the keyboard alone writes and sends a suggestion, past the site's own top bar`, async () => {
    seen.length = 0;
    const { ctx, page, problems, offsite } = await open(width, height);
    await page.goto(`${server.url}/describe-pictures/`);
    await page.waitForFunction(() => !document.getElementById("item").hidden);
    const order = [];
    const tabTo = async (id) => {
      for (let i = 0; i < 80; i++) {
        await page.keyboard.press("Tab");
        const at = await page.evaluate(() => document.activeElement?.id || document.activeElement?.tagName);
        order.push(at);
        if (at === id) return;
      }
      assert.fail(`${id} not reached by Tab: ${order.join(",")}`);
    };
    await tabTo("review-alt");
    await page.keyboard.type("A salt shaker inside a black triangle");
    await tabTo("send");
    assert.ok(!order.includes("inbox-website"), "the trap field is not in the tab order");
    assert.equal(await page.evaluate(() => getComputedStyle(document.activeElement).outlineStyle), "solid", "focus is visible");
    await page.keyboard.press("Enter");
    await page.waitForFunction(() => /^Sent\./.test(document.getElementById("save-status").textContent));
    assert.equal(seen.length, 1);
    assert.equal(seen[0].url, "/wp-json/betanyc-data/v1/report");
    assert.equal(seen[0].origin, siteOrigin);
    const body = JSON.parse(seen[0].body);
    assert.equal(body.tool, "law-reader");
    assert.equal(body.kind, "alt-text-suggestion");
    assert.equal(body.suggested_alt, "A salt shaker inside a black triangle");
    assert.deepEqual(problems, []);
    assert.deepEqual(offsite, []);
    await ctx.close();
  });
}
