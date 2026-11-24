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
import { chapterName } from "../../scripts/lib/site/pages.js";

/** "☰ Contents", the bar above the breadcrumbs: its name is "Contents", then the reader's chapter. */
const CONTENTS_BUTTON = /^Contents(, |$)/;

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
      assert.ok(names.includes(`Contents, ${chapterName(s.chapter)}`), "the Contents bar, naming the chapter");
      assert.ok(names.includes("Menu"), "menu button");
      assert.ok(!names.includes("Hide contents"), "the tree is closed");
      await page.getByRole("button", { name: CONTENTS_BUTTON }).click();
      await page.getByRole("link", { name: `${s.citation}. ${s.title}` }).first().waitFor();
      // Open, every control still has its own name: one button per chapter, named for it.
      const open = (await assertNamedControls(page, `${s.path} at ${width}px, tree open`)).controls.map((x) => x.name);
      assert.ok(open.includes("Hide contents"));
      for (const c of site.book.chapters.filter((x) => x.sections.length)) assert.ok(open.includes(`Sections in ${chapterName(c)}`), `${c.citation}'s button`);
    } else {
      assert.ok(!names.some((n) => CONTENTS_BUTTON.test(n)), "no Contents button while the tree shows");
      assert.ok(names.includes("Hide contents"), "Hide");
      assert.ok(names.includes(`Sections in ${chapterName(s.chapter)}`), "the open chapter's button");
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
    // Two § 530s in one chapter: their copies' controls must not share names.
    ["chapter with a shared number", site.book.shared[0].sections[0].chapter.path],
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

test("print: the official text shows its address", async () => {
  const s = sectionWithParts();
  const { page, ctx } = await open(s.path);
  await page.emulateMedia({ media: "print" });
  const sel = ".copy-box a[href^='http']";
  const [href, after] = await page.locator(sel).first().evaluate((a) => [a.href, getComputedStyle(a, "::after").content]);
  assert.ok(after.includes(href.replace(/\/$/, "")), `${sel}: printed ${after}`);
  await page.emulateMedia({ media: "screen" });
  assert.equal(await page.locator(sel).first().evaluate((a) => getComputedStyle(a, "::after").content), "none");
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
  await page.getByText("BetaNYC modified this text. It is not legal advice.").waitFor({ state: "visible" });
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

// Noel, 2026-11-23: the contents tree, after American Legal Publishing's code library. Every
// chapter, the reader's chapter open, a disclosure button per chapter, "Hide" and "☰ Contents".
test("contents tree: every chapter, the current one open, the current section marked", async () => {
  const s = sectionWithParts();
  const { page, ctx, problems } = await open(s.path, { width: 1200 });
  const nav = page.getByRole("navigation", { name: "Contents", exact: true });
  assert.equal(await nav.count(), 1, "one tree, named by its heading");
  const heading = nav.getByRole("heading", { name: "Contents", level: 2 });
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
  assert.equal(await nav.getByRole("link", { name: "New York City Charter", exact: true }).getAttribute("href"), "/charter/");
  for (const c of site.book.chapters) {
    const link = nav.getByRole("link", { name: chapterName(c), exact: true });
    assert.equal(await link.getAttribute("href"), c.path, chapterName(c));
    // Underlined links, as in American Legal's tree.
    if (c !== s.chapter) assert.match(await link.evaluate((a) => getComputedStyle(a).textDecorationLine), /underline/);
    // A disclosure button before every chapter that has sections, named for its chapter.
    const button = nav.getByRole("button", { name: `Sections in ${chapterName(c)}`, exact: true });
    assert.equal(await button.count(), c.sections.length ? 1 : 0, chapterName(c));
    if (!c.sections.length) continue;
    assert.equal(await button.getAttribute("aria-expanded"), String(c === s.chapter));
    const controls = await button.getAttribute("aria-controls");
    assert.equal(await page.locator(`[id="${controls}"]`).count(), 1, `${chapterName(c)}: aria-controls names a list`);
    assert.ok(await button.evaluate((b, id) => b.parentElement.contains(document.getElementById(id)), controls), `${chapterName(c)}: the list is in the chapter's item`);
  }
  const chapterLink = page.locator(`.toc a[href="${s.chapter.path}"]`);
  assert.equal(await chapterLink.getAttribute("aria-current"), "true");
  assert.equal(await chapterLink.evaluate((a) => getComputedStyle(a).fontWeight), "700", "the open chapter is bold, not only colored");
  const own = page.locator('.toc a[aria-current="page"]');
  assert.equal(await own.count(), 1);
  assert.equal(await own.getAttribute("href"), s.path);
  assert.ok(await own.isVisible());
  // Only the open chapter's sections, until another is opened.
  const sectionLinks = await page.locator('.toc a[href^="/charter/sections/"]').evaluateAll((as) => as.map((a) => a.getAttribute("href")));
  assert.deepEqual(sectionLinks, s.chapter.sections.map((x) => x.path));
  assert.deepEqual(problems, []);
  await ctx.close();
  // A chapter page: the same tree, with that chapter open and current.
  {
    const { page, ctx } = await open(s.chapter.path, { width: 1200 });
    const own = page.locator('.toc a[aria-current="page"]');
    assert.equal(await own.count(), 1);
    assert.equal(await own.getAttribute("href"), s.chapter.path);
    assert.equal(await page.locator('.toc li.open > ul a').count(), s.chapter.sections.length);
    await ctx.close();
  }
});

test("contents tree: a chapter's button opens and closes it from the keyboard, loading only that chapter's list", async () => {
  const s = sectionWithParts();
  const other = site.book.chapters.find((c) => c !== s.chapter && c.sections.length >= 2);
  const { page, ctx, problems } = await open(s.path, { width: 1200 });
  const loaded = [];
  page.on("request", (r) => r.url().includes("/contents/") && loaded.push(new URL(r.url()).pathname));
  const button = page.getByRole("button", { name: `Sections in ${chapterName(other)}`, exact: true });
  const list = page.locator(`[id="${await button.getAttribute("aria-controls")}"]`);
  assert.equal(await list.isVisible(), false);
  // Enter opens.
  await button.focus();
  await page.keyboard.press("Enter");
  await list.getByRole("link").first().waitFor();
  assert.equal(await button.getAttribute("aria-expanded"), "true");
  assert.deepEqual(await list.getByRole("link").evaluateAll((as) => as.map((a) => [a.getAttribute("href"), a.textContent])), other.sections.map((x) => [x.path, `${x.citation}. ${x.title}`]));
  assert.deepEqual(loaded, [`/charter/contents/${other.slug}.json`], "one small file, for that chapter");
  // Space closes, and focus stays on the button.
  await page.keyboard.press("Space");
  assert.equal(await button.getAttribute("aria-expanded"), "false");
  assert.equal(await list.isVisible(), false);
  assert.equal(await page.evaluate(() => document.activeElement.classList.contains("tw")), true);
  // Opened again, it does not load again.
  await page.keyboard.press("Enter");
  assert.ok(await list.isVisible());
  assert.equal(loaded.length, 1);
  // The open chapter closes too, with its list in the page.
  const mine = page.getByRole("button", { name: `Sections in ${chapterName(s.chapter)}`, exact: true });
  await mine.click();
  assert.equal(await mine.getAttribute("aria-expanded"), "false");
  assert.equal(await page.locator('.toc a[aria-current="page"]').isVisible(), false);
  // Tab order: the button, then its chapter's link.
  await button.focus();
  await page.keyboard.press("Tab");
  assert.equal(await page.evaluate(() => document.activeElement.getAttribute("href")), other.path);
  assert.deepEqual(problems, []);
  await ctx.close();
});

test("contents tree: a list that will not load says so and links to the chapter", async () => {
  const s = sectionWithParts();
  const other = site.book.chapters.find((c) => c !== s.chapter && c.sections.length);
  const ctx = await browser.newContext({ viewport: { width: 1200, height: 900 } });
  await ctx.route("**/contents/*.json", (r) => r.fulfill({ status: 500, body: "" }));
  const page = await ctx.newPage();
  await page.goto(base + s.path, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: `Sections in ${chapterName(other)}`, exact: true }).click();
  const link = page.getByRole("link", { name: `Open ${chapterName(other)}`, exact: true });
  await link.waitFor();
  assert.equal(await link.getAttribute("href"), other.path);
  await ctx.close();
});

test("Hide and Contents: the tree folds away on a wide screen, is remembered, and comes back", async () => {
  const s = sectionWithParts();
  const { page, ctx, problems } = await open(s.path, { width: 1200 });
  const hide = page.getByRole("button", { name: "Hide contents", exact: true });
  const show = page.getByRole("button", { name: CONTENTS_BUTTON });
  assert.equal(await show.count(), 0, "no Contents button while the tree shows");
  const textWidth = () => page.locator("main").evaluate((m) => m.getBoundingClientRect().width);
  const before = await textWidth();
  await hide.click();
  assert.equal(await page.locator(".toc").isVisible(), false);
  assert.equal(await show.getAttribute("aria-expanded"), "false");
  assert.equal(await page.evaluate(() => document.activeElement.classList.contains("contents-open")), true, "focus moves to Contents");
  assert.ok((await textWidth()) > before + 200, "the page takes the tree's column");
  // The next page opens the same way.
  await page.goto(base + s.chapter.path, { waitUntil: "networkidle" });
  assert.equal(await page.locator(".toc").isVisible(), false, "remembered");
  await show.click();
  assert.ok(await page.locator(".toc").isVisible());
  assert.equal(await page.evaluate(() => document.activeElement.classList.contains("contents-hide")), true, "focus moves to Hide");
  await page.goto(base + s.path, { waitUntil: "networkidle" });
  assert.ok(await page.locator(".toc").isVisible(), "shown again on the next page");
  assert.deepEqual(problems, []);
  await ctx.close();
});

test("contents on a phone: one Contents button, closed, above the breadcrumbs, one tab stop", async () => {
  const s = sectionWithParts();
  const { page, ctx, problems } = await open(s.path, { width: 390 });
  const button = page.getByRole("button", { name: CONTENTS_BUTTON });
  assert.equal(await button.count(), 1);
  assert.equal(await page.getByRole("button", { name: `Contents, ${chapterName(s.chapter)}`, exact: true }).count(), 1, "a \"you are here\" bar naming the chapter");
  assert.equal(await button.getAttribute("aria-expanded"), "false", "closed by default");
  assert.equal(await page.locator(`.toc a[href="${s.chapter.path}"]`).isVisible(), false, "chapter links hidden while closed");
  // With scripts the fold is open and its summary gone: the button is the one control.
  assert.equal(await page.locator(".toc details").getAttribute("open"), "");
  assert.equal(await page.locator(".toc summary").isVisible(), false, "no summary beside the button");
  // The button is above the breadcrumbs, the heading and the law text (Noel, 2026-11-23).
  const top = async (loc) => (await loc.boundingBox()).y;
  const buttonTop = await top(button);
  for (const sel of [".crumbs", "h1", ".law"]) assert.ok(buttonTop < (await top(page.locator(sel).first())), `button above ${sel}`);
  // One tab stop: from the menu button, Tab lands on it, and the next Tab is the first crumb.
  await page.getByRole("button", { name: "Menu" }).focus();
  await page.keyboard.press("Tab");
  assert.equal(await page.evaluate(() => document.activeElement?.classList.contains("contents-open")), true);
  await page.keyboard.press("Tab");
  assert.equal(await page.evaluate(() => document.activeElement?.textContent), "Home");
  // Open: the tree above the page, focus on Hide; Hide closes it and focus returns.
  await button.click();
  await page.locator('.toc a[aria-current="page"]').waitFor({ state: "visible" });
  assert.equal(await page.evaluate(() => document.activeElement.classList.contains("contents-hide")), true);
  assert.ok((await top(page.locator(".toc"))) < (await top(page.locator(".crumbs"))));
  await page.getByRole("button", { name: "Hide contents" }).click();
  assert.equal(await page.locator(".toc").isVisible(), false);
  assert.equal(await page.evaluate(() => document.activeElement.classList.contains("contents-open")), true);
  assert.equal(await button.getAttribute("aria-expanded"), "false");
  assert.deepEqual(problems, []);
  await ctx.close();
});

test("contents with JavaScript off: a plain list of every chapter, the current one open, no buttons; folded on a phone", async () => {
  const s = sectionWithParts();
  for (const width of [1200, 390]) {
    const { page, ctx } = await open(s.path, { width, js: false });
    const top = await page.locator(".toc .tree > li > a").evaluateAll((as) => as.map((a) => a.getAttribute("href")));
    assert.deepEqual(top, site.book.chapters.map((c) => c.path), `${width}px: every chapter`);
    assert.equal(await page.locator(".toc a").count(), 1 + site.book.chapters.length + s.chapter.sections.length);
    assert.equal(await page.getByRole("button").count(), 0, `${width}px: no buttons that need scripts`);
    const summary = page.locator(".toc summary");
    if (width === 390) {
      // Code review S3: closed, one line, which opens to the same list.
      assert.ok(await summary.isVisible(), "the fold's summary");
      assert.equal((await summary.innerText()).replace(/\s+/g, " ").trim(), "☰ Contents");
      assert.equal(await page.locator('.toc a[aria-current="page"]').isVisible(), false, "closed by default");
      await summary.click();
    } else {
      assert.equal(await summary.isVisible(), false, "no fold on a wide screen");
      assert.ok(await page.getByRole("heading", { name: "Contents", level: 2 }).isVisible(), "the heading");
    }
    assert.ok(await page.locator('.toc a[aria-current="page"]').isVisible(), `${width}px: current section shown`);
    assert.equal(await page.locator(`.toc a[href="${s.chapter.path}"]`).getAttribute("aria-current"), "true");
    // The chapter links still work.
    const other = site.book.chapters.find((c) => c !== s.chapter);
    await Promise.all([page.waitForURL(`${base}${other.path}`), page.locator(`.toc a[href="${other.path}"]`).click()]);
    await ctx.close();
  }
});

// Code review S3: with the whole list open, a phone with JavaScript off reached the law text
// about 5,000px down. Folded, the heading and the text start within the first screen; on a
// chapter page, the jump list does (Noel, 2026-11-23).
test("phone: the heading and the text, or the chapter's jump list, start near the top", async () => {
  const s = sectionWithParts();
  for (const js of [false, true]) {
    for (const path of [s.path, s.chapter.path]) {
      const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, javaScriptEnabled: js });
      const page = await ctx.newPage();
      await page.goto(base + path, { waitUntil: "networkidle" });
      const r = await page.evaluate(() => ({
        h1: document.querySelector("h1").getBoundingClientRect().top + scrollY,
        law: (document.querySelector(".jump li, .law p") ?? document.querySelector("main p")).getBoundingClientRect().top + scrollY,
      }));
      assert.ok(r.h1 < 400, `${path}${js ? "" : ", JavaScript off"}: the heading starts at ${r.h1}px`);
      assert.ok(r.law < 600, `${path}${js ? "" : ", JavaScript off"}: the text or jump list starts at ${r.law}px`);
      await ctx.close();
    }
  }
});

