// Disclaimer footer modes (issue #25, reported by jpaulgale).
//
// Before 0.4.0 every tool response appended the full ~1,170-character FOOTER,
// including errors and empty results. NYC_CLR_FOOTER now chooses:
//   full-then-compact (default)  full FOOTER on the first response after the
//                                server starts, COMPACT_FOOTER after that
//   full                         full FOOTER on every response (0.3.x behavior)
// An unrecognized value falls back to the default with a warning on stderr.
// Whatever the mode, the server sends FOOTER as its `instructions`.
//
// "First response" is per server process, so the in-process tests reset that
// state with resetFooterState(env); the stdio tests run the real server in a
// child process, following test/index-dir.test.js.
//
// Requires: npm run build (dist/ must exist). Guaranteed by "pretest".
//
// Run with: node --test

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  callTool,
  resetFooterState,
  resolveFooterMode,
  FOOTER,
  COMPACT_FOOTER,
  FOOTER_ENV,
} from "../dist/tools.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SERVER = join(ROOT, "dist", "index.js");
const CORPUS_PRESENT = existsSync(join(ROOT, "data", "index", "json", "charter.json"));

const textOf = (res) => res.content.map((c) => c.text).join("\n");
const envFor = (mode) => (mode === undefined ? {} : { [FOOTER_ENV]: mode });

const hasFull = (t) => t.endsWith(FOOTER);
const hasCompact = (t) => t.endsWith(COMPACT_FOOTER) && !t.includes(FOOTER);

describe("footer text", () => {
  test("the compact line links the same AML page as the full footer", () => {
    const url = "https://codelibrary.amlegal.com/codes/newyorkcity/latest/overview";
    assert.ok(FOOTER.includes(url));
    assert.ok(COMPACT_FOOTER.includes(url));
    assert.match(COMPACT_FOOTER, /legal advice/);
    assert.ok(COMPACT_FOOTER.length < 120, `compact footer is ${COMPACT_FOOTER.length} chars`);
  });
});

describe("resolveFooterMode", () => {
  test("unset and blank are the default, with no warning", () => {
    assert.deepEqual(resolveFooterMode({}), { mode: "full-then-compact" });
    assert.deepEqual(resolveFooterMode({ [FOOTER_ENV]: "  " }), { mode: "full-then-compact" });
  });

  test("both named modes are accepted, case and surrounding space ignored", () => {
    assert.deepEqual(resolveFooterMode({ [FOOTER_ENV]: "full" }), { mode: "full" });
    assert.deepEqual(resolveFooterMode({ [FOOTER_ENV]: " FULL " }), { mode: "full" });
    assert.deepEqual(
      resolveFooterMode({ [FOOTER_ENV]: "full-then-compact" }),
      { mode: "full-then-compact" }
    );
  });

  test("a typo falls back to the default and returns a warning naming the variable", () => {
    const r = resolveFooterMode({ [FOOTER_ENV]: "ful" });
    assert.equal(r.mode, "full-then-compact");
    assert.match(r.warning, /NYC_CLR_FOOTER="ful"/);
    assert.match(r.warning, /full-then-compact, full/);
  });
});

