// What the npm package carries, and what installing it runs (issue #95).
//
// 1. The tarball holds what the server reads at run time (dist/, the JSON index,
//    WHATS-CHANGED.md, DATA-SOURCES.json) plus the reader docs, and nothing else:
//    the Markdown index (66.6 MB, never read by the server) shipped until 0.8.0.
//    Checked against `npm pack --dry-run --json`, npm's own list of what it would pack.
// 2. Every package dist/ imports is a runtime dependency, and nothing else is: adm-zip
//    and fast-xml-parser are used only by the build scripts.
// 3. No script that npm runs on install: `prepare` runs for a non-registry install (a
//    tarball or git), and npm 11 warns about it. The build runs on `prepack` instead.
//
// Requires: npm run build (dist/ must exist) — guaranteed by "pretest".
//
// Run with: node --test

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { builtinModules } from "node:module";

const root = new URL("..", import.meta.url);
const pkg = JSON.parse(readFileSync(new URL("package.json", root), "utf8"));

function packedFiles() {
  // --ignore-scripts: list the files without running prepack's build again.
  const npm = process.platform === "win32" ? "npm.cmd" : "npm";
  const r = spawnSync(npm, ["pack", "--dry-run", "--json", "--ignore-scripts"], {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  assert.equal(r.status, 0, `npm pack --dry-run failed: ${r.stderr}`);
  const [info] = JSON.parse(r.stdout);
  return info.files.map((f) => f.path).sort();
}

test("the package holds the server, the JSON index and the reader docs, and nothing else", () => {
  const files = packedFiles();
  const outsideDist = files.filter((f) => !f.startsWith("dist/"));
  assert.deepEqual(outsideDist, [
    "DATA-SOURCES.json",
    "LICENSE",
    "README.md",
    "WHATS-CHANGED.md",
    "data.json",
    "data/index/json/admin_code.json",
    "data/index/json/charter.json",
    "data/index/json/rules.json",
    "data/index/json/versions.json",
    "package.json",
  ]);
  // Every compiled module the bin can load is in the package.
  for (const f of readdirSync(new URL("dist/", root)).filter((f) => f.endsWith(".js"))) {
    assert.ok(files.includes(`dist/${f}`), `dist/${f} is packed`);
  }
  assert.ok(!files.some((f) => f.startsWith("data/index/markdown/")), "the Markdown index is not packed");
});

test("every package dist/ imports is a runtime dependency, and nothing more", () => {
  const imported = new Set();
  for (const f of readdirSync(new URL("dist/", root)).filter((f) => f.endsWith(".js"))) {
    const src = readFileSync(new URL(`dist/${f}`, root), "utf8");
    // tsc writes one import or re-export per line; a dynamic import() would be caught too.
    const statics = src.matchAll(/^\s*(?:import|export)\b[^"'\n]*?\bfrom\s*["']([^"']+)["']|^\s*import\s*["']([^"']+)["']/gm);
    const dynamics = src.matchAll(/\bimport\(\s*["']([^"']+)["']\s*\)/g);
    for (const m of [...statics, ...dynamics]) {
      const spec = m[1] ?? m[2];
      if (spec.startsWith(".")) continue;
      if (spec.startsWith("node:") || builtinModules.includes(spec)) continue;
      const parts = spec.split("/");
      imported.add(spec.startsWith("@") ? parts.slice(0, 2).join("/") : parts[0]);
    }
  }
  assert.deepEqual([...imported].sort(), Object.keys(pkg.dependencies).sort());
  for (const dev of ["adm-zip", "fast-xml-parser"]) {
    assert.ok(!(dev in pkg.dependencies), `${dev} is not a runtime dependency`);
    assert.ok(dev in pkg.devDependencies, `${dev} is a devDependency (the build scripts use it)`);
  }
});

test("installing the package runs no script; the build runs before pack and test", () => {
  for (const s of ["preinstall", "install", "postinstall", "prepare"]) {
    assert.ok(!(s in pkg.scripts), `no "${s}" script`);
  }
  assert.equal(pkg.scripts.prepack, "npm run build");
  assert.equal(pkg.scripts.pretest, "npm run build");
});
