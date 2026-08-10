#!/usr/bin/env node
// Updates data/changelog.json and CHANGELOG.md after each index build, and
// stamps the "Last index update" block in README.md.
//
// Run after build-index:   npm run update-changelog
//
// Records every index refresh — whether or not the corpus version changed.
// "changed: true" means at least one corpus has a new "currentThrough" string.

import { readFileSync, writeFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const VERSIONS_PATH = join(ROOT, "data", "index", "json", "versions.json");
const CHANGELOG_JSON_PATH = join(ROOT, "data", "changelog.json");
const CHANGELOG_MD_PATH = join(ROOT, "CHANGELOG.md");
const README_PATH = join(ROOT, "README.md");

// README marker block — rewritten in place on every run so the README always
// shows the latest rebuild. Text outside these markers is left untouched.
const README_START = "<!-- LATEST_INDEX_UPDATE:START -->";
const README_END = "<!-- LATEST_INDEX_UPDATE:END -->";

const CORPORA_LABELS = {
  charter: "NYC Charter",
  admin_code: "NYC Administrative Code",
  rules: "Rules of the City of New York",
};

// Splice the "Last index update" block (built from a changelog entry) between
// the README markers. No-op (with a warning) if README or markers are absent.
//
// Badge idempotence (2026-06-17): `entry.changed` is run-history-derived — it
// records whether THIS build advanced the version vs. the prior changelog entry,
// not the corpus's own state. So the badge word ("⬆️ Updated" vs "✓ No change")
// flips on the FIRST no-op rebuild after a real update lands: the prior entry
// already shows the new version, so `changed` computes false and the badge would
// re-stamp "✓ No change" over a committed "⬆️ Updated" — a one-line README diff
// with zero data change. To make a no-op rebuild produce a BYTE-IDENTICAL README,
// the caller skips the stamp entirely on a duplicate-of-prior run (see the call
// site at the bottom of this file), leaving the existing badge block untouched.
// The committed README already reflects the last ACTUAL change, which is exactly
// what the badge should show. Real version bumps re-stamp as before.
function stampReadme(entry) {
  if (!existsSync(README_PATH)) {
    console.error("README.md not found — skipping stamp.");
    return;
  }
  const readme = readFileSync(README_PATH, "utf8");
  const start = readme.indexOf(README_START);
  const end = readme.indexOf(README_END);
  if (start === -1 || end === -1) {
    console.error(
      `README markers not found (${README_START} / ${README_END}) — skipping stamp.`
    );
    return;
  }

  const statusBadge = entry.changed ? "⬆️ Updated" : "✓ No change";
  const rows = Object.values(entry.corpora).map(
    (c) => `| ${c.label} | ${c.currentThrough} | ${c.sectionCount.toLocaleString()} |`
  );
  const block = [
    README_START,
    `**Last index update:** ${entry.date} — ${statusBadge}`,
    ``,
    `| Corpus | Current through | Sections |`,
    `|---|---|---|`,
    ...rows,
    README_END,
  ].join("\n");

  const updated =
    readme.slice(0, start) + block + readme.slice(end + README_END.length);
  writeFileSync(README_PATH, updated);
  console.log(`Stamped README.md "Last index update" → ${entry.date} (${statusBadge})`);
}

// ── Load current versions ────────────────────────────────────────────────────

if (!existsSync(VERSIONS_PATH)) {
  console.error("versions.json not found — run npm run build-index first.");
  process.exit(1);
}

const versions = JSON.parse(readFileSync(VERSIONS_PATH, "utf8"));

// ── Load existing changelog (or start fresh) ─────────────────────────────────

const changelog = existsSync(CHANGELOG_JSON_PATH)
  ? JSON.parse(readFileSync(CHANGELOG_JSON_PATH, "utf8"))
  : { entries: [] };

const prior = changelog.entries[0] ?? null;

// ── Build new entry ───────────────────────────────────────────────────────────

const corporaEntries = {};
let anyChanged = false;

for (const [key, data] of Object.entries(versions)) {
  const prevThrough = prior?.corpora?.[key]?.currentThrough ?? null;
  const changed = prevThrough !== null && prevThrough !== data.currentThrough;
  if (changed) anyChanged = true;

  corporaEntries[key] = {
    label: CORPORA_LABELS[key] ?? key,
    currentThrough: data.currentThrough,
    sectionCount: data.sectionCount,
    indexedAt: data.indexedAt,
    previousThrough: prevThrough,
    changed,
  };
}

// Use the latest indexedAt across corpora as the entry timestamp.
const indexBuiltAt = Object.values(versions)
  .map((v) => v.indexedAt)
  .sort()
  .at(-1);

const entry = {
  date: indexBuiltAt.slice(0, 10),
  indexBuiltAt,
  changed: anyChanged,
  corpora: corporaEntries,
};

// Idempotence (commit-churn fix, 2026-06): a no-op rebuild now preserves the
// prior `indexedAt` in versions.json (see scripts/lib/merge-versions.js), so a
// fresh build with no content change carries the same date + per-corpus content
// (currentThrough / sectionCount / indexedAt) as the existing newest entry.
// Prepending it would duplicate the entry and churn changelog.json /
// CHANGELOG.md on every refresh. Skip the prepend when the new entry's CONTENT
// matches the current newest one; the files are then rewritten byte-identically
// below (zero git diff).
//
// We compare only content-bearing fields, NOT `previousThrough` — that field is
// derivative bookkeeping that legitimately differs between the first build of a
// version (previousThrough: null) and a re-build of the same version
// (previousThrough: <that version>). Comparing it would defeat the guard.
function contentFingerprint(e) {
  return JSON.stringify({
    date: e.date,
    corpora: Object.fromEntries(
      Object.entries(e.corpora).map(([k, c]) => [
        k,
        {
          currentThrough: c.currentThrough,
          sectionCount: c.sectionCount,
          indexedAt: c.indexedAt,
        },
      ])
    ),
  });
}

const isDuplicateOfPrior =
  prior !== null && contentFingerprint(entry) === contentFingerprint(prior);

if (isDuplicateOfPrior) {
  // No-op rebuild: the newest changelog entry already carries this exact
  // content, and the committed changelog.json / CHANGELOG.md / README badge
  // block already reflect it. Skip all writes so every file stays
  // byte-identical (zero git diff).
  console.log(
    "No change since last index entry — changelog already current, not appending a duplicate."
  );
  console.log(
    "Leaving changelog.json, CHANGELOG.md, and the README badge block as-is (byte-identical)."
  );
  process.exit(0);
}

// Prepend — most recent first.
changelog.entries.unshift(entry);

// ── Write changelog.json ──────────────────────────────────────────────────────

writeFileSync(CHANGELOG_JSON_PATH, JSON.stringify(changelog, null, 2));
console.log(`Updated data/changelog.json (${changelog.entries.length} entries)`);

// ── Regenerate CHANGELOG.md ───────────────────────────────────────────────────

const lines = [
  `# Changelog`,
  ``,
  `Tracks every index rebuild of the NYC Charter, Administrative Code, and Rules of the City of New York.`,
  `Each entry records which corpus version was current at the time of the build.`,
  ``,
  `"Changed" means the \`currentThrough\` version string advanced since the prior build.`,
  ``,
  `This file is machine-generated and covers corpus data only. Package release history lives in [RELEASES.md](RELEASES.md).`,
  ``,
  `---`,
  ``,
];

for (const e of changelog.entries) {
  const statusBadge = e.changed ? "⬆️ **Updated**" : "✓ No change";
  lines.push(`## ${e.date}`);
  lines.push(``);
  lines.push(`**Index built:** ${e.indexBuiltAt}  `);
  lines.push(`**Status:** ${statusBadge}`);
  lines.push(``);
  lines.push(`| Corpus | Current through | Sections | Changed |`);
  lines.push(`|---|---|---|---|`);

  for (const [, c] of Object.entries(e.corpora)) {
    const changedFlag = c.changed ? "✅ Yes" : "—";
    lines.push(`| ${c.label} | ${c.currentThrough} | ${c.sectionCount.toLocaleString()} | ${changedFlag} |`);
  }

  // Show what changed, if anything.
  if (e.changed) {
    lines.push(``);
    lines.push(`**What changed:**`);
    lines.push(``);
    for (const [, c] of Object.entries(e.corpora)) {
      if (c.changed) {
        lines.push(`- **${c.label}:** ${c.previousThrough} → ${c.currentThrough}`);
      }
    }
  }

  lines.push(``);
  lines.push(`---`);
  lines.push(``);
}

writeFileSync(CHANGELOG_MD_PATH, lines.join("\n"));
console.log(`Regenerated CHANGELOG.md`);

// ── Stamp README "Last index update" block ────────────────────────────────────
stampReadme(entry);

// ── Summary ───────────────────────────────────────────────────────────────────

if (anyChanged) {
  console.log(`\n⬆️  Version change detected:`);
  for (const [, c] of Object.entries(corporaEntries)) {
    if (c.changed) {
      console.log(`  ${c.label}`);
      console.log(`    was: ${c.previousThrough}`);
      console.log(`    now: ${c.currentThrough}`);
    }
  }
} else {
  console.log(`\n✓ No version change — index refreshed, versions unchanged.`);
}
