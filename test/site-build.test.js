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
import { readBlocks, bodyHtml, isHistoryLine, copyId } from "../scripts/lib/site/render-html.js";
import { unescapeHtml, escapeHtml } from "../scripts/lib/site/html.js";
import { robotsTxt, WELCOMED_CRAWLERS } from "../scripts/lib/site/outputs.js";
import { SITE_BASE, SITE_NAME } from "../scripts/lib/site/config.js";
import { renderSection, bodyBlocks } from "../scripts/lib/render-section.js";
import { sectionMarkdown } from "../scripts/lib/serialize-markdown.js";
import { parseQuery, lookup, citationKeys, jumpTarget, pageUrl } from "../site/assets/jump.js";
import { redirectFor } from "../site/assets/not-found.js";
import { contentsTree, chapterName, CONTENTS_NAME, chapterSectionsJson, chapterSectionsPath, sectionPage, chapterPage, officialRecordUrl } from "../scripts/lib/site/pages.js";
import { currentLine } from "../scripts/lib/site/layout.js";
import { sourceFacts } from "../scripts/lib/site/build.js";

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

test("every page but About has the bottom box: current through, the bold line, the disclaimer link", () => {
  assert.equal(currentThroughLine(site.data.versions.charter.currentThrough), "Current through Local Law 2026/086, enacted April 25, 2026.");
  // Each claim names its owner (copy review S1): "current through" is the publisher's, the date is BetaNYC's.
  const line = escapeHtml("American Legal Publishing's text is current through Local Law 2026/086, enacted April 25, 2026. BetaNYC's copy last changed on November 22, 2026.");
  assert.equal(escapeHtml(currentLine({ currentThrough: currentThroughLine(site.data.versions.charter.currentThrough), copyChangedOn: "November 22, 2026" })), line);
  assert.throws(() => currentLine({ currentThrough: "Updated through rule 5.", copyChangedOn: "today" }), /does not start "Current through"/);
  // The About page ends with the full disclaimer and its own "How current it is", so it has no box.
  const about = read("about.html");
  assert.ok(!about.includes("copy-box"), "about.html: no bottom box");
  assert.ok(about.includes(`<h2 id="current">How current it is</h2>\n<p>${line} That date changes`), "about.html: current through, in its own section");
  for (const f of htmlFiles()) {
    const html = readFileSync(f, "utf8");
    const rel = relative(site.outDir, f);
    if (rel === "about.html") continue;
    const box = /<aside class="warnbox copy-box" aria-label="About this copy">([\s\S]*?)<\/aside>/.exec(html)?.[1];
    assert.ok(box, `${rel}: bottom box`);
    assert.ok(box.includes(`<p class="current">${line}</p>`), `${rel}: current through, the publisher's, and the date the copy last changed (indexedAt, New York time)`);
    assert.doesNotMatch(box, /<p class="current">Current through/, `${rel}: not stated as BetaNYC's own claim`);
    // Two paragraphs (Noel, 2026-11-23): how current, then the bold warning, how BetaNYC changed the
    // text, where the official text is, and the disclaimer link. No "BetaNYC's copy, for research".
    assert.equal(box.match(/<p[ >]/g).length, 2, `${rel}: two paragraphs`);
    assert.doesNotMatch(box, /for research|not the official text/, `${rel}: no "BetaNYC's copy, for research" line`);
    assert.match(
      box,
      /<p class="lead"><strong>BetaNYC modified (?:this text|the law text on this site)\. It is not legal advice\.<\/strong> We built it from American Legal Publishing's bulk XML, split it into its parts, added links between sections, and removed the publisher's editing marks\. (?:The official Charter|The official text of NYC Charter [^<]+) is at <a href="https:\/\/codelibrary\.amlegal\.com\/codes\/newyorkcity\/latest\/NYCcharter\/[^"]+">American Legal Publishing<\/a>\. <a href="\/about#disclaimer">Read the full disclaimer<\/a><\/p>/,
      `${rel}: second paragraph`
    );
    assert.match(box, /<a href="\/about#disclaimer">Read the full disclaimer<\/a>/, `${rel}: disclaimer link`);
    // Plain HTML, outside any web component, after the main content, and nothing at the top.
    assert.ok(html.indexOf("copy-box") > html.indexOf("</main>"), `${rel}: box after main`);
    assert.ok(!/<nys-[a-z]+[^>]*>[^]*copy-box/.test(html.slice(html.lastIndexOf("</main>"), html.indexOf("copy-box"))), `${rel}: box inside a component`);
    assert.ok(!html.slice(0, html.indexOf("<main")).includes("not legal advice"), `${rel}: no warning at the top`);
  }
});

