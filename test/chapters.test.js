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
// extractCitation fix (cut labels) and for one built after it.
//
// Requires: npm run build (dist/ must exist). Guaranteed by "pretest".

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { listTitles, getTitle, compareLabels } from "../dist/corpus.js";
import { callTool } from "../dist/tools.js";

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
    assert.equal(labels.length, 84);
    assert.equal(labels[0], "Chapter 1");
    assert.equal(new Set(labels).size, labels.length, "no label shown twice");
    assert.ok(!labels.some((l) => l.endsWith("-")), "no cut label like 'Chapter 18-'");
    const i = labels.indexOf("Chapter 18");
    assert.deepEqual(labels.slice(i, i + 5), ["Chapter 18", "Chapter 18-A", "Chapter 18-B", "Chapter 18-C", "Chapter 18-D"]);
    for (const t of listTitles("charter")) assert.ok(t.heading.startsWith(t.citation), `${t.citation} — ${t.heading}`);
  });

  test("Charter answer starts with how many there are", async () => {
    const t = body(textOf(await callTool("list_titles", { corpus: "charter" })));
    assert.match(t, /^84 chapters, in order\.\n\nChapter 1 — Chapter 1: Mayor\nChapter 2 — Chapter 2: Council\n/);
  });

  test("Administrative Code: chapters sharing a number are told apart by their section range", () => {
    const titles = listTitles("admin_code");
    assert.equal(titles.length, 350);
    const labels = titles.map((t) => t.citation);
    assert.equal(new Set(labels).size, labels.length, "no label shown twice");
    assert.equal(labels[0], "Chapter 1 (§ 1-101 to § 1-114)");
    const mayor = titles.find((t) => t.heading === "Chapter 1: Mayor");
    assert.match(mayor.citation, /^Chapter 1 \(§ 3-101 to § 3-\d+\)$/);
  });
});

describe("get_title", () => {
  test("a Charter chapter lists its sections, in order", async () => {
    const t = body(textOf(await callTool("get_title", { corpus: "charter", title: "Chapter 70" })));
    assert.equal(
      t,
      "3 records: each chapter's heading, then its sections in order.\n\n" +
        "Chapter 70 — Chapter 70: City Government In the Community\n" +
        "§ 2800 — Section 2800. Community boards.\n" +
        "§ 2801 — Section 2801. Actions of community boards.",
    );
  });

  test("Charter Chapter 1 is the Mayor's chapter, § 3 to § 20-w, and nothing from Chapter 1-something or 10", () => {
    const records = getTitle("charter", "Chapter 1");
    assert.equal(records[0].heading, "Chapter 1: Mayor");
    const cites = records.slice(1).map((s) => s.citation);
    assert.equal(cites[0], "§ 3");
    assert.equal(cites[cites.length - 1], "§ 20-w");
    assert.ok(records.slice(1).every((s) => !/^chapter/i.test(s.heading)));
  });

  test("a lettered chapter: 'Chapter 18-A' is that chapter, and 'Chapter 18-' is none", () => {
    const records = getTitle("charter", "chapter 18-a");
    assert.equal(records[0].citation, "Chapter 18-A");
    assert.equal(records[0].heading, "Chapter 18-A: Civilian Complaint Review Board");
    assert.equal(records[1].citation, "§ 440");
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
    assert.match(t, /^Showing 1 to 3 of \d+\. Call again with offset 3 for the next ones\.\n\nChapter 1 \(§ 24-101 to § 24-\d+\) — Chapter 1: Air Pollution Control\n§ 24-101 — /);
  });

  test("'Title 3, Chapter 1' narrows to the Mayor's chapter", () => {
    const heads = getTitle("admin_code", "Title 3, Chapter 1").filter((s) => s.heading.startsWith("Chapter"));
    assert.deepEqual(heads.map((s) => s.heading), ["Chapter 1: Mayor"]);
  });

  test("a title in the Rules is not found, and the answer says to ask for a chapter", async () => {
    const t = textOf(await callTool("get_title", { corpus: "rules", title: "Title 15" }));
    assert.match(t, /^No sections found for "Title 15" in rules\. Only the Administrative Code is listed by title here/);
    assert.match(t, /legal advice/i);
  });

  test("a query that is not a chapter or title still matches records by prefix", () => {
    const records = getTitle("charter", "§ 2800");
    assert.deepEqual(records.map((s) => s.citation), ["§ 2800"]);
  });
});
