// Kinds of search result and the search page's filters (issue #65, epic #68): local-law notes are
// their own kind ("Local law"), their text weighs less in search, and the search page offers the
// books in the site's order. Built from the hand-made fixtures (the Charter's, the Administrative
// Code's in test/fixtures/site-admin/, the Rules'), without Pagefind. Part of npm test, which the
// daily refresh runs, so nothing here reads the committed law data (CS-23): the real data is
// checked by test/site-data/search-kinds.test.js, and the search page in a browser by
// test/site/search-kinds.test.mjs.

import { test, before } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, relative, dirname, resolve } from "node:path";
import { buildThreeBookFixtureSite } from "./site/fixture-site.mjs";
import { KIND, KINDS, kindLabel, filterGroups, groupOptions } from "../site/assets/filters.js";
import { searchMeta, searchKind, LOCAL_LAW_WEIGHT, LOCAL_LAW_TITLE_WEIGHT, localLawTitleBlock } from "../scripts/lib/site/pages.js";
import { isLocalLaw } from "../scripts/lib/site/model.js";
import { unescapeHtml } from "../scripts/lib/site/html.js";

let site, admin, rules, charter;
before(async () => {
  site = await buildThreeBookFixtureSite();
  admin = site.books.find((b) => b.corpus === "admin_code");
  rules = site.books.find((b) => b.corpus === "rules");
  charter = site.books.find((b) => b.corpus === "charter");
});

const fileOf = (path) => (path.endsWith("/") ? path.slice(1) + "index.html" : path.slice(1) + ".html");
const page = (path) => readFileSync(join(site.outDir, fileOf(path)), "utf8");
const metaOf = (html, attr, key) => [...html.matchAll(new RegExp(`<meta ${attr}="${key}\\[content\\]" content="([^"]*)">`, "g"))].map((m) => unescapeHtml(m[1]));
const kindOf = (html) => metaOf(html, "data-pagefind-filter", "kind");
const labelOf = (html) => metaOf(html, "data-pagefind-meta", "kind");
// Each body paragraph's [text, weight or null], in order, from a page's law text.
const weightsOf = (html) =>
  [...html.matchAll(/<(p|h[2-6]) [^>]*\bdata-block="\d+"([^>]*)>([\s\S]*?)<\/\1>/g)].map((m) => [unescapeHtml(m[3].replace(/<[^>]+>/g, "")), /data-pagefind-weight="([^"]+)"/.exec(m[2])?.[1] ?? null]);
function allFiles(dir, out = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) allFiles(p, out);
    else out.push(p);
  }
  return out;
}

test("filters.js: kinds in order, labels, and unknown values last", () => {
  assert.deepEqual(KINDS.map(([v]) => v), ["Section", "Chapter", "Local law"]);
  assert.deepEqual(KINDS.map(([, n]) => n), ["Sections", "Chapters", "Local laws"]);
  assert.equal(kindLabel("Local law"), "Local law");
  assert.equal(kindLabel("Local laws by year"), "Local laws by year");
  assert.equal(kindLabel("Chapter"), "Chapter");
  // A page built before #65 says only Section or Chapter; anything else reads as a section.
  assert.equal(kindLabel(undefined), "Section");
  assert.equal(kindLabel("<b>"), "Section");
  const [book, kind] = filterGroups([["Charter", "Charter"], ["Admin Code", "Administrative Code"], ["Rules", "Rules"]]);
  assert.deepEqual([book.key, book.label, kind.key, kind.label], ["book", "Book", "kind", "Kind of page"]);
  // Pagefind lists values alphabetically; the page lists them in the site's order, by long name.
  assert.deepEqual(groupOptions(book, ["Admin Code", "Charter", "Rules"]), [["Charter", "Charter"], ["Admin Code", "Administrative Code"], ["Rules", "Rules"]]);
  assert.deepEqual(groupOptions(kind, ["Chapter", "Local law", "Section"]), KINDS.map((x) => [...x]));
  // Only values Pagefind has; one it has that the order does not know comes last, by itself.
  assert.deepEqual(groupOptions(book, ["Rules", "Zoning", "Charter"]), [["Charter", "Charter"], ["Rules", "Rules"], ["Zoning", "Zoning"]]);
  assert.deepEqual(groupOptions(filterGroups()[0], ["Charter"]), [["Charter", "Charter"]]);
});

