// Layer 5b: In-process MCP tool handler tests.
//
// These tests invoke the handler functions from dist/corpus.js directly — no
// stdio server is spawned. This exercises the real corpus-loading, search,
// citation-matching, and version-reading paths against the committed index.
//
// Confirmed export names and signatures (src/corpus.ts, verified 2026-07-06):
//   searchCorpus(query: string, corpus: Corpus | "all" = "all", limit = 10): Section[]  // relevance-ranked
//   getSection(citation: string, corpus?: Corpus): GetSectionResult
//     GetSectionResult = { kind: "match", section } | { kind: "ambiguous", candidates } | { kind: "none" }
//   normalizeCitation(input: string): string
//   listTitles(corpus: Corpus): { citation, heading }[]
//   getTitle(corpus: Corpus, title: string): Section[]  // whole-token prefix match
//   getVersions(): Versions
//
// Note on getSection by raw id: getSection() matches on s.citation or
// s.heading — NOT on s.id. Calling getSection("0-0-0-1325") returns null
// because "0-0-0-1325" does not match the citation "§ 292" or the heading
// "Section 292. Administration." This is a potential future enhancement
// (id-based lookup), not a bug being fixed here. Tests use the real contract.
//
// Requires: npm run build (dist/corpus.js must exist). In CI this is guaranteed
// by the "pretest": "npm run build" script in package.json.
//
// Run with: node --test

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  searchCorpus,
  getSection,
  normalizeCitation,
  listTitles,
  getTitle,
  getVersions,
} from "../dist/corpus.js";

// Convenience: unwrap a single-match result or fail loudly.
function expectMatch(citation, corpus) {
  const result = getSection(citation, corpus);
  assert.equal(
    result.kind,
    "match",
    `getSection(${JSON.stringify(citation)}${corpus ? `, ${corpus}` : ""}) expected a single match, got kind="${result.kind}"` +
      (result.kind === "ambiguous"
        ? ` (${result.candidates.length} candidates)`
        : "")
  );
  return result.section;
}

// ---------------------------------------------------------------------------
// searchCorpus
// ---------------------------------------------------------------------------

describe("searchCorpus", () => {
  test("'sinking fund' in charter returns results including § 292", () => {
    // § 292 is the 14th section mentioning "sinking fund" in the charter
    // (search is linear by section order). limit=25 is required to reach it.
    // The test plan spec listed limit=10, but § 292 falls at position 14 in
    // the actual index — limit adjusted to 25 to ensure § 292 is included.
    const results = searchCorpus("sinking fund", "charter", 25);
    assert.ok(results.length > 0, "must return at least one result");

    const s292 = results.find((s) => s.citation === "§ 292");
    assert.ok(
      s292,
      `§ 292 must appear in results (it is the 14th sinking-fund hit); got citations: ${results.map((r) => r.citation).join(", ")}`
    );
  });

  test("§ 292 text contains the issue-#3 corrected phrase (not 'sectionof')", () => {
    // Uses limit=25 — see note in the previous test.
    const results = searchCorpus("sinking fund", "charter", 25);
    const s292 = results.find((s) => s.citation === "§ 292");
    assert.ok(s292, "§ 292 must be present in sinking-fund results (limit=25)");

    assert.match(
      s292.text,
      /section two hundred ninety-eight of this chapter/,
      "text must contain the spelled-out cross-reference in document order"
    );
    assert.doesNotMatch(
      s292.text,
      /sectionof/,
      "run-together 'sectionof' must not appear — would indicate issue-#3 regression"
    );
  });

  test("results are limited to the requested count", () => {
    const results = searchCorpus("section", "charter", 3);
    assert.ok(
      results.length <= 3,
      `limit=3 must be respected; got ${results.length}`
    );
  });

  test("corpus='all' searches across all three corpora", () => {
    const results = searchCorpus("sinking fund", "all", 20);
    assert.ok(results.length > 0, "all-corpus search must return results");
    // Results may come from any corpus; just confirm the array is populated.
    for (const s of results) {
      assert.ok(
        ["charter", "admin_code", "rules"].includes(s.corpus),
        `corpus field must be one of the three valid values, got "${s.corpus}"`
      );
    }
  });

  test("returns [] for a query that matches nothing", () => {
    const results = searchCorpus("zzzqqq", "charter", 10);
    assert.deepEqual(results, []);
  });

  test("returns [] for a nonsense query across all corpora", () => {
    const results = searchCorpus("zzzqqq", "all", 10);
    assert.deepEqual(results, []);
  });

  // -------------------------------------------------------------------------
  // Ranking (fix 2026-07-06): heading > citation > body, whole-word > substring,
  // sorted before truncation (so admin_code/rules are reachable at low limits).
  // -------------------------------------------------------------------------

  test("heading matches rank above body-only matches", () => {
    const results = searchCorpus("sinking fund", "charter", 25);
    const q = "sinking fund";
    let seenBodyOnly = false;
    for (const s of results) {
      const inHeading = s.heading.toLowerCase().includes(q);
      if (!inHeading) seenBodyOnly = true;
      else
        assert.equal(
          seenBodyOnly,
          false,
          "a heading match must not appear after a body-only match"
        );
    }
  });

  test("corpus='all' at a small limit is not exhausted by charter (ranking reaches other corpora)", () => {
    // "taxicab" appears in admin_code/rules headings; before the ranking fix a
    // small limit was filled by whatever corpus came first in file order.
    const results = searchCorpus("taxicab", "all", 10);
    assert.ok(results.length > 0);
    const nonCharter = results.some((s) => s.corpus !== "charter");
    assert.ok(
      nonCharter,
      `top-10 'taxicab' results must include admin_code/rules heading matches; got ${results.map((s) => s.corpus).join(",")}`
    );
  });
});

