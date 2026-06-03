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
