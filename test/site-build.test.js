// The Charter site build (issue #62): scripts/build-site.js and scripts/lib/site/.
//
// Built from real fixtures (test/site/fixture-site.mjs: 44 of American Legal Publishing's
// Charter XML files), without the Pagefind index, so this stays fast and offline. The browser
// tests (accessibility tree, JavaScript off, search) are in test/site/ and run with
// npm run test:site.
//
// The block-order test (Markdown and HTML show the same blocks, in the same order) runs over
// the fixtures here, and over every Charter section when data/structure/charter.json is present
// and was built from the committed index (it is committed by the daily refresh).

import { test, before } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync, readdirSync, mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { join, relative } from "node:path";
import { tmpdir } from "node:os";
import { buildFixtureSite, buildFixtureData, writeFixtureData, ROOT, FIXED_NOW } from "./site/fixture-site.mjs";
import { buildSite, currentThroughLine, BUILD_MARKER } from "../scripts/lib/site/build.js";
import { loadBook, chapterOrderKey, sectionSlug, chapterSlug, shortHeading, linkHref, linkTarget } from "../scripts/lib/site/model.js";
import { readFooter, disclaimerParagraphs, plainParagraph } from "../scripts/lib/site/disclaimer.js";
import { newYorkDay, newYorkLongDate, newYorkIso } from "../scripts/lib/site/clock.js";
import { readBlocks, bodyHtml } from "../scripts/lib/site/render-html.js";
import { unescapeHtml, escapeHtml } from "../scripts/lib/site/html.js";
import { robotsTxt, WELCOMED_CRAWLERS } from "../scripts/lib/site/outputs.js";
import { SITE_BASE, SITE_NAME } from "../scripts/lib/site/config.js";
import { renderSection, bodyBlocks } from "../scripts/lib/render-section.js";
import { sectionMarkdown } from "../scripts/lib/serialize-markdown.js";
import { parseQuery, lookup, citationKeys, jumpTarget, pageUrl } from "../site/assets/jump.js";
import { redirectFor } from "../site/assets/not-found.js";
import { chapterNav, chapterName, chapterNavName, sectionPage } from "../scripts/lib/site/pages.js";

let site;
before(async () => {
  site = await buildFixtureSite({ search: false });
});

const read = (rel) => readFileSync(join(site.outDir, rel), "utf8");
function allFiles(dir, out = []) {
  for (const name of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, name.name);
    if (name.isDirectory()) allFiles(p, out);
    else out.push(p);
  }
  return out;
}
const htmlFiles = () => allFiles(site.outDir).filter((f) => f.endsWith(".html"));
const attr = (html, re) => re.exec(html)?.[1];
const fileForPath = (path) => (path === "/" ? "index.html" : path.endsWith("/") ? path.slice(1) + "index.html" : path.slice(1) + ".html");

test("every Charter record has a page, and the count matches versions.json", () => {
  const { sectionCount } = site.data.versions.charter;
  assert.equal(site.lawPageCount, sectionCount);
  assert.equal(site.book.ordered.length, sectionCount);
  for (const r of site.book.ordered) assert.ok(existsSync(join(site.outDir, fileForPath(r.path))), `${r.citation} has no page at ${r.path}`);
  // Section paths come from the citation.
  const s259 = site.book.sections.find((s) => s.citation === "§ 259");
  if (s259) assert.equal(s259.path, "/charter/sections/259");
});

test("chapters are in the book's order, not the ZIP's", () => {
  const cites = site.book.chapters.map((c) => c.citation);
  const sorted = [...cites].sort((a, b) => {
    const [x, y] = [chapterOrderKey(a), chapterOrderKey(b)];
    for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] < y[i] ? -1 : 1;
    return 0;
  });
  assert.deepEqual(cites, sorted);
  const front = cites.filter((c) => c === "Preamble" || c === "Introductory");
  assert.deepEqual(cites.slice(0, front.length), front, "Preamble and Introductory come first");
  // The fixtures' own chapters, in the Charter's order (the ZIP has 18-D and 19-A before 18 and 3).
  const at = ["Chapter 2", "Chapter 3", "Chapter 18", "Chapter 18-D", "Chapter 19-A", "Chapter 20"].map((c) => cites.indexOf(c));
  assert.ok(at.every((i) => i >= 0), "fixture chapters present");
  assert.deepEqual([...at].sort((a, b) => a - b), at);
  assert.deepEqual(chapterOrderKey("Chapter 18-D"), [1, 18, "D"]);
});

