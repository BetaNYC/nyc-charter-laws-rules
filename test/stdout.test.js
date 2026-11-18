// In server mode, stdout carries only the MCP protocol; diagnostics go to stderr (issue #47).
// Starts the built server with a bad NYC_CLR_FOOTER so it prints a startup warning, makes a
// few calls, and checks every stdout line is a JSON-RPC 2.0 message.
//
// Requires: npm run build (dist/ must exist). Guaranteed by "pretest".

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

test("stdout carries only JSON-RPC messages, the warning goes to stderr", async () => {
  const child = spawn(process.execPath, [join(ROOT, "dist", "index.js")], {
    env: { ...process.env, NYC_CLR_FOOTER: "not-a-mode" },
    stdio: ["pipe", "pipe", "pipe"],
  });
  let out = "";
  let err = "";
  child.stdout.on("data", (d) => (out += d));
  child.stderr.on("data", (d) => (err += d));
  const send = (m) => child.stdin.write(JSON.stringify({ jsonrpc: "2.0", ...m }) + "\n");
  send({ id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "stdout-test", version: "0" } } });
  send({ method: "notifications/initialized" });
  send({ id: 2, method: "tools/list" });
  send({ id: 3, method: "tools/call", params: { name: "search", arguments: { query: "open data", limit: 2 } } });
  send({ id: 4, method: "tools/call", params: { name: "search", arguments: { limit: 500 } } });

  const deadline = Date.now() + 15_000;
  while (!/"id":4[,}]/.test(out) && Date.now() < deadline) await new Promise((r) => setTimeout(r, 50));
  child.kill();

  const lines = out.split("\n").filter((l) => l.trim());
  assert.ok(lines.length >= 4, `expected 4 responses, got: ${out.slice(0, 300)}`);
  for (const l of lines) {
    let msg;
    assert.doesNotThrow(() => (msg = JSON.parse(l)), `not JSON on stdout: ${l.slice(0, 200)}`);
    assert.equal(msg.jsonrpc, "2.0", l.slice(0, 200));
  }
  assert.match(err, /NYC_CLR_FOOTER="not-a-mode"/, "the warning went to stderr");
  assert.doesNotMatch(out, /not-a-mode/, "and not to stdout");
});
