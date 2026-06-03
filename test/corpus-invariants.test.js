// Layer 1: Corpus-invariant assertions over the committed data/index/json/*.json.
//
// These tests guard against the measurable signatures of known parser bugs:
//   - Run-together text ("sectionof") from inline-LINK ordering (issue #3)
//   - Leaked XML tags from improper extraction
//   - Undecoded entities (&#160; etc.) leaking into index text (issue PR-A0)
//   - Double spaces produced by bad whitespace handling
//   - Leading/trailing whitespace
//   - Basic structural integrity (non-empty corpus, id, heading)
//
// All invariants run against the COMMITTED index (Option A from the test plan).
// This catches a bad committed index immediately — which is what actually ships to
// consumers of the MCP server. The parser code path is exercised by the
// extract-text unit tests (test/extract-text.test.js) and the MCP tool tests
// (test/mcp-tools.test.js).
//
// Failure output: each invariant collects ALL violations, then asserts count===0
// with a message listing corpus, id, citation, and a ~60-char snippet. Up to 10
// violations are printed inline; the total count is always reported.
//
// Run with: node --test

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const INDEX_DIR = join(__dirname, "..", "data", "index", "json");

// ---------------------------------------------------------------------------
// Index loading
// ---------------------------------------------------------------------------

function loadIndex(name) {
  const path = join(INDEX_DIR, `${name}.json`);
  return JSON.parse(readFileSync(path, "utf8"));
}

