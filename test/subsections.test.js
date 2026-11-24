// The Construction Codes' "Subsection" levels (issue #76): read into the index, in document
// order, and shown on the website as real headings.
//
// Fixture: test/fixtures/subsections/0-0-0-2.xml, hand-made in the publisher's shape (Section >
// Subsection > Normal Level), one Subsection per rule of readBody (scripts/lib/build-corpus.js).
// The rule that a section with no Subsection keeps its text byte for byte is checked here on
// every fixture the repo has (the Charter's 44 files, the Rules' 6 and this one) against the
// pre-#76 rule written out below.
//
// Offline, and no counts from the real law: the daily refresh runs npm test, and a count that
// moves with the law would turn it red (CS-23). The real data is checked by npm run
// test:site-data (test/site-data/admin-layout.test.js).

import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { buildSectionsFromXml, collectSectionsFromXml, findDocument, readBody, createTitleIndex, finishTitles } from "../scripts/lib/build-corpus.js";
import { makeParser, childrenByTag, getAttr, extractText, normalize } from "../scripts/lib/extract-text.js";
import { createStructureCollector, subsectionKey } from "../scripts/lib/build-structure.js";
import { citeWithAnchor, copyId, splitCopyId } from "../site/assets/jump.js";
import { renderSection, bodyBlocks } from "../scripts/lib/render-section.js";
import { sectionMarkdown } from "../scripts/lib/serialize-markdown.js";
import { bodyHtml, readBlocks } from "../scripts/lib/site/render-html.js";
import { loadBook } from "../scripts/lib/site/model.js";
import { leftOutNote, sectionPage, chapterPage } from "../scripts/lib/site/pages.js";
import { siteFacts } from "../scripts/lib/site/build.js";
import { unescapeHtml } from "../scripts/lib/site/html.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
const FIXTURE = join(HERE, "fixtures", "subsections");
const ALL_FIXTURES = [
  [join(HERE, "fixtures", "diff", "xml"), "charter"],
  [join(HERE, "fixtures", "structure", "rules"), "rules"],
  [join(HERE, "fixtures", "structure", "rules-edge"), "rules"],
  [FIXTURE, "admin_code"],
];
const sha = (s) => createHash("sha256").update(s).digest("hex");
const xmlFiles = (dir) => readdirSync(dir).filter((f) => f.endsWith(".xml")).sort();

function build(dir, corpus) {
  const collector = createStructureCollector(corpus);
  const sections = [];
  const titles = createTitleIndex(); // issue #59, as build-index.js
  for (const f of xmlFiles(dir)) {
    collectSectionsFromXml(readFileSync(join(dir, f), "utf8"), corpus, sections, (e) => { throw e; }, collector.forFile({ root: f === "0-0-0-1.xml" }), titles);
  }
  finishTitles(titles);
  const json = JSON.stringify(sections, null, 2);
  return { sections, json, structure: collector.finish(sections, sha(json)) };
}

const built = build(FIXTURE, "admin_code");
const at = (citation) => {
  const i = built.sections.findIndex((s) => s.citation === citation);
  assert.ok(i >= 0, `${citation} is in the fixture`);
  return { section: built.sections[i], structure: built.structure.sections[i] };
};

test("index: a section's Subsections are read in document order, heading line then body", () => {
  assert.equal(
    at("Section EC 80").section.text,
    [
      "80.1 Title.",
      'This code shall be known and may be cited as the "New York City Electrical Code."',
      "80.2 Scope.",
      "This code applies to:",
      "1. New work.",
      "(a) In new buildings.",
      // The PARA ("80. 3 Wind resistance .") says the same as the HEADING but for spaces.
      "80.3 Wind resistance.",
      "(a) Exempt structures.",
      "1. Small sheds.",
      // No HEADING: the PARA.
      "80.4 Approval.",
      // The HEADING ("80.5") is the start of the PARA: the PARA.
      "80.5 Listed equipment.",
      // The PARA has a cross-reference: the PARA.
      "80.6 Terms defined in Chapter 1.",
      // The PARA says something else: both.
      "80.7 Reserved.",
      "Not in force.",
      "80.8 Tables.",
      "Table 80.8 follows.",
      // The PARA ("80.9") is only the start of the HEADING: the HEADING, the number said once.
      "80.9 ABS plastic.",
      "Appendix A",
      "1. The form.",
      // 80.8.1 is a level inside a Subsection that is not a Normal Level: not read, but counted.
    ].join(" ")
  );
  // Body text first, then the Subsection, as the document has them.
  assert.equal(at("Section EC 81").section.text, "The provisions of this code apply as follows. 81.1 General. See section 80.1.");
  // No Subsection: the text as before.
  assert.equal(at("Section EC 82").section.text, "For the purposes of this code: a. Words have their ordinary meaning.");
});

