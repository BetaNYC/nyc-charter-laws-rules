// Every tool definition and the server instructions go to the model on every turn, so their
// size is a cost (issue #44). Text several tools share belongs once in the instructions.
//
// Measured 2026-11-18 at 16,966 characters (tools/list JSON plus instructions, shared module
// 1.5.0, with annotations); the budget is that plus about 6%. Raise it only on purpose, with
// a dated line here saying why.
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
