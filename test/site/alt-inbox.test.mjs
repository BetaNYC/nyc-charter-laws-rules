// The picture description page in inbox mode, in a real browser (issue #87): "Send suggestion"
// posts to BetaNYC's data-issue intake. Here the intake is a fake one on 127.0.0.1 that answers
// as the real one does (CORS for the page's origin, 201 / 400 / 429 with Retry-After / 503), so
// nothing leaves this machine. At phone and desktop widths: every control is named, nothing
// focusable is unnamed, the keyboard alone can fill and send a suggestion, the trap field is
// never reached, the page connects only to the intake, and each answer is said plainly.
// Runs with npm run test:site.

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { chromium } from "playwright";
import { openSource } from "../../scripts/lib/alt-text/source.js";
import { buildInventory, loadIndex } from "../../scripts/lib/alt-text/inventory.js";
import { saveDraft, saveReview } from "../../scripts/lib/alt-text/store.js";
import { buildStatic } from "../../scripts/lib/alt-text/static-build.js";
import { startServer } from "../../scripts/lib/site/serve.js";
import { parseSnapshot, controlProblems, linkProblems, focusableProblems, CHROMIUM_ARGS } from "./a11y-tree.mjs";
import { makeFixture } from "../alt-text/fixture.js";

const WIDTHS = [
  ["phone", 390, 844],
  ["desktop", 1100, 900],
];

let browser, site, intake, other, pageUrl;
const seen = [];
const otherSeen = [];
let reply = { status: 201, body: { ok: true }, headers: {} };

/** A fake intake: answers a preflight and a POST for the page's origin only, as Snippet #21 does. */
function fakeIntake(log, allowOrigin) {
  const srv = createServer((req, res) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      const origin = req.headers.origin;
      const cors = origin === allowOrigin() ? { "Access-Control-Allow-Origin": origin, "Access-Control-Allow-Methods": "POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type", "Access-Control-Expose-Headers": "Retry-After", Vary: "Origin" } : { Vary: "Origin" };
      if (req.method === "OPTIONS") {
        res.writeHead(204, { ...cors, "Cache-Control": "no-store" });
        return res.end();
      }
      log.push({ method: req.method, url: req.url, headers: req.headers, body: Buffer.concat(chunks).toString("utf8") });
      res.writeHead(reply.status, { ...cors, "Content-Type": "application/json", "Cache-Control": "no-store", ...reply.headers });
      res.end(JSON.stringify(reply.body));
    });
  });
  return new Promise((resolve) => srv.listen(0, "127.0.0.1", () => resolve({ srv, url: `http://127.0.0.1:${srv.address().port}` })));
}

before(async () => {
  const fx = makeFixture();
  const source = openSource(fx.source);
  const inv = buildInventory("rules", source, loadIndex("rules", fx.indexDir));
  const d = await saveDraft(fx.storeDir, "rules", inv.images[0], { draft: { alt: "draft icon", long: "", unsure: "" }, model: "claude-fable-5-2" });
  await saveReview(fx.storeDir, "rules", inv.images[0], { review: { alt: "the sodium warning icon", long: "" }, status: "reviewed", base: d.updated_at });
  await saveDraft(fx.storeDir, "rules", inv.images[1], { draft: { alt: "a map", long: "A map of a city block.", unsure: "" }, model: "claude-fable-5-2" });
  let siteOrigin = "";
  intake = await fakeIntake(seen, () => siteOrigin);
  other = await fakeIntake(otherSeen, () => siteOrigin);
  const root = mkdtempSync(join(tmpdir(), "alt-inbox-site-"));
  buildStatic({ inventories: [inv], sources: { rules: source }, storeDir: fx.storeDir, outDir: join(root, "describe-pictures"), includeDrafts: true, mode: "inbox", endpoint: `${intake.url}/wp-json/betanyc-data/v1/report`, redirects: { rules: { s1: "/rules/titles/1/sections/1-01" } } });
  site = await startServer(root, 0);
  siteOrigin = new URL(site.url).origin;
  pageUrl = `${site.url}/describe-pictures/`;
  browser = await chromium.launch({ args: CHROMIUM_ARGS });
});

