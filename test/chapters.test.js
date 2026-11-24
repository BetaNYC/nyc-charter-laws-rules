// list_titles and get_title (live check of 0.6.0, 2026-11-19).
//
// Through 0.6.0:
//   - get_title returned only a chapter's own heading record: "Chapter 70" gave one line, and
//     "Title 6" (the README's example) found nothing, since the index has no title records.
//   - list_titles came in source-file order (Charter Chapter 1 near the end) and showed the
//     index's cut labels: "Chapter 18-" four times for 18-A to 18-D, and "Chapter 1" for
//     several Administrative Code chapters with nothing to tell them apart.
// Now a chapter is its heading record plus the records after it up to the next chapter heading
// (the index keeps each source file in document order), labels come from the heading, and
// chapters are sorted. corpus.ts, "chapters and titles", has the details.
//
// Runs against the committed index. Every assertion holds both for an index built before the
// extractCitation fix (cut labels) and for one built after it, and for an index built before
// #78 (no `level`) and after it. The daily refresh runs npm test on that day's law, so nothing
// here pins a count, a heading or a last section: expected values are worked out from the index
// file itself (readIndex), and only the shape is fixed. A new chapter or section must never turn
// the refresh red.
//
// Requires: npm run build (dist/ must exist). Guaranteed by "pretest".

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { listTitles, getTitle, compareLabels, resolveIndexDir } from "../dist/corpus.js";
import { callTool } from "../dist/tools.js";

