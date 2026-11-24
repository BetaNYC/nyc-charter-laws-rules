// The Administrative Code's layout on the committed data (issue #65): npm run test:site-data.
//
// NOT part of npm test, on purpose. The daily refresh (refresh-data.yml) runs npm test on the
// freshly rebuilt index before it commits; a new title or a new year of local laws must never turn
// that red, or the MCP server stops getting new law text. These tests run in test.yml and before
// a deploy (deploy-site.yml), where a surprise in the data's shape should stop the website, not
// the data. Every count is worked out from the data; nothing pins today's numbers.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { loadBook, PART_MAX_SECTIONS, PART_MAX_CHARS, linkHref, linkTarget } from "../../scripts/lib/site/model.js";
import {
  titlesTree,
  titleChaptersJson,
  adminSectionPage,
  adminPartPage,
  adminChapterPage,
  adminTitlePage,
  adminContentsPage,
  sectionLine,
  adminPageMakers,
} from "../../scripts/lib/site/pages-admin.js";
import { homePage, aboutPage, searchPage, notFoundPage, bookNames } from "../../scripts/lib/site/pages.js";
import { siteFacts } from "../../scripts/lib/site/build.js";
import { redirectsJson } from "../../scripts/lib/site/outputs.js";
import { redirectFor, redirectChoices } from "../../site/assets/not-found.js";
import { unescapeHtml } from "../../scripts/lib/site/html.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const INDEX = join(ROOT, "data", "index", "json");
const STRUCTURE = join(ROOT, "data", "structure");
const VERSIONS = JSON.parse(readFileSync(join(INDEX, "versions.json"), "utf8"));

function loadReal(corpus) {
  if (!existsSync(join(STRUCTURE, `${corpus}.json`))) return null;
  const indexText = readFileSync(join(INDEX, `${corpus}.json`), "utf8");
  const structure = JSON.parse(readFileSync(join(STRUCTURE, `${corpus}.json`), "utf8"));
  if (structure.indexSha256 !== createHash("sha256").update(indexText).digest("hex")) return null;
  return { book: loadBook({ corpus, indexJsonText: indexText, structure, versions: VERSIONS }), structure, index: JSON.parse(indexText) };
}
const real = loadReal("admin_code");
const book = real?.book;
const charter = loadReal("charter")?.book;
const skip = book ? false : "data/structure/admin_code.json is missing or was built from other text";
const DATA_SOURCES = JSON.parse(readFileSync(join(ROOT, "DATA-SOURCES.json"), "utf8"));
const n = (x) => x.toLocaleString("en-US");

// What the data says, worked out without the site's code: the publisher's Title records that
// hold a chapter or a section, and the year chapters ("2016") that sit in no title.
function expected() {
  const { structure, index } = real;
  const isTitle = (id) => structure.groups[id]?.level === "Title";
  const chapterIds = new Set(structure.sections.filter((s) => s.level === "Chapter").map((s) => s.id));
  const titles = new Set();
  let yearChapters = 0;
  const direct = new Map();
  structure.sections.forEach((s, i) => {
    if (s.level === "Chapter") {
      const t = s.parents.find(isTitle);
      if (t) titles.add(structure.groups[t].label);
      else if (/^\d{4}$/.test(index[i].citation)) yearChapters++;
      return;
    }
    if (!s.parents.some((p) => chapterIds.has(p))) {
      const t = [...s.parents].reverse().find(isTitle);
      titles.add(structure.groups[t].label);
      direct.set(structure.groups[t].label, (direct.get(structure.groups[t].label) ?? 0) + 1);
    }
  });
  return {
    numbered: titles.size,
    groups: titles.size + (yearChapters ? 1 : 0),
    yearChapters,
    chapters: chapterIds.size,
    sections: structure.sections.length - chapterIds.size,
    direct,
  };
}

const SITE = () => siteFacts([book], DATA_SOURCES).perBook.get("admin_code");

test("titles: the publisher's Title records, plus one group for the year chapters, every record placed once", { skip }, () => {
  const e = expected();
  assert.equal(book.titles.filter((t) => !t.synthetic).length, e.numbered);
  assert.equal(book.titles.length, e.groups);
  if (e.yearChapters) {
    assert.equal(book.titles.at(-1).slug, "local-laws");
    assert.equal(book.titles.at(-1).chapters.length, e.yearChapters);
  }
  assert.equal(book.chapters.length, e.chapters);
  assert.equal(book.sections.length, e.sections);
  const placed = book.ordered.map((r) => r.id);
  assert.equal(placed.length, book.records.length);
  assert.equal(new Set(placed).size, book.records.length);
  // Titles in number order: 16 before 16-A before 17.
  const keys = book.titles.filter((t) => !t.synthetic).map((t) => /^(\d+)(?:-([A-Z]+))?$/i.exec(t.number));
  for (let i = 1; i < keys.length; i++) {
    const [a, b] = [keys[i - 1], keys[i]];
    assert.ok(Number(a[1]) < Number(b[1]) || (Number(a[1]) === Number(b[1]) && (a[2] ?? "") < (b[2] ?? "")), `${a[0]} before ${b[0]}`);
  }
  // A title whose sections sit in no chapter holds them itself.
  for (const [label, count] of e.direct) {
    const t = book.titles.find((x) => x.citation === label);
    assert.equal(t.sections.length, count, label);
    assert.ok(t.sections.every((s) => s.chapter === t));
  }
});

