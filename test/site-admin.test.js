// The Administrative Code on the site (issue #65): the rules, on small made-up data.
//
// Part of npm test, which the daily refresh runs on the freshly rebuilt index, so nothing here
// reads the committed law data: a new title or a new year of local laws must never turn the
// refresh red. The layout on the real data is checked by test/site-data/admin-layout.test.js
// (npm run test:site-data, in test.yml and before a deploy) and in a browser by
// test/site/admin.test.mjs (npm run test:site).

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { splitIntoParts, anySectionSlug, adminShortHeading, adminCodeTitle, tellApart, lineOf } from "../scripts/lib/site/model.js";
import { leftOutNote, sectionBody, copyLinkFor } from "../scripts/lib/site/pages.js";
import { anchorCaseNotes } from "../scripts/lib/site/render-html.js";
import { siteFacts } from "../scripts/lib/site/build.js";
import { currentLine, bottomBox } from "../scripts/lib/site/layout.js";
import { BOOKS } from "../scripts/lib/site/config.js";
import { redirectFor, redirectChoices } from "../site/assets/not-found.js";
import { collectSectionsFromXml } from "../scripts/lib/build-corpus.js";
import { createStructureCollector } from "../scripts/lib/build-structure.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DATA_SOURCES = JSON.parse(readFileSync(join(ROOT, "DATA-SOURCES.json"), "utf8"));

const SITE = {
  currentThrough: "Current through Local Law 2026/165, enacted November 19, 2026.",
  copyChangedOn: "November 22, 2026",
  officialUrl: "https://codelibrary.amlegal.com/codes/newyorkcity/latest/NYCadmin/0-0-0-1",
  officialBase: "https://codelibrary.amlegal.com/codes/newyorkcity/latest/NYCadmin/",
  officialName: "The official Administrative Code",
  contentsPath: "/admin-code/",
};

test("splitIntoParts keeps order, caps sections and characters, and gives an oversized section a part of its own", () => {
  const s = (n, len) => ({ n, text: "x".repeat(len) });
  const list = [s(1, 10), s(2, 10), s(3, 50), s(4, 10), s(5, 10)];
  assert.deepEqual(splitIntoParts(list, { maxSections: 2, maxChars: 1000 }).map((p) => p.map((x) => x.n)), [[1, 2], [3, 4], [5]]);
  assert.deepEqual(splitIntoParts(list, { maxSections: 10, maxChars: 25 }).map((p) => p.map((x) => x.n)), [[1, 2], [3], [4, 5]]);
  assert.deepEqual(splitIntoParts([], {}), []);
});

test("anySectionSlug: § numbers as the Charter's, local laws, lettered codes, and the rest", () => {
  assert.equal(anySectionSlug("§ 28-101.1"), "28-101.1");
  assert.equal(anySectionSlug("§ 16-501"), "16-501");
  assert.equal(anySectionSlug("L.L. 2016/002"), "ll-2016-002");
  assert.equal(anySectionSlug("Section FC 101"), "fc-101");
  assert.equal(anySectionSlug("D302 Conversions to a multiple dwelling (MDL 9(2))"), "d302-conversions-to-a-multiple-dwelling-mdl-9-2");
  assert.equal(anySectionSlug("SECTION 1 – GENERAL"), "1-general");
});

test("adminShortHeading strips the citation in each of the Admin Code's heading shapes", () => {
  assert.equal(adminShortHeading({ citation: "§ 11-601", heading: "§ 11-601 Definitions." }), "Definitions");
  assert.equal(adminShortHeading({ citation: "Section EC 80", heading: "Section EC 80: General" }), "General");
  assert.equal(adminShortHeading({ citation: "Chapter 9", heading: "Chapter 9. Career and Technical Education Reporting" }), "Career and Technical Education Reporting");
  assert.equal(adminShortHeading({ citation: "§ 110.1", heading: "Section 110.1" }), "");
  assert.equal(adminShortHeading({ citation: "L.L. 2016/002", heading: "L.L. 2016/002" }), "");
});