test("paths: safe slugs, and a page for each number two sections share", () => {
  assert.equal(sectionSlug("§ 20-t"), "20-t");
  assert.equal(sectionSlug("§ 258.1"), "258.1");
  assert.equal(chapterSlug("Chapter 2-A"), "2-a");
  assert.throws(() => sectionSlug("§ 1 2"));
  assert.equal(shortHeading({ level: "Section", heading: "Section 259. Independent budget office." }), "Independent budget office");
  assert.equal(shortHeading({ level: "Section", heading: "§ 441. Investigating past professional conduct." }), "Investigating past professional conduct");
  assert.equal(shortHeading({ level: "Chapter", heading: "Chapter 11: Independent Budget Office" }), "Independent Budget Office");
  // The fixtures hold both § 530s (Chapter 20).
  const shared = site.book.shared.find((s) => s.citation === "§ 530");
  assert.ok(shared, "§ 530 is shared in the fixtures");
  assert.equal(shared.path, "/charter/sections/530");
  for (const s of shared.sections) assert.equal(s.path, `/charter/sections/530-${s.id}`);
  const html = read("charter/sections/530.html");
  for (const s of shared.sections) assert.match(html, new RegExp(`href="${s.path}"`));
});

test("every page has a unique title, description and canonical, and no page repeats an id", () => {
  const titles = new Map();
  const descs = new Map();
  const canons = new Map();
  for (const f of htmlFiles()) {
    const html = readFileSync(f, "utf8");
    const rel = relative(site.outDir, f);
    const title = attr(html, /<title>([^<]*)<\/title>/);
    const desc = attr(html, /<meta name="description" content="([^"]*)">/);
    const canon = attr(html, /<link rel="canonical" href="([^"]*)">/);
    assert.ok(title && desc && canon, `${rel}: title, description and canonical`);
    assert.ok(title.endsWith(` | ${SITE_NAME}`) || rel === "index.html", `${rel}: site name at the end of the title`);
    assert.ok(canon.startsWith(SITE_BASE + "/"), `${rel}: absolute canonical`);
    assert.ok(unescapeHtml(desc).length <= 160, `${rel}: description is ${unescapeHtml(desc).length} characters`);
    assert.ok(unescapeHtml(desc).endsWith("BetaNYC's copy for research, not the official text."), `${rel}: description ends with the research note`);
    for (const [m, v] of [[titles, title], [descs, desc], [canons, canon]]) {
      assert.ok(!m.has(v), `${rel} repeats ${v} from ${m.get(v)}`);
      m.set(v, rel);
    }
    const ids = [...html.matchAll(/\sid="([^"]*)"/g)].map((m) => m[1]);
    const seen = new Set();
    for (const id of ids) {
      assert.ok(!seen.has(id), `${rel} repeats id ${id}`);
      seen.add(id);
    }
  }
  // Citation first, site name last.
  const s = site.book.sections.find((x) => x.citation === "§ 259") ?? site.book.sections[0];
  const html = read(fileForPath(s.path));
  assert.equal(attr(html, /<title>([^<]*)<\/title>/), escapeHtml(`NYC Charter ${s.citation}: ${s.title} | BetaNYC Law Reader`));
  assert.equal(attr(html, /<link rel="canonical" href="([^"]*)">/), `${SITE_BASE}${s.path}`);
  assert.match(attr(html, /<meta name="description" content="([^"]*)">/), /BetaNYC&#39;s copy for research, not the official text\.$/);
});

