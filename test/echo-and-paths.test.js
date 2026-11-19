// Round 2 of the #49 review: what an answer may repeat back, and what it may not show.
//
// 1. A missing or unreadable index file used to answer 'Index for "charter" not found at
//    /full/server/path… Run: npm run build-index'. The person asking now hears which document
//    is missing and what the server's operator should do; the path goes to stderr.
// 2. Anything the caller sent that an answer repeats (query, citation, title, a parameter name or
//    value, a tool name) is cut to one line of at most 100 characters (echo()). Before, a
//    5,000-character value or fake stack-trace lines came back whole.
//
// Requires: npm run build (dist/ must exist). Guaranteed by "pretest".

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, copyFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { callTool, echo, ECHO_MAX } from "../dist/tools.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const FIXTURE = join(ROOT, "test", "fixtures", "search-index");
const TOOLS_URL = pathToFileURL(join(ROOT, "dist", "tools.js")).href;
const textOf = (r) => r.content.map((c) => c.text).join("\n");
// The answer's own part: everything before the source lines and the disclaimer.
const body = (t) => t.split(/\n\n(?:Source: |BetaNYC modified this data: |---\n|⚠️)/)[0];

describe("a missing index file", () => {
  function callIn(dir, tool, args) {
    const code = `const t = await import(${JSON.stringify(TOOLS_URL)});
      console.log(JSON.stringify(await t.callTool(${JSON.stringify(tool)}, ${JSON.stringify(args)})));`;
    const env = { ...process.env, NYC_LAWS_INDEX_DIR: dir };
    const r = spawnSync(process.execPath, ["--input-type=module", "-e", code], { env, cwd: ROOT, encoding: "utf8" });
    assert.equal(r.status, 0, r.stderr);
    return { result: JSON.parse(r.stdout), stderr: r.stderr };
  }

  for (const [label, prepare] of [
    ["absent", () => {}],
    ["not JSON", (dir) => writeFileSync(join(dir, "charter.json"), "{ not json")],
  ]) {
    test(`charter.json ${label}: the document is named, the path is not; the path goes to stderr`, () => {
      const dir = mkdtempSync(join(tmpdir(), "nyc-clr-broken-"));
      try {
        copyFileSync(join(FIXTURE, "versions.json"), join(dir, "versions.json"));
        prepare(dir);
        const { result, stderr } = callIn(dir, "get_section", { citation: "§ 1", corpus: "charter" });
        assert.equal(result.isError, true);
        const t = textOf(result);
        assert.match(t, /^Error: The index for the New York City Charter is missing or unreadable on this server, so it cannot answer from it\. Whoever runs this server should reinstall the package, or rebuild the index with "npm run build-index"/);
        assert.ok(!t.includes(dir), "no server path in the answer");
        assert.doesNotMatch(t, /charter\.json|not found at/);
        assert.match(t, /legal advice/i, "the disclaimer still ends it");
        assert.ok(stderr.includes(join(dir, "charter.json")), "the operator sees the path on stderr");
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });
  }
});

describe("echo()", () => {
  test("short single-line text is unchanged", () => {
    assert.equal(echo("§ 259"), "§ 259");
  });

  test("long text is cut to ECHO_MAX characters, ending …", () => {
    const out = echo("x".repeat(5000));
    assert.equal(ECHO_MAX, 100);
    assert.equal([...out].length, 100);
    assert.ok(out.endsWith("…"));
  });

  test("only the first non-empty line is kept, and the cut is marked", () => {
    assert.equal(echo("\n  zzqq\n    at Object.<anonymous> (/srv/app/secret.js:1:2)"), "zzqq …");
  });

  test("control and format characters become spaces", () => {
    assert.equal(echo("a\u0007b‮c"), "a b c");
  });
});

describe("answers repeat at most 100 characters of what the caller sent", () => {
  const LONG = "q".repeat(5000);
  const FAKE_STACK = "zzqqnothing\n    at Object.<anonymous> (/srv/app/secret.js:12:3)\n    at node:internal/main:1:1";

  async function check(tool, args, { error }) {
    const r = await callTool(tool, args);
    assert.equal(r.isError === true, error, `${tool} isError`);
    const t = textOf(r);
    assert.ok(!t.includes("q".repeat(ECHO_MAX)), `${tool}: the long value came back whole`);
    // No stack-frame line, and not the frame text itself. (search lists the words it searched
    // for, so single words such as "secret.js" can appear there, capped like any echo.)
    assert.doesNotMatch(t, /^\s+at |\(\/srv\/app\/secret\.js:12:3\)|node:internal\/main:1:1/m, `${tool}: fake stack lines came back`);
    // No line of the answer's own part runs long. Result snippets are law text, up to 400
    // characters plus "…", so the bound sits just above them.
    for (const line of body(t).split("\n")) {
      assert.ok(line.length <= 450, `${tool}: a ${line.length}-character line`);
    }
    assert.match(t, /legal advice/i);
    return t;
  }

  test("search: a 5,000-character query and a query with stack lines", async () => {
    const t = await check("search", { query: LONG }, { error: false });
    assert.match(t, /^No results found for "q{99}…"\./);
    const s = await check("search", { query: FAKE_STACK }, { error: false });
    assert.match(s.split("\n")[0], /zzqqnothing/, "the words searched for are listed, on one line");
  });

  test("search: the term list in the first line is capped too", async () => {
    const words = Array.from({ length: 300 }, (_, i) => `zz${i}word`).join(" ") + " sidewalk";
    const t = await check("search", { query: words }, { error: false });
    const first = t.split("\n")[0];
    assert.ok(first.length < 250, first);
  });

  test("get_section and get_title: the citation and title", async () => {
    assert.match(await check("get_section", { citation: LONG }, { error: false }), /^Section not found: "q{99}…"\./);
    await check("get_section", { citation: FAKE_STACK }, { error: false });
    assert.match(await check("get_title", { corpus: "charter", title: LONG }, { error: false }), /^No sections found for "q{99}…" in charter\./);
  });

  test("an unknown parameter name, and many of them", async () => {
    const t = await check("search", { query: "x", [LONG]: 1 }, { error: true });
    assert.match(t, /^Error: search does not accept 'q{99}…'\./);
    const many = Object.fromEntries(Array.from({ length: 40 }, (_, i) => [`bogus${i}`, 1]));
    const m = await check("search", { query: "x", ...many }, { error: true });
    assert.match(m, /^Error: search does not accept 'bogus0', 'bogus1', 'bogus2', 'bogus3', 'bogus4' and 35 more\./);
  });

  test("a bad corpus value", async () => {
    const t = await check("search", { query: "x", corpus: LONG }, { error: true });
    assert.match(t, /'corpus' must be one of 'charter', 'admin_code', 'rules', 'all', not 'q{99}…'/);
  });

  test("an unknown tool name", async () => {
    const t = await check(LONG, {}, { error: true });
    assert.match(t, /^Error: There is no tool named 'q{99}…'\./);
  });
});
