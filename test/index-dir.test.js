// Issue #26: point the server at an index other than the one bundled in the
// npm package (NYC_LAWS_INDEX_DIR), and report the real package version in
// serverInfo instead of a hard-coded "0.1.0".
//
// The override is resolved once, at module load, so each case runs in a child
// process with its own environment. The override fixture is a copy of the
// committed data/index/json/ with one field changed, so it has the real shape.
//
// Requires: npm run build (dist/ must exist) — guaranteed by "pretest".
//
// Run with: node --test

import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawnSync, spawn } from "node:child_process";
import {
  mkdtempSync,
  readFileSync,
  writeFileSync,
  copyFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname, relative, basename } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const BUNDLED = join(ROOT, "data", "index", "json");
const CORPUS_URL = pathToFileURL(join(ROOT, "dist", "corpus.js")).href;
const SERVER = join(ROOT, "dist", "index.js");
const PKG_VERSION = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")).version;

const MARKER = "Current through Local Law 2099/1, enacted January 1, 2099,";

let fixtureDir;

// Run a snippet that imports dist/corpus.js under a given environment.
function runCorpus(snippet, envOverride, cwd = ROOT) {
  const env = { ...process.env };
  delete env.NYC_LAWS_INDEX_DIR;
  Object.assign(env, envOverride);
  const code = `const c = await import(${JSON.stringify(CORPUS_URL)});\n${snippet}`;
  return spawnSync(process.execPath, ["--input-type=module", "-e", code], {
    env,
    cwd,
    encoding: "utf8",
  });
}

before(() => {
  fixtureDir = mkdtempSync(join(tmpdir(), "nyc-laws-index-"));
  for (const f of ["versions.json", "charter.json", "admin_code.json", "rules.json"]) {
    copyFileSync(join(BUNDLED, f), join(fixtureDir, f));
  }
  const versions = JSON.parse(readFileSync(join(fixtureDir, "versions.json"), "utf8"));
  versions.charter.currentThrough = MARKER;
  writeFileSync(join(fixtureDir, "versions.json"), JSON.stringify(versions, null, 2));
  // Change one section's text so we can prove corpus reads come from the override.
  const charter = JSON.parse(readFileSync(join(fixtureDir, "charter.json"), "utf8"));
  const s259 = charter.find((s) => s.citation === "§ 259");
  assert.ok(s259, "fixture needs Charter § 259");
  s259.text = "OVERRIDE-SENTINEL " + s259.text;
  writeFileSync(join(fixtureDir, "charter.json"), JSON.stringify(charter));
});

after(() => {
  if (fixtureDir) rmSync(fixtureDir, { recursive: true, force: true });
});

describe("NYC_LAWS_INDEX_DIR", () => {
  test("unset: serves the bundled index", () => {
    const r = runCorpus(
      `console.log(JSON.stringify({ dir: c.INDEX_DIR, v: c.getVersions().charter.currentThrough }));`,
      {}
    );
    assert.equal(r.status, 0, r.stderr);
    const out = JSON.parse(r.stdout);
    assert.equal(out.dir, BUNDLED);
    assert.notEqual(out.v, MARKER);
  });

  test("blank value is treated as unset", () => {
    const r = runCorpus(`console.log(c.INDEX_DIR);`, { NYC_LAWS_INDEX_DIR: "   " });
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.stdout.trim(), BUNDLED);
  });

  test("set: versions and section text come from the override directory", () => {
    const r = runCorpus(
      `const s = c.getSection("§ 259", "charter");
       console.log(JSON.stringify({ dir: c.INDEX_DIR, v: c.getVersions().charter.currentThrough, text: s.section.text.slice(0, 40) }));`,
      { NYC_LAWS_INDEX_DIR: fixtureDir }
    );
    assert.equal(r.status, 0, r.stderr);
    const out = JSON.parse(r.stdout);
    assert.equal(out.dir, fixtureDir);
    assert.equal(out.v, MARKER);
    assert.match(out.text, /^OVERRIDE-SENTINEL /);
  });

  test("a relative path resolves against the working directory", () => {
    const rel = relative(ROOT, fixtureDir);
    const r = runCorpus(`console.log(c.getVersions().charter.currentThrough);`, {
      NYC_LAWS_INDEX_DIR: rel,
    });
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.stdout.trim(), MARKER);
  });

  test("a leading ~/ expands to the home directory", () => {
    // Point HOME at the fixture's parent so "~/<name>" resolves to the fixture.
    const r = runCorpus(`console.log(JSON.stringify([c.INDEX_DIR, c.getVersions().charter.currentThrough]));`, {
      HOME: dirname(fixtureDir),
      NYC_LAWS_INDEX_DIR: "~/" + basename(fixtureDir),
    });
    assert.equal(r.status, 0, r.stderr);
    const [dir, v] = JSON.parse(r.stdout);
    assert.equal(dir, fixtureDir);
    assert.equal(v, MARKER);
  });

  test("a directory without versions.json fails at startup, naming the variable", () => {
    const missing = join(fixtureDir, "does-not-exist");
    const r = runCorpus(`console.log("loaded");`, { NYC_LAWS_INDEX_DIR: missing });
    assert.notEqual(r.status, 0, "must not start");
    assert.doesNotMatch(r.stdout, /loaded/, "must not fall back to the bundled index");
    assert.match(r.stderr, /NYC_LAWS_INDEX_DIR is set to/);
    assert.match(r.stderr, /versions\.json/);
  });
});

// End to end over stdio: the server's initialize result and get_version tool.
function mcpSession(envOverride) {
  return new Promise((resolve, reject) => {
    const env = { ...process.env };
    delete env.NYC_LAWS_INDEX_DIR;
    Object.assign(env, envOverride);
    const child = spawn(process.execPath, [SERVER], { env, stdio: ["pipe", "pipe", "pipe"] });
    let buf = "";
    let stderr = "";
    const responses = new Map();
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`MCP session timed out. stderr: ${stderr}`));
    }, 15000);
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
          send({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "get_version", arguments: {} } });
        }
        if (msg.id === 2) {
          clearTimeout(timer);
          child.kill();
          resolve({ init: responses.get(1), version: msg, stderr });
        }
      }
    });
    const send = (m) => child.stdin.write(JSON.stringify(m) + "\n");
    send({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-06-18",
        capabilities: {},
        clientInfo: { name: "index-dir-test", version: "0" },
      },
    });
  });
}

describe("MCP server over stdio", () => {
  test("serverInfo.version matches package.json", async () => {
    const { init } = await mcpSession({});
    assert.equal(init.result.serverInfo.name, "nyc-charter-laws-rules");
    assert.equal(init.result.serverInfo.version, PKG_VERSION);
  });

  test("get_version reports the override index and stderr names its path", async () => {
    const { version, stderr } = await mcpSession({ NYC_LAWS_INDEX_DIR: fixtureDir });
    const text = version.result.content[0].text;
    assert.match(text, /Local Law 2099\/1/);
    assert.match(stderr, /serving index from .*NYC_LAWS_INDEX_DIR/);
  });
});