test("every American Legal id in redirects.json lands on a page; every link and anchor resolves", () => {
  const redirects = JSON.parse(read("redirects.json"));
  assert.deepEqual(Object.keys(redirects), ["charter"]);
  assert.equal(Object.keys(redirects.charter).length, site.book.ordered.length);
  for (const [id, path] of Object.entries(redirects.charter)) {
    assert.ok(existsSync(join(site.outDir, fileForPath(path))), `${id} → ${path} has no page`);
    assert.equal(redirectFor(`/charter/${id}`, redirects), path);
    assert.equal(redirectFor(`/NYCcharter/${id}`, redirects), path);
    // An old path with the id on the end still lands, even if the number stops being shared.
    assert.equal(redirectFor(`/charter/sections/530-${id}`, redirects), path);
  }
  assert.equal(redirectFor("/charter/sections/9999", redirects), null);
  assert.equal(redirectFor("/charter/sections/530-0-0-0-999999999", redirects), null);

  const idsOn = new Map();
  const ids = (path) => {
    if (!idsOn.has(path)) idsOn.set(path, new Set([...read(fileForPath(path)).matchAll(/\sid="([^"]*)"/g)].map((m) => unescapeHtml(m[1]))));
    return idsOn.get(path);
  };
  let checked = 0;
  for (const r of site.book.ordered) {
    const html = read(fileForPath(r.path));
    // Every subdivision anchor in the structure is an id on its page.
    for (const b of r.structure.blocks) if (b.anchor) assert.ok(ids(r.path).has(b.anchor), `${r.citation} has no id ${b.anchor}`);
    // Every link inside the law text goes to a page that exists, and to an id on it.
    for (const m of html.matchAll(/<a class="(?:num|xref)" href="([^"]*)"/g)) {
      const href = unescapeHtml(m[1]);
      const [p, frag] = href.startsWith("#") ? [r.path, href.slice(1)] : href.split("#");
      assert.ok(existsSync(join(site.outDir, fileForPath(p))), `${r.citation}: link to missing page ${href}`);
      if (frag) assert.ok(ids(p).has(frag), `${r.citation}: link to missing anchor ${href}`);
      checked++;
    }
  }
  assert.ok(checked > 100, `checked ${checked} links`);
});

test("linkHref leaves unresolved, ambiguous and other-book links as plain text", () => {
  const s = site.book.sections[0];
  const t = site.book.sections[1];
  assert.equal(linkHref({ corpus: "charter", id: t.id }, site.book, s), t.path);
  assert.equal(linkHref({ corpus: "charter", id: t.id, anchor: "(a)" }, site.book, s), `${t.path}#(a)`);
  assert.equal(linkHref({ corpus: "charter", id: s.id, anchor: "(b)" }, site.book, s), "#(b)");
  assert.equal(linkHref({ corpus: "charter", name: "x", resolved: false, ambiguous: true }, site.book, s), null);
  assert.equal(linkHref({ corpus: "charter", name: "x", resolved: false }, site.book, s), null);
  assert.equal(linkHref({ corpus: "admin_code", id: "0-0-0-4606", group: true }, site.book, s), null);
  assert.equal(linkHref({ kind: "web", url: "https://legistar.council.nyc.gov/x" }, site.book, s), "https://legistar.council.nyc.gov/x");
  assert.equal(linkHref({ kind: "web", url: "javascript:alert(1)" }, site.book, s), null);
  assert.equal(linkHref({ kind: "file", file: "a.pdf" }, site.book, s), null);
  assert.deepEqual(linkTarget({ corpus: "charter", id: t.id, anchor: "(a)" }, site.book, s), { href: `${t.path}#(a)`, label: `${t.fullCitation}(a)` });
  // A link's name says where it goes when its words do not (Charter § 1152 links "eight" to
  // both Chapter 8 and § 8).
  const html = bodyHtml([{ type: "text", text: "chapter eight or section eight", links: [{ start: 8, end: 13, to: { corpus: "charter", id: s.id } }, { start: 25, end: 30, to: { corpus: "charter", id: t.id } }] }], {
    fullCitation: "NYC Charter § 1",
    linkFor: (to) => linkTarget(to, site.book, null),
  });
  assert.ok(html.includes(`aria-label="eight, ${escapeHtml(s.fullCitation)}"`) && html.includes(`aria-label="eight, ${escapeHtml(t.fullCitation)}"`), html);
});

test("every page has the bottom box: current through, the bold line, the disclaimer link", () => {
  const line = currentThroughLine(site.data.versions.charter.currentThrough);
  assert.equal(line, "Current through Local Law 2026/086, enacted April 25, 2026.");
  for (const f of htmlFiles()) {
    const html = readFileSync(f, "utf8");
    const rel = relative(site.outDir, f);
    const box = /<aside class="warnbox copy-box" aria-label="About this copy">([\s\S]*?)<\/aside>/.exec(html)?.[1];
    assert.ok(box, `${rel}: bottom box`);
    assert.ok(box.includes(line), `${rel}: current through`);
    assert.ok(box.includes("BetaNYC&#39;s copy of the text last changed on November 22, 2026.") || box.includes("BetaNYC's copy of the text last changed on November 22, 2026."), `${rel}: the date the copy last changed (indexedAt, New York time)`);
    assert.ok(
      box.includes(
        "<strong>This is BetaNYC's copy, for research. It is not the official text and not legal advice. The official Charter is at <a href=\"https://codelibrary.amlegal.com/codes/newyorkcity/latest/NYCcharter/0-0-0-1\">American Legal Publishing</a>.</strong>"
      ),
      `${rel}: bold line`
    );
    assert.match(box, /<a href="\/about">/, `${rel}: disclaimer link`);
    // Plain HTML, outside any web component, after the main content, and nothing at the top.
    assert.ok(html.indexOf("copy-box") > html.indexOf("</main>"), `${rel}: box after main`);
    assert.ok(!/<nys-[a-z]+[^>]*>[^]*copy-box/.test(html.slice(html.lastIndexOf("</main>"), html.indexOf("copy-box"))), `${rel}: box inside a component`);
    assert.ok(!html.slice(0, html.indexOf("<main")).includes("not legal advice"), `${rel}: no warning at the top`);
  }
});

test("the disclaimer page's text is the MCP's FOOTER, without its Built-by line", async () => {
  const footer = readFooter(join(ROOT, "src", "tools.ts"));
  const { FOOTER } = await import("../dist/tools.js");
  assert.equal(footer, FOOTER, "the build reads the same FOOTER the server sends");
  const paras = disclaimerParagraphs(footer);
  assert.ok(!paras.some((p) => p.includes("Built by BetaNYC")));
  const expected = FOOTER.replace(/^---\s*\n/, "").split(/\n\s*\n/).filter((p) => !p.startsWith("Built by BetaNYC")).map((p) => p.replace(/\*\*/g, "").trim());
  const html = read("about.html");
  const block = /<div class="disclaimer">([\s\S]*?)<\/div>/.exec(html)[1];
  const shown = [...block.matchAll(/<p>([\s\S]*?)<\/p>/g)].map((m) => unescapeHtml(m[1].replace(/<[^>]*>/g, "")));
  assert.deepEqual(shown, expected);
  assert.deepEqual(paras.map(plainParagraph), expected);
  assert.match(block, /<a href="mailto:NYC\.editor@amlegal\.com">NYC\.editor@amlegal\.com<\/a>/);
  assert.ok(html.includes("This is the disclaimer BetaNYC's MCP server gives. Its second paragraph is American Legal Publishing's disclaimer for its own site, codelibrary.amlegal.com."));
  // A FOOTER whose last paragraph is not the Built-by line stops the build.
  assert.throws(() => disclaimerParagraphs("---\n**A.** one\n\nTwo, a new last paragraph."), /no longer starts "Built by BetaNYC"/);
});

// Markdown and HTML: the same blocks, in the same order (deferred from #61).
function assertSameBlocks(record, structure, html, label) {
  const blocks = renderSection(record, structure);
  const body = bodyBlocks(blocks);
  const shown = readBlocks(html, unescapeHtml);
  assert.equal(shown.length, body.length, `${label}: block count`);
  shown.forEach((b, i) => {
    assert.equal(b.n, i, `${label}: block ${i} out of order`);
    assert.equal(b.text, body[i].text, `${label}: block ${i} text`);
    const cls = { subdivision: "sub", text: "txt", note: "ednote" }[body[i].type];
    assert.equal(b.cls, cls, `${label}: block ${i} type`);
    assert.equal(b.id, body[i].anchor, `${label}: block ${i} anchor`);
  });
  const md = sectionMarkdown(blocks);
  const mdBody = md.split("\n")[4];
  if (body.length) assert.equal(shown.map((b) => b.text).join(" "), mdBody, `${label}: Markdown body`);
}

test("Markdown and HTML show the same blocks in the same order (fixtures)", () => {
  let n = 0;
  for (const r of site.book.ordered) {
    assertSameBlocks(r, r.structure, read(fileForPath(r.path)), r.citation);
    n++;
  }
  assert.equal(n, site.data.versions.charter.sectionCount);
});

const FULL_INDEX = process.env.SITE_INDEX_DIR ?? join(ROOT, "data", "index", "json");
const FULL_STRUCTURE = process.env.SITE_STRUCTURE_DIR ?? join(ROOT, "data", "structure");
function fullCharter() {
  const sf = join(FULL_STRUCTURE, "charter.json");
  const jf = join(FULL_INDEX, "charter.json");
  if (!existsSync(sf) || !existsSync(jf)) return null;
  const text = readFileSync(jf, "utf8");
  const structure = JSON.parse(readFileSync(sf, "utf8"));
  if (structure.indexSha256 !== createHash("sha256").update(text).digest("hex")) return null;
  return { text, structure, versions: JSON.parse(readFileSync(join(FULL_INDEX, "versions.json"), "utf8")) };
}

test("Markdown and HTML show the same blocks for every Charter section (full index)", { skip: fullCharter() ? false : "data/structure/charter.json not present or not built from this index" }, () => {
  const full = fullCharter();
  const book = loadBook({ corpus: "charter", indexJsonText: full.text, structure: full.structure, versions: full.versions });
  for (const r of book.ordered) {
    const html = bodyHtml(bodyBlocks(renderSection(r, r.structure)), { fullCitation: r.fullCitation, linkFor: (to) => linkTarget(to, book, r) });
    assertSameBlocks(r, r.structure, html, r.citation);
  }
  assert.equal(book.ordered.length, full.versions.charter.sectionCount);
});

test("structured data uses only properties schema.org defines", () => {
  const vocab = JSON.parse(readFileSync(join(ROOT, "test", "fixtures", "site", "schema-org-30.1.json"), "utf8")).types;
  const check = (obj, where) => {
    if (Array.isArray(obj)) return obj.forEach((o) => check(o, where));
    if (!obj || typeof obj !== "object") return;
    const type = obj["@type"];
    assert.ok(vocab[type], `${where}: type ${type} is not one the site may use`);
    for (const [k, v] of Object.entries(obj)) {
      if (k.startsWith("@")) continue;
      assert.ok(vocab[type].properties.includes(k), `${where}: ${type} has no property ${k} in schema.org`);
      if (v && typeof v === "object") check(v, `${where} ${k}`);
    }
  };
  let n = 0;
  for (const f of htmlFiles()) {
    const html = readFileSync(f, "utf8");
    for (const m of html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)) {
      check(JSON.parse(m[1]), relative(site.outDir, f));
      n++;
    }
  }
  assert.ok(n > site.lawPageCount, `${n} JSON-LD blocks`);
  const s = site.book.sections[0];
  const html = read(fileForPath(s.path));
  const lds = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) => JSON.parse(m[1]));
  const leg = lds.find((x) => x["@type"] === "Legislation");
  assert.equal(leg.legislationIdentifier, s.fullCitation);
  assert.equal(leg.url, SITE_BASE + s.path);
  const crumbs = lds.find((x) => x["@type"] === "BreadcrumbList").itemListElement;
  assert.deepEqual(crumbs.map((c) => c.name), ["Law Reader", "NYC Charter", s.chapter.citation, s.citation]);
  assert.equal(crumbs.at(-1).item, undefined);
  assert.equal(crumbs[1].item, `${SITE_BASE}/charter/`);
});

