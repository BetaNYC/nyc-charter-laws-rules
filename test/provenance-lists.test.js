// Every law-text answer names its source, publisher, a link and the date of the index it came
// from (issues #40, #41), and every list says how much of how many it shows and how to get
// the rest (issue #42). Run against the committed index, the largest fixture there is, so
// only loose bounds are checked: the daily refresh runs this suite on fresh text.
//
// Requires: npm run build (dist/ must exist). Guaranteed by "pretest".

import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { callTool, page } from "../dist/tools.js";
import { getVersions } from "../dist/corpus.js";

const PRESENT = existsSync(join(dirname(fileURLToPath(import.meta.url)), "..", "data", "index", "json", "charter.json"));
const skip = !PRESENT && "corpus index not built";
const text = async (name, args) => {
  const r = await callTool(name, args);
  assert.notEqual(r.isError, true, r.content[0].text.slice(0, 300));
  return r.content[0].text;
};
const LINK = { charter: "NYCcharter", admin_code: "NYCadmin", rules: "NYCrules" };

function assertSourced(t, corpora) {
  const v = getVersions();
  for (const c of corpora) {
    const line = t.split("\n").find((l) => l.startsWith("Source: ") && l.includes(`/${LINK[c]}/`));
    assert.ok(line, `no source line for ${c}`);
    assert.match(line, /\(American Legal Publishing\)\./);
    assert.ok(line.includes(`As of ${v[c].indexedAt} (the date of the copy`), line);
    assert.match(line, /Link: https:\/\/codelibrary\.amlegal\.com\/codes\/newyorkcity\/latest\/NYC\w+\/0-0-0-1$/);
  }
  assert.match(t, /legal advice/i, "the disclaimer is still there");
  assert.ok(t.indexOf("Source: ") < t.lastIndexOf("legal advice"), "the source comes before the disclaimer");
}

test("every law-text answer names its source and the index date", { skip }, async () => {
  assertSourced(await text("get_section", { citation: "§ 259", corpus: "charter" }), ["charter"]);
  assertSourced(await text("list_titles", { corpus: "admin_code" }), ["admin_code"]);
  assertSourced(await text("get_title", { corpus: "charter", title: "Chapter 1" }), ["charter"]);
  assertSourced(await text("get_version", {}), ["charter", "admin_code", "rules"]);
  assertSourced(await text("search", { query: "sinking fund", corpus: "charter" }), ["charter"]);
});

test("search says how many matched in all, and that snippets are cut", { skip }, async () => {
  const t = await text("search", { query: "the", limit: 50 });
  const m = /Showing 50 of (\d+) matching sections, best first\. To see others, narrow the query, or search one corpus\./.exec(t);
  assert.ok(m && Number(m[1]) > 50, "count line");
  assert.match(t, /Snippets are cut at 400 characters \(marked …\); get_section returns a section's full text\./);
  const small = await text("search", { query: "the", limit: 3 });
  assert.match(small, /Showing 3 of \d+ .*raise limit \(max 50\)/);
});

test("list_titles: default 200, says the total, pages with offset to the end", { skip }, async () => {
  const first = await text("list_titles", { corpus: "rules" });
  const m = /^Showing 1 to 200 of (\d+)\. Call again with offset 200 for the next ones\.$/m.exec(first);
  assert.ok(m, first.slice(0, 200));
  const total = Number(m[1]);
  assert.ok(total > 200);
  const lastOffset = total - 1;
  const last = await text("list_titles", { corpus: "rules", offset: lastOffset, limit: 5 });
  assert.match(last, new RegExp(`^Showing ${total} to ${total} of ${total}\\.$`, "m"));
  const beyond = await text("list_titles", { corpus: "rules", offset: total + 10 });
  assert.match(beyond, new RegExp(`Nothing at offset ${total + 10}: there are ${total} in all`));
  const refused = await callTool("list_titles", { corpus: "rules", limit: 1001 });
  assert.equal(refused.isError, true);
});

test("a short list carries no count line", { skip }, async () => {
  const t = await text("get_title", { corpus: "charter", title: "Chapter 1" });
  assert.doesNotMatch(t, /^Showing /m);
});

test("get_section's list of matches is capped at 25 and says how many there are", { skip }, async () => {
  const t = await text("get_section", { citation: "Chapter 1" });
  const m = /^Showing 1 to 25 of (\d+)\. Narrow it with 'corpus'/m.exec(t);
  assert.ok(m && Number(m[1]) > 25, "cap line");
  assert.equal(t.split("\n").filter((l) => /^\[(CHARTER|ADMIN_CODE|RULES)\] /.test(l)).length, 25);
});

test("page(): the count line and the next offset", () => {
  const items = Array.from({ length: 7 }, (_, i) => i);
  assert.deepEqual(page(items, 0, 10), { shown: items, note: null });
  assert.deepEqual(page(items, 0, 3), { shown: [0, 1, 2], note: "Showing 1 to 3 of 7. Call again with offset 3 for the next ones." });
  assert.deepEqual(page(items, 6, 3), { shown: [6], note: "Showing 7 to 7 of 7." });
  assert.equal(page(items, 9, 3).note, "Nothing at offset 9: there are 7 in all. Call again with a smaller offset.");
});