after(async () => {
  await browser?.close();
  site?.server?.close();
  intake?.srv.close();
  other?.srv.close();
});

async function open(width, height, { blockStorage = false } = {}) {
  const ctx = await browser.newContext({ viewport: { width, height }, reducedMotion: "reduce" });
  if (blockStorage) {
    await ctx.addInitScript(() => {
      Object.defineProperty(window, "localStorage", {
        get() {
          throw new DOMException("blocked", "SecurityError");
        },
      });
    });
  }
  const page = await ctx.newPage();
  const problems = [];
  page.on("console", (m) => m.type() === "error" && problems.push(m.text()));
  page.on("pageerror", (e) => problems.push(e.message));
  await page.goto(pageUrl);
  await page.waitForFunction(() => !document.getElementById("item").hidden);
  return { page, problems, ctx };
}

const status = (page) => page.locator("#save-status").textContent();
const waitStatus = (page, re) => page.waitForFunction((src) => new RegExp(src).test(document.getElementById("save-status").textContent), re.source);

for (const [name, width, height] of WIDTHS) {
  test(`inbox page (${name}): every control and link is named, nothing focusable is unnamed, no overflow, no errors`, async () => {
    const { page, problems, ctx } = await open(width, height);
    const nodes = parseSnapshot(await page.locator("body").ariaSnapshot());
    const c = controlProblems(nodes);
    assert.ok(c.controls.length >= 10, `the page shows its controls (${c.controls.length})`);
    assert.deepEqual(c.unnamed, []);
    assert.deepEqual(c.duplicates, []);
    const l = linkProblems(nodes);
    assert.deepEqual(l.unnamed, []);
    assert.deepEqual(l.conflicting, []);
    assert.deepEqual(await focusableProblems(page), []);
    // The trap field is not in the accessibility tree.
    assert.ok(!nodes.some((n) => /leave this box empty/i.test(n.name)), "the trap field is hidden from assistive tech");
    // The local and GitHub-issue parts are not shown.
    for (const id of ["save", "suggest", "draft-alt"]) assert.equal(await page.locator(`#${id}`).isVisible(), false, id);
    const [sw, cw] = await page.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.clientWidth]);
    assert.ok(sw <= cw, `no sideways scrolling: ${sw} > ${cw}`);
    // Reviewed text is labeled as reviewed, an AI draft as an AI draft.
    assert.equal(await page.locator("#current-label").textContent(), "Reviewed by a person at BetaNYC");
    assert.equal(await page.getByLabel("Current alt text (read only)").inputValue(), "the sodium warning icon");
    assert.equal(await page.getByLabel("Alt text", { exact: true }).inputValue(), "the sodium warning icon");
    await page.locator("#next").click();
    assert.equal(await page.locator("#current-label").textContent(), "AI draft, not yet checked by a person");
    assert.equal(await page.getByLabel("Current long description (read only)").inputValue(), "A map of a city block.");
    // Where it appears links to its section on the Law Reader.
    await page.locator("#prev").click();
    assert.equal(await page.getByRole("link", { name: /Read Rules § 1-01 on the Law Reader/ }).first().getAttribute("href"), "https://law.beta.nyc/rules/titles/1/sections/1-01");
    assert.equal(await page.getByRole("link", { name: "BetaNYC privacy policy" }).getAttribute("href"), "https://www.beta.nyc/privacy-policy/");
    assert.equal(await page.getByLabel("You may credit me by name if BetaNYC uses my description").isChecked(), false, "credit is an unticked opt-in");
    assert.deepEqual(problems, []);
    await ctx.close();
  });

  test(`inbox page (${name}): the keyboard alone fills and sends a suggestion; the trap field is never reached`, async () => {
    seen.length = 0;
    reply = { status: 201, body: { ok: true }, headers: {} };
    const { page, problems, ctx } = await open(width, height);
    const order = [];
    const tabTo = async (id) => {
      for (let i = 0; i < 60; i++) {
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
    await tabTo("inbox-note");
    await page.keyboard.type("The old text did not say it is a triangle.");
    await tabTo("contact-name");
    await page.keyboard.type("Ada");
    await tabTo("contact-email");
    await page.keyboard.type("ada@example.org");
    await tabTo("credit-ok");
    await page.keyboard.press("Space");
    await tabTo("show-payload");
    await page.keyboard.press("Enter");
    assert.equal(await page.locator("#show-payload").getAttribute("aria-expanded"), "true");
    assert.match(await page.locator("#payload").textContent(), /"kind": "alt-text-suggestion"/);
    await tabTo("send");
    assert.ok(!order.includes("inbox-website"), `the trap field is not in the tab order: ${order.join(",")}`);
    const outline = await page.evaluate(() => getComputedStyle(document.activeElement).outlineStyle);
    assert.equal(outline, "solid", "focus is visible");
    await page.keyboard.press("Enter");
    await waitStatus(page, /^Sent\./);
    assert.equal(seen.length, 1);
    const req = seen[0];
    assert.equal(req.method, "POST");
    assert.equal(req.url, "/wp-json/betanyc-data/v1/report");
    assert.match(req.headers["content-type"], /^application\/json/);
    assert.equal(req.headers.origin, new URL(site.url).origin);
    assert.equal(req.headers.cookie, undefined);
    assert.equal(req.headers.referer, undefined, "no referrer is sent");
    const body = JSON.parse(req.body);
    assert.equal(body.tool, "law-reader");
    assert.equal(body.kind, "alt-text-suggestion");
    assert.equal(body.book, "rules");
    assert.match(body.image_sha256, /^[0-9a-f]{64}$/);
    assert.deepEqual(body.picture_ids, ["0-0-0-1-img"]);
    assert.equal(body.page_url, "https://law.beta.nyc/rules/titles/1/sections/1-01");
    assert.equal(body.suggested_alt, "A salt shaker inside a black triangle");
    assert.equal(body.note, "The old text did not say it is a triangle.");
    assert.equal(body.credit_ok, true);
    assert.deepEqual(body.contact, { name: "Ada", email: "ada@example.org" });
    assert.equal(body.website, "");
    assert.match(body.client_id, /^[A-Za-z0-9-]{16,64}$/);
    // Pressing Send again without a change does not send it twice.
    await page.locator("#send").press("Enter");
    await waitStatus(page, /already sent/);
    assert.equal(seen.length, 1);
    assert.deepEqual(problems, []);
    await ctx.close();
  });
}

test("inbox page: each answer is said plainly, and the text is kept after a failure", async () => {
  const { page, ctx } = await open(1100, 900);
  const box = page.getByLabel("Alt text", { exact: true });
  const cases = [
    [{ status: 429, body: { ok: false, error: "Too many requests." }, headers: { "Retry-After": "120" } }, /Not sent: too many suggestions.*Try again in 2 minutes/],
    [{ status: 400, body: { ok: false, error: "Invalid suggested_alt." }, headers: {} }, /Not sent: the alt text is too long/],
    [{ status: 403, body: { ok: false, error: "Origin not allowed." }, headers: {} }, /only be sent from the Law Reader/],
    [{ status: 503, body: { ok: false, error: "Service unavailable." }, headers: {} }, /not working right now/],
  ];
  for (const [i, [r, re]] of cases.entries()) {
    reply = r;
    await box.fill(`try number ${i}`);
    await page.locator("#send").click();
    await waitStatus(page, re);
    assert.match(await status(page), /Your text is still here\./);
    assert.equal(await box.inputValue(), `try number ${i}`);
  }
  reply = { status: 201, body: { ok: true }, headers: {} };
  await ctx.close();
});

test("inbox page: nothing is sent for an unchanged text, an over-long one, or Enter in the name box", async () => {
  seen.length = 0;
  const { page, ctx } = await open(390, 844);
  await page.locator("#send").click();
  await waitStatus(page, /change the description, or add a note/);
  await page.getByLabel("Alt text", { exact: true }).fill("x".repeat(1001));
  await page.locator("#send").click();
  await waitStatus(page, /1,001 characters; the limit is 1,000/);
  assert.equal(await page.getByLabel("Alt text", { exact: true }).getAttribute("aria-invalid"), "true");
  assert.equal(await page.evaluate(() => document.activeElement.id), "review-alt", "focus goes to the box to fix");
  await page.getByLabel("Alt text", { exact: true }).fill("fine now");
  await page.getByLabel("Name", { exact: true }).fill("Ada");
  await page.getByLabel("Name", { exact: true }).press("Enter");
  await page.waitForTimeout(300);
  assert.equal(seen.length, 0, "nothing reached the intake");
  await ctx.close();
});

test("inbox page: the page can connect only to the intake (CSP), and a down intake is a clear message", async () => {
  otherSeen.length = 0;
  const { page, ctx } = await open(1100, 900);
  const result = await page.evaluate(async (u) => {
    try {
      await fetch(u, { method: "POST", body: "{}" });
      return "fetched";
    } catch {
      return "blocked";
    }
  }, `${other.url}/elsewhere`);
  assert.equal(result, "blocked");
  assert.equal(otherSeen.length, 0, "the other server got nothing");
  // The page's own data comes from the page, not from a fetch.
  assert.match(await page.locator("#progress").textContent(), /of 3 pictures reviewed/);
  // The intake down: a network failure says so.
  const port = new URL(intake.url).port;
  intake.srv.close();
  await new Promise((r) => setTimeout(r, 100));
  await page.getByLabel("Alt text", { exact: true }).fill("while the intake is down");
  await page.locator("#send").click();
  await waitStatus(page, /could not reach www\.beta\.nyc/);
  // Bring it back on the same port for any later test.
  await new Promise((r) => intake.srv.listen(Number(port), "127.0.0.1", r));
  await ctx.close();
});

test("inbox page: the browser keeps one random id across visits, and still sends one when storage is blocked", async () => {
  seen.length = 0;
  reply = { status: 201, body: { ok: true }, headers: {} };
  const { page, ctx } = await open(1100, 900);
  const sendOnce = async (p, text) => {
    await p.getByLabel("Alt text", { exact: true }).fill(text);
    await p.locator("#send").click();
    await waitStatus(p, /^Sent\./);
  };
  await sendOnce(page, "first visit");
  await page.reload();
  await page.waitForFunction(() => !document.getElementById("item").hidden);
  await sendOnce(page, "second visit");
  const [a, b] = seen.map((r) => JSON.parse(r.body).client_id);
  assert.match(a, /^[A-Za-z0-9-]{16,64}$/);
  assert.equal(a, b, "the same id after a reload");
  await ctx.close();
  const blocked = await open(1100, 900, { blockStorage: true });
  await sendOnce(blocked.page, "storage blocked");
  const c = JSON.parse(seen[2].body).client_id;
  assert.match(c, /^[A-Za-z0-9-]{16,64}$/);
  assert.notEqual(c, a);
  assert.deepEqual(blocked.problems, []);
  await blocked.ctx.close();
});

test("inbox page: a filled trap field is sent as filled, so the intake can drop it", async () => {
  seen.length = 0;
  const { page, ctx } = await open(1100, 900);
  await page.evaluate(() => (document.getElementById("inbox-website").value = "http://spam.example"));
  await page.getByLabel("Alt text", { exact: true }).fill("robot text");
  await page.locator("#send").click();
  await waitStatus(page, /^Sent\./);
  assert.equal(JSON.parse(seen[0].body).website, "http://spam.example");
  await ctx.close();
});
