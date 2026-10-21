// Plain-language questions (issue #30).
//
// Through 0.3.x, search matched the whole query as one substring, so a natural
// question ("How long can a sidewalk shed stay up?") found nothing even though
// "sidewalk shed" finds the answer. Now, when the phrase matches nothing,
// question words and stopwords are dropped and sections are ranked by how many
// of the remaining terms they contain. The response's first line says so.
//
// Two layers:
//   1. Exact ranks, counts and notice strings, against a tiny synthetic index
//      committed at test/fixtures/search-index/ and served through
//      NYC_LAWS_INDEX_DIR in a child process (the pattern in
//      test/index-dir.test.js). The index is resolved once per process, so the
//      fixture cannot be swapped in-process.
//   2. Behavior only, against the committed law index: the daily refresh runs
//      this suite on freshly fetched text, so nothing here may depend on how
//      many sections match or where one ranks today.
//
// Requires: npm run build (dist/ must exist). Guaranteed by "pretest".
//
// Run with: node --test

import { test, describe, before } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  searchCorpus,
  searchWithFallback,
  queryTerms,
} from "../dist/corpus.js";
import { callTool } from "../dist/tools.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const FIXTURE = join(ROOT, "test", "fixtures", "search-index");
const CORPUS_URL = pathToFileURL(join(ROOT, "dist", "corpus.js")).href;
const TOOLS_URL = pathToFileURL(join(ROOT, "dist", "tools.js")).href;
const CORPUS_PRESENT = existsSync(join(ROOT, "data", "index", "json", "charter.json"));

const SHED_Q = "How long can a sidewalk shed stay up?";
const TANK_Q = "What are building owners required to do about drinking water tanks?";
const WIDENED = /^No section matched every term|^Only \d+ sections? matched every term/;
const RESULT_LINE = /^\[(CHARTER|ADMIN_CODE|RULES)\] /;

const cites = (results) => results.map((s) => `${s.corpus} ${s.citation}`);
const textOf = (res) => res.content.map((c) => c.text).join("\n");
const firstLine = (text) => text.split("\n")[0];

describe("queryTerms", () => {
  test("drops question words and stopwords, keeps the content words in order", () => {
    assert.deepEqual(queryTerms(SHED_Q), ["long", "sidewalk", "shed", "stay"]);
    assert.deepEqual(queryTerms(TANK_Q), [
      "building", "owners", "required", "drinking", "water", "tanks",
    ]);
  });

  test("keeps citations and possessives whole, strips quotes, de-duplicates", () => {
    assert.deepEqual(queryTerms('"28-220.1" owner\'s shed shed'), ["28-220.1", "owner's", "shed"]);
  });

  test("a query of only stopwords has no terms", () => {
    assert.deepEqual(queryTerms("What is the?"), []);
  });
});

// ---------------------------------------------------------------------------
// Layer 1: exact behavior against the committed synthetic fixture.
//
// Fixture sections (all text is synthetic):
//   charter    § 1        Open data.                 "open data portal"
//   admin_code § 9-001    Sidewalk shed permits.     long(er), sidewalk, shed, stay
//   admin_code § 9-002    Scaffolds.                 sidewalk, shed (body)
//   admin_code § 9-003    Definitions.               "established", "belong" only
//   admin_code § 9-004    Drinking water tanks.      all six water-tank terms
//   admin_code § 9-005    Tank cleaning.             tank, drinking, water
//   rules      § 1-01     Sidewalk shed renewals.    sidewalk, shed, stay
//   rules      § 1-02     Stay of enforcement.       stay
// ---------------------------------------------------------------------------

// Each case: [label, kind, query, corpus, limit]. kind "search" calls
// searchWithFallback and searchCorpus; "tool" calls the search tool.
const FIXTURE_CASES = [
  ["shed question", "search", SHED_Q, "all", 10],
  ["tank question", "search", TANK_Q, "all", 10],
  ["tank question, limit 1", "search", TANK_Q, "all", 1],
  ["no term in common", "search", "Which sidewalk tanks?", "all", 10],
  ["phrase", "search", "sidewalk shed", "all", 10],
  ["shed question tool", "tool", SHED_Q, "all", 10],
  ["tank question tool, limit 1", "tool", TANK_Q, "all", 1],
  ["no term in common tool", "tool", "Which sidewalk tanks?", "all", 10],
  ["phrase tool", "tool", "sidewalk shed", "all", 10],
];

let fx;

before(() => {
  const code = `
    const c = await import(${JSON.stringify(CORPUS_URL)});
    const t = await import(${JSON.stringify(TOOLS_URL)});
    const cases = ${JSON.stringify(FIXTURE_CASES)};
    const cite = (s) => s.corpus + " " + s.citation;
    const out = { dir: c.INDEX_DIR };
    for (const [label, kind, query, corpus, limit] of cases) {
      if (kind === "search") {
        const r = c.searchWithFallback(query, corpus, limit);
        out[label] = { ...r, results: r.results.map(cite),
          phrase: c.searchCorpus(query, corpus, limit).map(cite) };
      } else {
        const res = await t.callTool("search", { query, corpus, limit });
        out[label] = res.content.map((x) => x.text).join("\\n");
      }
    }
    console.log(JSON.stringify(out));`;
  const env = { ...process.env, NYC_LAWS_INDEX_DIR: FIXTURE };
  delete env.NYC_CLR_FOOTER;
  const r = spawnSync(process.execPath, ["--input-type=module", "-e", code], {
    env,
    cwd: ROOT,
    encoding: "utf8",
  });
  assert.equal(r.status, 0, r.stderr);
  fx = JSON.parse(r.stdout);
});