test("sitemaps, robots.txt and noindex", () => {
  const robots = read("robots.txt");
  assert.equal(robots, robotsTxt());
  assert.match(robots, /^User-agent: \*\nAllow: \/$/m);
  assert.doesNotMatch(robots, /Disallow/);
  for (const a of ["Googlebot", "Bingbot", "OAI-SearchBot", "PerplexityBot", "Claude-SearchBot", "Claude-User", "GPTBot", "ClaudeBot", "Google-Extended", "CCBot"]) {
    assert.ok(WELCOMED_CRAWLERS.includes(a), a);
  }
  assert.match(robots, new RegExp(`^Sitemap: ${SITE_BASE}/sitemap.xml$`, "m"));
  const index = read("sitemap.xml");
  const maps = [...index.matchAll(/<loc>([^<]*)<\/loc>/g)].map((m) => m[1]);
  assert.deepEqual(maps, [`${SITE_BASE}/sitemaps/pages.xml`, `${SITE_BASE}/sitemaps/charter.xml`]);
  const charter = [...read("sitemaps/charter.xml").matchAll(/<loc>([^<]*)<\/loc>/g)].map((m) => m[1]);
  for (const r of site.book.ordered) assert.ok(charter.includes(SITE_BASE + r.path), r.path);
  assert.doesNotMatch(read("sitemaps/charter.xml") + read("sitemaps/pages.xml"), /lastmod|\/search/);
  assert.match(read("search.html"), /<meta name="robots" content="noindex">/);
  for (const r of site.book.ordered) assert.doesNotMatch(read(fileForPath(r.path)), /noindex/);
});

