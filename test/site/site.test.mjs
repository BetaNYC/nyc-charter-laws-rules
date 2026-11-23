// Browser tests for the Charter site (issue #62). Run with: npm run test:site
// (needs `npx playwright install chromium` once). Not part of npm test, which stays fast.
//
// The site is built from the real fixtures (fixture-site.mjs) with its Pagefind index, served
// on 127.0.0.1 the way GitHub Pages serves it, and opened in headless Chromium. Offline: the
// pages load nothing from outside the site.

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { buildFixtureSite } from "./fixture-site.mjs";
import { startServer } from "../../scripts/lib/site/serve.js";
import { parseSnapshot, controlProblems, linkProblems, focusableProblems, CHROMIUM_ARGS } from "./a11y-tree.mjs";

let site, server, base, browser;
const outside = [];

before(async () => {
  site = await buildFixtureSite({ search: true });
  ({ server, url: base } = await startServer(site.outDir));
  browser = await chromium.launch({ args: CHROMIUM_ARGS });
});

after(async () => {
  await browser?.close();
  server?.close();
});

// A page that fails on console errors, failed requests and anything fetched from off the site.
async function open(path, { width = 1200, js = true, ctxOpts = {} } = {}) {
  const ctx = await browser.newContext({ viewport: { width, height: 900 }, javaScriptEnabled: js, ...ctxOpts });
  const page = await ctx.newPage();
  const problems = [];
  page.on("console", (m) => m.type() === "error" && problems.push(`console: ${m.text()}`));
  page.on("pageerror", (e) => problems.push(`page error: ${e.message}`));
  page.on("requestfailed", (r) => problems.push(`failed: ${r.url()}`));
  page.on("request", (r) => {
    if (!r.url().startsWith(base)) outside.push(r.url());
  });
  page.on("response", (r) => {
    if (r.status() >= 400 && !r.url().endsWith(path)) problems.push(`${r.status()}: ${r.url()}`);
  });
  await page.goto(base + path, { waitUntil: "networkidle" });
  if (js) await page.waitForFunction(() => customElements.get("nys-button") !== undefined);
  return { page, ctx, problems };
}

const sectionWithParts = () => site.book.sections.find((s) => s.structure.blocks.filter((b) => b.anchor).length >= 2 && s.chapter.sections.length > 1);

async function assertNamedControls(page, label) {
  assert.deepEqual(await focusableProblems(page), [], `${label}: focusable elements with no role or no name`);
  const nodes = parseSnapshot(await page.locator("body").ariaSnapshot());
  const c = controlProblems(nodes);
  assert.deepEqual(c.unnamed, [], `${label}: controls with no name`);
  assert.deepEqual(c.duplicates, [], `${label}: controls that share a name`);
  const l = linkProblems(nodes);
  assert.deepEqual(l.unnamed, [], `${label}: links with no name`);
  assert.deepEqual(l.conflicting, [], `${label}: one link name for different places`);
  // The tree agrees with getByRole.
  for (const role of ["button", "searchbox", "checkbox"]) {
    assert.equal(await page.getByRole(role).count(), c.controls.filter((x) => x.role === role).length, `${label}: ${role} count`);
  }
  return { nodes, controls: c.controls };
}

test("agents on the page: every control on a section page has its own name", async () => {
  const s = sectionWithParts();
  for (const width of [1200, 390]) {
    const { page, ctx, problems } = await open(s.path, { width });
    const { controls } = await assertNamedControls(page, `${s.path} at ${width}px`);
    const names = controls.map((x) => x.name);
    for (const n of ["Copy link", "Copy citation", "Print", "Go"]) assert.ok(names.includes(n), `${n} at ${width}px`);
    assert.ok(names.some((n) => n.startsWith("Go to a section, or search the words")), "search box");
    if (width === 390) {
      assert.ok(names.includes(`Sections in ${s.chapter.citation}`), "table-of-contents toggle");
      assert.ok(names.includes("Menu"), "menu button");
      await page.getByRole("button", { name: `Sections in ${s.chapter.citation}` }).click();
      await page.getByRole("link", { name: `${s.citation}. ${s.title}` }).first().waitFor();
    }
    assert.deepEqual(problems, []);
    await ctx.close();
  }
});