test("skip link: straight to the law text, past the contents", async () => {
  const s = sectionWithParts();
  const { page, ctx } = await open(s.path, { width: 1200 });
  await page.keyboard.press("Tab");
  assert.equal(await page.evaluate(() => document.activeElement?.textContent), "Skip to main content");
  await page.keyboard.press("Enter");
  assert.equal(new URL(page.url()).hash, "#main");
  await page.keyboard.press("Tab");
  const where = await page.evaluate(() => ({ inMain: !!document.activeElement?.closest("main"), inList: !!document.activeElement?.closest(".toc") }));
  assert.deepEqual(where, { inMain: true, inList: false });
  // In the page the tree comes before main (navigation at the top); the skip link passes it.
  assert.ok(await page.evaluate(() => document.querySelector(".toc").compareDocumentPosition(document.querySelector("main")) & Node.DOCUMENT_POSITION_FOLLOWING));
  await ctx.close();
});

// Where a link sits in the tree: in view means below the sticky heading row and above the tree's bottom edge.
function placeInList(href) {
  const toc = document.querySelector(".toc");
  const a = (href ? toc.querySelector(`a[href="${href}"]`) : document.activeElement).getBoundingClientRect();
  const t = toc.getBoundingClientRect();
  const h = toc.querySelector(".contents-top").getBoundingClientRect();
  return { pageY: window.scrollY, inView: a.top >= h.bottom - 0.5 && a.bottom <= t.bottom + 0.5, covered: Math.max(0, Math.min(a.bottom, h.bottom) - a.top) };
}

