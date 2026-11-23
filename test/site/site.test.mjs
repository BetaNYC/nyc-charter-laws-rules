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
    for (const n of ["Copy link", "Copy citation", "Print"]) assert.ok(names.includes(n), `${n} at ${width}px`);
    // No search box on a law page (Noel, 2026-11-23): the top bar's Search link goes to it.
    assert.ok(!names.includes("Go") && !names.some((n) => n.startsWith("Go to a section")), `no search box at ${width}px`);
    if (width === 390) {
      assert.ok(names.includes("Charter chapters"), "the side list's button");
      assert.ok(names.includes("Menu"), "menu button");
      await page.getByRole("button", { name: "Charter chapters" }).click();
      await page.getByRole("link", { name: `${s.citation}. ${s.title}` }).first().waitFor();
      // Open, the list's links still have their own names.
      await assertNamedControls(page, `${s.path} at ${width}px, side list open`);
    } else {
      assert.ok(!names.includes("Charter chapters"), "no button on a wide screen");
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
  const { page, ctx } = await open("/");
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
  for (const path of ["/", "/search"]) {
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
  // No search box on a law page, so no "search needs JavaScript" line either; the top bar links to the contents.
  await page.getByRole("navigation", { name: "Site" }).getByRole("link", { name: "Charter", exact: true }).waitFor({ state: "visible" });
  // The breadcrumbs and the table of contents are plain lists.
  await page.getByRole("link", { name: s.chapter.citation, exact: true }).waitFor({ state: "visible" });
  assert.ok(await page.getByRole("link", { name: `${s.citation}. ${s.title}` }).first().isVisible());
  await ctx.close();
  for (const path of ["/search?q=office", "/"]) {
    const other = await open(path, { js: false });
    await other.page.getByRole("link", { name: "Browse the Charter's contents" }).waitFor({ state: "visible" });
    await other.ctx.close();
  }
});

