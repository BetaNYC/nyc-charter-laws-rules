// Text held outside sections (issue #78): group records, the heading fallback, and the coverage
// rule that would have caught #76 and #78.
//
// Fixtures: test/fixtures/group-records/0-0-0-2.xml (Administrative Code shapes: the Title 27
// reference standards, a group level with a note and sections, § BC 602 with an empty HEADING,
// § 21-905 with only a number, "Chapter D5" held by a group level) and 0-0-0-3.xml (Rules shapes:
// the Water Board's rate schedule, a schedule, the Board of Health resolutions). Hand-made in the
// publisher's shape; not the publisher's text.
//
// Offline, and no counts from the real law: the daily refresh runs npm test (CS-23). The real
// data is checked by npm run audit:coverage (data/raw) and npm run test:site-data.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { collectSectionsFromXml, groupLabel, groupCitation, recordHeading, readBody } from "../scripts/lib/build-corpus.js";
import { createStructureCollector } from "../scripts/lib/build-structure.js";
import { renderSection, bodyBlocks } from "../scripts/lib/render-section.js";
import { coverFile, emptyTally } from "../scripts/lib/coverage.js";
import { loadBook, groupShortHeading, adminShortHeading } from "../scripts/lib/site/model.js";
import { makeParser, childrenByTag, normalize, extractText } from "../scripts/lib/extract-text.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
const FIXTURE = join(HERE, "fixtures", "group-records");
const sha = (s) => createHash("sha256").update(s).digest("hex");

function build(file, corpus) {
  const collector = createStructureCollector(corpus);
  const sections = [];
  collectSectionsFromXml(readFileSync(join(FIXTURE, file), "utf8"), corpus, sections, (e) => { throw e; }, collector.forFile());
  const json = JSON.stringify(sections, null, 2);
  return { sections, json, structure: collector.finish(sections, sha(json)) };
}
const admin = build("0-0-0-2.xml", "admin_code");
const rules = build("0-0-0-3.xml", "rules");
const byId = (b, id) => {
  const i = b.sections.findIndex((s) => s.id === id);
  assert.ok(i >= 0, `${id} is indexed`);
  return { ...b.sections[i], at: i, structure: b.structure.sections[i] };
};

test("group records: the Title 27 reference standards are records, with short citations", () => {
  const rs18 = byId(admin, "0-0-0-250");
  assert.deepEqual(
    { citation: rs18.citation, heading: rs18.heading, level: rs18.level },
    { citation: "RS 18", heading: "REFERENCE STANDARD RS 18 ELEVATORS AND CONVEYORS", level: "Appendix" }
  );
  const rs181 = byId(admin, "0-0-0-255");
  assert.equal(rs181.citation, "RS 18-1", "the dash becomes a hyphen, and RS 18-1 is not named after RS 18");
  assert.equal(rs181.level, "Part");
  // Its own text, then the unnumbered article and its CONTENTS (no number, no sections) under their headings.
  assert.equal(
    rs181.text,
    "Safety code for elevators and escalators, as modified. The sum Σ of the loads, and the angle α, shall be shown. " +
      "STANDARD FOR THE INSTALLATION OF ELEVATORS ANSI A17.1, AS MODIFIED CONTENTS Chapter 1—General"
  );
  // A numbered level inside it is a record of its own, named after it.
  const ch1 = byId(admin, "0-0-0-264");
  // Named from RS 18-1, not from the chain above it.
  assert.deepEqual([ch1.citation, ch1.heading, ch1.level], ["RS 18-1, Chapter 1", "CHAPTER 1 – GENERAL", "Subarticle"]);
  // A subchapter with no text of its own holds an unnumbered appendix: it is the record, by its heading.
  const appendix = byId(admin, "0-0-0-240");
  assert.deepEqual([appendix.citation, appendix.text], ["Title 27, Chapter 1, Appendix: Reference Standards", "BUILDING CODE REFERENCE STANDARDS RS 18 Elevators and Conveyors."]);
  assert.ok(!admin.sections.some((s) => s.id === "0-0-0-241"), "the appendix read into it is not indexed again");
  // A part that holds sections and no text of its own is not a record; its section is.
  assert.ok(!admin.sections.some((s) => s.id === "0-0-0-270"));
  assert.equal(byId(admin, "0-0-0-271").text, "Escalators shall be installed as this standard provides.");
});

