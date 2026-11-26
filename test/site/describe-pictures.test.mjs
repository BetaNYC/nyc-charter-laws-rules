// The picture description page as build-site makes it (/describe-pictures/, issue #87), in a real
// browser: the three-book fixture site, with the alt-text fixture's pictures committed the way
// npm run alt:images commits them. The footer link opens it; every picture loads from the site
// itself; a picture with no description says so and offers the form, with no AI draft shown; the
// page's content security policy blocks nothing it needs. Every request off 127.0.0.1 is aborted
// and counted, so nothing is sent to www.beta.nyc. Runs with npm run test:site.

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
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
import { parseSnapshot, controlProblems, focusableProblems, CHROMIUM_ARGS } from "./a11y-tree.mjs";
import { closeBrowser, closeServer, HOOK_TIMEOUT } from "./cleanup.mjs";

let fx, site, server, browser;

before(async () => {
  fx = makeFixture();
  writeFileSync(join(fx.indexDir, "admin_code.json"), JSON.stringify(INDEX.map((r) => ({ ...r, corpus: "admin_code" }))));
  const sources = { admin_code: openSource(fx.source), rules: openSource(fx.source) };
  const inventories = ["admin_code", "rules"].map((b) => buildInventory(b, sources[b], loadIndex(b, fx.indexDir)));
  writePictures({ inventories, sources, outDir: join(fx.root, "pictures") });
  // An AI draft in the store must not reach the page.
  await saveDraft(fx.storeDir, "admin_code", inventories[0].images[0], { draft: { alt: "AN AI DRAFT", long: "", unsure: "" }, model: "claude-fable-5-2" });
  site = await buildThreeBookFixtureSite({ options: { picturesDir: join(fx.root, "pictures"), altTextDir: fx.storeDir } });
  server = await startServer(site.outDir, 0);
  browser = await chromium.launch({ args: CHROMIUM_ARGS });
});

after(async () => {
  await closeBrowser(browser);
  closeServer(server?.server);
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
  test(`/describe-pictures/ (${name}): reached from the footer, every picture loads, no description yet, the form is there`, async () => {
    const { ctx, page, problems, offsite } = await open(width, height);
    await page.goto(`${server.url}/about`);
    await page.locator("footer").getByRole("link", { name: "Picture descriptions" }).click();
    await page.waitForURL(/\/describe-pictures\/(#.*)?$/);
    await page.waitForFunction(() => !document.getElementById("item").hidden);
    assert.equal(await page.title(), "Picture descriptions | BetaNYC Law Reader");
    assert.match(await page.locator("#progress").textContent(), /^0 of 6 pictures reviewed; 0 have an AI draft\.$/);
    const seen = new Set();
    for (let i = 0; i < 6; i++) {
      const [ok, src] = await page.locator("#picture").evaluate(async (img) => {
        if (!img.complete) await new Promise((r) => img.addEventListener("load", r, { once: true }));
        return [img.naturalWidth > 0, img.getAttribute("src")];
      });
      assert.ok(ok, `${src} loads`);
      seen.add(src);
      assert.equal(await page.locator("#current-label").textContent(), "No reviewed description yet");
      assert.equal(await page.getByLabel("Current alt text (read only)").inputValue(), "");
      assert.equal(await page.getByLabel("Alt text", { exact: true }).inputValue(), "", "the suggestion box starts empty");
      assert.ok(await page.getByRole("button", { name: "Send suggestion" }).isVisible());
      assert.equal(await page.locator("#draft-alt").isVisible(), false, "no AI draft box");
      if (i < 5) await page.locator("#next").click();
    }
    assert.equal(seen.size, 3, "three distinct pictures, each book's copy from the same file");
    assert.doesNotMatch(await page.content(), /AN AI DRAFT/);
    const c = controlProblems(parseSnapshot(await page.locator("body").ariaSnapshot()));
    assert.deepEqual(c.unnamed, []);
    assert.deepEqual(await focusableProblems(page), []);
    const [sw, cw] = await page.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.clientWidth]);
    assert.ok(sw <= cw, `no sideways scrolling: ${sw} > ${cw}`);
    assert.deepEqual(problems, [], "no errors and no blocked loads");
    assert.deepEqual(offsite, [], "nothing was requested from another site");
    await ctx.close();
  });
}