test("agents on the page: the contents page and the search page", async () => {
  {
    const { page, ctx, problems } = await open("/charter/");
    await assertNamedControls(page, "/charter/");
    assert.deepEqual(problems, []);
    await ctx.close();
  }
  {
    const word = "office";
    const { page, ctx, problems } = await open(`/search?q=${word}`);
    await page.getByRole("checkbox", { name: "Sections" }).waitFor();
    await page.getByRole("status").filter({ hasText: "results for" }).waitFor();
    const { controls } = await assertNamedControls(page, "/search");
    const names = controls.map((x) => x.name);
    for (const n of ["Charter", "Sections", "Chapters", "Go"]) assert.ok(names.includes(n), n);
    assert.ok(names.some((n) => /^page 2$|^2$/i.test(n) || /next/i.test(n)), `paging controls: ${names.join(", ")}`);
    assert.deepEqual(problems, []);
    await ctx.close();
  }
});

// One page of every kind. The search page is checked with results, filters and paging showing.
function pageTypes() {
  const s = sectionWithParts();
  return [
    ["home", "/"],
    ["contents", "/charter/"],
    ["chapter", s.chapter.path],
    ["section", s.path],
    ["shared number", site.book.shared[0].path],
    ["search", "/search?q=the"],
    ["about", "/about"],
    ["404", "/charter/sections/no-such-section"],
  ];
}

async function settle(page, path) {
  if (path.startsWith("/search")) await page.getByRole("status").filter({ hasText: "results for" }).waitFor();
}

test("agents on the page: every page type, at desktop and phone width", async () => {
  for (const [kind, path] of pageTypes()) {
    for (const width of [1200, 390]) {
      const { page, ctx, problems } = await open(path, { width });
      await settle(page, path);
      await assertNamedControls(page, `${kind} (${path}) at ${width}px`);
      // The 404 page is itself served with status 404, which Chromium logs; nothing else may fail.
      const real = kind === "404" ? problems.filter((x) => !/status of 404/.test(x)) : problems;
      assert.deepEqual(real, [], `${kind} at ${width}px`);
      await ctx.close();
    }
  }
});

test("reflow: no page scrolls sideways at 320px (WCAG 1.4.10)", async () => {
  for (const [kind, path] of pageTypes()) {
    const { page, ctx } = await open(path, { width: 320 });
    await settle(page, path);
    const [sw, cw] = await page.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.clientWidth]);
    assert.ok(sw <= cw, `${kind} (${path}) is ${sw - cw}px wider than the screen`);
    await ctx.close();
  }
});

test("forced colors: a focused search box shows a ring around the field", async () => {
  const { page, ctx } = await open("/charter/");
  await page.emulateMedia({ forcedColors: "active", colorScheme: "dark" });
  const box = page.getByRole("searchbox", { name: /Go to a section/ });
  const host = page.locator("nys-textinput#q");
  assert.equal(await host.evaluate((e) => getComputedStyle(e).outlineStyle), "none");
  await box.focus();
  const [style, width] = await host.evaluate((e) => [getComputedStyle(e).outlineStyle, getComputedStyle(e).outlineWidth]);
  assert.equal(style, "solid");
  assert.equal(width, "3px");
  await ctx.close();
});

// WCAG relative luminance and contrast, from computed "rgb(r, g, b)" colors.
function contrast(a, b) {
  const lum = (c) => {
    const [r, g, bl] = c.match(/\d+(\.\d+)?/g).slice(0, 3).map(Number).map((x) => x / 255).map((x) => (x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4));
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
  };
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}