test("group records: in document order, after the levels around them and before the sections inside", () => {
  const order = admin.sections.map((s) => s.id);
  const pos = (id) => order.indexOf(id);
  assert.ok(pos("0-0-0-220") < pos("0-0-0-230"), "§ 27-101, then the article after it");
  assert.ok(pos("0-0-0-230") < pos("0-0-0-232") && pos("0-0-0-232") < pos("0-0-0-234"), "the article's note, the subarticle's note, then its section");
  assert.ok(pos("0-0-0-250") < pos("0-0-0-255") && pos("0-0-0-255") < pos("0-0-0-264") && pos("0-0-0-264") < pos("0-0-0-271"));
  // A group record's text is its own: the section inside it keeps its text, and the note is not in it.
  assert.equal(byId(admin, "0-0-0-230").text, "Editor's note: For related unconsolidated provisions, see Appendix A.");
  assert.equal(byId(admin, "0-0-0-234").text, "Every building shall have fire department access.");
  assert.equal(byId(admin, "0-0-0-230").citation, "Title 27, Chapter 1, Article 2");
  assert.equal(byId(admin, "0-0-0-232").citation, "Title 27, Chapter 1, Article 2, Subarticle 1");
});

test("group records: the Rules' appendices, schedules and resolutions", () => {
  assert.deepEqual([byId(rules, "0-0-0-420").citation, byId(rules, "0-0-0-420").text], ["Title 15, Chapter 42, Schedule A", "Citation Violation Description First Violation"]);
  const schedule = byId(rules, "0-0-0-430");
  assert.equal(schedule.citation, "Title 15, Chapter 42, Appendix A", "the title comes from the chapter's anchor name (T15C042)");
  assert.equal(schedule.text, "Effective: July 1, 2025. Introduction This Rate Schedule sets forth the rates of the Water Board.");
  assert.deepEqual(
    ["0-0-0-450", "0-0-0-460"].map((id) => byId(rules, id).citation),
    ["Title 15, Chapter 42, Appendix A, Part I", "Title 15, Chapter 42, Appendix A, Part II"],
    "a numbered part says which appendix, chapter and title it is in"
  );
  assert.equal(byId(rules, "0-0-0-460").text, "Charges for water are computed from the meter.");
  assert.equal(byId(rules, "0-0-0-462").text, "The metered rate is set each year.");
  // The resolutions: Subsections of a Section with no RECORD, read into the heading above them.
  const res = byId(rules, "0-0-0-500");
  assert.deepEqual([res.citation, res.heading, res.level], ["Title 15, Chapter 42, Resolutions", "Resolutions", "Subchapter"]);
  // A chapter with no number names its group records by its heading.
  assert.equal(byId(rules, "0-0-0-710").citation, "New York City Health Code, Introductory Notes");
  assert.equal(
    res.text,
    "Resolution Dated: July 5,1962 Whereas, the Board of Health has received reports on the water lines. " +
      "Resolution Dated: January 21,1964 Resolved, that the Board declares the condition a nuisance."
  );
  assert.deepEqual(bodyBlocks(renderSection(res, res.structure)).map((b) => b.type), ["subheading", "text", "subheading", "text"]);
});