test("contents tree scrolls itself, not the page, to the reader's own section, or else the open chapter", async () => {
  // A short window, so the tree scrolls even with the fixtures' chapters.
  const deepest = [...site.book.chapters].sort((a, b) => b.sections.length - a.sections.length)[0];
  const cases = [
    // Code review S1: the last section of the fixtures' longest chapter (Chapter 10, 36 sections),
    // so the chapter link is in view while the section link is far below it.
    { path: deepest.sections.at(-1).path, own: deepest.sections.at(-1).path, label: `${deepest.sections.at(-1).citation}, last of ${deepest.sections.length} in ${deepest.citation}` },
    { path: site.book.chapters.at(-1).path, own: site.book.chapters.at(-1).path, label: "the last chapter's own page" },
  ];
  assert.ok(deepest.sections.length >= 30, `${deepest.citation} has ${deepest.sections.length} sections`);
  for (const c of cases) {
    const ctx = await browser.newContext({ viewport: { width: 1200, height: 420 } });
    const page = await ctx.newPage();
    await page.goto(base + c.path, { waitUntil: "networkidle" });
    await page.waitForFunction(() => document.querySelector(".toc").scrollTop > 0);
    await page.waitForTimeout(100);
    const r = await page.evaluate(placeInList, c.own);
    assert.equal(r.pageY, 0, `${c.label}: the page did not scroll`);
    assert.ok(r.inView, `${c.label}: the reader's own link is in view, below the heading (${JSON.stringify(r)})`);
    await ctx.close();
  }
});

