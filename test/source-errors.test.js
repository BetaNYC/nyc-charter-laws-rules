// Errors in the publisher's text (data/source-errors.json, /source-errors/): the file's schema,
// which entries a build shows, the page, and the note on a section page.
//
// Part of npm test, which the daily refresh runs: nothing here pins what the committed file
// holds (how many entries, or their statuses), only that it is valid. The pages are built from
// the Charter fixtures with a made-up errors file. test/site-data/source-errors.test.js checks the
// committed entries against the real books; test/site/source-errors.test.mjs checks the page in a
// browser.

import { test, before } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { writeFixtureData, FIXED_NOW, ROOT } from "./site/fixture-site.mjs";
import { buildSite } from "../scripts/lib/site/build.js";
import { loadBook } from "../scripts/lib/site/model.js";
import { readFooter } from "../scripts/lib/site/disclaimer.js";
import { unescapeHtml } from "../scripts/lib/site/html.js";
import {
  parseSourceErrors,
  visibleErrors,
  crossCheck,
  longDay,
  REPORT_TO,
  PUBLIC_STATUSES,
  SOURCE_ERROR_STATUSES,
  SOURCE_ERROR_KINDS,
} from "../scripts/lib/site/source-errors.js";
import { sourceErrorsPage, sourceErrorNote, sourceErrorRow, SOURCE_ERRORS_PATH, rowHref } from "../scripts/lib/site/pages-source-errors.js";
import { rowMatches, countLine, chosenFromQuery } from "../site/assets/source-errors.js";

const FILE = join(ROOT, "data", "source-errors.json");
const SHA = "a".repeat(64);

/** A valid entry, with overrides. */
function entry(over = {}) {
  return {
    id: "SE-0001",
    book: "charter",
    citation: "NYC Charter § 1",
    amlegal_id: "0-0-0-1",
    kind: "picture-text-mismatch",
    summary: "The picture says 12; the text says 18.",
    evidence: { text: "The sump shall be 18 inches.", records: ["0-0-0-2"], picture: "A drawing marked 12.", images: [{ image_id: "0-0-0-3", file: "IMAGES/0-0-0-3.png", sha256: SHA }] },
    found: "2026-11-25",
    found_in: "American Legal Publishing's files of July 2026",
    status: "found",
    confirmed_at: null,
    reported_at: null,
    fixed_at: null,
    notes: "",
    ...over,
  };
}
const fileText = (errors) => JSON.stringify({ about: "test", format: 1, errors });
const rejects = (errors, re) => assert.throws(() => parseSourceErrors(fileText(errors)), re);

test("the committed file matches its schema, with ids in order", () => {
  const data = parseSourceErrors(readFileSync(FILE, "utf8"));
  data.errors.forEach((e, i) => assert.equal(e.id, `SE-${String(i + 1).padStart(4, "0")}`, "ids run SE-0001, SE-0002, … in file order"));
  // Every quote and picture names where it came from.
  for (const e of data.errors) for (const i of e.evidence.images) assert.equal(i.file, `IMAGES/${i.image_id}${i.file.slice(i.file.lastIndexOf("."))}`, `${e.id}: file matches image id`);
});

test("schema: a valid entry, at each status, passes", () => {
  const ok = [
    entry(),
    entry({ id: "SE-0002", status: "confirmed", confirmed_at: "2026-11-26" }),
    entry({ id: "SE-0003", status: "reported", confirmed_at: "2026-11-26", reported_at: "2026-11-27" }),
    entry({ id: "SE-0004", status: "fixed-upstream", confirmed_at: "2026-11-26", reported_at: "2026-11-27", fixed_at: "2026-12-30" }),
    entry({ id: "SE-0005", status: "not-an-error", notes: "The drawing is right." }),
    entry({ id: "SE-0006", evidence: { text: "Only text.", records: ["0-0-0-9"], picture: null, images: [] }, kind: "garbled-text" }),
    entry({ id: "SE-0007", evidence: { text: null, records: ["0-0-0-9"], picture: "Only a picture.", images: [{ image_id: "0-0-0-4", file: "IMAGES/0-0-0-4.jpg", sha256: SHA }] } }),
  ];
  assert.equal(parseSourceErrors(fileText(ok)).errors.length, ok.length);
});

