# Releases

Package release history for `@betanyc/nyc-charter-laws-rules`.

This file exists separately from [CHANGELOG.md](CHANGELOG.md) on purpose:
CHANGELOG.md is machine-generated — `scripts/update-changelog.js` regenerates it
in full from `data/changelog.json` after every corpus index rebuild (a daily
cron), so any hand-written release entries added there would be overwritten.
Corpus data updates live in CHANGELOG.md; package releases live here.

Releases are published by the tag-triggered workflow
(`.github/workflows/release.yml`): bump `version` in `package.json` on `main`,
add an entry below, then push a matching `vX.Y.Z` tag.

## Format

```markdown
## vX.Y.Z — YYYY-MM-DD

- Summary of user-facing changes since the previous release.
```

---

## v0.1.2 — 2026-05-26

- Last release published manually, before tag-triggered automation was added.

## v0.1.1 — 2026-05-22

- Published manually.

## v0.1.0 — 2026-05-21

- Initial npm release.
