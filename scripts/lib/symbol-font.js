// Symbol-font text to Unicode (issue #88).
//
// American Legal Publishing's XML sets some characters in the old Symbol font:
//   <CHARFORMAT ... font-name="Symbol" font-family="serif" character-set="symbol">³</CHARFORMAT>
// The font draws Greek letters and math signs on ordinary code points, so the XML's "³" is the
// "≥" a reader of the law sees, "£" is "≤", "D" is "Δ". Read as plain text, the index and the
// website said "For s ³ 4t" where Administrative Code BC 722.2.1.1.4 says "For s ≥ 4t".
//
// mapSymbolRuns() rewrites the text inside Symbol runs of a parsed (preserveOrder) tree. It runs
// once, right after parsing (build-corpus.js collectSectionsFromXml), so the index, the site
// structure and the coverage audit all read the same text. Text in any other font is not touched.
//
// Only reviewed codes change. The publisher does not always mean a Symbol run's characters as the
// font draws them: 1 RCNY § 101-14 sets its "§§" footnote marks in Symbol, where the font draws
// "♣♣". So only the codes in REVIEWED_SYMBOL_CODES, each checked against the publisher's files and
// against the Unicode Consortium's Adobe Symbol table (vendored in
// scripts/vendor/unicode-adobe-symbol/, see its SOURCE.md), are changed. Two more codes were
// reviewed and are kept as the XML has them (KEPT_SYMBOL_CODES). Any other character in a Symbol
// run is left as it is and counted in the tally, with the record it sits in, so the build reports
// it as an "unreviewed Symbol code" and new data cannot change the text without anyone seeing.
//
// Inside a Symbol run, these pass through unchanged and are not reported:
//   - whitespace (the XML's own line breaks and tabs, and spaces), which is not a glyph;
//   - character references the parser leaves as text ("&#160;"), which decodeEntities() turns
//     into the character they name later; they are Unicode already, not Symbol codes.
//
// Headings. A RECORD's HEADING is the publisher's plain-text copy of its PARA, made without the
// font: in Building Code § BC 1609 the PARA has "h <Symbol>£ </Symbol>60 ft." and the HEADING
// "1609.7.1 Buildings with h £ 60 ft.", with no font to say so. When the HEADING says the same
// characters as the record's PARAs (spaces aside), or one is the start of the other, the
// characters the PARAs' Symbol runs changed are changed at the same places in the HEADING, so
// it reads "h ≤ 60 ft." too, and the build still sees the PARA as repeating its heading
// (build-corpus.js readBody). A HEADING that differs from its PARAs is left as it is.

import { readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { tagOf, getAttr, childrenByTag, extractText, normalize, decodeEntities } from "./extract-text.js";

const TABLE_PATH = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "vendor",
  "unicode-adobe-symbol",
  "symbol.txt"
);

const isPrivateUse = (cp) => (cp >= 0xe000 && cp <= 0xf8ff);

/**
 * Parse the Unicode Consortium's symbol.txt (Unicode → Symbol code, tab-separated) into a
 * Map from Symbol code (0x20–0xFF) to the Unicode string the font draws there. Where the table
 * gives one code two Unicode values, keep the one NFKC leaves unchanged (Greek mu, not micro
 * sign; Greek omega, not ohm sign; space, not no-break space), and the first listed when both
 * are. Corporate Use (private-use) values are left out.
 */
export function parseSymbolTable(text) {
  const candidates = new Map();
  for (const line of text.split(/\r?\n/)) {
    if (!line || line.startsWith("#")) continue;
    const [uni, code] = line.split("\t");
    const cp = parseInt(uni, 16);
    const sym = parseInt(code, 16);
    if (!Number.isInteger(cp) || !Number.isInteger(sym)) continue;
    if (isPrivateUse(cp)) continue;
    if (!candidates.has(sym)) candidates.set(sym, []);
    candidates.get(sym).push(String.fromCodePoint(cp));
  }
  const map = new Map();
  for (const [sym, chars] of candidates) {
    map.set(sym, chars.find((c) => c.normalize("NFKC") === c) ?? chars[0]);
  }
  return map;
}

/** The whole vendored table: what the font draws at each code. Not all of it is used. */
export const SYMBOL_TO_UNICODE = parseSymbolTable(readFileSync(TABLE_PATH, "utf8"));

/**
 * The Symbol codes that are changed, with the character the font draws there. Each was found in
 * the publisher's July 2026 files and read in context (where the files use it, below). Add a
 * code only after reading the records the build reports it in.
 */
