// The site structure (issue #61): subdivisions, link targets, and chapter and title names, kept
// beside the index in data/structure/<corpus>.json without changing the index or the MCP.
//
// Fixtures are American Legal Publishing's own XML, unchanged:
//   - test/fixtures/diff/xml/: 44 Charter files (Current through Local Law 2026/086);
//   - test/fixtures/structure/rules/: 4 Rules files from the 2026-07-05 bulk download
//     (Current through rules effective July 1, 2026): Title 72 Chapter 1 and Title 73 Chapter 1,
//     each inside its Title record; Title 73 Chapter 2 and Title 42 Chapter 2, with no Title
//     record around them (the publisher puts a Title's record only in its first chapter's file).
//   - test/fixtures/structure/rules-edge/: 2 Rules files from the same download. 0-0-0-89178.xml
//     (Title 62 Chapter 2, ULURP), where § 2-01.1 carries § 2-01's anchor id and name, and
//     § 2-02 links to that id. 0-0-0-153879.xml (§ 40-05), whose text has a micro sign (U+00B5)
//     that Unicode NFKC would turn into a Greek mu.
//
// Offline: no network, no data/raw, no dependence on today's date.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { buildSectionsFromXml, collectSectionsFromXml, extractVersion } from "../scripts/lib/build-corpus.js";
import {
  createStructureCollector,
  structureJson,
  labelKey,
  titleKeyOf,
  normalizeTitleKey,
  infobaseCorpus,
  groupLabel,
  resolveTarget,
} from "../scripts/lib/build-structure.js";
import { renderSection, bodyBlocks } from "../scripts/lib/render-section.js";
import { corpusMarkdown } from "../scripts/lib/serialize-markdown.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const CHARTER_XML = join(__dirname, "fixtures", "diff", "xml");
const RULES_XML = join(__dirname, "fixtures", "structure", "rules");
const RULES_EDGE_XML = join(__dirname, "fixtures", "structure", "rules-edge");

const sha = (s) => createHash("sha256").update(s).digest("hex");

function xmlFiles(dir) {
  return readdirSync(dir).filter((f) => f.endsWith(".xml")).sort();
}

// The build, the way scripts/build-index.js runs it, over one fixture folder.
function build(dir, corpus) {
  const files = xmlFiles(dir);
  const collector = createStructureCollector(corpus);
  const sections = [];
  let version = "Unknown";
  for (const f of files) {
    const xml = readFileSync(join(dir, f), "utf8");
    collectSectionsFromXml(xml, corpus, sections, (e) => { throw e; }, collector.forFile({ root: f === "0-0-0-1.xml" }));
    if (f === "0-0-0-1.xml") version = extractVersion(xml);
  }
  const json = JSON.stringify(sections, null, 2);
  const structure = collector.finish(sections, sha(json));
  return { sections, structure, version, json };
}

const charter = build(CHARTER_XML, "charter");
const rules = build(RULES_XML, "rules");
const rulesEdge = build(RULES_EDGE_XML, "rules");

// What has to hold for any structure file: it lines up with the index record by record, and
// each section's blocks cut its `text` into its paragraphs, so joining them gives `text` back.
function checkStructure(sections, structure) {
  assert.equal(structure.sections.length, sections.length, "one structure entry per index record");
  structure.sections.forEach((s, i) => {
    const text = sections[i].text;
    assert.equal(s.id, sections[i].id, `entry ${i} is the index's record ${sections[i].id}`);
    let at = 0;
    s.blocks.forEach((b, k) => {
      assert.equal(b.start, k === 0 ? 0 : at + 1, `${s.id} block ${k} starts one space after the last`);
      if (k > 0) assert.equal(text[at], " ", `${s.id}: blocks are separated by one space`);
      assert.ok(b.end > b.start, `${s.id} block ${k} is not empty`);
      if (b.label) assert.ok(text.slice(b.start, b.end).startsWith(b.label), `${s.id} block ${k} starts with its label`);
      at = b.end;
    });
    assert.equal(at, text.length, `${s.id}: blocks cover the whole text`);
    const anchors = s.blocks.map((b) => b.anchor).filter(Boolean);
    assert.equal(new Set(anchors).size, anchors.length, `${s.id}: anchors are unique`);
    for (const l of s.links ?? []) {
      assert.ok(l.start >= 0 && l.end > l.start && l.end <= text.length, `${s.id}: link inside the text`);
      assert.ok(s.blocks.some((b) => l.start >= b.start && l.end <= b.end), `${s.id}: link inside one block`);
    }
    for (const p of s.parents) assert.ok(structure.groups[p], `${s.id}: parent ${p} is named in groups`);
    const body = bodyBlocks(renderSection(sections[i], s)).map((b) => b.text).join(" ");
    assert.equal(body, text, `${s.id}: renderSection's body is the text`);
  });
}

