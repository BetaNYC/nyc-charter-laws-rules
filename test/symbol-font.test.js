// Symbol-font text to Unicode (issue #88).
//
// American Legal Publishing's XML sets some characters in the old Symbol font, which draws
// Greek letters and math signs on ordinary code points: the XML's "³" is the "≥" the law says.
// scripts/lib/symbol-font.js maps the text inside those runs to Unicode with the Unicode
// Consortium's Adobe Symbol table (scripts/vendor/unicode-adobe-symbol/). These tests use XML
// copied from the publisher's July 2026 files (Administrative Code "Current through Local Law
// 2026/112", Rules "Current through rules effective July 1, 2026"), trimmed to the records
// that matter, and check that text in any other font is left alone.
//
// Run with: node --test

import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import {
  SYMBOL_TO_UNICODE,
  parseSymbolTable,
  symbolToUnicode,
  mapSymbolRuns,
  createSymbolTally,
} from "../scripts/lib/symbol-font.js";
import { makeParser, extractText, normalize, childrenByTag } from "../scripts/lib/extract-text.js";
import { buildSectionsFromXml } from "../scripts/lib/build-corpus.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SYM = `<CHARFORMAT bold="0" italic="0" underline="0" strike-out="0" hidden="0" font-name="Symbol" font-family="serif" character-set="symbol">`;

const paraText = (xml, tally = null) => {
  const tree = makeParser().parse(xml);
  mapSymbolRuns(tree, tally);
  return normalize(extractText(tree));
};

// --- The table ---------------------------------------------------------------------------------

test("table: the codes the publisher's files use map to the characters the Symbol font draws", () => {
  const want = {
    0xa3: "≤", 0xb3: "≥", 0xb4: "×", 0xb7: "•", 0xd6: "√", 0xa7: "♣",
    0x44: "Δ", 0x53: "Σ", 0x57: "Ω", 0x61: "α", 0x6d: "μ", 0x71: "θ", 0x72: "ρ", 0x73: "σ",
    0x28: "(", 0x20: " ",
  };
  for (const [code, ch] of Object.entries(want)) {
    assert.equal(SYMBOL_TO_UNICODE.get(Number(code)), ch, `0x${Number(code).toString(16)}`);
  }
});

test("table: where it lists two Unicode values, the one NFKC keeps wins; Corporate Use is left out", () => {
  assert.equal(SYMBOL_TO_UNICODE.get(0x44), "Δ", "Greek capital delta, not INCREMENT");
  assert.equal(SYMBOL_TO_UNICODE.get(0x57), "Ω", "Greek capital omega, not OHM SIGN");
  assert.equal(SYMBOL_TO_UNICODE.get(0x6d), "μ", "Greek small mu, not MICRO SIGN");
  assert.equal(SYMBOL_TO_UNICODE.get(0x20), " ", "space, not no-break space");
  assert.equal(SYMBOL_TO_UNICODE.get(0xa4), "⁄", "fraction slash, first listed");
  assert.equal(SYMBOL_TO_UNICODE.get(0x60), undefined, "radical extender is Corporate Use only");
  for (const ch of SYMBOL_TO_UNICODE.values()) {
    const cp = ch.codePointAt(0);
    assert.ok(cp < 0xe000 || cp > 0xf8ff, `no private-use character: U+${cp.toString(16)}`);
  }
  // 189 Symbol codes in the file; the 29 the file's header says are in the Corporate Use
  // Subarea have no other Unicode value, so 160 are mapped.
  assert.equal(SYMBOL_TO_UNICODE.size, 160);
  const tiny = parseSymbolTable("# c\n2126\t57\t# OHM\n03A9\t57\t# OMEGA\nF8E5\t60\t# CUS\n");
  assert.deepEqual([...tiny], [[0x57, "Ω"]]);
});

// --- One piece of text ---------------------------------------------------------------------------

test("symbolToUnicode: maps glyph codes, keeps whitespace and character references", () => {
  assert.equal(symbolToUnicode("³"), "≥");
  assert.equal(symbolToUnicode("£ "), "≤ ");
  assert.equal(symbolToUnicode("\n\t\t·"), "\n\t\t•");
  // "&#160;" is a character reference the parser leaves as text; it names Unicode, not a Symbol
  // code, and decodeEntities() turns it into a no-break space later. Mapping its letters would
  // be wrong only by luck of the table (& # digits ; map to themselves), so it is skipped.
  assert.equal(symbolToUnicode("S&#160;"), "Σ&#160;");
  assert.equal(symbolToUnicode("a (S"), "α (Σ");
  // Windows software can write Symbol text in the private-use range U+F020–U+F0FF.
  assert.equal(symbolToUnicode(""), "≥≤");
});

test("symbolToUnicode: a character the table has no Unicode for is kept and counted, never guessed", () => {
  const tally = createSymbolTally();
  assert.equal(symbolToUnicode("³Āx", tally), "≥Āξ");
  assert.equal(tally.mapped, 2);
  assert.deepEqual([...tally.unmapped], [["Ā", 1]]);
});

// --- Real paragraphs: only Symbol runs change ----------------------------------------------------

