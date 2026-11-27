// The picture description page as build-site makes it (/describe-pictures/, issue #87), in a real
// browser: the three-book fixture site, with the alt-text fixture's pictures committed the way
// npm run alt:images commits them. The page is in the site's own frame (Noel, 2026-11-26): top
// bar, breadcrumbs, footer; its controls are NYSDS elements, as on the rest of the site. The
// footer link opens it; every picture loads from the site itself; an AI draft is shown labeled
// "AI draft, not yet checked by a person", never with the model's name, and a picture with no
// description says so; the page's content security policy blocks nothing it needs; the keyboard
// alone sends a suggestion and opens "what will be sent". The
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
let reply = { status: 201, body: { ok: true }, headers: {} };

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
      res.writeHead(reply.status, { ...cors, "Access-Control-Expose-Headers": "Retry-After", "Content-Type": "application/json", ...reply.headers });
      res.end(JSON.stringify(reply.body));
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
  // One AI draft, with a note of what the model was unsure of: the page shows the draft, labeled,
  // and never the model's name or the note.
  await saveDraft(fx.storeDir, "admin_code", inventories[0].images[0], { draft: { alt: "An icon of a salt shaker", long: "", unsure: "MODEL UNSURE NOTE" }, model: "claude-fable-5-2" });
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
    assert.match(await page.locator("main .lede").textContent(), /1 of the 6 has only a text description that an AI model drafted for BetaNYC, which no person has checked yet, labeled "AI draft, not yet checked by a person"\. 5 of the 6 have none yet\./);
    assert.equal(await page.locator("#progress").textContent(), "0 of 6 pictures reviewed; 1 have an AI draft.");
    // The controls are the site's NYSDS elements; the trap field is the one plain input.
    // (NYSDS gives each element's inner control the same id inside its shadow root, so the
    // elements are found by tag and id, or from the document.)
    const tag = (id) => page.evaluate((x) => document.getElementById(x)?.localName, id);
    for (const id of ["filter-book", "filter-status"]) assert.equal(await tag(id), "nys-select", id);
    for (const id of ["prev", "next", "show-payload", "send"]) assert.equal(await tag(id), "nys-button", id);
    for (const id of ["current-alt", "current-long", "review-alt", "review-long", "inbox-note"]) assert.equal(await tag(id), "nys-textarea", id);
    assert.equal(await tag("credit-ok"), "nys-checkbox");
    // Name and email are plain inputs so the browser can fill them in (WCAG 1.3.5); with the trap
    // field, they are the only plain controls.
    assert.deepEqual(await page.evaluate(() => [...document.querySelectorAll("main input, main select, main textarea, main button")].map((e) => e.id)), ["contact-name", "contact-email", "inbox-website"]);
    assert.deepEqual(await page.evaluate(() => [...document.querySelectorAll("#filter-status > option")].map((o) => o.textContent)), ["Any status", "No description yet", "AI draft, not yet checked", "Needs work", "Reviewed"]);
    assert.equal(await page.evaluate(() => document.getElementById("filter-book").value), "all", "Both books is chosen, and shown");
    // The first picture has the AI draft: shown as the current text, labeled, and copied into the
    // suggestion box.
    assert.equal(await page.locator("#current-label").textContent(), "AI draft, not yet checked by a person");
    assert.equal(await page.evaluate(() => document.getElementById("current-alt").value), "An icon of a salt shaker");
    assert.equal(await page.evaluate(() => document.getElementById("review-alt").value), "An icon of a salt shaker");
    assert.match(await page.locator("#picture-facts").textContent(), /status: AI draft, not yet checked$/);
    const visible = await page.locator("body").innerText();
    assert.doesNotMatch(visible, /claude|fable|anthropic|MODEL UNSURE NOTE/i, "no model name, no model note");
    const seenSrc = new Set();
    for (let i = 0; i < 6; i++) {
      const [ok, src] = await page.locator("#picture").evaluate(async (img) => {
        if (!img.complete) await new Promise((r) => img.addEventListener("load", r, { once: true }));
        return [img.naturalWidth > 0, img.getAttribute("src")];
      });
      assert.ok(ok, `${src} loads`);
      seenSrc.add(src);
      if (i > 0) {
        assert.equal(await page.locator("#current-label").textContent(), "No description yet");
        assert.equal(await page.evaluate(() => document.getElementById("current-alt").value), "");
        assert.equal(await page.evaluate(() => document.getElementById("review-alt").value), "", "the suggestion box starts empty");
        assert.match(await page.locator("#picture-facts").textContent(), /status: No description yet$/);
      }
      assert.ok(await page.getByRole("button", { name: "Send suggestion" }).isVisible());
      assert.equal(await page.locator("#draft-alt").count(), 0, "no separate AI draft box");
      if (i < 5) await page.getByRole("button", { name: "Next picture" }).click();
    }
    assert.equal(seenSrc.size, 3, "three distinct pictures, each book's copy from the same file");
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
    reply = { status: 201, body: { ok: true }, headers: {} };
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
    await page.keyboard.press("ControlOrMeta+a");
    await page.keyboard.type("A salt shaker inside a black triangle");
    await tabTo("contact-name");
    await page.keyboard.type("Ada");
    await tabTo("credit-ok");
    await page.keyboard.press("Space");
    assert.equal(await page.evaluate(() => document.getElementById("credit-ok").checked), true, "Space ticks the NYSDS checkbox");
    await tabTo("show-payload");
    await page.keyboard.press("Enter");
    assert.equal(await page.locator("#payload").isVisible(), true, "what will be sent is shown");
    assert.match(await page.locator("#payload").textContent(), /"kind": "alt-text-suggestion"/);
    assert.match(await page.locator("#payload").textContent(), /"suggested_alt": "A salt shaker inside a black triangle"/);
    assert.equal(await page.getByRole("button", { name: "Hide what will be sent" }).getAttribute("aria-expanded"), "true");
    await tabTo("send");
    assert.ok(!order.includes("inbox-website"), "the trap field is not in the tab order");
    // The focus ring NYSDS draws on the button inside its shadow root (law.css sets its color).
    const ring = await page.evaluate(() => {
      let e = document.activeElement;
      while (e?.shadowRoot?.activeElement) e = e.shadowRoot.activeElement;
      const cs = getComputedStyle(e);
      return { tag: e.localName, outline: cs.outlineStyle, width: cs.outlineWidth };
    });
    assert.equal(ring.tag, "button", "focus is on Send's own button");
    assert.notEqual(ring.outline, "none", `focus is visible: ${JSON.stringify(ring)}`);
    await page.keyboard.press("Enter");
    await page.waitForFunction(() => /^Sent\./.test(document.getElementById("save-status").textContent));
    assert.equal(seen.length, 1);
    assert.equal(seen[0].url, "/wp-json/betanyc-data/v1/report");
    assert.equal(seen[0].origin, siteOrigin);
    const body = JSON.parse(seen[0].body);
    assert.equal(body.tool, "law-reader");
    assert.equal(body.kind, "alt-text-suggestion");
    assert.equal(body.suggested_alt, "A salt shaker inside a black triangle");
    assert.equal(body.credit_ok, true);
    assert.deepEqual(body.contact, { name: "Ada" });
    assert.deepEqual(problems, []);
    assert.deepEqual(offsite, []);
    await ctx.close();
  });

  test(`/describe-pictures/ (${name}): a field the form refuses is marked on the NYSDS field, and the intake's answers are said plainly`, async () => {
    seen.length = 0;
    reply = { status: 201, body: { ok: true }, headers: {} };
    const { ctx, page, problems, offsite } = await open(width, height);
    await page.goto(`${server.url}/describe-pictures/`);
    await page.waitForFunction(() => !document.getElementById("item").hidden);
    await page.getByRole("button", { name: "Next picture" }).click();
    await page.getByRole("textbox", { name: "Alt text", exact: true }).fill("A map of a city block");
    await page.getByRole("textbox", { name: "Email", exact: true }).fill("not-an-email");
    await page.getByRole("button", { name: "Send suggestion" }).click();
    await page.waitForFunction(() => /^Not sent:/.test(document.getElementById("save-status").textContent));
    assert.match(await page.locator("#save-status").textContent(), /That email address does not look complete/);
    // Marked on the field: aria-invalid, and the message under it is the field's description.
    const err = await page.evaluate(() => {
      const f = document.getElementById("contact-email");
      const box = document.getElementById(f.getAttribute("aria-describedby"));
      return { invalid: f.getAttribute("aria-invalid"), msg: box?.textContent.trim(), shown: !!box && !box.hidden && box.getBoundingClientRect().height > 0, focus: document.activeElement?.id };
    });
    assert.deepEqual(err, { invalid: "true", msg: "That email address does not look complete. Fix it, or leave it empty.", shown: true, focus: "contact-email" });
    assert.equal((await page.locator("#contact-email").evaluate((e) => e.getAttribute("aria-describedby"))), "contact-email-error");
    assert.equal(seen.length, 0, "nothing was sent");
    // Fixed, it goes; a 429 from the intake is said with its wait, and the text stays.
    await page.getByRole("textbox", { name: "Email", exact: true }).fill("");
    reply = { status: 429, body: { code: "rate_limited", message: "Too many reports." }, headers: { "Retry-After": "120" } };
    await page.getByRole("button", { name: "Send suggestion" }).click();
    await page.waitForFunction(() => /Try again in/.test(document.getElementById("save-status").textContent));
    assert.match(await page.locator("#save-status").textContent(), /^Not sent: too many suggestions .*Try again in 2 minutes\./);
    assert.deepEqual(await page.evaluate(() => { const f = document.getElementById("contact-email"); return [f.getAttribute("aria-invalid"), f.getAttribute("aria-describedby"), document.getElementById("contact-email-error").hidden]; }), [null, null, true], "the error is cleared");
    assert.equal(await page.evaluate(() => document.getElementById("review-alt").value), "A map of a city block", "the text is kept");
    reply = { status: 201, body: { ok: true }, headers: {} };
    await page.getByRole("button", { name: "Send suggestion" }).click();
    await page.waitForFunction(() => /^Sent\./.test(document.getElementById("save-status").textContent));
    await page.getByRole("button", { name: "Send suggestion" }).click();
    await page.waitForFunction(() => /already sent/.test(document.getElementById("save-status").textContent));
    assert.equal(seen.length, 2);
    // Chromium logs the 429 itself as a failed load; nothing else may be logged.
    assert.deepEqual(problems.filter((p) => !/status of 429/.test(p)), []);
    assert.deepEqual(offsite, []);
    await ctx.close();
  });

  test(`/describe-pictures/ (${name}): name and email are plain inputs the browser can fill, drawn as NYSDS's nys-textinput draws its own`, async () => {
    const { ctx, page, problems } = await open(width, height);
    await page.goto(`${server.url}/describe-pictures/`);
    await page.waitForFunction(() => !document.getElementById("item").hidden);
    const attrs = await page.evaluate(() => ["contact-name", "contact-email"].map((id) => {
      const e = document.getElementById(id);
      return [e.localName, e.type, e.getAttribute("autocomplete"), document.querySelector(`label[for="${id}"]`)?.textContent];
    }));
    assert.deepEqual(attrs, [["input", "text", "name", "Name"], ["input", "email", "email", "Email"]]);
    assert.equal(await page.getByRole("textbox", { name: "Name", exact: true }).count(), 1);
    // A real nys-textinput beside them, as the reference: input, label, focus ring and error
    // state must compute the same.
    const r = await page.evaluate(async () => {
      const ref = document.createElement("nys-textinput");
      ref.setAttribute("label", "Reference");
      ref.setAttribute("width", "full");
      document.getElementById("contact-email").closest(".nys-like-field").after(ref);
      await ref.updateComplete;
      await new Promise((res) => requestAnimationFrame(() => requestAnimationFrame(res)));
      const props = ["borderTopWidth", "borderTopStyle", "borderTopColor", "borderRadius", "paddingTop", "paddingLeft", "height", "width", "fontFamily", "fontSize", "lineHeight", "fontWeight", "letterSpacing", "color", "outlineStyle", "outlineWidth", "outlineOffset", "boxSizing"];
      const pick = (e, list = props) => Object.fromEntries(list.map((k) => [k, getComputedStyle(e)[k]]));
      const inner = ref.shadowRoot.querySelector("input");
      const mine = document.getElementById("contact-email");
      const out = { rest: [pick(inner), pick(mine)] };
      const refLabel = ref.shadowRoot.querySelector("nys-label").shadowRoot.querySelector("label");
      const labelProps = ["fontFamily", "fontSize", "lineHeight", "fontWeight", "letterSpacing", "color"];
      out.label = [pick(refLabel, labelProps), pick(document.querySelector('label[for="contact-email"]'), labelProps)];
      out.gap = [inner.getBoundingClientRect().top - refLabel.getBoundingClientRect().bottom, mine.getBoundingClientRect().top - document.querySelector('label[for="contact-email"]').getBoundingClientRect().bottom];
      out.background = [getComputedStyle(ref.shadowRoot.querySelector(".nys-textinput__container")).backgroundColor, getComputedStyle(mine).backgroundColor];
      const ring = ["outlineStyle", "outlineWidth", "outlineColor", "outlineOffset", "borderTopColor"];
      inner.focus();
      const refFocus = pick(inner, ring);
      mine.focus();
      out.focus = [refFocus, pick(mine, ring)];
      mine.blur();
      ref.showError = true;
      ref.errorMessage = "Reference error";
      mine.setAttribute("aria-invalid", "true");
      await ref.updateComplete;
      await new Promise((res) => requestAnimationFrame(res));
      out.error = [getComputedStyle(inner).borderTopColor, getComputedStyle(mine).borderTopColor];
      const refMsg = ref.shadowRoot.querySelector("nys-errormessage").shadowRoot.querySelector(".nys-errormessage");
      const box = document.getElementById("contact-email-error");
      box.hidden = false;
      box.querySelector("span").textContent = "Mine";
      const msgProps = ["color", "fontFamily", "fontSize", "lineHeight", "fontWeight", "display", "alignItems", "columnGap"];
      out.message = [pick(refMsg, msgProps), pick(box, msgProps)];
      return out;
    });
    assert.deepEqual(r.rest[1], r.rest[0], "the input's border, radius, padding, height, width and type");
    assert.equal(r.rest[1].height, "40px");
    assert.equal(r.rest[1].borderTopWidth, "2px");
    assert.deepEqual(r.label[1], r.label[0], "the label's type");
    assert.equal(r.gap[1], r.gap[0], "label to box spacing");
    assert.equal(r.background[1], r.background[0], "white behind the text");
    assert.deepEqual(r.focus[1], r.focus[0], "the focus ring");
    assert.equal(r.error[1], r.error[0], "the error border");
    assert.deepEqual(r.message[1], r.message[0], "the error message");
    assert.deepEqual(problems, []);
    await ctx.close();
  });
}
