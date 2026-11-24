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
- **Manual releases.** Bump the version on `main` in `package.json`,
  `package-lock.json` and `server.json` (both of its `version` fields), add an
  entry below headed `## vX.Y.Z — Unreleased`, then push a matching `vX.Y.Z`
  tag. While a hand-bumped version is unpublished, the refresh does not bump
  past it, so npm users get no new law text. It keeps committing the text to
  `main`, and once the hand release has been on `main` for more than two days
  (New York dates) every refresh run goes red until the version is published. A release a reader would notice also adds a `## Unreleased: Title`
  entry to [WHATS-CHANGED.md](WHATS-CHANGED.md) in the same pull request. On
  release day, one commit dates both headings (New York date), and the tag goes
  on that commit; `release.yml` refuses to publish while either still says
  Unreleased. Steps: README, "Releases".

Automatic data releases never get a WHATS-CHANGED.md entry: daily law text is
recorded in CHANGELOG.md. The refresh does not release automatically while
WHATS-CHANGED.md has an Unreleased entry (see `scripts/auto-release.js`).

If a release fails, its run goes red, and every following refresh goes red too
until the version is published. Fix the cause and rerun the failed Release run
(Actions → Release → Re-run, or `gh run rerun <id> --failed`). Never re-tag or
bump to recover. Setup for npm trusted publishing is in the README, "Releases".

## Format

Dates are New York (America/New_York). A hand-bumped version is headed
`## vX.Y.Z — Unreleased` until the release commit gives it the date.

```markdown
## vX.Y.Z — YYYY-MM-DD

- Summary of user-facing changes since the previous release.
```

---

## v0.6.3 — Unreleased

