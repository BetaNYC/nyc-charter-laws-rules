// Every tool definition and the server instructions go to the model on every turn, so their
// size is a cost (issue #44). Text several tools share belongs once in the instructions.
//
// Measured 2026-11-18 at 16,966 characters (tools/list JSON plus instructions, shared module
// 1.5.0, with annotations); the budget is that plus about 6%. Raise it only on purpose, with
// a dated line here saying why.
// 2026-11-18, later the same day: list_titles and get_title gained limit and offset, and law
// answers a source line (#42, #40), then the disclaimer sentence repeated in five tool
// descriptions moved to the instructions alone (#48). Measured 16,711; budget unchanged.
// Review fixes (#49): shared module 1.5.1; tool descriptions unchanged (the citation hints
// were never moved out of get_section). Measured 16,711; budget unchanged.
//
// Requires: npm run build (dist/ must exist). Guaranteed by "pretest".

import { test } from "node:test";
import assert from "node:assert/strict";
import { TOOLS, SERVER_INSTRUCTIONS } from "../dist/tools.js";
import { toolListSize } from "../dist/betanyc-tools.js";

const BUDGET_CHARS = 18_000;

test("tool definitions plus server instructions stay within the size budget", () => {
  const size = toolListSize(TOOLS, SERVER_INSTRUCTIONS);
  assert.ok(size <= BUDGET_CHARS, `tools/list JSON + instructions is ${size} characters, over the ${BUDGET_CHARS} budget`);
});

// Issue #48: the disclaimer is said once, in the instructions, not in every description.
test("no sentence is repeated across the law-text tool descriptions", () => {
  const LAW = ["search", "get_section", "list_titles", "get_title", "get_version"];
  const seen = new Map();
  for (const t of TOOLS.filter((x) => LAW.includes(x.name))) {
    for (const sentence of t.description.split(/(?<=\.)\s+/)) {
      if (sentence.length < 20) continue;
      assert.ok(!seen.has(sentence), `"${sentence}" is in both ${seen.get(sentence)} and ${t.name}; put it in the instructions once`);
      seen.set(sentence, t.name);
    }
    assert.doesNotMatch(t.description, /Not legal advice/, `${t.name}: the disclaimer belongs in the instructions and answers`);
  }
  assert.match(SERVER_INSTRUCTIONS, /does not constitute legal advice/);
});