function loadVersions() {
  return JSON.parse(readFileSync(join(INDEX_DIR, "versions.json"), "utf8"));
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// Format a violation into a readable one-liner for assert messages.
function fmt(v) {
  return `${v.corpus} ${v.id} [${v.citation}] "${v.snippet}"`;
}

// Build the assert message for a set of violations.
function msg(label, violations) {
  const total = violations.length;
  const shown = violations.slice(0, 10);
  return (
    `${total} violation(s) — ${label}.\n` +
    shown.map((v) => `  ${fmt(v)}`).join("\n") +
    (total > 10 ? `\n  ... and ${total - 10} more` : "")
  );
}

// Collect violations from a scan function across all three corpora.
// scanFn(section, corpusName) → snippet string if violation, null otherwise.
function collectViolations(sections, corpusName, scanFn) {
  const violations = [];
  for (const s of sections) {
    const snippet = scanFn(s, corpusName);
    if (snippet !== null) {
      violations.push({
        corpus: corpusName,
        id: s.id,
        citation: s.citation,
        snippet,
      });
    }
  }
  return violations;
}

// Return a ~60-char excerpt centered on a regex match in a string, or null.
function excerpt(str, re) {
  const m = str.match(re);
  if (!m) return null;
  const idx = str.indexOf(m[0]);
  return str.slice(Math.max(0, idx - 25), idx + 35).replace(/\s+/g, " ");
}

// ---------------------------------------------------------------------------
// Load all three corpora once (shared across all tests in this file).
// ---------------------------------------------------------------------------

const CORPORA = {
  charter: loadIndex("charter"),
  admin_code: loadIndex("admin_code"),
  rules: loadIndex("rules"),
};

const VERSIONS = loadVersions();

// ---------------------------------------------------------------------------
// Invariant 1: No run-together text signatures
//
// The primary regex /\b(sections?|subdivision|paragraph|chapter|title)of\b/i
// catches the actual issue-#3 run-together bug ("sectionof", "chapterof", etc.)
// and is verified clean across all three corpora.
//
// The secondary regex /\bsections? and of\b/ is a related pattern from the
// test plan. Scanning confirms it matches 6 legitimate legal-text constructions
// ("of this section and of section 11-245.1-b", "of this section and of
// subdivisions g, h and i") — these are source-faithful legal phrasings, not
// extraction bugs. Those 6 hits are catalogued below as known-legitimate and
// skipped from the hard-zero assertion. If a future refactor changes the
// extraction path, re-run the scan to confirm zero new hits before removing
// the comment.
//
// Known-legitimate "section and of" IDs (verified 2026-06-02):
//   admin_code: 0-0-0-8137, 0-0-0-17414, 0-0-0-212850, 0-0-0-214713, 0-0-0-24791
//   rules: 0-0-0-84369
// ---------------------------------------------------------------------------

const KNOWN_SECTION_AND_OF = new Set([
  "0-0-0-8137",
  "0-0-0-17414",
  "0-0-0-212850",
  "0-0-0-214713",
  "0-0-0-24791",
  "0-0-0-84369",
]);

const RE_RUN_TOGETHER = /\b(sections?|subdivision|paragraph|chapter|title)of\b/i;
const RE_SECTION_AND_OF = /\bsections? and of\b/i;

describe("Invariant 1: no run-together text signatures", () => {
  for (const [name, sections] of Object.entries(CORPORA)) {
    test(`${name}: no word-fused run-together (sectionof, chapterof, …)`, () => {
      const violations = collectViolations(sections, name, (s) => {
        for (const val of [s.heading, s.text]) {
          const snip = excerpt(val, RE_RUN_TOGETHER);
          if (snip !== null) return snip;
        }
        return null;
      });
      assert.equal(violations.length, 0, msg("run-together text signatures", violations));
    });

    test(`${name}: no NEW "section and of" outside the 6 known-legitimate IDs`, () => {
      // The 6 KNOWN_SECTION_AND_OF IDs match this regex via legitimate legal
      // phrasing (confirmed by manual review, 2026-06-02). Only new hits are
      // treated as violations.
      const violations = collectViolations(sections, name, (s) => {
        if (KNOWN_SECTION_AND_OF.has(s.id)) return null; // known-legitimate
        for (const val of [s.heading, s.text]) {
          const snip = excerpt(val, RE_SECTION_AND_OF);
          if (snip !== null) return snip;
        }
        return null;
      });
      assert.equal(
        violations.length,
        0,
        msg("unexpected 'section and of' run (outside 6 known-legitimate IDs)", violations)
      );
    });
  }
});

// ---------------------------------------------------------------------------
// Invariant 2: No leaked XML tags
// ---------------------------------------------------------------------------

const RE_XML_TAG = /<[A-Z]+[\s>]/;

describe("Invariant 2: no leaked XML tags", () => {
  for (const [name, sections] of Object.entries(CORPORA)) {
    test(`${name}: heading and text contain no raw XML tags`, () => {
      const violations = collectViolations(sections, name, (s) => {
        for (const val of [s.heading, s.text]) {
          const snip = excerpt(val, RE_XML_TAG);
          if (snip !== null) return snip;
        }
        return null;
      });
      assert.equal(violations.length, 0, msg("leaked XML tags", violations));
    });
  }
});

// ---------------------------------------------------------------------------
// Invariant 3: No undecoded entities
//
// The content-leak fix (PR-A0) decoded &#160; and other numeric/named entities.
// This invariant verifies the fix holds. If it fails, something has re-introduced
// the leak — do NOT silently relax; fix the extract path and re-index.
// ---------------------------------------------------------------------------

const RE_ENTITY = /&#\d+;|&[a-z]+;/i;

describe("Invariant 3: no undecoded HTML/XML entities", () => {
  for (const [name, sections] of Object.entries(CORPORA)) {
    test(`${name}: no &#NNN; or &name; entities survive into the index`, () => {
      const violations = collectViolations(sections, name, (s) => {
        for (const val of [s.heading, s.text]) {
          const snip = excerpt(val, RE_ENTITY);
          if (snip !== null) return snip;
        }
        return null;
      });
      assert.equal(
        violations.length,
        0,
        msg(
          "undecoded entities — the content-leak fix (PR-A0) should have eliminated these; " +
            "a failure here means the extract path or index must be updated",
          violations
        )
      );
    });
  }
});

// ---------------------------------------------------------------------------
// Invariant 4: No double spaces
//
// normalize() collapses all whitespace runs to a single space and trims.
// Pre-scan (2026-06-02) confirmed 0 violations across all three corpora.
// If this assertion fails, investigate the extract/normalize path before relaxing.
// ---------------------------------------------------------------------------

const RE_DOUBLE_SPACE = / {2,}/;

describe("Invariant 4: no double (or multi) spaces", () => {
  for (const [name, sections] of Object.entries(CORPORA)) {
    test(`${name}: no two-or-more consecutive spaces in any field`, () => {
      const violations = collectViolations(sections, name, (s) => {
        for (const val of [s.heading, s.text]) {
          const snip = excerpt(val, RE_DOUBLE_SPACE);
          if (snip !== null) return snip;
        }
        return null;
      });
      assert.equal(
        violations.length,
        0,
        msg("double spaces — normalize() should prevent these", violations)
      );
    });
  }
});

// ---------------------------------------------------------------------------
// Invariant 5: No leading or trailing whitespace
// ---------------------------------------------------------------------------

describe("Invariant 5: no leading/trailing whitespace in any field", () => {
  for (const [name, sections] of Object.entries(CORPORA)) {
    test(`${name}: heading and text are trimmed`, () => {
      const violations = [];
      for (const s of sections) {
        for (const [fieldName, val] of [
          ["heading", s.heading],
          ["text", s.text],
        ]) {
          if (val && val !== val.trim()) {
            violations.push({
              corpus: name,
              id: s.id,
              citation: s.citation,
              snippet: `[${fieldName}] ${JSON.stringify(val.slice(0, 40))}`,
            });
            break;
          }
        }
      }
      assert.equal(
        violations.length,
        0,
        msg("leading/trailing whitespace", violations)
      );
    });
  }
});

// ---------------------------------------------------------------------------
// Invariant 6: Structural integrity
//
// (a) Every corpus has section count > 0 and matches versions.json sectionCount.
// (b) Every section has a non-empty id and heading.
//
// Note on RECORD-count vs. index-count: build-index.js deliberately filters the
// source XML (only Section/Chapter style records with heading.length > 3 are
// indexed), so the index count is a subset of raw XML records — NOT a 1:1 match.
// We assert against versions.json sectionCount (the authoritative committed
// snapshot), not against the raw source record count.
// ---------------------------------------------------------------------------

describe("Invariant 6: structural integrity", () => {
  test("versions.json has entries for all three corpora with sectionCount > 0", () => {
    for (const corpus of ["charter", "admin_code", "rules"]) {
      assert.ok(
        VERSIONS[corpus],
        `versions.json missing entry for ${corpus}`
      );
      assert.ok(
        typeof VERSIONS[corpus].sectionCount === "number" &&
          VERSIONS[corpus].sectionCount > 0,
        `${corpus}.sectionCount must be > 0, got ${VERSIONS[corpus]?.sectionCount}`
      );
      assert.ok(
        VERSIONS[corpus].currentThrough,
        `${corpus}.currentThrough must be non-empty`
      );
    }
  });

  for (const [name, sections] of Object.entries(CORPORA)) {
    test(`${name}: section count matches versions.json`, () => {
      const expected = VERSIONS[name].sectionCount;
      assert.equal(
        sections.length,
        expected,
        `${name}: loaded ${sections.length} sections but versions.json reports ${expected}`
      );
    });

    test(`${name}: every entry has non-empty id and heading`, () => {
      const missingId = sections.filter((s) => !s.id);
      const missingHeading = sections.filter((s) => !s.heading);
      assert.equal(
        missingId.length,
        0,
        `${missingId.length} entries have empty id`
      );
      assert.equal(
        missingHeading.length,
        0,
        `${missingHeading.length} entries have empty heading`
      );
    });
  }
});
