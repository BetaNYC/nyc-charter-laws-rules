// Titles (issue #59): each Rules title restarts its chapter and section numbers, and a lettered
// Administrative Code title shares its parent's numbers. The index records each record's title
// (`titleNumber`, and `titleHeading` on chapter records), and get_section, get_title and
// list_titles use it.
//
// Fixtures: test/fixtures/titles/rules/ and test/fixtures/titles/admin/, hand-made in the
// publisher's shape (not the publisher's text): a Title record around its first chapter; a chapter
// named only by its anchor ("T15C018"); chapters with no number and no anchor (the Health Code, two
// Rent Guidelines Board orders) that only record order places; a lettered title ("38-A", "16-A",
// "16-B"); two chapters of one title that both hold a § 6-01; a chapter numbered after a later
// title; and the Administrative Code's local laws in "Appendix A", a Title level with no number.
// The other fixtures (structure/, group-records/, diff/) are checked for an unchanged index.
//
// Offline, and no counts from the real law: the daily refresh runs npm test (CS-23). The real
// data is checked by npm run test:site-data.
//
// Requires: npm run build (dist/ must exist). Guaranteed by "pretest".

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  buildSectionsFromXml,
  collectSectionsFromXml,
  createTitleIndex,
  finishTitles,
  canonicalTitle,
} from "../scripts/lib/build-corpus.js";
import { normalizeCitation, parseTitledCitation } from "../dist/corpus.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
const FIX = join(HERE, "fixtures");
const sha = (s) => createHash("sha256").update(s).digest("hex");
const xmlOf = (dir) => readdirSync(dir).filter((f) => f.endsWith(".xml")).sort().map((f) => readFileSync(join(dir, f), "utf8"));

// The build the way scripts/build-index.js runs it: one title index per book, finished after the
// last file. Files in name order, which is not record order ("0-0-0-100" before "0-0-0-20").
function build(dir, corpus) {
  const sections = [];
  const titles = createTitleIndex();
  for (const xml of xmlOf(dir)) collectSectionsFromXml(xml, corpus, sections, (e) => { throw e; }, null, titles);
  const stats = finishTitles(titles);
  return { sections, stats, json: JSON.stringify(sections, null, 2) };
}
const rules = build(join(FIX, "titles", "rules"), "rules");
const admin = build(join(FIX, "titles", "admin"), "admin_code");
const row = (s) => [s.id, s.titleNumber ?? null, s.titleHeading ?? null];
const strip = (sections) => JSON.stringify(sections.map(({ titleNumber, titleHeading, ...s }) => s), null, 2);