test("Administrative Code BC 722.2.1.1.4: 'For s ³ 4t' becomes 'For s ≥ 4t', and £ becomes ≤", () => {
  // Building Code § BC 722, records 0-0-0-170292 and 0-0-0-170293 (file 0-0-0-164231.xml).
  const ge = `<PARA>
	<TAB tab-count="1"/>For s ${SYM}³</CHARFORMAT> 4t, the thickness to be used shall be t </PARA>`;
  const le = `<PARA>
	<TAB tab-count="1"/>For s ${SYM}£</CHARFORMAT> 2t, the thickness to be used shall be t<CHARFORMAT bold="0" italic="0" underline="0" strike-out="0" hidden="0" point-size="8">
	</CHARFORMAT>
	<CHARFORMAT bold="0" italic="0" underline="0" strike-out="0" hidden="0" point-size="8" baseline="60">e</CHARFORMAT>
	<CHARFORMAT bold="0" italic="0" underline="0" strike-out="0" hidden="0" baseline="60">
	</CHARFORMAT>&#160;</PARA>`;
  assert.equal(paraText(ge), "For s ≥ 4t, the thickness to be used shall be t");
  assert.equal(paraText(le), "For s ≤ 2t, the thickness to be used shall be t e");
});

test("Rules § 2-08 (Title 3): ΔP ≥ H × (ΔDr/H); the real × outside the Symbol runs is untouched", () => {
  // Record 0-0-0-24326 (file 0-0-0-24125.xml): Symbol runs hold D and ³, Times holds "P" and "× (".
  const xml = `<PARA>
${SYM}
<TAB tab-count="1"/>
<TAB tab-count="1"/>D</CHARFORMAT>
<CHARFORMAT bold="0" italic="1" underline="0" strike-out="0" hidden="0" font-name="Symbol" font-family="serif" character-set="symbol">
</CHARFORMAT>
<CHARFORMAT bold="0" italic="1" underline="0" strike-out="0" hidden="0">P </CHARFORMAT>
${SYM}³</CHARFORMAT>
<CHARFORMAT bold="0" italic="1" underline="0" strike-out="0" hidden="0" font-name="Symbol" font-family="serif" character-set="symbol">
</CHARFORMAT>
<CHARFORMAT bold="0" italic="1" underline="0" strike-out="0" hidden="0"> H × (</CHARFORMAT>
${SYM}D</CHARFORMAT>Dr/H) </PARA>`;
  const tally = createSymbolTally();
  assert.equal(paraText(xml, tally), "Δ P ≥ H × ( ΔDr/H)");
  assert.equal(tally.runs, 5);
  assert.equal(tally.mapped, 3);
});

test("Rules: a Symbol-font bullet (·) becomes •, the words around it stay", () => {
  // File 0-0-0-140078.xml: a carbon dioxide warning sign, bold, with a Symbol bullet.
  const xml = `<PARA><CHARFORMAT bold="1" italic="0" underline="0" strike-out="0" hidden="0">DO NOT ENTER ROOM/EVACUATE THE AREA:<LINEBRK/>
</CHARFORMAT>
<CHARFORMAT bold="1" italic="0" underline="0" strike-out="0" hidden="0" font-name="Symbol" font-family="serif" character-set="symbol">·</CHARFORMAT>
<CHARFORMAT bold="1" italic="0" underline="0" strike-out="0" hidden="0"> if the CO</CHARFORMAT></PARA>`;
  assert.equal(paraText(xml), "DO NOT ENTER ROOM/EVACUATE THE AREA: • if the CO");
});

test("guard: the same characters in any other font, or in no font, are not changed", () => {
  const xml = `<PARA>Fee: £ 5; s ³ 4t; Mr. D; a · b <CHARFORMAT font-name="Times New Roman">£ ³ D · Ö</CHARFORMAT> <CHARFORMAT bold="1">S a m</CHARFORMAT></PARA>`;
  const tally = createSymbolTally();
  assert.equal(paraText(xml, tally), "Fee: £ 5; s ³ 4t; Mr. D; a · b £ ³ D · Ö S a m");
  assert.equal(tally.runs, 0);
  assert.equal(tally.mapped, 0);
});

test("guard: a CHARFORMAT without a font inside a Symbol run keeps Symbol; another font ends it", () => {
  const xml = `<PARA>${SYM}D<CHARFORMAT italic="1">a</CHARFORMAT><CHARFORMAT font-name="Arial">D a</CHARFORMAT>S</CHARFORMAT> D</PARA>`;
  assert.equal(paraText(xml), "ΔαD aΣ D");
});

test("guard: every test fixture file (no Symbol runs) parses to the same tree with or without mapping", () => {
  const roots = ["fixtures/titles/admin", "fixtures/titles/rules", "fixtures/titles/charter", "fixtures/diff/xml"];
  let files = 0;
  for (const root of roots) {
    const dir = join(__dirname, root);
    for (const f of readdirSync(dir).filter((n) => n.endsWith(".xml"))) {
      const xml = readFileSync(join(dir, f), "utf8").replace(/^﻿/, "");
      const plain = makeParser().parse(xml);
      const tally = createSymbolTally();
      const mapped = mapSymbolRuns(makeParser().parse(xml), tally);
      assert.equal(tally.runs, 0, `${root}/${f} has no Symbol runs`);
      assert.deepEqual(mapped, plain, `${root}/${f}`);
      files++;
    }
  }
  assert.ok(files > 20, `checked ${files} fixture files`);
});