test("searchMeta writes only known kinds, escaped", () => {
  assert.throws(() => searchMeta(charter, "Part", "t", "c"), /unknown search kind "Part"/);
  const head = searchMeta(admin, KIND.localLaw, 'L.L. "x"', "NYC Administrative Code L.L. 2016/002", "Local laws by year").join("\n");
  assert.deepEqual(kindOf(head), ["Local law"]);
  assert.deepEqual(labelOf(head), ["Local laws by year"]);
  assert.deepEqual(metaOf(head, "data-pagefind-filter", "book"), ["Admin Code"]);
  assert.match(head, /content="L\.L\. &quot;x&quot;"/);
});

test("local-law notes are their own kind of result, and their text weighs less", () => {
  const notes = admin.sections.filter((s) => /^L\.L\. \d{4}\/\d+$/.test(s.citation));
  assert.deepEqual(notes.map((s) => s.citation), ["L.L. 2016/002", "L.L. 2017/001"]);
  for (const s of admin.sections) {
    const note = notes.includes(s);
    assert.equal(isLocalLaw(s), note, s.citation);
    const html = page(s.path);
    assert.deepEqual(kindOf(html), [note ? "Local law" : "Section"], s.citation);
    assert.deepEqual(labelOf(html), [note ? "Local law" : "Section"], s.citation);
    const weights = weightsOf(html);
    assert.ok(weights.length > 0, s.citation);
    if (!note) {
      assert.deepEqual(weights.filter(([, w]) => w !== null), [], `${s.citation}: a section's text keeps full weight`);
      assert.doesNotMatch(html, /data-pagefind-weight/, s.citation);
      continue;
    }
    // The law's title paragraph counts a little more; the rest of the note counts for little.
    for (const [text, w] of weights) assert.equal(w, /^A Local Law\b/.test(text) ? String(LOCAL_LAW_TITLE_WEIGHT) : String(LOCAL_LAW_WEIGHT), `${s.citation}: "${text.slice(0, 40)}"`);
    assert.equal(weights.filter(([text]) => /^A Local Law\b/.test(text)).length, 1, s.citation);
    // The heading keeps Pagefind's own weight.
    assert.match(html, /<h1><span class="cite">NYC Administrative Code L\.L\. \d{4}\/\d+<\/span><\/h1>/);
  }
  assert.ok(LOCAL_LAW_WEIGHT > 0 && LOCAL_LAW_WEIGHT < 1, "the rest of a note: lower than a section's, but still found");
  assert.ok(LOCAL_LAW_TITLE_WEIGHT >= 1 && LOCAL_LAW_TITLE_WEIGHT <= 10, "Pagefind's range");
});

test("localLawTitleBlock: the publisher's \"A Local Law\" paragraph, else \"To amend\" or \"In relation to\", else none", () => {
  const b = (...texts) => texts.map((text) => ({ type: "text", text }));
  const a = b("Enactment date: 1/5/2016", "A Local Law to amend the administrative code, in relation to noise.", "§ 2. A Local Law takes effect.");
  assert.equal(localLawTitleBlock(a), a[1]);
  const t = b("Enactment date: 3/13/2008", "Int. No. 659-A", "To amend the administrative code of the city of New York, in relation to fees.");
  assert.equal(localLawTitleBlock(t), t[2]);
  const r = b("Int. No. 43", "In relation to the approval of the application of a car service.");
  assert.equal(localLawTitleBlock(r), r[1]);
  assert.equal(localLawTitleBlock(b("Enactment date: 1/1/1990", "§ 1. The council finds.")), null);
  // A note with no title paragraph: every paragraph at the low weight.
  const note = admin.sections.find((s) => s.citation === "L.L. 2016/002");
  const { weightFor } = searchKind(note);
  const none = b("§ 1. Text.", "§ 2. More.");
  assert.deepEqual(none.map((x) => weightFor(x, none)), [LOCAL_LAW_WEIGHT, LOCAL_LAW_WEIGHT]);
  assert.equal(searchKind(admin.sections.find((s) => s.citation === "§ 10-172")).weightFor, null);
});