test("search field: border 3:1 on its own background, focus ring at least 2px and 3:1", async () => {
  for (const path of ["/charter/", "/search"]) {
    const { page, ctx } = await open(path);
    const host = page.locator("nys-textinput").first();
    const read = () =>
      host.evaluate((h) => {
        const input = h.shadowRoot.querySelector("input");
        const s = getComputedStyle(input);
        // The background the field sits on: the nearest ancestor with a painted background.
        let el = h;
        let bg = "rgba(0, 0, 0, 0)";
        while (el && /rgba\(0, 0, 0, 0\)|transparent/.test(bg)) {
          bg = getComputedStyle(el).backgroundColor;
          el = el.parentElement;
        }
        return { border: s.borderTopColor, borderWidth: parseFloat(s.borderTopWidth), outline: s.outlineColor, outlineWidth: parseFloat(s.outlineWidth), outlineStyle: s.outlineStyle, fieldBg: getComputedStyle(input).backgroundColor, pageBg: bg };
      });
    const rest = await read();
    const borderRatio = contrast(rest.border, rest.pageBg);
    assert.ok(borderRatio >= 3, `${path}: field border ${rest.border} on ${rest.pageBg} is ${borderRatio.toFixed(2)}:1`);
    await page.getByRole("searchbox", { name: /Go to a section/ }).focus();
    const f = await read();
    assert.ok(f.outlineWidth >= 2 && f.outlineStyle !== "none", `${path}: focus ring ${f.outlineWidth}px`);
    for (const bg of [f.pageBg, "rgb(255, 255, 255)"]) assert.ok(contrast(f.outline, bg) >= 3, `${path}: focus ring ${f.outline} on ${bg}`);
    console.log(`# ${path}: border ${borderRatio.toFixed(2)}:1 on ${rest.pageBg}; focus ring ${f.outlineWidth}px + ${f.borderWidth}px border, ${contrast(f.outline, f.pageBg).toFixed(2)}:1`);
    await ctx.close();
  }
});

test("print: the official text and the source show their addresses", async () => {
  const s = sectionWithParts();
  const { page, ctx } = await open(s.path);
  await page.emulateMedia({ media: "print" });
  for (const sel of [".source a[href^='http']", ".copy-box a[href^='http']"]) {
    const [href, after] = await page.locator(sel).first().evaluate((a) => [a.href, getComputedStyle(a, "::after").content]);
    assert.ok(after.includes(href.replace(/\/$/, "")), `${sel}: printed ${after}`);
  }
  await page.emulateMedia({ media: "screen" });
  assert.equal(await page.locator(".source a[href^='http']").first().evaluate((a) => getComputedStyle(a, "::after").content), "none");
  await ctx.close();
});

test("the name check fails on a missing or repeated name", async () => {
  const { page, ctx } = await open("/charter/");
  await page.evaluate(() => {
    const m = document.querySelector("main");
    m.insertAdjacentHTML("beforeend", `<button type="button">Search again</button><button type="button">Search again</button><button type="button"></button><span tabindex="0">Focus me</span>`);
  });
  const c = controlProblems(parseSnapshot(await page.locator("body").ariaSnapshot()));
  assert.equal(c.duplicates.length, 1);
  assert.equal(c.unnamed.length, 1);
  const f = await focusableProblems(page);
  assert.equal(f.length, 2, f.join("\n"));
  assert.ok(f.some((x) => x.startsWith("span")) && f.some((x) => x.startsWith("button")));
  await ctx.close();
});

test("section text and the bottom box read with JavaScript off", async () => {
  const s = sectionWithParts();
  const { page, ctx } = await open(s.path, { js: false });
  const first = s.structure.blocks[0];
  await assert.doesNotReject(page.locator(`p[data-block="0"]`).waitFor({ state: "visible" }));
  assert.equal((await page.locator(`p[data-block="0"]`).innerText()).replace(/\s+/g, " ").trim(), s.text.slice(first.start, first.end));
  await page.getByText("This is BetaNYC's copy, for research.").waitFor({ state: "visible" });
  await page.getByRole("link", { name: "Read the full disclaimer" }).waitFor({ state: "visible" });
  await page.getByRole("link", { name: "Browse the Charter's contents" }).waitFor({ state: "visible" });
  // The breadcrumbs and the table of contents are plain lists.
  await page.getByRole("link", { name: s.chapter.citation, exact: true }).waitFor({ state: "visible" });
  assert.ok(await page.getByRole("link", { name: `${s.citation}. ${s.title}` }).first().isVisible());
  await ctx.close();
  const search = await open("/search?q=office", { js: false });
  await search.page.getByRole("link", { name: "Browse the Charter's contents" }).waitFor({ state: "visible" });
  await search.ctx.close();
});