test("schema: bad ids, books, kinds, statuses, dates, unknown fields and evidence are rejected, naming the entry", () => {
  rejects([entry({ id: "SE-1" })], /SE-1 id: an id like SE-0001/);
  rejects([entry({ book: "admin-code" })], /book/);
  rejects([entry({ kind: "typo" })], /kind/);
  rejects([entry({ status: "fixed" })], /status/);
  rejects([entry({ found: "2026-02-30" })], /found: not a real date/);
  rejects([entry({ found: "11/25/2026" })], /found: a date like 2026-11-25/);
  rejects([entry({ amlegal_id: "https://codelibrary.amlegal.com/x" })], /amlegal_id/);
  rejects([entry({ confirmd_at: "2026-11-26" })], /Unrecognized key/);
  rejects([entry({ summary: "  " })], /summary/);
  rejects([entry({ evidence: { text: null, records: ["0-0-0-2"], picture: null, images: [] } })], /evidence needs the text, the picture, or both/);
  rejects([entry({ evidence: { text: "x", records: ["0-0-0-2"], picture: "a picture", images: [] } })], /come together/);
  rejects([entry({ evidence: { text: "x", records: [], picture: null, images: [] } })], /records/);
  rejects([entry({ evidence: { ...entry().evidence, images: [{ image_id: "0-0-0-3", file: "IMAGES/0-0-0-3.png", sha256: "956909fd5eb0" }] } })], /full sha256/);
  assert.throws(() => parseSourceErrors("{ not json"), /not valid JSON/);
  assert.throws(() => parseSourceErrors(JSON.stringify({ about: "x", format: 2, errors: [] })), /format/);
});

test("cross-checks: one id each, the dates a status needs, none it cannot have, in order", () => {
  rejects([entry(), entry()], /SE-0001: id used twice/);
  rejects([entry({ status: "confirmed" })], /status confirmed needs confirmed_at/);
  rejects([entry({ status: "reported", confirmed_at: "2026-11-26" })], /status reported needs reported_at/);
  rejects([entry({ status: "fixed-upstream", confirmed_at: "2026-11-26", reported_at: "2026-11-27" })], /needs fixed_at/);
  rejects([entry({ confirmed_at: "2026-11-26" })], /status found cannot have confirmed_at/);
  rejects([entry({ status: "confirmed", confirmed_at: "2026-11-26", reported_at: "2026-11-27" })], /status confirmed cannot have reported_at/);
  rejects([entry({ status: "confirmed", confirmed_at: "2026-11-24" })], /confirmed_at \(2026-11-24\) is before found \(2026-11-25\)/);
  assert.deepEqual(crossCheck([entry(), entry({ id: "SE-0002" })]), []);
});

test("which entries a build shows: checked ones; with the preview flag, found ones too; never not-an-error", () => {
  const all = SOURCE_ERROR_STATUSES.map(([s], i) => ({ id: `SE-000${i + 1}`, status: s }));
  assert.deepEqual(visibleErrors(all).map((e) => e.status), ["confirmed", "reported", "fixed-upstream"]);
  assert.deepEqual(PUBLIC_STATUSES, ["confirmed", "reported", "fixed-upstream"]);
  assert.deepEqual(visibleErrors(all, { includeUnconfirmed: true }).map((e) => e.status), ["found", "confirmed", "reported", "fixed-upstream"]);
});

test("the report addresses are the ones DATA-SOURCES.json and the disclaimer give", () => {
  const ds = JSON.parse(readFileSync(join(ROOT, "DATA-SOURCES.json"), "utf8"));
  for (const s of ds.sources) assert.equal(s.report_errors.upstream_email, REPORT_TO.publisher, s.id);
  const footer = readFooter(join(ROOT, "src", "tools.ts"));
  assert.ok(footer.includes(REPORT_TO.publisher) && footer.includes(REPORT_TO.lawDepartment));
});