test("contents and chapter pages are plain HTML link lists", () => {
  const contents = read("charter/index.html");
  for (const c of site.book.chapters) assert.ok(contents.includes(`<a href="${c.path}">`), c.citation);
  for (const c of site.book.chapters) {
    const html = read(fileForPath(c.path));
    for (const s of c.sections) assert.ok(html.includes(`<li><a href="${s.path}">`), `${c.citation} lists ${s.citation}`);
  }
  // The top bar: "true" for the part of the site, "page" only on the page itself.
  const s = site.book.sections[0];
  assert.match(read(fileForPath(s.path)), /<a href="\/charter\/" aria-current="true">Charter<\/a>/);
  assert.match(contents, /<a href="\/charter\/" aria-current="page">Charter<\/a>/);
  assert.match(read("about.html"), /<a href="\/about" aria-current="page">About this copy<\/a>/);
  // The home page and every page's footer link to the contents.
  assert.ok(read("index.html").includes(`href="/charter/"`));
});

// The side list of chapters (Noel, 2026-11-23): one list per Charter page, every chapter in it,
// one chapter open. Read from the HTML as the browser gets it with JavaScript off.
function sideList(html) {
  const lists = html.match(/<div class="toc"[\s\S]*?<\/nys-verticalnav>\n<\/div>/g) ?? [];
  if (lists.length !== 1) return { count: lists.length };
  const list = lists[0];
  const top = list.replace(/<ul>\n(?:<li><a [^>]*>[^<]*<\/a><\/li>\n?)+<\/ul>\n(?=<\/li>)/, "");
  return {
    count: 1,
    list,
    chapters: [...top.matchAll(/<li(?: class="open")?><a href="([^"]+)"/g)].map((m) => m[1]),
    open: [...list.matchAll(/<li class="open"><a href="([^"]+)" aria-current="([^"]+)">/g)].map((m) => ({ path: m[1], current: m[2] })),
    pageLinks: [...list.matchAll(/<a href="([^"]+)" aria-current="page">/g)].map((m) => m[1]),
  };
}