test("jump: a citation goes straight to its page; a shared number shows a short list", async () => {
  const s = site.book.sections.find((x) => !site.book.shared.some((sh) => sh.sections.includes(x)) && /^§ \d+$/.test(x.citation));
  const n = s.citation.slice(2);
  for (const typed of [s.citation, n, `charter ${n}`]) {
    const { page, ctx, problems } = await open("/charter/");
    const box = page.getByRole("searchbox", { name: /Go to a section/ });
    await box.fill(typed);
    await Promise.all([page.waitForURL(`${base}${s.path}`), box.press("Enter")]);
    assert.deepEqual(problems, []);
    await ctx.close();
  }
  // With the Go button, and with a subdivision.
  const withPart = sectionWithParts();
  const part = withPart.structure.blocks.find((b) => b.anchor).anchor;
  {
    const { page, ctx } = await open("/");
    await page.getByRole("searchbox", { name: /Go to a section/ }).fill(`§ ${withPart.citation.slice(2)}${part}`);
    await Promise.all([page.waitForURL((u) => u.pathname === withPart.path), page.getByRole("button", { name: "Go" }).click()]);
    assert.equal(decodeURIComponent(new URL(page.url()).hash.slice(1)), part);
    await ctx.close();
  }
  // Two sections numbered § 530.
  {
    const { page, ctx, problems } = await open("/search?q=530");
    const shared = site.book.shared.find((x) => x.citation === "§ 530");
    for (const x of shared.sections) await page.getByRole("link", { name: `NYC Charter ${x.citation}. ${x.title}` }).waitFor();
    assert.deepEqual(problems, []);
    await ctx.close();
  }
});

test("word search: book, citation, heading, highlighted snippet, sub-results, paging, filters", async () => {
  const { page, ctx, problems } = await open("/search?q=the");
  const status = page.getByRole("status").filter({ hasText: "results for" });
  await status.waitFor();
  const text = await status.innerText();
  const total = Number(/^(\d+) results/.exec(text)[1]);
  assert.ok(total > 10, text);
  assert.match(text, /Showing 1 to 10\./);
  const hits = page.locator("ol.hits > li.hit");
  assert.equal(await hits.count(), 10);
  const first = hits.first();
  assert.equal(await first.locator(".badge").textContent(), "NYC Charter");
  assert.match(await first.locator("h2 a").innerText(), /^(§ \S+|Chapter \S+|Preamble|Introductory)\. /);
  assert.ok((await first.locator("mark").count()) > 0, "highlighted snippet");
  assert.doesNotMatch(await first.locator("h2 a").getAttribute("href"), /\.html/);
  // Sub-results link to a subdivision.
  assert.ok((await page.locator("ul.subs a[href*='#(']").count()) > 0, "sub-results per subdivision");
  // Page 2.
  await page.getByRole("button", { name: /^(page )?2$/i }).first().click();
  await page.getByRole("status").filter({ hasText: "Showing 11 to 20." }).waitFor();
  assert.match(page.url(), /page=2/);
  // Filter: sections only.
  await page.getByRole("checkbox", { name: "Chapters" }).click();
  await page.waitForURL(/kind=Section/);
  await page.getByRole("status").filter({ hasText: "Showing 1 to" }).waitFor();
  const kinds = await page.locator("ol.hits .where").allInnerTexts();
  assert.ok(kinds.length > 0 && kinds.every((k) => /Section/i.test(k)), kinds.join(","));
  assert.deepEqual(problems, []);
  await ctx.close();
});

test("copy citation, print stylesheet, skip link", async () => {
  const s = sectionWithParts();
  const { page, ctx, problems } = await open(s.path, { ctxOpts: { permissions: ["clipboard-read", "clipboard-write"] } });
  await page.keyboard.press("Tab");
  assert.equal(await page.evaluate(() => document.activeElement?.textContent), "Skip to main content");
  await page.getByRole("button", { name: "Copy citation" }).click();
  await page.getByRole("status").filter({ hasText: "Copied the citation" }).waitFor();
  assert.equal(await page.evaluate(() => navigator.clipboard.readText()), s.fullCitation);
  await page.emulateMedia({ media: "print" });
  assert.equal(await page.locator(".toc").isVisible(), false);
  assert.equal(await page.locator(".site-bar").isVisible(), false);
  assert.equal(await page.locator(".copy-box").isVisible(), true);
  assert.equal(await page.locator(".law").isVisible(), true);
  assert.deepEqual(problems, []);
  await ctx.close();
});

test("an American Legal id in the address lands on its page", async () => {
  const s = sectionWithParts();
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.goto(`${base}/charter/${s.id}`);
  await page.waitForURL(`${base}${s.path}`);
  await page.goto(`${base}/charter/sections/does-not-exist`);
  await page.getByRole("heading", { name: "Page not found" }).waitFor();
  await ctx.close();
});

test("nothing loads from outside the site", () => {
  assert.deepEqual([...new Set(outside)], []);
});