test("the hooks do not change the index: the fixtures' JSON and Markdown are byte for byte what e3ee2e2 wrote", () => {
  // Pinned from e3ee2e2 (v0.6.2, before #61): its build-corpus.js and the Markdown writer that
  // was inline in its build-index.js, run over test/fixtures/diff/xml in sorted file order.
  // A change here means the index or the Markdown changed: that is a change to the MCP's data,
  // not to the site structure, and needs its own issue.
  const md = corpusMarkdown({ corpus: "charter", version: charter.version, sections: charter.sections, structure: charter.structure });
  assert.equal(charter.sections.length, 426);
  assert.equal(charter.version, "Current through Local Law 2026/086, enacted April 25, 2026,");
  // Issue #78 (review) added one field, `level`, to chapter records (and to a section in no
  // chapter, none in these fixtures), so get_title can tell where a chapter ends. Every other
  // byte is e3ee2e2's: the JSON without it is the pinned file.
  const withoutLevel = JSON.stringify(charter.sections.map(({ level, ...s }) => s), null, 2);
  assert.equal(sha(withoutLevel), "4b59d641629a356f6778395b8abc51edd9ef98d222ab71d828dab79e5529a9a1");
  assert.ok(charter.sections.every((s) => (s.level === "Chapter") === /^(Chapter \S+|Preamble|Introductory)$/.test(s.citation)), "level is on the chapter records, and only there");
  assert.equal(sha(md), "1725ff3e725d1cb79d66c131666284d4a3309b8a52b7fdb60a46dbfea2885c07");
  // And the same Markdown without the structure (the body from `text` alone).
  assert.equal(sha(corpusMarkdown({ corpus: "charter", version: charter.version, sections: charter.sections })), sha(md));
});

test("the sections are the same with and without the structure hooks", () => {
  for (const [dir, corpus, built] of [[CHARTER_XML, "charter", charter], [RULES_XML, "rules", rules]]) {
    const plain = buildSectionsFromXml(xmlFiles(dir).map((f) => readFileSync(join(dir, f), "utf8")), corpus);
    assert.deepEqual(built.sections, plain);
  }
});

test("every structure entry slices its section's text exactly", () => {
  checkStructure(charter.sections, charter.structure);
  checkStructure(rules.sections, rules.structure);
  checkStructure(rulesEdge.sections, rulesEdge.structure);
  assert.ok(charter.structure.sections.every((s) => !s.flat), "no Charter fixture section fell back to one block");
  assert.ok(charter.structure.sections.every((s) => !s.unplacedLinks), "every Charter fixture link was placed");
});

function entry(built, citation) {
  const i = built.sections.findIndex((s) => s.citation === citation);
  assert.ok(i >= 0, `${citation} is in the fixtures`);
  return { section: built.sections[i], structure: built.structure.sections[i], blocks: renderSection(built.sections[i], built.structure.sections[i]) };
}

