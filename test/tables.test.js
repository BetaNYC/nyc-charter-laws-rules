// Tables in the site structure and on the site (issue #65). Display only: the index's text for a
// table (its cells' words, run together) never changes; the structure carries each table's rows
// and cells as slices of that text, and the site writes a real <table> from them.
//
// Fixtures:
//   - test/fixtures/tables/rules/: two of American Legal Publishing's Rules files from the
//     2026-07-05 bulk download, unchanged. 0-0-0-116152.xml is Title 2's Appendix A (one 9-column
//     table: header cells that span columns, a cell with a line break, a link in a cell, the
//     publisher's "[ALP S-…]" markers). 0-0-0-97119.xml is Title 28 Chapter 32 (§ 32-04's table:
//     a two-row head whose first cell spans both rows, centered cells).
//   - small hand-made PARAs below, in the publisher's shape (TABLE > TABLEFORMAT, ROW > COL > PARA,
//     a CELL inside the cell's first PARA), for the cases those files do not have.
//
// Offline: no network, no data/raw. Real-data counts are in test/site-data/tables.test.js.

import { test, before } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { makeParser, extractText, normalize } from "../scripts/lib/extract-text.js";
import { buildSectionsFromXml, collectSectionsFromXml, createTitleIndex, finishTitles } from "../scripts/lib/build-corpus.js";
import { createStructureCollector, paraTable } from "../scripts/lib/build-structure.js";
import { renderSection, bodyBlocks } from "../scripts/lib/render-section.js";
import { corpusMarkdown } from "../scripts/lib/serialize-markdown.js";
import { bodyHtml, readBlocks, isTable, tableName, tableColumns, PRINT_DENSE_COLUMNS } from "../scripts/lib/site/render-html.js";
import { unescapeHtml } from "../scripts/lib/site/html.js";
import { buildRulesFixtureSite } from "./site/fixture-site.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const TABLES_XML = join(__dirname, "fixtures", "tables", "rules");
const sha = (s) => createHash("sha256").update(s).digest("hex");
const xmlFiles = () => readdirSync(TABLES_XML).filter((f) => f.endsWith(".xml")).sort();
const xmlTexts = () => xmlFiles().map((f) => readFileSync(join(TABLES_XML, f), "utf8"));

function build() {
  const collector = createStructureCollector("rules");
  const titles = createTitleIndex();
  const sections = [];
  for (const xml of xmlTexts()) collectSectionsFromXml(xml, "rules", sections, (e) => { throw e; }, collector.forFile(), titles);
  finishTitles(titles);
  const json = JSON.stringify(sections, null, 2);
  return { sections, json, structure: collector.finish(sections, sha(json)) };
}
const built = build();

// The PARA of a small table written in the publisher's shape.
const parser = makeParser();
function para(inner) {
  const [node] = parser.parse(`<PARA>${inner}</PARA>`);
  return node;
}
const fmt = `<TABLEFORMAT number-of-widths="3"><COLUMNFORMAT column-width="200" percentage="no"/></TABLEFORMAT>`;
// The text between consecutive non-empty cells, and before the first and after the last (which
// must be empty): what the cells leave out of [start, end).
function gaps(text, rows, start = 0, end = text.length) {
  const cells = rows.flat().filter(([x, y]) => y > x);
  assert.equal(text.slice(start, cells[0][0]), "", "no text before the first cell");
  assert.equal(text.slice(cells.at(-1)[1], end), "", "no text after the last cell");
  return cells.slice(1).map(([x], i) => text.slice(cells[i][1], x));
}
const cellsOf = (p, rows) => {
  const text = normalize(extractText(p));
  return rows.map((row) => row.map(([a, b, extra]) => [text.slice(a, b), extra ?? null]));
};