// The index's rule before #76, written out: a Section or Chapter's text is the PARAs of its
// "Normal Level" child levels' RECORDs, in order, joined with one space.
function oldText(level) {
  const parts = [];
  for (const child of childrenByTag(level, "LEVEL")) {
    if ((getAttr(child, "style-name") || "") !== "Normal Level") continue;
    for (const r of childrenByTag(child, "RECORD")) parts.push(...childrenByTag(r, "PARA").map((p) => normalize(extractText(p))));
  }
  return normalize(parts.join(" "));
}

test("index: every section with no Subsection keeps its text byte for byte (every fixture)", () => {
  let same = 0;
  let withSubsections = 0;
  for (const [dir, corpus] of ALL_FIXTURES) {
    for (const f of xmlFiles(dir)) {
      const doc = findDocument(makeParser().parse(readFileSync(join(dir, f), "utf8").replace(/^﻿/, "")));
      const levels = [];
      const walk = (node) => {
        for (const level of childrenByTag(node, "LEVEL")) {
          if (["Section", "Chapter"].includes(getAttr(level, "style-name"))) levels.push(level);
          walk(level);
        }
      };
      walk(doc);
      const sections = buildSectionsFromXml([readFileSync(join(dir, f), "utf8")], corpus);
      for (const level of levels) {
        const id = getAttr(childrenByTag(level, "RECORD")[0] ?? {}, "id");
        const s = sections.find((x) => x.id === id);
        if (!s) continue; // a record the index filters out (no heading, or one of 3 characters or fewer)
        const hasSubsection = childrenByTag(level, "LEVEL").some((l) => getAttr(l, "style-name") === "Subsection");
        if (hasSubsection) {
          withSubsections++;
          assert.notEqual(s.text, oldText(level), `${corpus} ${s.citation}: its Subsections are now read`);
        } else {
          assert.equal(s.text, oldText(level), `${corpus} ${s.citation}: unchanged`);
          same++;
        }
      }
    }
  }
  assert.ok(same > 400, `checked ${same} sections`);
  assert.equal(withSubsections, 2, "EC 80 and EC 81");
});

test("readBody: what each Subsection gives, and the levels it does not read", () => {
  const doc = findDocument(makeParser().parse(readFileSync(join(FIXTURE, "0-0-0-2.xml"), "utf8")));
  const find = (node, id) => {
    for (const level of childrenByTag(node, "LEVEL")) {
      if (childrenByTag(level, "RECORD").some((r) => getAttr(r, "id") === id)) return level;
      const inner = find(level, id);
      if (inner) return inner;
    }
    return null;
  };
  const { parts, unread } = readBody(find(doc, "0-0-0-110"));
  assert.deepEqual(
    parts.filter((p) => p.kind === "subheading").map((p) => [p.text, p.para ? "PARA" : "HEADING"]),
    [
      ["80.1 Title.", "HEADING"],
      ["80.2 Scope.", "HEADING"],
      ["80.3 Wind resistance.", "HEADING"],
      ["80.4 Approval.", "PARA"],
      ["80.5 Listed equipment.", "PARA"],
      ["80.6 Terms defined in Chapter 1.", "PARA"],
      ["80.7 Reserved.", "HEADING"],
      ["80.8 Tables.", "HEADING"],
      ["80.9 ABS plastic.", "HEADING"],
      ["Appendix A", "HEADING"],
    ]
  );
  assert.ok(parts.every((p) => p.subsection), "every part of EC 80 comes from a Subsection");
  assert.deepEqual(unread.map((l) => getAttr(l, "style-name")), ["Subsection"], "80.8.1, nested in 80.8");
});

test("onSection cannot change the index: the sections are the same with and without the structure hooks", () => {
  const plain = buildSectionsFromXml(xmlFiles(FIXTURE).map((f) => readFileSync(join(FIXTURE, f), "utf8")), "admin_code");
  assert.equal(JSON.stringify(plain, null, 2), built.json);
});

