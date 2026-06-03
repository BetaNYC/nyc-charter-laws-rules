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
// trimValues: false is essential. fast-xml-parser trims each text node by
// default, which silently deletes the single spaces that sit between running
// text and an inline element — e.g. "...to section " + <LINK>five</LINK> + " of
// this title". With trimming on, those become "...to section" + "five" + "of
// this title", re-running the words together. We keep raw whitespace here and
// collapse it once, downstream, with normalize().
export const ORDERED_PARSER_OPTIONS = {
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  textNodeName: "#text",
  preserveOrder: true,
  trimValues: false,
};

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
      return typeof t === "string" ? t : String(t);
    }
    const tag = tagOf(node);
    if (tag) return extractText(node[tag]);
  }
  return "";
}

// Collapse whitespace and trim, matching the normalization applied to fields.
export function normalize(s) {
  return s.replace(/\s+/g, " ").trim();
}