// Code review S2 (WCAG 2.4.11): moving focus up the tree scrolls each link and button to the
// top of the tree, where the "Contents" heading row stays; scroll-padding keeps it below that row.
test("contents tree: a focused link or button never hides under the sticky heading (Shift+Tab up the tree)", async () => {
  const deepest = [...site.book.chapters].sort((a, b) => b.sections.length - a.sections.length)[0];
  const s = deepest.sections.at(-1);
  const ctx = await browser.newContext({ viewport: { width: 1200, height: 420 } });
  const page = await ctx.newPage();
  await page.goto(base + s.path, { waitUntil: "networkidle" });
  await page.waitForFunction(() => document.querySelector(".toc").scrollTop > 0);
  await page.locator('.toc a[aria-current="page"]').focus();
  let steps = 0;
  for (; steps < 200; steps++) {
    await page.keyboard.press("Shift+Tab");
    if (!(await page.evaluate(() => document.activeElement?.closest(".tree")))) break;
    const r = await page.evaluate(placeInList, null);
    assert.ok(r.inView && r.covered === 0, `Shift+Tab ${steps + 1}: "${await page.evaluate(() => document.activeElement.textContent)}" is covered by ${r.covered}px`);
  }
  assert.ok(steps > deepest.sections.length + 2, `walked ${steps} links and buttons up the tree`);
  await ctx.close();
});

