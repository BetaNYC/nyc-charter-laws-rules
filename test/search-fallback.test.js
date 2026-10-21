// Plain-language questions (issue #30).
//
// Through 0.3.x, search matched the whole query as one substring, so a natural
// question ("How long can a sidewalk shed stay up?") found nothing even though
// "sidewalk shed" finds the answer. Now, when the phrase matches nothing,
// question words and stopwords are dropped and sections are ranked by how many
// of the remaining terms they contain. The response's first line says so.
//
// Grounded in the committed index (data/index/json, current through Local Law
// 2026/147; Rules through 2026-10-04). Expected sections were read from that
// index, not assumed: the issue named Rules § 102-07 and Admin Code § 28-220.1
// for the sidewalk question, and Admin Code § 17-194 and Rules Chapter 31 for
// the water-tank one. § 28-220.1 ranks below the top 10 for the question form,
// so the test asserts § 102-07 (ranked 2nd) and § 17-194 (ranked 2nd).
//
// Requires: npm run build (dist/ must exist). Guaranteed by "pretest".
//
// Run with: node --test

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { searchCorpus, searchWithFallback, queryTerms } from "../dist/corpus.js";
import { callTool } from "../dist/tools.js";

const CORPUS_PRESENT = existsSync(
  join(dirname(fileURLToPath(import.meta.url)), "..", "data", "index", "json", "charter.json")
);

const SHED_Q = "How long can a sidewalk shed stay up?";
const TANK_Q = "What are building owners required to do about drinking water tanks?";
const WIDENED = /^No section matched every term|^Only \d+ sections? matched every term/;

const cites = (results) => results.map((s) => `${s.corpus} ${s.citation}`);
const textOf = (res) => res.content.map((c) => c.text).join("\n");

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

describe("searchWithFallback", { skip: !CORPUS_PRESENT && "committed index not present" }, () => {
  test("the sidewalk-shed question finds Rules § 102-07, widened to partial matches", () => {
    const r = searchWithFallback(SHED_Q);
    assert.equal(r.mode, "some-terms");
    assert.deepEqual(r.terms, ["long", "sidewalk", "shed", "stay"]);
    assert.ok(cites(r.results).includes("rules § 102-07"), cites(r.results).join(" | "));
  });

  test("the water-tank question finds Admin Code § 17-194, every term matched", () => {
    const r = searchWithFallback(TANK_Q);
    assert.equal(r.mode, "all-terms");
    assert.equal(r.allTermResults, r.results.length);
    assert.ok(cites(r.results).includes("admin_code § 17-194"), cites(r.results).join(" | "));
  });

  test("keyword queries that match as a phrase return exactly what they did before", () => {
    for (const [q, corpus, limit] of [
      ["sidewalk shed", "all", 10],
      ["water tank inspection", "all", 10],
      ["sinking fund", "charter", 25],
      ["taxicab", "all", 10],
      ["board of health", "rules", 10],
    ]) {
      const before = searchCorpus(q, corpus, limit);
      const after = searchWithFallback(q, corpus, limit);
      assert.ok(before.length > 0, `${q} should match as a phrase`);
      assert.equal(after.mode, "phrase", q);
      assert.deepEqual(cites(after.results), cites(before), q);
    }
  });

  test("every result counted as matching all terms contains every term", () => {
    const r = searchWithFallback(SHED_Q, "all", 25);
    assert.ok(r.allTermResults >= 1);
    // An all-terms result contains each term at the start of a word.
    for (const s of r.results.slice(0, r.allTermResults)) {
      const hay = `${s.heading} ${s.citation} ${s.text}`;
      for (const t of ["long", "sidewalk", "shed", "stay"]) {
        assert.match(hay, new RegExp(`(?<![\\p{L}\\p{N}])${t}`, "iu"), `${s.citation} lacks ${t}`);
      }
    }
  });

  test("a term matches at a word start, not inside another word", () => {
    // "shed" is a substring of "established" in thousands of sections; as a
    // term it must not count there. Every result for the bare term has "shed"
    // at the start of a word.
    const r = searchWithFallback("Where is a shed?", "all", 50);
    assert.ok(r.results.length > 0);
    for (const s of r.results) {
      assert.match(`${s.heading} ${s.text}`, /(?<![\p{L}\p{N}])shed/iu, s.citation);
    }
  });

  test("nothing at all still returns no results", () => {
    const r = searchWithFallback("zzzqqq xxyyzz");
    assert.equal(r.results.length, 0);
  });
});

describe("search tool response", { skip: !CORPUS_PRESENT && "committed index not present" }, () => {
  test("the widened notice is the first line when partial matches are shown", async () => {
    const text = textOf(await callTool("search", { query: SHED_Q }));
    const first = text.split("\n")[0];
    assert.match(first, WIDENED);
    assert.match(first, /some of: long, sidewalk, shed, stay\.$/);
    assert.match(text, /\[RULES\] § 102-07/);
  });

  test("all-terms results say which terms were used, without the widened notice", async () => {
    const text = textOf(await callTool("search", { query: TANK_Q }));
    const first = text.split("\n")[0];
    assert.equal(
      first,
      "No section contains the exact query; showing sections containing all of: building, owners, required, drinking, water, tanks."
    );
    assert.doesNotMatch(text, WIDENED);
    assert.match(text, /\[ADMIN_CODE\] § 17-194/);
  });

  test("a phrase match carries no notice at all", async () => {
    for (const query of ["sidewalk shed", "water tank inspection"]) {
      const text = textOf(await callTool("search", { query }));
      assert.match(text.split("\n")[0], /^\[(CHARTER|ADMIN_CODE|RULES)\] /, query);
      assert.doesNotMatch(text, /No section|matched every term/, query);
    }
  });

  test("no match at all is still reported as no results", async () => {
    const text = textOf(await callTool("search", { query: "zzzqqq xxyyzz" }));
    assert.match(text, /^No results found for "zzzqqq xxyyzz"\./);
  });
});