describe("the build records each record's title", () => {
  test("canonicalTitle writes a title number as the publisher's Title headings do", () => {
    assert.equal(canonicalTitle("15"), "15");
    assert.equal(canonicalTitle("015"), "15");
    assert.equal(canonicalTitle("16-a"), "16-A");
    assert.equal(canonicalTitle("16a"), "16-A");
    assert.equal(canonicalTitle("38A"), "38-A");
    assert.equal(canonicalTitle("16-B"), "16-B");
  });

  test("Rules: from the Title level in the file, the chapter's anchor name, or record order", () => {
    const dep = "Title 15: Department of Environmental Protection";
    const doh = "Title 24: Department of Health and Mental Hygiene";
    const rgb = "Title 30: Rent Guidelines Board";
    const ccrb = "Title 38-A: Civilian Complaint Review Board";
    const plan = "Title 62: City Planning";
    const byId = Object.fromEntries(rules.sections.map((s) => [s.id, row(s).slice(1)]));
    assert.deepEqual(byId, {
      // A Title level around the chapter in its own file.
      "0-0-0-11": ["15", dep], "0-0-0-12": ["15", null],
      // No Title record in the file: the chapter's anchor name, "T15C018".
      "0-0-0-20": ["15", dep], "0-0-0-21": ["15", null],
      "0-0-0-31": ["24", doh], "0-0-0-32": ["24", null],
      // No number and no anchor: the last Title record before it in record order.
      "0-0-0-40": ["24", doh], "0-0-0-41": ["24", null],
      "0-0-0-51": ["30", rgb], "0-0-0-52": ["30", null],
      "0-0-0-60": ["30", rgb], "0-0-0-61": ["30", null],
      "0-0-0-70": ["30", rgb], "0-0-0-71": ["30", null],
      // A lettered title: "Title 38-A" in its heading, "T38-aC002" in its second chapter's anchor.
      "0-0-0-81": ["38-A", ccrb], "0-0-0-82": ["38-A", null],
      "0-0-0-90": ["38-A", ccrb], "0-0-0-91": ["38-A", null],
      "0-0-0-101": ["62", plan], "0-0-0-102": ["62", null],
      "0-0-0-110": ["62", plan], "0-0-0-111": ["62", null],
      // Its anchor says Title 24, though record order puts it after Title 62: the anchor wins.
      "0-0-0-120": ["24", doh], "0-0-0-121": ["24", null],
    });
    assert.deepEqual(rules.stats, { fromFile: 18, byOrder: 6, none: 0, disagree: 2 }, "the two records of the Title 24 chapter after Title 62 disagree");
  });

  test("Administrative Code: lettered titles are their own, and the local laws in Appendix A have none", () => {
    assert.deepEqual(admin.sections.map(row), [
      ["0-0-0-11", "16", "Title 16: Sanitation"],
      ["0-0-0-12", "16", null],
      ["0-0-0-21", "16-A", "Title 16-A: [Commercial Waste Removal]"],
      ["0-0-0-22", "16-A", null],
      // Title 16-B's record is not in these fixtures: the chapter's anchor gives the number, and
      // there is no heading to give it. Record order would say 16-A; the anchor wins (disagree 2).
      ["0-0-0-30", "16-B", null],
      ["0-0-0-31", "16-B", null],
      // Inside "Appendix A: Unconsolidated Local Laws", a Title level with no number.
      ["0-0-0-41", null, null],
      ["0-0-0-42", null, null],
      // No Title level and no anchor; record order puts it after Appendix A.
      ["0-0-0-50", null, null],
      ["0-0-0-51", null, null],
    ]);
    assert.deepEqual(admin.stats, { fromFile: 6, byOrder: 0, none: 4, disagree: 2 });
  });

  test("the Charter has no titles", () => {
    const charter = buildSectionsFromXml(xmlOf(join(FIX, "diff", "xml")), "charter");
    assert.ok(charter.length > 0);
    assert.ok(charter.every((s) => !("titleNumber" in s) && !("titleHeading" in s)));
  });

  test("the title fields come last in each record, and only titleHeading on chapter records", () => {
    for (const s of [...rules.sections, ...admin.sections]) {
      const keys = Object.keys(s);
      const at = keys.indexOf("titleNumber");
      if (at >= 0) assert.deepEqual(keys.slice(at), s.titleHeading ? ["titleNumber", "titleHeading"] : ["titleNumber"], s.id);
      if (s.titleHeading) assert.equal(s.level, "Chapter", s.id);
    }
  });

  test("without a title index the build writes no title fields (the index as 0.6.2 wrote it)", () => {
    const sections = [];
    for (const xml of xmlOf(join(FIX, "titles", "rules"))) collectSectionsFromXml(xml, "rules", sections, (e) => { throw e; });
    assert.ok(sections.every((s) => !("titleNumber" in s) && !("titleHeading" in s)));
    assert.equal(JSON.stringify(sections, null, 2), strip(rules.sections));
  });

  test("every other field is byte for byte what b82d85e wrote, on every XML fixture", () => {
    // Pinned from b82d85e (before #59): its build-corpus.js buildSectionsFromXml over each folder,
    // in sorted file order. The new build, less titleNumber and titleHeading, must give the same
    // bytes: citation, heading, text, id and level are unchanged.
    const pins = [
      ["structure/rules", "rules", "66df799c0586b921f2a05ba49269277c887ef0cdaeef5bdc78341a8fd0f749cc"],
      ["structure/rules-edge", "rules", "696678ac04698f44b1527232dbc74266fc158e1188b727c82992397048119eb1"],
      ["diff/xml", "charter", "b25f424e6d467334cf52ce5b7718f3e30ff106d261c2ef2f430aaf8c9c4430d3"],
      ["group-records", "admin_code", "466b49183c917e04f512ac73abfa4749a1ab1f092caaa2a12728946030985314"],
      ["group-records", "rules", "e4ca157b43e50154558e07b9483bfe7c323688abdb5d1cf28bb693e8541b70c9"],
    ];
    for (const [dir, corpus, pinned] of pins) {
      const sections = buildSectionsFromXml(xmlOf(join(FIX, dir)), corpus);
      assert.equal(sha(strip(sections)), pinned, `${dir} (${corpus})`);
      if (corpus !== "charter") assert.ok(sections.some((s) => s.titleNumber), `${dir} (${corpus}) has titles`);
    }
  });
});