test("forced colors: the triangles and the current page's mark still show", async () => {
  const s = sectionWithParts();
  const { page, ctx } = await open(s.path, { width: 1200 });
  await page.emulateMedia({ forcedColors: "active", colorScheme: "dark" });
  const r = await page.locator(".tw").first().evaluate((b) => {
    const svg = b.querySelector("svg");
    const box = svg.getBoundingClientRect();
    const path = getComputedStyle(svg.querySelector("path"));
    let el = b;
    let bg = "rgba(0, 0, 0, 0)";
    while (el && /rgba\(0, 0, 0, 0\)|transparent/.test(bg)) {
      bg = getComputedStyle(el).backgroundColor;
      el = el.parentElement;
    }
    return { w: box.width, h: box.height, fill: path.fill, bg, forced: matchMedia("(forced-colors: active)").matches };
  });
  assert.ok(r.forced);
  assert.ok(r.w >= 10 && r.h >= 10, `triangle ${r.w}x${r.h}`);
  assert.ok(contrast(r.fill, r.bg) >= 3, `triangle ${r.fill} on ${r.bg}`);
  const bar = await page.locator('.toc a[aria-current="page"]').evaluate((a) => [getComputedStyle(a).borderLeftStyle, parseFloat(getComputedStyle(a).borderLeftWidth)]);
  assert.deepEqual(bar, ["solid", 4], "the current page keeps its bar (a border, not a background)");
  await ctx.close();
});

