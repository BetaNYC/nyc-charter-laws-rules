#!/usr/bin/env node
// Updates data/changelog.json and CHANGELOG.md after each index build.
// Run after build-index: npm run update-changelog
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

const CORPORA_LABELS = {
  charter: "NYC Charter",
  admin_code: "NYC Administrative Code",
  rules: "Rules of the City of New York",
};

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
