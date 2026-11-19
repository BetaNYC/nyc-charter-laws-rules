// How the word fallback ranks sections (round 2 of the #49 review).
//
// Through 0.6.0 a section with more of the query's words always ranked first, so a long
// definitions section holding every word beat the section about the question. Now each
// section has one score (corpus.ts termScore): rare words count more, a word in the heading
// counts HEADING_WEIGHT times, long sections are pushed down a little, short stubs and Local
// Law appendix records count less. Phrase search and citation lookup are unchanged.
//
// Two layers:
//   1. termScore, as a pure function, one factor at a time.
//   2. A tiny synthetic index at test/fixtures/ranking-index/, served through
//      NYC_LAWS_INDEX_DIR in a child process (the index is fixed at startup):
//        § 1-01 Definitions.               ~3,700 characters; holds all five words, once each
//        § 2-01 Truck engine idling        short; "truck" and "engine" in the heading, "idle"
//               restricted.                and "school" in the body; no "near"
//        § 3-01 to § 3-08                  share no word with the query
//
// Requires: npm run build (dist/ must exist). Guaranteed by "pretest".

import { test, describe, before } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  termScore,
  HEADING_WEIGHT,
  SHORT_SECTION_CHARS,
  SHORT_SECTION_FACTOR,
  LOCAL_LAW_APPENDIX_FACTOR,
} from "../dist/corpus.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const FIXTURE = join(ROOT, "test", "fixtures", "ranking-index");
const SEARCH_FIXTURE = join(ROOT, "test", "fixtures", "search-index");
const CORPUS_URL = pathToFileURL(join(ROOT, "dist", "corpus.js")).href;
const TOOLS_URL = pathToFileURL(join(ROOT, "dist", "tools.js")).href;

const QUESTION = "May a truck idle its engine near a school?";

const section = (heading, length) => ({ corpus: "admin_code", id: "x", citation: "§ 9-001", heading, text: "x".repeat(length) });
const hit = (s, inHeading, inAny) => ({ s, inHeading, inAny });

describe("termScore, one factor at a time", () => {
  const AVG = 1000;

  test("a word in the heading counts HEADING_WEIGHT times a word in the body", () => {
    const s = section("§ 9-001 Something.", AVG);
    const head = termScore(hit(s, [true], [true]), [2], AVG);
    const body = termScore(hit(s, [false], [true]), [2], AVG);
    assert.equal(HEADING_WEIGHT, 3);
    assert.ok(Math.abs(head / body - HEADING_WEIGHT) < 1e-9);
  });

  test("a rare word counts more than a common one", () => {
    const s = section("§ 9-001 Something.", AVG);
    const rare = termScore(hit(s, [false, false], [true, false]), [4, 0.5], AVG);
    const common = termScore(hit(s, [false, false], [false, true]), [4, 0.5], AVG);
    assert.ok(rare > common * 10, `${rare} vs ${common}`);
  });

  test("a long section is pushed down a little, not out", () => {
    const avg = termScore(hit(section("§ 9-001 A.", AVG), [false], [true]), [2], AVG);
    const long = termScore(hit(section("§ 9-001 A.", AVG * 10), [false], [true]), [2], AVG);
    assert.ok(long < avg && long > avg / 3, `${long} vs ${avg}`);
  });

  test("sections under SHORT_SECTION_CHARS count SHORT_SECTION_FACTOR", () => {
    // 99 and 100 characters: the length damping is almost the same, so the ratio is the factor.
    const short = termScore(hit(section("§ 9-001 A.", SHORT_SECTION_CHARS - 1), [true], [true]), [2], AVG);
    const ok = termScore(hit(section("§ 9-001 A.", SHORT_SECTION_CHARS), [true], [true]), [2], AVG);
    assert.ok(Math.abs(short / ok - SHORT_SECTION_FACTOR) < 0.01, `${short / ok}`);
  });

  test("Local Law appendix records count LOCAL_LAW_APPENDIX_FACTOR", () => {
    const ll = termScore(hit(section("L.L. 2016/002", AVG), [false], [true]), [2], AVG);
    const sec = termScore(hit(section("§ 9-001 A.", AVG), [false], [true]), [2], AVG);
    assert.equal(ll / sec, LOCAL_LAW_APPENDIX_FACTOR);
    const notLl = termScore(hit(section("L.L.C. registration.", AVG), [false], [true]), [2], AVG);
    assert.equal(notLl, sec, "only the 'L.L. <year>/' form is an appendix record");
  });

  test("covering more of the words' rarity scores higher", () => {
    const s = section("§ 9-001 A.", AVG);
    const both = termScore(hit(s, [false, false], [true, true]), [2, 2], AVG);
    const one = termScore(hit(s, [false, false], [true, false]), [2, 2], AVG);
    assert.ok(both > one * 2, "two words of equal rarity: more than twice, since coverage also doubles");
  });
});