// Noel, 2026-11-23: a chapter page on a wide screen is the whole chapter (mockup B); on a phone, its jump list (mockup A).
test("chapter page, wide: every section's text, the jump list and the tree jump within the page, Back to contents", async () => {
  const c = [...site.book.chapters].sort((a, b) => b.sections.length - a.sections.length)[0];
  const { page, ctx, problems } = await open(c.path, { width: 1280, ctxOpts: { permissions: ["clipboard-read", "clipboard-write"], reducedMotion: "reduce" } });
  assert.ok(await page.locator(".chapter-text").isVisible());
  assert.equal(await page.locator(".chapter-section").count(), c.sections.length);
  const target = c.sections[Math.floor(c.sections.length / 2)];
  // The jump list and the tree's links for this chapter go to the copies on the page.
  const jump = page.locator(".jump").getByRole("link", { name: `${target.citation}. ${target.title}`, exact: true });
  assert.equal(await jump.getAttribute("href"), `#s-${target.slug}`);
  assert.equal(await page.locator(".toc li.open > ul").getByRole("link", { name: `${target.citation}. ${target.title}`, exact: true }).getAttribute("href"), `#s-${target.slug}`);
  await jump.click();
  await page.waitForFunction((id) => Math.abs(document.getElementById(id).getBoundingClientRect().top) < 40, `s-${target.slug}`);
  assert.equal(decodeURIComponent(new URL(page.url()).hash), `#s-${target.slug}`);
  // Each copy has an h2, "Open this section" and "Copy citation", named for its section.
  const copy = page.locator(`[id="s-${target.slug}"]`);
  assert.equal(await copy.getByRole("heading", { level: 2 }).innerText(), `${target.citation}. ${target.title}`);
  assert.equal(await copy.getByRole("link", { name: `Open this section: ${target.citation}`, exact: true }).getAttribute("href"), target.path);
  await copy.getByRole("button", { name: `Copy citation: ${target.citation}`, exact: true }).click();
  await copy.getByRole("status").filter({ hasText: "Copied the citation" }).waitFor();
  assert.equal(await page.evaluate(() => navigator.clipboard.readText()), target.fullCitation);
  // "Back to contents" stays on screen while the text scrolls, and goes back to the jump list.
  const back = page.getByRole("link", { name: "Back to contents", exact: true });
  const inWindow = () => back.evaluate((a) => {
    const r = a.getBoundingClientRect();
    return r.top >= 0 && r.bottom <= innerHeight;
  });
  assert.ok(await inWindow(), "in the window mid-chapter");
  await page.evaluate(() => scrollBy(0, 600));
  assert.ok(await inWindow(), "still there after scrolling");
  await back.click();
  await page.waitForFunction(() => Math.abs(document.getElementById("sections").getBoundingClientRect().top) < 40);
  // Its name is not the tree's.
  assert.notEqual("Back to contents".toLowerCase(), "contents");
  assert.deepEqual(problems, []);
  await ctx.close();
});

