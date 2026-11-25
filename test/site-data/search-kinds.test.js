// Kinds of search result on the committed data (issue #65): npm run test:site-data.
//
// NOT part of npm test, on purpose (see admin-layout.test.js): a new year of local laws must never
// turn the daily refresh red. Every count is worked out from the data; nothing pins today's numbers.
//
// The site calls a record a local law when model.js puts it in its "Local laws by year" group
// (model.js isLocalLaw). These tests check that against the index itself: a local-law note
// is an Administrative Code record cited "L.L. YYYY/NNN" with no title, and its year is a chapter
// cited "YYYY" with no title. Pages are rendered in memory, without Pagefind.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { loadBook, isLocalLaw } from "../../scripts/lib/site/model.js";
import { adminSectionPage, adminChapterPage } from "../../scripts/lib/site/pages-admin.js";
import { searchPage, LOCAL_LAW_WEIGHT, LOCAL_LAW_TITLE_WEIGHT } from "../../scripts/lib/site/pages.js";
import { siteFacts } from "../../scripts/lib/site/build.js";
import { unescapeHtml } from "../../scripts/lib/site/html.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const INDEX = join(ROOT, "data", "index", "json");
const STRUCTURE = join(ROOT, "data", "structure");
const VERSIONS = JSON.parse(readFileSync(join(INDEX, "versions.json"), "utf8"));
const DATA_SOURCES = JSON.parse(readFileSync(join(ROOT, "DATA-SOURCES.json"), "utf8"));

function loadReal(corpus) {
  if (!existsSync(join(STRUCTURE, `${corpus}.json`))) return null;
  const indexText = readFileSync(join(INDEX, `${corpus}.json`), "utf8");
  const structure = JSON.parse(readFileSync(join(STRUCTURE, `${corpus}.json`), "utf8"));
  if (structure.indexSha256 !== createHash("sha256").update(indexText).digest("hex")) return null;
  try {
    return { book: loadBook({ corpus, indexJsonText: indexText, structure, versions: VERSIONS }), index: JSON.parse(indexText) };
  } catch {
    return null; // The Rules before 0.7.0 (no titles): the site leaves them out.
  }
}
const admin = loadReal("admin_code");
const charter = loadReal("charter");
const rules = loadReal("rules");
const skip = admin && charter ? false : "data/structure is missing or was built from other text";

const kindOf = (html) => [...html.matchAll(/<meta data-pagefind-filter="kind\[content\]" content="([^"]*)">/g)].map((m) => unescapeHtml(m[1]));
const labelOf = (html) => [...html.matchAll(/<meta data-pagefind-meta="kind\[content\]" content="([^"]*)">/g)].map((m) => unescapeHtml(m[1]));
/** The data-pagefind-weight of each body paragraph, in order (null when it has none). */
const weightsOf = (html) => [...html.matchAll(/<(?:p|h[2-6]) [^>]*\bdata-block="\d+"([^>]*)>/g)].map((m) => /data-pagefind-weight="([^"]+)"/.exec(m[1])?.[1] ?? null);

test("local-law notes: exactly the index's untitled L.L. records, each its own kind of result", { skip }, () => {
  const { book, index } = admin;
  const expected = new Set(index.filter((r) => /^L\.L\. \d{4}\/\d+$/.test(r.citation) && !r.titleNumber).map((r) => r.id));
  assert.ok(expected.size > 0, "the Administrative Code has local-law notes");
  // No titled record is cited like a note, so the two tests agree.
  assert.deepEqual(index.filter((r) => /^L\.L\./.test(r.citation) && r.titleNumber).map((r) => r.citation), []);
  const notes = book.sections.filter((s) => isLocalLaw(s));
  assert.deepEqual(notes.map((s) => s.id).sort(), [...expected].sort());
  const site = siteFacts([book], DATA_SOURCES).perBook.get("admin_code");
  let titledNotes = 0;
  for (const s of notes) {
    const html = adminSectionPage(s, book, site).html;
    assert.deepEqual(kindOf(html), ["Local law"], s.citation);
    assert.deepEqual(labelOf(html), ["Local law"], s.citation);
    // Every paragraph weighted: at most one (the law's title paragraph) a little higher, the rest low.
    const w = weightsOf(html);
    if (!s.text) continue;
    assert.ok(w.length > 0 && w.every((x) => x === String(LOCAL_LAW_WEIGHT) || x === String(LOCAL_LAW_TITLE_WEIGHT)), `${s.citation}: ${w.join(",")}`);
    const titled = w.filter((x) => x === String(LOCAL_LAW_TITLE_WEIGHT)).length;
    assert.ok(titled <= 1, s.citation);
    titledNotes += titled;
  }
  // Nearly every note has a title paragraph ("A Local Law to ...", or "To amend", "In relation to"): all 1,884 in November 2026.
  console.log(`# ${titledNotes} of ${notes.length} local-law notes have a title paragraph at ${LOCAL_LAW_TITLE_WEIGHT}`);
  assert.ok(titledNotes >= notes.length * 0.95, `${titledNotes} of ${notes.length}`);
  // Every other section is a section, at full weight (every 25th, to keep this quick).
  const others = book.sections.filter((s) => !isLocalLaw(s));
  for (const s of others.filter((_, i) => i % 25 === 0)) {
    const html = adminSectionPage(s, book, site).html;
    assert.deepEqual(kindOf(html), ["Section"], s.citation);
    assert.doesNotMatch(html, /data-pagefind-weight/, s.citation);
  }
});

test("each year of local laws is a local-law page, labeled as a year; every other chapter is a chapter", { skip }, () => {
  const { book } = admin;
  const site = siteFacts([book], DATA_SOURCES).perBook.get("admin_code");
  const years = book.chapters.filter((c) => isLocalLaw(c));
  assert.ok(years.length > 0);
  for (const c of years) assert.match(c.citation, /^\d{4}$/);
  // Every note sits in one of these years, and every year holds at least one note.
  const notes = book.sections.filter((s) => isLocalLaw(s));
  assert.ok(notes.every((s) => years.includes(s.chapter)));
  assert.ok(years.every((c) => c.sections.length > 0 && c.sections.every((s) => isLocalLaw(s))), "a year holds only notes");
  for (const c of book.chapters) {
    const html = adminChapterPage(c, book, site).html;
    const year = years.includes(c);
    assert.deepEqual(kindOf(html), [year ? "Local law" : "Chapter"], c.citation);
    assert.deepEqual(labelOf(html), [year ? "Local laws by year" : "Chapter"], c.citation);
  }
});

test("the Charter and the Rules have no local-law pages", { skip }, () => {
  for (const b of [charter, rules].filter(Boolean)) {
    const found = [...b.book.sections, ...b.book.chapters].filter((r) => isLocalLaw(r)).map((r) => r.citation);
    assert.deepEqual(found, [], b.book.corpus);
  }
});

test("the search page offers every book built, in order, by its long name", { skip }, () => {
  const books = [charter.book, admin.book, ...(rules ? [rules.book] : [])];
  const { shared: site } = siteFacts(books, DATA_SOURCES);
  const html = searchPage(books[0], site, books.slice(1)).html;
  const listed = JSON.parse(unescapeHtml(/data-books="([^"]*)"/.exec(html)[1]));
  assert.deepEqual(listed, books.map((b) => [b.book.short, b.book.long]));
  assert.deepEqual(listed.map(([, name]) => name), ["Charter", "Administrative Code", "Rules"].slice(0, books.length));
});
