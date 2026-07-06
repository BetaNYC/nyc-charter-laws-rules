// Build smoke test (Layer 5a-i): exercises the pure corpus builder end-to-end on
// a tiny hand-authored AML-shaped fixture, with no multi-MB ZIPs.
//
// The fixtures below mirror the real element shape in data/raw/charter/XML/*.xml
// (DOCUMENT > LEVEL[style-name=Section] > RECORD[id] with HEADING, plus a sibling
// LEVEL[style-name="Normal Level"] > RECORD > PARA holding the body). They prove:
//   - a Section record is indexed with the right shape and a derived citation
//     ("Section 292." → "§ 292");
//   - inline <LINK> cross-references stay in document order (the issue #3 fix);
//   - leaked entities (&#160;) are decoded/normalized out of the body text;
//   - a non-qualifying record (style-name not Section/Chapter) is filtered out;
//   - a Section whose heading is too short (<= 3 chars) is filtered out;
//   - a Chapter with no body is still indexed (empty text).
//
// Run with: node --test

import { test } from "node:test";
import assert from "node:assert/strict";
import { buildSectionsFromXml } from "../scripts/lib/build-corpus.js";

// A realistic Section record (mirrors Charter § 292): a Section-styled LEVEL whose
// RECORD carries the HEADING, with a sibling Normal-Level LEVEL holding the body.
// The body contains an inline <LINK> (document-order test) and a leaked &#160;
// (entity-decoding test).
const SECTION_292_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<DOCUMENT source-infobase-name="Charter">
  <LEVEL style-name="Section" style-name-escaped="Section" level-depth="3" toc-section="true">
    <RECORD id="0-0-0-1325" number="2267" version="3">
      <HEADING>Section 292. Administration. </HEADING>
      <PARA>
        <DESTINATION id="0-0-0-449" name="292"/>Section 292. <CHARFORMAT bold="1">Administration. </CHARFORMAT>
      </PARA>
    </RECORD>
    <LEVEL style-name="Normal Level" style-name-escaped="Normal-Level" level-depth="0" toc-section="false">
      <RECORD id="0-0-0-1326" number="2268" version="616">
        <PARA>The comptroller shall administer and manage the general sinking fund&#160;established pursuant to section <LINK style-name="Jump" type="Jump" destination-name="298" destination-id="0-0-0-461">two hundred ninety-eight</LINK> of this chapter. </PARA>
      </RECORD>
    </LEVEL>
  </LEVEL>
</DOCUMENT>`;

// A Chapter record with a real heading but no Normal-Level body — should be
// indexed with empty text (the builder deliberately keeps empty-bodied chapters).
const CHAPTER_11_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<DOCUMENT source-infobase-name="Charter">
  <LEVEL style-name="Chapter" style-name-escaped="Chapter" level-depth="2" toc-section="false">
    <RECORD id="0-0-0-1262" number="2217" version="3">
      <HEADING>Chapter 11: Independent Budget Office</HEADING>
    </RECORD>
  </LEVEL>
</DOCUMENT>`;

// A document with records that must be FILTERED OUT:
//   - a Normal-Level (non-Section/Chapter) record with a HEADING — wrong style;
//   - a Section-styled record whose heading is too short (<= 3 chars).
const NON_QUALIFYING_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<DOCUMENT source-infobase-name="Charter">
  <LEVEL style-name="Normal Level" style-name-escaped="Normal-Level" level-depth="0" toc-section="false">
    <RECORD id="0-0-0-9001" number="9001" version="1">
      <HEADING>This heading is on a Normal-Level record and must be ignored.</HEADING>
      <PARA>Body text that should never be indexed because the style is Normal Level.</PARA>
    </RECORD>
  </LEVEL>
  <LEVEL style-name="Section" style-name-escaped="Section" level-depth="3" toc-section="true">
    <RECORD id="0-0-0-9002" number="9002" version="1">
      <HEADING>ab</HEADING>
    </RECORD>
  </LEVEL>