test("structure: subheading blocks, subdivisions that start over under each, and only unread levels counted", () => {
  const { section, structure } = at("Section EC 80");
  const blocks = bodyBlocks(renderSection(section, structure));
  assert.deepEqual(
    blocks.map((b) => [b.type, b.text, b.anchor ?? null]),
    [
      ["subheading", "80.1 Title.", "80.1"],
      ["text", 'This code shall be known and may be cited as the "New York City Electrical Code."', null],
      ["subheading", "80.2 Scope.", "80.2"],
      ["text", "This code applies to:", null],
      ["subdivision", "1. New work.", "80.2(1)"],
      ["subdivision", "(a) In new buildings.", "80.2(1)(a)"],
      ["subheading", "80.3 Wind resistance.", "80.3"],
      // A new list under 80.3: "80.3(a)", not under 80.2's 1.; its 1. is "80.3(1)", not "(1)-2".
      ["subdivision", "(a) Exempt structures.", "80.3(a)"],
      ["subdivision", "1. Small sheds.", "80.3(1)"],
      ["subheading", "80.4 Approval.", "80.4"],
      ["subheading", "80.5 Listed equipment.", "80.5"],
      ["subheading", "80.6 Terms defined in Chapter 1.", "80.6"],
      ["subheading", "80.7 Reserved.", "80.7"],
      ["text", "Not in force.", null],
      ["subheading", "80.8 Tables.", "80.8"],
      ["text", "Table 80.8 follows.", null],
      ["subheading", "80.9 ABS plastic.", "80.9"],
      // No number: no anchor of its own, and its parts are anchored at the section.
      ["subheading", "Appendix A", null],
      ["subdivision", "1. The form.", "(1)"],
    ]
  );
  // The blocks are the text, joined with one space; the Markdown body is the same.
  assert.equal(blocks.map((b) => b.text).join(" "), section.text);
  assert.equal(sectionMarkdown(renderSection(section, structure)).split("\n")[4], section.text);
  assert.ok(!structure.flat);
  // 80.6's cross-reference is kept, on the heading line, and points at the chapter (an indexed record).
  const link = blocks.find((b) => b.text.startsWith("80.6")).links;
  assert.equal(link.length, 1);
  assert.equal("80.6 Terms defined in Chapter 1.".slice(link[0].start, link[0].end), "Chapter 1");
  assert.deepEqual(link[0].to, { corpus: "admin_code", name: "T28C001", id: "0-0-0-100" });
  // The picture is still counted (pictures are out of scope), and so is 80.8.1, the one level
  // the index still does not read. The Subsections it reads are not.
  assert.equal(structure.pictures, 1);
  assert.equal(structure.subsections, 1);
  assert.equal(at("Section EC 81").structure.subsections, undefined);
  assert.equal(at("Section EC 82").structure.subsections, undefined);
  // A link to an anchor on a Subsection record goes to that subsection in the section holding it.
  const ec81 = at("Section EC 81");
  assert.deepEqual(ec81.structure.links.map((l) => l.to), [{ corpus: "admin_code", name: "80.1", id: "0-0-0-110", anchor: "80.1" }]);
  assert.deepEqual(bodyBlocks(renderSection(ec81.section, ec81.structure)).map((b) => b.type), ["text", "subheading", "text"]);
});

// The site, from the fixture laid out with the Charter's page builders (pages.js). npm test may
// not import the Administrative Code's page builders (test/deploy-workflow.test.js); they pass
// the same headingLevel and are checked on the real data in test/site-data/admin-layout.test.js.
// The Charter's paths need "§ <number>" citations, so "Section EC 80: General" becomes
// "§ 80. General"; nothing else in the fixture changes.
const charterXml = readFileSync(join(FIXTURE, "0-0-0-2.xml"), "utf8").replace(/Section EC (\d+): /g, "§ $1. ");
const charterBuilt = (() => {
  const collector = createStructureCollector("charter");
  const sections = [];
  collectSectionsFromXml(charterXml, "charter", sections, (e) => { throw e; }, collector.forFile());
  const json = JSON.stringify(sections, null, 2);
  return { sections, json, structure: collector.finish(sections, sha(json)) };
})();
const book = loadBook({
  corpus: "charter",
  indexJsonText: charterBuilt.json,
  structure: charterBuilt.structure,
  versions: { charter: { currentThrough: "Current through a made-up local law,", indexedAt: "2026-11-23T02:05:49.061Z", sectionCount: charterBuilt.sections.length, sha256: sha(charterBuilt.json) } },
});
const DATA_SOURCES = JSON.parse(readFileSync(join(ROOT, "DATA-SOURCES.json"), "utf8"));
const SITE = siteFacts([book], DATA_SOURCES).perBook.get("charter");
const pages = [...book.chapters.map((c) => chapterPage(c, book, SITE)), ...book.sections.map((x) => sectionPage(x, book, SITE))];
const mainOf = (html) => html.slice(html.indexOf("<main"), html.indexOf("</main>"));
const headings = (html) => [...mainOf(html).matchAll(/<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>/g)].map((m) => ({ level: Number(m[1]), text: unescapeHtml(m[2].replace(/<[^>]*>/g, "")).trim() }));

