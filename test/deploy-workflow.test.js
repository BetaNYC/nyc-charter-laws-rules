// The website's deploy workflow (issue #64): .github/workflows/deploy-site.yml, and the step
// in refresh-data.yml that starts it.
//
// Read as text (no YAML dependency): the lines checked here are simple and fixed. The
// workflow must deploy only from main, with the Pages permissions GitHub documents, and its
// push trigger must list every file the site build imports or reads, so that a change to
// any of them redeploys the site.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync, readdirSync } from "node:fs";
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
    "data/index/json/admin_code.json",
    "data/index/json/rules.json",
    "data/index/json/versions.json",
    "data/structure/charter.json",
    "data/structure/admin_code.json",
    "data/structure/rules.json",
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
  // The smoke check reads the deployed URL and checks the home page, /about, the Admin Code, and
  // the Rules when the build has them (the build job's `rules` output, from its check step).
  assert.match(DEPLOY, /PAGE_URL: \$\{\{ steps\.deployment\.outputs\.page_url \}\}/);
  assert.match(DEPLOY, /^ {10}paths="\/ \/about \/admin-code\/"$/m);
  assert.match(DEPLOY, /^ {10}RULES: \$\{\{ needs\.build\.outputs\.rules \}\}$/m);
  assert.match(DEPLOY, /^ {10}if \[ "\$RULES" = "true" \]; then paths="\$paths \/rules\/"; fi$/m);
  assert.match(DEPLOY, /^ {10}for path in \$paths; do$/m);
  assert.match(DEPLOY, /^ {6}rules: \$\{\{ steps\.check\.outputs\.rules \}\}$/m);
});

test("deploy-site.yml builds the Charter, the Administrative Code and the Rules, and checks they are there", async () => {
  const { DEFAULT_BOOKS } = await import("../scripts/lib/site/config.js");
  assert.deepEqual(DEFAULT_BOOKS, ["charter", "admin_code", "rules"]);
  // The plain command, so the deploy builds DEFAULT_BOOKS: no --charter-only.
  assert.match(DEPLOY, /^ {8}run: npm run build-site$/m);
  assert.doesNotMatch(DEPLOY, /--charter-only/);
  const check = DEPLOY.slice(DEPLOY.indexOf("- name: Check the build"), DEPLOY.indexOf("- name: Configure Pages"));
  for (const f of ["charter/index.html", "admin-code/index.html", "sitemaps/admin-code.xml", "pagefind/pagefind.js"]) {
    assert.ok(check.includes(` ${f}`), `the check step looks for _site/${f}`);
  }
  // The Rules: required when metadata.json says the build has them (an index from before 0.7.0
  // has no titles, and the build leaves them out), and a notice when it does not.
  assert.match(check, /^ {8}id: check$/m);
  assert.ok(check.includes(`require("./_site/metadata.json").books.rules`), "the check reads which books were built");
  for (const f of ["rules/index.html", "rules/numbers.json", "sitemaps/rules.xml"]) assert.ok(check.includes(` ${f}`), `the check step looks for _site/${f}`);
  assert.match(check, /::notice::The Rules were left out/);
  assert.match(check, /echo "rules=true" >> "\$GITHUB_OUTPUT"/);
});

test("the site's layout tests on real data stay out of the daily refresh, and gate the deploy", () => {
  const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
  // npm test, which the refresh runs before it commits new law text, does not reach test/site-data/.
  assert.equal(pkg.scripts.test, "node --test test/*.test.js");
  assert.equal(pkg.scripts["test:site-data"], "node --test test/site-data/*.test.js");
  assert.doesNotMatch(REFRESH, /test:site-data|test\/site-data|test:site\b/);
  assert.match(REFRESH, /^ {8}run: npm test$/m);
  // No file npm test runs lays out the real Administrative Code (pages-admin.js, or loadBook on it).
  for (const f of readdirSync(join(ROOT, "test")).filter((x) => x.endsWith(".test.js") && x !== "deploy-workflow.test.js")) {
    const src = readFileSync(join(ROOT, "test", f), "utf8");
    assert.doesNotMatch(src, /pages-admin\.js/, `${f} is in npm test and imports pages-admin.js: move it to test/site-data/`);
    assert.ok(!(/loadBook/.test(src) && /admin_code\.json/.test(src)), `${f} is in npm test and loads the real Administrative Code: move it to test/site-data/`);
  }
  // The deploy runs them after npm test and before the build; test.yml runs them too.
  const order = ["run: npm test", "run: npm run test:site-data", "run: npm run build-site"].map((x) => DEPLOY.indexOf(x));
  assert.ok(order.every((i) => i > 0));
  assert.deepEqual([...order].sort((a, b) => a - b), order);
  assert.match(readFileSync(join(ROOT, ".github/workflows/test.yml"), "utf8"), /^ {8}run: npm run test:site-data$/m);
});

test("refresh-data.yml: the coverage audit only reports, after build-index, and nothing reads it", () => {
  const at = REFRESH.indexOf("- name: Coverage audit (report only)");
  assert.ok(at > REFRESH.indexOf("- name: Build index"), "after build-index");
  assert.ok(at < REFRESH.indexOf("- name: Run tests"), "before the tests and the commit");
  const step = REFRESH.slice(at, REFRESH.indexOf("\n      - name: ", at + 1));
  assert.match(step, /^ {8}continue-on-error: true$/m, "it can never fail the job");
  assert.doesNotMatch(step, /^ {8}id:/m, "no id, so no later step can read its outcome");
  assert.match(step, /npm run --silent audit:coverage 2>&1 \| head -c \d+/);
  const run = step.slice(step.indexOf("run: |"));
  assert.ok(run.length > 6, "the step has a run block");
  assert.doesNotMatch(run, /--check/, "report only, never the gate");
  assert.match(step, />> "\$GITHUB_STEP_SUMMARY"/);
  assert.doesNotMatch(step, /\$GITHUB_OUTPUT|git (add|commit|push)/, "it sets no output and commits nothing");
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