describe("citations that name a title", () => {
  test("normalizeCitation makes any dash a hyphen", () => {
    for (const q of ["§ 1-01", "§ 1–01", "§ 1—01", "§ 1‐01", "1−01"]) assert.equal(normalizeCitation(q), "1-01", JSON.stringify(q));
  });

  test("parseTitledCitation reads each form, and leaves a citation with no title alone", () => {
    const p = (q) => parseTitledCitation(q);
    const rcny = { title: "15", rules: true, healthCode: false, rest: "§ 1-01" };
    assert.deepEqual(p("15 RCNY § 1-01"), rcny);
    assert.deepEqual(p("15 R.C.N.Y. § 1-01"), rcny);
    assert.deepEqual(p("15 RCNY 1-01"), { ...rcny, rest: "1-01" });
    assert.deepEqual(p("15 rcny § 1–01"), rcny);
    assert.deepEqual(p("Title 15 RCNY § 1-01"), rcny);
    assert.deepEqual(p("RCNY Title 15 § 1-01"), rcny);
    assert.deepEqual(p("Title 15 § 1-01"), { ...rcny, rules: false });
    assert.deepEqual(p("Title 15, § 1-01"), { ...rcny, rules: false });
    assert.deepEqual(p("Title 15, Chapter 18"), { title: "15", rules: false, healthCode: false, rest: "Chapter 18" });
    assert.deepEqual(p("title 16-a § 16-501"), { title: "16-A", rules: false, healthCode: false, rest: "§ 16-501" });
    assert.deepEqual(p("24 RCNY Health Code § 81.08"), { title: "24", rules: true, healthCode: true, rest: "§ 81.08", named: "Health Code § 81.08" });
    assert.deepEqual(p("Health Code § 81.08"), { rules: true, healthCode: true, rest: "§ 81.08", named: "Health Code § 81.08" });
    // The Health Code's name alone is the rest: it is the chapter record's citation.
    assert.deepEqual(p("Title 24, New York City Health Code"), { title: "24", rules: false, healthCode: false, rest: "New York City Health Code" });
    assert.deepEqual(p("RCNY § 1-01"), { rules: true, healthCode: false, rest: "§ 1-01" });
    for (const q of ["§ 1-01", "Chapter 3", "Title 15", "15 RCNY", "Section 259", "Title 20, ", "Independent budget office"]) {
      assert.equal(p(q), null, q);
    }
  });
});