test("titles agree with get_title (src/corpus.ts chapterGroups) for every numbered chapter", { skip }, async () => {
  const { chapterGroups } = await import("../../dist/corpus.js");
  let checked = 0;
  for (const g of chapterGroups("admin_code")) {
    if (g.kind !== "Chapter" || !g.title) continue;
    const c = book.byId.get(g.records[0].id);
    assert.ok(c?.titleNode, `${g.records[0].id} is a chapter on the site`);
    const num = c.titleNode.number.toLowerCase();
    // A lettered title's sections are numbered in its parent (§ 16-501 is in Title 16-A).
    assert.ok(num === g.title.toLowerCase() || num.replace(/-[a-z]+$/, "") === g.title.toLowerCase(), `${c.heading}: Title ${c.titleNode.number}, get_title says ${g.title}`);
    checked++;
  }
  assert.ok(checked > 0);
});

test("parts respect the caps and cover each split chapter in order", { skip }, () => {
  for (const p of book.parts) {
    const chars = p.sections.reduce((m, s) => m + s.text.length, 0);
    assert.ok(p.sections.length <= PART_MAX_SECTIONS);
    assert.ok(chars <= PART_MAX_CHARS || p.sections.length === 1, `${p.path}: ${chars} characters in ${p.sections.length} sections`);
  }
  const holders = [...book.titles, ...book.chapters].filter((x) => x.sections.length);
  for (const h of holders) {
    const chars = h.sections.reduce((m, s) => m + s.text.length, 0);
    assert.equal(!!h.parts, h.sections.length > PART_MAX_SECTIONS || chars > PART_MAX_CHARS, `${h.path} is split exactly when it is too big`);
    if (!h.parts) continue;
    assert.deepEqual(h.parts.flatMap((p) => p.sections), h.sections);
    assert.equal(h.parts[0].prev, null);
    assert.equal(h.parts.at(-1).next, null);
  }
});

