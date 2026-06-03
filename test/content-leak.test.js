// Regression tests for the content-leak fix (PR-A0): three classes of garbage
// were leaking into the extracted legal text in data/index/json/*.json.
//
//   1. Undecoded entities — literal "&#160;" (nbsp) and "&divide;" surviving
//      into the index. Root cause: fast-xml-parser only decodes the five
//      predefined XML entities; numeric character references and non-predefined
//      named entities pass through as literal text. (The section sign "§"
//      renders fine NOT because "&#167;" is decoded, but because the source XML
//      uses a literal "§" character.) Fixed by decoding in normalize().
//
//   2. "[ALP S-xxx]" markers — American Legal Publishing source-edit markers
//      embedded in <HIGHLIGHTER> spans. Fixed by stripping in normalize().
//      A handful (19) are malformed in the source (missing the closing "]"),
//      so the stripper tolerates an absent bracket.
//
//   3. Leading-digit run-ons — "1Each agency", "1To", from enumeration list
//      markers. Root cause: the AML source spells each list item as
//      "<TAB/>1.<TAB/>text"; fast-xml-parser type-coerced the "1." text node to
//      the JS number 1 (dropping the period), and the empty <TAB/> separators
//      contributed no space, fusing "1" onto the next word. Fixed by
//      parseTagValue:false (preserves "1.") plus a separator space re-inserted
//      in extractText for standalone digit markers.
//
// IMPORTANT scope guard: the subdivision-letter no-space nit ("(6)the",
// "(a)the", "a.The") is OUT of scope and source-faithful. These tests include a
// guard that those are LEFT ALONE.
//
// Run with: node --test

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  makeParser,
  extractText,
  normalize,
  decodeEntities,
  stripAlpMarkers,
} from "../scripts/lib/extract-text.js";

const parser = makeParser();

// Parse an XML string and return the first element node matching `tag`.
function parseFirst(xml, tag) {
  const parsed = parser.parse(xml);
  const find = (arr) => {
    for (const obj of arr) {
      const key = Object.keys(obj).find((k) => k !== "#text" && k !== ":@");
      if (key === tag) return obj;
      if (key && Array.isArray(obj[key])) {
        const hit = find(obj[key]);
        if (hit) return hit;
      }
    }
    return null;
  };
  return find(parsed);
}

// Extract + normalize a PARA the way build-index does for body text.
function field(xml) {
  return normalize(extractText(parseFirst(xml, "PARA")));
}

// --- Class 1: entity decoding -------------------------------------------------