let fx;
let phraseFx;

function runInFixture(dir, body) {
  const code = `
    const c = await import(${JSON.stringify(CORPUS_URL)});
    const t = await import(${JSON.stringify(TOOLS_URL)});
    const text = async (name, args) => (await t.callTool(name, args)).content.map((x) => x.text).join("\\n");
    const cite = (s) => s.corpus + " " + s.citation;
    const out = {};
    ${body}
    console.log(JSON.stringify(out));`;
  const env = { ...process.env, NYC_LAWS_INDEX_DIR: dir };
  delete env.NYC_CLR_FOOTER;
  const r = spawnSync(process.execPath, ["--input-type=module", "-e", code], { env, cwd: ROOT, encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  return JSON.parse(r.stdout);
}

before(() => {
  fx = runInFixture(FIXTURE, `
    const q = ${JSON.stringify(QUESTION)};
    for (const limit of [10, 1]) {
      const r = c.searchWithFallback(q, "all", limit);
      out["search " + limit] = { ...r, results: r.results.map(cite) };
      out["tool " + limit] = await text("search", { query: q, limit });
    }`);
  // Phrase search and citation lookup on the round-1 fixture: these lists were recorded with
  // the 0.6.0 code (head 718a649) and must not move.
  phraseFx = runInFixture(SEARCH_FIXTURE, `
    for (const q of ["sidewalk shed", "shed", "water", "open data", "Synthetic fixture text"]) {
      out["phrase " + q] = c.searchWithFallback(q, "all", 10).results.map(cite);
    }
    for (const q of ["§ 9-001", "9-004", "Section 1-01", "Scaffolds", "sidewalk shed"]) {
      const r = c.getSection(q);
      out["get " + q] = r.kind === "match" ? cite(r.section) : r.kind === "ambiguous" ? r.candidates.map(cite) : null;
    }`);
});

describe("word fallback order (fixture index)", () => {
  test("the short section about the question outranks a long definitions section with every word", () => {
    // Before this change § 1-01 ranked first: it holds all five words, § 2-01 holds four.
    const r = fx["search 10"];
    assert.equal(r.mode, "some-terms");
    assert.deepEqual(r.terms, ["truck", "idle", "engine", "near", "school"]);
    assert.deepEqual(r.results, ["admin_code § 2-01", "admin_code § 1-01"]);
    assert.equal(r.allTermTotal, 1, "§ 1-01 still counts as holding every word");
  });

  test("the notice never says no section matched every term when one does, even off the page", () => {
    const r = fx["search 1"];
    assert.equal(r.allTermResults, 0);
    assert.equal(r.allTermTotal, 1);
    const text = fx["tool 1"];
    assert.equal(
      text.split("\n")[0],
      "No section contains the exact query; showing the best matches for some or all of: truck, idle, engine, near, school."
    );
    assert.doesNotMatch(text, /No section matched every term/);
    assert.match(text, /^1 section contains every term; it does not rank in this list\. To see more of them, raise limit \(max 50\)/m);
    assert.doesNotMatch(text, /after the full matches|listed first/);
  });

  test("both kinds shown: each counted, neither called first", () => {
    const text = fx["tool 10"];
    assert.match(text, /^1 section contains every term; it is shown\. 1 other section contains only some of the terms; it is shown\. Fewer, more specific keywords usually find better ones\.$/m);
  });
});

// Recorded by running the same queries with the 0.6.0 corpus.ts (head 718a649) on
// test/fixtures/search-index/.
const RECORDED_0_6_0 = {
  "phrase sidewalk shed": [
    "admin_code § 9-001",
    "rules § 1-01",
    "admin_code § 9-002"
  ],
  "phrase shed": [
    "admin_code § 9-001",
    "rules § 1-01",
    "admin_code § 9-002",
    "admin_code § 9-003"
  ],
  "phrase water": [
    "admin_code § 9-004",
    "admin_code § 9-005"
  ],
  "phrase open data": [
    "charter § 1"
  ],
  "phrase Synthetic fixture text": [
    "charter § 1",
    "admin_code § 9-001",
    "admin_code § 9-002",
    "admin_code § 9-003",
    "admin_code § 9-004",
    "admin_code § 9-005",
    "rules § 1-01",
    "rules § 1-02"
  ],
  "get § 9-001": "admin_code § 9-001",
  "get 9-004": "admin_code § 9-004",
  "get Section 1-01": "rules § 1-01",
  "get Scaffolds": "admin_code § 9-002",
  "get sidewalk shed": [
    "admin_code § 9-001",
    "rules § 1-01"
  ]
};

describe("phrase search and citation lookup are unchanged", () => {
  test("phrase results and get_section lookups match what 0.6.0 returned", () => {
    assert.deepEqual(phraseFx, RECORDED_0_6_0);
  });
});