test("chapter page, wide: a focused control in the text never hides under Back to contents (WCAG 2.4.11)", async () => {
  const c = [...site.book.chapters].sort((a, b) => b.sections.length - a.sections.length)[0];
  // Reduced motion: the template scrolls smoothly otherwise, and each step is measured at once.
  const { page, ctx } = await open(c.path, { width: 1280, ctxOpts: { reducedMotion: "reduce" } });
  await page.locator(".chapter-text a").first().focus();
  let steps = 0;
  for (; steps < 400; steps++) {
    const r = await page.evaluate(() => {
      const el = document.activeElement;
      if (!el?.closest(".chapter-text") || el.classList.contains("back-to-contents")) return null;
      const a = el.getBoundingClientRect();
      const b = document.querySelector(".back-to-contents").getBoundingClientRect();
      const overlap = Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left)) * Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
      return { overlap, text: el.textContent.slice(0, 40), visible: a.top >= 0 && a.bottom <= innerHeight };
    });
    if (!r) break;
    assert.equal(r.overlap, 0, `Tab ${steps}: "${r.text}" is under Back to contents`);
    assert.ok(r.visible, `Tab ${steps}: "${r.text}" is in the window`);
    await page.keyboard.press("Tab");
  }
  assert.ok(steps > c.sections.length * 2, `walked ${steps} controls through the chapter`);
  await ctx.close();
});

test("chapter page, phone: the jump list to each section's own page, no full text; a link to a copy goes on to the section", async () => {
  const c = [...site.book.chapters].sort((a, b) => b.sections.length - a.sections.length)[0];
  const target = c.sections[1];
  for (const js of [true, false]) {
    const { page, ctx } = await open(c.path, { width: 390, js });
    assert.equal(await page.locator(".chapter-text").isVisible(), false, "no full text");
    assert.equal(await page.getByRole("link", { name: "Back to contents" }).count(), 0, "no Back to contents");
    const jump = page.locator(".jump").getByRole("link", { name: `${target.citation}. ${target.title}`, exact: true });
    assert.equal(await jump.getAttribute("href"), target.path, js ? "JavaScript on" : "JavaScript off");
    await ctx.close();
  }
  // JavaScript off on a wide screen: the full text is there; the links go to the sections' pages.
  {
    const { page, ctx } = await open(c.path, { width: 1280, js: false });
    assert.ok(await page.locator(".chapter-text").isVisible());
    assert.equal(await page.locator(".jump").getByRole("link", { name: `${target.citation}. ${target.title}`, exact: true }).getAttribute("href"), target.path);
    await ctx.close();
  }
  // A link to a copy, opened on a phone, lands on the section's own page and part.
  const part = target.structure.blocks.find((b) => b.anchor)?.anchor ?? "";
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  await page.goto(`${base}${c.path}#s-${target.slug}${part}`);
  await page.waitForURL((u) => u.pathname === target.path);
  assert.equal(decodeURIComponent(new URL(page.url()).hash), part ? `#${part}` : "");
  // Narrow to wide and back in one page: the links follow the width.
  await page.goto(base + c.path, { waitUntil: "networkidle" });
  const hrefIs = (href) => page.waitForFunction(([name, h]) => [...document.querySelectorAll(".jump a")].find((a) => a.textContent === name)?.getAttribute("href") === h, [`${target.citation}. ${target.title}`, href]);
  await page.setViewportSize({ width: 1280, height: 900 });
  await hrefIs(`#s-${target.slug}`);
  await page.setViewportSize({ width: 390, height: 844 });
  await hrefIs(target.path);
  await ctx.close();
});