test("site: a section page shows each subheading as an h2 under the h1, with its text, in order", () => {
  const s = book.sections.find((x) => x.citation === "§ 80");
  const page = pages.find((p) => p.path === s.path);
  const shown = readBlocks(page.html, unescapeHtml);
  const body = bodyBlocks(renderSection(s, s.structure));
  assert.deepEqual(shown.map((b) => b.text), body.map((b) => b.text));
  assert.deepEqual(
    shown.filter((b) => b.tag !== "p").map((b) => [b.tag, b.cls, b.text]),
    body.filter((b) => b.type === "subheading").map((b) => ["h2", "subhead", b.text])
  );
  assert.match(page.html, /<h2 class="subhead" id="80\.1" data-pagefind-title="NYC Charter § 80\.1" data-block="0">80\.1 Title\.<\/h2>/);
  // The link on 80.6's heading line is a link on the page.
  assert.match(page.html, /<h2 class="subhead" id="80\.6" [^>]*data-block="\d+">80\.6 Terms defined in <a class="xref" href="[^"]+"[^>]*>Chapter 1<\/a>\.<\/h2>/);
  // Only the level still unread is named; the subsections that are read are not "left out".
  assert.match(page.html, /This section has 1 subsection and 1 picture \(figures, equations, or tables drawn as images\) that BetaNYC's copy does not show\./);
  const ec81 = book.sections.find((x) => x.citation === "§ 81");
  assert.equal(leftOutNote(ec81, SITE), "");
  assert.doesNotMatch(pages.find((p) => p.path === ec81.path).html, /BetaNYC's copy (?:has no text|does not show)/);
});

test("site: on the chapter page the copies' subheadings are h3, under the section's h2", () => {
  const c = book.chapters.find((x) => x.citation === "Chapter 1");
  const page = pages.find((p) => p.path === c.path);
  const h = headings(page.html);
  const ec80 = h.findIndex((x) => x.level === 2 && x.text.startsWith("§ 80."));
  assert.ok(ec80 > 0, "the copy of EC 80 has its h2");
  assert.deepEqual(h.slice(ec80 + 1, ec80 + 3), [{ level: 3, text: "80.1 Title." }, { level: 3, text: "80.2 Scope." }]);
  // The copy's words, every one, in order (the h3 ends a block, as a </p> does).
  const start = page.html.indexOf(`<div class="chapter-section" id="s-${book.sections.find((x) => x.citation === "§ 80").slug}">`);
  const copy = page.html.slice(start, page.html.indexOf('<div class="chapter-section"', start + 1));
  const words = unescapeHtml(copy.replace(/<h2>[\s\S]*?<\/p>\n/, "").replace(/<p class="left-out"[\s\S]*?<\/p>\n/, "").replace(/<\/(?:p|h[3-6])>/g, " ").replace(/<[^>]*>/g, "")).replace(/\s+/g, " ").trim();
  assert.equal(words, at("Section EC 80").section.text);
  assert.doesNotMatch(copy, /<h3[^>]*data-block=/, "the copy is not read as the chapter's own text");
});

test("site: every page's heading outline starts at h1 and never skips a level", () => {
  let checked = 0;
  for (const p of pages) {
    const h = headings(p.html);
    assert.equal(h[0]?.level, 1, `${p.path}: the first heading is the h1`);
    h.forEach((x, i) => {
      if (i) assert.ok(x.level <= h[i - 1].level + 1, `${p.path}: "${x.text}" (h${x.level}) follows an h${h[i - 1].level}`);
    });
    // Within one section's text, subheadings are told apart by their words.
    const subs = [...mainOf(p.html).matchAll(/<h([2-6]) class="subhead"[^>]*>([\s\S]*?)<\/h\1>/g)].map((m) => m[2]);
    assert.equal(new Set(subs).size, subs.length, `${p.path}: no two subheadings share a name`);
    checked++;
  }
  assert.ok(checked >= 4, `${checked} pages`);
});

test("bodyHtml: a subheading's element follows headingLevel, and readBlocks reads it back", () => {
  const blocks = [
    { type: "subheading", text: "80.1 Title." },
    { type: "text", text: "This code shall be known." },
  ];
  const two = bodyHtml(blocks, { fullCitation: "Admin. Code Section EC 80", linkFor: () => null });
  assert.equal(two, '<h2 class="subhead" data-block="0">80.1 Title.</h2>\n<p class="txt" data-block="1">This code shall be known.</p>');
  const three = bodyHtml(blocks, { fullCitation: "Admin. Code Section EC 80", linkFor: () => null, copyOf: "ec-80", headingLevel: 3 });
  assert.equal(three, '<h3 class="subhead">80.1 Title.</h3>\n<p class="txt">This code shall be known.</p>');
  assert.deepEqual(readBlocks(two, unescapeHtml).map((b) => [b.n, b.tag, b.text]), [[0, "h2", "80.1 Title."], [1, "p", "This code shall be known."]]);
  // law.css styles it.
  const css = readFileSync(join(ROOT, "site", "assets", "law.css"), "utf8");
  assert.match(css, /\.law \.subhead \{[^}]*font:[^}]*\}/);
});