test("adminCodeTitle is get_title's rule: the title most § sections are numbered in", () => {
  const c = (citation) => ({ citation });
  assert.equal(adminCodeTitle([c("§ 16-501"), c("§ 16-502"), c("§ 3-101")]), "16");
  assert.equal(adminCodeTitle([c("§ 8-102a")]), "8");
  assert.equal(adminCodeTitle([c("L.L. 2016/002")]), null);
});

test("a section with pictures or unread subsections says so and links to its page at American Legal", () => {
  const rec = (structure, text = "Some text.") => ({ id: "0-0-0-5", citation: "§ 27-271", text, structure: { blocks: [], ...structure } });
  const url = `${SITE.officialBase}0-0-0-5`;
  assert.equal(leftOutNote(rec({}), SITE), "");
  const pics = leftOutNote(rec({ pictures: 3 }), SITE);
  assert.match(pics, /This section has 3 pictures \(figures, equations, or tables drawn as images\) that BetaNYC's copy does not show\./);
  assert.ok(pics.includes(`<a href="${url}">Read § 27-271 at American Legal Publishing</a>`));
  // A structure from before `pictures` was counted: a block marked picture still counts.
  assert.match(leftOutNote(rec({ blocks: [{ picture: true }, { picture: true }] }), SITE), /This section has pictures \(figures/);
  // No text, but subsections: the note alone, not "no text".
  const subs = sectionBody(rec({ subsections: 12, pictures: 1 }, ""), SITE, "");
  assert.match(subs, /has 12 subsections and 1 picture/);
  assert.doesNotMatch(subs, /has no text/);
  // No text and nothing to explain it: say so, with the link.
  assert.equal(sectionBody(rec({}, ""), SITE, ""), `<p class="empty">BetaNYC's copy has no text for this section. <a href="${url}">Read § 27-271 at American Legal Publishing</a>.</p>`);
});

test("structure: pictures and still-unread levels are counted per section, not per chapter; Subsections are read (#76)", () => {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<DOCUMENT source-infobase-name="Admin">
  <LEVEL style-name="Chapter"><RECORD id="0-0-0-10"><HEADING>Chapter 1: Building Code</HEADING></RECORD>
    <LEVEL style-name="Section"><RECORD id="0-0-0-11"><HEADING>§ 27-1 Scope.</HEADING></RECORD>
      <LEVEL style-name="Normal Level"><RECORD id="0-0-0-12"><PARA>The scope.</PARA><PARA><PICTURE id="p1" name="a.jpg"/></PARA></RECORD></LEVEL>
      <LEVEL style-name="Subsection"><RECORD id="0-0-0-13"><HEADING>27-1.1 General.</HEADING><PARA>More text <PICTURE id="p2" name="b.jpg"/></PARA></RECORD></LEVEL>
      <LEVEL style-name="Subsection"><RECORD id="0-0-0-14"><HEADING>27-1.2 Other.</HEADING><PARA>Even more.</PARA></RECORD>
        <LEVEL style-name="Subsection"><RECORD id="0-0-0-17"><HEADING>27-1.2.1 Nested.</HEADING><PARA>27-1.2.1 Nested.</PARA></RECORD></LEVEL>
      </LEVEL>
    </LEVEL>
    <LEVEL style-name="Section"><RECORD id="0-0-0-15"><HEADING>§ 27-2 Plain.</HEADING></RECORD>
      <LEVEL style-name="Normal Level"><RECORD id="0-0-0-16"><PARA>Plain text.</PARA></RECORD></LEVEL>
    </LEVEL>
  </LEVEL>
</DOCUMENT>`;
  const sections = [];
  const c = createStructureCollector("admin_code");
  assert.ok(collectSectionsFromXml(xml, "admin_code", sections, (e) => { throw e; }, c.forFile()));
  const st = c.finish(sections, "x");
  const by = Object.fromEntries(st.sections.map((x, i) => [sections[i].citation, x]));
  assert.equal(by["Chapter 1"].pictures, undefined);
  assert.equal(by["Chapter 1"].subsections, undefined);
  assert.equal(by["§ 27-1"].pictures, 2);
  // The two Subsections are read now; the level nested in 27-1.2 is not, and is the one counted.
  assert.equal(by["§ 27-1"].subsections, 1);
  assert.equal(by["§ 27-2"].pictures, undefined);
  assert.equal(by["§ 27-2"].subsections, undefined);
  // Each Subsection's PARA says something other than its heading, so both are kept.
  assert.equal(sections.find((x) => x.citation === "§ 27-1").text, "The scope. 27-1.1 General. More text 27-1.2 Other. Even more.");
  assert.equal(sections.find((x) => x.citation === "§ 27-2").text, "Plain text.");
});

test("site facts: each book's own pages speak for that book only, even when the two books' dates differ", () => {
  const stub = (corpus, indexedAt) => ({ corpus, book: BOOKS[corpus], version: { currentThrough: "Current through Local Law 2026/165, enacted November 19, 2026,", indexedAt } });
  const same = siteFacts([stub("charter", "2026-11-22T11:05:49Z"), stub("admin_code", "2026-11-22T11:05:58Z")], DATA_SOURCES);
  const differ = siteFacts([stub("charter", "2026-11-22T11:05:49Z"), stub("admin_code", "2026-12-03T11:05:58Z")], DATA_SOURCES);
  for (const { perBook } of [same, differ]) {
    for (const c of ["charter", "admin_code"]) assert.equal(perBook.get(c).books, undefined, `${c}'s pages carry no list of books`);
    assert.match(bottomBox(perBook.get("charter")), /The official Charter is at <a href="https:\/\/codelibrary\.amlegal\.com\/codes\/newyorkcity\/latest\/NYCcharter\/0-0-0-1">American Legal Publishing<\/a>\./);
    assert.doesNotMatch(bottomBox(perBook.get("charter")), /Administrative Code/);
  }
  // A Charter page's line is the Charter's alone; the shared pages give both when they differ.
  assert.equal(currentLine(differ.perBook.get("charter")), "American Legal Publishing's text is current through Local Law 2026/165, enacted November 19, 2026. BetaNYC's copy last changed on November 22, 2026.");
  assert.equal(currentLine(differ.perBook.get("admin_code")), "American Legal Publishing's text is current through Local Law 2026/165, enacted November 19, 2026. BetaNYC's copy last changed on December 3, 2026.");
  assert.equal(currentLine(same.shared), currentLine(same.perBook.get("charter")), "one line when the books agree");
  assert.equal(
    currentLine(differ.shared),
    "The Charter: American Legal Publishing's text is current through Local Law 2026/165, enacted November 19, 2026. BetaNYC's copy last changed on November 22, 2026. The Administrative Code: American Legal Publishing's text is current through Local Law 2026/165, enacted November 19, 2026. BetaNYC's copy last changed on December 3, 2026."
  );
  assert.match(bottomBox(differ.shared), /the official Charter<\/a> and <a [^>]*>the official Administrative Code<\/a>/);
  // One book: no list, as before.
  const one = siteFacts([stub("charter", "2026-11-22T11:05:49Z")], DATA_SOURCES);
  assert.equal(one.shared.books, undefined);
  assert.equal(one.shared, one.perBook.get("charter"));
});

test("copy links: a reference into the other book never stays on the page, even when the id is in both", () => {
  const c = { id: "c" };
  const local = { id: "0-0-0-9", slug: "9", chapter: c, path: "/charter/sections/9", fullCitation: "NYC Charter § 9" };
  const remote = { id: "0-0-0-9", slug: "9-1", path: "/admin-code/sections/9-1", fullCitation: "NYC Administrative Code § 9-1" };
  const book = { corpus: "charter", byId: new Map([["0-0-0-9", local]]), others: new Map([["admin_code", { corpus: "admin_code", byId: new Map([["0-0-0-9", remote]]) }]]) };
  const s = { id: "0-0-0-1", chapter: c };
  const linkFor = copyLinkFor(s, (t) => t.chapter === c, book);
  assert.deepEqual(linkFor({ corpus: "charter", id: "0-0-0-9" }), { href: "#s-9", label: "NYC Charter § 9" });
  assert.deepEqual(linkFor({ corpus: "admin_code", id: "0-0-0-9" }), { href: "/admin-code/sections/9-1", label: "NYC Administrative Code § 9-1" });
});

test("same-numbered sections: told apart by heading, then chapter, then the publisher's group, then the id", () => {
  const groups = { g1: { heading: "REFERENCE STANDARD RS 5" }, g2: { heading: "REFERENCE STANDARD RS 6" }, top: { heading: "Title 27" } };
  const ch = { longName: "Title 27, Chapter 1: Building Code" };
  const a = { id: "0-0-0-1", citation: "SECTION 1 – GENERAL", title: "", chapter: ch, structure: { parents: ["top", "g1"] } };
  const b = { id: "0-0-0-2", citation: "SECTION 1 – GENERAL", title: "", chapter: ch, structure: { parents: ["top", "g2"] } };
  assert.equal(tellApart(a, [a, b], groups), "REFERENCE STANDARD RS 5");
  const c2 = { ...b, chapter: { longName: "Title 28, Chapter 11: Electrical Code" } };
  assert.equal(tellApart(a, [a, c2], groups), "Title 27, Chapter 1: Building Code");
  const d = { ...b, structure: { parents: ["top", "g1"] } };
  assert.equal(tellApart(a, [a, d], groups), "American Legal id 0-0-0-1");
  assert.equal(lineOf({ citation: "§ 220.14", title: "" }), "§ 220.14");
});

test("subdivision anchors that differ only in case get names that differ", () => {
  const blocks = [
    { type: "subdivision", anchor: "(D)(ii)", label: "(ii)" },
    { type: "subdivision", anchor: "(D)(II)", label: "(II)" },
    { type: "subdivision", anchor: "(a)", label: "(a)" },
  ];
  const notes = anchorCaseNotes(blocks);
  assert.equal(notes.get("(D)(ii)"), "small letters");
  assert.equal(notes.get("(D)(II)"), "capital letters");
  assert.equal(notes.get("(a)"), undefined);
  const same = anchorCaseNotes([
    { type: "subdivision", anchor: "(d)(ii)", label: "(ii)" },
    { type: "subdivision", anchor: "(D)(ii)", label: "(ii)" },
  ]);
  assert.deepEqual([same.get("(d)(ii)"), same.get("(D)(ii)")], ["1 of 2", "2 of 2"]);
});

test("404: an id in one book goes there; an id in both books, with no book in the path, offers both", () => {
  const r = { charter: { "0-0-0-5": "/charter/sections/5", "0-0-0-7": "/charter/sections/7" }, "admin-code": { "0-0-0-5": "/admin-code/sections/1-1", "0-0-0-8": "/admin-code/sections/1-2" } };
  assert.equal(redirectFor("/0-0-0-7", r), "/charter/sections/7");
  assert.equal(redirectFor("/0-0-0-8", r), "/admin-code/sections/1-2");
  assert.equal(redirectFor("/0-0-0-5", r), null);
  assert.deepEqual(redirectChoices("/0-0-0-5", r), [
    { book: "charter", to: "/charter/sections/5" },
    { book: "admin-code", to: "/admin-code/sections/1-1" },
  ]);
  assert.equal(redirectFor("/NYCadmin/0-0-0-5", r), "/admin-code/sections/1-1");
  assert.equal(redirectFor("/charter/sections/5-0-0-0-5", r), "/charter/sections/5");
  assert.equal(redirectFor("/admin-code/0-0-0-7", r), null, "the path names a book that lacks the id");
});