test("a year of local laws is a local-law page too, labeled as a year; other chapters are chapters", () => {
  for (const c of admin.chapters) {
    const year = /^\d{4}$/.test(c.citation);
    assert.equal(isLocalLaw(c), year, c.citation);
    assert.deepEqual(searchKind(c).kind, year ? "Local law" : "Chapter", c.citation);
    const html = page(c.path);
    assert.deepEqual(kindOf(html), [year ? "Local law" : "Chapter"], c.citation);
    assert.deepEqual(labelOf(html), [year ? "Local laws by year" : "Chapter"], c.citation);
  }
  assert.deepEqual(admin.chapters.filter((c) => isLocalLaw(c)).map((c) => c.citation), ["2016", "2017"]);
});

test("the Charter and the Rules have no local-law pages", () => {
  for (const b of [charter, rules]) {
    for (const r of [...b.sections, ...b.chapters]) assert.equal(isLocalLaw(r), false, `${b.corpus} ${r.citation}`);
  }
  const counts = {};
  for (const f of allFiles(site.outDir).filter((x) => x.endsWith(".html"))) {
    const html = readFileSync(f, "utf8");
    const kinds = kindOf(html);
    if (!html.includes("data-pagefind-body")) {
      assert.deepEqual(kinds, [], `${relative(site.outDir, f)}: no filter outside the search body`);
      continue;
    }
    // Every page search reads has exactly one kind, one of filters.js KIND.
    assert.equal(kinds.length, 1, relative(site.outDir, f));
    assert.ok(Object.values(KIND).includes(kinds[0]), `${relative(site.outDir, f)}: ${kinds[0]}`);
    const book = metaOf(html, "data-pagefind-filter", "book")[0];
    counts[`${book} ${kinds[0]}`] = (counts[`${book} ${kinds[0]}`] ?? 0) + 1;
  }
  assert.equal(counts["Admin Code Local law"], 4, "two notes and their two years");
  assert.equal(counts["Charter Local law"], undefined);
  assert.equal(counts["Rules Local law"], undefined);
});

test("the search page lists the books in the site's order, by their long names", async () => {
  const books = JSON.parse(unescapeHtml(/<div class="filters" id="filters" data-books="([^"]*)" hidden><\/div>/.exec(page("/search"))[1]));
  assert.deepEqual(books, [["Charter", "Charter"], ["Admin Code", "Administrative Code"], ["Rules", "Rules"]]);
  // Every book filter value a page carries is one the search page names.
  const values = new Set(books.map(([v]) => v));
  for (const b of site.books) assert.ok(values.has(b.book.short), b.corpus);
  // A Charter-only build names only the Charter.
  const only = await buildThreeBookFixtureSite({ books: ["charter"] });
  const html = readFileSync(join(only.outDir, "search.html"), "utf8");
  assert.match(html, /data-books="\[\[&quot;Charter&quot;,&quot;Charter&quot;\]\]"/);
});

test("search.js finds filters.js: every import in the site's scripts is a file the build copies", () => {
  const assets = join(site.outDir, "assets");
  for (const f of readdirSync(assets).filter((x) => x.endsWith(".js"))) {
    const src = readFileSync(join(assets, f), "utf8");
    for (const m of src.matchAll(/^import [^;]*? from "(\.[^"]+)";/gm)) {
      assert.ok(existsSync(resolve(dirname(join(assets, f)), m[1])), `${f} imports ${m[1]}`);
    }
  }
  assert.match(readFileSync(join(assets, "search.js"), "utf8"), /from "\.\/filters\.js"/);
});