describe("searchWithFallback (fixture index)", () => {
  test("the child process served the fixture", () => {
    assert.equal(fx.dir, FIXTURE);
  });

  test("shed question: ranked by terms matched, then heading > citation > body", () => {
    const r = fx["shed question"];
    assert.equal(r.mode, "some-terms");
    assert.deepEqual(r.terms, ["long", "sidewalk", "shed", "stay"]);
    assert.equal(r.allTermResults, 1);
    assert.deepEqual(r.results, [
      "admin_code § 9-001", // 4 terms
      "rules § 1-01", // 3 terms
      "admin_code § 9-002", // 2 terms
      "rules § 1-02", // 1 term
    ]);
  });

  test("a term matches at a word start only: 'established' and 'belong' are not hits", () => {
    assert.ok(!fx["shed question"].results.includes("admin_code § 9-003"));
  });

  test("a trailing plural s is ignored: 'tanks' matches 'tank'", () => {
    const r = fx["tank question"];
    assert.equal(r.mode, "some-terms");
    assert.equal(r.allTermResults, 1);
    assert.deepEqual(r.results, ["admin_code § 9-004", "admin_code § 9-005"]);
  });

  test("all-terms when every returned section has every term", () => {
    const r = fx["tank question, limit 1"];
    assert.equal(r.mode, "all-terms");
    assert.deepEqual(r.results, ["admin_code § 9-004"]);
  });

  test("some-terms with no section matching every term", () => {
    const r = fx["no term in common"];
    assert.equal(r.mode, "some-terms");
    assert.equal(r.allTermResults, 0);
    assert.deepEqual(r.terms, ["sidewalk", "tanks"]);
  });

  test("a phrase match returns exactly what searchCorpus returns", () => {
    const r = fx["phrase"];
    assert.equal(r.mode, "phrase");
    assert.deepEqual(r.results, r.phrase);
    assert.deepEqual(r.results, ["admin_code § 9-001", "rules § 1-01", "admin_code § 9-002"]);
  });
});

describe("search tool response (fixture index)", () => {
  test("widened: the notice is the first line and lists the terms", () => {
    assert.equal(
      firstLine(fx["shed question tool"]),
      "Only 1 section matched every term (listed first); the rest match some of: long, sidewalk, shed, stay."
    );
    assert.equal(
      firstLine(fx["no term in common tool"]),
      "No section matched every term; showing sections matching some of: sidewalk, tanks."
    );
  });

  test("all-terms: names the terms, without the widened notice", () => {
    const text = fx["tank question tool, limit 1"];
    assert.equal(
      firstLine(text),
      "No section contains the exact query; showing sections containing all of: building, owners, required, drinking, water, tanks."
    );
    assert.doesNotMatch(text, WIDENED);
  });

  test("a phrase match carries no notice", () => {
    for (const label of ["phrase tool"]) {
      assert.match(firstLine(fx[label]), RESULT_LINE, label);
      assert.doesNotMatch(fx[label], /No section|matched every term/, label);
    }
  });
});

// ---------------------------------------------------------------------------
// Layer 2: behavior against the committed law index. No counts, no ranks.
// ---------------------------------------------------------------------------

describe("against the committed index", { skip: !CORPUS_PRESENT && "committed index not present" }, () => {
  test("the issue's two questions fall back to terms and return results", () => {
    for (const [q, terms] of [
      [SHED_Q, ["long", "sidewalk", "shed", "stay"]],
      [TANK_Q, ["building", "owners", "required", "drinking", "water", "tanks"]],
    ]) {
      const r = searchWithFallback(q);
      assert.notEqual(r.mode, "phrase", q);
      assert.deepEqual(r.terms, terms, q);
      assert.ok(r.results.length > 0, q);
    }
  });

  test("the search tool's first line is the notice and lists the terms", async () => {
    for (const q of [SHED_Q, TANK_Q]) {
      const text = textOf(await callTool("search", { query: q }));
      const line = firstLine(text);
      assert.match(line, /^(No section|Only \d+ sections? matched)/, q);
      assert.ok(line.includes(queryTerms(q).join(", ")), line);
      assert.match(text.split("\n")[2], RESULT_LINE, q);
    }
  });

  test("a query that matches as a phrase returns what searchCorpus returns", () => {
    for (const [q, corpus, limit] of [
      ["sidewalk shed", "all", 10],
      ["sinking fund", "charter", 25],
    ]) {
      const before = searchCorpus(q, corpus, limit);
      if (before.length === 0) continue; // nothing to compare if the text moved
      const after = searchWithFallback(q, corpus, limit);
      assert.equal(after.mode, "phrase", q);
      assert.deepEqual(cites(after.results), cites(before), q);
    }
  });
});