test("two subsections, each with an item (1): unique anchors with no -n, each cited as a real citation", () => {
  const { structure } = at("Section EC 80");
  const anchors = structure.blocks.map((b) => b.anchor).filter(Boolean);
  assert.equal(new Set(anchors).size, anchors.length, "anchors are unique");
  assert.ok(anchors.every((a) => !/-\d+$/.test(a)), `no -n suffix: ${anchors.join(" ")}`);
  assert.ok(anchors.includes("80.2(1)") && anchors.includes("80.3(1)"));
  // On the page: the search title and the label link's name are the citation, the section
  // number said once ("§ 80.3(1)", not "§ 8080.3(1)" or "§ 80(1)-2").
  const s = book.sections.find((x) => x.citation === "§ 80");
  const html = pages.find((p) => p.path === s.path).html;
  for (const a of ["80.2(1)", "80.3(1)"]) {
    const cite = `NYC Charter § ${a}`;
    assert.ok(html.includes(` id="${a}" data-pagefind-title="${cite}"`), `${a}: id and search title`);
    assert.ok(html.includes(`<a class="num" href="#${a}" aria-label="1., link to ${cite}">1.</a>`), `${a}: label link`);
  }
  // In the chapter page's copy, the ids keep the section's prefix and stay apart.
  const chapter = pages.find((p) => p.path === book.chapters[0].path).html;
  assert.ok(chapter.includes(' id="s-80_80.2(1)"') && chapter.includes(' id="s-80_80.3(1)"') && chapter.includes(' id="s-80(1)"'));
});

test("citeWithAnchor: a subsection's number takes the section number's place; copy ids round-trip", () => {
  // Copy citation (law.js), search titles and link names all use it.
  assert.equal(citeWithAnchor("NYC Charter § 259", "(b)(1)"), "NYC Charter § 259(b)(1)");
  assert.equal(citeWithAnchor("NYC Administrative Code Section EC 80", "80.1"), "NYC Administrative Code Section EC 80.1");
  assert.equal(citeWithAnchor("NYC Administrative Code Section FC 102", "102.4(1)"), "NYC Administrative Code Section FC 102.4(1)");
  assert.equal(citeWithAnchor("NYC Administrative Code Section BC E104", "E104.2.2(a)"), "NYC Administrative Code Section BC E104.2.2(a)");
  assert.equal(citeWithAnchor("Rules § 19.1-01", "19.1-01.1"), "Rules § 19.1-01.1");
  // A number that does not start with the section's (a publisher's typo) is not merged into it.
  assert.equal(citeWithAnchor("NYC Administrative Code Section BC 428", "4285.3.3"), "NYC Administrative Code Section BC 428, 4285.3.3");
  assert.equal(citeWithAnchor("Section FC 102", "1020.1"), "Section FC 102, 1020.1");
  assert.equal(citeWithAnchor("NYC Charter § 259", ""), "NYC Charter § 259");
  for (const [slug, anchor] of [["4", "(b)(1)"], ["fc-102", "102.4(1)"], ["220.14-0-0-0-231984", "220.14.1"], ["4", ""]]) {
    const id = copyId(slug, anchor);
    assert.deepEqual(splitCopyId(id.slice(2)), { slug, anchor }, id);
  }
  assert.equal(copyId("4", "(b)"), "s-4(b)", "the Charter's ids are unchanged");
  // subsectionKey reads the number at the start of a heading line.
  assert.equal(subsectionKey("102.4 Smoking."), "102.4");
  assert.equal(subsectionKey("E104.2.2 Group I-3."), "E104.2.2");
  assert.equal(subsectionKey("§ 19.1-01.1 Applicability."), "19.1-01.1");
  assert.equal(subsectionKey("3.1.1. Definition."), "3.1.1");
  assert.equal(subsectionKey("Appendix A"), null);
  assert.equal(subsectionKey("SECTION XI – POSITIONS"), null);
});