test("references to the Charter link only when the build has it; a shared-number target's name tells it apart", { skip }, () => {
  const s = book.sections.find((x) => x.structure.links?.some((l) => l.to?.corpus === "charter" && l.to.id && !l.to.ambiguous && l.to.resolved !== false));
  if (s && charter) {
    const to = s.structure.links.find((l) => l.to?.corpus === "charter" && l.to.id && !l.to.ambiguous && l.to.resolved !== false).to;
    assert.equal(linkHref(to, book, s), null);
    assert.match(linkHref(to, { ...book, others: new Map([["charter", charter]]) }, s), /^\/charter\/sections\//);
  }
  for (const sh of book.shared) {
    const labels = sh.sections.map((t) => linkTarget({ corpus: "admin_code", id: t.id }, book, null).label);
    assert.equal(new Set(labels).size, labels.length, `links to ${sh.citation} have distinct names: ${labels.join(" | ")}`);
  }
});

test("the tree lists every title as a link, opens only the reader's title, chapter and part, and stays small", { skip }, () => {
  const s = book.sections.find((x) => x.part) ?? book.sections[0];
  const title = s.chapter.kind === "title" ? s.chapter : s.chapter.titleNode;
  const html = titlesTree(book, { title, chapter: s.chapter, part: s.part, section: s, here: s.path });
  for (const t of book.titles) assert.ok(html.includes(`<a href="${t.path}"`), t.path);
  assert.equal((html.match(/<ul id="toc-/g) ?? []).length, 1);
  assert.ok(html.includes(`<ul id="toc-${title.slug}">`));
  const other = book.titles.find((t) => t !== title && t.chapters.length);
  assert.ok(!html.includes(`${other.path}/chapters/`), "another title's chapters are not in the page");
  assert.ok(html.includes(`href="${s.path}" aria-current="page"`));
  if (s.part) {
    assert.ok(html.includes(`href="${s.part.path}" aria-current="true"`));
    const elsewhere = s.chapter.parts.find((p) => p !== s.part);
    assert.ok(!html.includes(`href="${elsewhere.sections[0].path}"`), "another part's sections are not in the page");
  }
  assert.equal((html.match(/role="status"/g) ?? []).length, 1);
  assert.ok(!/<button(?![^>]*contents-hide)/.test(html), "no buttons in the HTML: law.js adds them");
  assert.ok(Buffer.byteLength(html) < 40_000, `tree is ${Buffer.byteLength(html)} bytes`);
});

test("each title's JSON lists its own sections (or parts), then its chapters, as [path, name]", { skip }, () => {
  for (const t of book.titles) {
    const list = titleChaptersJson(t);
    const own = t.sections.length ? (t.parts ? t.parts.length : t.sections.length) : 0;
    assert.equal(list.length, own + t.chapters.length, t.path);
    if (t.chapters.length) assert.deepEqual(list[own], [t.chapters[0].path, t.chapters[0].name]);
    if (t.sections.length && !t.parts) assert.deepEqual(list[0], [t.sections[0].path, sectionLine(t.sections[0])]);
  }
});

test("pages: a part has its heading, parts list and previous/next part; a split chapter has no section text", { skip }, () => {
  const c = book.chapters.find((x) => x.parts && x.parts.length >= 3);
  if (!c) return;
  const p2 = c.parts[1];
  const part = adminPartPage(p2, book, SITE()).html;
  assert.ok(part.includes(`part 2 of ${c.parts.length}</span></h1>`));
  assert.ok(part.includes(`href="${p2.path}" aria-current="page"`));
  assert.ok(part.includes(`aria-label="Previous and next part"`));
  assert.ok(part.includes(`href="${c.parts[0].path}"><small>Previous</small>`));
  assert.ok(part.includes(`href="${c.parts[2].path}"><small>Next</small>`));
  for (const s of p2.sections) assert.ok(part.includes(`id="s-${s.slug}"`), s.citation);
  assert.ok(!part.includes(`id="s-${c.parts[0].sections[0].slug}"`));
  const chapter = adminChapterPage(c, book, SITE()).html;
  assert.ok(!chapter.includes(`class="chapter-text"`));
  for (const p of c.parts) assert.ok(chapter.includes(`href="${p.path}"`));
});

test("pages: a title page lists its chapters without JavaScript; a section page carries title and chapter crumbs", { skip }, () => {
  const t = book.titles.find((x) => !x.synthetic && x.chapters.length);
  const title = adminTitlePage(t, book, SITE()).html;
  for (const c of t.chapters) assert.ok(title.includes(`<a href="${c.path}">`), c.path);
  const s = t.chapters[0].sections[0];
  const sec = adminSectionPage(s, book, SITE()).html;
  assert.ok(sec.includes(`<li><a href="${t.path}">${t.citation}</a></li>`));
  assert.ok(sec.includes(`<li><a href="${s.chapter.path}">${s.chapter.citation}</a></li>`));
});

test("the front page: one card per title, linking to its page, counted; no chapters listed; the lede from the data", { skip }, () => {
  const e = expected();
  const html = adminContentsPage(book, SITE()).html;
  const main = html.slice(html.indexOf("<main"), html.indexOf("</main>"));
  const cards = [...main.matchAll(/<li><a href="([^"]+)"><span class="tc-top"><span class="tc-num">(.*?)<\/span><span class="tc-name">(.*?)<\/span><span class="tc-count">(.*?)<\/span><\/span><\/a><\/li>/g)];
  assert.equal(cards.length, book.titles.length);
  cards.forEach((m, i) => {
    const t = book.titles[i];
    assert.equal(m[1], t.path);
    assert.equal(unescapeHtml(m[3]), t.title);
    assert.equal(m[2], t.synthetic ? "" : `<span class="vh">Title </span>${t.number}`);
    const k = t.chapters.length || t.sections.length;
    assert.equal(m[4], `${k} ${t.chapters.length ? "chapter" : "section"}${k === 1 ? "" : "s"}`);
  });
  assert.doesNotMatch(main, /\/chapters\//);
  const lede = `Pick a title to see its chapters. ${e.numbered} titles${e.yearChapters ? " plus local laws by year" : ""}: ${n(e.chapters)} chapters, ${n(e.sections)} sections.`;
  assert.ok(main.includes(`<p class="lede">${lede}</p>`), lede);
  const hrefs = [...main.matchAll(/<a href="([^"]+)"/g)].map((m) => m[1]);
  assert.equal(new Set(hrefs).size, hrefs.length);
});

test("redirects: a record id or a title's id lands on its page; an id in both books offers both", { skip }, () => {
  const r = redirectsJson(charter ? [charter, book] : [book]);
  const c = book.chapters[0];
  assert.equal(redirectFor(`/admin-code/${c.id}`, r), c.path);
  assert.equal(redirectFor(`/NYCadmin/${c.id}`, r), c.path);
  const t = book.titles.find((x) => /^\d+-\d+-\d+-\d+$/.test(x.id));
  assert.equal(redirectFor(`/admin-code/${t.id}`, r), t.path);
  if (!charter) return;
  const both = book.records.find((x) => charter.byId.has(x.id));
  if (!both) return;
  assert.equal(redirectFor(`/${both.id}`, r), null, "a bare id in both books goes to neither");
  assert.deepEqual(redirectChoices(`/${both.id}`, r).map((x) => x.book), ["charter", "admin-code"]);
  assert.equal(redirectFor(`/admin-code/${both.id}`, r), both.path, "the path's book decides");
  assert.equal(redirectFor(`/charter/${both.id}`, r), charter.byId.get(both.id).path);
});

test("with both books: home offers both, says the Rules are coming; About says references link", { skip }, () => {
  if (!charter) return;
  const e = expected();
  const { shared: site } = siteFacts([charter, book], DATA_SOURCES);
  assert.equal(bookNames([charter, book]), "Charter and Administrative Code");
  const home = homePage(charter, site, [book]).html;
  assert.ok(home.includes(`<a class="button" href="/charter/">Browse the Charter</a> <a class="button" href="/admin-code/">Browse the Administrative Code</a>`));
  assert.ok(home.includes("The Rules of the City of New York are still to come"));
  assert.doesNotMatch(home, /working to parse and display the Administrative Code/);
  assert.ok(home.includes(`New York City Administrative Code</a>: ${e.numbered} titles${e.yearChapters ? " plus local laws by year" : ""}, ${n(e.chapters)} chapters, ${n(e.sections)} sections.`));
  assert.ok(home.includes("<title>BetaNYC Law Reader: the NYC Charter and Administrative Code, section by section</title>"));
  assert.ok(home.includes(`<a href="/charter/">Browse the Charter's contents</a> or <a href="/admin-code/">the Administrative Code's contents</a>`));
  assert.ok(home.includes(`>the official Administrative Code</a>`), "the home page's box names both official texts");
  const about = aboutPage(charter, site, { paragraphs: ["Built by BetaNYC."], metadata: { builtOnLong: "November 23, 2026" }, others: [book] }).html;
  assert.ok(about.includes("References between the Charter and the Administrative Code are links."));
  assert.doesNotMatch(about, /References into the Administrative Code and the Rules are plain text/);
  assert.ok(about.includes("“Local laws by year”"));
  assert.ok(searchPage(charter, site, [book]).html.includes("Search the New York City Charter and Administrative Code by section number or by words."));
  assert.ok(notFoundPage(charter, site, [book]).html.includes(`<a href="/admin-code/">the Administrative Code's contents</a>`));
});

// The repo's rule (test/site/a11y-tree.mjs): no two controls share a name, and one link name never
// goes to two places. Read from the HTML of every Admin Code page, in memory: a link's name is its
// aria-label or its text. The browser test checks a sample in the accessibility tree.
test("every Admin Code page: one link name never goes to two places; no two buttons or copy links share a name", { skip }, () => {
  if (!charter) return;
  const { perBook } = siteFacts([charter, book], DATA_SOURCES);
  const both = { ...book, others: new Map([["charter", charter]]) };
  const text = (s) => unescapeHtml(s.replace(/<[^>]+>/g, "")).replace(/\s+/g, " ").trim().toLowerCase();
  const problems = [];
  for (const make of adminPageMakers(both, perBook.get("admin_code"))) {
    const p = make();
    const byName = new Map();
    for (const m of p.html.matchAll(/<a ([^>]*)>([\s\S]*?)<\/a>/g)) {
      const href = /href="([^"]*)"/.exec(m[1])?.[1];
      const label = /aria-label="([^"]*)"/.exec(m[1])?.[1];
      const name = label !== undefined ? text(label) : text(m[2]);
      if (!href || !name) continue;
      if (!byName.has(name)) byName.set(name, new Set());
      byName.get(name).add(href);
    }
    for (const [name, hrefs] of byName) if (hrefs.size > 1) problems.push(`${p.path}: "${name}" goes to ${[...hrefs].join(" | ")}`);
    const buttons = [...p.html.matchAll(/<button [^>]*aria-label="([^"]*)"/g)].map((m) => text(m[1]));
    const dup = buttons.filter((b, i) => buttons.indexOf(b) !== i);
    if (dup.length) problems.push(`${p.path}: buttons share ${dup.join(", ")}`);
  }
  assert.deepEqual(problems.slice(0, 20), [], `${problems.length} pages with a shared name`);
});