// Copy review S2, 2026-11-23: a page says where its text comes from once. Noel, 2026-11-23: one
// warning, at the bottom, so that is the bottom box, and there is no box right after the text.
// The footer's source sentence is only on About, which has no box.
test("law pages: one box, at the bottom, linking to the record's own page at American Legal; the footer does not repeat it", () => {
  const facts = sourceFacts(JSON.parse(readFileSync(join(ROOT, "DATA-SOURCES.json"), "utf8")), "charter");
  assert.equal(facts.officialUrl, "https://codelibrary.amlegal.com/codes/newyorkcity/latest/NYCcharter/0-0-0-1");
  assert.equal(facts.officialBase, "https://codelibrary.amlegal.com/codes/newyorkcity/latest/NYCcharter/");
  assert.throws(() => sourceFacts({ sources: [{ id: "charter", verify_at: "https://example.com/x", terms: { credit_line: "c" } }] }, "charter"), /not a record at American Legal Publishing/);
  const modified = /The text comes from American Legal Publishing, and BetaNYC modified it \(<a href="\/about#changes">how BetaNYC changed it<\/a>\)\. /;
  const mit = "Our code is MIT licensed; the license does not cover the publisher&#39;s text.";
  const lawFiles = new Set(site.book.ordered.map((r) => fileForPath(r.path)));
  for (const r of site.book.ordered) {
    const html = read(fileForPath(r.path));
    assert.doesNotMatch(html, /class="note source"/, `${r.path}: no box after the text`);
    assert.equal(html.split("warnbox").length - 1, 1, `${r.path}: one warning box`);
    const box = /<aside class="warnbox copy-box" aria-label="About this copy">([\s\S]*?)<\/aside>/.exec(html)?.[1];
    assert.ok(box, `${r.path}: bottom box`);
    const href = `https://codelibrary.amlegal.com/codes/newyorkcity/latest/NYCcharter/${r.id}`;
    assert.equal(officialRecordUrl(r, { officialBase: facts.officialBase }), href);
    assert.ok(box.includes(`<strong>BetaNYC modified this text. It is not legal advice.</strong>`), `${r.path}: modified, in the bottom box`);
    assert.ok(box.includes(` The official text of ${r.fullCitation} is at <a href="${href}">American Legal Publishing</a>. `), `${r.path}: its own page at American Legal`);
    const footer = html.slice(html.indexOf("<footer"));
    assert.doesNotMatch(footer, modified, `${r.path}: the footer does not repeat the source`);
    assert.ok(footer.includes(`<p class="small">${mit.replace("&#39;", "'")}</p>`), `${r.path}: the MIT line stays`);
  }
  for (const f of htmlFiles()) {
    const rel = relative(site.outDir, f);
    if (lawFiles.has(rel)) continue;
    const html = read(rel);
    assert.doesNotMatch(html, /class="note source"/, `${rel}: no box after the text`);
    const footer = html.slice(html.indexOf("<footer"));
    if (rel === "about.html") {
      assert.match(footer, modified, `${rel}: no bottom box, so the footer says where the text comes from`);
      continue;
    }
    assert.ok(html.includes(`<strong>BetaNYC modified the law text on this site. It is not legal advice.</strong>`), `${rel}: modified, in the bottom box`);
    assert.ok(html.includes(` The official Charter is at <a href="${facts.officialUrl}">American Legal Publishing</a>. `), `${rel}: the box names the book`);
    assert.doesNotMatch(footer, modified, `${rel}: the footer does not repeat the box`);
  }
});

test("footer: the download link lands on the data files", () => {
  for (const f of htmlFiles()) {
    const html = read(relative(site.outDir, f));
    assert.match(html, /Download the text as JSON and Markdown <a href="https:\/\/github\.com\/BetaNYC\/nyc-charter-laws-rules\/tree\/main\/data\/index">from GitHub<\/a>/, relative(site.outDir, f));
  }
});

test("the chapter pager names chapters the way the lists do", () => {
  const [first, second] = site.book.chapters;
  assert.equal(first.title, first.citation, "the fixtures open with a chapter whose title is its citation (Introductory)");
  const html = read(fileForPath(second.path));
  const pager = /<nav class="pager"[\s\S]*?<\/nav>/.exec(html)[0];
  assert.ok(pager.includes(`<small>Previous</small> ${escapeHtml(chapterName(first))}</a>`), pager);
  assert.doesNotMatch(pager, new RegExp(`${first.citation}: ${first.title}`), "no repeated label");
  const next = /<a class="next"[^>]*><small>Next<\/small> ([^<]*)<\/a>/.exec(read(fileForPath(first.path)))[1];
  assert.equal(unescapeHtml(next), chapterName(second));
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
  assert.ok(html.includes("<p>BetaNYC's MCP server ends its answers with the disclaimer below. The paragraph that starts “Official disclaimer from American Legal Publishing” is the publisher's, written for its own site, codelibrary.amlegal.com, so “this site” in it means theirs.</p>"));
  // The paragraph the lead-in names is in the disclaimer it introduces.
  assert.ok(expected.some((p) => p.startsWith("Official disclaimer from American Legal Publishing")), "the lead-in names a paragraph that is there");
  // A FOOTER whose last paragraph is not the Built-by line stops the build.
  assert.throws(() => disclaimerParagraphs("---\n**A.** one\n\nTwo, a new last paragraph."), /no longer starts "Built by BetaNYC"/);
});