test("headings: an empty HEADING, or one the PARA goes on from, takes the PARA (BC 602, § 21-905)", () => {
  const bc602 = byId(admin, "0-0-0-310");
  assert.deepEqual([bc602.citation, bc602.heading], ["Section BC 602", "Section BC 602: Construction Classification"]);
  assert.equal(bc602.text, "602.1 General. Buildings shall be classified in one of the five construction types.");
  assert.equal(bc602.level, undefined, "a section inside a chapter carries no level");
  assert.equal(byId(admin, "0-0-0-300").level, "Chapter", "a chapter says so");
  assert.equal(byId(admin, "0-0-0-810").level, "Section", "so does a section in no chapter (Title 31)");
  const s905 = byId(admin, "0-0-0-320");
  assert.deepEqual([s905.citation, s905.heading], ["§ 21-905", "§ 21-905 Demographic data of the juvenile justice system."]);
  // The rule on its own.
  const record = (heading, para) => makeParser().parse(`<RECORD><HEADING>${heading}</HEADING><PARA>${para}</PARA></RECORD>`)[0];
  assert.equal(recordHeading(record("§ 5", "§ 5")), "§ 5");
  assert.equal(recordHeading(record("§ 5 Title.", "§ 5")), "§ 5 Title.");
  assert.equal(recordHeading(record("", "Section BC 602: X")), "Section BC 602: X");
  assert.equal(recordHeading(record("§ 5", "§ 5. Title.")), "§ 5. Title.");
  // A PARA that only starts with the HEADING's characters ("§ 21-90" in "§ 21-905") does not count.
  assert.equal(recordHeading(record("§ 21-90", "§ 21-905 Reports.")), "§ 21-90");
});

test("labels and citations", () => {
  const label = (h) => groupLabel(h)?.label ?? null;
  assert.equal(label("REFERENCE STANDARD RS 5–1C MISCELLANEOUS TEST REPORTS"), "RS 5-1C");
  assert.equal(label("REFERENCE STANDARD 10–5B"), "RS 10-5B");
  assert.equal(label("REFERENCE STANDARD RS 15–8[A]"), "RS 15-8[A]");
  assert.equal(label("REFERENCE STANDARD RS 10–10B* SPECIFICATION"), "RS 10-10B");
  assert.equal(label("Appendix A-1: Standards"), "Appendix A-1");
  assert.equal(label("Appendix 18-A: Watershed Maps"), "Appendix 18-A");
  assert.equal(label("Appendix B to 62 RCNY Chapter 5: Checklist"), "Appendix B");
  assert.equal(label("RULE I - DEFINITIONS"), "Rule I");
  assert.equal(label("Subchapter 14.1: Laundries"), "Subchapter 14.1");
  for (const h of ["CONTENTS", "Introduction", "Resolutions", "Appendix", "Appendix: Reference Standards", "Resolution Dated: July 5,1962", "RULE OF CONSTRUCTION"]) {
    assert.equal(label(h), null, h);
  }
  assert.equal(groupCitation("New York City Amendments to the 2020 National Electrical Code."), "New York City Amendments to the 2020 National Electrical Code");
  assert.equal(groupCitation("Subchapter 3: Etching Acid*", ["Title 20", "Chapter 2"]), "Title 20, Chapter 2, Subchapter 3");
  assert.equal(groupCitation("Appendix", ["Title 15", "Chapter 20"]), "Title 15, Chapter 20, Appendix");
  assert.equal(groupCitation("REFERENCE STANDARD RS 18–4", ["Title 27", "Chapter 1"]), "RS 18-4", "a reference standard stands alone");
});

test("readBody is unchanged for a section: a section's own group-shaped child is not read into it", () => {
  const doc = makeParser().parse(readFileSync(join(FIXTURE, "0-0-0-2.xml"), "utf8")).find((n) => n.DOCUMENT);
  const findLevel = (node, id) => {
    for (const l of childrenByTag(node, "LEVEL")) {
      if (childrenByTag(l, "RECORD").some((r) => r[":@"]?.["@_id"] === id)) return l;
      const inner = findLevel(l, id);
      if (inner) return inner;
    }
    return null;
  };
  const d5 = findLevel(doc, "0-0-0-330");
  assert.deepEqual(readBody(d5).parts.map((p) => p.text), ["D501 Applicability. Alterations shall comply with this chapter."]);
  assert.equal(normalize(extractText(childrenByTag(d5, "RECORD")[0])).startsWith("Chapter D5"), true);
});