test("paraTable: header cells, spans, alignment, lines inside a cell, as slices of the index's text", () => {
  const p = para(`<TABLE>${fmt}
    <ROW><COL><PARA><CELL header="true" cells-merged-down="1">Type</CELL></PARA></COL>
         <COL><PARA><PARAFORMAT justify="center"><CELL header="true" cells-merged-right="1">Charge</CELL></PARAFORMAT></PARA></COL></ROW>
    <ROW><COL><PARA><CELL header="true">Day</CELL></PARA></COL><COL><PARA><CELL header="true">Night</CELL></PARA></COL></ROW>
    <ROW><COL><PARA>Basic<LINEBRK/>Life Support</PARA><PARA>Ambulance</PARA></COL>
         <COL><PARA><PARAFORMAT justify="right">$1,793.00</PARAFORMAT></PARA></COL>
         <COL><PARA></PARA></COL></ROW>
  </TABLE>`);
  const rows = paraTable(p);
  const cells = cellsOf(p, rows);
  assert.deepEqual(cells.slice(0, 2), [
    [["Type", { h: 1, rs: 2 }], ["Charge", { h: 1, cs: 2, al: "c" }]],
    [["Day", { h: 1 }], ["Night", { h: 1 }]],
  ]);
  // The index's text runs the cell's two PARAs together ("SupportAmbulance": no space between
  // them in this markup); the site's line break shows where the second starts.
  assert.deepEqual(cells[2].map(([t]) => t), ["Basic Life SupportAmbulance", "$1,793.00", ""]);
  assert.deepEqual(cells[2][1][1], { al: "r" });
  assert.equal(cells[2][2][1], null, "an empty cell");
  // The cell with two lines and a second paragraph: a line starts before "Life" and before "Ambulance".
  const text = normalize(extractText(p));
  const [a, b, extra] = rows[2][0];
  assert.deepEqual(Object.keys(extra), ["br"]);
  assert.deepEqual(extra.br.map((x) => text.slice(x, b).trim()), ["Life SupportAmbulance", "Ambulance"]);
  assert.ok(a < extra.br[0]);
  // The cells, in order, cut the PARA's whole text: between two cells there is one space, or none
  // where the markup has no space between them ("DayNight": in this markup, as in the index).
  assert.deepEqual(gaps(text, rows), [" ", " ", "", " ", " "]);
  assert.equal(text, "Type Charge DayNight Basic Life SupportAmbulance $1,793.00");
});

test("paraTable keeps extractText's separator rule: a <TAB/> before ', ' adds no space, inside a table too", () => {
  const p = para(`<TABLE>${fmt}<ROW><COL><PARA>area<TAB/>, as such</PARA></COL><COL><PARA>(<LINK type="Jump" destination-id="0-0-0-9">§ 1-01</LINK>)</PARA></COL></ROW></TABLE>`);
  const rows = paraTable(p);
  assert.ok(rows, "the marks did not move the text");
  assert.deepEqual(cellsOf(p, rows), [[["area, as such", null], ["(§ 1-01)", null]]]);
});

test("paraTable: a PARA with no TABLE has no rows", () => {
  assert.equal(paraTable(para("Plain text.")), null);
  assert.equal(paraTable(null), null);
});

test("the real fixtures: every table carries its rows, and its cells cut its text exactly", () => {
  let tables = 0;
  built.structure.sections.forEach((s, i) => {
    const text = built.sections[i].text;
    for (const b of s.blocks.filter((x) => x.table)) {
      tables++;
      assert.ok(Array.isArray(b.rows) && b.rows.length, `${s.id}: rows`);
      let at = b.start;
      for (const [x, y] of b.rows.flat()) {
        assert.ok(x >= at && y >= x && y <= b.end, `${s.id}: cells in order, inside the block`);
        at = y;
      }
      const g = gaps(text, b.rows, b.start, b.end);
      assert.ok(g.every((x) => x === " " || x === ""), `${s.id}: nothing but a space between two cells`);
    }
  });
  assert.equal(tables, 2);
});