test("jump: a citation goes straight to its page; a shared number shows a short list", async () => {
  const s = site.book.sections.find((x) => !site.book.shared.some((sh) => sh.sections.includes(x)) && /^§ \d+$/.test(x.citation));
  const n = s.citation.slice(2);
  for (const typed of [s.citation, n, `charter ${n}`]) {
    const { page, ctx, problems } = await open("/");
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

// Noel, 2026-11-23: the side list shows the whole Charter, with the reader's chapter open.
test("side list: every chapter, the current one open, the current section marked", async () => {
  const s = sectionWithParts();
  const { page, ctx, problems } = await open(s.path, { width: 1200 });
  const nav = page.getByRole("navigation", { name: "Charter chapters" });
  assert.equal(await nav.count(), 1, "one side list, named");
  // A visible heading and no fold on a wide screen (Noel, 2026-11-23: say what the list is).
  const heading = page.getByRole("heading", { name: "Charter chapters", level: 2 });
  assert.equal(await heading.count(), 1);
  assert.ok(await heading.isVisible());
  // In the template's heading font and blue.
  const [font, color, headFont, blue] = await heading.evaluate((h) => {
    const probe = document.createElement("span");
    probe.style.cssText = "font-family: var(--font-head); color: var(--blue)";
    document.body.appendChild(probe);
    const p = getComputedStyle(probe);
    const out = [getComputedStyle(h).fontFamily, getComputedStyle(h).color, p.fontFamily, p.color];
    probe.remove();
    return out;
  });
  assert.deepEqual([font, color], [headFont, blue]);
  assert.equal(await page.getByRole("button", { name: "Charter chapters" }).count(), 0);
  // The links are NYSDS's slotted children, so they are found under .toc, not under the <nav> in its shadow root.
  for (const c of site.book.chapters) {
    const name = c.title === c.citation ? c.title : `${c.citation}: ${c.title}`;
    assert.equal(await page.locator(".toc").getByRole("link", { name, exact: true }).getAttribute("href"), c.path, name);
  }
  const chapterLink = page.locator(`.toc a[href="${s.chapter.path}"]`);
  assert.equal(await chapterLink.getAttribute("aria-current"), "true");
  const own = page.locator('.toc a[aria-current="page"]');
  assert.equal(await own.count(), 1);
  assert.equal(await own.getAttribute("href"), s.path);
  assert.ok(await own.isVisible());
  // Only the open chapter shows its sections.
  const sectionLinks = await page.locator('.toc a[href^="/charter/sections/"]').evaluateAll((as) => as.map((a) => a.getAttribute("href")));
  assert.deepEqual(sectionLinks, s.chapter.sections.map((x) => x.path));
  // The open chapter is marked by more than color: bold.
  assert.equal(await chapterLink.evaluate((a) => getComputedStyle(a).fontWeight), "700");
  assert.deepEqual(problems, []);
  await ctx.close();
  // A chapter page: the same list, with that chapter open and current.
  {
    const { page, ctx } = await open(s.chapter.path, { width: 1200 });
    const own = page.locator('.toc a[aria-current="page"]');
    assert.equal(await own.count(), 1);
    assert.equal(await own.getAttribute("href"), s.chapter.path);
    assert.equal(await page.locator('.toc a[href^="/charter/sections/"]').count(), s.chapter.sections.length);
    await ctx.close();
  }
});

test("side list on a phone: one named button, closed, above the breadcrumbs, one tab stop", async () => {
  const s = sectionWithParts();
  const { page, ctx, problems } = await open(s.path, { width: 390 });
  const button = page.getByRole("button", { name: "Charter chapters" });
  assert.equal(await button.count(), 1);
  assert.equal(await button.getAttribute("aria-expanded"), "false", "closed by default");
  assert.equal(await page.locator(`.toc a[href="${s.chapter.path}"]`).isVisible(), false, "chapter links hidden while closed");
  assert.equal(await page.locator(".toc-h").isVisible(), false, "the button is the heading on a phone");
  // The button is above the breadcrumbs, the heading and the law text (Noel, 2026-11-23).
  const top = async (loc) => (await loc.boundingBox()).y;
  const buttonTop = await top(button);
  for (const sel of [".crumbs", "h1", ".law"]) assert.ok(buttonTop < (await top(page.locator(sel).first())), `button above ${sel}`);
  // One tab stop: from the menu button, Tab lands on it, and the next Tab is the first crumb.
  await page.getByRole("button", { name: "Menu" }).focus();
  await page.keyboard.press("Tab");
  assert.equal(await page.evaluate(() => { let a = document.activeElement; while (a?.shadowRoot?.activeElement) a = a.shadowRoot.activeElement; return a?.getAttribute("aria-expanded") !== null && a?.textContent.trim(); }), "Charter chapters");
  await page.keyboard.press("Tab");
  assert.equal(await page.evaluate(() => document.activeElement?.textContent), "Home");
  await button.click();
  assert.equal(await button.getAttribute("aria-expanded"), "true");
  await page.locator('.toc a[aria-current="page"]').waitFor({ state: "visible" });
  assert.deepEqual(problems, []);
  await ctx.close();
});

test("side list with JavaScript off: a plain list of every chapter, the current one open", async () => {
  const s = sectionWithParts();
  for (const width of [1200, 390]) {
    const { page, ctx } = await open(s.path, { width, js: false });
    const links = page.locator(".toc a");
    const top = await page.locator(".toc nys-verticalnav > ul > li > a").evaluateAll((as) => as.map((a) => a.getAttribute("href")));
    assert.deepEqual(top, site.book.chapters.map((c) => c.path), `${width}px: every chapter`);
    assert.equal(await links.count(), site.book.chapters.length + s.chapter.sections.length);
    assert.ok(await page.locator('.toc a[aria-current="page"]').isVisible(), `${width}px: current section shown`);
    assert.equal(await page.locator(`.toc a[href="${s.chapter.path}"]`).getAttribute("aria-current"), "true");
    await ctx.close();
  }
});

test("skip link: straight to the law text, past the side list", async () => {
  const s = sectionWithParts();
  const { page, ctx } = await open(s.path, { width: 1200 });
  await page.keyboard.press("Tab");
  assert.equal(await page.evaluate(() => document.activeElement?.textContent), "Skip to main content");
  await page.keyboard.press("Enter");
  assert.equal(new URL(page.url()).hash, "#main");
  await page.keyboard.press("Tab");
  const where = await page.evaluate(() => ({ inMain: !!document.activeElement?.closest("main"), inList: !!document.activeElement?.closest(".toc") }));
  assert.deepEqual(where, { inMain: true, inList: false });
  // In the page the list comes before main (navigation at the top); the skip link passes it.
  assert.ok(await page.evaluate(() => document.querySelector(".toc").compareDocumentPosition(document.querySelector("main")) & Node.DOCUMENT_POSITION_FOLLOWING));
  await ctx.close();
});

test("side list scrolls itself, not the page, to the open chapter", async () => {
  // A short window, so the list scrolls even with the fixtures' chapters.
  const s = site.book.sections.filter((x) => x.chapter === site.book.chapters.at(-1)).at(0) ?? site.book.sections.at(-1);
  const ctx = await browser.newContext({ viewport: { width: 1200, height: 420 } });
  const page = await ctx.newPage();
  await page.goto(base + s.path, { waitUntil: "networkidle" });
  await page.waitForFunction(() => document.querySelector(".toc").scrollTop > 0);
  const r = await page.evaluate((path) => {
    const toc = document.querySelector(".toc");
    const a = toc.querySelector(`a[href="${path}"]`).getBoundingClientRect();
    const t = toc.getBoundingClientRect();
    return { pageY: window.scrollY, inView: a.top >= t.top && a.bottom <= t.bottom };
  }, s.chapter.path);
  assert.deepEqual(r, { pageY: 0, inView: true });
  await ctx.close();
});

test("the law text is in the body font, on screen and in print", async () => {
  const s = sectionWithParts();
  const { page, ctx } = await open(s.path);
  const fonts = () => page.evaluate(() => ({ law: getComputedStyle(document.querySelector(".law p")).fontFamily, body: getComputedStyle(document.body).fontFamily, list: getComputedStyle(document.querySelector(".toc a")).fontFamily }));
  const screen = await fonts();
  assert.equal(screen.law, screen.body);
  assert.equal(screen.list, screen.body);
  assert.doesNotMatch(screen.law, /Georgia|Times|(?:^|, )serif$/);
  // Lines stay readable: no more than about 75 characters, and a line height of at least 1.5.
  const m = await page.evaluate(() => {
    const p = document.querySelector(".law");
    const cs = getComputedStyle(p);
    const probe = document.createElement("span");
    probe.textContent = "0".repeat(100);
    probe.style.cssText = "position:absolute;visibility:hidden;white-space:nowrap";
    p.appendChild(probe);
    const ch = probe.getBoundingClientRect().width / 100;
    probe.remove();
    return { chars: p.getBoundingClientRect().width / ch, lineHeight: parseFloat(cs.lineHeight) / parseFloat(cs.fontSize) };
  });
  assert.ok(m.chars <= 75, `${m.chars.toFixed(1)} characters a line`);
  assert.ok(m.lineHeight >= 1.5, `line height ${m.lineHeight}`);
  await page.emulateMedia({ media: "print" });
  const print = await fonts();
  assert.equal(print.law, print.body, "print");
  await ctx.close();
});

// Noel, 2026-11-23 (option A): the search box only on the home page and the search page.
test("search box: only on the home and search pages, named, with its hint as placeholder text", async () => {
  const s = sectionWithParts();
  const without = [["contents", "/charter/"], ["chapter", s.chapter.path], ["section", s.path], ["shared number", site.book.shared[0].path], ["about", "/about"], ["404", "/charter/sections/no-such-section"]];
  for (const [kind, path] of without) {
    const { page, ctx } = await open(path);
    assert.equal(await page.locator("nys-textinput, form.jump, .find").count(), 0, `${kind}: no search box`);
    assert.equal(await page.getByRole("searchbox").count(), 0, `${kind}: no searchbox in the tree`);
    // Search is still one link away, in the top bar.
    assert.equal(await page.locator("#site-menu").getByRole("link", { name: "Search", exact: true }).getAttribute("href"), "/search", kind);
    await ctx.close();
  }
  // In the phone menu too.
  {
    const { page, ctx } = await open(s.path, { width: 390 });
    await page.getByRole("button", { name: "Menu" }).click();
    await page.locator("#site-menu").getByRole("link", { name: "Search", exact: true }).waitFor({ state: "visible" });
    await ctx.close();
  }
  for (const path of ["/", "/search"]) {
    const { page, ctx } = await open(path);
    const box = page.getByRole("searchbox");
    assert.equal(await box.count(), 1, `${path}: one search box`);
    assert.equal(await page.getByRole("searchbox", { name: "Go to a section, or search the words", exact: true }).count(), 1, `${path}: named by its label, not its placeholder`);
    const r = await page.locator("nys-textinput").evaluate((h) => {
      const input = h.shadowRoot.querySelector("input");
      // Any CSS color as "rgb(r, g, b)", through a canvas (Chromium reports color-mix() results as color(srgb ...)).
      const rgb = (c) => {
        const cx = Object.assign(document.createElement("canvas"), { width: 1, height: 1 }).getContext("2d");
        cx.fillStyle = c;
        cx.fillRect(0, 0, 1, 1);
        const [r, g, b] = cx.getImageData(0, 0, 1, 1).data;
        return `rgb(${r}, ${g}, ${b})`;
      };
      // The background behind the text: the nearest painted box, across the shadow boundary.
      let el = input;
      let bg = "rgba(0, 0, 0, 0)";
      while (el && /rgba\(0, 0, 0, 0\)|transparent/.test(bg)) {
        bg = getComputedStyle(el).backgroundColor;
        el = el.parentElement ?? el.getRootNode().host;
      }
      return { placeholder: input.placeholder, color: rgb(getComputedStyle(input, "::placeholder").color), typed: rgb(getComputedStyle(input).color), bg: rgb(bg), description: h.shadowRoot.textContent.includes("Try ") };
    });
    assert.equal(r.placeholder, 'Try "§ 259", "259" or "budget office"');
    assert.equal(r.description, false, `${path}: no separate hint line`);
    const ratio = contrast(r.color, r.bg);
    assert.ok(ratio >= 4.5, `${path}: placeholder ${r.color} on ${r.bg} is ${ratio.toFixed(2)}:1`);
    assert.notEqual(r.color, r.typed, `${path}: placeholder lighter than typed text`);
    console.log(`# ${path}: placeholder ${ratio.toFixed(2)}:1 on ${r.bg}`);
    await ctx.close();
  }
  // The search page still takes ?q= and jumps a citation.
  {
    const target = site.book.sections.find((x) => !site.book.shared.some((sh) => sh.sections.includes(x)) && /^§ \d+$/.test(x.citation));
    const { page, ctx, problems } = await open(`/search?q=${encodeURIComponent("budget")}`);
    await page.getByRole("status").filter({ hasText: "results for" }).waitFor();
    const box = page.getByRole("searchbox", { name: /Go to a section/ });
    await box.fill(target.citation);
    await Promise.all([page.waitForURL(`${base}${target.path}`), box.press("Enter")]);
    assert.deepEqual(problems, []);
    await ctx.close();
  }
});

// Noel, 2026-11-23: the first crumb is "Home", and the trail lines up with the heading.
test("breadcrumbs: Home first, flush with the heading", async () => {
  const s = sectionWithParts();
  for (const [path, width, js] of [[s.path, 1280, true], [s.path, 1920, true], [s.path, 1024, true], [s.path, 390, true], [s.chapter.path, 1440, true], [s.path, 1280, false]]) {
    const { page, ctx } = await open(path, { width, js });
    const first = page.locator(".crumbs a").first();
    assert.equal(await first.textContent(), "Home", `${path} at ${width}px`);
    assert.equal(await first.getAttribute("href"), "/");
    const [crumbLeft, headingLeft] = await page.evaluate(() => {
      const a = document.querySelector(".crumbs a");
      const r = document.createRange();
      r.selectNodeContents(a);
      return [r.getBoundingClientRect().left, document.querySelector("h1").getBoundingClientRect().left];
    });
    assert.ok(Math.abs(crumbLeft - headingLeft) < 1, `${path} at ${width}px${js ? "" : ", JavaScript off"}: crumbs at ${crumbLeft}px, heading at ${headingLeft}px`);
    await ctx.close();
  }
});

test("reflow: no law page scrolls sideways, from 320px to 1920px", async () => {
  const s = sectionWithParts();
  const pages = [s.path, s.chapter.path, site.book.chapters[0].path, site.book.shared[0].path];
  for (const width of [320, 390, 1024, 1280, 1440, 1920]) {
    for (const path of pages) {
      const { page, ctx } = await open(path, { width });
      const r = await page.evaluate(() => {
        const law = document.querySelector(".law, main");
        return { sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth, lawRight: law.getBoundingClientRect().right };
      });
      assert.ok(r.sw <= r.cw, `${path} at ${width}px is ${r.sw - r.cw}px wider than the window`);
      assert.ok(r.lawRight <= r.cw - 16, `${path} at ${width}px: the text runs to ${r.lawRight}px of ${r.cw}px`);
      await ctx.close();
    }
  }
});

test("nothing loads from outside the site", () => {
  assert.deepEqual([...new Set(outside)], []);
});