test("side list: every chapter on every chapter, section and shared-number page, with one chapter open", () => {
  const all = site.book.chapters.map((c) => c.path);
  const check = (rel, { chapter, section }) => {
    const html = read(rel);
    const l = sideList(html);
    assert.equal(l.count, 1, `${rel}: one side list`);
    assert.deepEqual(l.chapters, all, `${rel}: every chapter, in order`);
    assert.match(l.list, new RegExp(`<nys-verticalnav heading="${chapterNavName(site.book)}" hideHeading headingLevel="h2">`), `${rel}: no visible heading on a wide screen, a named button on a phone`);
    if (!chapter) {
      assert.deepEqual(l.open, [], `${rel}: nothing open`);
      assert.deepEqual(l.pageLinks, [], `${rel}: no current link`);
      return;
    }
    assert.deepEqual(l.open, [{ path: chapter.path, current: section ? "true" : "page" }], `${rel}: its chapter open and current`);
    assert.deepEqual(l.pageLinks, [section ? section.path : chapter.path], `${rel}: aria-current="page" on this page's own link`);
    for (const s of chapter.sections) assert.ok(l.list.includes(`<a href="${s.path}"`), `${rel}: lists ${s.citation}`);
    // Only the open chapter shows its sections.
    const shown = [...l.list.matchAll(/href="(\/charter\/sections\/[^"]+)"/g)].map((m) => m[1]);
    assert.deepEqual(shown, chapter.sections.map((s) => s.path), `${rel}: only its own chapter's sections`);
    // The list comes after the law text, so the keyboard and screen readers reach the text first.
    assert.ok(html.indexOf('<main id="main">') < html.indexOf('<div class="toc"'), `${rel}: main before the list`);
    assert.ok(html.indexOf("</main>") < html.indexOf('<div class="toc"'), `${rel}: the list is outside main`);
  };
  for (const s of site.book.sections) check(fileForPath(s.path), { chapter: s.chapter, section: s });
  for (const c of site.book.chapters) check(fileForPath(c.path), { chapter: c });
  for (const sh of site.book.shared) check(fileForPath(sh.path), {});
  // The contents page is that list already; the other pages are not in a book.
  for (const rel of ["charter/index.html", "index.html", "search.html", "about.html", "404.html"]) assert.equal(sideList(read(rel)).count, 0, rel);
  assert.equal(chapterName({ citation: "Preamble", title: "Preamble" }), "Preamble");
  assert.equal(chapterName({ citation: "Chapter 2-A", title: "Districting Commission" }), "Chapter 2-A: Districting Commission");
});

test("side list over the full Charter: all its chapters on a section page (full index)", { skip: fullCharter() ? false : "data/structure/charter.json not present or not built from this index" }, () => {
  const full = fullCharter();
  const book = loadBook({ corpus: "charter", indexJsonText: full.text, structure: full.structure, versions: full.versions });
  const s = book.sections.find((x) => x.citation === "§ 259") ?? book.sections[0];
  const facts = { currentThrough: "Current through.", copyChangedOn: "today", officialUrl: "https://codelibrary.amlegal.com/", officialName: "The official Charter", creditLine: "Source.", contentsPath: "/charter/" };
  const l = sideList(sectionPage(s, book, facts).html);
  assert.equal(l.count, 1);
  assert.deepEqual(l.chapters, book.chapters.map((c) => c.path));
  assert.equal(new Set(l.chapters).size, book.chapters.length);
  console.log(`# full Charter: ${book.chapters.length} chapters in the side list; ${Buffer.byteLength(chapterNav(book, { chapter: s.chapter, section: s }))} bytes on ${s.fullCitation}'s page`);
});

