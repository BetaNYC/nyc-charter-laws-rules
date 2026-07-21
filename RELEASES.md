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

## v0.2.0 — unreleased

- Unknown tool parameters are now **rejected instead of silently dropped** ([#19](https://github.com/BetaNYC/nyc-charter-laws-rules/issues/19)). Every advertised `inputSchema` sets `additionalProperties: false`, and every zod object parsing tool arguments is `.strict()`. Previously `search(query="open data", bogus_unknown_param="x")` returned normal § 23-507 results — real, correctly sourced data answering a different question, with nothing in the response signalling that a filter had been dropped. The refusal names the offending key and lists the parameters that tool does accept.
- Minor rather than patch: tool-call behavior visibly changes for any caller that was passing an undeclared parameter. No declared parameter was renamed or removed.

## v0.1.3 — 2026-07-06

- Fixed decimal-section citation truncation: citations like `11-602.1` no longer lose the `.1` suffix during index build, so decimal sections are searchable and retrievable by their full citation.
- `get_section` lookup improved: input is normalized (with or without `§`, any case, extra whitespace), a new optional `corpus` parameter (`charter` / `admin_code` / `rules`) scopes the lookup, and ambiguous citations now return a disambiguation list instead of an arbitrary single match.
- Search results are now relevance-ranked: heading matches rank above citation matches, which rank above body-text matches; whole-word matches rank above substring matches.
- `get_version` now reports currency date, section count, and index build timestamp per corpus (previously one shared "Index built" line).
- `get_title` matching is now whole-token (`Chapter 1` no longer matches `Chapter 10`).
- `search` `limit` parameter is validated as an integer between 1 and 50.
- `engines.node` relaxed from `>=20 <23` to `>=20`: the ceiling was pinned to the CI test matrix (20.x/22.x), not to any API the server uses, and wrongly excluded current Node releases.

## v0.1.2 — 2026-05-26

- Last release published manually, before tag-triggered automation was added.

## v0.1.1 — 2026-05-22

- Published manually.

## v0.1.0 — 2026-05-21

- Initial npm release.