describe("footer modes in callTool", { skip: !CORPUS_PRESENT && "committed index not present" }, () => {
  test("default: full footer on the first response, compact line after", async () => {
    resetFooterState({});
    const first = textOf(await callTool("get_version", {}));
    const second = textOf(await callTool("search", { query: "sidewalk shed", limit: 1 }));
    const third = textOf(await callTool("get_version", {}));
    assert.ok(hasFull(first), "first response must carry the full footer");
    assert.ok(hasCompact(second), "second response must carry only the compact line");
    assert.ok(hasCompact(third), "third response must carry only the compact line");
  });

  test("full: the full footer on every response", async () => {
    resetFooterState({ [FOOTER_ENV]: "full" });
    for (let i = 0; i < 3; i++) {
      const t = textOf(await callTool("search", { query: "sidewalk shed", limit: 1 }));
      assert.ok(hasFull(t), `call ${i + 1} must carry the full footer`);
    }
  });

  test("a typo behaves like the default", async () => {
    resetFooterState({ [FOOTER_ENV]: "bogus" });
    assert.ok(hasFull(textOf(await callTool("get_version", {}))));
    assert.ok(hasCompact(textOf(await callTool("get_version", {}))));
  });

  test("not-found, empty and error responses carry a disclaimer", async () => {
    resetFooterState({});
    const calls = [
      ["get_section", { citation: "nonexistent-999" }],
      ["search", { query: "zzzqqq" }],
      ["search", { query: "x", bogus: 1 }], // rejected parameter (isError)
      ["no_such_tool", {}], // unknown tool (isError)
    ];
    const texts = [];
    for (const [name, args] of calls) texts.push(textOf(await callTool(name, args)));
    assert.ok(hasFull(texts[0]), "the first response, a not-found, carries the full footer");
    for (const t of texts.slice(1)) assert.ok(hasCompact(t), `missing compact line: ${t.slice(0, 80)}`);
  });

  test("every response carries some disclaimer in every mode", async () => {
    for (const mode of [undefined, "full-then-compact", "full", "bogus"]) {
      resetFooterState(envFor(mode));
      const calls = [
        ["search", { query: "sidewalk shed", limit: 1 }],
        ["get_section", { citation: "nonexistent-999" }],
        ["get_version", { bogus: 1 }],
      ];
      for (const [i, [name, args]] of calls.entries()) {
        const text = textOf(await callTool(name, args));
        assert.ok(
          text.includes("legal advice"),
          `mode=${mode} call ${i + 1} (${name}) has no disclaimer at all`
        );
      }
    }
  });
});

// End to end over stdio: initialize, then two tool calls, in a fresh process.
function mcpSession(envOverride) {
  return new Promise((resolve, reject) => {
    const env = { ...process.env };
    delete env[FOOTER_ENV];
    Object.assign(env, envOverride);
    const child = spawn(process.execPath, [SERVER], { env, stdio: ["pipe", "pipe", "pipe"] });
    let buf = "";
    let stderr = "";
    const responses = new Map();
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`MCP session timed out. stderr: ${stderr}`));
    }, 15000);
    const send = (m) => child.stdin.write(JSON.stringify(m) + "\n");
    const call = (id) =>
      send({ jsonrpc: "2.0", id, method: "tools/call", params: { name: "get_version", arguments: {} } });
    child.stderr.on("data", (d) => (stderr += d));
    child.stdout.on("data", (d) => {
      buf += d;
      let nl;
      while ((nl = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (!line) continue;
        const msg = JSON.parse(line);
        if (msg.id !== undefined) responses.set(msg.id, msg);
        if (msg.id === 1) {
          send({ jsonrpc: "2.0", method: "notifications/initialized" });
          call(2);
        }
        if (msg.id === 2) call(3);
        if (msg.id === 3) {
          clearTimeout(timer);
          child.kill();
          resolve({
            init: responses.get(1),
            first: responses.get(2).result.content[0].text,
            second: msg.result.content[0].text,
            stderr,
          });
        }
      }
    });
    send({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-06-18",
        capabilities: {},
        clientInfo: { name: "footer-modes-test", version: "0" },
      },
    });
  });
}

describe("MCP server over stdio", { skip: !CORPUS_PRESENT && "committed index not present" }, () => {
  test("default: instructions carry the full footer; full first response, compact second; quiet stderr", async () => {
    const { init, first, second, stderr } = await mcpSession({});
    assert.equal(init.result.instructions, FOOTER);
    assert.ok(hasFull(first));
    assert.ok(hasCompact(second));
    assert.doesNotMatch(stderr, /NYC_CLR_FOOTER/);
  });

  test("full: instructions still carry the footer; both responses full", async () => {
    const { init, first, second } = await mcpSession({ [FOOTER_ENV]: "full" });
    assert.equal(init.result.instructions, FOOTER);
    assert.ok(hasFull(first));
    assert.ok(hasFull(second));
  });

  test("a typo warns once on stderr and serves the default", async () => {
    const { first, second, stderr } = await mcpSession({ [FOOTER_ENV]: "compact" });
    assert.equal(stderr.match(/NYC_CLR_FOOTER="compact" is not one of/g)?.length, 1, stderr);
    assert.ok(hasFull(first));
    assert.ok(hasCompact(second));
  });
});
