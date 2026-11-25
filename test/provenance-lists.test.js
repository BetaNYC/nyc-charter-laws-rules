// Every law-text answer names its source, publisher, a link and the date of the index it came
// from (issues #40, #41), and every list says how much of how many it shows and how to get
// the rest (issue #42). Run against the committed index, the largest fixture there is, so
// only loose bounds are checked: the daily refresh runs this suite on fresh text.
//
// Requires: npm run build (dist/ must exist). Guaranteed by "pretest".

import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
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

// The source line's opening for an answer from the law text (round 2 of #49): it says BetaNYC
// changed the text, as about_data does, so a reader can tell it from the publisher's own copy.
const MODIFIED =
  "BetaNYC modified this data: converted by BetaNYC from the publisher's bulk XML files: line breaks are collapsed, so tables run together; " +
  "the publisher's editing markers are removed and character codes decoded; math signs and Greek letters set in the old Symbol font are changed to the characters the font shows (³ to ≥); citations are worked out by BetaNYC from headings and can be wrong or cut short";
const SNIPPETS = "; search snippets are cut at 400 characters";

// use: "text" (law text), "snippets" (search results), "dates" (get_version: a plain Source line).
function assertSourced(t, corpora, use = "text") {
  const v = getVersions();
  const lines = t.split("\n");
  for (const c of corpora) {
    const line = lines.find((l) => /^(Source: |BetaNYC modified this data: )/.test(l) && l.includes(`/${LINK[c]}/`));
    assert.ok(line, `no source line for ${c}`);
    assert.ok(line.includes(`As of ${v[c].indexedAt} (the date of the copy`), line);
    if (use === "dates") {
      assert.match(line, /^Source: .*\(American Legal Publishing\)\./);
      assert.match(line, /Link: https:\/\/codelibrary\.amlegal\.com\/codes\/newyorkcity\/latest\/NYC\w+\/0-0-0-1$/);
    } else {
      assert.ok(line.startsWith(`${MODIFIED}${use === "snippets" ? SNIPPETS : ""}. This copy should not be considered the official record. `), line);
      assert.match(line, /Official record: .*\(American Legal Publishing\), https:\/\/codelibrary\.amlegal\.com\/codes\/newyorkcity\/latest\/NYC\w+\/0-0-0-1$/);
    }
    // The publisher's own "current through" line, exactly as given, right after the copy date.
    const next = lines[lines.indexOf(line) + 1];
    assert.equal(next, `The publisher's own "current through" line for it, as given: "${v[c].currentThrough.trim()}"`);
  }
  assert.match(t, /legal advice/i, "the disclaimer is still there");
  assert.ok(t.search(/^(Source: |BetaNYC modified)/m) < t.lastIndexOf("legal advice"), "the source comes before the disclaimer");
}

test("every law-text answer names its source and the index date", { skip }, async () => {
  assertSourced(await text("get_section", { citation: "§ 259", corpus: "charter" }), ["charter"]);
  assertSourced(await text("list_titles", { corpus: "admin_code" }), ["admin_code"]);
  assertSourced(await text("get_title", { corpus: "charter", title: "Chapter 1" }), ["charter"]);
  assertSourced(await text("get_version", {}), ["charter", "admin_code", "rules"], "dates");
  assertSourced(await text("search", { query: "sinking fund", corpus: "charter" }), ["charter"], "snippets");
});

test("DATA-SOURCES.json lists wrong or cut-short citations as a known gap of every document", () => {
  const ds = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "DATA-SOURCES.json"), "utf8"));
  for (const src of ds.sources) {
    assert.ok(src.coverage.known_gaps.some((g) => /citations .*can be wrong or cut short/i.test(g)), src.id);
  }
});

test("the current-through line matches get_version's, character for character", { skip }, async () => {
  const v = getVersions();
  const version = await text("get_version", {});
  const section = await text("get_section", { citation: "§ 259", corpus: "charter" });
  const raw = v.charter.currentThrough.trim();
  assert.ok(version.includes(raw), "get_version shows the raw line");
  assert.ok(section.includes(`as given: "${raw}"`), "and so does every source line");
});

test("law-text answers say BetaNYC changed the text; get_version's lines do not", { skip }, async () => {
  for (const [tool, args] of [
    ["search", { query: "sinking fund", corpus: "charter" }],
    ["get_section", { citation: "§ 259", corpus: "charter" }],
    ["list_titles", { corpus: "charter" }],
    ["get_title", { corpus: "charter", title: "Chapter 1" }],
  ]) {
    const t = await text(tool, args);
    assert.match(t, /^BetaNYC modified this data: /m, tool);
    assert.doesNotMatch(t, /^Source: /m, `${tool}: no plain Source line`);
  }
  assert.doesNotMatch(await text("get_version", {}), /^BetaNYC modified/m);
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
  assert.match(t, /^No titles found for rules\. Searched: the Rules of the City of New York\.\n\nBetaNYC modified this data: .*\. As of 2026-01-01T00:00:00\.000Z \(the date of the copy this server answers from\)\. Official record: Rules of the City of New York, bulk XML download \(American Legal Publishing\), https:/);
  assert.match(t, /\nThe publisher's own "current through" line for it, as given: "Synthetic search fixture \(test\/search-fallback\.test\.js\), not law text\."\n/);
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

// get_title had no test of its page size or of limit and offset (the #49 review: changing its
// default from 200 to 100 passed every test). "Chapter" in the Rules matches every chapter
// record, over 700 today; only loose bounds on the total, since the daily refresh runs this.
test("get_title: default page of 200, then limit and offset", { skip }, async () => {
  const records = (t) => t.split("\n").filter((l) => / — /.test(l) && !/^(Source|BetaNYC|The publisher)/.test(l));
  const first = await text("get_title", { corpus: "rules", title: "Chapter" });
  const m = /^Showing 1 to 200 of (\d+)\. Call again with offset 200 for the next ones\.$/m.exec(first);
  assert.ok(m, first.slice(0, 200));
  const total = Number(m[1]);
  assert.ok(total > 400, `${total} records`);
  assert.equal(records(first).length, 200);

  const all = records(await text("get_title", { corpus: "rules", title: "Chapter", limit: 1000 }));
  assert.equal(all.length, total);
  assert.deepEqual(records(first), all.slice(0, 200));

  const five = await text("get_title", { corpus: "rules", title: "Chapter", limit: 5 });
  assert.match(five, /^Showing 1 to 5 of \d+\. Call again with offset 5 for the next ones\.$/m);
  assert.deepEqual(records(five), all.slice(0, 5));

  const next = await text("get_title", { corpus: "rules", title: "Chapter", offset: 200, limit: 3 });
  assert.match(next, new RegExp(`^Showing 201 to 203 of ${total}\\. Call again with offset 203 for the next ones\\.$`, "m"));
  assert.deepEqual(records(next), all.slice(200, 203));

  const last = await text("get_title", { corpus: "rules", title: "Chapter", offset: total - 2 });
  assert.match(last, new RegExp(`^Showing ${total - 1} to ${total} of ${total}\\.$`, "m"));
  assert.deepEqual(records(last), all.slice(-2));

  const beyond = await text("get_title", { corpus: "rules", title: "Chapter", offset: total });
  assert.match(beyond, new RegExp(`Nothing at offset ${total}: there are ${total} in all`));
  assert.equal((await callTool("get_title", { corpus: "rules", title: "Chapter", limit: 1001 })).isError, true);
  assert.equal((await callTool("get_title", { corpus: "rules", title: "Chapter", offset: -1 })).isError, true);
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