test("nbsp (&#160;) is decoded and whitespace-collapsed", () => {
  // § 433 shape: "...&#160;Editor's note:..."
  const xml = `<PARA>Member of department.&#160;Editor's note: Became Section 1129.</PARA>`;
  const text = field(xml);
  assert.doesNotMatch(text, /&#160;/, "literal &#160; must not survive");
  assert.doesNotMatch(text, /&#\d+;/, "no numeric entity may survive");
  assert.equal(text, "Member of department. Editor's note: Became Section 1129.");
});

test("nbsp between a clause and the next marker collapses to a single space", () => {
  // § 643 shape: "...systems;&#160; (6)the regulation..."  — note (6)the is left alone (scope guard).
  const xml = `<PARA>sewage disposal systems;&#160; (6)the regulation, inspection</PARA>`;
  const text = field(xml);
  assert.equal(text, "sewage disposal systems; (6)the regulation, inspection");
});

test("decodeEntities handles numeric refs, hex refs, and named entities", () => {
  assert.equal(decodeEntities("a&#160;b"), "a b"); // nbsp char (collapsed later)
  assert.equal(decodeEntities("a&#167;b"), "a§b"); // §
  assert.equal(decodeEntities("a&#8212;b"), "a—b"); // em-dash
  assert.equal(decodeEntities("a&#x2014;b"), "a—b"); // hex em-dash
  assert.equal(decodeEntities("a&divide;b"), "a÷b"); // ÷
  assert.equal(decodeEntities("Tom &amp; Jerry"), "Tom & Jerry");
});

test("an unknown named entity is left intact (not mangled)", () => {
  // We only decode a known map; anything else passes through untouched so we
  // never silently corrupt real text that happens to contain "&word;".
  assert.equal(decodeEntities("see &foobar; here"), "see &foobar; here");
});

test("the section sign is preserved (it is a literal char in source, not an entity)", () => {
  // Confirms we do not depend on "&#167;" decoding for §; a literal § survives.
  const xml = `<PARA>pursuant to § 292 of this chapter</PARA>`;
  assert.equal(field(xml), "pursuant to § 292 of this chapter");
});

// --- Class 2: ALP marker stripping -------------------------------------------

test("[ALP S-xxx] markers are stripped from body text", () => {
  // § 1043 shape: "a. Authority.&#160;[ALP S-054] 1Each agency..."
  const xml = `<PARA>a. Authority.&#160;<HIGHLIGHTER name="ALP">[ALP S-054]</HIGHLIGHTER> text follows</PARA>`;
  const text = field(xml);
  assert.doesNotMatch(text, /\[ALP/, "no ALP marker may survive");
  assert.equal(text, "a. Authority. text follows");
});

test("a malformed ALP marker missing its closing bracket is still stripped", () => {
  // 19 markers in the source genuinely lack the closing "]". The unclosed
  // pattern also consumes the trailing whitespace via "\s*", so the gap closes
  // to a single space (the closed-bracket form leaves the surrounding spaces and
  // relies on normalize()'s collapse). Either way, no ALP token survives.
  assert.equal(stripAlpMarkers("before [ALP S-044 after"), "before after");
  assert.equal(stripAlpMarkers("before [ALP S-044] after"), "before  after");
});

test("ALP stripping does not eat ordinary bracketed legal text", () => {
  assert.equal(stripAlpMarkers("the section [Repealed.] applies"), "the section [Repealed.] applies");
  assert.equal(stripAlpMarkers("see note [a] below"), "see note [a] below");
});

// --- Class 3: leading-digit run-on repair ------------------------------------

test("enumeration marker '1.' from <TAB/>1.<TAB/> is preserved and spaced", () => {
  // § 1043 shape: the source is "<TAB/>1.<TAB/>Each agency..."; the old bug
  // coerced "1." to 1 and fused it to "Each" → "1Each".
  const xml = `<PARA><TAB tab-count="1"/>1.<TAB tab-count="1"/>Each agency is empowered.</PARA>`;
  const text = field(xml);
  assert.doesNotMatch(text, /\b1Each\b/, "must not run '1' into 'Each'");
  assert.equal(text, "1. Each agency is empowered.");
});

test("multi-digit enumeration markers ('10.') are preserved and spaced", () => {
  const xml = `<PARA><TAB tab-count="1"/>10.<TAB tab-count="1"/>such other rules.</PARA>`;
  assert.equal(field(xml), "10. such other rules.");
});

test("a decimal section number in a LINK is NOT corrupted (no number coercion)", () => {
  // Old bug: parseTagValue coerced "81.20" → 81.2 (dropped trailing zero).
  const xml = `<PARA>of section <LINK>81.20</LINK> regarding potable water</PARA>`;
  assert.equal(field(xml), "of section 81.20 regarding potable water");
});

test("a section number containing 'E' is NOT parsed as scientific notation", () => {
  // Old bug: parseTagValue coerced "59E-22" → 5.9e-21. This corrupted real
  // section citations. parseTagValue:false keeps it a string.
  const xml = `<PARA>pursuant to 35 RCNY § <LINK>59E-22</LINK>(i)</PARA>`;
  const text = field(xml);
  assert.doesNotMatch(text, /e-\d+/, "must not render scientific notation");
  assert.match(text, /59E-22/);
});

// --- Scope guard: deferred subdivision-letter nit is LEFT ALONE ---------------

test("GUARD: '(6)the' subdivision marker is left untouched (out of scope)", () => {
  // This source-faithful no-space nit is deliberately NOT fixed. If a future
  // change starts inserting a space here, this test must fail so the decision
  // is revisited explicitly.
  const xml = `<PARA>systems; (6)the regulation</PARA>`;
  assert.equal(field(xml), "systems; (6)the regulation");
});

test("GUARD: '(a)the' and 'a.The' letter markers are left untouched", () => {
  assert.equal(field(`<PARA>means (a)the term</PARA>`), "means (a)the term");
  // Letter-dot marker fused to a capitalized word: source-faithful, left as-is.
  assert.equal(field(`<PARA>b.The board shall</PARA>`), "b.The board shall");
});

test("GUARD: a digit-dot inside running text (a citation) is NOT given a space", () => {
  // "§ 2.a." style citations are running text in one node, not a standalone
  // marker node, so the marker repair must not fire on them.
  const xml = `<PARA>as enacted. § 2.a. The department shall act</PARA>`;
  const text = field(xml);
  assert.match(text, /§ 2\.a\. The department/, "citation spacing must be unchanged");
});
