// The index build record and the release guard (issue #95): scripts/lib/index-build-record.js,
// scripts/check-index-build.js, and the workflow lines that run them.
//
// Nothing here depends on the committed index being current: on a day the build code has
// changed and the refresh has not yet run, main's index is stale, and that must not turn PR CI
// red. The real repo is only used for its import graph; the checks run on fixture trees.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  BUILD_DATA_FILES,
  RECORD_PATH,
  buildInputs,
  checkIndexBuild,
  importClosure,
  lockedVersions,
  makeRecord,
  recordJson,
} from "../scripts/lib/index-build-record.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const CLI = join(ROOT, "scripts", "check-index-build.js");
const read = (p) => readFileSync(join(ROOT, p), "utf8");
const sha = (s) => createHash("sha256").update(s).digest("hex");

// --- The real build's inputs --------------------------------------------------------------------

test("the real build: build-index.js and every module it imports, and the npm packages it uses", () => {
  const { files, packages } = importClosure(ROOT);
  for (const f of [
    "scripts/build-index.js",
    "scripts/lib/build-corpus.js",
    "scripts/lib/extract-text.js",
    "scripts/lib/symbol-font.js",
    "scripts/lib/build-structure.js",
    "scripts/lib/serialize-markdown.js",
    "scripts/lib/render-section.js",
    "scripts/lib/merge-versions.js",
    "scripts/lib/index-build-record.js",
  ]) {
    assert.ok(files.includes(f), `${f} is part of the build`);
  }
  assert.ok(!files.some((f) => f.startsWith("src/") || f.includes("/site/")), "the server and the website are not");
  assert.deepEqual(packages, ["adm-zip", "fast-xml-parser"], "node: built-ins are left out");
  const inputs = buildInputs(ROOT);
  assert.ok("scripts/vendor/unicode-adobe-symbol/symbol.txt" in inputs.files, "the Symbol table the build reads");
  assert.ok("strnum" in inputs.packages, "fast-xml-parser's own dependencies count too");
  assert.match(inputs.fingerprint, /^[0-9a-f]{64}$/);
});

