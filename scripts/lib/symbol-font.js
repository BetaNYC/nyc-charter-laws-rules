// Symbol-font text to Unicode (issue #88).
//
// American Legal Publishing's XML sets some characters in the old Symbol font:
//   <CHARFORMAT ... font-name="Symbol" font-family="serif" character-set="symbol">³</CHARFORMAT>
// The font draws Greek letters and math signs on ordinary code points, so the XML's "³" is the
// "≥" a reader of the law sees, "£" is "≤", "D" is "Δ", "·" is "•". Read as plain text, the index
// and the website said "For s ³ 4t" where Administrative Code BC 722.2.1.1.4 says "For s ≥ 4t".
//
// mapSymbolRuns() rewrites the text inside Symbol runs of a parsed (preserveOrder) tree to the
// Unicode the font draws, using the Unicode Consortium's Adobe Symbol table, vendored in
// scripts/vendor/unicode-adobe-symbol/ (see its SOURCE.md). It runs once, right after parsing
// (build-corpus.js collectSectionsFromXml), so the index, the site structure and the coverage
// audit all read the same text. Text in any other font is not touched.
//
// Inside a Symbol run, three things pass through unchanged:
//   - whitespace (the XML's own line breaks and tabs, and spaces), which is not a glyph;
//   - character references the parser leaves as text ("&#160;"), which decodeEntities() turns
//     into the character they name later; they are Unicode already, not Symbol codes;
//   - any character the table has no Unicode for. These are counted in the tally, so the build
//     can say so, and never guessed.
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
import { tagOf, getAttr, childrenByTag, extractText, normalize } from "./extract-text.js";

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

export const SYMBOL_TO_UNICODE = parseSymbolTable(readFileSync(TABLE_PATH, "utf8"));

/** A fresh count of what mapSymbolRuns did, for the build log. */
export function createSymbolTally() {
  return { runs: 0, mapped: 0, headings: 0, unmapped: new Map() };
}

// A character reference the parser left as text, such as "&#160;" or "&nbsp;".
const ENTITY = /&(?:#x[0-9a-fA-F]+|#\d+|[a-zA-Z][a-zA-Z0-9]*);/y;

/**
 * The Unicode for a piece of text set in the Symbol font. Whitespace, character references and
 * characters the table has no Unicode for are kept as they are (the last are counted in
 * `tally.unmapped`). A character in the private-use range U+F020–U+F0FF, the way some Windows
 * software writes Symbol-font text, is read as the Symbol code in its low byte.
 */
export function symbolToUnicode(text, tally = null) {
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
    const uni = code <= 0xff ? SYMBOL_TO_UNICODE.get(code) : undefined;
    if (uni === undefined) {
      if (tally) tally.unmapped.set(ch, (tally.unmapped.get(ch) ?? 0) + 1);
      out += ch;
      continue;
    }
    if (tally) tally.mapped++;
    out += uni;
  }
  return out;
}

/**
 * Rewrite, in place, every text node of a parsed ordered tree whose nearest CHARFORMAT with a
 * font-name says "Symbol". Returns the tree. A CHARFORMAT with no font-name keeps its parent's
 * font; one with another font-name ends the Symbol run inside it.
 */
export function mapSymbolRuns(tree, tally = null) {
  const walk = (nodes, inSymbol) => {
    if (!Array.isArray(nodes)) return;
    for (const node of nodes) {
      if (!node || typeof node !== "object") continue;
      if ("#text" in node) {
        if (inSymbol) node["#text"] = symbolToUnicode(String(node["#text"]), tally);
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
      const parasBefore = tag === "RECORD" && hasSymbolRun(node[tag], inSymbol) ? parasText(node) : null;
      walk(node[tag], symbol);
      if (parasBefore !== null && carryIntoHeading(node, parasBefore) && tally) tally.headings++;
    }
  };
  walk(tree, false);
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

// After a RECORD's PARAs were mapped: when its one HEADING is a plain-text copy of them (the same
// characters, spaces aside, or one the start of the other), change the HEADING's characters where
// the mapping changed the PARAs'. Returns true when the HEADING changed. Only a HEADING of plain
// text is rewritten, so no element inside one is lost.
function carryIntoHeading(record, before) {
  const headings = childrenByTag(record, "HEADING");
  if (headings.length !== 1) return false;
  const kids = headings[0].HEADING;
  if (!Array.isArray(kids) || !kids.every((k) => k && typeof k === "object" && "#text" in k)) return false;
  const old = squash(before);
  const now = squash(parasText(record));
  if (old.length !== now.length || old === now) return false;
  const heading = normalize(extractText(headings[0]));
  const h = squash(heading);
  const shared = Math.min(h.length, old.length);
  if (shared === 0 || h.slice(0, shared) !== old.slice(0, shared)) return false;
  let j = 0; // index among the heading's non-space characters
  let out = "";
  for (const ch of heading) {
    if (/\s/.test(ch)) {
      out += ch;
      continue;
    }
    out += j < shared && now[j] !== old[j] ? now[j] : ch;
    j += ch.length;
  }
  if (out === heading) return false;
  headings[0].HEADING = [{ "#text": out }];
  return true;
}
