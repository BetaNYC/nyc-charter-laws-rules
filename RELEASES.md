# Releases

Package release history for `@betanyc/nyc-charter-laws-rules`.

This file exists separately from [CHANGELOG.md](CHANGELOG.md) on purpose:
CHANGELOG.md is machine-generated — `scripts/update-changelog.js` regenerates it
in full from `data/changelog.json` after every corpus index rebuild (a daily
cron), so any hand-written release entries added there would be overwritten.
Corpus data updates live in CHANGELOG.md; package releases live here.

Releases are published by `.github/workflows/release.yml`, the only workflow
that publishes to npm. There are two kinds:

- **Automatic data releases.** When the daily refresh
  (`.github/workflows/refresh-data.yml`) commits new law text, it bumps the
  patch version, adds an entry below beginning "Automatic data release.", pushes
  the `vX.Y.Z` tag and starts `release.yml` on it. No new text, no release. The
  entry names which corpora's "current through" line moved. An automatic release
  ships `main` as it stands, including any code merged since the last release.
- **Manual releases.** Bump `version` in `package.json` on `main`, add an entry
  below, then push a matching `vX.Y.Z` tag. While a hand-bumped version is
  unpublished, the refresh does not bump past it.

If a release fails, its run goes red, and every following refresh goes red too
until the version is published. Fix the cause and rerun the failed Release run
(Actions → Release → Re-run, or `gh run rerun <id> --failed`). Never re-tag or
bump to recover. Setup for npm trusted publishing is in the README, "Releases".

## Format

Dates are New York (America/New_York).

```markdown
## vX.Y.Z — YYYY-MM-DD

- Summary of user-facing changes since the previous release.
```

---

## v0.3.1 — 2026-10-11

- No change to the server or the law text. This release checks the new publishing setup (npm trusted publishing) and adds the automatic data releases from [#29](https://github.com/BetaNYC/nyc-charter-laws-rules/pull/29) to the published repo.

## v0.3.0 — 2026-10-11

- **Current law text without waiting for a release** ([#26](https://github.com/BetaNYC/nyc-charter-laws-rules/issues/26)). Set `NYC_LAWS_INDEX_DIR` to a directory laid out like `data/index/json/` (for example a sparse clone of this repo kept current with `git pull`) and the server serves that index instead of the one bundled in the package. A set but invalid directory stops the server at startup with a message naming the variable; it never falls back silently. See the README, "Getting current law text."
- **Bundled text refreshed.** This release ships the index as of its publish date. 0.2.0 carried Charter text through LL 2026/112, Admin Code through LL 2026/116 and Rules effective July 14, 2026.
- **Subdivision labels are separated from their text** ([#27](https://github.com/BetaNYC/nyc-charter-laws-rules/issues/27)). `a.There shall be…` is now `a. There shall be…`, and the same for `(1)`, `(a)`, `13-a.`, bullets and table cells. The AML source separates them with an empty `<TAB/>` element (and lines with `<LINEBRK/>`), which the parser had rendered as nothing. Before the fix the issue's pattern matched 333 Charter, 3,122 Admin Code and 192 Rules sections; it now matches none except four Admin Code sections whose source text has no separator at all. No space is inserted before `,`, `;` or `:`. Section text changed across all three corpora; ids, citations, headings and section counts did not.
- **Known source quirks.** Text is reproduced as AML publishes it, so a few source errors now show as a stray space where they used to show as a fused word. Example: Rules § 31-01 has a tab inside "map" in the source (`Tax ma<TAB/>p.`), which reads `Tax ma p.`. Collapsing separators between two letters would fix that one case but re-fuse about 1,200 real word boundaries (table cells, line breaks), so it is left faithful. A separator before `.` likewise keeps its space (`ditto . . . .` is a dot leader in the source).
- `serverInfo.version` now reports the package version. It was hard-coded `0.1.0` through 0.2.0.
- Minor rather than patch: a new configuration option, and `search` / `get_section` text output changes visibly for thousands of sections. No tool, parameter or response field was renamed or removed.

## v0.2.0 — 2026-07-21

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

## v0.1.2 — 2026-05-25

- Last release published manually, before tag-triggered automation was added.

## v0.1.1 — 2026-05-21

- Published manually.

## v0.1.0 — 2026-05-21

- Initial npm release.