test("the search box is on the home page and the search page only, its hint as placeholder text", () => {
  const withBox = htmlFiles().filter((f) => read(relative(site.outDir, f)).includes("<nys-textinput")).map((f) => relative(site.outDir, f)).sort();
  assert.deepEqual(withBox, ["index.html", "search.html"]);
  assert.equal((read("index.html").match(/<div class="find"/g) ?? []).length, 1, "the strip on the home page");
  assert.doesNotMatch(read("search.html"), /<div class="find"/, "the search page has its own box, not the strip");
  for (const rel of withBox) {
    const tag = /<nys-textinput[^>]*>/.exec(read(rel))[0];
    assert.match(tag, / label="Go to a section, or search the words"/, `${rel}: a visible label is its name`);
    assert.match(tag, / placeholder="Try &quot;§ 259&quot;, &quot;259&quot; or &quot;budget office&quot;"/, rel);
    assert.doesNotMatch(tag, / description=/, `${rel}: no separate hint line`);
    assert.match(read(rel), /<noscript><p class="nojs">Search needs JavaScript. <a href="\/charter\/">Browse the Charter's contents<\/a> instead.<\/p><\/noscript>/, rel);
  }
  // Every page keeps the top bar's Search link.
  for (const f of htmlFiles()) assert.match(read(relative(site.outDir, f)), /<li><a href="\/search"(?: aria-current="page")?>Search<\/a><\/li>/, relative(site.outDir, f));
});

test("the law text uses the template's body font, not a second family", () => {
  const css = readFileSync(join(ROOT, "site", "assets", "law.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  assert.doesNotMatch(css, /--font-law|Georgia|Times New Roman|\bserif\b/);
  assert.match(css, /\.law \{ font: 18px\/1\.7 var\(--font-body\);/);
  // Every font family in law.css is one of the template's.
  for (const m of css.matchAll(/font(?:-family)?:[^;]*?(var\(--[a-z-]+\))?;/g)) {
    if (/font-family|font:/.test(m[0]) && /[a-z]"|,/.test(m[0].replace(/var\([^)]*\)/g, ""))) assert.fail(`a font named outside the template: ${m[0]}`);
  }
});

test("Pagefind markup: every law page is a search body with filters; other pages are not", () => {
  for (const r of site.book.ordered) {
    const html = read(fileForPath(r.path));
    assert.match(html, /<article class="law-page" data-pagefind-body>/, r.citation);
    assert.match(html, /<meta data-pagefind-filter="book\[content\]" content="Charter">/);
    assert.match(html, new RegExp(`<meta data-pagefind-filter="kind\\[content\\]" content="${r.level === "Chapter" ? "Chapter" : "Section"}">`));
  }
  for (const f of ["index.html", "search.html", "about.html", "404.html", "charter/index.html"]) assert.doesNotMatch(read(f), /data-pagefind-body/, f);
  // Subdivisions are sub-results.
  const s = site.book.sections.find((x) => x.structure.blocks.some((b) => b.anchor));
  const b = s.structure.blocks.find((x) => x.anchor);
  assert.ok(read(fileForPath(s.path)).includes(`data-pagefind-title="${s.fullCitation}${b.anchor}"`));
});

test("metadata.json, index.json and citations.json", () => {
  const meta = JSON.parse(read("metadata.json"));
  assert.equal(meta.builtAt, "2026-11-22T22:30:00-05:00");
  assert.equal(meta.builtOn, "2026-11-22");
  assert.equal(meta.sourceCommit, "0123456789abcdef");
  assert.equal(meta.books.charter.records, site.data.versions.charter.sectionCount);
  assert.equal(meta.books.charter.indexSha256, site.data.versions.charter.sha256);
  const tree = JSON.parse(read("index.json"));
  const count = tree.books[0].children.reduce((n, c) => n + 1 + c.children.length, 0);
  assert.equal(count, site.data.versions.charter.sectionCount);
  const cites = JSON.parse(read("citations.json"));
  assert.equal(cites.length, site.data.versions.charter.sectionCount);
  assert.equal(lookup(cites, "§ 530").matches.length, 2);
  const one = lookup(cites, "charter 259");
  if (site.book.sections.some((s) => s.citation === "§ 259")) assert.equal(jumpTarget(one.matches[0], one.anchor), "/charter/sections/259");
});

test("jump box: citations a reader might type", () => {
  assert.deepEqual(parseQuery("§ 259"), { key: "259", anchor: "" });
  assert.deepEqual(parseQuery("259"), { key: "259", anchor: "" });
  assert.deepEqual(parseQuery("charter 259"), { key: "259", anchor: "" });
  assert.deepEqual(parseQuery("NYC Charter § 259"), { key: "259", anchor: "" });
  assert.deepEqual(parseQuery("Section 259(a)(1)"), { key: "259", anchor: "(a)(1)" });
  assert.deepEqual(parseQuery("§§ 20-T"), { key: "20-t", anchor: "" });
  assert.deepEqual(parseQuery("258.1"), { key: "258.1", anchor: "" });
  assert.deepEqual(parseQuery("Chapter 2-A"), { key: "chapter 2-a", anchor: "" });
  assert.deepEqual(parseQuery("ch. 11"), { key: "chapter 11", anchor: "" });
  assert.equal(parseQuery("budget office"), null);
  assert.equal(parseQuery("259 budget"), null);
  assert.equal(parseQuery(""), null);
  assert.deepEqual(citationKeys("§ 259"), ["259"]);
  assert.deepEqual(citationKeys("Chapter 18-D"), ["chapter 18-d"]);
  assert.equal(jumpTarget({ p: "/charter/sections/259" }, "(a)"), "/charter/sections/259#(a)");
});

test("search results link to the address without .html", () => {
  assert.equal(pageUrl("/charter/sections/259.html"), "/charter/sections/259");
  assert.equal(pageUrl("/charter/sections/259.html#(a)"), "/charter/sections/259#(a)");
  assert.equal(pageUrl("/charter/chapters/2-a.html"), "/charter/chapters/2-a");
});

test("one clock: dates are New York dates", () => {
  assert.equal(newYorkDay("2026-11-23T03:19:25Z"), "2026-11-22");
  assert.equal(newYorkLongDate("2026-11-23T03:19:25Z"), "November 22, 2026");
  assert.equal(newYorkIso(FIXED_NOW), "2026-11-22T22:30:00-05:00");
  assert.equal(newYorkIso("2026-07-04T16:00:00Z"), "2026-07-04T12:00:00-04:00");
  assert.throws(() => newYorkDay("not a date"));
});

test("law.css names no colors; site.css is the only file that does", () => {
  const css = readFileSync(join(ROOT, "site", "assets", "law.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  assert.doesNotMatch(css, /#[0-9a-fA-F]{3,8}\b/);
  assert.doesNotMatch(css, /\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\(/);
  assert.doesNotMatch(css, /:\s*(?:white|black|red|blue|green|yellow|orange|gray|grey|navy|purple)\b/i);
  // Every --nys-color-theme* token NYSDS's themes set is set from a template variable.
  for (const t of ["", "-faint", "-weaker", "-weak", "-mid", "-strong", "-stronger"]) {
    assert.match(css, new RegExp(`--nys-color-theme${t}: var\\(--[a-z0-9-]+\\);`), `--nys-color-theme${t}`);
  }
});

test("the template's files are unchanged copies, and their color pairs pass contrast", () => {
  const readme = readFileSync(join(ROOT, "site", "template", "README.md"), "utf8");
  for (const m of readme.matchAll(/\| `([^`]+)` \| `([0-9a-f]{64})` \|/g)) {
    const sha = createHash("sha256").update(readFileSync(join(ROOT, "site", "template", m[1]))).digest("hex");
    assert.equal(sha, m[2], `${m[1]} differs from the template copy recorded in site/template/README.md`);
  }
  const css = readFileSync(join(ROOT, "site", "template", "site.css"), "utf8");
  const v = {};
  for (const m of css.matchAll(/--([a-z0-9-]+):\s*(#[0-9a-fA-F]{6})/g)) v[m[1]] = m[2];
  v["warnbox-bg"] = /\.warnbox\s*{[^}]*background:\s*(#[0-9a-fA-F]{6})/.exec(css)[1];
  const lum = (h) => {
    const c = [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255).map((x) => (x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4));
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  };
  const ratio = (a, b) => {
    const [x, y] = [lum(v[a]), lum(v[b])].sort((p, q) => q - p);
    return (x + 0.05) / (y + 0.05);
  };
  // The focus ring, 3:1 against every background it lands on (WCAG 2.4.13 / 1.4.11).
  for (const bg of ["white", "bg-blue", "bg-blue-lt", "light", "warnbox-bg"]) assert.ok(ratio("focus", bg) >= 3, `focus on ${bg}: ${ratio("focus", bg)}`);
  for (const bg of ["blue", "blue-dark"]) assert.ok(ratio("blue-2", bg) >= 3, `bar focus on ${bg}`);
  assert.match(css, /\.site-bar a:focus-visible, \.site-bar button:focus-visible \{ outline-color: var\(--blue-2\); \}/);
  // Text, 4.5:1.
  for (const bg of ["white", "bg-blue", "bg-blue-lt", "warnbox-bg", "blue-2"]) {
    assert.ok(ratio("ink", bg) >= 4.5, `ink on ${bg}`);
    assert.ok(ratio("blue", bg) >= 4.5, `blue on ${bg}`);
  }
  assert.ok(ratio("white", "blue") >= 4.5 && ratio("white", "blue-dark") >= 4.5, "white on the bar and the buttons");
  assert.ok(ratio("line", "white") >= 3, "field borders");
  // The wordmark stays visible in forced colors.
  assert.match(css, /@media \(forced-colors: active\) \{\s*\.site-bar \.home img \{ forced-color-adjust: none; background: #2359a8;/);
});

test("the build refuses bad input and never clears a folder it did not make", async () => {
  const d = writeFixtureData(buildFixtureData());
  // A structure from other text.
  const st = JSON.parse(readFileSync(join(d.structureDir, "charter.json"), "utf8"));
  assert.throws(
    () => loadBook({ corpus: "charter", indexJsonText: d.data.json + " ", structure: st, versions: d.data.versions }),
    /built from other text/
  );
  // A count that does not match versions.json.
  const v = structuredClone(d.data.versions);
  v.charter.sectionCount += 1;
  assert.throws(() => loadBook({ corpus: "charter", indexJsonText: d.data.json, structure: st, versions: v }), /versions\.json says/);
  // An output folder with someone else's files.
  const out = mkdtempSync(join(tmpdir(), "law-reader-other-"));
  writeFileSync(join(out, "keep.txt"), "not ours");
  await assert.rejects(buildSite({ indexDir: d.indexDir, structureDir: d.structureDir, outDir: out, search: false, now: FIXED_NOW }), /not clearing it/);
  assert.ok(existsSync(join(out, "keep.txt")));
  // Missing structure: says how to make it.
  const empty = mkdtempSync(join(tmpdir(), "law-reader-empty-"));
  mkdirSync(join(empty, "s"));
  await assert.rejects(buildSite({ indexDir: d.indexDir, structureDir: join(empty, "s"), outDir: join(empty, "o"), search: false }), /npm run build-index/);
  // Our own marker lets a rebuild clear the folder.
  assert.ok(existsSync(join(site.outDir, BUILD_MARKER)));
});

test("license notices ship with the site", () => {
  assert.match(read("licenses/nysds-LICENSE.md"), /CC0 1\.0 Universal/);
  assert.match(read("licenses/nysds-LICENSE.md"), /Lit is licensed under the BSD 3-Clause/);
  assert.match(read("licenses/nysds-LICENSE.md"), /Apache License Version 2\.0/);
  assert.match(read("licenses/pagefind-LICENSE.txt"), /MIT|Permission is hereby granted/);
  const about = read("about.html");
  assert.ok(about.includes(`href="/licenses/nysds-LICENSE.md"`) && about.includes(`href="/licenses/pagefind-LICENSE.txt"`));
  // No NYSDS global or State-only parts anywhere.
  for (const f of htmlFiles()) assert.doesNotMatch(readFileSync(f, "utf8"), /<nys-(?:globalheader|globalfooter|unavheader|unavfooter)/);
});
