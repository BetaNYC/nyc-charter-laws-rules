// The Rules of the City of New York on the site (issue #65, after #59): paths and citations from
// each record's title, grouping by title, the pages to pick one, and the fallback for an index
// built before 0.7.0.
//
// Built from the hand-made Rules fixtures (test/fixtures/titles/rules/, the publisher's shape,
// not its text) and the Charter fixtures, without Pagefind. Part of npm test, which the daily
// refresh runs, so nothing here reads the committed law data (CS-23). The layout on the real data
// is checked by test/site-data/rules-layout.test.js, and in a browser by test/site/rules.test.mjs.

import { test, before } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync, readdirSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { buildRulesFixtureSite, buildRulesFixtureData, ROOT } from "./site/fixture-site.mjs";
import { rulesReady, rcnyForm, localCitation, rulesChapterSlug, linkHref, linkTarget, adminChapterKey } from "../scripts/lib/site/model.js";
import { parseQuery, lookup, citationKeys } from "../site/assets/jump.js";
import { redirectFor, redirectChoices, rulesNumberFor } from "../site/assets/not-found.js";
import { officialLinks, possessive, listOf, bottomBox } from "../scripts/lib/site/layout.js";
import { unescapeHtml } from "../scripts/lib/site/html.js";

let site, rules, charter;
before(async () => {
  site = await buildRulesFixtureSite();
  rules = site.books.find((b) => b.corpus === "rules");
  charter = site.books.find((b) => b.corpus === "charter");
});

const read = (rel) => readFileSync(join(site.outDir, rel), "utf8");
const fileOf = (path) => (path.endsWith("/") ? path.slice(1) + "index.html" : path.slice(1) + ".html");
const page = (path) => read(fileOf(path));
// The citation in a page's h1: its .cite, or the whole h1 when the record has no heading of its own.
const h1Cite = (html) => unescapeHtml(/<h1><span class="cite">([^<]*)<\/span>/.exec(html)?.[1] ?? /<h1>([^<]*)<\/h1>/.exec(html)?.[1] ?? "");
const byId = (id) => rules.byId.get(id);
function allFiles(dir, out = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) allFiles(p, out);
    else out.push(p);
  }
  return out;
}

test("the Rules are built when every record names its title, as a third book", () => {
  assert.deepEqual(site.books.map((b) => b.book.slug), ["charter", "rules"]);
  assert.deepEqual(site.skipped, {});
  assert.ok(existsSync(join(site.outDir, "rules", "index.html")));
  // One page per record, under its title.
  for (const r of rules.ordered) assert.ok(existsSync(join(site.outDir, fileOf(r.path))), `${r.fullCitation} has no page at ${r.path}`);
});

test("titles come from each record's titleNumber, not from the Title records around it", () => {
  assert.deepEqual(rules.titles.map((t) => t.number), ["15", "24", "30", "38-A", "48", "62"]);
  assert.deepEqual(rules.titles.map((t) => t.path), ["/rules/titles/15", "/rules/titles/24", "/rules/titles/30", "/rules/titles/38-a", "/rules/titles/48", "/rules/titles/62"]);
  const t24 = rules.titles.find((t) => t.number === "24");
  // The Health Code (no number, no anchor) and Chapter 3 (its anchor says Title 24, its file has no
  // Title record) are both in Title 24.
  assert.deepEqual(t24.chapters.map((c) => c.citation), ["Chapter 1", "Chapter 3", "New York City Health Code"]);
  assert.equal(t24.name, "Title 24: Department of Health and Mental Hygiene");
  const t30 = rules.titles.find((t) => t.number === "30");
  assert.deepEqual(t30.chapters.map((c) => c.path), [
    "/rules/titles/30/chapters/1",
    "/rules/titles/30/chapters/apartment-loft-order-49-2017",
    "/rules/titles/30/chapters/apartment-loft-order-50-2018",
  ]);
  for (const t of rules.titles) for (const c of t.chapters) assert.equal(c.titleNumber, t.number);
});

