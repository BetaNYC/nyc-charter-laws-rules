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
  A change to the build code (`scripts/build-index.js` and what it imports) is
  not rebuilt into the index by its pull request: the next refresh rebuilds and
  commits the index, and that commit counts as new text when the index changed.
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
  Unreleased. A release that dates a Data correction also adds its anchor to
  `corrections` in DATA-SOURCES.json for each document it touched (a test
  fails otherwise). Before tagging, run `node scripts/check-index-build.js`: it
  fails when the build code changed after the last refresh. Wait for the next
  refresh (or start it with `gh workflow run refresh-data.yml`), then tag `main`
  after the refresh's commit. Steps: README, "Releases".

`release.yml` checks first that the bundled index was built by the build code
at the tag (`scripts/check-index-build.js`, issue #95). `build-index` writes
`data/index-build.json`, a fingerprint of that code and the sha256 of each index
file; the check recomputes the fingerprint and refuses to publish when it
differs, so a tag pushed before the refresh cannot ship old text with new
claims. An automatic release passes, because its tag is on the refresh's own
commit. If the check stops a manual release, nothing was published: delete the
tag (`git push origin :refs/tags/vX.Y.Z`), wait for the refresh, and tag again.
That is the one case where re-tagging is right.

Automatic data releases never get a WHATS-CHANGED.md entry: daily law text is
recorded in CHANGELOG.md. The refresh does not release automatically while
WHATS-CHANGED.md has an Unreleased entry (see `scripts/auto-release.js`).

If a release fails, its run goes red, and every following refresh goes red too
until the version is published. Fix the cause and rerun the failed Release run
(Actions → Release → Re-run, or `gh run rerun <id> --failed`). Never re-tag or
bump to recover (except after the index-build check above, which stops before
anything is published). Setup for npm trusted publishing is in the README,
"Releases".

## Format

Dates are New York (America/New_York). A hand-bumped version is headed
`## vX.Y.Z — Unreleased` until the release commit gives it the date.

```markdown
## vX.Y.Z — YYYY-MM-DD

- Summary of user-facing changes since the previous release.
```

---

## v0.8.0 — Unreleased

- **Symbol-font characters show as the characters the font draws** ([#88](https://github.com/BetaNYC/nyc-charter-laws-rules/issues/88)). American Legal sets some text in the old Symbol font (`font-name="Symbol"`), which puts math signs and Greek letters on ordinary character codes, so the index read "For s ³ 4t" where BC 722.2.1.1.4 says "For s ≥ 4t". `scripts/lib/symbol-font.js` now maps 13 reviewed codes inside Symbol runs to Unicode while the index is built (`D→Δ S→Σ W→Ω a→α m→μ q→θ r→ρ s→σ £→≤ ³→≥ ´→× Ö→√ (→(`), each checked against the Unicode Consortium's Adobe Symbol table, vendored in `scripts/vendor/unicode-adobe-symbol/`. Any other code in a Symbol run is left as is, and `build-index` warns `unreviewed Symbol code …`, so new data cannot change text silently. "·" and "§" stay unchanged on purpose (bullets and "times"; footnote marks in 1 RCNY § 101-14). A heading that copies its paragraph word for word gets the same characters (BC 1609.7.1). Measured on a local build from the July 2026 files, not the later files this release ships: it changed the text of 48 Administrative Code records (308 characters) and 14 Rules records (118 characters), and nothing outside Symbol runs. "WP Greek Helve" and "Wingdings" text is not mapped yet and is listed in `known_gaps`.
- The bundled index is rebuilt with this code by the daily refresh, not in the pull request.
- **Release guard: the bundled index must be built by the code being released** ([#95](https://github.com/BetaNYC/nyc-charter-laws-rules/issues/95)). `build-index` writes `data/index-build.json`, a fingerprint of `scripts/build-index.js`, the modules it imports, the Symbol table they read and the locked versions of the npm packages they use, with the sha256 of each index file. `scripts/check-index-build.js` recomputes it; `release.yml` runs it before publishing and refuses when the code changed after the index was built, naming what changed and what to do. `test.yml` runs it as a warning only. The refresh commits the record beside the index; a change to it alone is committed with no release. The record is not in the npm package.
- **about_data lists the 2026-11-24 correction** ([#95](https://github.com/BetaNYC/nyc-charter-laws-rules/issues/95)). The corrections for all three documents now include "Missing building and fire code text and appendices, and wrong chapter lists", which about_data left out. A new test fails when a released Data correction in WHATS-CHANGED.md is in no document's corrections.
- **about_data no longer describes the Symbol-font change for the Charter**, which has no text in that font ([#95](https://github.com/BetaNYC/nyc-charter-laws-rules/issues/95)).
- **`build-index` counts Symbol-font characters exactly** ([#95](https://github.com/BetaNYC/nyc-charter-laws-rules/issues/95)). The one Symbol "(" stays "(", and was counted as changed: the log said 309 characters changed in the Administrative Code where 308 did. It is now counted as kept.
- **An empty search is an error** ([#95](https://github.com/BetaNYC/nyc-charter-laws-rules/issues/95)). `search` with `""`, only spaces, or only quote marks (`'""'`) returned all 22,637 sections, nothing, or the 4 sections holding two quote marks. It now answers `isError` and says to send a keyword or a phrase, or to call `get_section` for a citation.
- **Short search terms match whole words only** ([#95](https://github.com/BetaNYC/nyc-charter-laws-rules/issues/95)). A query, or a term in the word fallback, with 3 or fewer letters and digits matches only as a whole word: `x` is not the x in "wax", `tax` is not "taxes", and `a` no longer matches inside 22,150 sections. Longer queries and terms match as before. The answer says when this applied. The same rule and limit as nyc-budget-mcp's text filters; the eval still passes 15 of 17.
- **Search snippets show the match** ([#95](https://github.com/BetaNYC/nyc-charter-laws-rules/issues/95)). A snippet was the first 400 characters of the section, so a hit on `s ≥ 4t` in Section BC 722 showed 722.1's opening. It is now up to 400 characters around the first match, starting at a word, with `…` where text is left out.
- **`get_section` gives a long text in parts** ([#95](https://github.com/BetaNYC/nyc-charter-laws-rules/issues/95)). New optional `max_chars` (default 20,000; 1,000 to 100,000) and `offset`. A longer text, such as Section BC 722 or RS 18-1 (80,000 to 110,000 characters), comes with a line saying which characters of how many it shows and the offset for the next part. A text that fits whole answers as before, with the same lines and fields.
- **More citation forms in `get_section`** ([#95](https://github.com/BetaNYC/nyc-charter-laws-rules/issues/95)). A trailing period (`§ 259.`); a construction code named in words (`Building Code 722.2.1.1.4`, and the Fire, Plumbing, Mechanical, Fuel Gas, Electrical and Existing Building codes), which is the code's section in the Administrative Code; and, when nothing else matches, a bare code number (`722.2.1.1.4`), looked for in every construction code: one match is returned, several are listed. `get_title` reads a bare number in the Charter as a chapter (`11` is Chapter 11, and says so), and elsewhere hints to ask for `Title 11` or `Chapter 11`.
- **`get_section`'s list of matches says what to add, and pages** ([#95](https://github.com/BetaNYC/nyc-charter-laws-rules/issues/95)). It told callers to re-run "with the 'corpus' parameter" even when they had passed it. It now names `corpus` only when it was not given and the matches are in more than one document, and otherwise the title (`'1 RCNY § 2-01'`). A list longer than 25 now pages with `offset`, worded as the other lists: `Showing 1 to 25 of 39. Call again with offset 25 for the next ones.`

## v0.7.1 — 2026-11-26

- Automatic data release. Bundled law text refreshed: Charter LL 2026/165 -> LL 2026/171; Admin Code LL 2026/165 -> LL 2026/171; Rules eff. November 14, 2026 -> eff. November 29, 2026. No code changes beyond what was already merged to `main`.
- **Alt-text reviewer tool** ([#87](https://github.com/BetaNYC/nyc-charter-laws-rules/issues/87), [#90](https://github.com/BetaNYC/nyc-charter-laws-rules/pull/90)). `npm run alt:inventory`, `alt:draft`, `alt:review` and `alt:build-static` list the pictures in the Administrative Code and the Rules, draft alt text, and let a person review it in a local page that saves to `data/alt-text/`. The tool is for maintainers: the published package's files are unchanged, and `@anthropic-ai/sdk` is a dev dependency only.

## v0.7.0 — 2026-11-24

- **Construction Code sections get their text** ([#76](https://github.com/BetaNYC/nyc-charter-laws-rules/issues/76)). The index read a section's text only from its "Normal Level" body. The Administrative Code's Construction Codes (Title 28) and Fire Code (Title 29) keep most of a section's text one level down, in "Subsection" levels, so in the July 2026 files 1,375 of their sections were missing some or all of their text (1,356 had none), and so were 90 Rules sections (74 had none). `scripts/lib/build-corpus.js` now reads a section's child levels in document order: each subsection's heading line ("80.1 Title."), then its body. A section with no subsection keeps its text byte for byte.
- **Text held outside sections is indexed** ([#78](https://github.com/BetaNYC/nyc-charter-laws-rules/issues/78)). A coverage audit of the July 2026 XML found about 855,000 characters the index never read. Each part of the publisher's files that holds text of its own outside a section is now a record: the Building Code Reference Standards in Title 27 (`RS 18-1` and the rest, about 700,000 characters), the Rules' appendices and schedules (`Title 15, Chapter 42, Appendix A`, `Title 19, Chapter 55, Schedule A`), the Health Code's Board of Health resolutions (`New York City Health Code, Resolutions`), and editor's notes and amendment lines on subchapters, articles and parts. Building Code § BC 602, whose heading is empty, is indexed, and § 21-905, whose heading was only its number, takes its title from its first paragraph. `&Sigma;` and `&alpha;` now decode. No existing record's citation, heading or text changed, apart from the sections above and § 21-905's heading.
- **`get_title` lists only the chapter asked for** ([#78](https://github.com/BetaNYC/nyc-charter-laws-rules/issues/78)). Since 0.6.0 a chapter ran on into the next file whenever that file's chapter had no number: the Charter's Preamble was listed in Chapter 64 and its Introductory in Chapter 25, the Health Code in Rules Chapter 21, the Administrative Code's local laws by year in the chapters before them, and Title 31's sections in Title 28's Chapter 3. A chapter now ends at a chapter with no number or at a section in no chapter.
- **`level` on index records** ([#78](https://github.com/BetaNYC/nyc-charter-laws-rules/issues/78)). A record carries the publisher's name for its level: `Chapter`, `Section` for a section in no chapter (the Administrative Code's Title 31), or `Appendix`, `Part`, `Subchapter` and so on. A section inside a chapter, nearly every record, has none. `get_title` reads it; an index without it behaves as in 0.6.2.
- **Records carry their title, and citations can name it** ([#59](https://github.com/BetaNYC/nyc-charter-laws-rules/issues/59)). Each title of the Rules restarts its chapter and section numbers: in the July 2026 files 63% of Rules records shared a citation with another (`§ 1-01` alone is 50 records, one per title), and 523 could not be returned on their own by `get_section` at all. Each Administrative Code and Rules record now carries `titleNumber` (`"15"`, `"16-A"`), read from the Title level around it in its file, else its chapter's anchor name (`T15C018`), else, for the 24 Rules chapters with neither (the Health Code, the Rent Guidelines Board's yearly orders, Appendix A to Title 62, Title 3's Chapter 11), the last Title record before it in the publisher's record order; on the July build, record order agrees with the other two for every record they place. Chapter records also carry `titleHeading`. Every other field is byte for byte unchanged (old-versus-new diff of a July build of all three books, and pins on every XML fixture); the Charter's index is unchanged. `get_section` takes `15 RCNY § 1-01`, `15 RCNY 1-01`, `15 R.C.N.Y. § 1-01`, `Title 15 § 1-01`, `24 RCNY Health Code § 81.08`, `Title 16-A § 16-501` and any dash. A citation with `RCNY` is looked for in the Rules only; asked of another document, it finds nothing and says it is a Rules citation. "Health Code" is read as a citation only after `24 RCNY` or `Title 24`, or when a section number, `§`, or Title, Article or Part and a number follow it, so a heading that starts with the words ("Health Code Lead Abatement Penalty Schedule") is found as before; a titled citation that finds nothing is looked up as typed. Where a title repeats a citation, the citation names the chapter too (`Title 30, Apartment & Loft Order #49 (2017), Notice`, `Title 62, Chapter 5, § 6-01`). A bare `§ 1-01` still lists every title's, now sorted by title and labeled `15 RCNY § 1-01 — … (Title 15: Department of Environmental Protection)`. Records `get_section` cannot return alone, July 2026: Rules 523 → 17, Administrative Code 19 → 14; the rest share their full citation because the publisher numbered them alike inside one chapter, or numbered two chapters of a title alike. `get_title` takes `Title 15, Chapter 18` and `15 RCNY Chapter 18` in the Rules, and `Title 16` no longer brings Titles 16-A and 16-B (nor `Title 20` 20-A, nor `Title 21` 21-A). `Title N` gives every record the index places in the title: chapters with no number are chapters of their own (the Health Code, the Rent Guidelines Board's orders, the Rules' appendices), and sections in no chapter come first (the Administrative Code's Title 31). July 2026, records: Rules Title 24 901 (the Health Code's 559 included), Title 30 201, Title 55 177, Title 62 130, Title 2 72; Administrative Code Title 29 (the Fire Code) 417, where 0.6.2 gave 5, and Title 28 gains Chapters K1 to K3. `list_titles` sorts the Rules by title, labels each chapter `Title 15, Chapter 18` (a chapter with no number by its name, `Title 24, New York City Health Code`, after the numbered ones), and names each title on its own line before its chapters: 758 Rules chapters in July, where 0.6.2 listed 728. `get_section` answers and search results show the full citation (`15 RCNY § 1-01`; `Title 16-A, § 16-501`; Administrative Code citations such as `§ 24-163` are unchanged). On an index built before 0.7.0, which has no titles, every tool answers as in 0.6.2, and a citation that names a title lists every record with the rest of the citation.
- **The Rules on the BetaNYC Law Reader website** ([#65](https://github.com/BetaNYC/nyc-charter-laws-rules/issues/65)). law.beta.nyc adds the Rules of the City of New York, laid out as the Administrative Code is: title cards, a page per title, chapters split into parts, a page per section, and the titles-first menu. Every path is under its title (`/rules/titles/15/sections/1-01`) and every citation names it (`15 RCNY § 1-01`, `24 RCNY Health Code § 81.08`), from the index's new `titleNumber`; a number in several titles (`/rules/sections/1-01`) or repeated in one has a page to pick one. The jump box takes `15 RCNY § 1-01`. The Rules appear after the first daily refresh with this code rebuilds the index; until then the site builds without them. The MCP server's answers do not change.
- **Citations copied from the website work in `get_section`, and the MCP's work in the website.** The Law Reader website's Copy citation names the book first, and `get_section` did not take that: `NYC Administrative Code § 27-506` and `NYC Charter § 1133` were "Section not found". `get_section` now accepts a leading book name (`NYC`/`New York City`/`City` optional, then `Charter`, `Administrative Code`, `Admin. Code` or `Admin Code`) and looks only in that book, so `NYC Charter § 1133` is never the Administrative Code's § 1133; with `corpus` set to the other book it finds nothing and says why, as an `RCNY` citation does. The name counts only when a citation follows it, and a book lookup that finds nothing falls back to the text as typed, so headings such as "Charter revision commission" are found as before; what follows the name is matched by citation only, never by heading. The website's local-law chapters (`NYC Administrative Code Local laws, 1985`) are the publisher's chapter `1985`. The website's jump box took none of these forms either: book names, building and fire code sections (`FC 102`, `Section FC 102`, `EC 80`, `BC 602`, `RS 18-1`, `Reference Standard RS 18-1`), and citations that are not numbers (`NYC Administrative Code D302 Conversions to a multiple dwelling (MDL 9(2))`, `2 RCNY Appendix A`, `15 RCNY Chapter 19.1, Appendix`) all went to a word search. They now go to their page, and a book's name keeps the jump in that book. On the committed data, every record the site builds in all three books (856 Charter, 12,991 Administrative Code, 8,786 Rules) is found by `get_section` from its copied citation and lands on its page in the jump box, or on the search page's list when records share that exact citation (220).
- **Citations of a part of a section find the section** ([#76](https://github.com/BetaNYC/nyc-charter-laws-rules/issues/76)). The website cites subdivisions and subsections (`NYC Charter § 1133(b)(1)`, `Section FC 102.4(1)`), and `get_section` found neither. When no record has the citation asked for, it now looks for the section without the part: labels in parentheses at the end (`(b)(1)`, `(h-1)`, `(C)`, and the website's `-2` for a label's second use), a Construction Code or Fire Code subsection (`FC 102.4` is subsection 4 of `FC 102`), or a Rules subsection named with `RCNY` (`2 RCNY § 1-01.1` in § 1-01). The section must match by citation, not by heading (`Section FC 10.1` finds nothing, not FC 101 to FC 109). It returns the whole section, since the package holds whole sections, and its first line says which part was asked for. Exact citations still win and answer exactly as before (an old-versus-new run of every citation and heading in the index: no difference), so `D302 Conversions to a multiple dwelling (MDL 9(2))` and `11-602.1` are their own records, and a point in an Administrative Code number is never read as a subsection. The jump box goes to the section's page at the part, keeping the label's case (`(d)(2)(C)`). The 984 subsection citations the site writes after a comma, because the subsection's number does not start with its section's (`55 RCNY SECTION V – …, 6.5.1`), are not citation forms and are left as they are.
- **`about_data` drops a stale gap.** Its known gaps still said `get_title` returns only chapter and title headings, untrue since 0.6.0; that line is gone, and the Administrative Code and the Rules now list pictures as left out (they have no text in the publisher's files).
- **Copy link and Copy citation work over plain http.** Browsers withhold the Clipboard API outside https, so on law.beta.nyc before its certificate both buttons said "Could not copy". The site now falls back to selecting the text and copying it. The MCP server is not affected.
- **`npm run audit:coverage`** reports, against the downloaded ZIPs, how much of each document's text reaches the index and lists what does not, and why.
- The bundled index is rebuilt with this code by the daily refresh, not in the pull request, because rebuilding needs a download. The law text itself did not change: everything added was already in American Legal Publishing's files.
- Minor rather than patch: besides the fixes to how the publisher's files are read, `get_section` takes new citation forms (a Rules title, a book's name, a part of a section), the website gains the Rules, and records gain the optional `level`, `titleNumber` and `titleHeading` fields. No tool or parameter was renamed or removed.

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
