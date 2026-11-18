// Every tool says it only reads, and whether it reaches outside (issue #38). The law-text
// tools answer from the bundled index, so openWorldHint is false for all of them.
//
// Requires: npm run build (dist/ must exist). Guaranteed by "pretest".

import { test } from "node:test";
import assert from "node:assert/strict";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { TOOLS } from "../dist/tools.js";
import { assertEveryToolAnnotated } from "../dist/betanyc-tools.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

test("every tool is annotated", () => assertEveryToolAnnotated(TOOLS));

test("every tool is read-only, answers from local data, and has a title", () => {
  for (const t of TOOLS) {
    assert.equal(t.annotations.readOnlyHint, true, t.name);
    assert.equal(t.annotations.openWorldHint, false, `${t.name}: no tool calls a live API`);
    assert.ok(t.annotations.title, `${t.name} has a title`);
  }
});

test("over stdio: tools/list carries the annotations", async () => {
  const client = new Client({ name: "annotations-test", version: "0" });
  await client.connect(new StdioClientTransport({
    command: process.execPath,
    args: [join(ROOT, "dist", "index.js")],
    stderr: "ignore",
  }));
  try {
    const { tools } = await client.listTools();
    assert.equal(tools.length, TOOLS.length);
    assertEveryToolAnnotated(tools);
  } finally {
    await client.close();
  }
});
