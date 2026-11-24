// The publisher's bold and italic (issue #78 follow-up): carried into the site structure as
// `marks`, shown as <strong> and <em>, and a wholly bold heading line given the subheading's look.
// Display only: the index's text, and so the MCP server, never change.
//
// Fixture: test/fixtures/formatting/0-0-0-2.xml, hand-made in the publisher's shape (RS 18-1's
// bold lines and lead-ins, italic text, a bold run around a link). Offline, no real-data counts.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { collectSectionsFromXml, buildSectionsFromXml, createTitleIndex, finishTitles } from "../scripts/lib/build-corpus.js";
import { createStructureCollector, paraFormatting } from "../scripts/lib/build-structure.js";
import { renderSection, bodyBlocks } from "../scripts/lib/render-section.js";
import { bodyHtml, readBlocks, isBoldLine, wholeBold } from "../scripts/lib/site/render-html.js";
import { unescapeHtml } from "../scripts/lib/site/html.js";
import { makeParser } from "../scripts/lib/extract-text.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURE = join(HERE, "fixtures", "formatting");
const sha = (s) => createHash("sha256").update(s).digest("hex");

function build(dir, corpus) {
  const collector = createStructureCollector(corpus);
  const sections = [];
  const titles = createTitleIndex(); // issue #59, as build-index.js
  for (const f of readdirSync(dir).filter((x) => x.endsWith(".xml")).sort()) {
    collectSectionsFromXml(readFileSync(join(dir, f), "utf8"), corpus, sections, (e) => { throw e; }, collector.forFile({ root: f === "0-0-0-1.xml" }), titles);
  }
  finishTitles(titles);
  const json = JSON.stringify(sections, null, 2);
  return { sections, json, structure: collector.finish(sections, sha(json)) };
}
const built = build(FIXTURE, "admin_code");
const i = built.sections.findIndex((s) => s.id === "0-0-0-110");
const section = built.sections[i];
const entry = built.structure.sections[i];
const blocks = bodyBlocks(renderSection(section, entry));
const html = bodyHtml(blocks, { fullCitation: "NYC Administrative Code § 27-101", linkFor: (to) => (to.id ? `/admin-code/sections/x` : null) });
const para = (n) => html.split("\n")[n];

test("paraFormatting: bold and italic runs as slices of the index's text", () => {
  const p = makeParser().parse(`<PARA><CHARFORMAT bold="1" italic="0"><TAB tab-count="1"/>Designated level.—</CHARFORMAT>The <CHARFORMAT bold="0" italic="1">street</CHARFORMAT> floor.</PARA>`)[0];
  assert.deepEqual(paraFormatting(p), [[0, 18, "b"], [22, 28, "i"]]);
  // A CHARFORMAT that leaves an attribute out takes it from the one around it.
  const nested = makeParser().parse(`<PARA><CHARFORMAT bold="1" italic="0">Term <CHARFORMAT italic="1">inner</CHARFORMAT></CHARFORMAT> rest</PARA>`)[0];
  assert.deepEqual(paraFormatting(nested), [[0, 4, "b"], [5, 10, "bi"]]);
  assert.deepEqual(paraFormatting(makeParser().parse(`<PARA>Plain words.</PARA>`)[0]), []);
});

test("the structure carries the runs; renderSection puts them on their blocks", () => {
  assert.ok(entry.marks.length > 0);
  for (const [a, b] of entry.marks) assert.ok(a < b && b <= section.text.length && section.text[a] !== " " && section.text[b - 1] !== " ");
  assert.deepEqual(blocks[1].marks, [[0, 15, "b"]]);
  assert.equal(blocks[1].text.slice(0, 15), "Modifications.—");
});

test("HTML: <strong> and <em> as the publisher set them, split around links, never in a heading's way", () => {
  assert.equal(para(0), `<p class="txt" data-block="0"><em>Wherever in such Code reference is made to the standard, substitute this code.</em></p>`);
  assert.equal(para(1), `<p class="txt" data-block="1"><strong>Modifications.—</strong>The provisions shall be subject to the following modifications.</p>`);
  // The label link stays plain, the bold lead-in follows it, and a bold run around a link nests.
  assert.match(para(3), /<a class="num" href="#\(i\)"[^>]*>\(i\)<\/a> <strong>Designated level\.—<\/strong>The \[main\] <em>street<\/em> floor, as in <strong>section <\/strong><a class="xref" href="\/admin-code\/sections\/x"><strong>27-101<\/strong><\/a><strong> of<\/strong> this code\./);
  assert.match(para(4), /Both <strong><em>bold and italic<\/em><\/strong> here\.<\/p>$/);
  // "Editor's note:" is bold already: no <strong> inside it.
  assert.equal(para(9), `<p class="ednote" data-block="9"><strong>Editor&#39;s note:</strong> For related provisions, see Appendix A.</p>`);
  // The words are the block's, tag for tag.
  const back = readBlocks(html, unescapeHtml);
  assert.deepEqual(back.map((b) => b.text), blocks.map((b) => b.text));
});

test("a short line wholly in bold, with text after it, gets the subheading's look as a paragraph", () => {
  const cls = html.split("\n").map((l) => /class="([^"]*)"/.exec(l)[1]);
  assert.equal(cls[2], "txt boldline", "Introduction–Section 3—Definitions:");
  // Not: a run of bold lines, a note line, the last line, a bold lead-in, or a heading element.
  for (const n of [1, 5, 6, 7, 10]) assert.ok(!cls[n].includes("boldline"), `block ${n}: ${blocks[n].text}`);
  assert.doesNotMatch(html, /<h\d/);
  assert.ok(wholeBold(blocks[5]) && !isBoldLine(blocks[5], blocks[6]));
  assert.ok(!isBoldLine({ ...blocks[2], text: blocks[2].text + "x".repeat(100), marks: [[0, 200, "b"]] }, blocks[3]), "a long bold paragraph is not a heading line");
});

test("the index is the same, byte for byte, with the formatting read: every fixture in the repo", () => {
  const dirs = [
    [join(HERE, "fixtures", "diff", "xml"), "charter"],
    [join(HERE, "fixtures", "structure", "rules"), "rules"],
    [join(HERE, "fixtures", "structure", "rules-edge"), "rules"],
    [join(HERE, "fixtures", "subsections"), "admin_code"],
    [join(HERE, "fixtures", "group-records"), "admin_code"],
    [FIXTURE, "admin_code"],
  ];
  for (const [dir, corpus] of dirs) {
    const files = readdirSync(dir).filter((x) => x.endsWith(".xml")).sort();
    const plain = JSON.stringify(buildSectionsFromXml(files.map((f) => readFileSync(join(dir, f), "utf8")), corpus), null, 2);
    const withStructure = build(dir, corpus);
    assert.equal(withStructure.json, plain, dir);
    assert.doesNotMatch(plain, /[-]/, `${dir}: no private-use mark leaks into the index`);
  }
  assert.equal(
    section.text,
    "Wherever in such Code reference is made to the standard, substitute this code. Modifications.—The provisions shall be subject to the following modifications. Introduction–Section 3—Definitions: (i) Designated level.—The [main] street floor, as in section 27-101 of this code. Both bold and italic here. 382.10 DELETED. 382.15 DELETED. Exceptions: Plain text after the exceptions line. Editor's note: For related provisions, see Appendix A. 100.1d Multiple Hoistways."
  );
});