test("Charter § 1133: subdivisions keep label, depth and a stable anchor", () => {
  const { blocks } = entry(charter, "§ 1133");
  const body = bodyBlocks(blocks);
  assert.deepEqual(
    body.map((b) => b.anchor ?? b.type),
    ["(a)", "(b)", "(b)(1)", "(b)(2)", "(b)(3)", "(b)(4)", "(b)(5)", "(c)", "(c)(1)", "(c)(2)", "(c)(3)", "(c)(4)", "(d)", "(e)", "(f)", "(g)", "(h)", "text", "note"]
  );
  const b1 = body.find((b) => b.anchor === "(b)(1)");
  assert.equal(b1.type, "subdivision");
  assert.equal(b1.depth, 2);
  assert.equal(b1.label, "1.");
  assert.ok(b1.text.startsWith("1. the title of each such report"));
  assert.equal(body.find((b) => b.anchor === "(a)").depth, 1);
  // The history line is a plain paragraph: the XML does not mark it.
  assert.match(body[17].text, /^\(Am\. L\.L\. 2019\/029/);
  assert.match(body[18].text, /^Editor's note:/);
});

test("Charter § 645: a label repeated in one section gets a numbered anchor, not a duplicate", () => {
  const anchors = bodyBlocks(entry(charter, "§ 645").blocks).map((b) => b.anchor).filter(Boolean);
  assert.ok(anchors.includes("(a)(1)") && anchors.includes("(a)(1)-2"));
  assert.ok(anchors.includes("(b)(3)(g)"));
});

test("links keep their target: a Charter jump resolves to the section; another document's link keeps its name", () => {
  const { section, structure } = entry(charter, "§ 1133");
  const links = structure.links.map((l) => ({ words: section.text.slice(l.start, l.end), to: l.to }));
  const s1134 = charter.sections.find((s) => s.citation === "§ 1134");
  assert.deepEqual(links[0], { words: "1134", to: { corpus: "charter", name: "1134", id: s1134.id } });
  // The Administrative Code is not built here, so its link is named, not resolved.
  assert.deepEqual(links[2], { words: "L.L. 2003/011", to: { corpus: "admin_code", name: "L.L. 2003/011", resolved: false } });
  // renderSection gives a block's links relative to the block.
  const note = bodyBlocks(entry(charter, "§ 1133").blocks).find((b) => b.type === "note");
  assert.deepEqual(note.links.map((l) => note.text.slice(l.start, l.end)), ["L.L. 2003/011", "L.L. 2003/022"]);
  // A web link keeps its address.
  const web = charter.structure.sections.flatMap((s) => s.links ?? []).find((l) => l.to.kind === "web");
  assert.match(web.to.url, /^https?:\/\//);
});

test("Rules titles: a chapter with no Title record around it gets its title from the publisher's key (#59)", () => {
  const chapters = rules.structure.sections
    .map((s, i) => ({ s, section: rules.sections[i] }))
    .filter(({ s }) => s.level === "Chapter")
    .map(({ s, section }) => ({ heading: section.heading, title: s.parents.map((p) => rules.structure.groups[p]).find((g) => g.level === "Title")?.label ?? null }));
  assert.deepEqual(chapters, [
    { heading: "Chapter 1: Emergency Food Delivery Program", title: "Title 72" },
    { heading: "Chapter 1: Poll Site Language Assistance Program", title: "Title 73" },
    { heading: "Chapter 2: Procedures and Criteria for the Citywide Participatory Budgeting Program", title: "Title 73" },
    // Title 42's record is not in these fixtures, so its chapter is left without a title,
    // never given a wrong one.
    { heading: "Chapter 2: Adjudications", title: null },
  ]);
  assert.deepEqual(rules.structure.titleStats, { fromFile: 2, fromKey: 1, none: 1, keyDisagrees: 0 });
  // Sections take their chapter's title.
  const i = rules.sections.findIndex((s) => s.citation === "§ 2-01");
  assert.equal(rules.structure.groups[rules.structure.sections[i].parents[0]].heading, "Title 73: Civic Engagement Commission");
});

test("label, key and file-name helpers", () => {
  assert.equal(labelKey("a."), "a");
  assert.equal(labelKey("(a)"), "a");
  assert.equal(labelKey("4-a."), "4-a");
  assert.equal(labelKey("(iv)"), "iv");
  assert.equal(labelKey("•"), null);
  assert.equal(labelKey("Section"), null);
  assert.equal(titleKeyOf("T03C007"), "3");
  assert.equal(titleKeyOf("T16-bC001"), "16B");
  assert.equal(titleKeyOf("T02AppA"), "2");
  assert.equal(titleKeyOf("1133"), null);
  assert.equal(normalizeTitleKey("38-A"), "38A");
  assert.equal(infobaseCorpus("L:\\NY\\New York City\\Folio\\Working\\Admin.nfo"), "admin_code");
  assert.equal(infobaseCorpus("L:\\NY\\New York City\\Folio\\Web\\Charter.nfo"), "charter");
  assert.equal(infobaseCorpus("L:\\NY\\New York City\\Folio\\Working\\Rules.NFO"), "rules");
  assert.equal(groupLabel("Title 16-A: [Commercial Waste Removal]"), "Title 16-A");
  assert.equal(groupLabel("Subchapter 1: [No Title]"), "Subchapter 1");
  // Letter-numbered levels, as the Rules head them.
  assert.equal(groupLabel("Subchapter A: Scope and Application"), "Subchapter A");
  assert.equal(groupLabel("Appendix A"), "Appendix A");
  assert.equal(groupLabel("Appendix A to Title 62: Criteria for the Location of City Facilities*"), null);
  assert.equal(groupLabel("THE RULES OF THE CITY OF NEW YORK"), null);
});

test("an anchor id or name the publisher put on two records leaves the link unresolved, not pointed at either", () => {
  // In 0-0-0-89178.xml, § 2-01 and § 2-01.1 both carry <DESTINATION id="0-0-0-12471"
  // name="T62C002_2-01">. Before this guard the links in § 2-02 went to whichever was read last.
  const i = rulesEdge.sections.findIndex((s) => s.citation === "§ 2-02");
  const links = rulesEdge.structure.sections[i].links.filter((l) => l.to.name === "T62C002_2-01");
  assert.ok(links.length >= 1, "§ 2-02 links to § 2-01");
  for (const l of links) {
    assert.equal(rulesEdge.sections[i].text.slice(l.start, l.end), "2-01");
    assert.deepEqual(l.to, { corpus: "rules", name: "T62C002_2-01", resolved: false, ambiguous: true });
  }
  assert.equal(rulesEdge.structure.linkStats.ambiguousIds, 1);
  assert.equal(rulesEdge.structure.linkStats.ambiguousNames, 1);
  // The same by name alone (a link from another document has no id): ambiguous too.
  const collector = createStructureCollector("rules");
  const sections = [];
  for (const f of xmlFiles(RULES_EDGE_XML)) collectSectionsFromXml(readFileSync(join(RULES_EDGE_XML, f), "utf8"), "rules", sections, null, collector.forFile());
  const r = { rules: collector.resolver() };
  assert.deepEqual(resolveTarget({ kind: "section", corpus: "rules", name: "T62C002_2-01" }, r), { corpus: "rules", name: "T62C002_2-01", resolved: false, ambiguous: true });
  assert.deepEqual(resolveTarget({ kind: "section", corpus: "rules", destination: "0-0-0-12471", name: "anything" }, r), { corpus: "rules", name: "anything", resolved: false, ambiguous: true });
  // A name on one record still resolves.
  const s202 = rulesEdge.sections[i];
  const own = resolveTarget({ kind: "section", corpus: "rules", name: "T62C002_2-02" }, r);
  assert.equal(own.id, s202.id);
});

test("block text is the index's text byte for byte (no Unicode normalization)", () => {
  const i = rulesEdge.sections.findIndex((s) => s.citation === "§ 40-05");
  const section = rulesEdge.sections[i];
  assert.notEqual(section.text.normalize("NFKC"), section.text, "the fixture has a character NFKC changes");
  assert.ok(!rulesEdge.structure.sections[i].flat);
  const blocks = bodyBlocks(renderSection(section, rulesEdge.structure.sections[i]));
  const micro = blocks.filter((b) => b.text.includes("\u00B5g/m"));
  assert.ok(micro.length >= 1, "the micro sign survives in a block");
  assert.ok(blocks.every((b) => !b.text.includes("\u03BC")), "and is not turned into a Greek mu");
  assert.equal(blocks.map((b) => b.text).join(" "), section.text);
});

test("the structure file is valid JSON, one section per line", () => {
  const text = structureJson(charter.structure);
  assert.deepEqual(JSON.parse(text), charter.structure);
  const lines = text.split("\n");
  assert.ok(lines.length > charter.sections.length, "a line per section at least");
  assert.ok(text.endsWith("}\n"));
});

// The committed structure, when there is one, must belong to the committed index: same sha256,
// same records, and its blocks must cut the index's text exactly. It is built by
// `npm run build-index` and committed by the daily refresh (.github/workflows/refresh-data.yml).
// The tests skip only while data/structure/ does not exist at all; once it does, a missing
// file fails.
const STRUCTURE_DIR = join(ROOT, "data", "structure");
const noStructure = existsSync(STRUCTURE_DIR) ? false : "data/structure/ is not built yet";
for (const corpus of ["charter", "admin_code", "rules"]) {
  const path = join(STRUCTURE_DIR, `${corpus}.json`);
  test(`committed data/structure/${corpus}.json belongs to the committed index`, { skip: noStructure }, () => {
    assert.ok(existsSync(path), `data/structure/ exists but ${corpus}.json is missing`);
    const indexText = readFileSync(join(ROOT, "data", "index", "json", `${corpus}.json`), "utf8");
    const versions = JSON.parse(readFileSync(join(ROOT, "data", "index", "json", "versions.json"), "utf8"));
    const structure = JSON.parse(readFileSync(path, "utf8"));
    assert.equal(structure.format, 1);
    assert.equal(structure.corpus, corpus);
    assert.equal(structure.indexSha256, sha(indexText), "built from the committed index JSON");
    assert.equal(structure.indexSha256, versions[corpus].sha256, "and from the build versions.json describes");
    assert.equal(structure.sectionCount, versions[corpus].sectionCount);
    checkStructure(JSON.parse(indexText), structure);
  });
}
