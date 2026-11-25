// Tables on the committed data (issue #65): npm run test:site-data.
//
// NOT part of npm test, on purpose (see admin-layout.test.js): a surprise in the data's shape must
// stop the website, never the daily refresh. Nothing here pins a count; every expectation is
// worked out from the data, and the counts are reported as diagnostics.
//
// A structure built before #65 has `table: true` on a table's block and no `rows`: the site then
// shows the table as one paragraph, as before. The checks on cells then skip (saying so), and the
// page check counts paragraphs instead. The daily refresh rebuilds the structure with rows once
// the structure code that writes them is on main.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { loadBook, rulesReady } from "../../scripts/lib/site/model.js";
import { rulesPageMakers } from "../../scripts/lib/site/pages-rules.js";
import { adminPageMakers } from "../../scripts/lib/site/pages-admin.js";
import { siteFacts } from "../../scripts/lib/site/build.js";
import { readBlocks, isTable } from "../../scripts/lib/site/render-html.js";
import { unescapeHtml } from "../../scripts/lib/site/html.js";
import { renderSection, bodyBlocks } from "../../scripts/lib/render-section.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const INDEX = join(ROOT, "data", "index", "json");
const STRUCTURE = join(ROOT, "data", "structure");
const VERSIONS = JSON.parse(readFileSync(join(INDEX, "versions.json"), "utf8"));
const DATA_SOURCES = JSON.parse(readFileSync(join(ROOT, "DATA-SOURCES.json"), "utf8"));

function loadReal(corpus) {
  if (!existsSync(join(STRUCTURE, `${corpus}.json`))) return null;
  const indexText = readFileSync(join(INDEX, `${corpus}.json`), "utf8");
  const structure = JSON.parse(readFileSync(join(STRUCTURE, `${corpus}.json`), "utf8"));
  if (structure.indexSha256 !== createHash("sha256").update(indexText).digest("hex")) return null;
  const index = JSON.parse(indexText);
  if (corpus === "rules" && !rulesReady(index)) return null;
  return { book: loadBook({ corpus, indexJsonText: indexText, structure, versions: VERSIONS }), structure, index };
}

for (const [corpus, makers] of [["rules", rulesPageMakers], ["admin_code", adminPageMakers]]) {
  const real = loadReal(corpus);
  const skip = real ? false : `the committed ${corpus} structure is missing or from other text (or the Rules index has no titles yet)`;
  const hasRows = real ? real.structure.sections.some((s) => s.blocks.some((b) => b.rows)) : false;
  const skipCells = skip || (hasRows ? false : `the committed ${corpus} structure was built before #65: no table carries rows yet`);

  test(`${corpus}: every table's cells are slices of its block's text, in order, with only a space between`, { skip: skipCells }, (t) => {
    let tables = 0;
    let withRows = 0;
    let cells = 0;
    const sections = new Set();
    real.structure.sections.forEach((s, i) => {
      const text = real.index[i].text;
      for (const b of s.blocks) {
        if (!b.table) continue;
        tables++;
        sections.add(s.id);
        if (!b.rows) continue;
        withRows++;
        let at = b.start;
        let first = true;
        for (const [x, y] of b.rows.flat()) {
          cells++;
          assert.ok(x >= at && y >= x && y <= b.end, `${s.id}: cells in order, inside the block`);
          if (y === x) continue;
          assert.equal(text.slice(at, x), first ? "" : at === x ? "" : " ", `${s.id}: only a space between two cells`);
          at = y;
          first = false;
        }
        assert.equal(at, b.end, `${s.id}: the last cell ends the block`);
      }
    });
    t.diagnostic(`${corpus}: ${tables} table blocks in ${sections.size} sections; ${withRows} carry rows (${cells} cells)`);
  });

  test(`${corpus}: every page shows each table as the structure has it, and names each table box apart`, { skip }, (t) => {
    const site = siteFacts([{ corpus, book: real.book.book, version: real.book.version }], DATA_SOURCES).perBook.get(corpus);
    const expected = { boxes: 0, paragraphs: 0 };
    // Section pages and chapter pages: a chapter record can hold text of its own (the Rules'
    // appendix chapters hold tables), shown on its chapter page above its sections.
    for (const s of [...real.book.sections, ...real.book.chapters]) {
      for (const b of bodyBlocks(renderSection(s, s.structure))) {
        if (isTable(b)) expected.boxes++;
        else if (b.table) expected.paragraphs++;
      }
    }
    const seen = { boxes: 0, paragraphs: 0, pagesWithTables: 0 };
    for (const make of makers(real.book, site)) {
      const p = make();
      if (!/table-scroll|data-table/.test(p.html)) continue;
      seen.pagesWithTables++;
      const names = [...p.html.matchAll(/<div class="table-scroll" data-table-name="([^"]*)"/g)].map((m) => unescapeHtml(m[1]));
      assert.equal(names.length, (p.html.match(/class="table-scroll"/g) ?? []).length, `${p.path}: every table box is named`);
      assert.equal(new Set(names).size, names.length, `${p.path}: two table boxes share a name`);
      assert.ok(names.every((n) => /^Table( \d+ of \d+)?, /.test(n)), `${p.path}: table names`);
      if (p.kind !== "section" && p.kind !== "chapter") continue;
      // The record's own blocks: on a chapter page, its sections' copies carry no data-block.
      const body = bodyBlocks(renderSection(p.record, p.record.structure));
      const shown = readBlocks(p.html, unescapeHtml);
      assert.deepEqual(shown.map((b) => b.text), body.map((b) => b.text), `${p.path}: the page's blocks are the index's text`);
      seen.boxes += (p.html.match(/<div class="table-scroll" [^>]*data-block=/g) ?? []).length;
      seen.paragraphs += (p.html.match(/<p [^>]*\bdata-table data-block=/g) ?? []).length;
    }
    assert.equal(seen.boxes, expected.boxes, "one table box per table with rows, on its record's own page");
    assert.equal(seen.paragraphs, expected.paragraphs, "one paragraph per table without rows");
    t.diagnostic(`${corpus}: ${seen.boxes} tables shown as tables and ${seen.paragraphs} as paragraphs on their records' own pages; ${seen.pagesWithTables} pages hold a table`);
  });
}
