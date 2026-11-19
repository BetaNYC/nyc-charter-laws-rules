// Every failure is isError with a plain sentence, never zod's JSON or a stack trace, and keeps
// the disclaimer (issue #46).
//
// Requires: npm run build (dist/ must exist). Guaranteed by "pretest".

import { test } from "node:test";
import assert from "node:assert/strict";
import { callTool } from "../dist/tools.js";

const BAD_CALLS = [
  ["search", { query: "x", limit: 100 }, /'limit'.*50/],
  ["search", { query: "x", limit: 2.5 }, /'limit'/],
  ["search", {}, /'query' is required/],
  ["get_section", { citation: 5 }, /'citation'/],
  ["list_titles", { corpus: "bylaws" }, /'corpus'.*charter/],
  ["get_title", { corpus: "rules" }, /'title' is required/],
  ["search", { query: "x", extra: 1 }, /does not accept 'extra'/],
  ["no_such_tool", {}, /no tool named 'no_such_tool'.*Available tools: search/],
];

for (const [name, args, want] of BAD_CALLS) {
  test(`${name} ${JSON.stringify(args)}: a plain sentence that says what to fix`, async () => {
    const r = await callTool(name, args);
    assert.equal(r.isError, true);
    const text = r.content[0].text;
    assert.match(text, want);
    assert.doesNotMatch(text, /"code"\s*:|^\s*\[\s*$|^\s*at \S/m, "no zod JSON and no stack frames");
    assert.match(text, /legal advice/i, "keeps the disclaimer");
  });
}

test("a bad-parameter error lists the accepted parameters", async () => {
  const r = await callTool("search", { query: "x", limit: 0 });
  assert.match(r.content[0].text, /Accepted parameters: query, corpus, limit\./);
});