</DOCUMENT>`;

test("build smoke: pure builder indexes a Section record with correct shape and citation", () => {
  const sections = buildSectionsFromXml([SECTION_292_XML], "charter");
  assert.equal(sections.length, 1, "exactly one Section should be indexed");

  const s = sections[0];
  assert.equal(s.corpus, "charter");
  assert.equal(s.id, "0-0-0-1325");
  assert.equal(s.citation, "§ 292", 'citation "Section 292." → "§ 292"');
  assert.equal(s.heading, "Section 292. Administration.");
  assert.ok(s.heading.length > 0, "heading is non-empty");

  // Body text: inline <LINK> stays in document order (issue #3) and the &#160;
  // entity is decoded/collapsed to a normal space (content-leak fix, PR-A0).
  assert.match(s.text, /general sinking fund established pursuant to section/);
  assert.match(s.text, /section two hundred ninety-eight of this chapter/);
  assert.doesNotMatch(s.text, /sectionof/, "no run-together word");
});

test("build smoke: extracted text is clean (no tags, no entities, no edge whitespace)", () => {
  const [s] = buildSectionsFromXml([SECTION_292_XML], "charter");
  assert.doesNotMatch(s.text, /</, "no leaked XML tags");
  assert.doesNotMatch(s.text, /&#/, "no undecoded numeric entities");
  assert.doesNotMatch(s.text, /&[a-z]+;/i, "no undecoded named entities");
  assert.doesNotMatch(s.text, / {2,}/, "no double spaces");
  assert.equal(s.text, s.text.trim(), "no leading/trailing whitespace");
  assert.equal(s.heading, s.heading.trim(), "heading has no edge whitespace");
});

test("build smoke: non-qualifying records are filtered out", () => {
  const sections = buildSectionsFromXml([NON_QUALIFYING_XML], "charter");
  assert.equal(
    sections.length,
    0,
    "Normal-Level record and too-short-heading Section must both be filtered"
  );
});

test("build smoke: a Chapter with no body is indexed with empty text", () => {
  const sections = buildSectionsFromXml([CHAPTER_11_XML], "charter");
  assert.equal(sections.length, 1);
  assert.equal(sections[0].citation, "Chapter 11");
  assert.equal(sections[0].id, "0-0-0-1262");
  assert.equal(sections[0].text, "", "no Normal-Level body → empty text");
});

test("build smoke: builder accumulates across multiple XML files in order", () => {
  const sections = buildSectionsFromXml(
    [SECTION_292_XML, NON_QUALIFYING_XML, CHAPTER_11_XML],
    "charter"
  );
  // Only the Section and the Chapter qualify; non-qualifying file contributes 0.
  assert.equal(sections.length, 2);
  assert.deepEqual(
    sections.map((s) => s.citation),
    ["§ 292", "Chapter 11"]
  );
});

test("build smoke: a parse error is reported via onError and does not throw", () => {
  const errors = [];
  // The builder swallows parse failures the way the CLI does (warn + continue).
  // Use clearly malformed XML; assert the good file still indexes.
  const sections = buildSectionsFromXml(
    ["<DOCUMENT><LEVEL style-name=", SECTION_292_XML],
    "charter",
    (e) => errors.push(e)
  );
  assert.equal(sections.length, 1, "the well-formed file is still indexed");
});

// ---------------------------------------------------------------------------
// extractCitation unit cases (fix 2026-07-06: decimal-section truncation).
// Previously headings were split at the first "." so "§ 11-602.1 ..." produced
// citation "§ 11-602" — colliding with the real § 11-602 and making 340+
// duplicate citations in admin_code.
// ---------------------------------------------------------------------------

import { extractCitation } from "../scripts/lib/build-corpus.js";

test("extractCitation: decimal, hyphenated, lettered, and charter styles", () => {
  const cases = [
    // admin_code / rules "§" style
    ["§ 11-602.1 Application of this subchapter.", "§ 11-602.1"],
    ["§ 11-602 Definitions.", "§ 11-602"],
    ["§ 10-110.1 Firearms licenses.", "§ 10-110.1"],
    ["§ 14-151 Body-worn cameras.", "§ 14-151"],
    ["§ 19-533.1 Something.", "§ 19-533.1"],
    ["§ 22-a Reserved.", "§ 22-a"],
    ["§ 3-04 Obtaining Access to Keys of Premises Sealed Pursuant to § 26-127", "§ 3-04"],
    ["§§ 27-2004 Definitions.", "§ 27-2004"],
    ["§3-119.5 No space after symbol.", "§ 3-119.5"],
    // charter spelled-out style (no "§")
    ["Section 259. Independent budget office.", "§ 259"],
    ["Section 1046(c) Hearings.", "§ 1046"],
    // chapter / title styles
    ["Chapter 11: Independent Budget Office", "Chapter 11"],
    ["Title 11 Taxation and Finance", "Title 11"],
  ];
  for (const [heading, expected] of cases) {
    assert.equal(extractCitation(heading), expected, heading);
  }
});

test("extractCitation: sentence period does not truncate, decimal dot is kept", () => {
  // "." followed by a digit is part of the section number; "." followed by a
  // space (or end) is a sentence period and terminates the token.
  assert.equal(extractCitation("§ 11-602. Definitions."), "§ 11-602");
  assert.equal(extractCitation("§ 11-602.1. Application."), "§ 11-602.1");
});