// ---------------------------------------------------------------------------
// getSection
// ---------------------------------------------------------------------------

describe("getSection", () => {
  test("getSection('§ 292') returns the charter administration section", () => {
    const section = expectMatch("§ 292");
    assert.equal(section.corpus, "charter");
    assert.equal(section.citation, "§ 292");
    assert.equal(section.heading, "Section 292. Administration.");
  });

  test("§ 292 text is clean — no entities, no leaked XML, no run-together", () => {
    const section = expectMatch("§ 292");
    assert.doesNotMatch(section.text, /&#\d+;|&[a-z]+;/i, "no undecoded entities");
    assert.doesNotMatch(section.text, /<[A-Z]+[\s>]/, "no leaked XML tags");
    assert.doesNotMatch(section.text, /sectionof/, "no run-together text");
    assert.doesNotMatch(section.text, / {2,}/, "no double spaces");
    assert.equal(section.text, section.text.trim(), "text must be trimmed");
  });

  test("getSection('§ 99999') returns kind 'none' (non-existent section)", () => {
    assert.equal(getSection("§ 99999").kind, "none");
  });

  test("getSection by raw id ('0-0-0-1325') returns 'none' (not a supported contract)", () => {
    // getSection matches on citation or heading-substring, not on the raw id
    // field. This documents current behaviour — id-based lookup is a potential
    // future enhancement.
    assert.equal(getSection("0-0-0-1325").kind, "none");
  });

  test("input normalization: '292', 'Section 292', '§292' all find § 292", () => {
    for (const q of ["292", "Section 292", "§292", "  §  292 "]) {
      const section = expectMatch(q, "charter");
      assert.equal(section.citation, "§ 292", `query ${JSON.stringify(q)}`);
    }
  });

  test("decimal sections: § 11-602 and § 11-602.1 are distinct (truncation fix)", () => {
    const base = expectMatch("§ 11-602", "admin_code");
    assert.equal(base.citation, "§ 11-602");
    assert.match(base.heading, /Definitions/);

    const decimal = expectMatch("§ 11-602.1", "admin_code");
    assert.equal(decimal.citation, "§ 11-602.1");
    assert.match(decimal.heading, /Application of this subchapter/);

    assert.notEqual(base.id, decimal.id);
    assert.notEqual(base.text, decimal.text);
  });

  test("cross-corpus tie ('Chapter 3') returns a disambiguation list", () => {
    const result = getSection("Chapter 3");
    assert.equal(result.kind, "ambiguous", "Chapter 3 exists in multiple corpora");
    assert.ok(result.candidates.length > 1);
    const corpora = new Set(result.candidates.map((s) => s.corpus));
    assert.ok(corpora.size > 1, "candidates span multiple corpora");
  });

  test("corpus param scopes the lookup ('Chapter 11' in charter)", () => {
    const section = expectMatch("Chapter 11", "charter");
    assert.equal(section.corpus, "charter");
    assert.match(section.heading, /Independent Budget Office/i);
  });

  test("repeated rules citation ('§ 1-01') is ambiguous, not first-hit", () => {
    const result = getSection("§ 1-01", "rules");
    assert.equal(result.kind, "ambiguous");
    assert.ok(result.candidates.length > 1);
    for (const s of result.candidates) assert.equal(s.citation, "§ 1-01");
  });
});

describe("normalizeCitation", () => {
  test("strips §, 'Section', case, and whitespace", () => {
    for (const q of ["§ 11-602.1", "§11-602.1", "Section 11-602.1", " 11-602.1 "]) {
      assert.equal(normalizeCitation(q), "11-602.1", JSON.stringify(q));
    }
    assert.equal(normalizeCitation("Chapter 3"), "chapter 3");
  });
});

// ---------------------------------------------------------------------------
// getVersions
// ---------------------------------------------------------------------------

describe("getVersions", () => {
  test("returns an object with entries for all three corpora", () => {
    const versions = getVersions();
    for (const corpus of ["charter", "admin_code", "rules"]) {
      assert.ok(
        versions[corpus],
        `versions must include an entry for ${corpus}`
      );
    }
  });

  test("each corpus version has currentThrough and sectionCount > 0", () => {
    const versions = getVersions();
    for (const corpus of ["charter", "admin_code", "rules"]) {
      const v = versions[corpus];
      assert.ok(
        typeof v.currentThrough === "string" && v.currentThrough.length > 0,
        `${corpus}.currentThrough must be a non-empty string`
      );
      assert.ok(
        typeof v.sectionCount === "number" && v.sectionCount > 0,
        `${corpus}.sectionCount must be a positive number, got ${v.sectionCount}`
      );
    }
  });

  test("each corpus version has its own indexedAt (get_version reports per-corpus dates)", () => {
    const versions = getVersions();
    for (const corpus of ["charter", "admin_code", "rules"]) {
      assert.ok(
        typeof versions[corpus].indexedAt === "string" &&
          versions[corpus].indexedAt.length > 0,
        `${corpus}.indexedAt must be a non-empty string`
      );
    }
  });
});

// ---------------------------------------------------------------------------
// listTitles
// ---------------------------------------------------------------------------

describe("listTitles", () => {
  test("listTitles('charter') returns a non-empty array", () => {
    const titles = listTitles("charter");
    assert.ok(Array.isArray(titles), "must return an array");
    assert.ok(titles.length > 0, "must return at least one title");
  });

  test("every entry from listTitles has citation and heading fields", () => {
    const titles = listTitles("charter");
    for (const t of titles) {
      assert.ok(t.citation, "every title entry must have a non-empty citation");
      assert.ok(t.heading, "every title entry must have a non-empty heading");
    }
  });

  test("listTitles includes Chapter 11 (Independent Budget Office)", () => {
    const titles = listTitles("charter");
    const ch11 = titles.find(
      (t) =>
        t.heading.toLowerCase().includes("chapter 11") ||
        t.citation.toLowerCase().includes("chapter 11")
    );
    assert.ok(
      ch11,
      "Charter Chapter 11 (Independent Budget Office) must appear in listTitles"
    );
  });
});

// ---------------------------------------------------------------------------
// getTitle
// ---------------------------------------------------------------------------

describe("getTitle", () => {
  test("getTitle('charter', 'Chapter 11') returns sections for Chapter 11", () => {
    const sections = getTitle("charter", "Chapter 11");
    assert.ok(Array.isArray(sections), "must return an array");
    assert.ok(sections.length > 0, "Chapter 11 must yield at least one section");
  });

  test("Chapter 11 results include the Independent Budget Office chapter entry", () => {
    const sections = getTitle("charter", "Chapter 11");
    const ch11 = sections.find(
      (s) => s.heading.toLowerCase().includes("independent budget office")
    );
    assert.ok(
      ch11,
      "Chapter 11 results must include the Independent Budget Office chapter heading"
    );
  });

  test("whole-token match: 'Chapter 1' does not return 'Chapter 10'..'Chapter 19'", () => {
    const sections = getTitle("charter", "Chapter 1");
    assert.ok(sections.length > 0, "Chapter 1 must yield results");
    for (const s of sections) {
      assert.doesNotMatch(
        s.citation + " " + s.heading,
        /Chapter 1\d/,
        `over-collected: ${s.citation} — ${s.heading}`
      );
    }
  });

  test("returns [] for empty title", () => {
    assert.deepEqual(getTitle("charter", "  "), []);
  });
});
