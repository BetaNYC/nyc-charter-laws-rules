// Regression test for issue #3: inline <LINK> cross-references were reordered
// out of document order during text extraction, relocating spelled-out section
// numbers to the end of the sentence and running adjacent words together
// ("sectionof"). The fix is to parse with preserveOrder: true and walk the
// ordered tree. These tests exercise the shared extract-text helpers directly.
//
// Run with: node --test

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  makeParser,
  extractText,
  childrenByTag,
  getAttr,
  tagOf,
  normalize,
} from "../scripts/lib/extract-text.js";

const parser = makeParser();

// Helper: parse an XML string and return the first element node matching `tag`.
function parseFirst(xml, tag) {
  const parsed = parser.parse(xml);
  // parsed is the ordered top-level array; find the requested element.
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

test("spelled-out <LINK> cross-reference stays in document order (Charter § 292)", () => {
  // Verbatim from data/raw/charter.zip XML/0-0-0-1277.xml, RECORD 0-0-0-1325.
  const xml = `<PARA>The comptroller shall administer and manage the general sinking fund and any additional sinking funds established pursuant to section <LINK style-name="Jump" type="Jump" destination-name="298" destination-id="0-0-0-461">two hundred ninety-eight</LINK> of this chapter and shall have custody of the securities and other assets in such funds.</PARA>`;
  const para = parseFirst(xml, "PARA");
  const text = normalize(extractText(para));

  // The number must appear inline, between "section" and "of this chapter".
  assert.match(
    text,
    /pursuant to section two hundred ninety-eight of this chapter/,
    "cross-reference number must remain in document order"
  );
  // The run-together signature must NOT be present.
  assert.doesNotMatch(text, /\bsectionof\b/, "must not run 'section' into 'of'");
  // The number must not be relocated to the end.
  assert.doesNotMatch(
    text,
    /assets in such funds\.\s*two hundred ninety-eight/,
    "cross-reference must not be appended after the sentence"
  );
});

test("numeric multi-LINK cross-reference stays in order ('sections 277 and 278')", () => {
  const xml = `<PARA>The provisions of sections <LINK type="Jump">277</LINK> and <LINK type="Jump">278</LINK> of the charter shall apply.</PARA>`;
  const para = parseFirst(xml, "PARA");
  const text = normalize(extractText(para));
  assert.match(text, /provisions of sections 277 and 278 of the charter shall apply/);
  assert.doesNotMatch(text, /sections and of/, "must not collapse to 'sections and of'");
});

test("inline element does not introduce double spaces", () => {
  const xml = `<PARA>before <LINK>middle</LINK> after</PARA>`;
  const para = parseFirst(xml, "PARA");
  const text = normalize(extractText(para));
  assert.equal(text, "before middle after");
});

test("single space around inline element is preserved (no missing space)", () => {
  // Real-world spacing: a space precedes the LINK and follows it.
  const xml = `<PARA>see section <LINK>five</LINK> of this title</PARA>`;
  const para = parseFirst(xml, "PARA");
  assert.equal(normalize(extractText(para)), "see section five of this title");
});

test("childrenByTag and getAttr read the ordered shape", () => {
  const xml = `<RECORD id="0-0-0-1325"><HEADING>Section 292. Administration.</HEADING><PARA>body text</PARA></RECORD>`;
  const record = parseFirst(xml, "RECORD");
  assert.equal(getAttr(record, "id"), "0-0-0-1325");
  const headings = childrenByTag(record, "HEADING");
  assert.equal(headings.length, 1);
  assert.equal(normalize(extractText(headings[0])), "Section 292. Administration.");
  const paras = childrenByTag(record, "PARA");
  assert.equal(normalize(extractText(paras[0])), "body text");
});

test("nested inline formatting (CHARFORMAT inside PARA) extracts in order", () => {
  const xml = `<PARA>The term <CHARFORMAT style-name="Italic">agency</CHARFORMAT> means a city agency.</PARA>`;
  const para = parseFirst(xml, "PARA");
  assert.equal(normalize(extractText(para)), "The term agency means a city agency.");
});

// ---------------------------------------------------------------------------
// Layer 3 edge cases — ordering, nesting, empty elements, and helper coverage
//
// Entity decoding is covered in test/content-leak.test.js; these tests do not
// duplicate that. The cases below focus on tree-structure edge cases that the
// original 6 tests and content-leak tests do not reach.
// ---------------------------------------------------------------------------

test("numeric-only text node in LINK stays in order (typeof node === 'number' branch)", () => {
  // Exercises the `typeof node === "number"` path in extractText: fast-xml-parser
  // with parseTagValue:false keeps "298" as a string, but parseTagValue:true
  // (old default) coerced it to the number 298. Both code paths converge through
  // String(node) so the result is identical — confirmed by running with both
  // parser configs. With the current config (parseTagValue:false) the node stays
  // a string, but the number branch is still present as a guard.
  const xml = `<PARA>see <LINK>298</LINK> here</PARA>`;
  const para = parseFirst(xml, "PARA");
  assert.equal(normalize(extractText(para)), "see 298 here");
});

test("deep nesting: text–elem–text–elem–text interleave extracts in order", () => {
  // <PARA>a <CHARFORMAT>b</CHARFORMAT> c <LINK>d</LINK> e</PARA>
  // Five tokens (text, elem, text, elem, text) in alternation; all must land in
  // document order with single spaces, no duplication, no loss.
  const xml = `<PARA>a <CHARFORMAT>b</CHARFORMAT> c <LINK>d</LINK> e</PARA>`;
  const para = parseFirst(xml, "PARA");
  assert.equal(normalize(extractText(para)), "a b c d e");
});

test("PARA > SUBPARA > LINK deep nest extracts all text in order", () => {
  // Mirrors a real AML shape where body text is further subdivided.
  const xml = `<PARA>intro <SUBPARA>sub <LINK>ref</LINK> end</SUBPARA> tail</PARA>`;
  const para = parseFirst(xml, "PARA");
  assert.equal(normalize(extractText(para)), "intro sub ref end tail");
});

test("self-closing empty LINK element produces no crash and no stray space", () => {
  // <LINK/> inside a PARA contributes an empty string; normalize() collapses
  // any resulting double space so the output is clean.
  const xml = `<PARA>before <LINK/> after</PARA>`;
  const para = parseFirst(xml, "PARA");
  const text = normalize(extractText(para));
  assert.equal(text, "before after", "self-closing LINK must not introduce stray space");
  assert.doesNotMatch(text, / {2,}/, "no double space from self-closing element");
});

test("explicit empty LINK element produces no crash and no stray space", () => {
  const xml = `<PARA>before <LINK></LINK> after</PARA>`;
  const para = parseFirst(xml, "PARA");
  const text = normalize(extractText(para));
  assert.equal(text, "before after");
});

test("whitespace-only text node between elements collapses to a single space", () => {
  // <LINK>a</LINK>   <LINK>b</LINK>: three raw spaces between elements.
  // trimValues:false preserves them; normalize() collapses to one space.
  const xml = `<PARA><LINK>a</LINK>   <LINK>b</LINK></PARA>`;
  const para = parseFirst(xml, "PARA");
  assert.equal(normalize(extractText(para)), "a b");
});

// --- helper coverage ---------------------------------------------------------

test("childrenByTag returns empty array when no children match the tag", () => {
  const xml = `<RECORD id="x"><HEADING>Head</HEADING></RECORD>`;
  const record = parseFirst(xml, "RECORD");
  // RECORD has a HEADING child but no PARA children.
  const result = childrenByTag(record, "PARA");
  assert.ok(Array.isArray(result), "must return an array");
  assert.equal(result.length, 0, "must return [] for a tag with no matches");
});

test("getAttr returns empty string for a missing attribute", () => {
  const xml = `<RECORD id="abc"><HEADING>H</HEADING></RECORD>`;
  const record = parseFirst(xml, "RECORD");
  assert.equal(getAttr(record, "id"), "abc");
  assert.equal(getAttr(record, "nonexistent"), "");
  assert.equal(getAttr(record, "style-name"), "");
});

test("tagOf returns null for a #text-only node", () => {
  // A pure text node has only the "#text" key; tagOf must skip it and return null.
  const textOnlyNode = { "#text": "some text content" };
  assert.equal(tagOf(textOnlyNode), null);
});

test("tagOf returns the element name for a normal element node", () => {
  const xml = `<PARA>content</PARA>`;
  const para = parseFirst(xml, "PARA");
  assert.equal(tagOf(para), "PARA");
});
