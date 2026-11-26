#!/usr/bin/env node
// Was the committed index built by the build code at this commit? (issue #95)
//
//   node scripts/check-index-build.js          exit 1 when not (release.yml, before npm publish)
//   node scripts/check-index-build.js --warn   say so as a warning and exit 0 (the test workflow)
//   ... --root DIR                             check another checkout (tests)
//
// Compares data/index-build.json, which build-index.js writes, with the build code checked out
// here (scripts/lib/index-build-record.js). The daily refresh rebuilds the index with the code on
// main and commits it, so a stale index fixes itself by the next morning. Node built-ins only.

import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { checkIndexBuild, RECORD_PATH } from "./lib/index-build-record.js";

const args = process.argv.slice(2);
const warn = args.includes("--warn");
// --root DIR: check another checkout (the tests use a fixture tree).
const rootAt = args.indexOf("--root");
const ROOT = rootAt >= 0 ? args[rootAt + 1] : join(dirname(fileURLToPath(import.meta.url)), "..");
const unknown = args.filter((a, i) => a !== "--warn" && !(rootAt >= 0 && (i === rootAt || i === rootAt + 1)));
if (unknown.length || !ROOT) {
  console.error(`check-index-build: unknown argument ${unknown.join(" ")}. Usage: node scripts/check-index-build.js [--warn] [--root DIR]`);
  process.exit(2);
}

const { ok, problems } = checkIndexBuild(ROOT);
if (ok) {
  console.log(`check-index-build: the committed index was built by this commit's build code (${RECORD_PATH}).`);
  process.exit(0);
}

const WHAT_TO_DO =
  "Wait for the daily refresh (Refresh Data, 11:00 UTC) to rebuild and commit the index with the code on main, " +
  "or start it now: gh workflow run refresh-data.yml -R BetaNYC/nyc-charter-laws-rules. " +
  "Then release from a commit that includes the refresh's commit. " +
  "If this stopped a release, nothing was published: see RELEASES.md, \"Manual releases\".";

const level = warn ? "warning" : "error";
const lines = [
  "The bundled index (data/index/) was not built by the build code at this commit, so a release would ship text the code does not describe.",
  ...problems.map((p) => `- ${p}`),
  WHAT_TO_DO,
];
if (process.env.GITHUB_ACTIONS === "true") {
  // One annotation (a workflow command is one line), then the readable lines in the log.
  console.log(`::${level} title=Index not built by this code::${lines[0]} ${WHAT_TO_DO}`);
}
for (const l of lines) (warn ? console.log : console.error)(`check-index-build: ${l}`);
process.exit(warn ? 0 : 1);