test("the section note: none, one, several; unchecked ones say so", () => {
  assert.equal(sourceErrorNote(undefined), "");
  assert.equal(sourceErrorNote([]), "");
  const one = sourceErrorNote([entry({ status: "confirmed", confirmed_at: "2026-11-26" })]);
  assert.match(one, /^<p class="source-error-note" data-pagefind-ignore="all">The publisher's text of this section has an error that BetaNYC found\. We show the text as the publisher has it\. Read about <a href="\/source-errors\/#SE-0001">error SE-0001<\/a>\.<\/p>$/);
  const two = sourceErrorNote([entry({ status: "reported" }), entry({ id: "SE-0002", status: "found" })]);
  assert.match(two, /has errors that BetaNYC found/);
  assert.match(two, /error SE-0001<\/a> and <a href="\/source-errors\/#SE-0002">error SE-0002<\/a>/);
  assert.match(sourceErrorNote([entry()]), /BetaNYC found a possible error, not yet checked/);
  assert.equal(rowHref("SE-0009"), "/source-errors/#SE-0009");
});

test("a row: citation to our page, Check at American Legal (named, a plain link), kind, status, summary, evidence, dates", () => {
  const e = entry({ status: "reported", confirmed_at: "2026-11-26", reported_at: "2026-11-27", notes: "Sent to both." });
  const html = sourceErrorRow(e, { path: "/charter/sections/1" }, "https://codelibrary.amlegal.com/codes/newyorkcity/latest/NYCcharter/0-0-0-1");
  assert.match(html, /<li class="se se-reported" id="SE-0001" data-book="charter" data-kind="picture-text-mismatch" data-status="reported">/);
  assert.match(html, /<a href="\/charter\/sections\/1">NYC Charter § 1<\/a>/);
  assert.match(html, /<a href="https:\/\/codelibrary\.amlegal\.com\/codes\/newyorkcity\/latest\/NYCcharter\/0-0-0-1" aria-label="Check at American Legal: NYC Charter § 1 \(SE-0001\)">Check at American Legal<\/a>/);
  assert.doesNotMatch(html, /target=|rel=|onclick/, "the American Legal link opens normally");
  for (const s of ["Reported to the publisher", "Picture and text disagree", "The picture says 12; the text says 18.", "The sump shall be 18 inches.", "A drawing marked 12.", "IMAGES/0-0-0-3.png", "aaaaaaaaaaaa", "November 25, 2026, in American Legal Publishing&#39;s files of July 2026", "November 26, 2026", "November 27, 2026", "Sent to both."]) {
    assert.ok(html.includes(s), `row has ${s}`);
  }
  // No page of ours (a book this build left out): the citation is plain text.
  assert.match(sourceErrorRow(e, null, "https://x.test/1"), /<span class="se-id">SE-0001<\/span> NYC Charter § 1<\/h3>/);
});

const SITE = {
  currentThrough: "Current through Local Law 2026/086, enacted May 1, 2026.",
  copyChangedOn: "November 22, 2026",
  officialUrl: "https://codelibrary.amlegal.com/codes/newyorkcity/latest/NYCcharter/0-0-0-1",
  officialBase: "https://codelibrary.amlegal.com/codes/newyorkcity/latest/NYCcharter/",
  officialName: "The official Charter",
  contentsPath: "/charter/",
};
const pageWith = (entries, preview = false) =>
  sourceErrorsPage({ entries, preview, ours: () => ({ path: "/charter/sections/1" }), amlegalUrl: (e) => `https://codelibrary.amlegal.com/codes/newyorkcity/latest/NYCcharter/${e.amlegal_id}`, site: SITE });

test("the page with no entries: says there are none yet, no filters, no script", () => {
  const p = pageWith([]);
  assert.equal(p.path, SOURCE_ERRORS_PATH);
  assert.equal(p.file, "source-errors/index.html");
  assert.match(p.html, /<p class="se-empty">There are no confirmed errors yet\.<\/p>/);
  assert.doesNotMatch(p.html, /se-filters|se-list|source-errors\.js|Preview build/);
  assert.doesNotMatch(p.html, /noindex/);
  for (const a of [REPORT_TO.publisher, REPORT_TO.lawDepartment]) assert.ok(p.html.includes(`<a href="mailto:${a}">${a}</a>`), a);
  assert.match(p.html, /<h1>Errors in the publisher&#39;s text<\/h1>/);
});

test("the page with entries: every row in the HTML (no JavaScript needed), filters for the values present, preview marked", () => {
  const entries = [
    entry({ status: "confirmed", confirmed_at: "2026-11-26" }),
    entry({ id: "SE-0002", status: "found", kind: "same-picture-twice" }),
  ];
  const p = pageWith(entries, true);
  assert.equal((p.html.match(/<li class="se /g) ?? []).length, 2);
  assert.doesNotMatch(p.html, /<li class="se [^"]*"[^>]* hidden/, "no row starts hidden");
  assert.match(p.html, /<form class="se-filters" id="se-filters" aria-label="Filter the errors" hidden>/, "the filters wait for the script");
  assert.match(p.html, /<label for="se-book">Book<\/label>\n<select id="se-book" name="book">\n<option value="">All books<\/option>\n<option value="charter">New York City Charter<\/option>\n<\/select>/);
  const kinds = [...p.html.matchAll(/<select id="se-kind"[\s\S]*?<\/select>/g)][0][0];
  assert.deepEqual([...kinds.matchAll(/<option value="([^"]*)"/g)].map((m) => m[1]), ["", "picture-text-mismatch", "same-picture-twice"], "only kinds present, in order");
  const statuses = [...p.html.matchAll(/<select id="se-status"[\s\S]*?<\/select>/g)][0][0];
  assert.deepEqual([...statuses.matchAll(/<option value="([^"]*)"/g)].map((m) => m[1]), ["", "found", "confirmed"]);
  assert.match(p.html, /<p class="summary" id="se-count" role="status">2 errors, 1 not yet checked\.<\/p>/);
  assert.match(p.html, /<script type="module" src="\/assets\/source-errors\.js"><\/script>/);
  assert.match(p.html, /<strong>Preview build\.<\/strong>/);
  assert.match(p.html, /<meta name="robots" content="noindex">/);
  assert.match(p.html, /Found, not yet checked/);
  assert.equal(SOURCE_ERROR_KINDS.length, new Set(SOURCE_ERROR_KINDS.map(([k]) => k)).size);
});

test("the filters' logic: match, count line, address", () => {
  const row = { book: "rules", kind: "typo-in-picture", status: "found" };
  assert.ok(rowMatches(row, { book: "", kind: "", status: "" }));
  assert.ok(rowMatches(row, { book: "rules", kind: "", status: "found" }));
  assert.ok(!rowMatches(row, { book: "admin_code", kind: "", status: "" }));
  assert.equal(countLine(12, 12), "12 errors.");
  assert.equal(countLine(1, 12), "Showing 1 of 12 errors.");
  assert.equal(countLine(0, 1), "No errors match these filters. 1 error in all.");
  const offered = { book: ["", "rules"], kind: ["", "typo-in-picture"], status: ["", "found"] };
  assert.deepEqual(chosenFromQuery("?book=rules&kind=nope&status=found", offered), { book: "rules", kind: "", status: "found" });
  assert.deepEqual(chosenFromQuery("", offered), { book: "", kind: "", status: "" });
});

test("longDay writes a calendar day out", () => {
  assert.equal(longDay("2026-11-25"), "November 25, 2026");
  assert.equal(longDay("2027-01-01"), "January 1, 2027");
});

// The whole build, on the Charter fixtures, with a made-up errors file: one confirmed, one only found.
let normal, preview, real, sections;
before(async () => {
  const d = writeFixtureData();
  const book = loadBook({
    corpus: "charter",
    indexJsonText: d.data.json,
    versions: d.data.versions,
    structure: JSON.parse(readFileSync(join(d.structureDir, "charter.json"), "utf8")),
  });
  sections = book.sections.filter((s) => s.path).slice(0, 3);
  const dir = mkdtempSync(join(tmpdir(), "source-errors-"));
  const file = join(dir, "source-errors.json");
  writeFileSync(
    file,
    fileText([
      entry({ citation: sections[0].fullCitation, amlegal_id: sections[0].id, status: "confirmed", confirmed_at: "2026-11-26" }),
      entry({ id: "SE-0002", citation: sections[1].fullCitation, amlegal_id: sections[1].id }),
      entry({ id: "SE-0003", citation: sections[2].fullCitation, amlegal_id: sections[2].id, status: "not-an-error" }),
      entry({ id: "SE-0004", book: "rules", citation: "3 RCNY § 310-02", amlegal_id: "0-0-0-9741", status: "reported", confirmed_at: "2026-11-26", reported_at: "2026-11-27" }),
    ])
  );
  const build = (out, o) => buildSite({ indexDir: d.indexDir, structureDir: d.structureDir, outDir: join(dir, out), search: false, now: FIXED_NOW, commit: "test", books: ["charter"], ...o });
  normal = await build("normal", { sourceErrorsFile: file });
  preview = await build("preview", { sourceErrorsFile: file, includeUnconfirmedErrors: true });
  real = await build("real", {});
});

const read = (site, rel) => readFileSync(join(site.outDir, rel), "utf8");
const sectionFile = (s) => s.path.slice(1) + ".html";

test("build: a normal build lists only checked errors, and notes only their sections", () => {
  const html = read(normal, "source-errors/index.html");
  assert.deepEqual([...html.matchAll(/<li class="se [^"]*" id="([^"]+)"/g)].map((m) => m[1]), ["SE-0001", "SE-0004"]);
  assert.match(html, new RegExp(`<a href="${sections[0].path}">`));
  // SE-0004 is in the Rules, which this build leaves out: listed, with no link to our page, and its American Legal link.
  assert.match(html, /<span class="se-id">SE-0004<\/span> 3 RCNY § 310-02<\/h3>/);
  assert.ok(html.includes(`href="https://codelibrary.amlegal.com/codes/newyorkcity/latest/NYCrules/0-0-0-9741"`));
  assert.ok(html.includes(`href="https://codelibrary.amlegal.com/codes/newyorkcity/latest/NYCcharter/${sections[0].id}"`));
  assert.doesNotMatch(html, /Preview build|not yet checked|noindex/);
  assert.match(read(normal, sectionFile(sections[0])), /<p class="source-error-note"[^>]*>The publisher's text of this section has an error that BetaNYC found\. We show the text as the publisher has it\. Read about <a href="\/source-errors\/#SE-0001">error SE-0001<\/a>\.<\/p>/);
  assert.doesNotMatch(read(normal, sectionFile(sections[1])), /source-error-note/);
  assert.doesNotMatch(read(normal, sectionFile(sections[2])), /source-error-note/);
  assert.deepEqual(normal.metadata.sourceErrors, { shown: 2, unchecked: 0, includeUnconfirmed: false });
  assert.ok(read(normal, "sitemaps/pages.xml").includes("https://law.beta.nyc/source-errors/"), "in the sitemap");
});

test("build: the preview build adds the found ones, marked, and never not-an-error", () => {
  const html = read(preview, "source-errors/index.html");
  assert.deepEqual([...html.matchAll(/<li class="se [^"]*" id="([^"]+)"/g)].map((m) => m[1]), ["SE-0001", "SE-0002", "SE-0004"]);
  assert.match(html, /<li class="se se-found" id="SE-0002"[\s\S]*?<span class="se-badge se-badge-found">Found, not yet checked<\/span>/);
  assert.match(html, /Preview build\./);
  assert.match(html, /<meta name="robots" content="noindex">/);
  assert.match(read(preview, sectionFile(sections[1])), /BetaNYC found a possible error, not yet checked, in the publisher's text of this section\./);
  assert.doesNotMatch(read(preview, sectionFile(sections[2])), /source-error-note/);
  assert.deepEqual(preview.metadata.sourceErrors, { shown: 3, unchecked: 1, includeUnconfirmed: true });
  assert.ok(!read(preview, "sitemaps/pages.xml").includes("/source-errors/"), "a preview's errors page is not in its sitemap");
});

test("build: the committed file, in a normal build, adds no row and no note it has not checked", () => {
  const data = parseSourceErrors(readFileSync(FILE, "utf8"));
  const shown = visibleErrors(data.errors);
  const html = read(real, "source-errors/index.html");
  if (shown.length === 0) assert.match(html, /There are no confirmed errors yet\./);
  // A Charter-only build still lists the other books' entries, without a link to a page of ours.
  assert.equal((html.match(/<li class="se /g) ?? []).length, shown.length);
  assert.doesNotMatch(html, /Found, not yet checked/);
  for (const s of real.book.sections.filter((x) => x.path)) {
    const has = /source-error-note/.test(read(real, sectionFile(s)));
    assert.equal(has, shown.some((e) => e.book === "charter" && e.amlegal_id === s.id), `${s.fullCitation}: note only for a shown error`);
  }
});

test("build: the footer on every page and the About page link to the errors page", () => {
  for (const rel of ["index.html", "about.html", "search.html", "404.html", sectionFile(sections[0])]) {
    assert.match(read(normal, rel), /Mistakes in the publisher's own text are listed on <a href="\/source-errors\/">Errors in the publisher's text<\/a>\./, rel);
  }
  assert.match(unescapeHtml(read(normal, "about.html")), /where each one stands, on <a href="\/source-errors\/">Errors in the publisher's text<\/a>/);
});

test("build: an errors file that fails its schema stops the build", async () => {
  const d = writeFixtureData();
  const dir = mkdtempSync(join(tmpdir(), "source-errors-bad-"));
  const file = join(dir, "bad.json");
  writeFileSync(file, fileText([entry({ status: "confirmed" })]));
  await assert.rejects(
    buildSite({ indexDir: d.indexDir, structureDir: d.structureDir, outDir: join(dir, "out"), search: false, now: FIXED_NOW, commit: "test", books: ["charter"], sourceErrorsFile: file }),
    /SE-0001: status confirmed needs confirmed_at/
  );
});
