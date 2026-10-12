#!/usr/bin/env node
// Automatic patch releases from the daily data refresh (issue #26, option 2).
//
// Called from .github/workflows/refresh-data.yml and release.yml. Node built-ins
// only. The decision logic is exported as pure functions and unit-tested in
// test/auto-release.test.js; the CLI wrappers below only do I/O.
//
// Subcommands:
//
//   prepare [--date YYYY-MM-DD] [--soft]
//     --date defaults to today in New York. --soft (used by refresh-data.yml):
//     on any failure, leave the version files untouched, emit a ::warning::,
//     write prepare_failed=true to $GITHUB_OUTPUT and exit 0, so the law data
//     is still committed; the workflow turns the run red afterwards.
//     Run AFTER the refresh produced a data change, BEFORE the commit. If the
//     current package.json version is already on npm, bump the patch version in
//     package.json + package-lock.json and add a dated RELEASES.md entry naming
//     which corpora's "current through" moved (versions.json at HEAD vs. the
//     working tree). Prints the new version on stdout, or nothing when it does
//     not bump. It does NOT bump when the current version is unpublished: that
//     is either a human's pending release (a hand bump on main awaiting its tag)
//     or an automatic release still in flight, and bumping past it would skip a
//     version. Fails loudly if the next version is already tagged or published.
//
//   ensure
//     Run on EVERY refresh, after the commit step. If package.json's version is
//     an automatic release (its RELEASES.md entry carries AUTO_MARKER) and is not
//     on npm yet: create the vX.Y.Z tag on the bump commit via the GitHub API if
//     it is missing (the checkout is depth 1), then dispatch
//     release.yml for that tag, unless a release run for the tag is already
//     queued, running, or succeeded. If every earlier run for the tag failed, it
//     exits non-zero so the refresh goes red too, naming the run to rerun. This
//     makes a rerun of a half-finished refresh (commit pushed, tag or dispatch
//     not) converge without double-bumping or re-tagging.
//
//   check-publish-env
//     Fails unless node >= 22.14.0 and npm >= 11.5.1, the minimums for npm
//     trusted publishing (https://docs.npmjs.com/trusted-publishers: "Trusted
//     publishing requires npm CLI version 11.5.1 or later and Node version
//     22.14.0 or higher.").
//
//   is-published <version>
//     Prints "true" or "false". Exits non-zero if the registry cannot be read,
//     so a network failure is never mistaken for "not published".