export const REVIEWED_SYMBOL_CODES = new Map([
  [0x44, "Δ"], // D: "ΔP" (Building Code Equation 9-1; Rules Title 3 § 2-08)
  [0x53, "Σ"], // S: sums ("Σ[(U1 * A1) … (Un * An)]"; Rules "HE = Σ(WT HT)")
  [0x57, "Ω"], // W: the overstrength factor "Ω0" (Building Code, from ASCE 7)
  [0x61, "α"], // a: "Q = α(ΣP)Δ/Vh", "α = 1.5" (Building Code)
  [0x6d, "μ"], // m: "μg/m3" (Rules); ductility ratio "μ < 10" (Building Code table)
  [0x71, "θ"], // q: "cos θ", "θ = Angle of slope from horizontal" (Building Code)
  [0x72, "ρ"], // r: Greek rho in Building Code formulas
  [0x73, "σ"], // s: Greek sigma in Building Code formulas
  [0xa3, "≤"], // £: "For s ≤ 2t"
  [0xb3, "≥"], // ³: "For s ≥ 4t"
  [0xb4, "×"], // ´: "1.5 × C", "4.5 × 8.5", "N × m"
  [0xd6, "√"], // Ö: "D = F × √A"; also a check mark in the tables of 2 RCNY Appendices C and D
  [0x28, "("], // (: the same character in Unicode ("α (ΣP)")
]);

/**
 * Symbol codes that were reviewed and are kept as the XML has them, so they are not reported.
 */
export const KEPT_SYMBOL_CODES = new Map([
  // §: 1 RCNY § 101-14's "§§" footnote marks (the plain-text marks before them are "*", "**").
  // The font draws ♣ here, which means nothing in the text.
  [0xa7, "footnote mark"],
  // ·: the font draws a bullet (•). Mostly list bullets at the start of a line or table cell, but
  // Mechanical Code MC 308 uses it for "times" in units ("Btu·in/(ft²·h·°F)"), where "•" would be
  // read out as "bullet". A middle dot reads acceptably in both.
  [0xb7, "middle dot"],
]);

// Check the reviewed list against the vendored table when the module loads, so an edit to either
// cannot drift from the other.
for (const [code, ch] of REVIEWED_SYMBOL_CODES) {
  if (SYMBOL_TO_UNICODE.get(code) !== ch) {
    throw new Error(
      `symbol-font.js: reviewed code 0x${code.toString(16)} maps to ${JSON.stringify(ch)}, ` +
        `but the Adobe Symbol table says ${JSON.stringify(SYMBOL_TO_UNICODE.get(code))}`
    );
  }
}

/**
 * A fresh count of what mapSymbolRuns did, for the build log. `unreviewed` maps each character
 * left as is because it is not a reviewed code to a Map of record id → count.
 */
export function createSymbolTally() {
  return { runs: 0, mapped: 0, kept: 0, headings: 0, unreviewed: new Map() };
}

