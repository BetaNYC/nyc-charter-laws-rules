// The "Commit refreshed index if changed" step of .github/workflows/refresh-data.yml, run for
// real (issue #55): its bash, cut from the workflow file, in a throwaway git repo with a bare
// local origin and a stub scripts/auto-release.js. It proves which changes commit, which bump
// the version (and so release), and which set the outputs the deploy step reads. No network:
// the only remote is a folder.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const WORKFLOW = readFileSync(new URL("../.github/workflows/refresh-data.yml", import.meta.url), "utf8");

/** The step's `run: |` block, de-indented. */
function commitStepScript() {
  const lines = WORKFLOW.split("\n");
  const at = lines.findIndex((l) => l === "      - name: Commit refreshed index if changed");
  assert.ok(at > 0, "the commit step exists");
  const run = lines.findIndex((l, i) => i > at && l === "        run: |");
  const body = [];
  for (let i = run + 1; i < lines.length && !/^ {6}- name: /.test(lines[i]); i++) {
    body.push(lines[i].startsWith("          ") ? lines[i].slice(10) : lines[i].trim() === "" ? "" : lines[i]);
  }
  return body.join("\n");
}

const SCRIPT = commitStepScript();
const hasBash = spawnSync("bash", ["--version"]).status === 0;

// Stub for auto-release.js prepare --soft: logs the call, bumps the version, prints it.
const STUB = `import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
appendFileSync("auto-release-calls.log", process.argv.slice(2).join(" ") + "\\n");
const pkg = JSON.parse(readFileSync("package.json", "utf8"));
pkg.version = "0.7.1";
writeFileSync("package.json", JSON.stringify(pkg) + "\\n");
process.stdout.write("0.7.1");
`;