test("the About page: its sections in order, a jump list that resolves, the disclaimer last, lab@beta.nyc", () => {
  const html = read("about.html");
  const main = html.slice(html.indexOf("<main"), html.indexOf("</main>"));
  assert.match(main, /<h1>About BetaNYC Law Reader<\/h1>/);
  assert.match(html, /<title>About \| BetaNYC Law Reader<\/title>/);
  const ids = [...main.matchAll(/<h2 id="([^"]+)">/g)].map((m) => m[1]).filter((id) => id !== "on-this-page");
  assert.deepEqual(ids, ["why", "history", "changes", "current", "built-by", "ai", "licenses", "mistakes", "support", "disclaimer"]);
  const jumps = [...main.matchAll(/<li><a href="#([^"]+)">/g)].map((m) => m[1]);
  assert.deepEqual(jumps, ids, "the jump list names every section, in order");
  // No warning at the top: the bold line opens the Disclaimer section, the last thing in main.
  assert.doesNotMatch(main.slice(0, main.indexOf('<h2 id="disclaimer">')), /not legal advice/);
  const tail = main.slice(main.indexOf('<h2 id="disclaimer">'));
  assert.match(tail, /^<h2 id="disclaimer">Disclaimer<\/h2>\n<p><strong>This is BetaNYC's copy, for research\. It is not the official text and not legal advice\./);
  // The history: the 2013 People's Roadmap, BetaNYC's testimony and statement, and the Council's record of Local Law 37 of 2014.
  for (const href of [
    "https://nycroadmap.us/index.html#31",
    "https://github.com/openlawdc/dc-decoded",
    "https://www.beta.nyc/2014/06/11/betanycs-support-of-three-bills-that-would-put/",
    "https://legistar.council.nyc.gov/LegislationDetail.aspx?ID=1681066&amp;GUID=0AA72ECF-4B97-41D0-B3B2-965B7AFC0F24",
    "https://www.beta.nyc/2014/08/07/betanycs-statement-on-the-signing-of-nycs/",
    "https://www.beta.nyc/2026/05/21/new-nyc-digital-democracy-tools-for-ai/",
  ]) assert.ok(main.includes(`href="${href}"`), href);
  assert.match(main, /<a href="mailto:lab@beta\.nyc">lab@beta\.nyc<\/a>/);
  assert.doesNotMatch(html, /hello@beta\.nyc/, "hello@beta.nyc is not a BetaNYC address");
  assert.match(main, /href="https:\/\/www\.beta\.nyc\/about\/ai-policy\/"/);
  assert.match(main, /href="https:\/\/beta\.nyc\/donate\/"/);
  // The footer's "modified" note points at the section that says how, and that section says "modified" first.
  assert.match(html, /The text comes from American Legal Publishing, and BetaNYC modified it \(<a href="\/about#changes">how BetaNYC changed it<\/a>\)\./);
  assert.match(main, /<h2 id="changes">What BetaNYC changed<\/h2>\n<p>BetaNYC modified the text\. We split each section into its parts \(a, b, \(1\), \(2\)…\), give/);
  // Copy review, 2026-11-23: who the roadmap was for, what BetaNYC testified for, whose duty § 7-111 is,
  // who asks to hear about mistakes, and the licenses in short sentences.
  for (const text of [
    "The People's Roadmap to a Digital New York City</a> for the City's incoming leaders.",
    "testified before the Council</a> in support of Intro 149,",
    "requires the City's Law Department to publish the Charter, the Administrative Code, and the Rules on its website",
    "If the mistake is in the publisher's text itself, American Legal Publishing's disclaimer asks readers to tell the publisher at <a href=\"mailto:NYC.editor@amlegal.com\">NYC.editor@amlegal.com</a> or the NYC Law Department at <a href=\"mailto:NYCCodeRulesCharter@law.nyc.gov\">NYCCodeRulesCharter@law.nyc.gov</a>.",
    "This is not a New York State site; we use the design system as a library.",
    "DOMPurify, which the design system includes, carries its notice in <a href=\"/assets/nysds/nysds.js\">nysds.js</a>.",
  ]) assert.ok(main.includes(text), text);
  // The serial comma in the site's own copy (copy review S5).
  for (const text of ["community boards, and the agencies", "advocates, and students", "read, search, and cite", "the Rules, and the Administrative Code", "the Administrative Code, and the Rules", "buttons, and search controls", "wrong, missing, or out of date", "(Apache License 2.0), and Lit"]) assert.ok(main.includes(text), text);
  assert.doesNotMatch(main, /\.\.\.\)|for the incoming mayor|gives the same disclaimer|Its second paragraph/);
});

