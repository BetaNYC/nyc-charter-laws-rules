// Every law-text answer names its source, publisher, a link and the date of the index it came
// from (issues #40, #41), and every list says how much of how many it shows and how to get
// the rest (issue #42). Run against the committed index, the largest fixture there is, so
// only loose bounds are checked: the daily refresh runs this suite on fresh text.
//
// Requires: npm run build (dist/ must exist). Guaranteed by "pretest".

import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
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
    // The publisher's own "current through" line, labeled, right after the copy date.
    const lines = t.split("\n");
    const next = lines[lines.indexOf(line) + 1];
    const through = v[c].currentThrough.trim().replace(/[\s,.;:]+$/, "");
    assert.equal(next, `The publisher's own "current through" line for it: ${through}.`);
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

test("a not-found answer names where it looked, with the source and dates", { skip }, async () => {
  const ALL = ["charter", "admin_code", "rules"];
  const cases = [
    ["search", { query: "zzqxvj nonexistentword" }, /^No results found for "zzqxvj nonexistentword"\. Searched: the New York City Charter, the New York City Administrative Code and the Rules of the City of New York\./, ALL],
    ["search", { query: "zzqxvj nonexistentword", corpus: "rules" }, /^No results found for .*\. Searched: the Rules of the City of New York\./, ["rules"]],
    ["get_section", { citation: "§ 99999-zz" }, /^Section not found: "§ 99999-zz"\. Searched: the New York City Charter, /, ALL],
    ["get_section", { citation: "§ 99999-zz", corpus: "admin_code" }, /^Section not found: .*\. Searched: the New York City Administrative Code\./, ["admin_code"]],
    ["get_title", { corpus: "charter", title: "Chapter 9999" }, /^No sections found for "Chapter 9999" in charter\. Searched: the New York City Charter\./, ["charter"]],
  ];
  for (const [tool, args, first, corpora] of cases) {
    const t = await text(tool, args);
    assert.match(t, first, tool);
    assertSourced(t, corpora);
    for (const c of ALL.filter((x) => !corpora.includes(x))) {
      assert.ok(!t.includes(`/${LINK[c]}/`), `${tool}: no source line for ${c}, which was not searched`);
    }
  }
});

// list_titles never comes back empty on the real index, so this one runs on the synthetic
// fixture (its headings start with "§", none with "Chapter" or "Title"), in a child process
// because the index directory is fixed at startup.
test("list_titles with nothing to list still names the source and dates (fixture index)", () => {
  const root = join(dirname(fileURLToPath(import.meta.url)), "..");
  const toolsUrl = pathToFileURL(join(root, "dist", "tools.js")).href;
  const code = `const t = await import(${JSON.stringify(toolsUrl)});
    const r = await t.callTool("list_titles", { corpus: "rules" });
    console.log(JSON.stringify(r));`;
  const env = { ...process.env, NYC_LAWS_INDEX_DIR: join(root, "test", "fixtures", "search-index") };
  const out = spawnSync(process.execPath, ["--input-type=module", "-e", code], { env, cwd: root, encoding: "utf8" });
  assert.equal(out.status, 0, out.stderr);
  const r = JSON.parse(out.stdout);
  assert.notEqual(r.isError, true);
  const t = r.content[0].text;
  assert.match(t, /^No titles found for rules\. Searched: the Rules of the City of New York\.\n\nSource: Rules of the City of New York, bulk XML download \(American Legal Publishing\)\. As of 2026-01-01T00:00:00\.000Z \(the date of the copy/);
  assert.match(t, /\nThe publisher's own "current through" line for it: Synthetic search fixture \(test\/search-fallback\.test\.js\), not law text\.\n/);
  assert.match(t, /legal advice/i);
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