test("the real fixtures: § 32-04's two-row head and Appendix A's spans, as the publisher marks them", () => {
  const at = (citation) => {
    const i = built.sections.findIndex((s) => s.citation === citation);
    assert.ok(i >= 0, citation);
    const b = built.structure.sections[i].blocks.find((x) => x.table);
    return b.rows.map((row) => row.map(([x, y, e]) => [built.sections[i].text.slice(x, y), e ?? {}]));
  };
  const t = at("§ 32-04");
  assert.equal(t.length, 17);
  assert.deepEqual(t[0].map(([, e]) => [e.h, e.rs ?? 1, e.cs ?? 1]), [[1, 2, 1], [1, 1, 2], [1, 1, 2]]);
  assert.equal(t[1].length, 4, "the second head row leaves out the column the first cell spans");
  assert.ok(t.slice(2).every((row) => row.every(([, e]) => !e.h)), "the body has no header cells");
  const a = at("Appendix A");
  assert.equal(a.length, 8);
  assert.deepEqual(a[0].map(([, e]) => e.cs ?? 1), [1, 2, 4, 2], "nine columns in the first row");
  assert.equal(a[2][0][1].cs, 9, "a row that is one cell across the table");
  assert.ok(a.flat().some(([, e]) => e.br), "a cell with a line break");
  assert.ok(!a.flat().some(([text]) => /\[ALP/.test(text)), "the publisher's markers are not in the cells, as not in the text");
});

test("tables leave the index alone: the same JSON and Markdown with and without the structure", () => {
  const plain = buildSectionsFromXml(xmlTexts(), "rules");
  // buildSectionsFromXml reads no title index; compare without the two title fields.
  const strip = (list) => list.map(({ titleNumber, titleHeading, ...r }) => r);
  assert.deepEqual(strip(built.sections), strip(plain));
  const md = corpusMarkdown({ corpus: "rules", version: "v", sections: built.sections, structure: built.structure });
  assert.equal(md, corpusMarkdown({ corpus: "rules", version: "v", sections: built.sections }));
  // A structure without rows (built before #65) gives the same Markdown again.
  const noRows = { ...built.structure, sections: built.structure.sections.map((s) => ({ ...s, blocks: s.blocks.map(({ rows, ...b }) => b) })) };
  assert.equal(md, corpusMarkdown({ corpus: "rules", version: "v", sections: built.sections, structure: noRows }));
});

// Rendering.
const sectionAt = (citation) => {
  const i = built.sections.findIndex((s) => s.citation === citation);
  return { record: built.sections[i], structure: built.structure.sections[i] };
};
const linkFor = (to) => (to?.id ? { href: `/x/${to.id}`, label: "target" } : null);

test("bodyHtml: a table block is a box (its name in data-table-name) around nys-table and a plain table", () => {
  const { record, structure } = sectionAt("§ 32-04");
  const blocks = bodyBlocks(renderSection(record, structure));
  const html = bodyHtml(blocks, { fullCitation: "28 RCNY § 32-04", linkFor });
  const n = blocks.findIndex(isTable);
  assert.match(html, new RegExp(`<div class="table-scroll" data-table-name="Table, 28 RCNY § 32-04" data-block="${n}">\\n<nys-table bordered>\\n<table>\\n<thead>`));
  // No region, name or tab stop in the HTML: law.js adds them only while the box scrolls.
  assert.doesNotMatch(html, /role="region"|tabindex|aria-label="Table/);
  const thead = /<thead>([\s\S]*?)<\/thead>/.exec(html)[1];
  assert.equal((thead.match(/<tr>/g) ?? []).length, 2, "both head rows in <thead>");
  assert.match(thead, /<th rowspan="2" scope="col" class="al-c">/);
  // A header spanning two columns is scope="col": it covers both columns. "colgroup" would apply
  // to no cell, since the table has no <colgroup> (HTML table model).
  assert.match(thead, /<th colspan="2" scope="col" class="al-c">/);
  assert.doesNotMatch(html, /colgroup/);
  const tbody = /<tbody>([\s\S]*?)<\/tbody>/.exec(html)[1];
  assert.equal((tbody.match(/<tr>/g) ?? []).length, 15);
  assert.doesNotMatch(tbody, /<th/);
  // Read back: every block's text, the table's included, is the block's text.
  const shown = readBlocks(html, unescapeHtml);
  assert.deepEqual(shown.map((b) => b.text), blocks.map((b) => b.text));
  assert.equal(shown[n].tag, "div");
  assert.equal(shown[n].cls, "table-scroll");
});

test("bodyHtml: head rows stop where a header cell spans into the body; a link and a line break inside a cell", () => {
  const { record, structure } = sectionAt("Appendix A");
  const blocks = bodyBlocks(renderSection(record, structure));
  const html = bodyHtml(blocks, { fullCitation: "2 RCNY Appendix A", linkFor });
  const thead = /<thead>([\s\S]*?)<\/thead>/.exec(html)[1];
  // The second row has one cell that is not a header cell, so only the first row is the head.
  assert.equal((thead.match(/<tr>/g) ?? []).length, 1);
  assert.match(/<tbody>([\s\S]*?)<\/tbody>/.exec(html)[1], /<th>/, "a header cell below the head is a <th> with no scope");
  assert.match(html, /<td colspan="9">/);
  assert.match(html, /<br>/);
  const shown = readBlocks(html, unescapeHtml);
  assert.deepEqual(shown.map((b) => b.text), blocks.map((b) => b.text));
  // The link in the table's cell is a link, when it has a target.
  const t = blocks.find(isTable);
  if ((t.links ?? []).some((l) => linkFor(l.to))) assert.match(/<table>[\s\S]*<\/table>/.exec(html)[0], /<a class="xref"/);
});

test("bodyHtml: two tables on a page get different names; a chapter's copy has no data-block", () => {
  const { record, structure } = sectionAt("§ 32-04");
  const [t] = bodyBlocks(renderSection(record, structure)).filter(isTable);
  const html = bodyHtml([t, { type: "text", text: "Between." }, t], { fullCitation: "28 RCNY § 32-04", linkFor, copyOf: "32-04", nameNote: "Scope" });
  const names = [...html.matchAll(/data-table-name="([^"]*)"/g)].map((m) => m[1]);
  assert.deepEqual(names, ["Table 1 of 2, 28 RCNY § 32-04, Scope", "Table 2 of 2, 28 RCNY § 32-04, Scope"]);
  assert.doesNotMatch(html, /data-block/);
  assert.equal(tableName({ fullCitation: "15 RCNY § 1-01" }), "Table, 15 RCNY § 1-01");
});

test("bodyHtml: a table of 8 columns or more is marked to break words anywhere in print; a narrower one is not", () => {
  const html = (citation) => {
    const { record, structure } = sectionAt(citation);
    const t = bodyBlocks(renderSection(record, structure)).find(isTable);
    return { cols: tableColumns(t.rows), html: bodyHtml([t], { fullCitation: citation, linkFor }) };
  };
  const wideOne = html("Appendix A");
  const narrow = html("§ 32-04");
  assert.equal(PRINT_DENSE_COLUMNS, 8);
  assert.deepEqual([wideOne.cols, narrow.cols], [9, 5]);
  assert.match(wideOne.html, /<div class="table-scroll" data-table-name="[^"]*" data-many-columns[ >]/);
  assert.doesNotMatch(narrow.html, /data-many-columns/);
  assert.equal(tableColumns([[[0, 1, { cs: 3 }], [1, 2]], [[2, 3]]]), 4, "the widest row, colspans counted");
});

test("bodyHtml: a table block with no rows (a structure built before #65) is one paragraph, as before", () => {
  const { record, structure } = sectionAt("§ 32-04");
  const old = { ...structure, blocks: structure.blocks.map(({ rows, ...b }) => b) };
  const blocks = bodyBlocks(renderSection(record, old));
  const html = bodyHtml(blocks, { fullCitation: "28 RCNY § 32-04", linkFor });
  assert.doesNotMatch(html, /<table|nys-table|table-scroll/);
  assert.match(html, /<p class="txt" data-table data-block="\d+">/);
});

let site;
before(async () => {
  site = await buildRulesFixtureSite({ extra: xmlTexts() });
});

test("the site: a section page and its chapter's page show the table; the section page's blocks read back exactly", () => {
  const rules = site.books.find((b) => b.corpus === "rules");
  const r = rules.ordered.find((x) => x.citation === "§ 32-04");
  assert.ok(r, "§ 32-04 is on the site");
  const file = (path) => readFileSync(join(site.outDir, path.endsWith("/") ? path.slice(1) + "index.html" : path.slice(1) + ".html"), "utf8");
  const page = file(r.path);
  assert.match(page, /<nys-table bordered>\n<table>/);
  assert.match(page, new RegExp(`data-table-name="Table, ${r.fullCitation.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}" data-block=`));
  const body = bodyBlocks(renderSection(r, r.structure));
  assert.deepEqual(readBlocks(page, unescapeHtml).map((b) => b.text), body.map((b) => b.text));
  const chapter = rules.ordered.find((x) => x.id === r.structure.parents.find((p) => rules.byId.get(p)?.level === "Chapter")) ?? rules.chapters.find((c) => c.sections?.includes(r));
  assert.ok(chapter, "its chapter");
  const cp = file(chapter.path);
  assert.match(cp, /<div class="table-scroll" data-table-name="Table, [^"]*§ 32-04[^"]*">/, "the chapter's copy is named for its section, with no data-block");
});

test("bodyHtml: cells the markup runs together read back run together, so the page's text is the index's", () => {
  const p = para(`<TABLE>${fmt}<ROW><COL><PARA>Day</PARA></COL><COL><PARA>Night</PARA></COL></ROW><ROW><COL><PARA>One<LINEBRK/>two</PARA></COL><COL><PARA></PARA></COL></ROW></TABLE>`);
  const text = normalize(extractText(p));
  assert.equal(text, "DayNightOne two");
  const block = { type: "text", table: true, text, rows: paraTable(p) };
  const html = bodyHtml([block], { fullCitation: "1 RCNY § 1-01", linkFor });
  assert.match(html, /<td>Day<\/td><td>Night<\/td><\/tr><tr><td>One<br> two<\/td><td><\/td><\/tr>/);
  assert.deepEqual(readBlocks(html, unescapeHtml).map((b) => b.text), [text]);
});

test("paraTable: empty cells that end a table end at the table's text, not after it", () => {
  const p = para(`<TABLE>${fmt}
    <ROW><COL><PARA>Total</PARA></COL><COL><PARA> </PARA></COL><COL><PARA></PARA></COL></ROW>
  </TABLE>`);
  const text = normalize(extractText(p));
  assert.equal(text, "Total");
  assert.deepEqual(paraTable(p), [[[0, 5], [5, 5], [5, 5]]]);
});