test("structure: links reach group records, merged headings are subheadings, blocks slice the text", () => {
  const link = byId(admin, "0-0-0-220").structure.links[0];
  assert.deepEqual(link.to, { corpus: "admin_code", name: "RS18-1", id: "0-0-0-255" });
  assert.deepEqual(byId(rules, "0-0-0-410").structure.links[0].to, { corpus: "rules", name: "T15C042SA", id: "0-0-0-420" });
  const rs181 = byId(admin, "0-0-0-255");
  assert.equal(rs181.structure.level, "Part");
  const blocks = bodyBlocks(renderSection(rs181, rs181.structure));
  assert.deepEqual(
    blocks.map((b) => [b.type, b.text]),
    [
      ["text", "Safety code for elevators and escalators, as modified."],
      ["text", "The sum Σ of the loads, and the angle α, shall be shown."],
      ["subheading", "STANDARD FOR THE INSTALLATION OF ELEVATORS"],
      ["text", "ANSI A17.1, AS MODIFIED"],
      ["subheading", "CONTENTS"],
      ["text", "Chapter 1—General"],
    ]
  );
  for (const b of [admin, rules]) {
    for (const [i, s] of b.sections.entries()) {
      assert.equal(bodyBlocks(renderSection(s, b.structure.sections[i])).map((x) => x.text).join(" "), s.text, s.citation);
      assert.ok(!b.structure.sections[i].flat, `${s.citation} is not flat`);
      assert.ok(!b.structure.sections[i].subsections, `${s.citation} has no unread levels`);
    }
  }
});

test("site: group records sit in their chapter, with short headings", () => {
  const versions = { admin_code: { currentThrough: "test", indexedAt: "2026-11-24T00:00:00Z", sectionCount: admin.sections.length, sha256: sha(admin.json) } };
  const book = loadBook({ corpus: "admin_code", indexJsonText: admin.json, structure: admin.structure, versions });
  const ch1 = book.chapters.find((c) => c.id === "0-0-0-210");
  assert.deepEqual(ch1.sections.map((s) => s.id), ["0-0-0-220", "0-0-0-230", "0-0-0-232", "0-0-0-234", "0-0-0-240", "0-0-0-250", "0-0-0-255", "0-0-0-264", "0-0-0-271"]);
  const rs181 = book.byId.get("0-0-0-255");
  assert.deepEqual([rs181.path, rs181.title, rs181.line], ["/admin-code/sections/rs-18-1", "", "RS 18-1"]);
  assert.equal(book.byId.get("0-0-0-250").title, "ELEVATORS AND CONVEYORS");
  assert.equal(book.byId.get("0-0-0-264").title, "GENERAL");
  assert.equal(book.byId.get("0-0-0-330").chapter.id, "0-0-0-300", "Chapter D5 is text in Chapter 7, not a chapter");
  assert.equal(book.byId.get("0-0-0-330").title, "Non-Fireproof Multiple Dwellings");
  assert.equal(book.byId.get("0-0-0-240").title, "", "a heading with no label ends the citation: said once");
  assert.equal(book.byId.get("0-0-0-810").chapter.kind, "title", "Title 31's section sits in its title");
  assert.equal(book.byId.get("0-0-0-310").path, "/admin-code/sections/bc-602");
  // Existing records keep their short heading.
  assert.equal(adminShortHeading({ heading: "§ 27-101 Title of code.", citation: "§ 27-101", level: "Section" }), "Title of code");
  assert.equal(groupShortHeading("Part I – Definitions", "Appendix A, Part I"), "Definitions");
  assert.equal(groupShortHeading("REFERENCE STANDARD 10–5B", "RS 10-5B"), "");
  assert.equal(groupShortHeading("Resolutions", "Title 15, Chapter 42, Resolutions"), "");
  assert.equal(groupShortHeading("Part I – Definitions", "Title 15, Chapter 42, Appendix A, Part I"), "Definitions");
  assert.equal(groupShortHeading("Notes, and More", "Title 1, Chapter 2, Notes, and More"), "", "a heading with a comma in it");
});