// --- Through the index build -------------------------------------------------------------------

const doc = (body) => `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<DOCUMENT source-infobase-name="Admin">${body}</DOCUMENT>`;

test("index: Building Code § BC 722 reads 'For s ≥ 4t' and 'For s ≤ 2t'", () => {
  const xml = doc(`
  <LEVEL style-name="Section" style-name-escaped="Section" level-depth="9" toc-section="true">
    <RECORD id="0-0-0-170200" number="91600" version="1254">
      <HEADING>Section BC 722: Calculated Fire Resistance</HEADING>
      <PARA>Section BC 722: Calculated Fire Resistance</PARA>
    </RECORD>
    <LEVEL style-name="Subsection" style-name-escaped="Subsection" style-id="0-0-0-706" level-depth="10" toc-section="true">
      <RECORD id="0-0-0-170290" number="91652" version="1254">
        <HEADING>722.2.1.1.4 Ribbed or undulating surfaces. </HEADING>
        <PARA>722.2.1.1.4 <CHARFORMAT bold="1" italic="0" underline="0" strike-out="0" hidden="0">Ribbed or undulating surfaces. </CHARFORMAT>
        </PARA>
      </RECORD>
      <LEVEL style-name="Normal Level" style-name-escaped="Normal-Level" style-id="0-0-0-0" level-depth="0" toc-section="false">
        <RECORD id="0-0-0-170292" number="91654" version="1254">
          <PARA>
            <TAB tab-count="1"/>For s ${SYM}³</CHARFORMAT> 4t, the thickness to be used shall be t </PARA>
        </RECORD>
        <RECORD id="0-0-0-170293" number="91655" version="1254">
          <PARA>
            <TAB tab-count="1"/>For s ${SYM}£</CHARFORMAT> 2t, the thickness to be used shall be t</PARA>
        </RECORD>
      </LEVEL>
    </LEVEL>
  </LEVEL>`);
  const [section] = buildSectionsFromXml([xml], "admin_code");
  assert.equal(section.citation, "Section BC 722");
  assert.equal(
    section.text,
    "722.2.1.1.4 Ribbed or undulating surfaces. For s ≥ 4t, the thickness to be used shall be t For s ≤ 2t, the thickness to be used shall be t"
  );
});

test("index: a HEADING that copies its PARA without the font gets the same characters (BC 1609.7.1)", () => {
  // The publisher's HEADING is "h £ 60 ft." in plain text; only the PARA says the £ is Symbol.
  // Mapping only the PARA would leave the heading wrong, and the subsection would be said twice
  // (the heading line, then the PARA, because they no longer match).
  const xml = doc(`
  <LEVEL style-name="Section" style-name-escaped="Section" level-depth="9" toc-section="true">
    <RECORD id="0-0-0-177562" number="99100" version="1254">
      <HEADING>Section BC 1609: Wind Loads</HEADING>
      <PARA>Section BC 1609: Wind Loads</PARA>
    </RECORD>
    <LEVEL style-name="Subsection" style-name-escaped="Subsection" style-id="0-0-0-706" level-depth="10" toc-section="true">
      <RECORD id="0-0-0-177750" number="99212" version="1254">
        <HEADING>1609.7.1 Buildings with h £ 60 ft.</HEADING>
        <PARA>1609.7.1 Buildings with h ${SYM}£ </CHARFORMAT>60 ft.</PARA>
      </RECORD>
      <LEVEL style-name="Normal Level" style-name-escaped="Normal-Level" style-id="0-0-0-0" level-depth="0" toc-section="false">
        <RECORD id="0-0-0-177751" number="99213" version="1254">
          <PARA>The design wind pressure for canopies attached to walls of buildings with h ${SYM}£ </CHARFORMAT>60 ft. shall follow Chapter 30.</PARA>
        </RECORD>
      </LEVEL>
    </LEVEL>
  </LEVEL>`);
  const [section] = buildSectionsFromXml([xml], "admin_code");
  assert.equal(
    section.text,
    "1609.7.1 Buildings with h ≤ 60 ft. The design wind pressure for canopies attached to walls of buildings with h ≤ 60 ft. shall follow Chapter 30."
  );
});

test("index: a HEADING that is not a copy of its PARA is left as the publisher wrote it", () => {
  const tree = makeParser().parse(
    `<RECORD><HEADING>Limits for £ signs</HEADING><PARA>Fee ${SYM}£</CHARFORMAT> 5</PARA></RECORD>`
  );
  const tally = createSymbolTally();
  mapSymbolRuns(tree, tally);
  const record = tree[0];
  assert.equal(normalize(childrenByTag(record, "HEADING").map(extractText).join("")), "Limits for £ signs");
  assert.equal(tally.headings, 0);
});
