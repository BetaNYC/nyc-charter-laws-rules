// Idempotence helper for the index build (commit-churn fix, 2026-06).
//
// Problem: build-index.js stamps a fresh `indexedAt` wall-clock timestamp into
// versions.json on every run, so a rebuild with NO source-content change still
// produced a non-empty git diff (and cascaded into changelog.json / CHANGELOG.md
// / the README stamp). That forced refresh commits to hand-exclude these files.
//
// Fix: treat `indexedAt` as "as of when the content was last indexed", not "when
// this process ran". A corpus's content is considered unchanged when both its
// `currentThrough` version string and its `sectionCount` match the prior build.
// For unchanged corpora we PRESERVE the prior `indexedAt`; only when the content
// actually changed do we adopt the freshly-stamped timestamp.
//
// Result: a no-op rebuild yields byte-identical versions.json (zero git diff),
// while a real content change still advances `indexedAt`. The MCP output shape
// ({ currentThrough, indexedAt, sectionCount } per corpus) is unchanged.

// Two corpus entries have the same *content* when the version string and the
// section count match. (indexedAt is deliberately excluded — it is the field we
// are stabilizing.)
function sameContent(a, b) {
  return (
    a != null &&
    b != null &&
    a.currentThrough === b.currentThrough &&
    a.sectionCount === b.sectionCount
  );
}

/**
 * Merge freshly-built versions with the prior versions.json, preserving the
 * prior `indexedAt` for any corpus whose content did not change.
 *
 * @param {Record<string, {currentThrough: string, indexedAt: string, sectionCount: number}>} fresh
 *        Newly built versions (each with a just-stamped `indexedAt`).
 * @param {Record<string, object>|null} prior
 *        The previously committed versions.json contents, or null on first build.
 * @returns {Record<string, {currentThrough: string, indexedAt: string, sectionCount: number}>}
 *        A merged object: unchanged corpora keep their prior `indexedAt`;
 *        changed (or new) corpora keep the fresh `indexedAt`.
 */
export function mergeVersions(fresh, prior) {
  const merged = {};
  for (const [key, freshEntry] of Object.entries(fresh)) {
    const priorEntry = prior?.[key] ?? null;
    const indexedAt = sameContent(freshEntry, priorEntry)
      ? priorEntry.indexedAt
      : freshEntry.indexedAt;
    merged[key] = {
      currentThrough: freshEntry.currentThrough,
      indexedAt,
      sectionCount: freshEntry.sectionCount,
    };
  }
  return merged;
}
