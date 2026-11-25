// Citations the Law Reader website gives work in get_section, and the MCP's work in the website's
// jump box. The site's "Copy citation" names the book ("NYC Administrative Code § 27-506",
// "NYC Charter § 1133") and the part of a section a reader is on ("NYC Charter § 1133(b)(1)",
// "Section FC 102.4(1)", issue #76); the Administrative Code cites its building and fire code
// sections by code ("Section FC 102", "RS 18-1").
//
// Fixtures: a hand-made index written to a temporary directory (the publisher's shapes, not the
// publisher's text), and a hand-made citations.json list built with the site's own recordKeys.
// Offline, and no counts from the real law: the daily refresh runs npm test (CS-23). Every record
// the site builds from the real data is checked by npm run test:site-data
// (test/site-data/citation-round-trip.test.js).
//
// Requires: npm run build (dist/ must exist). Guaranteed by "pretest".

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseBookName, splitSubdivision } from "../dist/corpus.js";
import { parseQuery, lookup, recordKeys, citationKeys, jumpTarget, CHARTER_BOOK, ADMIN_BOOK, RULES_BOOK } from "../site/assets/jump.js";
import { BOOKS } from "../scripts/lib/site/config.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");

// ------------------------------------------------------------------ the MCP

const rec = (corpus, id, citation, heading, titleNumber) => ({ corpus, id, citation, heading, text: `${heading} text.`, ...(titleNumber ? { titleNumber } : {}) });
const INDEX = {
  charter: [
    rec("charter", "c-1", "Chapter 1", "Chapter 1: Name"),
    rec("charter", "c-1133", "§ 1133", "§ 1133 Records."),
    rec("charter", "c-1152", "§ 1152", "§ 1152 Charter revision commission."),
    rec("charter", "c-259", "§ 259", "§ 259 Independent budget office."),
  ],
  admin_code: [
    rec("admin_code", "a-ch1", "Chapter 1", "Chapter 1: General Provisions", "1"),
    rec("admin_code", "a-1-101", "§ 1-101", "§ 1-101 Administrative code; how cited.", "1"),
    // A number the Charter has too, so a book's name must choose.
    rec("admin_code", "a-1133", "§ 1133", "§ 1133 A number shared with another book.", "11"),
    rec("admin_code", "a-11-602", "§ 11-602", "§ 11-602 Exemptions.", "11"),
    rec("admin_code", "a-11-602.1", "§ 11-602.1", "§ 11-602.1 More exemptions.", "11"),
    rec("admin_code", "a-27-506", "§ 27-506", "§ 27-506 Fire escapes.", "27"),
    // Headings that hold a number a stripped or short citation also holds (review of this change).
    rec("admin_code", "a-27-2030", "§ 27-2030", "§ 27-2030 Permits.", "27"),
    rec("admin_code", "a-rs-18-1", "RS 18-1", "Reference Standard RS 18-1", "27"),
    rec("admin_code", "a-d302", "D302 Conversions to a multiple dwelling (MDL 9(2))", "D302 Conversions to a multiple dwelling (MDL 9(2))", "28"),
    rec("admin_code", "a-bc-e104", "Section BC E104", "Section BC E104 Scope.", "28"),
    rec("admin_code", "a-ec-80", "Section EC 80", "Section EC 80 General.", "28"),
    rec("admin_code", "a-fc-102", "Section FC 102", "Section FC 102 Applicability.", "29"),
    // A local-law chapter is cited by its year; the website files it under "Local laws".
    { ...rec("admin_code", "a-1985", "1985", "1985"), level: "Chapter" },
  ],
  rules: [
    rec("rules", "r-1-01", "§ 1-01", "§ 1-01 Definitions.", "15"),
    // A Rules heading that starts with another book's citation (1 RCNY § 33-01's shape; re-review).
    rec("rules", "r-33-01", "§ 33-01", "Administrative Code § 26-212.1 (Work Performed Without a Permit). [Repealed]", "1"),
  ],
};

