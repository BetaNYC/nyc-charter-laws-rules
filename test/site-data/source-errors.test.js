// data/source-errors.json against the committed books (npm run test:site-data, before a deploy):
// every entry names a section the site has, by American Legal's id, with the citation its page
// shows, and a section page with a shown error carries the note. Kept out of npm test, which the
// daily refresh runs: if the publisher renumbers or drops a section, this stops the deploy, with
// the entry to fix, and never the refresh.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { loadBook, rulesReady } from "../../scripts/lib/site/model.js";
import { adminSectionPage } from "../../scripts/lib/site/pages-admin.js";
import { sectionPage } from "../../scripts/lib/site/pages.js";
import { siteFacts, sourceFacts } from "../../scripts/lib/site/build.js";
import { BOOKS } from "../../scripts/lib/site/config.js";
import { parseSourceErrors } from "../../scripts/lib/site/source-errors.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const INDEX = join(ROOT, "data", "index", "json");
const STRUCTURE = join(ROOT, "data", "structure");
const VERSIONS = JSON.parse(readFileSync(join(INDEX, "versions.json"), "utf8"));
const DATA_SOURCES = JSON.parse(readFileSync(join(ROOT, "DATA-SOURCES.json"), "utf8"));
const ERRORS = parseSourceErrors(readFileSync(join(ROOT, "data", "source-errors.json"), "utf8")).errors;

function loadReal(corpus) {
  if (!existsSync(join(STRUCTURE, `${corpus}.json`))) return null;
  const indexText = readFileSync(join(INDEX, `${corpus}.json`), "utf8");
  const structure = JSON.parse(readFileSync(join(STRUCTURE, `${corpus}.json`), "utf8"));
  if (structure.indexSha256 !== createHash("sha256").update(indexText).digest("hex")) return null;
  if (corpus === "rules" && !rulesReady(JSON.parse(indexText))) return null;
  return loadBook({ corpus, indexJsonText: indexText, structure, versions: VERSIONS });
}
const books = Object.fromEntries(["charter", "admin_code", "rules"].map((c) => [c, loadReal(c)]));

test("every entry names a section the site has, with the citation its page shows", () => {
  for (const e of ERRORS) {
    const b = books[e.book];
    if (!b) continue; // a book the committed data cannot build (the Rules before 0.7.0)
    const r = b.byId.get(e.amlegal_id);
    assert.ok(r, `${e.id}: ${e.amlegal_id} is not a record of ${e.book}`);
    assert.ok(b.sections.includes(r), `${e.id}: ${e.amlegal_id} is a ${r.level ?? "record"}, not a section, so no section page would show its note`);
    assert.equal(e.citation, r.fullCitation, `${e.id}: citation`);
    if (e.evidence.images.length) assert.ok((r.structure?.pictures ?? 0) > 0, `${e.id}: ${e.citation} has no pictures in its structure`);
  }
});

test("Check at American Legal: each entry's link is its section's own page there, as the bottom box links it", () => {
  for (const e of ERRORS) {
    const url = `${sourceFacts(DATA_SOURCES, BOOKS[e.book].source ?? e.book).officialBase}${e.amlegal_id}`;
    assert.match(url, /^https:\/\/codelibrary\.amlegal\.com\/codes\/newyorkcity\/latest\/NYC(charter|admin|rules)\/\d+(-\d+)*$/, e.id);
  }
});

test("a section page with a shown error carries the note, linking to its row; others do not", () => {
  const built = Object.values(books).filter(Boolean);
  const { perBook } = siteFacts(built, DATA_SOURCES);
  for (const e of ERRORS) {
    const b = books[e.book];
    if (!b) continue;
    const s = b.byId.get(e.amlegal_id);
    const make = e.book === "charter" ? sectionPage : adminSectionPage;
    b.sourceErrors = new Map([[e.amlegal_id, [e]]]);
    assert.ok(make(s, b, perBook.get(e.book)).html.includes(`<a href="/source-errors/#${e.id}">error ${e.id}</a>`), `${e.id}: note on ${s.path}`);
    b.sourceErrors = new Map();
    assert.ok(!make(s, b, perBook.get(e.book)).html.includes("source-error-note"), `${e.id}: no note when the entry is not shown`);
  }
});