/** The index file the server reads, in its own order: [{ citation, heading, level?, ... }]. */
const indexCache = {};
function readIndex(corpus) {
  return (indexCache[corpus] ??= JSON.parse(readFileSync(join(resolveIndexDir(), `${corpus}.json`), "utf8")));
}
// A record that opens a chapter: its heading starts "Chapter N" (or "Title N"), and it is not a
// part inside one (a record built since #78 says its level; "CHAPTER 1 – GENERAL" in a reference
// standard is an Appendix, not a chapter).
const opensChapter = (s) => (!s.level || s.level === "Chapter") && /^(chapter|title)\s+[A-Za-z]?\d/i.test(s.heading);
/** The index records from the chapter record whose heading starts `heading` to the record before the next chapter. */
function chapterSpan(corpus, heading) {
  const all = readIndex(corpus);
  const i = all.findIndex((s) => opensChapter(s) && s.heading.toLowerCase().startsWith(heading.toLowerCase()));
  assert.ok(i >= 0, `${heading} is in the ${corpus} index`);
  let j = i + 1;
  while (j < all.length && !opensChapter(all[j]) && all[j].level !== "Chapter" && all[j].level !== "Section") j++;
  return all.slice(i, j);
}
const esc = (t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const textOf = (r) => r.content.map((c) => c.text).join("\n");
const body = (t) => t.split(/\n\n(?:Source: |BetaNYC modified this data: |---\n|⚠️)/)[0];

describe("compareLabels", () => {
  test("numbers in order, a lettered number after its base", () => {
    const sorted = ["18-A", "2", "1", "18", "10", "2-A", "18-D", "3", "19"].sort(compareLabels);
    assert.deepEqual(sorted, ["1", "2", "2-A", "3", "10", "18", "18-A", "18-D", "19"]);
    assert.ok(compareLabels("§ 16-501", "§ 16-1000") < 0);
  });
});

describe("list_titles", () => {
  test("Charter: every chapter once, in order, with its whole number", () => {
    const labels = listTitles("charter").map((t) => t.citation);
    // Every chapter record in the index, each once, labeled with the whole number its heading
    // starts with ("Chapter 18-A", never "Chapter 18-"), in the book's order.
    const expected = readIndex("charter").filter(opensChapter).map((s) => `Chapter ${/^chapter\s+(\S+?):?(?:\s|$)/i.exec(s.heading)[1]}`);
    assert.ok(expected.length > 0);
    assert.deepEqual([...labels].sort(), [...expected].sort(), "each chapter record once");
    assert.deepEqual(labels, [...labels].sort(compareLabels), "in order");
    assert.equal(labels[0], "Chapter 1");
    assert.ok(!labels.some((l) => l.endsWith("-")), "no cut label like 'Chapter 18-'");
    const lettered = labels.filter((l) => /^Chapter 18(-[A-Z])?$/.test(l));
    assert.equal(lettered[0], "Chapter 18", "a lettered chapter comes after its base");
    assert.ok(lettered.length >= 2, "the Charter's lettered 18-A… chapters are listed whole");
    for (const t of listTitles("charter")) assert.ok(t.heading.startsWith(t.citation), `${t.citation} — ${t.heading}`);
  });

  test("Charter answer starts with how many there are", async () => {
    const t = body(textOf(await callTool("list_titles", { corpus: "charter" })));
    const [a, b] = listTitles("charter");
    assert.match(t, new RegExp(`^${listTitles("charter").length} chapters, in order\\.\\n\\n${esc(`${a.citation} — ${a.heading}`)}\\n${esc(`${b.citation} — ${b.heading}`)}\\n`));
  });

  test("Administrative Code: chapters sharing a number are told apart by their section range", () => {
    const titles = listTitles("admin_code");
    assert.ok(titles.length > 0);
    const labels = titles.map((t) => t.citation);
    // No label shown twice, except where the publisher itself numbered two chapters alike and
    // marked both with "*" (July 2026: two "Chapter 43" in Title 21, each holding only
    // § 21-1015). That is the publisher's numbering, so it must not turn the refresh red.
    const twice = titles.filter((t) => labels.indexOf(t.citation) !== labels.lastIndexOf(t.citation));
    assert.deepEqual(twice.filter((t) => !t.heading.trim().endsWith("*")).map((t) => `${t.citation} — ${t.heading}`), [], "no label shown twice");
    assert.match(labels[0], /^Chapter 1 \(§ 1-\S+ to § 1-\S+\)$/);
    // Chapters that share a number are told apart by the range of their numbered sections (a
    // chapter with no "§" sections keeps its plain label, and the labels stay unique, above).
    const byNumber = new Map();
    for (const l of labels) {
      const n = /^Chapter (\S+)/.exec(l)?.[1];
      if (n) byNumber.set(n, [...(byNumber.get(n) ?? []), l]);
    }
    const shared = [...byNumber.values()].filter((v) => v.length > 1).flat();
    assert.ok(shared.length > 1, "several Administrative Code chapters share a number");
    for (const l of shared) assert.match(l, /^Chapter \S+( \(§ \S+( to § \S+)?\))?$/, l);
    for (const v of byNumber.values()) {
      if (v.length > 1) assert.ok(v.filter((l) => !/ \(§ /.test(l)).length <= 1, `at most one plain label among ${v.join(", ")}`);
    }
  });
});

describe("get_title", () => {
  test("a Charter chapter lists its sections, in order", async () => {
    // Chapter 70's heading record, then every record after it in the index up to the next chapter.
    const span = chapterSpan("charter", "Chapter 70:");
    assert.ok(span.length >= 2, "the chapter has sections");
    const t = body(textOf(await callTool("get_title", { corpus: "charter", title: "Chapter 70" })));
    assert.equal(
      t,
      `${span.length} records: each chapter's heading, then its sections in order.\n\n` +
        span.map((s) => `${s.citation} — ${s.heading}`).join("\n"),
    );
    assert.equal(span[0].citation, "Chapter 70");
    assert.ok(span.slice(1).every((s) => s.citation.startsWith("§ ")), "then its sections");
  });

  test("Charter Chapter 1 is the Mayor's chapter, to the record before Chapter 2, and nothing from Chapter 1-something or 10", () => {
    const records = getTitle("charter", "Chapter 1");
    assert.match(records[0].heading, /^Chapter 1: /);
    assert.deepEqual(records.map((s) => s.id), chapterSpan("charter", "Chapter 1:").map((s) => s.id), "the chapter's records in index order, all of them");
    assert.ok(records.slice(1).every((s) => !/^chapter/i.test(s.heading)));
  });

  test("a lettered chapter: 'Chapter 18-A' is that chapter, and 'Chapter 18-' is none", () => {
    const records = getTitle("charter", "chapter 18-a");
    const span = chapterSpan("charter", "Chapter 18-A:");
    assert.equal(records[0].citation, "Chapter 18-A");
    assert.equal(records[0].heading, span[0].heading);
    assert.equal(records[1].citation, span[1].citation);
    assert.deepEqual(getTitle("charter", "Chapter 18-"), []);
    assert.equal(getTitle("charter", "Chapter 18").filter((s) => /^Chapter/.test(s.heading)).length, 1);
  });

  test("Administrative Code 'Title 6' (the README's example) lists every chapter numbered 6-…", async () => {
    const records = getTitle("admin_code", "Title 6");
    const heads = records.filter((s) => s.heading.startsWith("Chapter"));
    assert.ok(heads.length >= 2, "more than one chapter");
    assert.match(heads[0].citation, /^Chapter 1 \(§ 6-101 to /);
    for (const s of records) if (s.citation.startsWith("§ ")) assert.match(s.citation, /^§ 6-/);
    const t = body(textOf(await callTool("get_title", { corpus: "admin_code", title: "Title 24", limit: 3 })));
    assert.match(t, /^Showing 1 to 3 of \d+\. Call again with offset 3 for the next ones\.\n\nChapter 1 \(§ 24-\S+ to § 24-\S+\) — Chapter 1: [^\n]+\n§ 24-\S+ — /);
  });

  test("'Title 3, Chapter 1' narrows to one chapter, the one whose sections are numbered 3-", () => {
    const records = getTitle("admin_code", "Title 3, Chapter 1");
    const heads = records.filter((s) => s.heading.startsWith("Chapter"));
    assert.equal(heads.length, 1);
    assert.match(heads[0].heading, /^Chapter 1: /);
    const numbered = records.filter((s) => s.citation.startsWith("§ "));
    assert.ok(numbered.length > 0 && numbered.every((s) => /^§ 3-/.test(s.citation)));
  });

  test("a Rules title: its chapters when the index records titles, else a hint to ask for a chapter", async () => {
    // Issue #59: an index built since 0.6.3 records each record's title; the committed index
    // may predate that until the next refresh rebuilds it, so both shapes must pass.
    const t = textOf(await callTool("get_title", { corpus: "rules", title: "Title 15" }));
    assert.match(t, /legal advice/i);
    const titled = readIndex("rules").filter((s) => s.titleNumber === "15");
    if (titled.length === 0) {
      assert.match(t, /^No sections found for "Title 15" in rules\. This copy of the index does not record Rules titles/);
      return;
    }
    const records = getTitle("rules", "Title 15");
    assert.ok(records.length > 0 && records.every((s) => s.titleNumber === "15"), "only Title 15's records");
    assert.ok(records.every((s, i) => i === 0 || s.level !== "Chapter" || /^Title 15, Chapter /.test(s.citation)), "chapters labeled with their title");
    assert.match(body(t), /^(\d+ records|Showing 1 to \d+ of \d+)[^\n]*\n\nTitle 15: [^\n]+\nTitle 15, Chapter /);
  });

  test("Administrative Code 'Title 16' leaves out Titles 16-A and 16-B when the index records titles", () => {
    const records = getTitle("admin_code", "Title 16");
    assert.ok(records.length > 0);
    if (!readIndex("admin_code").some((s) => s.titleNumber)) return; // built before 0.6.3
    assert.ok(records.every((s) => s.titleNumber === "16"), records.filter((s) => s.titleNumber !== "16").map((s) => s.citation).slice(0, 5).join(", "));
    const lettered = readIndex("admin_code").filter((s) => /^16-[A-Z]$/.test(s.titleNumber ?? ""));
    for (const t of new Set(lettered.map((s) => s.titleNumber))) {
      assert.deepEqual(getTitle("admin_code", `Title ${t}`).map((s) => s.id).sort(), getTitle("admin_code", `Title ${t}`).filter((s) => s.titleNumber === t).map((s) => s.id).sort());
    }
  });

  test("a query that is not a chapter or title still matches records by prefix, whole tokens only", () => {
    // A section of Chapter 70 ("§ 2800" today), and the records whose citation is exactly it:
    // "§ 2800" never finds "§ 28001".
    const c = chapterSpan("charter", "Chapter 70:")[1].citation;
    const records = getTitle("charter", c);
    assert.ok(records.length > 0);
    assert.deepEqual(records.map((s) => s.citation), readIndex("charter").filter((s) => s.citation === c || new RegExp(`^${esc(c)}(?![\\w.-])`, "i").test(s.heading)).map((s) => s.citation));
  });
});