// get_section over that index, in a child process because the index directory is fixed at startup.
function runServer(body) {
  const dir = mkdtempSync(join(tmpdir(), "round-trip-index-"));
  try {
    for (const [corpus, list] of Object.entries(INDEX)) writeFileSync(join(dir, `${corpus}.json`), JSON.stringify(list));
    const v = (list) => ({ currentThrough: "test", indexedAt: "2026-11-24T00:00:00Z", sectionCount: list.length });
    writeFileSync(join(dir, "versions.json"), JSON.stringify(Object.fromEntries(Object.entries(INDEX).map(([k, l]) => [k, v(l)]))));
    const code = `const c = await import(${JSON.stringify(pathToFileURL(join(ROOT, "dist", "corpus.js")).href)});
      const t = await import(${JSON.stringify(pathToFileURL(join(ROOT, "dist", "tools.js")).href)});
      const cite = (q, k) => { const r = c.getSection(q, k); const ids = r.kind === "match" ? r.section.id : r.kind === "ambiguous" ? r.candidates.map((s) => s.id) : "none"; return r.subdivision ? { ids, part: r.subdivision } : ids; };
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

const QUERIES = [
  // Book names.
  "NYC Administrative Code § 27-506", "New York City Administrative Code § 27-506", "Administrative Code § 27-506", "Admin. Code § 27-506",
  "Admin Code § 27-506", "N.Y.C. Admin. Code § 27-506", "NYC Charter § 1133", "New York City Charter § 1133", "Charter § 1133", "the City Charter § 1133",
  "§ 1133", "NYC Administrative Code § 1133", "NYC Charter Chapter 1", "NYC Administrative Code Title 1, Chapter 1", "NYC Administrative Code Section FC 102",
  "NYC Administrative Code RS 18-1", "NYC Administrative Code D302 Conversions to a multiple dwelling (MDL 9(2))", "NYC Charter § 9999",
  "NYC Administrative Code Local laws, 1985", "Local laws, 1985", "NYC Charter Local laws, 1985",
  // Words that start with a book's name are looked up as typed.
  "Charter revision commission", "Administrative code", "charter",
  // Only the citation as typed is searched in headings: not what follows a book's name, a
  // local-law year, or a section a part was stripped from.
  "Admin. Code § 27-50(b)", "15 RCNY § 1-0(a)", "Section FC 10.1", "Local laws, 2030", "NYC Administrative Code Local laws, 2030", "Admin Code 1", "Admin Code 2030",
  // Code forms.
  "FC 102", "Section FC 102", "EC 80", "RS 18-1",
  // Parts of a section.
  "Charter § 1133(b)(1)", "NYC Charter § 1133(b)(1)", "§ 1133(b)(1)", "Section FC 102.4(1)", "FC 102.4", "NYC Administrative Code Section FC 102.4(1)",
  "Section BC E104.2.2", "§ 27-506(a)", "15 RCNY § 1-01(a)",
  // Exact citations win, as before.
  "D302 Conversions to a multiple dwelling (MDL 9(2))", "§ 11-602.1", "§ 11-602.9", "Independent budget office (IBO)", "Independent budget office",
];

const out = runServer(`
  for (const q of ${JSON.stringify(QUERIES)}) out[q] = cite(q);
  out["charter in admin"] = c.getSection("NYC Charter § 1133", "admin_code");
  out["admin in charter"] = c.getSection("Admin Code § 27-506", "charter");
  out["charter in charter"] = cite("NYC Charter § 1133", "charter");
  out["admin heading in rules"] = cite("Administrative Code § 26-212.1 (Work Performed Without a Permit). [Repealed]", "rules");
  out["tool charter in admin"] = await body("get_section", { citation: "NYC Charter § 1133", corpus: "admin_code" });
  out["tool part"] = await body("get_section", { citation: "Charter § 1133(b)(1)" });
  out["tool code part"] = await body("get_section", { citation: "Section FC 102.4(1)" });
  out["tool ambiguous part"] = await body("get_section", { citation: "§ 1133(b)(1)" });
  out["tool exact"] = await body("get_section", { citation: "D302 Conversions to a multiple dwelling (MDL 9(2))" });
`);

describe("get_section takes the website's citations", () => {
  test("a book's name narrows the lookup to that book", () => {
    for (const q of ["NYC Administrative Code § 27-506", "New York City Administrative Code § 27-506", "Administrative Code § 27-506", "Admin. Code § 27-506", "Admin Code § 27-506", "N.Y.C. Admin. Code § 27-506"]) {
      assert.equal(out[q], "a-27-506", q);
    }
    for (const q of ["NYC Charter § 1133", "New York City Charter § 1133", "Charter § 1133", "the City Charter § 1133"]) assert.equal(out[q], "c-1133", q);
    assert.deepEqual(out["§ 1133"], ["c-1133", "a-1133"], "with no book named, both");
    assert.equal(out["NYC Administrative Code § 1133"], "a-1133");
    assert.equal(out["NYC Charter Chapter 1"], "c-1");
    assert.equal(out["NYC Administrative Code Title 1, Chapter 1"], "a-ch1");
    assert.equal(out["NYC Administrative Code Section FC 102"], "a-fc-102");
    assert.equal(out["NYC Administrative Code RS 18-1"], "a-rs-18-1");
    assert.equal(out["NYC Administrative Code D302 Conversions to a multiple dwelling (MDL 9(2))"], "a-d302");
    assert.equal(out["NYC Charter § 9999"], "none");
    assert.equal(out["NYC Administrative Code Local laws, 1985"], "a-1985");
    assert.equal(out["Local laws, 1985"], "a-1985");
    assert.equal(out["NYC Charter Local laws, 1985"], "none");
  });

  test("a book's name and another corpus: not found, and says why, as an RCNY citation does", () => {
    assert.deepEqual(out["charter in admin"], { kind: "none", bookCitation: "charter" });
    assert.deepEqual(out["admin in charter"], { kind: "none", bookCitation: "admin_code" });
    assert.equal(out["charter in charter"], "c-1133");
    assert.equal(out["admin heading in rules"], "r-33-01", "a heading in the asked-for book that starts with another book's name is still found");
    assert.match(out["tool charter in admin"], /^Section not found: "NYC Charter § 1133" is a citation of the New York City Charter, so it is not looked for in the New York City Administrative Code\. Ask again with corpus 'charter', or with no corpus\.$/);
  });

  test("words that start with a book's name are looked up as typed", () => {
    assert.equal(out["Charter revision commission"], "c-1152");
    assert.deepEqual(out["Administrative code"], ["a-1-101", "r-33-01"], "both headings hold the words");
    assert.deepEqual(out["charter"], "c-1152");
  });

  test("the heading search runs only on the citation as typed", () => {
    for (const q of ["Admin. Code § 27-50(b)", "15 RCNY § 1-0(a)", "Section FC 10.1", "Local laws, 2030", "NYC Administrative Code Local laws, 2030", "Admin Code 1", "Admin Code 2030"]) {
      assert.equal(out[q], "none", q);
    }
  });

  test("building and fire code citations", () => {
    assert.equal(out["FC 102"], "a-fc-102");
    assert.equal(out["Section FC 102"], "a-fc-102");
    assert.equal(out["EC 80"], "a-ec-80");
    assert.equal(out["RS 18-1"], "a-rs-18-1");
  });

  test("a part of a section, on a miss: the whole section, marked with the part", () => {
    assert.deepEqual(out["Charter § 1133(b)(1)"], { ids: "c-1133", part: "(b)(1)" });
    assert.deepEqual(out["NYC Charter § 1133(b)(1)"], { ids: "c-1133", part: "(b)(1)" });
    assert.deepEqual(out["§ 1133(b)(1)"], { ids: ["c-1133", "a-1133"], part: "(b)(1)" });
    assert.deepEqual(out["Section FC 102.4(1)"], { ids: "a-fc-102", part: "102.4(1)" });
    assert.deepEqual(out["FC 102.4"], { ids: "a-fc-102", part: "102.4" });
    assert.deepEqual(out["NYC Administrative Code Section FC 102.4(1)"], { ids: "a-fc-102", part: "102.4(1)" });
    assert.deepEqual(out["Section BC E104.2.2"], { ids: "a-bc-e104", part: "E104.2.2" });
    assert.deepEqual(out["§ 27-506(a)"], { ids: "a-27-506", part: "(a)" });
    assert.deepEqual(out["15 RCNY § 1-01(a)"], { ids: "r-1-01", part: "(a)" });
    assert.match(out["tool part"], /^You asked for \(b\)\(1\), a part of § 1133\. The index holds whole sections, so the whole section follows\.\n\n\[CHARTER\] § 1133 \(matched in corpus: charter\)\n§ 1133 Records\.\n\n§ 1133 Records\. text\.$/);
    assert.match(out["tool code part"], /^You asked for 102\.4\(1\), a part of Section FC 102\. The index holds whole sections, so the whole section follows\.\n\n\[ADMIN_CODE\] Section FC 102 /);
    assert.match(out["tool ambiguous part"], /^You asked for \(b\)\(1\), a part of a section\. The index holds whole sections, so these are the whole sections it may be in\.\n\nMultiple sections match "§ 1133\(b\)\(1\)"\./);
  });

  test("exact citations win and behave as before: parentheses and points in real citations", () => {
    assert.equal(out["D302 Conversions to a multiple dwelling (MDL 9(2))"], "a-d302");
    assert.equal(out["§ 11-602.1"], "a-11-602.1");
    assert.equal(out["§ 11-602.9"], "none", "a point in an Administrative Code number is not a subsection");
    assert.equal(out["Independent budget office (IBO)"], "none", "words in parentheses are not a subdivision");
    assert.equal(out["Independent budget office"], "c-259");
    assert.doesNotMatch(out["tool exact"], /You asked for/);
  });

  test("parseBookName and splitSubdivision", () => {
    assert.deepEqual(parseBookName("NYC Administrative Code § 27-506"), { corpus: "admin_code", rest: "§ 27-506" });
    assert.deepEqual(parseBookName("Admin. Code Section FC 102"), { corpus: "admin_code", rest: "Section FC 102" });
    assert.deepEqual(parseBookName("New York City Charter Preamble"), { corpus: "charter", rest: "Preamble" });
    assert.equal(parseBookName("Charter revision commission"), null);
    assert.equal(parseBookName("NYC Charter"), null);
    assert.equal(parseBookName("§ 1133"), null);
    assert.deepEqual(splitSubdivision("§ 1133(b)(1)"), [{ section: "§ 1133", subdivision: "(b)(1)" }]);
    assert.deepEqual(splitSubdivision("Section FC 102.4(1)"), [{ section: "Section FC 102.4", subdivision: "(1)" }, { section: "Section FC 102", subdivision: "102.4(1)" }]);
    assert.deepEqual(splitSubdivision("Section BC 908.10-2"), [{ section: "Section BC 908", subdivision: "908.10-2" }]);
    assert.deepEqual(splitSubdivision("16 RCNY § 1-02.2(c)"), [{ section: "16 RCNY § 1-02.2", subdivision: "(c)" }, { section: "16 RCNY § 1-02", subdivision: "1-02.2(c)" }]);
    assert.deepEqual(splitSubdivision("§ 259 (a)"), [{ section: "§ 259", subdivision: "(a)" }]);
    assert.deepEqual(splitSubdivision("§ 20-T(iv)"), [{ section: "§ 20-T", subdivision: "(iv)" }]);
    assert.deepEqual(splitSubdivision("§ 3501(3)-2"), [{ section: "§ 3501", subdivision: "(3)-2" }]);
    assert.deepEqual(splitSubdivision("§ 11-224.1(h-1)(ii)(I)"), [{ section: "§ 11-224.1", subdivision: "(h-1)(ii)(I)" }]);
    assert.deepEqual(splitSubdivision("Independent budget office (IBO)"), [], "no number: words");
    assert.deepEqual(splitSubdivision("§ 11-602.1"), [], "a point in an Administrative Code number is not a subsection");
    assert.deepEqual(splitSubdivision("(a)"), []);
  });
});

// ------------------------------------------------------------------ the website's jump box

const entry = (b, citation, full, path, title, rules = false) => ({ k: recordKeys(citation, title, { rules }, full), c: full, h: "", p: path, b });
const LIST = [
  entry(CHARTER_BOOK, "§ 1133", "NYC Charter § 1133", "/charter/sections/1133"),
  entry(CHARTER_BOOK, "Chapter 1", "NYC Charter Chapter 1", "/charter/chapters/1"),
  entry(ADMIN_BOOK, "§ 1133", "NYC Administrative Code § 1133", "/admin-code/sections/1133", "11"),
  entry(ADMIN_BOOK, "§ 27-506", "NYC Administrative Code § 27-506", "/admin-code/sections/27-506", "27"),
  entry(ADMIN_BOOK, "RS 18-1", "NYC Administrative Code RS 18-1", "/admin-code/sections/rs-18-1", "27"),
  entry(ADMIN_BOOK, "Chapter 1", "NYC Administrative Code Title 28, Chapter 1", "/admin-code/titles/28/chapters/1", "28"),
  entry(ADMIN_BOOK, "D302 Conversions to a multiple dwelling (MDL 9(2))", "NYC Administrative Code D302 Conversions to a multiple dwelling (MDL 9(2))", "/admin-code/sections/d302", "28"),
  entry(ADMIN_BOOK, "SECTION 1 – GENERAL", "NYC Administrative Code SECTION 1 – GENERAL", "/admin-code/sections/section-1-general", "27"),
  entry(ADMIN_BOOK, "Section BC E104", "NYC Administrative Code Section BC E104", "/admin-code/sections/bc-e104", "28"),
  entry(ADMIN_BOOK, "Section FC 102", "NYC Administrative Code Section FC 102", "/admin-code/sections/fc-102", "29"),
  entry(ADMIN_BOOK, "1985", "NYC Administrative Code Local laws, 1985", "/admin-code/titles/local-laws/chapters/1985"),
  entry(RULES_BOOK, "Chapter 1", "28 RCNY Chapter 1", "/rules/titles/28/chapters/1", "28", true),
  entry(RULES_BOOK, "Appendix A", "2 RCNY Appendix A", "/rules/titles/2/sections/appendix-a", "2", true),
  entry(RULES_BOOK, "Appendix", "15 RCNY Chapter 19.1, Appendix", "/rules/titles/15/sections/appendix", "15", true),
  entry(RULES_BOOK, "Title 6, Chapter 2, Subchapter B", "Title 6, Chapter 2, Subchapter B", "/rules/titles/6/sections/subchapter-b", "6", true),
];
const go = (q) => {
  const r = lookup(LIST, q);
  return r.jump ? jumpTarget(r.matches[0], r.anchor) : r.matches.map((m) => m.p);
};

describe("the jump box takes the MCP's citations and its own", () => {
  test("the book names in jump.js are config.js's", () => {
    assert.equal(CHARTER_BOOK, BOOKS.charter.short);
    assert.equal(ADMIN_BOOK, BOOKS.admin_code.short);
    assert.equal(RULES_BOOK, BOOKS.rules.short);
  });

  test("a book's name: only that book", () => {
    for (const q of ["NYC Administrative Code § 27-506", "Admin Code § 27-506", "Admin. Code § 27-506", "New York City Administrative Code § 27-506", "administrative code 27-506"]) {
      assert.equal(go(q), "/admin-code/sections/27-506", q);
    }
    assert.equal(go("NYC Administrative Code § 1133"), "/admin-code/sections/1133");
    assert.equal(go("NYC Charter § 1133"), "/charter/sections/1133");
    assert.equal(go("charter 1133(b)"), "/charter/sections/1133#(b)");
    assert.deepEqual(go("§ 1133"), ["/charter/sections/1133", "/admin-code/sections/1133"], "no book named: both, as before");
    assert.deepEqual(go("NYC Charter § 27-506"), [], "not in the Charter: the words are searched");
    // "Title 28, Chapter 1" names no book; after "NYC Administrative Code" it is the Admin Code's.
    assert.equal(go("NYC Administrative Code Title 28, Chapter 1"), "/admin-code/titles/28/chapters/1");
    assert.deepEqual(go("Title 28, Chapter 1"), ["/admin-code/titles/28/chapters/1", "/rules/titles/28/chapters/1"]);
    assert.equal(go("28 RCNY Chapter 1"), "/rules/titles/28/chapters/1");
  });

  test("building and fire code numbers and reference standards", () => {
    for (const q of ["FC 102", "§ FC 102", "Section FC 102", "fc102", "NYC Administrative Code Section FC 102"]) assert.equal(go(q), "/admin-code/sections/fc-102", q);
    assert.equal(go("Section FC 102.4(1)"), "/admin-code/sections/fc-102#102.4(1)");
    assert.equal(go("NYC Administrative Code Section FC 102.4"), "/admin-code/sections/fc-102#102.4");
    assert.equal(go("FC 102(a)"), "/admin-code/sections/fc-102#(a)");
    assert.equal(go("BC E104.2.2"), "/admin-code/sections/bc-e104#E104.2.2");
    for (const q of ["RS 18-1", "rs18-1", "Reference Standard RS 18-1", "reference standard 18-1", "NYC Administrative Code RS 18-1"]) assert.equal(go(q), "/admin-code/sections/rs-18-1", q);
    assert.deepEqual(citationKeys("Section FC 102", "29"), ["fc 102", "title 29 fc 102"]);
    assert.deepEqual(citationKeys("RS 18-1", "27"), ["rs 18-1", "title 27 rs 18-1"]);
    assert.deepEqual(parseQuery("Section FC 102.4(1)"), { key: "fc 102.4", anchor: "(1)", part: { key: "fc 102", anchor: "102.4(1)" } });
  });

  test("every citation in the list leads back to its own page", () => {
    for (const e of LIST) assert.equal(go(e.c), e.p, e.c);
    // Including with a book's name the site does not write, and an en dash typed as a hyphen.
    assert.equal(go("NYC Administrative Code SECTION 1 - GENERAL"), "/admin-code/sections/section-1-general");
    assert.ok(LIST.find((e) => e.c.startsWith("15 RCNY Chapter 19.1")).k.includes("15 rcny chapter 19.1, appendix"));
  });

  test("words are still words", () => {
    assert.equal(parseQuery("budget office"), null);
    assert.equal(parseQuery("D302 Conversions"), null, "no book named: searched");
    assert.equal(parseQuery("NYC Charter"), null);
    assert.deepEqual(go("charter revision commission"), []);
    assert.deepEqual(go("Health code violations"), []);
  });
});