test("paths: /rules/titles/<title>/sections/<number>; a number the title repeats gets the id and a page to pick one", () => {
  assert.deepEqual(
    rules.sections.map((s) => s.path),
    [
      "/rules/titles/15/sections/1-01",
      "/rules/titles/15/sections/18-11",
      "/rules/titles/24/sections/1-01",
      "/rules/titles/24/sections/3-01",
      "/rules/titles/24/sections/81.08",
      "/rules/titles/30/sections/1-01",
      "/rules/titles/30/sections/notice-0-0-0-61",
      "/rules/titles/30/sections/notice-0-0-0-71",
      "/rules/titles/38-a/sections/1-01",
      "/rules/titles/38-a/sections/2-01",
      "/rules/titles/48/sections/3-112",
      "/rules/titles/62/sections/6-01-0-0-0-102",
      "/rules/titles/62/sections/6-01-0-0-0-111",
    ]
  );
  assert.deepEqual(rules.shared.map((sh) => [sh.path, sh.sections.map((s) => s.id)]), [
    ["/rules/titles/30/sections/notice", ["0-0-0-61", "0-0-0-71"]],
    ["/rules/titles/62/sections/6-01", ["0-0-0-102", "0-0-0-111"]],
  ]);
  // § 1-01 is in four titles: one page to pick from, by title.
  assert.deepEqual(rules.picks.map((p) => [p.path, p.sections.map((s) => s.fullCitation)]), [
    ["/rules/sections/1-01", ["15 RCNY § 1-01", "24 RCNY § 1-01", "30 RCNY § 1-01", "38-A RCNY § 1-01"]],
  ]);
  const html = page("/rules/sections/1-01");
  assert.equal(h1Cite(html), "NYC Rules § 1-01");
  // A whole heading, not "in 4 titles" alone (Noel, 2026-11-26).
  assert.match(html, /<h1><span class="cite">NYC Rules § 1-01<\/span> <span class="heading">§ 1-01 is in 4 titles<\/span><\/h1>/);
  assert.match(html, /<title>NYC Rules § 1-01 is in 4 titles/);
  for (const s of rules.picks[0].sections) assert.ok(html.includes(`<a href="${s.path}">${s.fullCitation}. ${s.title}</a>`), s.path);
  assert.match(html, /<li>Title 38-A: Civilian Complaint Review Board\n<ul>/);
  // A number in one title only: the 404 page sends /rules/sections/<n> to it, from numbers.json.
  const numbers = JSON.parse(read("rules/numbers.json"));
  assert.equal(numbers["81.08"], "/rules/titles/24/sections/81.08");
  assert.equal(numbers.notice, "/rules/titles/30/sections/notice");
  assert.equal(numbers["1-01"], undefined, "a number in several titles has its own page");
  const notice = page("/rules/titles/30/sections/notice");
  assert.match(notice, /2 records share this citation/);
  assert.match(notice, /Title 30: Rent Guidelines Board has 2 records cited Notice/);
});

test("citations name the title: 15 RCNY § 1-01, the Health Code, and the chapter where the title repeats a citation", () => {
  const cites = Object.fromEntries(rules.ordered.map((r) => [r.id, r.fullCitation]));
  assert.equal(cites["0-0-0-12"], "15 RCNY § 1-01");
  assert.equal(cites["0-0-0-41"], "24 RCNY Health Code § 81.08");
  assert.equal(cites["0-0-0-20"], "15 RCNY Chapter 18");
  assert.equal(cites["0-0-0-40"], "24 RCNY New York City Health Code");
  assert.equal(cites["0-0-0-61"], "30 RCNY Apartment & Loft Order #49 (2017), Notice");
  assert.equal(cites["0-0-0-102"], "62 RCNY Chapter 5, § 6-01");
  assert.equal(cites["0-0-0-82"], "38-A RCNY § 1-01");
  for (const r of rules.ordered) {
    const html = page(r.path);
    assert.equal(h1Cite(html), r.fullCitation, `${r.path}: the heading's citation, which Copy citation copies`);
    assert.ok(html.startsWith("<!DOCTYPE html>") && html.includes(`<title>${r.fullCitation.replace(/&/g, "&amp;")}`), `${r.path}: <title> starts with the citation`);
    const meta = unescapeHtml(/data-pagefind-meta="title\[content\]" content="([^"]*)"/.exec(html)?.[1] ?? "");
    assert.ok(meta.startsWith(r.fullCitation), `${r.path}: search title "${meta}"`);
    assert.doesNotMatch(meta, /^§/);
  }
  // Copy citation on a chapter page copies each section's full citation.
  const ch = page("/rules/titles/62/chapters/5");
  assert.deepEqual([...ch.matchAll(/data-cite="([^"]*)"/g)].map((m) => m[1]), ["62 RCNY Chapter 5, § 6-01"]);
  // The picture and no-text notes name the record the same way.
  assert.doesNotMatch(read(fileOf(byId("0-0-0-12").path)), /Read § 1-01 at/);
});