function setup() {
  const dir = mkdtempSync(join(tmpdir(), "refresh-commit-"));
  const work = join(dir, "work");
  const origin = join(dir, "origin.git");
  // Ignore the machine's git config (signing, hooks), as a fresh runner would.
  const env = { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" };
  const git = (...args) => {
    const r = spawnSync("git", args, { cwd: work, env, encoding: "utf8" });
    assert.equal(r.status, 0, `git ${args.join(" ")}: ${r.stderr}`);
    return r.stdout.trim();
  };
  mkdirSync(work);
  spawnSync("git", ["init", "-q", "--bare", origin], { env });
  const files = {
    "data/index/json/versions.json": "{}\n",
    "data/index/markdown/charter.md": "# Charter\n",
    "data/changelog.json": "[]\n",
    "CHANGELOG.md": "# Changelog\n",
    "README.md": "# readme\n",
    "data/structure/charter.json": "{}\n",
    "data/fetch-provenance.json": '{"corpora":{}}\n',
    "package.json": '{"name":"x","version":"0.7.0","type":"module"}\n',
    "package-lock.json": "{}\n",
    "server.json": "{}\n",
    "RELEASES.md": "# Releases\n",
    "scripts/auto-release.js": STUB,
    ".gitignore": "auto-release-calls.log\noutput.txt\n",
  };
  for (const [name, content] of Object.entries(files)) {
    mkdirSync(join(work, name, ".."), { recursive: true });
    writeFileSync(join(work, name), content);
  }
  git("init", "-q", "-b", "main");
  git("config", "user.email", "t@example.com");
  git("config", "user.name", "t");
  git("remote", "add", "origin", origin);
  git("add", "-A");
  git("commit", "-q", "-m", "base");
  git("push", "-q", "origin", "main");

  const runStep = ({ fails = false } = {}) => {
    const output = join(work, "output.txt");
    writeFileSync(output, "");
    const r = spawnSync("bash", ["-c", SCRIPT], { cwd: work, env: { ...env, GITHUB_OUTPUT: output }, encoding: "utf8" });
    if (fails) assert.notEqual(r.status, 0, "the step should have failed");
    else assert.equal(r.status, 0, `the step failed:\n${r.stdout}\n${r.stderr}`);
    const outputs = Object.fromEntries(
      readFileSync(output, "utf8").split("\n").filter(Boolean).map((l) => l.split("="))
    );
    return { outputs, stdout: r.stdout };
  };
  const calls = () => (existsSync(join(work, "auto-release-calls.log")) ? readFileSync(join(work, "auto-release-calls.log"), "utf8") : "");
  const committed = () => git("show", "--name-only", "--format=", "HEAD").split("\n").sort();
  const write = (name, content) => writeFileSync(join(work, name), content);
  // Makes every later push to origin fail, as a rejected or broken push would.
  const rejectPushes = () => {
    const hook = join(origin, "hooks", "pre-receive");
    writeFileSync(hook, "#!/bin/sh\necho rejected >&2\nexit 1\n");
    chmodSync(hook, 0o755);
  };
  return { dir, work, git, runStep, calls, committed, write, rejectPushes };
}

const opts = { skip: hasBash ? false : "needs bash" };

test("the download record alone: committed by itself, no version bump, no release, no deploy", opts, () => {
  const r = setup();
  try {
    r.write("data/fetch-provenance.json", '{"corpora":{"rules":{}}}\n');
    const { outputs } = r.runStep();
    assert.deepEqual(outputs, { pushed: "true" }, "pushed, but deploy is not set");
    assert.equal(r.calls(), "", "auto-release.js prepare never ran");
    assert.deepEqual(r.committed(), ["data/fetch-provenance.json"]);
    assert.match(r.git("log", "-1", "--format=%s"), /^chore: refresh site structure and download record \d{4}-\d{2}-\d{2}$/);
    assert.match(readFileSync(join(r.work, "package.json"), "utf8"), /"version":"0\.7\.0"/);
    assert.equal(r.git("rev-parse", "HEAD"), r.git("rev-parse", "origin/main"), "pushed to main");
  } finally {
    rmSync(r.dir, { recursive: true, force: true });
  }
});

test("the site structure alone: committed with no release, and the site redeploys", opts, () => {
  const r = setup();
  try {
    r.write("data/structure/charter.json", '{"changed":true}\n');
    const { outputs } = r.runStep();
    assert.deepEqual(outputs, { deploy: "true", pushed: "true" });
    assert.equal(r.calls(), "");
    assert.deepEqual(r.committed(), ["data/structure/charter.json"]);
  } finally {
    rmSync(r.dir, { recursive: true, force: true });
  }
});

test("new law text: the index, the record and the version bump in one commit, then release and deploy", opts, () => {
  const r = setup();
  try {
    r.write("data/index/json/versions.json", '{"charter":{"currentThrough":"new"}}\n');
    r.write("data/fetch-provenance.json", '{"corpora":{"charter":{}}}\n');
    const { outputs } = r.runStep();
    assert.deepEqual(outputs, { deploy: "true", pushed: "true" });
    assert.equal(r.calls(), "prepare --soft\n", "auto-release.js prepare ran once");
    assert.deepEqual(r.committed(), ["data/fetch-provenance.json", "data/index/json/versions.json", "package.json"]);
    assert.match(r.git("log", "-1", "--format=%s"), /\(release v0\.7\.1\)$/);
  } finally {
    rmSync(r.dir, { recursive: true, force: true });
  }
});

test("nothing changed: no commit and no outputs", opts, () => {
  const r = setup();
  try {
    const before = r.git("rev-parse", "HEAD");
    const { outputs, stdout } = r.runStep();
    assert.deepEqual(outputs, {});
    assert.match(stdout, /no change after rebuild/);
    assert.equal(r.git("rev-parse", "HEAD"), before);
    assert.equal(r.calls(), "");
  } finally {
    rmSync(r.dir, { recursive: true, force: true });
  }
});

test("a push that fails sets no deploy (or pushed) output, so the deploy step cannot run", opts, () => {
  const r = setup();
  try {
    r.rejectPushes();
    r.write("data/structure/charter.json", '{"changed":true}\n');
    assert.deepEqual(r.runStep({ fails: true }).outputs, {}, "structure change, failed push: no outputs");

    const r2 = setup();
    try {
      r2.rejectPushes();
      r2.write("data/index/json/versions.json", '{"charter":{"currentThrough":"new"}}\n');
      assert.deepEqual(r2.runStep({ fails: true }).outputs, {}, "index change, failed push: no outputs");
    } finally {
      rmSync(r2.dir, { recursive: true, force: true });
    }
  } finally {
    rmSync(r.dir, { recursive: true, force: true });
  }
});
