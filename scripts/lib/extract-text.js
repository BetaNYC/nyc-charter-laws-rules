// Ordered-tree helpers for parsing AML bulk XML with fast-xml-parser's
// `preserveOrder: true` mode. Extracted into its own module so build-index.js
// and the regression test exercise the same code path.
//
// In preserveOrder mode the parsed tree is an array of single-key objects in
// document order:
//   - text node:    { "#text": "..." }
//   - element node: { "TAGNAME": [ ...children... ], ":@": { "@_attr": val } }
// Attributes live under the ":@" key (not inline), keyed with the "@_" prefix.

import { XMLParser } from "fast-xml-parser";

// Shared parser config — preserveOrder keeps inline <LINK>/<CHARFORMAT>
// cross-references in document order relative to the surrounding text.
//
// trimValues: false is essential. fast-xml-parser trims each text node by
// default, which silently deletes the single spaces that sit between running
// text and an inline element — e.g. "...to section " + <LINK>five</LINK> + " of
// this title". With trimming on, those become "...to section" + "five" + "of
// this title", re-running the words together. We keep raw whitespace here and
// collapse it once, downstream, with normalize().
//
// parseTagValue: false is also essential (added in the content-leak fix). By
// default fast-xml-parser type-coerces text nodes, so a standalone enumeration
// marker "1." (each list item in the AML source is a bare "<TAB/>1.<TAB/>text"
// run) parses to the JS number 1 — the trailing period is silently dropped.
// extractText then stringifies it as "1" and, because the flanking <TAB/>
// separators contribute no text, fuses it onto the next word: "1Each agency".
// Disabling value parsing keeps "1." intact as a string so the marker survives;
// extractText then re-inserts the separator space the empty <TAB/> dropped (see
// extractText). This does NOT add spaces after letter/paren markers ("a.",
// "(1)") — those are a separate, source-faithful nit left deliberately untouched.
export const ORDERED_PARSER_OPTIONS = {
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  textNodeName: "#text",
  preserveOrder: true,
  trimValues: false,
  parseTagValue: false,
};

// Named XML/HTML entities that appear in the AML bulk source. fast-xml-parser
// only decodes the five predefined XML entities (&amp; &lt; &gt; &quot; &apos;);
// it leaves numeric character references (&#160;, &#167;, ...) and non-predefined
// named entities (&divide;) as literal text, which then leak into the index.
// We decode them ourselves in normalize(). This map covers the named entities
// actually observed in the corpus plus the XML predefined set (for completeness;
// the parser already handles those, but decoding is idempotent).
const NAMED_ENTITIES = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ", // non-breaking space; whitespace-collapsed by normalize()
  divide: "÷", // ÷
};

// Decode numeric character references and the named entities above. nbsp decodes
// to U+00A0, which normalize()'s \s collapse then turns into a normal space.
export function decodeEntities(s) {
  return s
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) =>
      String.fromCodePoint(parseInt(hex, 16))
    )
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(parseInt(dec, 10)))
    .replace(/&([a-zA-Z][a-zA-Z0-9]*);/g, (m, name) =>
      Object.prototype.hasOwnProperty.call(NAMED_ENTITIES, name)
        ? NAMED_ENTITIES[name]
        : m
    );
}

// Strip American Legal Publishing source-edit markers — "[ALP S-054]",
// "[ALP S-116]", etc. — that the publisher embeds in <HIGHLIGHTER> spans and
// that leak into body text. Only ALP-prefixed brackets are removed; ordinary
// bracketed legal text ("[Repealed.]", "[ALP"-free editor's notes) is preserved.
//
// Two patterns, in order:
//   1. The precise marker token "[ALP S-<digits>" with an OPTIONAL closing "]".
//      A small number of markers in the source XML (19 across the corpus) are
//      malformed — the closing "]" is genuinely missing in the AML data — so we
//      cannot require it. Anchoring to "S-<digits>" keeps the strip from running
//      away into body text when "]" is absent. Trailing junk on a few markers
//      ("[ALP S-086]-", "[ALP S-051]////") is left to the general pass below /
//      the whitespace collapse.
//   2. A general "[ALP ... ]" closed-bracket pass, for any closed ALP bracket
//      whose interior is not the bare "S-<digits>" token.
export function stripAlpMarkers(s) {
  return s
    .replace(/\[ALP\s+S-\d+\s*\]?/g, "")
    .replace(/\[ALP\b[^\]]*\]/g, "");
}

// True when a text node is, on its own, a numeric enumeration marker like "1."
// or "10." — the standalone "<TAB/>N.<TAB/>" list-item counter in the AML source.
// Used by extractText to restore the separator space the empty <TAB/> dropped.
// Deliberately matches ONLY digit-dot markers: letter markers ("a.") and
// parenthesized markers ("(1)", "(a)") are left as-is (source-faithful nit, out
// of scope). A standalone "53." that is actually a section number is never a
// lone text node — section citations are running text inside a larger node — so
// this cannot misfire on "§ 53.The following".
function isDigitEnumerationMarker(s) {
  return /^\d+\.$/.test(s.trim());
}

export function makeParser() {
  return new XMLParser(ORDERED_PARSER_OPTIONS);
}

// The tag name of an ordered node (the lone key that isn't "#text" or ":@").
export function tagOf(obj) {
  for (const k of Object.keys(obj)) {
    if (k !== "#text" && k !== ":@") return k;
  }
  return null;
}

// Read an attribute (e.g. getAttr(record, "id") → record's @_id).
export function getAttr(obj, name) {
  const attrs = obj[":@"];
  if (!attrs) return "";
  return attrs[`@_${name}`] ?? "";
}

// All direct children of an ordered element that match a given tag name.
export function childrenByTag(obj, tag) {
  const node = obj[tagOf(obj)];
  if (!Array.isArray(node)) return [];
  return node.filter((c) => tagOf(c) === tag);
}

// Recursively extract all text from an ordered node, in document order,
// stripping XML tags. Concatenating in array order preserves the interleaving
// of running text and inline elements — the whole point of the fix.
export function extractText(node) {
  if (!node) return "";
  if (typeof node === "string") return node;
  if (typeof node === "number") return String(node);

  if (Array.isArray(node)) {
    return node.map(extractText).join("");
  }

  if (typeof node === "object") {
    if ("#text" in node) {
      const t = node["#text"];
      const str = typeof t === "string" ? t : String(t);
      // A standalone digit-dot enumeration marker ("1.") sits between empty
      // <TAB/> separators in the source; those tabs emit no text, so without
      // help the marker fuses onto the next word ("1.Each"). Append a single
      // space to restore the separator the tab dropped → "1. Each". normalize()
      // collapses any resulting double space. Scoped to digit markers only.
      if (isDigitEnumerationMarker(str)) return `${str} `;
      return str;
    }
    const tag = tagOf(node);
    if (tag) return extractText(node[tag]);
  }
  return "";
}

// Collapse whitespace and trim, matching the normalization applied to fields.
// Also decodes leaked entities and strips ALP source-edit markers before the
// whitespace pass — nbsp decodes to U+00A0 and is then collapsed to a space,
// and removing an "[ALP S-xxx]" token can leave a double space that the final
// collapse cleans up.
export function normalize(s) {
  let out = decodeEntities(s);
  out = stripAlpMarkers(out);
  return out.replace(/\s+/g, " ").trim();
}