// The server's tools over an index built from the fixtures, in a child process because the
// index directory is fixed at startup. `titled: false` strips the title fields, as an index built
// before 0.6.3 (the committed one, until the next refresh) has none.
function runServer(body, { titled = true } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "titles-index-"));
  try {
    const books = { charter: "[]", admin_code: titled ? admin.json : strip(admin.sections), rules: titled ? rules.json : strip(rules.sections) };
    for (const [corpus, json] of Object.entries(books)) writeFileSync(join(dir, `${corpus}.json`), json);
    const v = (json) => ({ currentThrough: "test", indexedAt: "2026-11-24T00:00:00Z", sectionCount: JSON.parse(json).length });
    writeFileSync(join(dir, "versions.json"), JSON.stringify(Object.fromEntries(Object.entries(books).map(([k, j]) => [k, v(j)]))));
    const code = `const c = await import(${JSON.stringify(pathToFileURL(join(ROOT, "dist", "corpus.js")).href)});
      const t = await import(${JSON.stringify(pathToFileURL(join(ROOT, "dist", "tools.js")).href)});
      const cite = (q, k) => { const r = c.getSection(q, k); return r.kind === "match" ? r.section.id : r.kind === "ambiguous" ? r.candidates.map((s) => s.id) : "none"; };
      const ids = (list) => list.map((s) => s.id);
      const body = async (name, args) => (await t.callTool(name, args)).content[0].text.split(/\\n\\n(?:Source: |BetaNYC modified this data: |---\\n|⚠️)/)[0];
      const out = {};
      ${body}
      console.log(JSON.stringify(out));`;
    const env = { ...process.env, NYC_LAWS_INDEX_DIR: dir };
    delete env.NYC_CLR_FOOTER;
    const r = spawnSync(process.execPath, ["--input-type=module", "-e", code], { env, cwd: ROOT, encoding: "utf8" });
    assert.equal(r.status, 0, r.stderr);
    return JSON.parse(r.stdout);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe("get_section, get_title and list_titles with titles", () => {
  const out = runServer(`
    for (const q of ["15 RCNY § 1-01", "15 RCNY 1-01", "Title 15 § 1-01", "Title 15, § 1-01", "15 R.C.N.Y. § 1-01", "15 RCNY § 1–01", "Title 15 RCNY § 1-01",
                     "§ 1-01", "§ 1–01", "24 RCNY Health Code § 81.08", "Health Code § 81.08", "24 RCNY § 81.08", "Title 38-A § 1-01", "38a RCNY § 1-01",
                     "Title 30, Notice", "Title 30, Apartment & Loft Order #49 (2017), Notice", "62 RCNY § 6-01", "Title 62, Chapter 5, § 6-01", "Title 62 Chapter 6 § 6-01",
                     "Title 15, Chapter 18", "99 RCNY § 1-01", "Title 24, New York City Health Code"]) out["get " + q] = cite(q);
    out["get rules § 1-01"] = cite("§ 1-01", "rules");
    out["get admin Title 16-A § 16-501"] = cite("Title 16-A § 16-501", "admin_code");
    out["get all Title 16-A, § 16-501"] = cite("Title 16-A, § 16-501");
    out["full"] = Object.fromEntries(["0-0-0-12", "0-0-0-41", "0-0-0-61", "0-0-0-102", "0-0-0-20", "0-0-0-52"].map((id) => [id, c.fullCitation(c.getSection(id === "0-0-0-41" ? "Health Code § 81.08" : id === "0-0-0-20" ? "Title 15, Chapter 18" : id === "0-0-0-61" ? "Title 30, Apartment & Loft Order #49 (2017), Notice" : id === "0-0-0-102" ? "Title 62, Chapter 5, § 6-01" : id === "0-0-0-52" ? "30 RCNY § 1-01" : "15 RCNY § 1-01").section)]));
    out["full admin"] = ["§ 16-101", "Title 16-A § 16-501", "§ 16-1000", "L.L. 2016/002"].map((q) => c.fullCitation(c.getSection(q, "admin_code").section));
    for (const q of ["Title 16", "Title 16-A", "title 16a", "Title 16-B", "Title 16, Chapter 1"]) out["admin title " + q] = ids(c.getTitle("admin_code", q));
    for (const q of ["Title 15, Chapter 18", "15 RCNY Chapter 18", "Title 15", "Title 38-A", "Chapter 1", "Chapter 18", "Title 99"]) out["rules title " + q] = ids(c.getTitle("rules", q));
    out["list rules"] = c.listTitles("rules").map((x) => x.citation);
    out["list admin"] = c.listTitles("admin_code").map((x) => x.citation);
    out["tool list"] = await body("list_titles", { corpus: "rules", limit: 4 });
    out["tool ambiguous"] = await body("get_section", { citation: "§ 1-01", corpus: "rules" });
    out["tool match"] = await body("get_section", { citation: "24 RCNY Health Code § 81.08" });
    out["tool title"] = await body("get_title", { corpus: "rules", title: "Title 15, Chapter 18" });
    out["tool chapter 1"] = await body("get_title", { corpus: "rules", title: "Chapter 1", limit: 3, offset: 2 });
    out["tool no title"] = await body("get_title", { corpus: "rules", title: "Title 99" });
    out["tool search"] = await body("search", { query: "Water supply text", corpus: "rules" });
  `);

  test("each citation form finds the one section it names", () => {
    for (const q of ["15 RCNY § 1-01", "15 RCNY 1-01", "Title 15 § 1-01", "Title 15, § 1-01", "15 R.C.N.Y. § 1-01", "15 RCNY § 1–01", "Title 15 RCNY § 1-01"]) {
      assert.equal(out["get " + q], "0-0-0-12", q);
    }
    assert.equal(out["get Title 38-A § 1-01"], "0-0-0-82");
    assert.equal(out["get 38a RCNY § 1-01"], "0-0-0-82");
    assert.equal(out["get admin Title 16-A § 16-501"], "0-0-0-22");
    assert.equal(out["get all Title 16-A, § 16-501"], "0-0-0-22");
    assert.equal(out["get Title 15, Chapter 18"], "0-0-0-20");
    assert.equal(out["get 99 RCNY § 1-01"], "none");
  });

  test("a bare '§ 1-01' still lists every title's, in title order", () => {
    const all = ["0-0-0-12", "0-0-0-32", "0-0-0-52", "0-0-0-82"];
    assert.deepEqual(out["get § 1-01"], all);
    assert.deepEqual(out["get § 1–01"], all, "an en dash is a hyphen");
    assert.deepEqual(out["get rules § 1-01"], all);
  });

  test("the Health Code is cited '24 RCNY Health Code § 81.08'", () => {
    assert.equal(out["get 24 RCNY Health Code § 81.08"], "0-0-0-41");
    assert.equal(out["get Health Code § 81.08"], "0-0-0-41");
    assert.equal(out["get 24 RCNY § 81.08"], "0-0-0-41");
    assert.equal(out["get Title 24, New York City Health Code"], "0-0-0-40", "the Health Code's chapter record, by its full citation");
    assert.equal(out.full["0-0-0-41"], "24 RCNY Health Code § 81.08");
  });

  test("a citation the publisher repeats inside one title is named with its chapter", () => {
    assert.deepEqual(out["get Title 30, Notice"], ["0-0-0-61", "0-0-0-71"]);
    assert.equal(out.full["0-0-0-61"], "Title 30, Apartment & Loft Order #49 (2017), Notice");
    assert.equal(out["get Title 30, Apartment & Loft Order #49 (2017), Notice"], "0-0-0-61");
    assert.deepEqual(out["get 62 RCNY § 6-01"], ["0-0-0-102", "0-0-0-111"]);
    assert.equal(out.full["0-0-0-102"], "Title 62, Chapter 5, § 6-01");
    assert.equal(out["get Title 62, Chapter 5, § 6-01"], "0-0-0-102");
    assert.equal(out["get Title 62 Chapter 6 § 6-01"], "0-0-0-111", "commas are optional");
  });

  test("full citations", () => {
    assert.equal(out.full["0-0-0-12"], "15 RCNY § 1-01");
    assert.equal(out.full["0-0-0-52"], "30 RCNY § 1-01");
    assert.equal(out.full["0-0-0-20"], "Title 15, Chapter 18");
    assert.deepEqual(out["full admin"], ["§ 16-101", "Title 16-A, § 16-501", "Title 16-B, § 16-1000", "L.L. 2016/002"]);
  });

  test("get_title: 'Title 16' is Title 16 alone, and 'Title 15, Chapter 18' one Rules chapter", () => {
    assert.deepEqual(out["admin title Title 16"], ["0-0-0-11", "0-0-0-12"]);
    assert.deepEqual(out["admin title Title 16-A"], ["0-0-0-21", "0-0-0-22"]);
    assert.deepEqual(out["admin title title 16a"], ["0-0-0-21", "0-0-0-22"]);
    assert.deepEqual(out["admin title Title 16-B"], ["0-0-0-30", "0-0-0-31"]);
    assert.deepEqual(out["admin title Title 16, Chapter 1"], ["0-0-0-11", "0-0-0-12"]);
    assert.deepEqual(out["rules title Title 15, Chapter 18"], ["0-0-0-20", "0-0-0-21"]);
    assert.deepEqual(out["rules title 15 RCNY Chapter 18"], ["0-0-0-20", "0-0-0-21"]);
    assert.deepEqual(out["rules title Title 15"], ["0-0-0-11", "0-0-0-12", "0-0-0-20", "0-0-0-21"]);
    assert.deepEqual(out["rules title Title 38-A"], ["0-0-0-81", "0-0-0-82", "0-0-0-90", "0-0-0-91"]);
    assert.deepEqual(out["rules title Chapter 1"], ["0-0-0-11", "0-0-0-12", "0-0-0-31", "0-0-0-32", "0-0-0-51", "0-0-0-52", "0-0-0-81", "0-0-0-82"], "every title's Chapter 1, in title order");
    assert.deepEqual(out["rules title Chapter 18"], ["0-0-0-20", "0-0-0-21"]);
    assert.deepEqual(out["rules title Title 99"], []);
  });

  test("list_titles: Rules chapters by title, labeled with it; Administrative Code labels unchanged", () => {
    assert.deepEqual(out["list rules"], [
      "Title 15, Chapter 1", "Title 15, Chapter 18", "Title 24, Chapter 1", "Title 24, Chapter 3", "Title 30, Chapter 1",
      "Title 38-A, Chapter 1", "Title 38-A, Chapter 2", "Title 62, Chapter 5", "Title 62, Chapter 6",
    ]);
    assert.deepEqual(out["list admin"], ["Chapter 1 (§ 16-101)", "Chapter 1 (§ 16-501)", "Chapter 1 (§ 16-1000)"]);
  });

  test("the tools' answers name each title", () => {
    assert.equal(out["tool list"], [
      "Showing 1 to 4 of 9. Call again with offset 4 for the next ones.",
      "",
      "Title 15: Department of Environmental Protection",
      "Title 15, Chapter 1 — Chapter 1: Scope",
      "Title 15, Chapter 18 — Chapter 18: Water Supply",
      "",
      "Title 24: Department of Health and Mental Hygiene",
      "Title 24, Chapter 1 — Chapter 1: General",
      "Title 24, Chapter 3 — Chapter 3: Vaccines",
    ].join("\n"));
    assert.match(out["tool ambiguous"], /^Multiple sections match "§ 1-01"\. Re-run get_section with the 'corpus' parameter and\/or a more specific citation:\n\n/);
    assert.ok(out["tool ambiguous"].includes(
      "[RULES] 15 RCNY § 1-01 — § 1-01 Scope and Application. (Title 15: Department of Environmental Protection)\n" +
      "[RULES] 24 RCNY § 1-01 — § 1-01 Definitions. (Title 24: Department of Health and Mental Hygiene)\n" +
      "[RULES] 30 RCNY § 1-01 — § 1-01 Purpose. (Title 30: Rent Guidelines Board)\n" +
      "[RULES] 38-A RCNY § 1-01 — § 1-01 Definitions. (Title 38-A: Civilian Complaint Review Board)"
    ), out["tool ambiguous"]);
    assert.match(out["tool match"], /^\[RULES\] 24 RCNY Health Code § 81\.08 \(matched in corpus: rules; in Title 24: Department of Health and Mental Hygiene\)\n§ 81\.08 Foods Containing Artificial Trans Fat\.\n\nTrans fat text\.$/);
    assert.equal(out["tool title"], [
      "2 records: each chapter's heading, then its sections in order.",
      "",
      "Title 15: Department of Environmental Protection",
      "Title 15, Chapter 18 — Chapter 18: Water Supply",
      "§ 18-11 — § 18-11 Preface.",
    ].join("\n"));
    // A page that starts inside a chapter names the next title before its chapter.
    assert.equal(out["tool chapter 1"], [
      "Showing 3 to 5 of 8. Call again with offset 5 for the next ones.",
      "",
      "Title 24: Department of Health and Mental Hygiene",
      "Title 24, Chapter 1 — Chapter 1: General",
      "§ 1-01 — § 1-01 Definitions.",
      "",
      "Title 30: Rent Guidelines Board",
      "Title 30, Chapter 1 — Chapter 1: Rent Guidelines",
    ].join("\n"));
    assert.match(out["tool no title"], /^No sections found for "Title 99" in rules\. list_titles lists each title's chapters\. Searched: the Rules of the City of New York\.$/);
    assert.match(out["tool search"], /^\[RULES\] 15 RCNY § 18-11 — § 18-11 Preface\.\nWater supply text\.$/);
  });
});

describe("an index built before 0.6.3 (no titles)", () => {
  const out = runServer(`
    out["get"] = cite("15 RCNY § 1-01");
    out["get hc"] = cite("24 RCNY Health Code § 81.08");
    out["full"] = c.fullCitation(c.getSection("Title 15, Chapter 18", "rules").section);
    out["list rules"] = c.listTitles("rules").map((x) => x.citation);
    out["admin title Title 16"] = ids(c.getTitle("admin_code", "Title 16"));
    out["tool no title"] = await body("get_title", { corpus: "rules", title: "Title 15" });
    out["tool list"] = await body("list_titles", { corpus: "rules", limit: 2 });
  `, { titled: false });

  test("a titled citation lists every record it could mean; labels and lists are as before", () => {
    assert.deepEqual(out.get, ["0-0-0-12", "0-0-0-32", "0-0-0-52", "0-0-0-82"], "every § 1-01: the index cannot tell titles apart");
    assert.equal(out["get hc"], "0-0-0-41", "the Health Code is found by its chapter, not its title");
    assert.equal(out.full, "Chapter 18");
    assert.deepEqual(out["list rules"], ["Chapter 1", "Chapter 1", "Chapter 1", "Chapter 1", "Chapter 2", "Chapter 3", "Chapter 5", "Chapter 6", "Chapter 18"]);
    assert.deepEqual(out["admin title Title 16"], ["0-0-0-11", "0-0-0-12", "0-0-0-21", "0-0-0-22", "0-0-0-30", "0-0-0-31"], "titles from section numbers, so 16-A and 16-B come too");
    assert.match(out["tool no title"], /^No sections found for "Title 15" in rules\. This copy of the index does not record Rules titles \(it was built before 0\.6\.3\); ask for a chapter, which list_titles lists\./);
    assert.equal(out["tool list"], "Showing 1 to 2 of 9. Call again with offset 2 for the next ones.\n\nChapter 1 — Chapter 1: Scope\nChapter 1 — Chapter 1: General");
  });
});