- **Construction Code sections get their text** ([#76](https://github.com/BetaNYC/nyc-charter-laws-rules/issues/76)). The index read a section's text only from its "Normal Level" body. The Administrative Code's Construction Codes (Title 28) and Fire Code (Title 29) keep most of a section's text one level down, in "Subsection" levels, so in the July 2026 files 1,375 of their sections were missing some or all of their text (1,356 had none), and so were 90 Rules sections (74 had none). `scripts/lib/build-corpus.js` now reads a section's child levels in document order: each subsection's heading line ("80.1 Title."), then its body. A section with no subsection keeps its text byte for byte.
- **Text held outside sections is indexed** ([#78](https://github.com/BetaNYC/nyc-charter-laws-rules/issues/78)). A coverage audit of the July 2026 XML found about 855,000 characters the index never read. Each part of the publisher's files that holds text of its own outside a section is now a record: the Building Code Reference Standards in Title 27 (`RS 18-1` and the rest, about 700,000 characters), the Rules' appendices and schedules (`Title 15, Chapter 42, Appendix A`, `Title 19, Chapter 55, Schedule A`), the Health Code's Board of Health resolutions (`New York City Health Code, Resolutions`), and editor's notes and amendment lines on subchapters, articles and parts. Building Code § BC 602, whose heading is empty, is indexed, and § 21-905, whose heading was only its number, takes its title from its first paragraph. `&Sigma;` and `&alpha;` now decode. No existing record's citation, heading or text changed, apart from the sections above and § 21-905's heading.
- **`get_title` lists only the chapter asked for** ([#78](https://github.com/BetaNYC/nyc-charter-laws-rules/issues/78)). Since 0.6.0 a chapter ran on into the next file whenever that file's chapter had no number: the Charter's Preamble was listed in Chapter 64 and its Introductory in Chapter 25, the Health Code in Rules Chapter 21, the Administrative Code's local laws by year in the chapters before them, and Title 31's sections in Title 28's Chapter 3. A chapter now ends at a chapter with no number or at a section in no chapter.
- **`level` on index records** ([#78](https://github.com/BetaNYC/nyc-charter-laws-rules/issues/78)). A record carries the publisher's name for its level: `Chapter`, `Section` for a section in no chapter (the Administrative Code's Title 31), or `Appendix`, `Part`, `Subchapter` and so on. A section inside a chapter, nearly every record, has none. `get_title` reads it; an index without it behaves as in 0.6.2.
- **`npm run audit:coverage`** reports, against the downloaded ZIPs, how much of each document's text reaches the index and lists what does not, and why.
- The bundled index is rebuilt with this code by the daily refresh, not in the pull request, because rebuilding needs a download. The law text itself did not change: everything added was already in American Legal Publishing's files.
- Patch rather than minor: fixes to how the publisher's files are read. No tool or parameter was added, renamed or removed; records gain the optional `level` field.

## v0.6.2 — 2026-11-22

- Automatic data release. Bundled law text refreshed: Charter LL 2026/164 -> LL 2026/165; Admin Code LL 2026/164 -> LL 2026/165. No code changes beyond what was already merged to `main`.

## v0.6.1 — 2026-11-20

- Automatic data release. Bundled law text refreshed; no corpus's "current through" line moved. No code changes beyond what was already merged to `main`.

## v0.6.0 — 2026-11-19

- **New tool: `about_data`**, the third tool BetaNYC adds to each of its MCP servers ([betanyc-ai-workspace#1655](https://github.com/BetaNYC/betanyc-ai-workspace/issues/1655), epic [#1652](https://github.com/BetaNYC/betanyc-ai-workspace/issues/1652)). It answers where the law text comes from, from the new [DATA-SOURCES.json](DATA-SOURCES.json): one source per document (Charter, Administrative Code, Rules), each from American Legal Publishing's bulk XML. It says the source is the code library the NYC Law Department contracted for, and that BetaNYC modified it (the build reshapes and cleans the text), so this copy should not be considered the official record; it names the official record and links to it (`figures_official: false`). It also gives when this server's index was built for each document (the `indexedAt` times in `versions.json`, read at run time), the publisher's error address, the WHATS-CHANGED.md corrections that touched the text, and BetaNYC's contact address, lab@beta.nyc. Optional `topic`: `charter`, `admin-code`, `rules`, or a tool name. Read-only, no network, text plus `structuredContent` matching its `outputSchema`, ending with the one-line disclaimer like the other two shared tools.
- **`data.json`**, a DCAT-US 3.0 catalog generated from DATA-SOURCES.json by `scripts/whats_changed.py about-data catalog` (never edited by hand). Both files ship in the package.
- **Server instructions** now add the shared module's lines after the full disclaimer: call `about_data` for where the data comes from, `about_betanyc` for who built the server.
- **Shared module 1.5.2** ([betanyc-ai-workspace#1672](https://github.com/BetaNYC/betanyc-ai-workspace/issues/1672), [#37](https://github.com/BetaNYC/nyc-charter-laws-rules/issues/37)). `src/betanyc-tools.ts` (1.5.2; 1.5.0 when this entry was first written) and `scripts/whats_changed.py` (1.4.1, with its `data-sources.schema.json`) are copies of the workspace's canonical files, as are the validator kit (`scripts/tests/catalog_validate.py`, `scripts/mcp_shared/`); never edit them here. 1.5.0 adds helpers for a server's own tools (annotations, source lines, errors, size budget); the three shared tools are unchanged.
- **Tool annotations** ([#38](https://github.com/BetaNYC/nyc-charter-laws-rules/issues/38)). Every tool now declares `readOnlyHint: true`, `openWorldHint: false` (the law-text tools answer from the bundled index) and a title, through the shared module's `annotateTools`. A test checks them, and a second caps the size of the tool list plus instructions ([#44](https://github.com/BetaNYC/nyc-charter-laws-rules/issues/44)).
- **Checks.** CI gains an About data job: `about-data check` with the built server's tool list, `about-data catalog --check`, and the JSON Schema and DCAT-US 3.0 validators at pinned versions. `release.yml` runs `about-data check --release` before `npm publish`. A new test fails if any tool has no source.
- **Tool schemas from zod** ([#22](https://github.com/BetaNYC/nyc-charter-laws-rules/issues/22)). Each law-text tool's parameters are written once, as a zod shape. The server validates calls against it and generates the advertised JSON Schema from it with the SDK's own converter (the one `McpServer.registerTool` uses), always as `z.object(shape).strict()`, so the two cannot drift and unknown parameters are still refused by name. Clients see the same tools, parameters and choices; `search`'s `limit` is now advertised as an integer from 1 to 50, the bounds the server already enforced.
- **Plain errors** ([#46](https://github.com/BetaNYC/nyc-charter-laws-rules/issues/46)). A bad parameter value or a missing parameter used to come back as zod's raw JSON. Every failure is now one plain sentence naming what to fix and the accepted parameters, built with the shared module's `toolError`, and still ends with the disclaimer. An unknown tool name lists the tools there are.
- **Polite downloads** ([#39](https://github.com/BetaNYC/nyc-charter-laws-rules/issues/39)). `npm run fetch-data` (the daily refresh's download from American Legal Publishing) now sends a User-Agent with the package version, times out each attempt after 120 seconds, and retries 429 and 5xx up to twice, honoring Retry-After. A failed download now stops the run. It used to log the failure and exit 0, though the refresh workflow expected it to fail.
- **Source and date on every answer** ([#40](https://github.com/BetaNYC/nyc-charter-laws-rules/issues/40), [#41](https://github.com/BetaNYC/nyc-charter-laws-rules/issues/41), [#49](https://github.com/BetaNYC/nyc-charter-laws-rules/issues/49)). Each law-text answer ends, before the disclaimer, with one line per document it came from, from the shared module's `provenance()`: that BetaNYC modified the text and how (`changedByBetanyc`, matching `about_data`), the `indexedAt` date of the index being served, and the official record with its code-library link (`verify_at`); then the publisher's "current through" line exactly as given. `get_version` keeps a plain `Source:` line. Answers that find nothing carry the same lines and say which documents were searched.
- **Search ranking** ([#49](https://github.com/BetaNYC/nyc-charter-laws-rules/issues/49)). When a query does not match as a phrase and search falls back to its words, results are ranked differently: one score per section from word rarity, words in the heading (3 times), length (long sections pushed down a little), the share of rare words covered, and lower weights for short stubs (0.3) and Local Law appendix records (0.5). A section with more of the words no longer always ranks first. The notice and count lines say how many sections contain every word and how many only some. Phrase search and `get_section` are unchanged.
- **Safer error and not-found text** ([#49](https://github.com/BetaNYC/nyc-charter-laws-rules/issues/49)). Anything an answer repeats from the request is cut to one line of at most 100 characters. A missing index file names the document and what to do, not the server's file path (which goes to stderr).
- **Full citations for labels with a period inside** ([#49](https://github.com/BetaNYC/nyc-charter-laws-rules/issues/49)). The build cut such labels at their first period: 1,883 Administrative Code Local Law records had the citation "L", and others "G", "E", "1" or "10-1104". `scripts/lib/build-corpus.js` now keeps them whole ("L.L. 2016/002", "G.1.2", "10-1104.1"). The bundled index is rebuilt by the next daily refresh, not in this release's pull request, because rebuilding needs a download.
- **Chapters list their sections** (live check of this release, 2026-11-19; the same in 0.5.1). `get_title` returned only a chapter's own heading, and `Title 6`, the README's example, found nothing: the index has no title records. It now gives the chapter's heading, then the citation and heading of each section in it, in order. In the Administrative Code, `Title 24` gives the chapters whose sections are numbered 24-…, and `Title 3, Chapter 1` narrows to those numbered 1. `list_titles` is now in order (Charter Chapter 1 came near the end), shows whole chapter numbers (Charter `Chapter 18-A` to `18-D` all showed as `Chapter 18-`), and shows each Administrative Code chapter's section range, since several share a number. The build now reads a chapter's whole number, and only at the start of its heading: 67 index records get a corrected citation at the next daily refresh, such as `Chapter 18-A` for `get_section`.
- **Lists say how many** ([#42](https://github.com/BetaNYC/nyc-charter-laws-rules/issues/42)). `search` says how many sections matched in all and that snippets are cut at 400 characters. `list_titles` and `get_title` gain optional `limit` (default 200, max 1000) and `offset`, and say which part of how many they show; the Rules' 731 titles used to come back at once, about 50,000 characters. The `get_section` match list stops at 25 and says how many matched.
- **Index checksums** ([#45](https://github.com/BetaNYC/nyc-charter-laws-rules/issues/45)). `build-index.js` records the sha256 of each corpus JSON in `versions.json`, and a test fails if a shipped file does not match. `indexedAt` now also moves when only the text changed.
- **Disclaimer said once in the tool list** ([#48](https://github.com/BetaNYC/nyc-charter-laws-rules/issues/48)). The sentence "For informational purposes only. Not legal advice. Verify…" ended all five law-text tool descriptions. It is gone from the descriptions; the full disclaimer stays in the server instructions and at the end of every answer.
- **Evaluation set and a stdout test** ([#43](https://github.com/BetaNYC/nyc-charter-laws-rules/issues/43), [#47](https://github.com/BetaNYC/nyc-charter-laws-rules/issues/47)). `npm run eval` runs 17 questions with known answers offline, five of them asked without a citation (15 of 17 on 2026-11-18 after the search ranking change, 12 of 17 before; results in `eval/runs/`). A new test fails if anything but JSON-RPC reaches stdout.
- Minor rather than patch: one new tool, and two optional parameters each on `list_titles` and `get_title`. No tool, parameter or response field was renamed or removed. Law-text answers gain a source line, and long lists a count line.

## v0.5.1 — 2026-11-14

- Automatic data release. Bundled law text refreshed: Charter LL 2026/163 -> LL 2026/164; Admin Code LL 2026/163 -> LL 2026/164; Rules eff. November 8, 2026 -> eff. November 14, 2026. No code changes beyond what was already merged to `main`.

## v0.5.0 — 2026-11-13

- **Two new tools: `whats_changed` and `about_betanyc`**, the two tools BetaNYC is adding to each of its MCP servers ([betanyc-ai-workspace#1645](https://github.com/BetaNYC/betanyc-ai-workspace/issues/1645)). `whats_changed` answers "what changed in this server?" from the new [WHATS-CHANGED.md](WHATS-CHANGED.md), newest first, with optional `since`, `tag` and `limit`; `about_betanyc` says who built the server, where its code is, and where to report a bug in this server or ask for a new feature. Both are read-only, never touch the network, and return text plus `structuredContent` matching a declared `outputSchema`. Their text ends with the one-line disclaimer (the full footer with `NYC_CLR_FOOTER=full`) and does not use up the full footer meant for the first law answer.
- **WHATS-CHANGED.md**, the reader-facing record of changes, backfilled to 0.1.0 and shipped in the package. `src/betanyc-tools.ts` and `scripts/whats_changed.py` are copies of the workspace's canonical files (shared module v1.2.1); never edit them here.
- **Release checks.** CI runs `node scripts/auto-release.js check-whats-changed --base-ref …` (the shared checker, plus the pairing of WHATS-CHANGED.md and RELEASES.md); `release.yml` runs it with `--release` before `npm publish`. The refresh does not release automatically while WHATS-CHANGED.md has an Unreleased entry.
- Minor rather than patch: two new tools. No tool, parameter or response field was renamed or removed, and the law text tools answer as before.

## v0.4.5 — 2026-11-11

- Automatic data release. Bundled law text refreshed: Charter LL 2026/160 -> LL 2026/163; Admin Code LL 2026/160 -> LL 2026/163; Rules eff. November 4, 2026 -> eff. November 8, 2026. No code changes beyond what was already merged to `main`.

## v0.4.4 — 2026-11-09

- **Listed in the official MCP Registry** as `io.github.BetaNYC/nyc-charter-laws-rules`. `package.json` now carries `mcpName`, which the registry checks against the published npm package, and `server.json` describes the listing. After this version is on npm, `.github/workflows/publish-mcp.yml` publishes the listing; it runs after every successful Release from now on, automatic data releases included. `glama.json` claims the server on Glama. The automatic release bumps `server.json` along with `package.json`, and `release.yml` refuses to publish when they differ. No change to the server, its tools or the law text.

## v0.4.3 — 2026-11-07

- Automatic data release. Bundled law text refreshed; no corpus's "current through" line moved. No code changes beyond what was already merged to `main`.

## v0.4.2 — 2026-11-05

- Automatic data release. Bundled law text refreshed: Rules eff. October 30, 2026 -> eff. November 4, 2026. No code changes beyond what was already merged to `main`.

## v0.4.1 — 2026-10-31

- Automatic data release. Bundled law text refreshed: Charter LL 2026/147 -> LL 2026/160; Admin Code LL 2026/147 -> LL 2026/160; Rules eff. October 16, 2026 -> eff. October 30, 2026. No code changes beyond what was already merged to `main`.

## v0.4.0 — 2026-10-21

- **The full disclaimer once, then one line** ([#25](https://github.com/BetaNYC/nyc-charter-laws-rules/issues/25), proposed, designed and measured by [@jpaulgale](https://github.com/jpaulgale)). Every response that returned data, including not-found and empty results, used to end with the full ~1,170-character footer: about a third of all tool-result tokens in a 10-query session. Now the first response after the server starts carries the full footer and every later response ends with `⚠️ Not legal advice. Verify at https://codelibrary.amlegal.com/codes/newyorkcity/latest/overview.` The full text is also sent as the server's `instructions`. Set `NYC_CLR_FOOTER=full` for the old behavior; any unrecognized value uses `full` and prints a warning to stderr. Unknown-tool and error responses, which had none, now carry a disclaimer too. The caveat in each tool description is unchanged. In clients that keep the server running across chats (such as Claude Desktop), most chats will see only the one-line footer. Set `NYC_CLR_FOOTER=full` if your use calls for the full text every time.
- **Plain-language questions find results** ([#30](https://github.com/BetaNYC/nyc-charter-laws-rules/issues/30)). `search("How long can a sidewalk shed stay up?")` returned nothing; it now drops question words and stopwords and ranks sections by how many of the remaining terms they contain, listing Rules § 102-07 second. The response's first line says when this happened and which terms were used. A query that matches as typed returns exactly what it did before. Quotes around the whole query, straight or curly, are now removed before the phrase match, so `"open data"` searches the phrase `open data` instead of matching nothing. The `search` description now says it is keyword search and that short keyword queries work best. This is still keyword matching, not ranked full-text search.
- Minor rather than patch: a new configuration option, and the text of most responses changes. No tool, parameter or response field was renamed or removed.

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