// A character reference the parser left as text, such as "&#160;" or "&nbsp;".
const ENTITY = /&(?:#x[0-9a-fA-F]+|#\d+|[a-zA-Z][a-zA-Z0-9]*);/y;

/**
 * The text of a piece set in the Symbol font, with each reviewed code changed to the character
 * the font draws. Whitespace and character references are kept as they are. Any other character
 * is kept too, and counted in `tally.unreviewed` under `record` (unless it is a KEPT code). A
 * character in the private-use range U+F020–U+F0FF, the way some Windows software writes
 * Symbol-font text, is read as the Symbol code in its low byte.
 */
export function symbolToUnicode(text, tally = null, record = "") {
  let out = "";
  let i = 0;
  while (i < text.length) {
    ENTITY.lastIndex = i;
    const ent = ENTITY.exec(text);
    if (ent) {
      out += ent[0];
      i += ent[0].length;
      continue;
    }
    const cp = text.codePointAt(i);
    const ch = String.fromCodePoint(cp);
    i += ch.length;
    if (/\s/.test(ch)) {
      out += ch;
      continue;
    }
    const code = cp >= 0xf020 && cp <= 0xf0ff ? cp - 0xf000 : cp;
    const uni = REVIEWED_SYMBOL_CODES.get(code);
    out += uni ?? ch;
    if (!tally) continue;
    // A reviewed code whose Unicode character is the code itself ("(") changes nothing: it is
    // counted as kept, so "characters changed" in the build log is what really changed (#95).
    if (uni !== undefined) {
      if (uni !== ch) tally.mapped++;
      else tally.kept++;
    } else if (KEPT_SYMBOL_CODES.has(cp)) tally.kept++;
    else {
      if (!tally.unreviewed.has(ch)) tally.unreviewed.set(ch, new Map());
      const byRecord = tally.unreviewed.get(ch);
      byRecord.set(record, (byRecord.get(record) ?? 0) + 1);
    }
  }
  return out;
}

/**
 * Rewrite, in place, every text node of a parsed ordered tree whose nearest CHARFORMAT with a
 * font-name says "Symbol". Returns the tree. A CHARFORMAT with no font-name keeps its parent's
 * font; one with another font-name ends the Symbol run inside it.
 */
export function mapSymbolRuns(tree, tally = null) {
  const walk = (nodes, inSymbol, record) => {
    if (!Array.isArray(nodes)) return;
    for (const node of nodes) {
      if (!node || typeof node !== "object") continue;
      if ("#text" in node) {
        if (inSymbol) node["#text"] = symbolToUnicode(String(node["#text"]), tally, record);
        continue;
      }
      const tag = tagOf(node);
      if (!tag) continue;
      let symbol = inSymbol;
      if (tag === "CHARFORMAT") {
        const font = getAttr(node, "font-name");
        if (font) {
          symbol = font === "Symbol";
          if (symbol && tally) tally.runs++;
        }
      }
      const isRecord = tag === "RECORD";
      const parasBefore = isRecord && hasSymbolRun(node[tag], inSymbol) ? parasText(node) : null;
      walk(node[tag], symbol, isRecord ? getAttr(node, "id") || record : record);
      if (parasBefore !== null && carryIntoHeading(node, parasBefore) && tally) tally.headings++;
    }
  };
  walk(tree, false, "");
  return tree;
}

const squash = (s) => s.replace(/\s+/g, "");

// The text of a RECORD's PARAs, as build-corpus.js reads them.
function parasText(record) {
  return normalize(childrenByTag(record, "PARA").map((p) => normalize(extractText(p))).join(" "));
}

// True when a PARA of these nodes (a RECORD's children) holds Symbol-font text, or the whole
// RECORD sits in a Symbol run. Nested RECORDs are not looked into: each is handled on its own.
function hasSymbolRun(nodes, inSymbol) {
  if (inSymbol) return true;
  const look = (n) => {
    if (Array.isArray(n)) return n.some(look);
    if (!n || typeof n !== "object" || "#text" in n) return false;
    const tag = tagOf(n);
    if (!tag || tag === "RECORD") return false;
    if (tag === "CHARFORMAT" && getAttr(n, "font-name") === "Symbol") return true;
    return look(n[tag]);
  };
  return nodes.filter((n) => n && typeof n === "object" && tagOf(n) === "PARA").some(look);
}

// A HEADING's text in pieces: a character reference the parser left as text ("&#160;") is one
// piece, any other character is one piece.
const HEADING_PIECE = /&(?:#x[0-9a-fA-F]+|#\d+|[a-zA-Z][a-zA-Z0-9]*);|[\s\S]/gu;

// After a RECORD's PARAs were mapped: when its one HEADING is a plain-text copy of them (the same
// characters, spaces aside, or one the start of the other), change the HEADING's characters where
// the mapping changed the PARAs'. Returns true when the HEADING changed. Only a HEADING of plain
// text is rewritten, so no element inside one is lost. The HEADING is rewritten from its own text,
// piece by piece: a character reference is read (decoded once) to compare, but written back as it
// was, because normalize() reads the HEADING again later and would decode it a second time. If
// the mapping changed a character the HEADING writes as a reference, the HEADING is left alone.
function carryIntoHeading(record, before) {
  const headings = childrenByTag(record, "HEADING");
  if (headings.length !== 1) return false;
  const kids = headings[0].HEADING;
  if (!Array.isArray(kids) || !kids.every((k) => k && typeof k === "object" && "#text" in k)) return false;
  const raw = kids.map((k) => String(k["#text"])).join("");
  if (raw.includes("[ALP")) return false; // normalize() strips editing markers: positions would differ
  const pieces = raw.match(HEADING_PIECE) ?? [];
  const read = pieces.map((p) => (p.length > 1 ? decodeEntities(p) : p));
  const old = squash(before);
  const now = squash(parasText(record));
  if (old.length !== now.length || old === now) return false;
  const h = squash(read.join(""));
  const shared = Math.min(h.length, old.length);
  if (shared === 0 || h.slice(0, shared) !== old.slice(0, shared)) return false;
  let j = 0; // index among the heading's non-space characters, as read
  let out = "";
  for (let k = 0; k < pieces.length; k++) {
    const chars = squash(read[k]);
    let changed = false;
    let mapped = "";
    for (const ch of chars) {
      if (j < shared && now[j] !== old[j]) {
        changed = true;
        mapped += now[j];
      } else mapped += ch;
      j += ch.length;
    }
    if (!changed) out += pieces[k];
    else if (pieces[k] === read[k]) out += mapped;
    else return false;
  }
  if (out === raw) return false;
  headings[0].HEADING = [{ "#text": out }];
  return true;
}