// Run `snippet` (which may use `c`, dist/corpus.js) against an index of the given records, through
// NYC_LAWS_INDEX_DIR, in a child process (the index directory is read once, at import).
function withIndex(books, snippet) {
  const dir = mkdtempSync(join(tmpdir(), "group-records-index-"));
  try {
    // One file per corpus (no Charter records).
    const all = { charter: "[]", ...books };
    for (const [corpus, json] of Object.entries(all)) writeFileSync(join(dir, `${corpus}.json`), json);
    const v = (json) => ({ currentThrough: "test", indexedAt: "2026-11-24T00:00:00Z", sectionCount: JSON.parse(json).length });
    writeFileSync(join(dir, "versions.json"), JSON.stringify(Object.fromEntries(Object.entries(all).map(([k, j]) => [k, v(j)]))));
    const code = `const c = await import(${JSON.stringify(pathToFileURL(join(ROOT, "dist", "corpus.js")).href)});
      const cite = (q, k) => { const r = c.getSection(q, k); return r.kind === "match" ? r.section.id : r.kind; };
      const ids = (list) => list.map((s) => s.id);
      console.log(JSON.stringify(${snippet}));`;
    const out = spawnSync(process.execPath, ["--input-type=module", "-e", code], { env: { ...process.env, NYC_LAWS_INDEX_DIR: dir }, encoding: "utf8" });
    assert.equal(out.status, 0, out.stderr);
    return JSON.parse(out.stdout);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
const books = { admin_code: admin.json, rules: rules.json };

test("MCP: a group record never opens a chapter in list_titles or get_title, and is found by citation", () => {
  const r = withIndex(books, `{
    titles: c.listTitles("admin_code").map((t) => t.citation),
    chapter7: ids(c.getTitle("admin_code", "Chapter 7")),
    title27: ids(c.getTitle("admin_code", "Title 27")),
    rs: cite("RS 18-1"), rsDash: cite("RS 18–1"), bc: cite("BC 602"), d5: cite("Chapter D5"), res: cite("Resolutions", "rules"),
    sub: cite("Title 27, Chapter 1, Article 2, Subarticle 1"),
    search: ids(c.searchCorpus("angle α")),
  }`);
  assert.deepEqual(r.titles, ["Chapter 7 (§ 21-905)", "Chapter 1 (§ 27-101 to § 27-301)"]);
  assert.deepEqual(r.chapter7, ["0-0-0-300", "0-0-0-310", "0-0-0-320", "0-0-0-330", "0-0-0-332"], "and not Title 31's § 31-101 after it");
  assert.ok(r.title27.includes("0-0-0-255") && r.title27.includes("0-0-0-264"), "Title 27 lists the reference standards");
  // By citation, or by heading where the citation is long ("Chapter D5", "Resolutions").
  assert.deepEqual([r.rs, r.rsDash, r.bc, r.d5, r.res, r.sub], ["0-0-0-255", "0-0-0-255", "0-0-0-310", "0-0-0-330", "0-0-0-500", "0-0-0-232"]);
  assert.deepEqual(r.search, ["0-0-0-255"]);
});

test("citations: a group record never makes a citation that named one record name two", () => {
  // Structural: no group record shares a citation with a section or chapter record, in either book.
  const norm = (x) => x.toLowerCase().replace(/§§?\s*/g, "").replace(/^section\s+/, "").replace(/\s+/g, " ").trim();
  const all = [...admin.sections, ...rules.sections];
  const isGroup = (x) => x.level && x.level !== "Chapter" && x.level !== "Section";
  const others = new Set(all.filter((x) => !isGroup(x)).map((x) => norm(x.citation)));
  assert.deepEqual(all.filter((x) => isGroup(x) && others.has(norm(x.citation))).map((x) => x.citation), []);
  // The case the review found: a Rules section cited "Schedule A" stays the only "Schedule A".
  const r = withIndex(books, `{ schedule: cite("Schedule A", "rules"), ours: cite("Title 15, Chapter 42, Schedule A", "rules") }`);
  assert.deepEqual(r, { schedule: "0-0-0-610", ours: "0-0-0-420" });
});

test("get_title: a chapter ends at the next chapter record, numbered or not, and at a section in no chapter", () => {
  const r = withIndex(books, `{
    titles: c.listTitles("rules").map((t) => t.citation),
    chapter43: ids(c.getTitle("rules", "Chapter 43")),
    chapter42: ids(c.getTitle("rules", "Chapter 42")),
    title21: ids(c.getTitle("admin_code", "Title 21")),
    health: cite("New York City Health Code, Introductory Notes", "rules"),
  }`);
  assert.deepEqual(r.titles, ["Chapter 42", "Chapter 43"], "a chapter with no number is not listed, as before");
  assert.deepEqual(r.chapter43, ["0-0-0-600", "0-0-0-610"], "the Health Code and its records are not in Chapter 43");
  assert.ok(r.chapter42.includes("0-0-0-500") && !r.chapter42.includes("0-0-0-600"));
  assert.ok(!r.title21.includes("0-0-0-810"), "Title 31's section is not in the chapter before it");
  assert.equal(r.health, "0-0-0-710", "records in no chapter are still found");
  // An index built before #78 has no level: a chapter heading opens a chapter, every other
  // record joins the one before it, as through 0.6.2.
  const strip = (json) => JSON.stringify(JSON.parse(json).map(({ level, ...x }) => x));
  const old = withIndex({ admin_code: strip(admin.json), rules: strip(rules.json) }, `{ chapter43: ids(c.getTitle("rules", "Chapter 43")) }`);
  assert.deepEqual(old.chapter43, ["0-0-0-600", "0-0-0-610", "0-0-0-700", "0-0-0-710", "0-0-0-720"]);
});

// The rule that would have caught #76 and #78: no LEVEL that holds text is left unread, and no
// text is read into two records. Run over every XML fixture in the repo.
const FIXTURE_DIRS = [
  [join(HERE, "fixtures", "diff", "xml"), "charter"],
  [join(HERE, "fixtures", "structure", "rules"), "rules"],
  [join(HERE, "fixtures", "structure", "rules-edge"), "rules"],
  [join(HERE, "fixtures", "subsections"), "admin_code"],
  [FIXTURE, "admin_code"],
];

test("coverage: every fixture's text is in the index once, or left out for a stated reason", () => {
  for (const [dir, corpus] of FIXTURE_DIRS) {
    const tally = emptyTally();
    for (const f of readdirSync(dir).filter((x) => x.endsWith(".xml")).sort()) {
      coverFile(readFileSync(join(dir, f), "utf8"), corpus, f, tally);
    }
    // The #76 fixture keeps one Subsection inside a Subsection on purpose: readBody does not read
    // it, and the structure counts it so the site can say so (none in the publisher's files today).
    const known = tally.unread.filter((u) => / in Subsection \(.*Subsection > Subsection\)$/.test(u.where));
    assert.deepEqual(tally.unread.filter((u) => !known.includes(u)), [], `${dir}: text the index does not read`);
    assert.equal(tally.twice, 0, `${dir}: text read into two records`);
    assert.ok(tally.text > 0, dir);
  }
  // The title's own note is left out, and said so.
  const t = coverFile(readFileSync(join(FIXTURE, "0-0-0-2.xml"), "utf8"), "admin_code", "0-0-0-2.xml");
  assert.equal(t.dropped.title, "Editor'snote:anoteheldbythetitleitself.".length);
});

test("coverage: text in a level the index does not read is reported, with where it sits", () => {
  const xml = `<DOCUMENT><LEVEL style-name="Chapter"><RECORD id="1"><HEADING>Chapter 9: Test</HEADING><PARA>Chapter 9: Test</PARA></RECORD>
    <LEVEL style-name="Part"><LEVEL style-name="Normal Level"><RECORD id="2"><PARA>Text with no heading above it.</PARA></RECORD></LEVEL></LEVEL>
  </LEVEL></DOCUMENT>`;
  const t = coverFile(xml, "rules", "x.xml");
  assert.equal(t.unread.length, 1);
  assert.equal(t.unread[0].text, "Text with no heading above it.");
  assert.match(t.unread[0].where, /^Normal Level in Part \(Chapter > Part > Normal Level\)$/);
});
