// Strict tool schemas (issue #19): unknown parameters must be rejected, not
// silently dropped.
//
// Two layers, both tested here:
//   a) every advertised inputSchema sets additionalProperties:false, so the
//      CALLING model knows an invented parameter is invalid;
//   b) callTool() itself refuses an undeclared key rather than stripping it.
//
// Layer (b) is the one that fails before the fix: zod strips unknown keys by
// default, so search(query, bogus_unknown_param) used to return normal § results
// with nothing signalling that a "filter" had been dropped.
//
// Requires: npm run build (dist/tools.js). Guaranteed by "pretest" in CI.
//
// Run with: node --test

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { TOOLS, callTool } from "../dist/tools.js";

// The committed index is what the behavioral tests search. It ships in the repo,
// but a corpus-less checkout should skip rather than fail.
const CORPUS_PRESENT = existsSync(
  join(dirname(fileURLToPath(import.meta.url)), "..", "data", "index", "json", "charter.json")
);

describe("advertised schemas (layer a)", () => {
  test("every tool sets additionalProperties:false", () => {
    assert.ok(TOOLS.length > 0, "TOOLS must not be empty");
    for (const tool of TOOLS) {
      assert.equal(
        tool.inputSchema.additionalProperties,
        false,
        `${tool.name} must set additionalProperties:false so unknown params are rejected`
      );
    }
  });
});

describe("handler enforcement (layer b)", { skip: !CORPUS_PRESENT && "corpus index not built" }, () => {
  test("search rejects an undeclared parameter instead of dropping it", async () => {
    const res = await callTool("search", {
      query: "open data",
      bogus_unknown_param: "SHOULD_REJECT",
      limit: 2,
    });
    const text = res.content.map((c) => c.text).join("\n");
    assert.equal(res.isError, true, `expected an error result, got: ${text.slice(0, 300)}`);
    assert.match(text, /unrecognized|unknown|not permitted/i);
    assert.match(text, /bogus_unknown_param/, "the error must name the offending key");
    assert.match(text, /query/, "the error must name the accepted parameters");
  });

  test("get_version rejects an undeclared parameter (no-parameter tool)", async () => {
    const res = await callTool("get_version", { bogus_unknown_param: "x" });
    assert.equal(res.isError, true);
    assert.match(res.content[0].text, /unrecognized|unknown|not permitted/i);
  });

  test("regression guard: the same search without the bogus key still returns results", async () => {
    const res = await callTool("search", { query: "open data", limit: 2 });
    assert.notEqual(res.isError, true, "a valid call must not be rejected");
    assert.match(res.content[0].text, /§/, "expected section results");
  });

  test("regression guard: optional params may still be omitted", async () => {
    const res = await callTool("search", { query: "open data" });
    assert.notEqual(res.isError, true);
  });
});