test("search: one hit per section, never the chapter page's copy", async () => {
  // Words that appear in exactly one section of a chapter with several, and nowhere else.
  const words = (t) => new Set(String(t ?? "").toLowerCase().match(/[a-z]{9,}/g) ?? []);
  const count = new Map();
  for (const r of site.book.ordered) for (const w of words(`${r.title} ${r.text}`)) count.set(w, (count.get(w) ?? 0) + 1);
  const picks = [];
  for (const s of site.book.sections) {
    if (s.chapter.sections.length < 3 || picks.some((p) => p.s.chapter === s.chapter)) continue;
    const w = [...words(s.text)].find((x) => count.get(x) === 1);
    if (w) picks.push({ s, w });
    if (picks.length === 5) break;
  }
  assert.equal(picks.length, 5);
  const { page, ctx, problems } = await open("/search");
  for (const { s, w } of picks) {
    const urls = await page.evaluate(async (q) => {
      const pf = await import("/pagefind/pagefind.js");
      const r = await pf.search(q);
      return Promise.all(r.results.map(async (x) => (await x.data()).url));
    }, w);
    // Pagefind stems words ("enumeration" also finds "enumerated"), so other sections may match too; no chapter page may.
    const paths = urls.map((u) => u.replace(/\.html$/, ""));
    assert.ok(paths.includes(s.path), `"${w}" finds ${s.citation}: ${paths.join(", ")}`);
    assert.deepEqual(paths.filter((u) => u.includes("/chapters/")), [], `"${w}": no chapter page`);
  }
  assert.deepEqual(problems, []);
  await ctx.close();
});

test("chapter page weight: the HTML a phone downloads, raw and gzipped", async () => {
  const { gzipSync } = await import("node:zlib");
  const { readFileSync } = await import("node:fs");
  const { join } = await import("node:path");
  const sizes = site.book.chapters.map((c) => {
    const raw = readFileSync(join(site.outDir, c.path.slice(1) + ".html"));
    return { c: c.citation, raw: raw.length, gz: gzipSync(raw, { level: 9 }).length };
  });
  const max = sizes.sort((a, b) => b.gz - a.gz)[0];
  console.log(`# fixtures: largest chapter page ${max.c}, ${max.raw} bytes, ${max.gz} gzipped`);
  assert.ok(max.gz < 200_000, `${max.c}: ${max.gz} bytes gzipped`);
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
    assert.equal(r.placeholder, 'Try "§ 259", "259", or "budget office"');
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

// Noel, 2026-11-23: Copy link, Copy citation and Print are small chips, a soft fill and a thin
// border, quieter than the title and unlike Menu and the Contents bar; still at least 24px to tap.
test("the page tools are small chips, at least 24px tall, unlike the Menu button", async () => {
  const s = sectionWithParts();
  const { page, ctx, problems } = await open(s.path, { width: 390 });
  const menu = await page.locator(".menu-btn").evaluate((b) => getComputedStyle(b).borderRadius);
  for (const name of ["Copy link", "Copy citation", "Print"]) {
    const b = page.getByRole("button", { name, exact: true });
    const box = await b.boundingBox();
    assert.ok(box.height >= 24 && box.height <= 40, `${name}: ${box.height}px tall`);
    const [radius, width] = await b.evaluate((el) => { const cs = getComputedStyle(el); return [cs.borderTopLeftRadius, cs.borderTopWidth]; });
    assert.ok(parseFloat(radius) >= box.height / 2 - 1, `${name}: rounded like a chip (${radius})`);
    assert.equal(width, "1px", `${name}: a thin border`);
    assert.notEqual(radius, menu, `${name}: not shaped like Menu`);
  }
  assert.deepEqual(problems, []);
  await ctx.close();
});