test("the RCNY form is one get_section takes, and finds what fullCitation finds", () => {
  // src/corpus.ts on the same fixture index, in its own process (NYC_LAWS_INDEX_DIR).
  const dir = mkdtempSync(join(tmpdir(), "law-reader-rules-index-"));
  try {
    const d = buildRulesFixtureData();
    writeFileSync(join(dir, "rules.json"), d.json);
    writeFileSync(join(dir, "charter.json"), "[]");
    writeFileSync(join(dir, "admin_code.json"), "[]");
    const v = (n) => ({ currentThrough: "test", indexedAt: "2026-11-24T00:00:00Z", sectionCount: n });
    writeFileSync(join(dir, "versions.json"), JSON.stringify({ charter: v(0), admin_code: v(0), rules: v(d.sections.length) }));
    const pairs = rules.ordered.map((r) => [r.id, r.fullCitation]);
    const code = `const c = await import(${JSON.stringify(pathToFileURL(join(ROOT, "dist", "corpus.js")).href)});
      const ids = (r) => r.kind === "match" ? [r.section.id] : r.kind === "ambiguous" ? r.candidates.map((s) => s.id) : [];
      const out = {};
      for (const [id, site] of ${JSON.stringify(pairs)}) {
        const own = c.getSection(id === "0-0-0-41" ? "Health Code § 81.08" : site, "rules");
        const rec = (own.kind === "match" ? [own.section] : own.kind === "ambiguous" ? own.candidates : []).find((s) => s.id === id);
        out[id] = { site: ids(c.getSection(site, "rules")), full: rec ? ids(c.getSection(c.fullCitation(rec), "rules")) : null };
      }
      console.log(JSON.stringify(out));`;
    const env = { ...process.env, NYC_LAWS_INDEX_DIR: dir };
    const r = spawnSync(process.execPath, ["--input-type=module", "-e", code], { env, cwd: ROOT, encoding: "utf8" });
    assert.equal(r.status, 0, r.stderr);
    const out = JSON.parse(r.stdout);
    for (const [id, cite] of pairs) {
      assert.deepEqual(out[id].site, [id], `get_section("${cite}") finds ${id} and only it`);
      assert.deepEqual(out[id].site, out[id].full, `${cite}: same answer as fullCitation's form`);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("citation helpers: the RCNY form, a record's name in its chapter, chapter slugs", () => {
  assert.equal(rcnyForm("Title 15, Chapter 18", "15"), "15 RCNY Chapter 18");
  assert.equal(rcnyForm("15 RCNY § 1-01", "15"), "15 RCNY § 1-01");
  assert.equal(rcnyForm("Title 62, Chapter 5, § 6-01", "62"), "62 RCNY Chapter 5, § 6-01");
  assert.equal(localCitation("Title 19, Chapter 55, Schedule A", "19", { citation: "Chapter 55" }), "Schedule A");
  assert.equal(localCitation("New York City Health Code, Title III, Article 48", "24", { citation: "New York City Health Code" }), "Title III, Article 48");
  assert.equal(localCitation("§ 1-01", "15", { citation: "Chapter 1" }), "§ 1-01");
  assert.equal(rulesChapterSlug("Chapter 18"), "18");
  assert.equal(rulesChapterSlug("Chapter 5-A"), "5-a");
  assert.equal(rulesChapterSlug("Apartment & Loft Order #49 (2017)"), "apartment-loft-order-49-2017");
  assert.equal(rulesChapterSlug("Appendix E – CEQR"), "appendix-e-ceqr");
});

test("an index from before 0.7.0 (no titleNumber): the site is built without the Rules, and says they are still to come", async () => {
  const old = await buildRulesFixtureSite({ titles: false });
  try {
    assert.deepEqual(old.books.map((b) => b.book.slug), ["charter"]);
    assert.match(old.skipped.rules, /no titles/);
    assert.ok(!existsSync(join(old.outDir, "rules")), "no Rules pages at all");
    const meta = JSON.parse(readFileSync(join(old.outDir, "metadata.json"), "utf8"));
    assert.deepEqual(Object.keys(meta.books), ["charter"]);
    assert.match(meta.skipped.rules, /no titles/);
    const home = readFileSync(join(old.outDir, "index.html"), "utf8");
    assert.match(home, /working to parse and display the Administrative Code and the Rules/);
    assert.doesNotMatch(home, /href="\/rules\//);
    assert.equal(JSON.parse(readFileSync(join(old.outDir, "redirects.json"), "utf8")).rules, undefined);
  } finally {
    rmSync(join(old.outDir, ".."), { recursive: true, force: true });
  }
  // Some records titled and some not is a broken index: stop.
  assert.equal(rulesReady([{ id: "a" }, { id: "b" }]), false);
  assert.equal(rulesReady([{ id: "a", titleNumber: "1" }]), true);
  assert.throws(() => rulesReady([{ id: "a", titleNumber: "1" }, { id: "b" }]), /names a title on 1 of 2 records/);
});

test("the front page: one compact card per title (number, name, chapter count), nothing else", () => {
  const html = page("/rules/");
  const cards = [...html.matchAll(/<li><a href="([^"]+)"><span class="tc-top">(.*?)<\/span><\/a><\/li>/g)];
  assert.deepEqual(cards.map((m) => m[1]), rules.titles.map((t) => t.path));
  for (const [, , inner] of cards) {
    assert.deepEqual([...inner.matchAll(/class="(tc-[a-z]+)"/g)].map((m) => m[1]), ["tc-num", "tc-name", "tc-count"]);
  }
  assert.match(html, /<span class="tc-num"><span class="vh">Title <\/span>38-A<\/span><span class="tc-name">Civilian Complaint Review Board<\/span><span class="tc-count">2 chapters<\/span>/);
  assert.doesNotMatch(html, /\/chapters\//, "the front page lists no chapters");
});

test("the titles-first menu: each title's chapters in a JSON file; the reader's title open on its pages", () => {
  for (const t of rules.titles) {
    const list = JSON.parse(read(`rules/contents/titles/${t.slug}.json`));
    assert.deepEqual(list.map(([p]) => p), t.chapters.map((c) => c.path));
  }
  const html = page(byId("0-0-0-12").path);
  assert.match(html, /<nav class="contents-nav" id="contents" aria-labelledby="contents-h" data-sections="\/rules\/contents\/titles\/" data-child="Chapters">/);
  assert.match(html, /<li class="open"><a href="\/rules\/titles\/15" aria-current="true">Title 15: Department of Environmental Protection<\/a>/);
  assert.match(html, /<p class="tree-status" role="status"><\/p>/);
  assert.match(html, /<a href="\/rules\/titles\/15\/sections\/1-01" aria-current="page">§ 1-01\. Scope and Application<\/a>/);
});

test("every Rules page: one h1, no skipped heading levels, no repeated id", () => {
  const files = allFiles(join(site.outDir, "rules")).filter((f) => f.endsWith(".html"));
  assert.ok(files.length > rules.ordered.length);
  for (const f of files) {
    const html = readFileSync(f, "utf8");
    const levels = [...html.matchAll(/<h([1-6])\b/g)].map((m) => Number(m[1]));
    assert.equal(levels.filter((l) => l === 1).length, 1, `${f}: one h1`);
    // The contents tree's h2 comes before the h1 (navigation first): skip it.
    const main = html.slice(html.indexOf('<main id="main">'));
    const inMain = [...main.matchAll(/<h([1-6])\b/g)].map((m) => Number(m[1]));
    for (let i = 1; i < inMain.length; i++) assert.ok(inMain[i] <= inMain[i - 1] + 1, `${f}: h${inMain[i - 1]} then h${inMain[i]}`);
    const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]);
    assert.equal(new Set(ids).size, ids.length, `${f}: an id is repeated`);
  }
});

test("the bottom box names the official Rules and where the City posts current rules", () => {
  const html = page(byId("0-0-0-12").path);
  assert.match(html, /The official text of 15 RCNY § 1-01 is at <a href="https:\/\/codelibrary\.amlegal\.com\/codes\/newyorkcity\/latest\/NYCrules\/0-0-0-12">American Legal Publishing<\/a>\. The City posts the latest rules at <a href="https:\/\/rules\.cityofnewyork\.us">rules\.cityofnewyork\.us<\/a>\./);
  // A Charter page says nothing about the Rules.
  assert.doesNotMatch(page(charter.sections[0].path), /rules\.cityofnewyork|official Rules/);
  // The pages for every book name each.
  for (const f of ["index.html", "search.html", "404.html"]) {
    assert.match(read(f), /the official Charter<\/a> and <a href="https:\/\/codelibrary\.amlegal\.com\/codes\/newyorkcity\/latest\/NYCrules\/0-0-0-1">the official Rules<\/a>\. The City posts the latest rules/, f);
  }
  const three = [{ officialUrl: "a", long: "Charter" }, { officialUrl: "b", long: "Administrative Code" }, { officialUrl: "c", long: "Rules" }];
  assert.equal(officialLinks(three), `<a href="a">the official Charter</a>, <a href="b">the official Administrative Code</a>, and <a href="c">the official Rules</a>`);
  assert.equal(listOf(["a", "b"]), "a and b");
  assert.equal(possessive("Rules"), "Rules'");
  assert.equal(possessive("Charter"), "Charter's");
  assert.match(bottomBox({ currentThrough: "Current through rules effective July 1, 2026.", copyChangedOn: "July 2, 2026", officialName: "The official Rules", officialUrl: "u", latestUrl: "https://rules.cityofnewyork.us" }), /The official Rules is at <a href="u">American Legal Publishing<\/a>\. The City posts the latest rules at/);
});

test("home, search, About and 404 cover the Rules", () => {
  const home = read("index.html");
  assert.match(home, /like <code>§ 259<\/code> in the Charter or <code>15 RCNY § 1-01<\/code> in the Rules, in the box/);
  assert.doesNotMatch(home, /still to come/);
  assert.match(home, /<a href="\/rules\/">Rules of the City of New York<\/a>: 6 titles, 13 chapters, 13 sections\./);
  assert.match(home, /<a class="button" href="\/rules\/">Browse the Rules<\/a>/);
  const about = read("about.html");
  assert.match(about, /15 RCNY § 1-01 is § 1-01 of Title 15/);
  assert.match(about, /References between the Charter, the Administrative Code, and the Rules are links\./);
  assert.match(read("404.html"), /<a href="\/rules\/">the Rules' contents<\/a>/);
  assert.match(read("search.html"), /<a href="\/charter\/">Browse the Charter's contents<\/a> or <a href="\/rules\/">the Rules' contents<\/a>/);
  for (const f of ["index.html", "search.html", "about.html", "404.html", fileOf(byId("0-0-0-12").path)]) assert.match(read(f), /<li><a href="\/rules\/"[^>]*>Rules<\/a><\/li>/, `${f}: the top bar links the Rules`);
});

test("jump box: '15 RCNY § 1-01' goes to its page; '§ 1-01' alone is in several titles", () => {
  assert.deepEqual(parseQuery("15 RCNY § 1-01"), { key: "15 rcny 1-01", anchor: "" });
  assert.deepEqual(parseQuery("15 R.C.N.Y. 1-01(a)"), { key: "15 rcny 1-01", anchor: "(a)" });
  assert.deepEqual(parseQuery("Title 15 RCNY § 1-01"), { key: "15 rcny 1-01", anchor: "" });
  assert.deepEqual(parseQuery("RCNY Title 15, Chapter 18"), { key: "15 rcny chapter 18", anchor: "" });
  assert.deepEqual(parseQuery("38a RCNY § 1-01"), { key: "38-a rcny 1-01", anchor: "" });
  assert.deepEqual(parseQuery("24 RCNY Health Code § 81.08"), { key: "24 rcny 81.08", anchor: "" });
  assert.deepEqual(parseQuery("Health Code § 81.08"), { key: "24 rcny 81.08", anchor: "" });
  assert.deepEqual(parseQuery("15 RCNY"), null);
  // The Charter's forms are unchanged.
  assert.deepEqual(parseQuery("Section 259(a)(1)"), { key: "259", anchor: "(a)(1)" });
  assert.deepEqual(citationKeys("§ 1-01", "38-A", { rules: true }), ["1-01", "title 38-a 1-01", "38-a rcny 1-01"]);
  assert.deepEqual(citationKeys("Chapter 18", "15", { rules: true }), ["chapter 18", "title 15 chapter 18", "15 rcny chapter 18"]);
  assert.deepEqual(citationKeys("Chapter 1", "28"), ["chapter 1", "title 28 chapter 1"]);
  assert.deepEqual(citationKeys("§ 259"), ["259"]);
  const list = JSON.parse(read("citations.json"));
  const one = lookup(list, "15 RCNY § 1-01(b)");
  assert.deepEqual(one.matches.map((m) => [m.p, m.c]), [["/rules/titles/15/sections/1-01", "15 RCNY § 1-01"]]);
  assert.equal(one.anchor, "(b)");
  assert.equal(one.jump, true);
  assert.deepEqual(lookup(list, "Health Code § 81.08").matches.map((m) => m.p), ["/rules/titles/24/sections/81.08"]);
  assert.deepEqual(lookup(list, "§ 1-01").matches.filter((m) => m.b === "Rules").map((m) => m.c), ["15 RCNY § 1-01", "24 RCNY § 1-01", "30 RCNY § 1-01", "38-A RCNY § 1-01"]);
});

test("404: Rules ids land on their page; /rules/sections/<n> for a number in one title goes there", () => {
  const r = JSON.parse(read("redirects.json"));
  assert.equal(redirectFor("/NYCrules/0-0-0-12", r), "/rules/titles/15/sections/1-01");
  assert.equal(redirectFor("/rules/0-0-0-41", r), "/rules/titles/24/sections/81.08");
  // A Title record's id lands on the title's page.
  assert.equal(redirectFor("/rules/0-0-0-10", r), "/rules/titles/15");
  // An id in the Charter and the Rules, with no book in the path: both are offered.
  const both = Object.keys(r.rules).find((id) => r.charter[id]);
  if (both) assert.equal(redirectChoices(`/${both}`, r).length, 2);
  const numbers = JSON.parse(read("rules/numbers.json"));
  assert.equal(rulesNumberFor("/rules/sections/81.08", numbers), "/rules/titles/24/sections/81.08");
  assert.equal(rulesNumberFor("/rules/sections/NOTICE/", numbers), "/rules/titles/30/sections/notice");
  assert.equal(rulesNumberFor("/rules/sections/99-99", numbers), null);
  assert.equal(rulesNumberFor("/admin-code/sections/81.08", numbers), null);
  assert.equal(rulesNumberFor("/rules/sections/constructor", numbers), null);
  assert.equal(rulesNumberFor("/rules/sections/50%", numbers), null, "not percent-encoding: no number, no error");
});

test("cross-book links: a reference into the Rules goes to its page under its title, named by its full citation", () => {
  const target = byId("0-0-0-41");
  const to = { corpus: "rules", id: "0-0-0-41", anchor: "(a)" };
  assert.ok(charter.others?.get("rules"), "the Charter's references can reach the Rules");
  assert.equal(linkHref(to, charter, null), "/rules/titles/24/sections/81.08#(a)");
  assert.deepEqual(linkTarget(to, charter, null), { href: "/rules/titles/24/sections/81.08#(a)", label: "24 RCNY Health Code § 81.08(a)" });
  // A Charter-only build leaves it as plain text.
  assert.equal(linkHref(to, { ...charter, others: undefined }, null), null);
  // From the Rules out, and within a title.
  assert.equal(linkHref({ corpus: "rules", id: target.id }, rules, byId("0-0-0-12")), target.path);
  assert.equal(linkHref({ corpus: "charter", id: charter.sections[0].id }, rules, target), charter.sections[0].path);
});

test("sitemaps and the site's data files include the Rules", () => {
  const sm = read("sitemaps/rules.xml");
  for (const p of ["/rules/", "/rules/titles/62", "/rules/titles/30/sections/notice", "/rules/sections/1-01", "/rules/titles/15/sections/1-01"]) assert.ok(sm.includes(`https://law.beta.nyc${p}</loc>`), p);
  assert.match(read("sitemap.xml"), /sitemaps\/rules\.xml/);
  const meta = JSON.parse(read("metadata.json"));
  assert.equal(meta.books.rules.records, rules.records.length);
  assert.equal(meta.skipped, undefined);
  const idx = JSON.parse(read("index.json"));
  assert.deepEqual(idx.books.find((b) => b.book === "rules").children.map((t) => t.path), rules.titles.map((t) => t.path));
});

test("jump box: 'Title N, Chapter M' never goes straight to the Rules; only 'N RCNY …' does", () => {
  // The Administrative Code cites its chapters "Title 28, Chapter 1" too (breadcrumbs, search titles).
  assert.deepEqual(parseQuery("Title 28, Chapter 1"), { key: "title 28 chapter 1", anchor: "", shared: true });
  assert.deepEqual(parseQuery("Title 17 Chapter 3"), { key: "title 17 chapter 3", anchor: "", shared: true });
  assert.deepEqual(parseQuery("Title 15 § 1-01"), { key: "title 15 1-01", anchor: "", shared: true });
  assert.deepEqual(parseQuery("RCNY Title 15, Chapter 18"), { key: "15 rcny chapter 18", anchor: "" });
  const admin = { k: citationKeys("Chapter 1", "28"), c: "NYC Administrative Code Title 28, Chapter 1", h: "Administration", p: "/admin-code/titles/28/chapters/1", b: "Admin Code" };
  const rule = { k: citationKeys("Chapter 1", "28", { rules: true }), c: "28 RCNY Chapter 1", h: "General", p: "/rules/titles/28/chapters/1", b: "Rules" };
  const rule17 = { k: citationKeys("Chapter 3", "17", { rules: true }), c: "17 RCNY Chapter 3", h: "Other", p: "/rules/titles/17/chapters/3", b: "Rules" };
  const list = [admin, rule, rule17];
  // Both books have it: the reader picks, from the search page's list.
  const both = lookup(list, "Title 28, Chapter 1");
  assert.deepEqual(both.matches.map((m) => m.p), [admin.p, rule.p]);
  assert.equal(both.jump, false);
  // The Admin Code alone: straight there.
  assert.deepEqual(lookup([admin, rule17], "Title 28, Chapter 1"), { matches: [admin], anchor: "", jump: true });
  // The Rules alone: offered, not opened.
  const only = lookup(list, "Title 17 Chapter 3");
  assert.deepEqual([only.matches.map((m) => m.p), only.jump], [[rule17.p], false]);
  // The Rules' own form goes straight there.
  assert.deepEqual(lookup(list, "28 RCNY Chapter 1"), { matches: [rule], anchor: "", jump: true });
  assert.deepEqual(lookup(list, "17 RCNY Chapter 3").jump, true);
  // On the fixture site's citations.json: the Charter has no titles, so it is untouched.
  const real = JSON.parse(read("citations.json"));
  assert.deepEqual(lookup(real, "Title 15 § 1-01").matches.map((m) => m.p), ["/rules/titles/15/sections/1-01"]);
  assert.equal(lookup(real, "Title 15 § 1-01").jump, false);
});

// A title of the fixtures' own (Title 43): two chapters numbered 15, and chapters 19, 19A, 19.1
// and 20 given out of order, as the publisher's files can give them.
const T43 = (() => {
  const chapter = (id, number, heading, anchor, sec) => `
	<LEVEL style-name="Chapter" style-name-escaped="Chapter" level-depth="2">
		<RECORD id="0-0-0-${id}" number="${id}" version="1">
			<HEADING>Chapter ${number}: ${heading}</HEADING>
			<PARA><DESTINATION id="0-0-0-${id + 5000}" name="${anchor}"/>Chapter ${number}: ${heading}</PARA>
		</RECORD>
		<LEVEL style-name="Section" style-name-escaped="Section" level-depth="3" toc-section="true">
			<RECORD id="0-0-0-${id + 1}" number="${id + 1}" version="1">
				<HEADING>§ ${sec} ${heading} rules.</HEADING>
				<PARA>§ ${sec} ${heading} rules.</PARA>
			</RECORD>
			<LEVEL style-name="Normal Level" style-name-escaped="Normal-Level" level-depth="0" toc-section="false">
				<RECORD id="0-0-0-${id + 2}" number="${id + 2}" version="1"><PARA>Text of ${sec}.</PARA></RECORD>
			</LEVEL>
		</LEVEL>
	</LEVEL>`;
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<DOCUMENT source-infobase-name="Rules" default-split-level="Chapter">
<LEVEL style-name="Title" style-name-escaped="Title" level-depth="1">
	<RECORD id="0-0-0-600" number="600" version="1">
		<HEADING>Title 43: Mayor</HEADING>
		<PARA><DESTINATION id="0-0-0-5600" name="Title 43"/>Title 43: Mayor</PARA>
	</RECORD>${[
    chapter(610, "20", "Twenty", "T43C020", "20-01"),
    chapter(620, "19.1", "Nineteen point one", "T43C019.1", "19.1-01"),
    chapter(630, "15", "Fifteen one", "T43C015", "15-01"),
    chapter(640, "19A", "Nineteen A", "T43C019A", "19A-01"),
    chapter(650, "19", "Nineteen", "T43C019", "19-01"),
    chapter(660, "15", "Fifteen two", "T43C015", "15-11"),
  ].join("")}
</LEVEL>
</DOCUMENT>`;
})();

test("chapters sort as the publisher numbers them: 19, 19A, 19.1, 20; a number used twice has a page to pick one", async () => {
  // The key: letters and decimals after the number; the Administrative Code's "2-A" as before.
  const order = ["Chapter 20", "Health Code", "Chapter 19.1", "Chapter 19A", "Chapter 2-A", "Chapter 19", "Chapter 2", "2016"];
  assert.deepEqual([...order].sort((a, b) => {
    const [x, y] = [adminChapterKey(a), adminChapterKey(b)];
    for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return x[i] < y[i] ? -1 : 1;
    return 0;
  }), ["Chapter 2", "Chapter 2-A", "Chapter 19", "Chapter 19A", "Chapter 19.1", "Chapter 20", "2016", "Health Code"]);

  const t43site = await buildRulesFixtureSite({ extra: [T43] });
  try {
    const b = t43site.books.find((x) => x.corpus === "rules");
    const t = b.titles.find((x) => x.number === "43");
    assert.deepEqual(t.chapters.map((c) => c.citation), ["Chapter 15", "Chapter 15", "Chapter 19", "Chapter 19A", "Chapter 19.1", "Chapter 20"]);
    assert.deepEqual(t.chapters.map((c) => c.path), [
      "/rules/titles/43/chapters/15-0-0-0-630",
      "/rules/titles/43/chapters/15-0-0-0-660",
      "/rules/titles/43/chapters/19",
      "/rules/titles/43/chapters/19a",
      "/rules/titles/43/chapters/19.1",
      "/rules/titles/43/chapters/20",
    ]);
    // Previous and next, the menu's list and the sections follow the same order.
    const c19a = t.chapters[3];
    assert.deepEqual([c19a.prev.citation, c19a.next.citation], ["Chapter 19", "Chapter 19.1"]);
    const rd = (rel) => readFileSync(join(t43site.outDir, rel), "utf8");
    assert.deepEqual(JSON.parse(rd("rules/contents/titles/43.json")).map(([p]) => p), t.chapters.map((c) => c.path));
    assert.deepEqual(t.chapters.flatMap((c) => c.sections).map((s) => s.citation), b.sections.filter((s) => s.titleNumber === "43").map((s) => s.citation));
    // The plain path of the shared number: a page to pick one, in the sitemap; both chapters linked.
    assert.deepEqual(b.sharedChapters.map((sc) => [sc.path, sc.chapters.map((c) => c.id)]), [["/rules/titles/43/chapters/15", ["0-0-0-630", "0-0-0-660"]]]);
    const pick = rd("rules/titles/43/chapters/15.html");
    assert.match(pick, /<h1><span class="cite">43 RCNY Chapter 15<\/span> <span class="heading">2 chapters have this number<\/span><\/h1>/);
    assert.ok(pick.includes(`<a href="/rules/titles/43/chapters/15-0-0-0-630">Chapter 15: Fifteen one</a>`));
    assert.ok(pick.includes(`<a href="/rules/titles/43/chapters/15-0-0-0-660">Chapter 15: Fifteen two</a>`));
    assert.match(rd("sitemaps/rules.xml"), /\/rules\/titles\/43\/chapters\/15<\/loc>/);
    // An id-suffixed path that stops being shared still lands, through the 404 page's ids.
    assert.equal(redirectFor("/rules/titles/43/chapters/15-0-0-0-630", JSON.parse(rd("redirects.json"))), "/rules/titles/43/chapters/15-0-0-0-630");
  } finally {
    rmSync(join(t43site.outDir, ".."), { recursive: true, force: true });
  }
});