test("every module in the build that reads a file says which (BUILD_DATA_FILES), so a data file cannot change the index unseen", () => {
  for (const f of importClosure(ROOT).files) {
    if (/\breadFileSync\s*\(/.test(read(f)) && f !== "scripts/lib/index-build-record.js") {
      assert.ok(f in BUILD_DATA_FILES, `${f} reads a file: add it to BUILD_DATA_FILES with the data files it reads`);
    }
  }
});

// --- Fixture trees ------------------------------------------------------------------------------

const LOCK = {
  lockfileVersion: 3,
  packages: {
    "": { name: "x" },
    "node_modules/fast-xml-parser": { version: "5.8.0", dependencies: { strnum: "^2.3.0" } },
    "node_modules/strnum": { version: "2.3.0" },
  },
};

function fixture() {
  const dir = mkdtempSync(join(tmpdir(), "index-build-record-"));
  const files = {
    "scripts/build-index.js": 'import { a } from "./lib/a.js";\nimport { readFileSync } from "node:fs";\n',
    "scripts/lib/a.js": 'import { XMLParser } from "fast-xml-parser";\nimport { s } from "./symbol-font.js";\nexport const a = 1;\n',
    "scripts/lib/symbol-font.js": 'import { readFileSync } from "fs";\nexport const s = readFileSync("table");\n',
    "scripts/vendor/unicode-adobe-symbol/symbol.txt": "0x20\t0x20\n",
    "scripts/unrelated.js": "export const x = 1;\n",
    "package-lock.json": JSON.stringify(LOCK),
    "data/index/json/charter.json": "[]",
    "data/index/json/rules.json": '[{"text":"For s ≥ 4t"}]',
  };
  for (const [p, c] of Object.entries(files)) {
    mkdirSync(join(dir, p, ".."), { recursive: true });
    writeFileSync(join(dir, p), c);
  }
  const versions = {
    charter: { sha256: sha("[]") },
    rules: { sha256: sha('[{"text":"For s ≥ 4t"}]') },
  };
  const writeVersions = (v = versions) => writeFileSync(join(dir, "data/index/json/versions.json"), JSON.stringify(v));
  // What build-index.js does at the end of a build.
  const build = () => {
    writeVersions();
    writeFileSync(join(dir, RECORD_PATH), recordJson(makeRecord(dir, versions)));
  };
  const edit = (p, c) => writeFileSync(join(dir, p), c);
  const done = () => rmSync(dir, { recursive: true, force: true });
  return { dir, build, edit, done, writeVersions, versions };
}

test("the fingerprint follows the build's code, data and packages, and nothing else", () => {
  const f = fixture();
  try {
    const base = buildInputs(f.dir).fingerprint;
    assert.equal(buildInputs(f.dir).fingerprint, base, "the same tree, the same fingerprint");
    assert.deepEqual(Object.keys(buildInputs(f.dir).files), [
      "scripts/build-index.js",
      "scripts/lib/a.js",
      "scripts/lib/symbol-font.js",
      "scripts/vendor/unicode-adobe-symbol/symbol.txt",
    ]);

    f.edit("scripts/unrelated.js", "export const x = 2;\n");
    assert.equal(buildInputs(f.dir).fingerprint, base, "a file the build does not import");

    f.edit("scripts/lib/a.js", 'import { XMLParser } from "fast-xml-parser";\nimport { s } from "./symbol-font.js";\r\nexport const a = 1;\r\n');
    assert.equal(buildInputs(f.dir).fingerprint, base, "CRLF line endings read as LF");

    f.edit("scripts/lib/a.js", 'import { XMLParser } from "fast-xml-parser";\nimport { s } from "./symbol-font.js";\nexport const a = 2;\n');
    const codeChanged = buildInputs(f.dir).fingerprint;
    assert.notEqual(codeChanged, base, "a module the build imports");

    f.edit("scripts/vendor/unicode-adobe-symbol/symbol.txt", "0x20\t0x20\n0x3B1\t0x61\n");
    const dataChanged = buildInputs(f.dir).fingerprint;
    assert.notEqual(dataChanged, codeChanged, "a data file a build module reads");

    f.edit("package-lock.json", JSON.stringify({ ...LOCK, packages: { ...LOCK.packages, "node_modules/strnum": { version: "2.3.1" } } }));
    assert.notEqual(buildInputs(f.dir).fingerprint, dataChanged, "a dependency of a package the build imports");
  } finally {
    f.done();
  }
});

test("an import the record cannot follow fails loudly, never silently left out", () => {
  const f = fixture();
  try {
    f.edit("scripts/lib/a.js", 'import { b } from "./missing.js";\n');
    assert.throws(() => buildInputs(f.dir), /scripts\/lib\/missing\.js, which does not exist/);
    f.edit("scripts/lib/a.js", "const m = await import(name);\n");
    assert.throws(() => buildInputs(f.dir), /computed name/);
    f.edit("scripts/lib/a.js", 'import x from "not-in-the-lock";\n');
    assert.throws(() => buildInputs(f.dir), /no entry for not-in-the-lock/);
  } finally {
    f.done();
  }
});

test("lockedVersions: a nested copy is found before the top-level one, as Node resolves it", () => {
  const lock = {
    packages: {
      "node_modules/a": { version: "1.0.0", dependencies: { b: "^2" } },
      "node_modules/a/node_modules/b": { version: "2.0.0" },
      "node_modules/b": { version: "1.0.0" },
    },
  };
  assert.deepEqual(lockedVersions(lock, ["a"]), { a: "1.0.0", "a>b": "2.0.0" });
  assert.throws(() => lockedVersions({ dependencies: {} }, ["a"]), /lockfileVersion 2 or later/);
});

test("checkIndexBuild: passes on an index built by this code", () => {
  const f = fixture();
  try {
    f.build();
    assert.deepEqual(checkIndexBuild(f.dir), { ok: true, problems: [] });
    // The record is stable: a rebuild with the same code and text writes the same bytes.
    const once = readFileSync(join(f.dir, RECORD_PATH), "utf8");
    f.build();
    assert.equal(readFileSync(join(f.dir, RECORD_PATH), "utf8"), once);
  } finally {
    f.done();
  }
});

test("checkIndexBuild: fails when there is no record (an index from before the record existed)", () => {
  const f = fixture();
  try {
    f.writeVersions();
    const r = checkIndexBuild(f.dir);
    assert.equal(r.ok, false);
    assert.match(r.problems.join("\n"), /data\/index-build\.json is missing/);
  } finally {
    f.done();
  }
});

test("checkIndexBuild: fails when the build code changed after the index was built, naming what changed", () => {
  const f = fixture();
  try {
    f.build();
    f.edit("scripts/lib/symbol-font.js", 'import { readFileSync } from "fs";\nexport const s = 2;\n');
    const r = checkIndexBuild(f.dir);
    assert.equal(r.ok, false);
    assert.match(r.problems[0], /the build code changed since the committed index was built: file scripts\/lib\/symbol-font\.js changed/);
    f.edit("package-lock.json", JSON.stringify({ ...LOCK, packages: { ...LOCK.packages, "node_modules/strnum": { version: "2.3.1" } } }));
    assert.match(checkIndexBuild(f.dir).problems[0], /package strnum is 2\.3\.1, was 2\.3\.0/);
  } finally {
    f.done();
  }
});

test("checkIndexBuild: fails when the record is not this index's (another build's record, or an edited index file)", () => {
  const f = fixture();
  try {
    f.build();
    f.writeVersions({ ...f.versions, rules: { sha256: sha("other") } });
    assert.match(checkIndexBuild(f.dir).problems.join("\n"), /versions\.json does not have the rules sha256/);
    f.writeVersions({ ...f.versions, admin_code: { sha256: sha("x") } });
    assert.match(checkIndexBuild(f.dir).problems.join("\n"), /versions\.json lists admin_code, which data\/index-build\.json does not/);
    f.writeVersions();
    f.edit("data/index/json/rules.json", '[{"text":"For s ³ 4t"}]');
    assert.match(checkIndexBuild(f.dir).problems.join("\n"), /rules\.json is not the file the recorded build wrote/);
  } finally {
    f.done();
  }
});

test("check-index-build.js: exit 1 and what to do when stale; --warn exits 0; exit 0 when current", () => {
  const f = fixture();
  try {
    const run = (...args) => spawnSync(process.execPath, [CLI, "--root", f.dir, ...args], {
      encoding: "utf8",
      env: { ...process.env, GITHUB_ACTIONS: "true" },
    });
    f.writeVersions();
    const stale = run();
    assert.equal(stale.status, 1);
    assert.match(stale.stdout, /^::error title=Index not built by this code::The bundled index/m);
    assert.match(stale.stderr, /index-build\.json is missing/);
    assert.match(stale.stderr, /gh workflow run refresh-data\.yml/);
    const warned = run("--warn");
    assert.equal(warned.status, 0);
    assert.match(warned.stdout, /^::warning title=Index not built by this code::/m);

    f.build();
    const ok = run();
    assert.equal(ok.status, 0, ok.stderr);
    assert.match(ok.stdout, /built by this commit's build code/);
    assert.equal(run("--nope").status, 2);
  } finally {
    f.done();
  }
});

// --- Where it runs ------------------------------------------------------------------------------

test("release.yml checks the index build before it publishes, without --warn", () => {
  const yml = read(".github/workflows/release.yml");
  const guard = yml.indexOf("run: node scripts/check-index-build.js\n");
  assert.ok(guard > 0, "release.yml runs the guard");
  assert.ok(guard < yml.indexOf("- name: Publish to npm"), "before npm publish");
  assert.ok(guard > yml.indexOf("- name: Checkout"), "after the checkout");
  assert.doesNotMatch(yml, /check-index-build\.js --warn/, "never as a warning");
});

test("test.yml reports a stale index as a warning only, so PR CI is not red while the refresh catches up", () => {
  const yml = read(".github/workflows/test.yml");
  assert.match(yml, /run: node scripts\/check-index-build\.js --warn\n/);
  assert.doesNotMatch(yml, /run: node scripts\/check-index-build\.js\n/);
});

test("the record is committed by the refresh beside the index, but not shipped in the npm package", () => {
  const refresh = read(".github/workflows/refresh-data.yml");
  assert.match(refresh, /UNSHIPPED_PATHS=\([^)]*\bdata\/index-build\.json\b[^)]*\)/);
  const pkg = JSON.parse(read("package.json"));
  assert.ok(!pkg.files.some((f) => RECORD_PATH === f || RECORD_PATH.startsWith(`${f}/`)), "not in package.json files");
});
