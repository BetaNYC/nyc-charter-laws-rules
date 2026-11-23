// The website's deploy workflow (issue #64): .github/workflows/deploy-site.yml, and the step
// in refresh-data.yml that starts it.
//
// Read as text (no YAML dependency): the lines checked here are simple and fixed. The
// workflow must deploy only from main, with the Pages permissions GitHub documents, and its
// push trigger must list every file the site build imports or reads, so that a change to
// any of them redeploys the site.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { join, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DEPLOY = readFileSync(join(ROOT, ".github/workflows/deploy-site.yml"), "utf8");
const REFRESH = readFileSync(join(ROOT, ".github/workflows/refresh-data.yml"), "utf8");

/** The `paths:` list under `on: push:`, in order. */
function pushPaths(yml) {
  const lines = yml.split("\n");
  const start = lines.findIndex((l) => /^ {4}paths:\s*$/.test(l));
  assert.ok(start > 0, "deploy-site.yml has no push paths list");
  const out = [];
  for (const l of lines.slice(start + 1)) {
    const m = l.match(/^ {6}- "([^"]+)"\s*$/);
    if (!m) break;
    out.push(m[1]);
  }
  return out;
}

/** GitHub's filter globs, as far as this list uses them: `**` matches any depth, `*` one segment. */
function globMatches(glob, path) {
  const re = glob
    .replace(/[.+?^${}()|[\]\\]/g, "\\$&")
    .replace(/\*\*/g, "\u0000")
    .replace(/\*/g, "[^/]*")
    .replace(/\u0000/g, ".*");
  return new RegExp(`^${re}$`).test(path);
}

/** Every repo file reachable by relative import from scripts/build-site.js. */
function localImports(entry) {
  const seen = new Set();
  const walk = (abs) => {
    const rel = relative(ROOT, abs);
    if (seen.has(rel)) return;
    seen.add(rel);
    const src = readFileSync(abs, "utf8");
    for (const m of src.matchAll(/(?:\bfrom|\bimport\()\s*["'](\.{1,2}\/[^"']+)["']/g)) {
      const next = join(dirname(abs), m[1]);
      assert.ok(existsSync(next), `${rel} imports ${m[1]}, which does not exist`);
      walk(next);
    }
  };
  walk(join(ROOT, entry));
  return [...seen].sort();
}

test("deploy-site.yml: push to main, filtered by paths, plus workflow_dispatch", () => {
  assert.match(DEPLOY, /^on:\n {2}push:\n {4}branches: \[main\]\n {4}paths:\n/m);
  assert.match(DEPLOY, /^ {2}workflow_dispatch:/m);
  // No other triggers: no schedule, no pull_request, no workflow_run.
  for (const t of ["schedule", "pull_request", "pull_request_target", "workflow_run", "release"]) {
    assert.doesNotMatch(DEPLOY, new RegExp(`^ {2}${t}:`, "m"), `unexpected trigger ${t}`);
  }
});

test("deploy-site.yml: every file the site build imports or reads is in the push paths", () => {
  const paths = pushPaths(DEPLOY);
  const needed = [
    ...localImports("scripts/build-site.js"),
    // Read at build time, not imported.
    "src/tools.ts", // FOOTER, for "About this copy"
    "DATA-SOURCES.json", // the official URL and credit line
    "data/index/json/charter.json",
    "data/index/json/versions.json",
    "data/structure/charter.json",
    "package-lock.json", // NYSDS and Pagefind, copied into the site
    ".github/workflows/deploy-site.yml",
  ];
  assert.ok(needed.includes("scripts/lib/site/build.js"), "the import walk found the site library");
  for (const f of needed) {
    assert.ok(paths.some((g) => globMatches(g, f)), `${f} is not in deploy-site.yml's push paths`);
  }
});

test("deploy-site.yml: only main builds; Pages permissions only on the deploy job", () => {
  assert.match(DEPLOY, /^permissions:\n {2}contents: read\n/m, "workflow-level permissions are contents: read");
  assert.match(DEPLOY, /^ {4}if: github\.ref == 'refs\/heads\/main'$/m);
  const deployJob = DEPLOY.slice(DEPLOY.indexOf("\n  deploy:\n"));
  assert.ok(deployJob.length > 1, "there is a deploy job");
  assert.match(deployJob, /^ {4}needs: build$/m);
  assert.match(deployJob, /^ {4}permissions:\n {6}pages: write\n {6}id-token: write\n/m);
  assert.match(deployJob, /^ {6}name: github-pages$/m);
  const buildJob = DEPLOY.slice(DEPLOY.indexOf("\n  build:\n"), DEPLOY.indexOf("\n  deploy:\n"));
  assert.doesNotMatch(buildJob, /pages: write|id-token: write/, "the build job gets no Pages permissions");
});

test("deploy-site.yml: one deployment at a time, never cancelled mid-flight", () => {
  assert.match(DEPLOY, /^concurrency:\n {2}group: pages\n {2}cancel-in-progress: false$/m);
});

test("deploy-site.yml: the official Pages actions, and tests and build before upload", () => {
  for (const a of ["actions/configure-pages@v6", "actions/upload-pages-artifact@v5", "actions/deploy-pages@v5"]) {
    assert.ok(DEPLOY.includes(`uses: ${a}\n`), `uses ${a}`);
  }
  const order = ["run: npm ci", "run: npm test", "run: npm run build-site", "uses: actions/upload-pages-artifact@v5"].map(
    (s) => DEPLOY.indexOf(s)
  );
  assert.ok(order.every((i) => i > 0), "every step is present");
  assert.deepEqual([...order].sort((a, b) => a - b), order, "npm ci, npm test, build-site, upload, in that order");
  assert.match(DEPLOY, /path: _site\//);
  // The smoke check reads the deployed URL and checks the home page and /about.
  assert.match(DEPLOY, /PAGE_URL: \$\{\{ steps\.deployment\.outputs\.page_url \}\}/);
  assert.match(DEPLOY, /for path in \/ \/about; do/);
});

test("refresh-data.yml dispatches the deploy only when its commit step pushed", () => {
  // Both pushes in the commit step record it.
  const pushes = REFRESH.match(/git push origin HEAD:main\n\s+echo "pushed=true" >> "\$GITHUB_OUTPUT"/g) ?? [];
  assert.equal(pushes.length, 2, "both git pushes set pushed=true");
  assert.equal((REFRESH.match(/git push origin HEAD:main/g) ?? []).length, 2, "no other push without the output");
  const step = REFRESH.slice(REFRESH.indexOf("- name: Deploy the website if this run committed"));
  assert.ok(step.length > 1, "the dispatch step exists");
  assert.match(step, /if: \$\{\{ !cancelled\(\) && steps\.commit\.outputs\.pushed == 'true' \}\}/);
  assert.match(step, /run: gh workflow run deploy-site\.yml --ref main /);
  // It is the last step, so a failed dispatch can never stop a release.
  assert.doesNotMatch(step.slice(1), /\n {6}- name: /, "the dispatch is the last step");
  assert.match(REFRESH, /^ {2}actions: write$/m, "actions: write, needed to dispatch");
});
