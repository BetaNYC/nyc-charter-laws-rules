#!/usr/bin/env node
// Automatic patch releases from the daily data refresh (issue #26, option 2).
//
// Called from .github/workflows/refresh-data.yml and release.yml. Node built-ins
// only. The decision logic is exported as pure functions and unit-tested in
// test/auto-release.test.js; the CLI wrappers below only do I/O.
//
// Subcommands:
//
//   prepare --date YYYY-MM-DD
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
//     on npm yet: push the vX.Y.Z tag at HEAD if it is missing, then dispatch
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

import { readFileSync, writeFileSync } from "node:fs";
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
  // at HEAD by the caller.
  const mine = (runs || []).filter((r) => r.headBranch === tag);
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

function cmdPrepare(argv) {
  const i = argv.indexOf("--date");
  const date = i >= 0 ? argv[i + 1] : null;
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error("prepare needs --date YYYY-MM-DD");

  const pkgPath = join(ROOT, "package.json");
  const lockPath = join(ROOT, "package-lock.json");
  const relPath = join(ROOT, "RELEASES.md");
  const pkg = readPkg();
  const releasesMd = readFileSync(relPath, "utf8");
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
    return;
  }

  const prevVersions = JSON.parse(sh("git", ["show", "HEAD:data/index/json/versions.json"]));
  const curVersions = JSON.parse(readFileSync(join(ROOT, "data", "index", "json", "versions.json"), "utf8"));
  const moves = corpusMoves(prevVersions, curVersions);

  writeFileSync(pkgPath, setPackageVersion(readFileSync(pkgPath, "utf8"), pkg.version, d.next));
  writeFileSync(lockPath, setLockVersion(readFileSync(lockPath, "utf8"), pkg.version, d.next));
  writeFileSync(relPath, insertReleaseEntry(releasesMd, releaseEntry(d.next, date, moves), d.next));
  log(`bumped ${pkg.version} -> ${d.next} (${moves.join("; ") || "no currentThrough move"})`);
  process.stdout.write(d.next + "\n");
}

function cmdEnsure() {
  const pkg = readPkg();
  const tag = `v${pkg.version}`;
  const releasesMd = readFileSync(join(ROOT, "RELEASES.md"), "utf8");
  const auto = isAutoRelease(releasesMd, pkg.version);
  const published = publishedVersions(pkg.name).includes(pkg.version);
  let runs = [];
  let tagSha = null;
  const headSha = sh("git", ["rev-parse", "HEAD"]);
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
    log(`pushing tag ${tag} at ${headSha}`);
    sh("git", ["tag", tag, headSha]);
    sh("git", ["push", "origin", `refs/tags/${tag}`]);
  }
  if (d.action === "dispatch") {
    // A tag pushed with GITHUB_TOKEN does not start release.yml's push trigger;
    // workflow_dispatch is the documented exception. See refresh-data.yml.
    sh("gh", ["workflow", "run", RELEASE_WORKFLOW, "--ref", tag], { stdio: ["ignore", "inherit", "inherit"] });
    log(`dispatched ${RELEASE_WORKFLOW} on ${tag}`);
  }
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

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
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