// Markdown and HTML: the same blocks, in the same order (deferred from #61).
function assertSameBlocks(record, structure, html, label, headingLevel = 2) {
  const blocks = renderSection(record, structure);
  const body = bodyBlocks(blocks);
  const shown = readBlocks(html, unescapeHtml);
  assert.equal(shown.length, body.length, `${label}: block count`);
  shown.forEach((b, i) => {
    assert.equal(b.n, i, `${label}: block ${i} out of order`);
    assert.equal(b.text, body[i].text, `${label}: block ${i} text`);
    const cls = { subdivision: "sub", text: isHistoryLine(body[i]) ? "txt history" : "txt", note: "ednote", subheading: "subhead" }[body[i].type];
    assert.equal(b.cls, cls, `${label}: block ${i} type`);
    // A Subsection's heading line is a real heading (issue #76); every other block is a paragraph.
    assert.equal(b.tag, body[i].type === "subheading" ? `h${headingLevel}` : "p", `${label}: block ${i} element`);
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
  assert.deepEqual(crumbs.map((c) => c.name), ["Home", "NYC Charter", s.chapter.citation, s.citation]);
  assert.equal(crumbs[0].item, `${SITE_BASE}/`);
  assert.equal(crumbs.at(-1).item, undefined);
  // The structured data names the same crumbs the page shows (Noel, 2026-11-23: "Home", not "Law Reader").
  const shown = [.../<nys-breadcrumbs[^>]*>([\s\S]*?)<\/nys-breadcrumbs>/.exec(html)[1].matchAll(/<li>(?:<a href="([^"]+)">|<span aria-current="page">)([^<]*)</g)].map((m) => ({ name: unescapeHtml(m[2]), path: m[1] }));
  assert.deepEqual(shown.map((c) => c.name), crumbs.map((c) => c.name));
  assert.deepEqual(shown[0], { name: "Home", path: "/" });
  for (const [i, c] of shown.entries()) if (c.path) assert.equal(crumbs[i].item, SITE_BASE + c.path);
  assert.equal(crumbs[1].item, `${SITE_BASE}/charter/`);
});

// Noel, 2026-11-23: the first crumb is "Home" ("Law Reader" confused people). Every page with
// breadcrumbs, in the page and, on every indexed page, in its structured data.
test("breadcrumbs: \"Home\" first on every page that has them, in the page and the structured data", () => {
  let n = 0;
  for (const f of htmlFiles()) {
    const rel = relative(site.outDir, f);
    const html = read(rel);
    const trail = /<nys-breadcrumbs[^>]*>([\s\S]*?)<\/nys-breadcrumbs>/.exec(html)?.[1];
    if (!trail) {
      assert.ok(["index.html", "404.html"].includes(rel), `${rel}: no breadcrumbs`);
      continue;
    }
    const shown = [...trail.matchAll(/<li>(?:<a href="([^"]+)">|<span aria-current="page">)([^<]*)</g)].map((m) => ({ name: unescapeHtml(m[2]), path: m[1] }));
    assert.deepEqual(shown[0], { name: "Home", path: "/" }, rel);
    const lds = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) => JSON.parse(m[1]));
    const crumbs = lds.find((x) => x["@type"] === "BreadcrumbList")?.itemListElement;
    // The search page is noindex, so it carries no structured data; every indexed page does.
    if (!crumbs && /<meta name="robots" content="noindex">/.test(html)) {
      n++;
      continue;
    }
    assert.ok(crumbs, `${rel}: BreadcrumbList`);
    assert.deepEqual(crumbs.map((c) => c.name), shown.map((c) => c.name), `${rel}: the structured data names the crumbs the page shows`);
    assert.equal(crumbs[0].item, `${SITE_BASE}/`, rel);
    n++;
  }
  assert.equal(n, htmlFiles().length - 2, "every page but the home page and the 404 page has breadcrumbs");
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
  assert.match(read("about.html"), /<a href="\/about" aria-current="page">About<\/a>/);
  // The home page and every page's footer link to the contents.
  assert.ok(read("index.html").includes(`href="/charter/"`));
});

// The contents tree (Noel, 2026-11-23): one per law page, every chapter in it, the current
// chapter open. Read from the HTML as the browser gets it with JavaScript off.
function tree(html) {
  const trees = html.match(/<div class="toc"[\s\S]*?<\/nav>\n<\/details>\n<\/div>/g) ?? [];
  if (trees.length !== 1) return { count: trees.length };
  const list = trees[0];
  const top = list.replace(/<ul id="[^"]+">\n(?:<li><a [^>]*>[^<]*<\/a><\/li>\n?)+<\/ul>\n(?=<\/li>)/, "");
  return {
    count: 1,
    list,
    chapters: [...top.matchAll(/<li(?: class="[a-z]+")?><a href="([^"]+)"/g)].map((m) => m[1]).filter((h) => h.includes("/chapters/")),
    open: [...list.matchAll(/<li class="open"><a href="([^"]+)" aria-current="([^"]+)">/g)].map((m) => ({ path: m[1], current: m[2] })),
    pageLinks: [...list.matchAll(/<a href="([^"]+)" aria-current="page">/g)].map((m) => m[1]),
  };
}

test("contents tree: every chapter on every chapter, section and shared-number page, with one chapter open", () => {
  const all = site.book.chapters.map((c) => c.path);
  const check = (rel, { chapter, section }) => {
    const html = read(rel);
    const l = tree(html);
    assert.equal(l.count, 1, `${rel}: one contents tree`);
    assert.deepEqual(l.chapters, all, `${rel}: every chapter, in order`);
    // A heading "Contents" names the navigation landmark; then the book; then the chapters.
    assert.match(l.list, /<nav class="contents-nav" id="contents" aria-labelledby="contents-h" data-sections="\/charter\/contents\/">\n<div class="contents-top"><h2 id="contents-h">Contents<\/h2><button type="button" class="contents-hide" aria-label="Hide contents" hidden>Hide<\/button><\/div>\n<p class="book"><a href="\/charter\/">New York City Charter<\/a><\/p>/, rel);
    // In a fold that is closed in the HTML (code review S3: with JavaScript off a phone shows one line, not every chapter).
    assert.match(l.list, /^<div class="toc" data-pagefind-ignore="all">\n<details class="contents-fold">\n<summary class="contents-summary"><span aria-hidden="true">&#9776; <\/span>Contents<\/summary>\n<nav /, `${rel}: the fold, closed`);
    // The disclosure buttons are law.js's: none in the HTML, so with JavaScript off there is nothing to press that does nothing.
    assert.doesNotMatch(l.list, /class="tw"|aria-expanded/, `${rel}: no disclosure buttons in the HTML`);
    // "☰ Contents", hidden until law.js wires it, at the top of the page's column: a "you are here"
    // bar that names the reader's chapter (Noel, 2026-11-23), its name starting "Contents".
    const bar = /<div class="main-col">\n(<button type="button" class="contents-open" aria-controls="contents" aria-expanded="false"(?: aria-label="[^"]*")? hidden>[\s\S]*?<\/button>)\n<main id="main">/.exec(html)?.[1];
    assert.ok(bar, `${rel}: the Contents button`);
    assert.match(bar, /^<button[^>]*><svg class="cb-icon" aria-hidden="true"[^>]*>[\s\S]*?<\/svg><span class="contents-word">Contents<\/span>/, `${rel}: the bar starts "Contents"`);
    if (chapter) {
      assert.ok(bar.includes(`Contents</span> <span class="contents-here">${escapeHtml(chapterName(chapter))}</span>`), `${rel}: the bar names ${chapter.citation}`);
      assert.ok(bar.includes(` aria-label="${escapeHtml(`Contents, ${chapterName(chapter)}`)}"`), `${rel}: its name, the words on the bar in order`);
    } else assert.doesNotMatch(bar, /contents-here|aria-label/, `${rel}: no chapter on the bar`);
    // A chapter with no sections is marked, so law.js gives it no button.
    for (const c of site.book.chapters) if (!c.sections.length && c !== chapter) assert.ok(l.list.includes(`<li class="empty"><a href="${c.path}">`), `${rel}: ${c.citation} marked empty`);
    if (!chapter) {
      assert.deepEqual(l.open, [], `${rel}: nothing open`);
      assert.deepEqual(l.pageLinks, [], `${rel}: no current link`);
      return;
    }
    assert.deepEqual(l.open, [{ path: chapter.path, current: section ? "true" : "page" }], `${rel}: its chapter open and current`);
    assert.deepEqual(l.pageLinks, [section ? section.path : chapter.path], `${rel}: aria-current="page" on this page's own link`);
    // Only the open chapter's sections are in the page (the others load when opened).
    const shown = [...l.list.matchAll(/href="(\/charter\/sections\/[^"]+)"/g)].map((m) => m[1]);
    assert.deepEqual(shown, chapter.sections.map((s) => s.path), `${rel}: only its own chapter's sections`);
    if (chapter.sections.length) assert.ok(l.list.includes(`<ul id="toc-${chapter.slug}">`), `${rel}: the open list has the id the button controls`);
    // The tree comes before the law text (Noel, 2026-11-23: navigation at the top), outside main,
    // so the skip link to #main passes it.
    assert.ok(html.indexOf('<div class="toc"') < html.indexOf('<main id="main">'), `${rel}: the tree before main`);
    assert.ok(html.indexOf('<a class="skip" href="#main">') < html.indexOf('<div class="toc"'), `${rel}: the skip link before the tree`);
  };
  for (const s of site.book.sections) check(fileForPath(s.path), { chapter: s.chapter, section: s });
  for (const c of site.book.chapters) check(fileForPath(c.path), { chapter: c });
  for (const sh of site.book.shared) check(fileForPath(sh.path), {});
  // The contents page is that list already; the other pages are not in a book.
  for (const rel of ["charter/index.html", "index.html", "search.html", "about.html", "404.html"]) {
    assert.equal(tree(read(rel)).count, 0, rel);
    assert.doesNotMatch(read(rel), /class="contents-open"/, rel);
  }
  assert.equal(CONTENTS_NAME, "Contents");
  assert.equal(chapterName({ citation: "Preamble", title: "Preamble" }), "Preamble");
  assert.equal(chapterName({ citation: "Chapter 2-A", title: "Districting Commission" }), "Chapter 2-A: Districting Commission");
});

test("contents tree: each chapter's sections are in a small JSON file the tree loads", () => {
  for (const c of site.book.chapters) {
    const f = join(site.outDir, chapterSectionsPath(site.book, c).slice(1));
    if (!c.sections.length) {
      assert.ok(!existsSync(f), `${c.citation}: no file for a chapter with no sections`);
      continue;
    }
    const list = JSON.parse(readFileSync(f, "utf8"));
    assert.deepEqual(list, c.sections.map((s) => [s.path, `${s.citation}. ${s.title}`]), c.citation);
    assert.deepEqual(list, chapterSectionsJson(c));
    // The same names and places as the list the chapter's own pages carry.
    for (const [path, text] of list) assert.ok(read(fileForPath(c.path)).includes(`<a href="${path}">${escapeHtml(text)}</a>`), `${c.citation}: ${text}`);
  }
  assert.equal(chapterSectionsPath(site.book, site.book.chapters.find((c) => c.citation === "Chapter 1") ?? { slug: "1" }), "/charter/contents/1.json");
});

// Noel, 2026-11-23: a chapter page on a wide screen is the whole chapter (mockup B).
test("chapter page: a jump list, then every section's full text in order, each under its own h2", () => {
  for (const c of site.book.chapters) {
    const html = read(fileForPath(c.path));
    if (!c.sections.length) {
      assert.doesNotMatch(html, /class="chapter-text"/, c.citation);
      assert.match(html, /<nys-backtotop>/, `${c.citation}: back to top when there is no Back to contents`);
      continue;
    }
    const jump = html.indexOf('<nav class="jump" aria-labelledby="sections" data-pagefind-ignore="all">\n<h2 id="sections">');
    const text = html.indexOf('<div class="chapter-text" data-pagefind-ignore="all">');
    assert.ok(jump > html.indexOf("<h1>") && text > jump, `${c.citation}: h1, then the jump list, then the text`);
    const copies = [...html.slice(text).matchAll(/<div class="chapter-section" id="s-([^"]+)">\n<h2>([^<]*)<\/h2>\n<p class="sec-tools"><a href="([^"]+)" aria-label="Open this section: ([^"]+)">Open this section<\/a> <button type="button" class="copy-cite" data-cite="([^"]+)" aria-label="Copy citation: ([^"]+)" hidden>Copy citation<\/button> <span class="copy-status" role="status"><\/span><\/p>/g)];
    assert.deepEqual(
      copies.map((m) => [m[1], unescapeHtml(m[2]), m[3], unescapeHtml(m[4]), unescapeHtml(m[5]), unescapeHtml(m[6])]),
      c.sections.map((s) => {
        const name = c.sections.filter((x) => x.citation === s.citation).length > 1 ? `${s.citation}, ${s.title}` : s.citation;
        return [s.slug, `${s.citation}. ${s.title}`, s.path, name, s.fullCitation, name];
      }),
      `${c.citation}: every section, in order`
    );
    // The section's words, every one of them, in the copy.
    for (const s of c.sections) {
      const at = html.indexOf(`<div class="chapter-section" id="s-${s.slug}">`);
      const end = html.indexOf('<div class="chapter-section"', at + 1);
      const copy = html.slice(at, end < 0 ? html.indexOf('<div class="back-wrap">') : end);
      const words = unescapeHtml(copy.replace(/<h2>[\s\S]*?<\/p>\n/, "").replace(/<\/(?:p|h[3-6])>/g, " ").replace(/<[^>]*>/g, "")).replace(/\s+/g, " ").trim();
      if (s.text) assert.equal(words, s.text.replace(/\s+/g, " ").trim(), `${s.citation}: its text`);
      // Subdivision ids carry the section's prefix, so two sections' (a) do not collide.
      for (const b of s.structure.blocks) if (b.anchor) assert.ok(copy.includes(` id="${escapeHtml(copyId(s.slug, b.anchor))}"`), `${s.citation}${b.anchor}: prefixed id`);
      assert.doesNotMatch(copy, /data-block=|data-pagefind-title=/, `${s.citation}: the copy is not read as the chapter's own text`);
    }
    // "Back to contents" goes to the jump list; NYSDS's back-to-top is left off.
    assert.ok(html.includes('<div class="back-wrap"><a class="back-to-contents" href="#sections">Back to contents</a></div>\n</div>'), `${c.citation}: Back to contents, last in the text`);
    assert.doesNotMatch(html, /<nys-backtotop>/, `${c.citation}: one floating button`);
    // Canonical and structured data are the chapter's own.
    assert.equal(attr(html, /<link rel="canonical" href="([^"]*)">/), `${SITE_BASE}${c.path}`);
    const ld = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) => JSON.parse(m[1]));
    assert.deepEqual(ld.map((x) => x["@type"]), ["Legislation", "BreadcrumbList"]);
    assert.equal(ld[0].url, `${SITE_BASE}${c.path}`);
    assert.equal(ld[0].legislationIdentifier, c.fullCitation);
  }
});

test("chapter page: two sections with one number in a chapter get controls with different names", () => {
  const sh = site.book.shared.find((x) => new Set(x.sections.map((s) => s.chapter)).size === 1);
  assert.ok(sh, "the fixtures have two § 530s in one chapter");
  const html = read(fileForPath(sh.sections[0].chapter.path));
  const names = (re) => [...html.matchAll(re)].map((m) => unescapeHtml(m[1]));
  for (const words of ["Open this section", "Copy citation"]) {
    const mine = names(new RegExp(`aria-label="(${words}: ${sh.citation.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?:, [^"]*)?)"`, "g"));
    assert.deepEqual(mine, sh.sections.map((s) => `${words}: ${s.citation}, ${s.title}`), words);
  }
  // A section whose number no other section in its chapter shares keeps the short name.
  const lone = sh.sections[0].chapter.sections.find((s) => s.citation !== sh.citation);
  assert.ok(html.includes(`aria-label="Open this section: ${escapeHtml(lone.citation)}"`));
  // Their subdivision links' names carry the heading too.
  const labels = names(/<a class="num" href="#s-530[^"]*" aria-label="([^"]*)"/g);
  assert.equal(new Set(labels).size, labels.length, `subdivision link names repeat: ${labels.join(" | ")}`);
});

test("chapter page: links in the copies to the same chapter stay on the page; others go to their pages", () => {
  let inPage = 0;
  let away = 0;
  for (const c of site.book.chapters) {
    const html = read(fileForPath(c.path));
    const text = html.slice(html.indexOf('<div class="chapter-text"'));
    if (!text.startsWith("<div")) continue;
    for (const m of text.matchAll(/<a class="(?:num|xref)" href="([^"]*)"/g)) {
      const href = unescapeHtml(m[1]);
      if (href.startsWith("#")) {
        assert.match(href, /^#s-[0-9a-z.-]+(\(.*)?$/, `${c.citation}: ${href}`);
        assert.ok(html.includes(` id="${escapeHtml(href.slice(1))}"`), `${c.citation}: ${href} has its target here`);
        inPage++;
      } else {
        const target = site.book.ordered.find((r) => r.path === href.split("#")[0]);
        if (target) assert.ok(target.chapter !== c, `${c.citation}: ${href} is in this chapter, so it should stay on the page`);
        away++;
      }
    }
  }
  assert.ok(inPage > 20 && away > 20, `${inPage} links on the page, ${away} away`);
});

test("Pagefind: a chapter page's copies of its sections are not indexed (one hit per section)", () => {
  for (const c of site.book.chapters) {
    const html = read(fileForPath(c.path));
    const body = html.slice(html.indexOf("<article class=\"law-page\" data-pagefind-body>"), html.indexOf("</article>"));
    // Everything in the article that is not the chapter's own heading and text is ignored.
    const kept = body.replace(/<nav class="jump" aria-labelledby="sections" data-pagefind-ignore="all">[\s\S]*?<\/nav>/, "").replace(/<div class="chapter-text" data-pagefind-ignore="all">[\s\S]*$/, "");
    assert.doesNotMatch(kept, /chapter-section|class="jump"/, c.citation);
  }
});

test("contents tree over the full Charter: all its chapters on a section page (full index)", { skip: fullCharter() ? false : "data/structure/charter.json not present or not built from this index" }, () => {
  const full = fullCharter();
  const book = loadBook({ corpus: "charter", indexJsonText: full.text, structure: full.structure, versions: full.versions });
  const s = book.sections.find((x) => x.citation === "§ 259") ?? book.sections[0];
  const facts = { currentThrough: "Current through Local Law 1.", copyChangedOn: "today", officialUrl: "https://codelibrary.amlegal.com/codes/newyorkcity/latest/NYCcharter/0-0-0-1", officialBase: "https://codelibrary.amlegal.com/codes/newyorkcity/latest/NYCcharter/", officialName: "The official Charter", creditLine: "Source.", contentsPath: "/charter/" };
  const l = tree(sectionPage(s, book, facts).html);
  assert.equal(l.count, 1);
  assert.deepEqual(l.chapters, book.chapters.map((c) => c.path));
  assert.equal(new Set(l.chapters).size, book.chapters.length);
  const biggest = [...book.chapters].sort((a, b) => b.sections.length - a.sections.length)[0];
  const page = chapterPage(biggest, book, facts).html;
  console.log(`# full Charter: ${book.chapters.length} chapters in the tree; ${Buffer.byteLength(contentsTree(book, { chapter: s.chapter, section: s }))} bytes on ${s.fullCitation}'s page; ${biggest.citation} page ${Buffer.byteLength(page)} bytes`);
  // § 4's history line and editor's note (Noel's example, 2026-11-23).
  const s4 = book.sections.find((x) => x.citation === "§ 4");
  const html = bodyHtml(bodyBlocks(renderSection(s4, s4.structure)), { fullCitation: s4.fullCitation, linkFor: () => null });
  assert.match(html, /<p class="txt history" data-block="1">\(Am\. L\.L\. 2016\/019, 2\/19\/2016, retro\. eff\. 1\/1\/2016; Am\. L\.L\. 2026\/134, 8\/18\/2026, eff\. 1\/1\/2026\)<\/p>/);
  assert.match(html, /<p class="ednote" data-block="2"><strong>Editor&#39;s note:<\/strong> For related unconsolidated provisions/);
  // Every history line in the Charter is one: a whole text block in parentheses, about its making.
  let lines = 0;
  for (const r of book.ordered) for (const b of bodyBlocks(renderSection(r, r.structure))) {
    const t = b.text.trim();
    if (b.type === "text" && t.startsWith("(") && t.endsWith(")")) {
      assert.ok(isHistoryLine(b), `${r.citation}: ${t.slice(0, 60)}`);
      lines++;
    }
  }
  assert.ok(lines > 250, `${lines} history lines`);
});

test("notes: the amendment history line and the editor's note, words unchanged", () => {
  const yes = [
    "(Am. L.L. 2016/019, 2/19/2016, retro. eff. 1/1/2016; Am. L.L. 2026/134, 8/18/2026, eff. 1/1/2026)",
    "(L.L. 2019/215, 12/20/2019, eff. 12/20/2019)",
    "( L.L. 2018/001, 1/1/2018)",
    "(Repealed L.L. 2023/069, 5/29/2023, eff. 6/28/2023)",
    "(2019 N.Y. Laws Ch. 98, 7/15/2019, eff. 7/15/2019)",
    "(Added City Record 6/23/2017, eff. 7/23/2017)",
    "( Amended City Record 3/1/2020, eff. 4/1/2020)",
  ];
  const no = ["(The board may adopt rules.)", "(Tenant Signature)", "(§ 11-605(1), Administrative Code)", "(a) Reducing harm", "Am. L.L. 2016/019 (no parentheses)", "(Am. L.L. 2016/019 and more"];
  for (const text of yes) assert.ok(isHistoryLine({ type: "text", text }), text);
  for (const text of no) assert.ok(!isHistoryLine({ type: "text", text }), text);
  assert.ok(!isHistoryLine({ type: "subdivision", text: yes[0], label: "a." }), "a subdivision is never a history line");
  assert.ok(!isHistoryLine({ type: "note", text: yes[0] }), "nor is a note");
  const html = bodyHtml(
    [
      { type: "text", text: "The mayor shall be elected." },
      { type: "text", text: yes[0] },
      { type: "note", text: "Editor's note: see L.L. 2002/027." },
      { type: "note", text: "* Editor's note: the asterisk stays outside." },
      { type: "note", text: "A note with no lead." },
    ],
    { fullCitation: "NYC Charter § 4", linkFor: () => null }
  );
  assert.match(html, /<p class="txt" data-block="0">The mayor/);
  assert.match(html, /<p class="txt history" data-block="1">\(Am\./);
  assert.match(html, /<p class="ednote" data-block="2"><strong>Editor&#39;s note:<\/strong> see L\.L\. 2002\/027\.<\/p>/);
  assert.match(html, /<p class="ednote" data-block="3">\* <strong>Editor&#39;s note:<\/strong> the asterisk stays outside\.<\/p>/);
  assert.match(html, /<p class="ednote" data-block="4">A note with no lead\.<\/p>/);
  // The words are the same with the tags removed.
  const shown = readBlocks(html, unescapeHtml).map((b) => b.text);
  assert.deepEqual(shown, ["The mayor shall be elected.", yes[0], "Editor's note: see L.L. 2002/027.", "* Editor's note: the asterisk stays outside.", "A note with no lead."]);
  // law.css styles both: the history line set off by a rule, the note in a gray box.
  const css = readFileSync(join(ROOT, "site", "assets", "law.css"), "utf8");
  assert.match(css, /\.law \.history \{[^}]*border-top:[^}]*\}/);
  assert.match(css, /\.law \.ednote \{[^}]*background: var\(--light\)[^}]*\}/);
});

test("the search box is on the home page and the search page only, its hint as placeholder text", () => {
  const withBox = htmlFiles().filter((f) => read(relative(site.outDir, f)).includes("<nys-textinput")).map((f) => relative(site.outDir, f)).sort();
  assert.deepEqual(withBox, ["index.html", "search.html"]);
  assert.equal((read("index.html").match(/<div class="find"/g) ?? []).length, 1, "the strip on the home page");
  assert.doesNotMatch(read("search.html"), /<div class="find"/, "the search page has its own box, not the strip");
  for (const rel of withBox) {
    const tag = /<nys-textinput[^>]*>/.exec(read(rel))[0];
    assert.match(tag, / label="Go to a section, or search the words"/, `${rel}: a visible label is its name`);
    assert.match(tag, / placeholder="Try &quot;§ 259&quot;, &quot;259&quot;, or &quot;budget office&quot;"/, rel);
    assert.doesNotMatch(tag, / description=/, `${rel}: no separate hint line`);
    assert.match(read(rel), /<noscript><p class="nojs">Search needs JavaScript. <a href="\/charter\/">Browse the Charter's contents<\/a> instead.<\/p><\/noscript>/, rel);
  }
  // Every page keeps the top bar's Search link.
  for (const f of htmlFiles()) assert.match(read(relative(site.outDir, f)), /<li><a href="\/search"(?: aria-current="page")?>Search<\/a><\/li>/, relative(site.outDir, f));
});

// Every font family a stylesheet names, as [declaration, problem]: font-family (and any custom
// property named for a font family) must be exactly the template's var(--font-body) or
// var(--font-head), or inherit; a font shorthand must end with one of them after its size
// (code review S4: the old check passed a single bare family such as Arial or system-ui).
const TEMPLATE_FAMILY = /^(?:var\(--font-(?:body|head)\)|inherit)$/;
function fontFamilyProblems(cssText) {
  const css = cssText.replace(/\/\*[\s\S]*?\*\//g, "");
  const out = [];
  for (const m of css.matchAll(/(?:^|[\s;{])((?:--[\w-]*font-family[\w-]*|font-family|font)\s*:\s*([^;}]*))/g)) {
    const [decl, value] = [m[1].trim(), m[2].trim().replace(/\s*!important$/, "")];
    if (/^font\s*:/.test(decl)) {
      if (value === "inherit") continue;
      // [style] [weight] size[/line-height] family: the family is what follows the size.
      const sm = /(?:^|\s)[\d.]+(?:px|em|rem|%|pt|vh|vw|ch)(?:\/[\d.]+(?:px|em|rem|%)?)?\s+(.+)$/.exec(value);
      if (!sm || !TEMPLATE_FAMILY.test(sm[1].trim())) out.push([decl, "font shorthand without one of the template's families"]);
    } else if (!TEMPLATE_FAMILY.test(value)) out.push([decl, "a family that is not the template's"]);
  }
  return out;
}

test("the law text uses the template's body font, not a second family", () => {
  const css = readFileSync(join(ROOT, "site", "assets", "law.css"), "utf8");
  assert.doesNotMatch(css.replace(/\/\*[\s\S]*?\*\//g, ""), /--font-law|Georgia|Times New Roman|\bserif\b/);
  assert.match(css, /\.law \{ font: 18px\/1\.7 var\(--font-body\);/);
  // Every font family in law.css is one of the template's.
  assert.deepEqual(fontFamilyProblems(css), []);
  // The check catches any other family, alone or in a list, in a font-family or a font shorthand.
  for (const bad of [
    ".law { font-family: Arial; }",
    ".x { font-family: system-ui; }",
    ".law { font: 18px/1.7 Georgia; }",
    ".law { font: 700 17px/1.3 Inter, var(--font-head); }",
    '.law { font-family: "Inter", sans-serif; }',
    ".x { font-family: var(--font-body), sans-serif; }",
    ":root { --nys-font-family-ui: Helvetica; }",
    ".x { font: 16px var(--font-mono); }",
  ]) assert.equal(fontFamilyProblems(bad).length, 1, bad);
  for (const good of [".x { font-family: var(--font-body); }", ".x { font: 700 17px/1.3 var(--font-head); }", ".x { font-weight: 700; font-size: 15px; }", ":root { --nys-font-family-ui: var(--font-body); }", ".x { font-family: inherit; }"]) {
    assert.deepEqual(fontFamilyProblems(good), [], good);
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
  await assert.rejects(buildSite({ indexDir: d.indexDir, structureDir: d.structureDir, outDir: out, search: false, now: FIXED_NOW, books: ["charter"] }), /not clearing it/);
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
