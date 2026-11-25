// The website's citations and the MCP's work in each other, on the committed data: npm run
// test:site-data.
//
// For every record the site builds, in all three books, the citation its "Copy citation" gives
// (`fullCitation`: "NYC Charter § 1133", "NYC Administrative Code Section FC 102", "15 RCNY §
// 1-01") is found by get_section (alone, or in a list that includes it) and by the site's own jump
// box (its page, or the search page's list of the records that share that citation). And a
// subdivision the site cites ("NYC Charter § 1133(b)(1)", "... Section FC 102.4(1)", built with
// citeWithAnchor) finds its section in get_section and its anchor on the site.
//
// NOT part of npm test, on purpose (see admin-layout.test.js): a surprise in the data's shape must
// stop the website, never the daily refresh. Nothing here pins a count; every expectation is
// worked out from the data. Fixture tests of the same rules: test/citation-round-trip.test.js.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { loadBook, rulesReady } from "../../scripts/lib/site/model.js";
import { citationsJson } from "../../scripts/lib/site/outputs.js";
import { lookup, citeWithAnchor } from "../../site/assets/jump.js";
import { getSection } from "../../dist/corpus.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const INDEX = join(ROOT, "data", "index", "json");
const STRUCTURE = join(ROOT, "data", "structure");
const VERSIONS = JSON.parse(readFileSync(join(INDEX, "versions.json"), "utf8"));

// A book the site would build from the committed data, or null when its structure is missing or
// from other text (or, for the Rules, the index names no titles).
function loadReal(corpus) {
  if (!existsSync(join(STRUCTURE, `${corpus}.json`))) return null;
  const indexJsonText = readFileSync(join(INDEX, `${corpus}.json`), "utf8");
  const structure = JSON.parse(readFileSync(join(STRUCTURE, `${corpus}.json`), "utf8"));
  if (structure.indexSha256 !== createHash("sha256").update(indexJsonText).digest("hex")) return null;
  if (corpus === "rules" && !rulesReady(JSON.parse(indexJsonText))) return null;
  return loadBook({ corpus, indexJsonText, structure, versions: VERSIONS });
}
const books = ["charter", "admin_code", "rules"].map(loadReal);
const skip = books.every(Boolean) ? false : "a book's committed structure is missing or from other text";
const list = skip ? [] : citationsJson(books);
const entryOf = new Map();
if (!skip) {
  let i = 0;
  for (const b of books) for (const r of b.ordered) entryOf.set(r, list[i++]);
}

const ids = (res) => (res.kind === "match" ? [res.section.id] : res.kind === "ambiguous" ? res.candidates.map((s) => s.id) : []);
const sample = (misses) => misses.slice(0, 10).join("\n");

for (const [n, corpus] of ["charter", "admin_code", "rules"].entries()) {
  test(`${corpus}: every record's copied citation finds it in get_section`, { skip }, (t) => {
    const misses = [];
    for (const r of books[n].ordered) {
      const res = getSection(r.fullCitation);
      if (!ids(res).includes(r.id)) misses.push(`${r.fullCitation} → ${res.kind}`);
    }
    t.diagnostic(`${books[n].ordered.length} records`);
    assert.equal(misses.length, 0, `${misses.length} not found:\n${sample(misses)}`);
  });

  test(`${corpus}: every record's copied citation lands on its page in the jump box`, { skip }, (t) => {
    const misses = [];
    let picks = 0;
    for (const r of books[n].ordered) {
      const e = entryOf.get(r);
      assert.equal(e.p, r.path);
      const { matches, jump } = lookup(list, r.fullCitation);
      if (jump && matches[0] === e) continue;
      // The search page lists every record that shares the citation; only records the site
      // itself gives the same citation may share it.
      if (!jump && matches.includes(e) && matches.every((m) => m.c === e.c)) picks++;
      else misses.push(`${r.fullCitation} → ${matches.length} matches${jump ? `, jumps to ${matches[0].p}` : ""}`);
    }
    t.diagnostic(`${books[n].ordered.length} records, ${picks} on a list of records with the same citation`);
    assert.equal(misses.length, 0, `${misses.length} do not land:\n${sample(misses)}`);
  });
}

// Every anchor shape in each book ("(a)", "(3)(ii)-2", "102.4(1)", "E104.2.2", "1-01.1(c)"), and
// every 25th anchor besides: the whole list takes minutes, mostly get_section's misses.
const shapeOf = (a) => a.replace(/\d+/g, "9").replace(/[a-z]+/g, "a").replace(/[A-Z]+/g, "A");

test("a copied subdivision or subsection citation finds its section in get_section and its anchor in the jump box", { skip }, (t) => {
  const misses = [];
  const shapes = new Set();
  let n = 0;
  let checked = 0;
  for (const [b, corpus] of ["charter", "admin_code", "rules"].entries()) {
    const structure = JSON.parse(readFileSync(join(STRUCTURE, `${corpus}.json`), "utf8"));
    const blocks = new Map(structure.sections.map((s) => [s.id, s.blocks]));
    for (const r of books[b].sections) {
      for (const a of (blocks.get(r.id) ?? []).map((x) => x.anchor).filter(Boolean)) {
        const cite = citeWithAnchor(r.fullCitation, a);
        // A subsection number that does not start with the section's follows a comma ("55 RCNY
        // SECTION V ..., 6.5.1"): the site names the part, but it is not a citation form.
        if (cite === `${r.fullCitation}, ${a}`) continue;
        const shape = `${corpus} ${shapeOf(a)}`;
        if (shapes.has(shape) && n++ % 25) continue;
        shapes.add(shape);
        checked++;
        // The section itself, by id: alone, or in a list (records that share a citation).
        const res = getSection(cite);
        if (!ids(res).includes(r.id)) misses.push(`get_section ${cite} → ${res.kind} ${ids(res).slice(0, 3).join(",")}`);
        // Its page at the part, or a list that holds it.
        const { matches, anchor, jump } = lookup(list, cite);
        const e = entryOf.get(r);
        const lands = jump ? matches[0] === e && anchor === a : matches.includes(e);
        if (!lands) misses.push(`jump box ${cite} → ${matches.length} matches${jump ? ` ${matches[0].p}#${anchor}` : ""}`);
      }
    }
  }
  t.diagnostic(`${checked} citations of parts of sections, ${shapes.size} anchor shapes`);
  assert.ok(checked > 0);
  assert.equal(misses.length, 0, `${misses.length} misses:\n${sample(misses)}`);
});