import { readFileSync, writeFileSync, appendFileSync, realpathSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

export const AUTO_MARKER = "Automatic data release.";
export const MIN_NODE = "22.14.0";
export const MIN_NPM = "11.5.1";
const RELEASE_WORKFLOW = "release.yml";

const CORPUS_LABELS = {
  charter: "Charter",
  admin_code: "Admin Code",
  rules: "Rules",
};

// ---------------------------------------------------------------- pure logic

/** Today's date in New York (RELEASES.md dates are America/New_York). */
export function newYorkDate(now = new Date()) {
  // en-CA formats as YYYY-MM-DD.
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

/** Suffix refresh-data.yml appends to the bump commit's subject. */
export function releaseMarker(version) {
  return `(release v${version})`;
}

/** First commit (REST "List commits" rows, newest first) whose message carries the marker. */
export function findBumpCommit(commits, version) {
  const marker = releaseMarker(version);
  const hit = (commits || []).find((c) => (c?.commit?.message || "").split("\n")[0].includes(marker));
  return hit ? hit.sha : null;
}

/** Parse "X.Y.Z" (no prerelease/build); throws on anything else. */
export function parseVersion(v) {
  const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(String(v).trim());
  if (!m) throw new Error(`not a plain X.Y.Z version: ${JSON.stringify(v)}`);
  return m.slice(1).map(Number);
}

export function nextPatch(v) {
  const [a, b, c] = parseVersion(v);
  return `${a}.${b}.${c + 1}`;
}

/** Compare dotted numeric versions, ignoring any "-pre" suffix. */
export function versionAtLeast(actual, minimum) {
  const nums = (s) => String(s).trim().replace(/^v/, "").split("-")[0].split(".").map(Number);
  const a = nums(actual);
  const b = nums(minimum);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    if (Number.isNaN(x)) return false;
    if (x !== y) return x > y;
  }
  return true;
}

/** Shorten a versions.json currentThrough string for a one-line summary. */
export function shortThrough(s) {
  if (!s) return s;
  const ll = s.match(/Local Law\s+(\d+\/\d+)/i);
  if (ll) return "LL " + ll[1];
  const r = s.match(/rules effective\s+(.+?)\.?$/i);
  if (r) return "eff. " + r[1];
  return s.trim().replace(/[.,]$/, "");
}

/** Corpora whose currentThrough differs between two versions.json objects. */
export function corpusMoves(prev, cur) {
  const moves = [];
  for (const [key, c] of Object.entries(cur || {})) {
    const label = CORPUS_LABELS[key] || key;
    const before = prev?.[key]?.currentThrough;
    const after = c?.currentThrough;
    if (!after || before === after) continue;
    moves.push(before ? `${label} ${shortThrough(before)} -> ${shortThrough(after)}` : `${label} ${shortThrough(after)}`);
  }
  return moves;
}

export function releaseEntry(version, date, moves) {
  const what = moves.length
    ? `Bundled law text refreshed: ${moves.join("; ")}.`
    : "Bundled law text refreshed; no corpus's \"current through\" line moved.";
  return `## v${version} — ${date}\n\n- ${AUTO_MARKER} ${what} No code changes beyond what was already merged to \`main\`.\n`;
}

/** Return the RELEASES.md section body for a version, or null. */
export function findReleaseSection(md, version) {
  const lines = md.split("\n");
  const head = `## v${version} `;
  const start = lines.findIndex((l) => l.startsWith(head) || l === `## v${version}`);
  if (start === -1) return null;
  let end = lines.findIndex((l, i) => i > start && l.startsWith("## "));
  if (end === -1) end = lines.length;
  return lines.slice(start, end).join("\n");
}

export function isAutoRelease(md, version) {
  const section = findReleaseSection(md, version);
  return section !== null && section.includes(AUTO_MARKER);
}

/**
 * Insert an entry above the newest "## vX" heading (below the Format block and
 * its "---" rule). Throws if the version already has an entry.
 */
export function insertReleaseEntry(md, entry, version) {
  if (findReleaseSection(md, version) !== null) {
    throw new Error(`RELEASES.md already has an entry for v${version}`);
  }
  const lines = md.split("\n");
  const firstRelease = lines.findIndex((l) => /^## v\d/.test(l));
  if (firstRelease === -1) throw new Error("RELEASES.md has no '## vX.Y.Z' heading to insert above");
  lines.splice(firstRelease, 0, ...entry.trimEnd().split("\n"), "");
  return lines.join("\n");
}

/** Set "version" in a package.json text, preserving formatting. */
export function setPackageVersion(text, from, to) {
  const re = new RegExp(`("version":\\s*")${from.replace(/\./g, "\\.")}(")`);
  if (!re.test(text)) throw new Error(`package.json: version ${from} not found`);
  const out = text.replace(re, `$1${to}$2`);
  if (JSON.parse(out).version !== to) throw new Error("package.json: version rewrite failed");
  return out;
}

/** Set the root version in a v2/v3 package-lock.json text, preserving formatting. */
export function setLockVersion(text, from, to) {
  const lock = JSON.parse(text);
  if (lock.version !== from || lock.packages?.[""]?.version !== from) {
    throw new Error(`package-lock.json: expected root version ${from}, found ${lock.version} / ${lock.packages?.[""]?.version}`);
  }
  lock.version = to;
  lock.packages[""].version = to;
  const indent = /\n(\s+)"/.exec(text)?.[1] ?? "  ";
  return JSON.stringify(lock, null, indent) + (text.endsWith("\n") ? "\n" : "");
}

/** `npm view <pkg> versions --json` prints a string for one version, an array otherwise. */
export function parsePublishedVersions(stdout) {
  const v = JSON.parse(stdout);
  return Array.isArray(v) ? v : [v];
}

const ACTIVE = new Set(["queued", "in_progress", "waiting", "requested", "pending"]);

/**
 * Decide what `ensure` should do. Inputs are already-fetched facts.
 *   runs: `gh run list --workflow release.yml --json ...` rows
 * Returns { action: "none" | "dispatch" | "fail", tag: bool, reason }.
 */
export function decideEnsure({ version, auto, published, remoteTagSha, runs }) {
  const tag = `v${version}`;
  if (!auto) {
    return {
      action: "none",
      tag: false,
      reason: published
        ? `${tag} is published; nothing to do`
        : `${tag} is not on npm, but it is not an automatic release (no "${AUTO_MARKER}" entry in RELEASES.md); release it by hand`,
      warn: !published,
    };
  }
  if (published) return { action: "none", tag: false, reason: `${tag} is already on npm` };
  // An existing tag is never moved or re-created, even if main has moved on
  // since it was pushed: release.yml publishes what the tag points at and
  // re-checks that its package.json version matches. A missing tag is pushed
  // on the bump commit by the caller.
  // A run belongs to this release if it ran on the tag. Match on the tag name
  // (head_branch, which is the tag for tag-push runs) OR on the tag's commit
  // (head_sha), so the check does not depend on how GitHub fills head_branch
  // for a dispatched run.
  const mine = (runs || []).filter((r) => r.headBranch === tag || (remoteTagSha && r.headSha === remoteTagSha));
  const active = mine.find((r) => ACTIVE.has(r.status));
  if (active) return { action: "none", tag: false, reason: `release run ${active.databaseId} for ${tag} is ${active.status}` };
  const ok = mine.find((r) => r.status === "completed" && r.conclusion === "success");
  if (ok) {
    return { action: "none", tag: false, reason: `release run ${ok.databaseId} for ${tag} succeeded; npm may not list it yet` };
  }
  if (mine.length > 0) {
    const last = mine[0];
    return {
      action: "fail",
      tag: false,
      reason: `${tag} is not on npm and its release run ${last.databaseId} ended "${last.conclusion}". Rerun it: gh run rerun ${last.databaseId} --failed (or Actions > Release > Re-run). Do not bump or re-tag.`,
    };
  }
  return { action: "dispatch", tag: !remoteTagSha, reason: `dispatching ${RELEASE_WORKFLOW} for ${tag}` };
}

/**
 * Decide what `prepare` should do.
 * Returns { bump: false, reason, warn } or { bump: true, next }.
 */
export function decidePrepare({ version, published, nextTagExists, releasesMd }) {
  if (!published.includes(version)) {
    return {
      bump: false,
      warn: true,
      reason: `v${version} is not on npm yet (a pending manual release, or an automatic one still in flight); committing data without a new version`,
    };
  }
  const next = nextPatch(version);
  if (published.includes(next)) throw new Error(`v${next} is already on npm but package.json says ${version}; fix package.json by hand`);
  if (nextTagExists) throw new Error(`tag v${next} already exists but package.json says ${version}; fix by hand`);
  if (findReleaseSection(releasesMd, next) !== null) throw new Error(`RELEASES.md already has v${next}; fix by hand`);
  return { bump: true, next };
}

// ---------------------------------------------------------------- I/O wrappers

function sh(cmd, args, opts = {}) {
  const out = execFileSync(cmd, args, { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "inherit"], ...opts });
  return (out ?? "").trim(); // null when stdout is inherited
}

const log = (msg) => process.stderr.write(`auto-release: ${msg}\n`);
const annotate = (level, msg) => process.stderr.write(`::${level}::auto-release: ${msg}\n`);

function readPkg() {
  return JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
}

function publishedVersions(name) {
  // Exits non-zero (and throws here) on a network/registry failure — never
  // treat an unreadable registry as "not published".
  return parsePublishedVersions(sh("npm", ["view", name, "versions", "--json"]));
}

function remoteTagSha(tag) {
  const out = sh("git", ["ls-remote", "--tags", "origin", `refs/tags/${tag}`]);
  return out ? out.split(/\s+/)[0] : null;
}

function argValue(argv, flag) {
  const i = argv.indexOf(flag);
  return i >= 0 ? argv[i + 1] : null;
}

/** Append key=value lines to $GITHUB_OUTPUT when running in Actions. */
function setOutputs(pairs) {
  const file = process.env.GITHUB_OUTPUT;
  if (!file) return;
  const lines = Object.entries(pairs).map(([k, v]) => `${k}=${String(v).replace(/[\r\n]+/g, " ")}`);
  appendFileSync(file, lines.join("\n") + "\n");
}

function prepare(date) {
  const pkgPath = join(ROOT, "package.json");
  const lockPath = join(ROOT, "package-lock.json");
  const relPath = join(ROOT, "RELEASES.md");
  const pkgText = readFileSync(pkgPath, "utf8");
  const lockText = readFileSync(lockPath, "utf8");
  const releasesMd = readFileSync(relPath, "utf8");
  const pkg = JSON.parse(pkgText);
  const published = publishedVersions(pkg.name);
  const next = nextPatch(pkg.version);

  const d = decidePrepare({
    version: pkg.version,
    published,
    nextTagExists: remoteTagSha(`v${next}`) !== null,
    releasesMd,
  });
  if (!d.bump) {
    annotate("warning", d.reason);
    return "";
  }

  const prevVersions = JSON.parse(sh("git", ["show", "HEAD:data/index/json/versions.json"]));
  const curVersions = JSON.parse(readFileSync(join(ROOT, "data", "index", "json", "versions.json"), "utf8"));
  const moves = corpusMoves(prevVersions, curVersions);

  // Compute every new file before writing any, so a validation error can never
  // leave a half-bumped tree (package.json bumped, lock not).
  const out = [
    [pkgPath, setPackageVersion(pkgText, pkg.version, d.next), pkgText],
    [lockPath, setLockVersion(lockText, pkg.version, d.next), lockText],
    [relPath, insertReleaseEntry(releasesMd, releaseEntry(d.next, date, moves), d.next), releasesMd],
  ];
  try {
    for (const [path, text] of out) writeFileSync(path, text);
  } catch (e) {
    for (const [path, , original] of out) writeFileSync(path, original);
    throw e;
  }
  log(`bumped ${pkg.version} -> ${d.next} (${moves.join("; ") || "no currentThrough move"})`);
  return d.next;
}

function cmdPrepare(argv) {
  const date = argValue(argv, "--date") ?? newYorkDate();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error("--date must be YYYY-MM-DD");
  const soft = argv.includes("--soft");
  let version = "";
  try {
    version = prepare(date);
  } catch (e) {
    if (!soft) throw e;
    // --soft (refresh-data.yml): the law data must still be committed even when
    // the release cannot be prepared. Leave the version files untouched, warn
    // now, and record the failure so a later step turns the run red.
    annotate("warning", `release not prepared, committing data without a version bump: ${e.message}`);
    setOutputs({ prepare_failed: "true", prepare_error: e.message });
    return;
  }
  if (version) process.stdout.write(version + "\n");
}

function cmdEnsure() {
  const repo = process.env.GITHUB_REPOSITORY;
  if (!repo || !/^[^/\s]+\/[^/\s]+$/.test(repo)) {
    throw new Error("ensure must run in GitHub Actions: GITHUB_REPOSITORY (owner/repo) is not set");
  }
  const pkg = readPkg();
  const tag = `v${pkg.version}`;
  const releasesMd = readFileSync(join(ROOT, "RELEASES.md"), "utf8");
  const auto = isAutoRelease(releasesMd, pkg.version);
  const published = publishedVersions(pkg.name).includes(pkg.version);
  let runs = [];
  let tagSha = null;
  if (auto && !published) {
    tagSha = remoteTagSha(tag);
    runs = JSON.parse(
      sh("gh", ["run", "list", "--workflow", RELEASE_WORKFLOW, "--limit", "100", "--json", "databaseId,headBranch,headSha,status,conclusion,event"]),
    );
  }
  const d = decideEnsure({ version: pkg.version, auto, published, remoteTagSha: tagSha, runs });
  if (d.warn) annotate("warning", d.reason);
  else log(d.reason);

  if (d.action === "fail") {
    annotate("error", d.reason);
    process.exitCode = 1;
    return;
  }
  if (d.tag) {
    const target = bumpCommitSha(pkg.version, repo);
    // Create the tag on GitHub, not locally: the checkout is depth 1, so the
    // bump commit is usually absent here on a recovery run and `git tag` would
    // fail ("nonexistent object"). REST "Create a reference",
    // POST /repos/{owner}/{repo}/git/refs with `ref` ("fully qualified
    // reference") and `sha`; needs Contents: write; 422 if it already exists.
    // https://docs.github.com/en/rest/git/refs#create-a-reference
    // A lightweight tag, same as `git tag vX.Y.Z && git push` for a manual
    // release; release.yml only needs github.ref_name to match package.json.
    log(`creating tag ${tag} at ${target} via the GitHub API`);
    sh("gh", ["api", "--method", "POST", `repos/${repo}/git/refs`, "-f", `ref=refs/tags/${tag}`, "-f", `sha=${target}`], {
      stdio: ["ignore", "ignore", "inherit"],
    });
  }
  if (d.action === "dispatch") {
    // A tag pushed with GITHUB_TOKEN does not start release.yml's push trigger;
    // workflow_dispatch is the documented exception. See refresh-data.yml.
    sh("gh", ["workflow", "run", RELEASE_WORKFLOW, "--ref", tag], { stdio: ["ignore", "inherit", "inherit"] });
    log(`dispatched ${RELEASE_WORKFLOW} on ${tag}`);
  }
}

/**
 * The commit that bumped package.json to `version` (its message carries
 * releaseMarker(version)), so a tag pushed on a later recovery run still lands
 * on the release commit, not on a later data-only commit. The checkout is
 * depth 1, so ask GitHub: REST "List commits" with `sha` (start point) and
 * `path` ("Only commits containing this file path will be returned"),
 * https://docs.github.com/en/rest/commits/commits#list-commits.
 * Falls back to HEAD (whose package.json is the same version) with a warning.
 */
function bumpCommitSha(version, repo) {
  const head = sh("git", ["rev-parse", "HEAD"]);
  try {
    const commits = JSON.parse(sh("gh", ["api", `repos/${repo}/commits?sha=${head}&path=package.json&per_page=30`]));
    const found = findBumpCommit(commits, version);
    if (found) return found;
    annotate("warning", `bump commit for v${version} not found among recent package.json commits; tagging HEAD ${head}`);
  } catch (e) {
    annotate("warning", `could not list package.json commits (${e.message}); tagging HEAD ${head}`);
  }
  return head;
}

function cmdCheckPublishEnv() {
  const node = process.versions.node;
  const npm = sh("npm", ["--version"]);
  const bad = [];
  if (!versionAtLeast(node, MIN_NODE)) bad.push(`node ${node} < ${MIN_NODE}`);
  if (!versionAtLeast(npm, MIN_NPM)) bad.push(`npm ${npm} < ${MIN_NPM}`);
  if (bad.length) {
    annotate("error", `trusted publishing needs ${bad.join(", ")} (https://docs.npmjs.com/trusted-publishers)`);
    process.exitCode = 1;
    return;
  }
  log(`node ${node}, npm ${npm}: OK for trusted publishing`);
}

function cmdIsPublished(argv) {
  const v = argv[0];
  parseVersion(v);
  process.stdout.write(String(publishedVersions(readPkg().name).includes(v)) + "\n");
}

// Compare real paths: argv[1] may go through a symlink (e.g. macOS /var -> /private/var).
const isMain = (() => {
  try {
    return Boolean(process.argv[1]) && realpathSync(fileURLToPath(import.meta.url)) === realpathSync(process.argv[1]);
  } catch {
    return false;
  }
})();
if (isMain) {
  const [cmd, ...rest] = process.argv.slice(2);
  const cmds = {
    prepare: () => cmdPrepare(rest),
    ensure: cmdEnsure,
    "check-publish-env": cmdCheckPublishEnv,
    "is-published": () => cmdIsPublished(rest),
  };
  if (!cmds[cmd]) {
    process.stderr.write(`usage: auto-release.js ${Object.keys(cmds).join(" | ")}\n`);
    process.exit(2);
  }
  try {
    cmds[cmd]();
  } catch (e) {
    annotate("error", e.message);
    process.exit(1);
  }
}
