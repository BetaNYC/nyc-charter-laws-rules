# nyc-charter-laws-rules

The single place to access, process, and query New York City's three primary legal documents:

- **The New York City Charter**
- **The New York City Administrative Code**
- **The Rules of the City of New York**

This repo includes:
- A **[MCP (Model Context Protocol)](https://modelcontextprotocol.io/) server** so AI assistants can query the documents directly
- **Scripts** to fetch and parse the latest bulk XML from American Legal Publishing
- A committed **JSON index** (`data/index/json/`) for machine use
- A committed **Markdown index** (`data/index/markdown/`) for human browsing — readable directly on GitHub
- A **site structure** (`data/structure/`) for the law website: each section's subdivisions, cross-reference targets, and chapter and title names, built with the index (see [Site structure](#site-structure-datastructure)). It is not in the npm package.
- A **website**, the BetaNYC Law Reader: the Charter and the Administrative Code, one page per section, with links between sections and search, built from the index by `npm run build-site` (see [The website](#the-website-betanyc-law-reader)). `.github/workflows/deploy-site.yml` builds it and publishes it to law.beta.nyc on GitHub Pages; the HTML is never committed. It is not in the npm package.

Clone the repo and everything is ready to use. No setup required to browse or query the current index. Run `npm run fetch-data && npm run build-index` only when you want to refresh from AML.

Vibe coded with [Claude](https://claude.ai) by [BetaNYC](https://beta.nyc).

**[What's changed](WHATS-CHANGED.md):** new tools, corrections and other changes a reader would notice, newest first. Daily law text updates are in [CHANGELOG.md](CHANGELOG.md).

---

## API key

**No API key is required.** The Charter, Administrative Code, and Rules are served from an offline corpus bundled with the package, so this server works out of the box — no signup, no token, no environment variables to set.

**The bundled text is as of the release.** An npm install carries the law text from the day that version was published. When the daily refresh picks up new law text, it also publishes a new patch release automatically (see [Releases](#releases)), so the law text in `npx -y @betanyc/nyc-charter-laws-rules` is normally at most a day behind `main`'s. Code changes ship with the next release. Automatic releases pause while a hand-bumped version is waiting to be published or a release run has failed. `get_version` reports the dates you are actually serving. To serve `main`'s index directly, see [Getting current law text](#getting-current-law-text-nyc_laws_index_dir).

---

## What it does

Exposes 8 tools over MCP:

| Tool | Description |
|---|---|
| `search` | Keyword search across all three documents (short keyword queries work best) |
| `get_section` | Retrieve a specific section by citation (e.g. `§ 259`, `Chapter 11`) |
| `list_titles` | List the chapters of a document, in order |
| `get_title` | List the sections in a chapter, or in an Administrative Code or Rules title (citation and heading of each) |
| `get_version` | Return the currency date for each document — so responses can be grounded in exactly how current the law is |
| `whats_changed` | What changed in this server, newest first, from [WHATS-CHANGED.md](WHATS-CHANGED.md): new tools and corrections |
| `about_betanyc` | Who built this server, where its code is, and where to report a bug in this server or ask for a new feature |
| `about_data` | Where the law text comes from, from [DATA-SOURCES.json](DATA-SOURCES.json): the publisher, whether it is the official text, when this server's index was built, where to check a section and how to report an error |

---

## Tools reference

Every law-text answer (`search`, `get_section`, `list_titles`, `get_title`) ends, before the disclaimer, with a source line per document it came from. It says that BetaNYC converted the text and how, so it is not the official text; the date of this server's copy; and the official record, with its publisher and a link to the code library. `search` adds that snippets are cut at 400 characters. Under it is the publisher's own "current through" line from the same copy, exactly as the publisher gives it. For example:

```
BetaNYC modified this data: converted by BetaNYC from the publisher's bulk XML files: line breaks are collapsed, so tables run together; the publisher's editing markers are removed and character codes decoded; citations are worked out by BetaNYC from headings and can be wrong or cut short. This copy should not be considered the official record. As of 2026-11-14T11:05:40.153Z (the date of the copy this server answers from). Official record: New York City Charter, bulk XML download (American Legal Publishing), https://codelibrary.amlegal.com/codes/newyorkcity/latest/NYCcharter/0-0-0-1
The publisher's own "current through" line for it, as given: "Current through Local Law 2026/164, enacted November 10, 2026,"
```

`get_version` reports dates and counts, not law text, so its lines start `Source: … (American Legal Publishing).` and end with `Link:`. The wording of both kinds comes from the shared module's `provenance()`.

The copy date is `indexedAt` in `versions.json`. It moves only when the text changes, so a copy can be days old and still match the publisher's latest download. The index keeps no date for when the source was last checked, so none is shown. Answers that find nothing ("No results found", "Section not found", "No titles found", "No sections found") say which documents were searched and carry the same lines.

Anything an answer repeats from the request (a query, citation, title, parameter name or value, or tool name) is cut to one line of at most 100 characters, ending `…`. If an index file is missing or unreadable, the answer names the document and says the server's operator should reinstall the package or rebuild the index; the file path goes to the server's stderr, not to the answer.

Every list says how much of how many it shows when it does not show everything, and how to get the rest.

Every tool only reads, and answers from the index bundled with the package, never a live API. Each says so in its MCP `annotations` (`readOnlyHint: true`, `openWorldHint: false`).

### `search`

Keyword search across the NYC Charter, Administrative Code, and Rules. It is keyword matching, not a question-answering engine, so short keyword queries work best: `sidewalk shed` rather than "How long can a sidewalk shed stay up?"

1. **Phrase first.** The whole query is matched as typed (case-insensitive). Quotes around the whole query, straight or curly, are removed first, so `"open data"` and `open data` search the same phrase. If any section contains it, those results are returned, relevance-ranked: heading matches rank above citation matches, which rank above body-text matches, and whole-word matches rank above substring matches.
2. **Terms, if the phrase finds nothing.** Question words and common words (`how`, `what`, `can`, `a`, `the`, `up`, `about`, …) are dropped. The full list is `SEARCH_STOPWORDS` in `src/corpus.ts`. Each remaining term matches at the start of a word, with a trailing plural `s` ignored, so `tanks` finds "tank" and `shed` does not find "established". There is no check at the end of a word, so `car` also finds "carbon"; that is what lets `appoints` find "appointed" (a whole-word check was tried and lost an eval question). Every section with at least one term gets one score, and results are sorted by it alone (`termScore` in `src/corpus.ts`):
   - a rare word counts more than a common one (its weight is the log of sections searched divided by sections that contain it);
   - a word in the heading or citation counts 3 times;
   - a long section is pushed down a little: the score is divided by 1 + log(1 + length / average length);
   - the score is multiplied by the share of the words' total weight the section covers, so a section with the rare words beats one with only the common ones;
   - sections under 100 characters (empty headings, `[Repealed]`) count 0.3 times, and Local Law appendix records (heading like `L.L. 2016/002`) half.

   So a section with every word can rank below one with fewer, rarer words in its heading. Through 0.5.x, a section with more of the words always came first, before any weight applied, so long definitions sections that happen to hold every word won.
3. **Said out loud.** When step 2 runs, the first line of the response says so and lists the terms:
   - every result contains every term: `No section contains the exact query; showing sections containing all of: building, owners, required, drinking, water, tanks.`
   - some results lack a term, and no section anywhere has every term: `No section matched every term; showing sections matching some of: smoking, banned, nyc.`
   - some results lack a term, and at least one section has every term: `No section contains the exact query; showing the best matches for some or all of: long, sidewalk, shed, stay.`

4. **How many.** For a phrase match, when more sections matched than `limit`, a line after the results says `Showing 10 of 35 matching sections, best first.` and how to see others. When step 2 ran, sections with every term and sections with only some are counted apart, for example `1 section contains every term; it does not rank in this list. To see more of them, raise limit (max 50), …` then `1525 other sections contain only some of the terms; the 10 shown are the best-ranked of those.` When no section has every term: `619 sections contain some of the terms; the 10 shown are the best-ranked of those.` The response never suggests raising `limit` to see sections that hold only some of the words. Each snippet is cut at 400 characters, marked `…`, and a line says so; `get_section` returns the full text.

This is still keyword matching: a question whose answer uses other words ("warm" and "winter" for a section about minimum temperatures) does not find it. See [Evaluation set](#evaluation-set).

| Parameter | Type | Required | Default | Description |
|---|---|---|---|---|
| `query` | string | yes | — | Search term or phrase |
| `corpus` | string | no | `all` | `charter`, `admin_code`, `rules`, or `all` |
| `limit` | integer | no | 10 | Max results (1 to 50) |

```
search("open data")
search("landlord inspection", corpus="admin_code", limit=20)
search("board of health", corpus="rules")
search("How long can a sidewalk shed stay up?")   # term fallback; first line says so
```

---

### `get_section`

Retrieve a specific section by citation or heading fragment. Input is normalized (with or without `§`, any case, extra whitespace, any kind of dash). If the same citation exists in more than one document (e.g. charter `Chapter 3` vs a rules chapter, or a rules section number repeated across titles), a disambiguation list is returned. Re-run with the `corpus` parameter or a more specific citation. The list shows at most 25 matches and says how many there are.

Each title of the Rules numbers its own chapters and sections, so in the July 2026 files 50 titles each have a `§ 1-01`. Name the title the way the Rules are cited: `15 RCNY § 1-01` (also `15 RCNY 1-01`, `15 R.C.N.Y. § 1-01`, `Title 15 § 1-01`, `Title 15, Chapter 18`), and the Health Code as `24 RCNY Health Code § 81.08` (or `Health Code § 81.08`). A citation with `RCNY` is a Rules citation: asked of another document, it finds nothing and says so. "Health Code" counts as a citation only after `24 RCNY` or `Title 24`, or when `§`, a section number, or Title, Article or Part and a number follow it; otherwise, as when a citation that names a title finds nothing, the words are looked up as typed, so `Health code.` still finds Charter § 558. A bare `§ 1-01` still lists every title's, sorted by title, each with its full citation and its title's name: `[RULES] 15 RCNY § 1-01 — § 1-01 Scope and Application. (Title 15: Department of Environmental Protection)`. Where the publisher repeats a citation inside one title, the citation names the chapter too, and is accepted that way: each yearly Rent Guidelines Board order has its own "Notice" (`Title 30, Apartment & Loft Order #49 (2017), Notice`), and Title 62 numbers sections from § 6-01 in both Chapter 5 and Chapter 6 (`Title 62, Chapter 5, § 6-01`). An Administrative Code citation already names its title in its number (§ 24-163 is in Title 24), except in a lettered title, which shares its parent's numbers: `Title 16-A § 16-501`. Answers show the full citation (`[RULES] 15 RCNY § 1-01 (matched in corpus: rules; in Title 15: Department of Environmental Protection)`), and so do search results.

On the July 2026 files, 93 Rules records and 115 Administrative Code records still share their full citation with another record, because the publisher numbered two alike inside one chapter (Title 15 Chapter 42 has two runs of § 1 to § 8) or numbered two chapters of one title alike and marked both "*" (Rules Title 43 Chapter 19; Administrative Code Title 26 Chapters 21 and 37). `get_section` lists those together. Most can still be asked for alone by their heading; 17 Rules records and 14 Administrative Code records cannot be returned alone by any citation or heading, and `search` and `get_title` reach each one. Titles need an index built by 0.7.0 or later (see [What the index holds](#what-the-index-holds)); with an older index, a citation that names a title lists every record with the rest of the citation.

Citations copied from the Law Reader website ([law.beta.nyc](https://law.beta.nyc)) work as they are. They name the book first, and so may you: `NYC Charter § 1133`, `New York City Charter § 1133`, `Charter § 1133`, `NYC Administrative Code § 27-506`, `Administrative Code § 27-506`, `Admin. Code § 27-506`. Then only that book is looked in, so `NYC Charter § 1133` is never the Administrative Code's § 1133; with `corpus` set to the other book, it finds nothing and says so, as an `RCNY` citation does. The book's name counts only when a citation follows it (`§`, a number, Title, Chapter, a code's letters and number), and a book lookup that finds nothing falls back to the lookup as typed, so `Charter revision commission` is still a heading. What follows a book's name is matched by citation only; the heading search runs only on the text as typed, so `Admin Code 1` is not every heading with a 1 in it. The website's local-law chapters, `NYC Administrative Code Local laws, 1985`, are the publisher's chapter `1985`; a year with no chapter (`Local laws, 2030`) finds nothing. Building and fire code sections are cited by code: `FC 102`, `Section FC 102`, `EC 80`, `BC 602`, `RS 18-1`.

A citation of a part of a section, when no record has that citation, returns the whole section it is in: the index holds whole sections. The section must match by citation, never by heading, so `Section FC 10.1` and `Admin. Code § 27-50(b)` find nothing rather than sections whose headings start with those numbers. The first line says so: `You asked for (b)(1), a part of § 1133. The index holds whole sections, so the whole section follows.` That covers a subdivision (`§ 1133(b)(1)`, `NYC Charter § 1133(b)(1)`, `§ 11-224.1(h-1)(ii)(I)`, and the `-2` the website adds to a label's second use, `§ 3501(3)-2`), a Construction Code or Fire Code subsection (`Section FC 102.4(1)` is item (1) of subsection 102.4 of FC 102; `Section BC E104.2.2`), and a Rules subsection named with `RCNY` (`2 RCNY § 1-01.1` in § 1-01). Exact citations still win and answer as before: `D302 Conversions to a multiple dwelling (MDL 9(2))` and `11-602.1` are records of their own, and a point in an Administrative Code number (`§ 11-602.9`) is never read as a subsection. Words in parentheses (`Independent budget office (IBO)`) are not a subdivision.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `citation` | string | yes | Section citation or heading (e.g. `§ 259`, `Section 20-f`, `11-602.1`, `Chapter 11`, `15 RCNY § 1-01`, `NYC Charter § 1133`, `Admin. Code § 27-506`, `FC 102`, `§ 1133(b)(1)`, `Section FC 102.4(1)`) |
| `corpus` | string | no | `charter`, `admin_code`, or `rules` (default: all three; a citation with `RCNY` is looked for in the Rules only, one that names the Charter or the Administrative Code in that book only, and a Health Code citation in the Rules first) |

```
get_section("§ 259")
get_section("11-602.1")
get_section("Chapter 11", corpus="charter")
get_section("RS 18-1")
get_section("15 RCNY § 1-01")
get_section("NYC Administrative Code § 27-506")
get_section("Section FC 102.4(1)")
get_section("24 RCNY Health Code § 81.08")
get_section("Title 16-A § 16-501")
get_section("Title 19, Chapter 55, Schedule A", corpus="rules")
```

Appendices, schedules, reference standards and other text outside a section have records of their own (see [What the index holds](#what-the-index-holds)): `RS 18-1` works like a section number, and the others are cited with the title and chapter they sit in.

---

### `list_titles`

List the chapters of a document, in order, each with its heading. The first line says how many there are (`84 chapters, in order.`); lists longer than 200, such as the Administrative Code (350) and the Rules (over 700), come in pages, and the first line says, for example, `Showing 1 to 200 of 731. Call again with offset 200 for the next ones.`

Each title of the Administrative Code has its own Chapter 1, so Administrative Code chapters are shown with their section range: `Chapter 1 (§ 3-101 to § 3-196) — Chapter 1: Mayor`, sorted by first section. Each title of the Rules has its own Chapter 1 too, so Rules chapters are sorted by title and labeled with it (`Title 15, Chapter 18 — Chapter 18: Protection from Contamination…`), and each title's name is on a line of its own before its first chapter, after a blank line (`Title 15: Department of Environmental Protection`). A Rules chapter with no number is listed after its title's numbered chapters, by its name: the Health Code (`Title 24, New York City Health Code`), each of the Rent Guidelines Board's yearly orders (`Title 30, Apartment & Loft Order #49 (2017)`), and appendices such as `Title 62, Appendix A to Title 62`. Through 0.6.2 the index did not record Rules titles: the Rules came as one list sorted by chapter number, with every title's Chapter 1 together and only the headings to tell them apart. An index built before 0.7.0 still gives that list. Through 0.6.0 the list came in no order, and lettered chapters showed a cut number (`Chapter 18-` for Charter Chapters 18-A to 18-D).

| Parameter | Type | Required | Description |
|---|---|---|---|
| `corpus` | string | yes | `charter`, `admin_code`, or `rules` |
| `limit` | integer | no | Max titles to return (default 200, max 1000) |
| `offset` | integer | no | How many to skip, for the next page (default 0) |

```
list_titles("charter")
list_titles("rules")
```

---

### `get_title`

List the sections in a chapter: the chapter's heading, then the citation and heading of each section, in order. Use `get_section` for a section's text. Numbers match whole: `Chapter 1` is not `Chapter 10` or `Chapter 1-A`. A number several chapters share (an Administrative Code or Rules `Chapter 1`) gives each of them.

In the Administrative Code and the Rules, `Title 24` gives every record the index places in that title, chapter by chapter, in the order `list_titles` gives: the numbered chapters, then the chapters with no number (in Title 24, the Health Code). Sections in no chapter come first (the Administrative Code's Title 31 has no chapters). `Title 15, Chapter 18` (or `15 RCNY Chapter 18`) gives only that title's Chapter 18. A Rules answer names each title on a line before its first chapter, as `list_titles` does. `Title 16` gives Title 16 alone. Titles 16-A and 16-B share its section numbers (16-A's sections are § 16-501 on), and are asked for as `Title 16-A` and `Title 16-B`. Through 0.6.2 the index recorded no titles, so `Title 16` brought 16-A and 16-B too (an Administrative Code chapter's title was worked out from its section numbers), and a Rules title found nothing; an index built before 0.7.0 still behaves that way. The Charter has no titles.

The index is flat: each source file keeps its records in document order, and a chapter is its heading record plus the records after it, up to the next chapter record. Through 0.6.0 this tool returned only the chapter's heading record, and `Title 6` found nothing. Through 0.6.2 a chapter ran on into the next file whenever that file's chapter had no number: the Health Code (a chapter headed "New York City Health Code") was listed in Rules Chapter 21, the Administrative Code's local laws by year in the chapters before them, and Title 31's sections in Title 28's Chapter 3. Now a chapter record with no number (`Preamble`, `2016`, `New York City Health Code`), or a section in no chapter, ends the chapter before it; those records are in no chapter here, and `search` and `get_section` find them.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `corpus` | string | yes | `charter`, `admin_code`, or `rules` |
| `title` | string | yes | A chapter (`Chapter 11`), or in the Administrative Code and the Rules a title (`Title 6`) or both (`Title 15, Chapter 18`) |
| `limit` | integer | no | Max records to return (default 200, max 1000) |
| `offset` | integer | no | How many to skip, for the next page (default 0) |

```
get_title("charter", "Chapter 11")
get_title("admin_code", "Title 6")
get_title("admin_code", "Title 3, Chapter 1")
get_title("rules", "Title 15, Chapter 18")
```

---

### `get_version`

Return the currency date for each document. Each corpus updates on its own schedule — the Charter and Administrative Code track enacted local laws, while the Rules update independently as agencies adopt new rules.

No parameters required.

```
get_version()
```

Example response:

```
NYC Charter:           Current through Local Law 2026/112, enacted June 19, 2026, (854 sections; indexed 2026-06-29T12:33:00.864Z)
Administrative Code:   Current through Local Law 2026/112, enacted June 19, 2026, (12587 sections; indexed 2026-06-29T12:33:09.801Z)
Rules of NYC:          Current through rules effective July 1, 2026. (8671 sections; indexed 2026-07-01T12:43:45.635Z)
```

---

### `whats_changed`

What changed in this server, newest first, from [WHATS-CHANGED.md](WHATS-CHANGED.md), which ships with the package. Covers new tools, corrections and other changes a reader would notice; daily law text updates are not listed (see [CHANGELOG.md](CHANGELOG.md)). Corrections say what to re-check if you used the old answer. Returns text plus `structuredContent` matching the tool's `outputSchema`.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `since` | string | no | `YYYY-MM-DD`: changes on or after this date |
| `tag` | string | no | `Site`, `Data`, `MCP` or `Correction` (any case) |
| `limit` | integer | no | 1 to 50, default 10 |

```
whats_changed()
whats_changed(tag="Correction")
```

---

### `about_betanyc`

Who built the server (BetaNYC, a project of the Fund for the City of New York), its version and repository, where to report a bug in this server or ask for a new feature, and links to BetaNYC. No parameters.

---

### `about_data`

Where the law text comes from, answered from [DATA-SOURCES.json](DATA-SOURCES.json), which ships with the package. There is one source per document (`charter`, `admin-code`, `rules`), each from American Legal Publishing's bulk XML download, the code library the NYC Law Department contracted for. For each it gives the publisher and link, whether it is the official text (the source is; this server's text is not, because the build cleans it, so `figures_official` is `false`), how it reaches this server, what BetaNYC changed, when this server's index was built for that document (read from `versions.json` at run time; `get_version` gives the publisher's own "current through" line), where to check a section, how to report an error in the text or in this server, and the corrections that touched it. Questions about the data go to BetaNYC at lab@beta.nyc. Returns text plus `structuredContent` matching the tool's `outputSchema`.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `topic` | string | no | `charter`, `admin-code`, `rules`, or a tool name such as `search`; `all` or nothing returns every source |

```
about_data()
about_data(topic="rules")
```

`data.json` is a DCAT-US 3.0 catalog generated from DATA-SOURCES.json (`python3 scripts/whats_changed.py about-data catalog DATA-SOURCES.json`); never edit it by hand.

`whats_changed`, `about_betanyc` and `about_data` are the three tools BetaNYC adds to each of its MCP servers. `src/betanyc-tools.ts` is a copy of the canonical file in BetaNYC's workspace (shared module 1.5.2); never edit the copy. Their text ends with the one-line disclaimer (the full one with `NYC_CLR_FOOTER=full`), and they do not use up the full footer meant for the first law answer.

---

## Testing and CI

### Running tests

```bash
npm test
```

`npm test` builds the TypeScript source first (`pretest` script), then runs the full suite with `node --test`. Every test file in the table below runs together, except two sets for the website: the browser tests (`npm run test:site`; run `npx playwright install chromium` once first) and the layout checks on the committed data (`npm run test:site-data`, in `test/site-data/`). Those two stay out of `npm test` on purpose: the daily refresh runs `npm test` before it commits new law text, and a change in the data's shape should stop the website's deploy, not the refresh. On a laptop the whole run, build included, takes about 4 seconds (measured October 2026). `npm run audit:coverage` checks the index against the downloaded ZIPs in `data/raw/` (see [What the index holds](#what-the-index-holds)); it needs `npm run fetch-data` first, so it is not part of any test run.

### Test layers

| File | What it covers |
|---|---|
| `test/extract-text.test.js` | Unit tests for the `extractText`, `normalize`, `childrenByTag`, `getAttr`, and `tagOf` helpers in `scripts/lib/extract-text.js`. Covers inline-LINK document order (issue #3 regression), entity decoding, ALP-marker stripping, enumeration-marker repair, empty/self-closing elements, deep nesting, whitespace-only text nodes, and helper edge cases. |
| `test/content-leak.test.js` | Regression tests for the content-leak fix (PR-A0): undecoded `&#160;` nbsp entities, `[ALP S-xxx]` editorial markers, and leading-digit run-ons (`1Each`). Includes scope guards confirming that inline labels with no `<TAB/>` after them in the source (`(6)the`) are left untouched. |
| `test/corpus-invariants.test.js` | Invariant assertions over the committed `data/index/json/*.json` (every section across charter, admin\_code, and rules). Asserts: no run-together text, no subdivision label fused to the next word (`a.There`, issue #27), no leaked XML tags, no undecoded entities, no double spaces, no leading/trailing whitespace, and structural integrity against `versions.json` counts. Collects all violations before asserting, with corpus/id/citation/snippet in the failure message. The two checks with lists of known source typos ("section and of", the fused label) print up to 25 new hits for a person to check against the XML instead of failing, since new law can bring one and the daily refresh runs this file; a parser regression (issue #27 hit 3,647 records) still fails. |
| `test/mcp-tools.test.js` | In-process tests for the MCP handler functions (`searchCorpus`, `getSection`, `listTitles`, `getTitle`, `getVersions`) imported from `dist/corpus.js`. Grounded in real index data, with every expected heading, text and result set read from the index file rather than pinned, so an amendment cannot turn the daily refresh red: "sinking fund" finds exactly the Charter records that hold the phrase, § 292 and § 11-602 / § 11-602.1 come back as their index records, no "sectionof" (the issue-#3 phrase itself is checked on a fixture in `build-smoke.test.js`), negative lookups, version presence, and title listing. |
| `test/search-fallback.test.js` | Plain-language questions (issue #30). Unit tests for stopword and question-word stripping (`queryTerms`) and surrounding-quote removal (`stripSurroundingQuotes`). Exact ranks, counts and first-line notices run against a synthetic 8-section index committed at `test/fixtures/search-index/`, served through `NYC_LAWS_INDEX_DIR` in a child process: ranking, word-start matching (`shed` is not found in "established"), plural `s`, the all-terms and widened notices, phrase results unchanged, quoted queries matched as phrases, and the count line after a fallback (`searchCountLine`), which counts every-term and some-term matches apart and never suggests a higher `limit` for the weak ones. Against the real index only behavior is checked (fallback used, notice first, terms listed, results non-empty), so a daily refresh cannot turn it red. |
| `test/search-ranking.test.js` | How the word fallback ranks (round 2 of #49): `termScore` one factor at a time (heading 3 times, rare over common words, long sections pushed down a little, short stubs 0.3, Local Law appendix records 0.5), and on a synthetic index at `test/fixtures/ranking-index/` a short section about the question outranks a long definitions section holding every word. The notice and count lines never say no section has every term when one does, even off the page. Phrase search and `get_section` lookups on the round-1 fixture return exactly what the 0.6.0 code returned (recorded). |
| `test/chapters.test.js` | `list_titles` and `get_title` (live check of 0.6.0), against the committed index with every expected value worked out from the index file, never a pinned count, heading or last section, so new law cannot turn the daily refresh red: Charter chapters once each (every chapter record in the index), in order, with whole numbers (`Chapter 18-A`, not `Chapter 18-`); Administrative Code chapters told apart by section range, no label shown twice except the publisher's own starred twins (July 2026: two Chapter 43s holding only § 21-1015); `get_title` lists a chapter's records in index order up to the next chapter (Charter Chapter 70, Chapter 1, Chapter 18-A), `Title 6` and `Title 24` give the Administrative Code chapters numbered 6-… and 24-…, `Title 3, Chapter 1` narrows to one chapter, a Rules title says to ask for a chapter, and other queries still match by prefix, whole tokens only. Holds on an index built before or after the label fix, and before or after #78's `level`. |
| `test/echo-and-paths.test.js` | A missing or unreadable index file (through a broken `NYC_LAWS_INDEX_DIR`) names the document, never the path, and writes the path to stderr; `echo()` cuts what the caller sent to one line of at most 100 characters, for a 5,000-character query, citation, title, parameter name, corpus value and tool name, and for fake stack-trace lines. |
| `test/index-dir.test.js` | The `NYC_LAWS_INDEX_DIR` override (issue #26), each case in a child process: unset and blank serve the bundled index; a set directory serves its versions and section text; relative paths resolve against the working directory; a directory without `versions.json` fails at startup naming the variable, with no silent fallback. Also starts the server over stdio and checks that `serverInfo.version` matches `package.json` and that `get_version` reports the override. |
| `test/footer-modes.test.js` | Disclaimer footer modes (issue #25). `NYC_CLR_FOOTER` parsing (unset, blank, both modes, a typo falling back to `full` with a warning); the default sending the full footer once and the one-line footer after; `full` sending it every time; not-found, empty and error responses carrying a disclaimer; and the invariant that every response in every mode, including an unrecognized one, says "legal advice". Also starts the server over stdio to check `instructions`, the first and second responses, and the single stderr warning. |
| `test/strict-schema.test.js` | Strict tool schemas (issue #19). Asserts every tool in `TOOLS` (from `dist/tools.js`) advertises `additionalProperties: false`, and that `callTool()` rejects an undeclared parameter with an error naming both the offending key and that tool's accepted keys — rather than silently dropping it and returning unfiltered results. Includes regression guards that valid calls, with and without optional params, still succeed. Also checks that the schemas generated from zod (issue #22) keep each tool's parameters, required set, choices and descriptions, and that `search`'s `limit` advertises the 1 to 50 the server enforces. |
| `test/annotations.test.js` | Every tool carries `annotations` (`assertEveryToolAnnotated`): `readOnlyHint: true`, `openWorldHint: false` (all answers come from the bundled index) and a title, in `TOOLS` and in `tools/list` over stdio (issue #38). |
| `test/tool-size.test.js` | The tools/list JSON plus the server instructions stay under a size budget (`toolListSize`), with a dated note for each raise (issue #44), and no sentence, such as the disclaimer, is repeated across the law-text tool descriptions (issue #48). |
| `test/errors.test.js` | Every failure (bad parameter values, a missing parameter, an unknown parameter or tool) is `isError` with a plain sentence that names what to fix and lists the accepted parameters, with no zod JSON or stack frames, and keeps the disclaimer (issue #46). |
| `test/fetch-retry.test.js` | `politeFetch` in `scripts/lib/fetch-retry.js`, the download behind `fetch-data`, against a fake fetch: User-Agent with the package version, a timeout, up to two retries on 429 and 5xx honoring Retry-After, none on a 404 (issue #39). |
| `test/provenance-lists.test.js` | Every law-text answer has a source line per document (publisher, the `indexedAt` date from `versions.json`, a code-library link) before the disclaimer (issues #40, #41), that says BetaNYC converted the text for the four law-text tools and stays a plain `Source:` line for `get_version`, each followed by the publisher's "current through" line exactly as `get_version` shows it, also on answers that find nothing (with which documents were searched; the empty `list_titles` case runs on the synthetic fixture); search says how many matched and that snippets are cut; `list_titles` pages through all of the Rules with `offset`; `get_title` pages by 200 by default and honors `limit` and `offset`; the `get_section` match list stops at 25 and says how many there are (issue #42). DATA-SOURCES.json lists wrong or cut-short citations as a known gap. Loose bounds only, against the committed index. |
| `test/index-checksum.test.js` | Each bundled `data/index/json/<corpus>.json` matches the `sha256` that `build-index.js` recorded in `versions.json`, and `mergeVersions()` keeps it and moves `indexedAt` when only the text changed (issue #45). |
| `test/stdout.test.js` | Starts the built server with a bad `NYC_CLR_FOOTER`, makes four calls, and checks that every stdout line is a JSON-RPC 2.0 message and the startup warning went to stderr (issue #47). |
| `test/build-smoke.test.js` | Build pipeline smoke test (Layer 5a). Feeds tiny hand-authored AML-shaped XML fixtures to the pure builder `buildSectionsFromXml` in `scripts/lib/build-corpus.js` — no multi-MB ZIPs. Asserts correct section shape, citation derivation (`Section 292.` → `§ 292`; a label with a period inside, such as `L.L. 2016/002`, `G.1.2` or `10-1104.1`, kept whole; a chapter's whole number, such as `Chapter 18-A` or `Chapter 19.1`, read only at the start of the heading), clean text (no tags/entities/edge whitespace), document-order LINK extraction, and that non-qualifying records (wrong style-name, too-short heading) are filtered out. |
| `test/formatting.test.js` | The publisher's bold and italic (follow-up to #78), on a hand-made fixture (`test/fixtures/formatting/`): runs read from `<CHARFORMAT>` as slices of the index's text (nested and inherited looks too), carried into the structure's `marks` and onto blocks, rendered as `<strong>` and `<em>` split around links and the label link, none added inside "Editor's note:" or a heading; the page text read back equals the blocks'; only a short wholly-bold line with text after it gets `boldline` (not a run of bold lines, a note line, the last line or a long one), always a `<p>`; and the index is byte for byte the same with and without the structure hooks on every XML fixture in the repo, with no private-use mark in it. |
| `test/group-records.test.js` | Text held outside sections (issue #78), on hand-made fixtures in the publisher's shape (`test/fixtures/group-records/`): reference standards, appendices, a schedule, the Water Board's rate schedule and the Board of Health resolutions become records, with short citations (`RS 18-1`, `Appendix A, Part I`), in document order and never with a section's text; `§ BC 602` (empty heading) and `§ 21-905` (heading only its number) take their paragraph as the heading; `&Sigma;` and `&alpha;` decode; links reach the new records; the Administrative Code site puts them in their chapter; citations carry the title and chapter (`Title 15, Chapter 42, Appendix A, Part I`) and never take a section's citation (`Schedule A`); and through `NYC_LAWS_INDEX_DIR` `list_titles` and `get_title` never start a chapter at one ("CHAPTER 1 – GENERAL", "Chapter D5"), and a chapter ends at a chapter with no number (the Health Code's shape) or a section in no chapter (Title 31's), while an index with no `level` keeps the 0.6.2 behavior. Also the coverage rule over every XML fixture in the repo: no text is left unread or read into two records. |
| `test/subsections.test.js` | The Construction Codes' subsections (issue #76), on a hand-made fixture in the publisher's shape (`test/fixtures/subsections/0-0-0-2.xml`, `Section > Subsection > Normal Level`): each subsection's heading line then its body, in document order, with body text before a subsection kept first; the heading line is the HEADING when the paragraph repeats it (spaces aside) or is only its start, the paragraph when the HEADING is empty, shorter, or the paragraph holds a cross-reference (kept as a link), and both when they differ; a level nested in a subsection is not read and is counted in `subsections`, and a picture still counts in `pictures`; every section with no subsection, in every fixture the repo has (Charter, Rules and this one), keeps the text the pre-#76 rule gives, byte for byte; the structure hooks cannot change the index; `subheading` blocks slice the text, carry the subsection's number as their anchor, and subdivisions start a new list under each, anchored under that number (two subsections' item (1) are `80.2(1)` and `80.3(1)`, no `-n`), with search titles and label-link names that read as real citations ("§ 80.3(1)", never "§ 8080.3(1)"); `citeWithAnchor`, `copyId` and `subsectionKey` on their own; a link to an anchor on a subsection record goes to its section; on the site, subheadings are `<h2>` on a section page and `<h3>` in a chapter page's copy, every page's heading outline starts at `<h1>` and skips no level, and the "leaves out" note names only what is still unread. |
| `test/structure.test.js` | The site structure (issue #61), on American Legal's own XML: the 44 Charter fixtures in `test/fixtures/diff/xml/`, 4 Rules files in `test/fixtures/structure/rules/` and 2 in `test/fixtures/structure/rules-edge/`. The structure hooks leave the index alone (the fixtures' JSON and Markdown hash to what v0.6.2 wrote, pinned in the test); every block is a slice of its section's `text` and the blocks joined with one space are the `text`; Charter § 1133 keeps labels, depths and anchors (`(b)(1)`); a label repeated in one section gets `(a)(1)-2`; a Charter link resolves to its section and a link into a document not built keeps its name; a Rules chapter with no Title record around it takes its title from the publisher's key (#59), and one with no match is left without a title; a link to an anchor id or name the publisher put on two records is left unresolved and marked `ambiguous` (Rules § 2-01 and § 2-01.1); block text is the index's text byte for byte, with no Unicode normalization (the micro sign in Rules § 40-05). When `data/structure/` is present, each file must carry the sha256 of the committed index JSON and `versions.json`, and slice its text exactly. |
| `test/tables.test.js` | Tables (issue #65), on two of American Legal's own Rules files (`test/fixtures/tables/rules/`: Title 2's Appendix A, a 9-column table with header cells that span columns, a line break and a link in a cell; Title 28 Chapter 32, § 32-04's table with a two-row head) and hand-made paragraphs in the publisher's shape: `paraTable` reads header cells, column and row spans, alignment and line breaks as slices of the index's text; extractText's separator rule holds inside a table; empty cells that end a table end at its text (a regression found on the July files); every fixture table carries `rows` whose cells cut its text in order with only a space or nothing between; the index and the Markdown are the same with and without `rows`; `bodyHtml` writes the box with its name in `data-table-name` and no region or tab stop (law.js adds those), `nys-table`, `<thead>` (cut back where a header cell spans into the body) and `<tbody>`, `scope="col"` on every head cell and no `colgroup`, spans, `<br>`, names that differ for two tables and no `data-block` in a chapter's copy, a table of 8 columns or more marked `data-many-columns` and a narrower one not, a table without `rows` as one paragraph, and cells the markup runs together with nothing between them; the fixture site shows the table on the section page and in the chapter's copy, its blocks reading back as the index's text. |
| `test/site-build.test.js` | The website build (issue #62), from the 44 Charter fixtures, without the Pagefind index: a page for every record, matching `versions.json`; chapters in the book's order, not the ZIP's; a unique title, description and canonical on every page and no repeated id; every American Legal id in `redirects.json`, every subdivision anchor and every link in the law text resolves (and an old path with an id on the end still redirects); every description at most 160 characters; the bottom box on every page but About, its "current through" line attributed to American Legal Publishing (a publisher line that does not start "Current through" stops the build); the box in two paragraphs, how current the text is and then the bold "BetaNYC modified … It is not legal advice." with how BetaNYC changed the text, the official text's link and the disclaimer link, and no "BetaNYC's copy, for research" line; on every law page one warning box, at the bottom and none after the text, whose official link goes to that record's own page at American Legal Publishing; the footer's "comes from American Legal Publishing" sentence on About only, the one page with no box; the footer's download link goes to `data/index`; the chapter pager names chapters as the lists do; the top bar's `aria-current`; the About page's disclaimer equals the server's `FOOTER` without its last line, and a `FOOTER` with a different last line stops the build; the About page has its sections in order, a jump list that names each one, the history links, the copy review's wording (with the serial comma), no warning before the Disclaimer section and no bottom box, the disclaimer last, and lab@beta.nyc as its contact; the Markdown and the HTML show the same blocks in the same order (for every Charter section too, when `data/structure/` matches the committed index; a table with `rows` reads back from its box as a `div`, issue #65); structured data uses only schema.org properties (the list in `test/fixtures/site/schema-org-30.1.json`); sitemaps, `robots.txt` and `noindex`; the jump box; the New York clock; `law.css` names no colors, and every font family it names, in `font-family` or a `font` shorthand, is the template's `var(--font-body)` or `var(--font-head)` (planted `Arial`, `system-ui`, `Georgia` and quoted families prove the check fails); every chapter, section and shared-number page has one contents tree in a closed fold, headed "Contents", with the book, every chapter in order, only its own chapter open and only that chapter's sections in the HTML (`aria-current`), no disclosure buttons in the HTML (law.js adds them), chapters with no sections marked, and the "☰ Contents" button before `<main>` (and all of the full Charter's chapters on § 259's page, against the committed index), and the contents page has none; each chapter's JSON list of sections matches its jump list; each chapter page has the jump list, then every section's text in order under its own `<h2>` with "Open this section" and "Copy citation" named for the section (with its heading when two sections in the chapter share a number), ids prefixed (`s-4(b)`), no `data-block` or `data-pagefind-title` in the copies, all of it `data-pagefind-ignore`, "Back to contents" last, no NYSDS back-to-top, and its own canonical and structured data; links in the copies to the same chapter stay on the page and resolve; the amendment history line (`txt history`) and the editor's note (bold "Editor's note:") keep their words, every parenthesized history line in the full Charter is found (§ 4 checked), and law text in parentheses is not; on every page with breadcrumbs the first is "Home", and on every indexed page the structured data names the same crumbs; the search box is on the home and search pages only, with its hint as placeholder text; the template copies are unchanged and their color pairs pass contrast (focus ring 3:1 on every background, text 4.5:1); the build refuses mismatched data and never clears a folder it did not make. |
| `test/deploy-workflow.test.js` | The website's deploy workflow (issue #64), read as text: it runs on a push to `main` and on `workflow_dispatch`, nothing else; every file the site build imports (walked from `scripts/build-site.js`) or reads (`src/tools.ts`, `DATA-SOURCES.json`, the index, the structure, the lockfile) is in its push `paths`; only `main` builds; `pages: write` and `id-token: write` only on the deploy job; one deployment at a time; `npm test`, `npm run test:site-data` and `build-site` run before the upload, in that order, and `refresh-data.yml` never runs `test:site-data` or `test:site`, and no file `npm test` runs lays out the real Administrative Code; the build is the plain `npm run build-site` (every book, no `--charter-only`) and the check step looks for the contents pages, the Administrative Code's sitemap and the Pagefind index, and the Rules' files when `metadata.json` says the build has them; the smoke check reads the deployed URL and checks `/admin-code/` too, and `/rules/` when the build has it. And that `refresh-data.yml` dispatches it only when its commit step pushed, as its last step, and that its coverage audit runs after `build-index`, before the tests, with `continue-on-error`, no step `id`, no `--check`, no output or commit, only the step summary. |
| `test/site-admin.test.js` | The Administrative Code's site rules on small made-up data (issue #65), so the daily refresh, which runs `npm test`, never depends on today's titles or counts: parts keep order and stay within 100 sections and 150,000 characters (one oversized section alone); section paths for every citation shape; headings without their citations; `get_title`'s rule; the note for a section with pictures or unread levels and the empty-text line, each linking to American Legal Publishing; `build-structure.js` counting pictures and still-unread levels per section, never per chapter, and reading subsections into the index's text (#76); each book's own pages getting only that book's facts, even when the two books' dates differ, and the home, search, About and 404 pages getting both; a reference into the other book never kept on a chapter page, even when the id is in both books; same-numbered sections told apart by heading, chapter, the publisher's group or id; subdivision anchors that differ only in case getting different names; and the 404 page's choice when an id is in both books. |
| `test/site-data/admin-layout.test.js` | Run by `npm run test:site-data` (in `test.yml` and `deploy-site.yml`, never in the daily refresh). The Administrative Code's layout on the committed data, every expected count worked out from the structure file, not pinned: the publisher's Title records plus one group for the year chapters, every record placed once, titles in number order, a title's own sections; titles agreeing with `chapterGroups` from `dist/corpus.js` (a lettered title numbered in its parent); a chapter split exactly when it passes the caps, its parts covering it in order; references to the Charter linking only when the build has it, and links to a shared number named apart; the menu (every title a link, only the reader's title, chapter and part open, one status line, no buttons in the HTML, under 40 KB); each title's JSON; part, chapter, title and section pages; the front page's cards and lede; redirects, including an id in both books; the home, About, search and 404 copy with both books; and on every Admin Code page, read from its HTML, no link name that goes to two places and no two buttons with one name (the repo's rule from `test/site/a11y-tree.mjs`); and every section with subheadings (#76) shows each as an `<h2>` on its page and an `<h3>` in its chapter, part or title page's copy, with no page's headings skipping a level (nothing to check on data built before #76); and every record for text outside a section (#78) has a page in its chapter and its text on that page; every record's `level` in the index is the structure's, left out only for a section inside a chapter; and no such record shares its citation with a section or chapter in any of the three books (nothing to check on data built before #78). |
| `test/site/admin.test.mjs` | Run by `npm run test:site` (`test.yml` only). Builds the real Charter and Administrative Code (no Pagefind, about 360 MB in a temporary folder, removed afterwards) and opens them in headless Chromium, picking its pages and names from the data: a section page has one button per title with the reader's open and every control named once; a Charter page's box names the Charter alone; opening a title shows "Loading…" in the status line, then its chapters, with focus kept on the button, and a second press while it loads fetches nothing more and adds no second list; a title that fails to load says so, stays closed and loads on the next press; with JavaScript off titles are links and a title page lists its chapters; a part page's heading, parts list and previous/next part links; every part or chapter page that holds two sections with one number has no duplicate or conflicting names; the 404 page offers both books for an id in both, and a book in the path picks it; the front page has one card per title, no chapter links, a visible focus ring and one column on a phone; the home page has both Browse buttons; the longest record for text outside a section (#78; RS 18-1 in July 2026) is marked in the contents tree, Copy citation and Copy link copy its citation and address, it does not scroll sideways at 390px, and every control on it is named once. |
| `test/citation-round-trip.test.js` | Citations the website gives and the MCP takes, both ways, on a hand-made index and a hand-made `citations.json` list built with the site's own `recordKeys`: `get_section` with a book's name (`NYC Administrative Code § 27-506`, `Admin. Code § 27-506`, `NYC Charter § 1133`, `the City Charter § 1133`) looks only in that book (a number both books have is the named one's), says why when `corpus` names the other, and falls back to the words as typed (`Charter revision commission`, `Administrative code`); `NYC Administrative Code Local laws, 1985`; `FC 102`, `EC 80`, `RS 18-1`; on a miss, a part of a section is the whole section with a first line naming the part (`§ 1133(b)(1)`, `Section FC 102.4(1)`, `Section BC E104.2.2`, `15 RCNY § 1-01(a)`, and a list when the number is in two books), while exact citations with parentheses or points (`D302 … (MDL 9(2))`, `§ 11-602.1`) answer as before and `§ 11-602.9` and `Independent budget office (IBO)` find nothing; the heading search runs only on the text as typed, so `Admin. Code § 27-50(b)`, `15 RCNY § 1-0(a)`, `Section FC 10.1`, `Local laws, 2030` and `Admin Code 1` find nothing; `parseBookName` and `splitSubdivision`. The jump box: a book's name looks only there (`NYC Charter § 27-506` finds nothing; `NYC Administrative Code Title 28, Chapter 1` goes straight to the Administrative Code), code and reference-standard forms (`fc102`, `Section FC 102.4(1)` to `#102.4(1)`, `BC E104.2.2` to `#E104.2.2`), every citation in the list back to its page, words still words, and the book names in `jump.js` equal to `config.js`'s. |
| `test/site-rules.test.js` | The Rules on the site, from the hand-made Rules fixtures (`test/fixtures/titles/rules/`) and the Charter fixtures, without Pagefind: every record's page under its title (`/rules/titles/15/sections/1-01`), titles from each record's `titleNumber` (the Health Code and Chapter 3 in Title 24 with no Title record around them), a number a title repeats getting American Legal's id and a page to pick one, `/rules/sections/1-01` for a number in several titles and `numbers.json` for the rest (an address that is not percent-encoding, `/rules/sections/50%`, is no number, not an error); citations (`15 RCNY § 1-01`, `24 RCNY Health Code § 81.08`, `30 RCNY Apartment & Loft Order #49 (2017), Notice`) in each page's heading, title and search title, and `get_section` (from `dist/`) finding each record by its page's citation as by `fullCitation`; an index without titles building no Rules pages, and a half-titled one stopping; title cards, the menu's JSON, headings, the bottom box (American Legal and rules.cityofnewyork.us), home, About, search and 404; the jump box (`15 RCNY § 1-01` goes to its page; `Title 28, Chapter 1` goes straight only to the Administrative Code and offers the Rules); chapters 19, 19A, 19.1, 20 in order and a chapter number used twice with a page to pick one (a Title 43 of the test's own); 404 redirects; links into and out of the Rules; sitemaps. |
| `test/site-data/rules-layout.test.js` | Run by `npm run test:site-data`; skipped until the committed Rules index names each record's title. The Rules on the real data: one page per record under its title, titles from `titleNumber` (chapters with no Title record placed by it), every page's citation finding with `get_section` the same records as `fullCitation`, parts within the caps, names unique where a reader picks, links from the Charter and the Administrative Code landing on Rules pages, every page's headings, titles and citation, and on every Rules page no link name that goes to two places. |
| `test/site-data/tables.test.js` | Run by `npm run test:site-data`. Tables (issue #65) on the committed Rules and Administrative Code: every table's cells are slices of its block's text, in order, with only a space or nothing between; every page gives each table box a name in `data-table-name`, and no two alike; each section page's blocks read back as the index's text; one table box per table with `rows` and one paragraph per table without. Section and chapter pages both count (the Rules' appendix chapters hold tables of their own). The cell check skips, saying why, when the committed structure has no `rows` yet. Counts are reported, never pinned (on the committed structure, built before #65: 2,324 Rules and 5,226 Administrative Code tables, all shown as paragraphs; on the July 2026 files rebuilt with `rows`: 2,324 and 5,089, all shown as tables). |
| `test/site-data/citation-round-trip.test.js` | Run by `npm run test:site-data`. For every record the site builds from the committed data, in all three books, its `fullCitation` (what Copy citation gives) finds it with `get_section` (alone or in a list) and lands on its page in the jump box, or on the search page's list when records share that citation; and citations of parts of sections (`citeWithAnchor`: every anchor shape in each book and every 25th anchor) find their own section, by id, with `get_section` and their own page at the anchor in the jump box. No counts pinned; the counts are printed. |
| `test/site/rules.test.mjs` | Run by `npm run test:site`. The real Charter and Rules when the Rules index has titles, else the fixtures: a section page's citation, Copy citation, menu and box, every control named once; the titles menu by keyboard (Loading…, focus kept, presses while loading ignored), a failed load; the page to pick a title for a bare number, and the 404 page sending a one-title number and an American Legal id on; the jump box (`N RCNY § …` opens the page, `Title N, Chapter M` offers it on the search page); 390px with no sideways scroll; JavaScript off; pages holding records that share a citation. |
| `test/site/overflow.test.mjs` | Run by `npm run test:site`. Builds the committed data's whole site (no Pagefind) and opens, at 390px, every page whose text has a run of 30 characters or more with no space, or a breadcrumb that long (`test/site/long-runs.mjs` finds them all in the HTML), failing on any page wider than the screen. `LAW_READER_SITE=<folder>` checks a site already built (a July build: 732 pages, none too wide). It also opens every page that shows a table (`pagesWithTables` in `long-runs.mjs`) at 390px and 320px, failing on any that scrolls sideways and reporting how many tables scroll inside their own box, and prints each at 720px (US Letter less Chromium's margins is about 739px), failing on any table whose right edge passes the page (a July build with `rows`: 2,137 pages, none too wide, none cut off). The two table checks skip, saying why, when no page shows a table (a structure built before #65). |
| `test/site/tables.test.mjs` | Run by `npm run test:site`. Tables (issue #65) in Chromium, on the fixture site plus `test/fixtures/tables/rules/`: with `nys-table` running, the rows stay in the publisher's order (the same cells as with JavaScript off), two head rows in `<thead>`, every head cell `scope="col"` (spanning ones too) and no `<colgroup>`, a table with column headers, controls named once; a box whose table fits (§ 32-04 at 1200px) is no region and no tab stop, becomes a named region and tab stop when the window narrows to 320px, and stops being one when it widens again, except that a box with the focus keeps its tab stop and name until the focus leaves it; at 390px and 320px the 9-column table scrolls inside its box and no page (section or chapter) scrolls sideways; Tab reaches the box, which is named, shows the focus ring and scrolls with the arrow keys; a chapter page names each box apart; with JavaScript off it is a plain bordered table, and Tab and the arrow keys still reach and scroll a box that scrolls; in print the box does not clip it, and printed at 720px, with JavaScript on and off, the 9-column table's right edge is inside the page with its words allowed to break anywhere, and the 5-column table fits with its words whole. Checked by mutation: without the box's scrolling, without the `<thead>`, or with the print rules before the review, these fail. |
| `test/site-search-kinds.test.js` | Kinds of search result and the search page's filters (issue #65), from the Charter, Administrative Code (`test/fixtures/site-admin/`: Title 10 and two years of local laws in no title, the publisher's shape, not its text) and Rules fixtures, without Pagefind: `site/assets/filters.js` (kinds in order, labels, a value the order does not know last); every page search reads has exactly one `kind`, one of the known ones; `localLawTitleBlock` (the "A Local Law" paragraph, else "To amend" or "In relation to", else none, when every paragraph gets the low weight); the two local-law notes are "Local law", their title paragraph at `LOCAL_LAW_TITLE_WEIGHT` and every other paragraph at `LOCAL_LAW_WEIGHT`, the heading unweighted, and no section carries a weight; their years "Local law" labeled "Local laws by year", every other section and chapter "Section" or "Chapter", none in the Charter or the Rules; the search page's `data-books` lists Charter, Administrative Code, Rules (a Charter-only build: the Charter); and every import in the site's scripts is a file the build copies (`search.js` needs `filters.js`). |
| `test/site-data/search-kinds.test.js` | Run by `npm run test:site-data`. On the committed data: the pages the site calls local laws are exactly the index's untitled `L.L. YYYY/NNN` records, each rendered as "Local law" with every paragraph weighted, at most one (its title paragraph) at the higher weight, and at least 95% of notes with one (every 25th other section checked as a plain "Section" with no weight); every year of local laws is "Local laws by year" and holds only notes, every other chapter is "Chapter"; the Charter and Rules have none; the search page lists every book built, in order, by its long name. Counts come from the data. |
| `test/site/search-kinds.test.mjs` | Run by `npm run test:site`. The three fixture books with their Pagefind index, in headless Chromium: the filters are two groups, Book (Charter, Administrative Code, Rules) and Kind of page (Sections, Chapters, Local laws), all checked, every control named once with nothing unnamed, at 1200px and 390px; a search for "turnstile" (in the note's body, not its title paragraph) lists § 10-172 before L.L. 2016/002 (with the note at full weight it came first), labeled Section and Local law; a search for "local laws 2016" finds the year's page labeled "Local laws by year"; Tab from Go reaches Charter, then Administrative Code, and Space on a box filters the results and writes the address (`kind=Section&kind=Chapter`, `book=Charter&book=Rules`); Back and Forward set the boxes along with the address and the results, and the next toggle starts from them; the last box in a group stays checked, by Space and by mouse click (on screen, in the inner input and in the accessibility tree, twice in a row, and the next click starts from it), with the status line keeping the count and saying why, and the address and results unchanged; an address with filters opens with its boxes set; no sideways scroll at 390px or 320px; a full citation still jumps with a filter in the address, and the box still jumps from a results page; with JavaScript off, no checkboxes and a link to the contents; nothing loads from outside the site. |
| `test/site/search-ranking.test.mjs` | Run by `npm run test:site`, not `test:site-data`: Pagefind searches only in a browser, and the deploy job has none. Builds the committed data's whole site with its Pagefind index (about 700 MB, 25 seconds, 4.2 GB of memory on a Mac) and searches it with `test/fixtures/search-ranking/queries.json`: fewer than one local-law note per search in the first 10 results of the 20 crowding searches (24 with notes at full weight); at least 45% of the 40 notes (18) in the first 10 when searched by their own subject (21 now; 16 with a whole note at 0.5, 15 at 0.25); and three pinned laws (`term limits for elected officials` → L.L. 2008/051, `area name` → L.L. 1990/056, `childhood lead poisoning prevention` → L.L. 2004/001) in the first 10. Prints both measures. Skipped when `data/structure/` is missing. |
| `test/site/site.test.mjs` | Run by `npm run test:site`, not `npm test`. Builds the fixture site with its Pagefind index, serves it on 127.0.0.1 and opens it in headless Chromium. Reads the accessibility tree (aria snapshot, `getByRole`, and Chromium's computed role and name for every focusable element, inside NYSDS's shadow roots too) on every page type (home, contents, chapter, a chapter where two sections share a number, section, shared number, search with results, About, 404) at desktop and phone width, and fails if a control has no name, two controls share a name, one link name goes to two places, or something takes focus with no role or name; a planted duplicate, an unnamed button and a `<span tabindex="0">` prove the check fails. No page scrolls sideways at 320px. In forced colors a focused search box shows a ring. The search box is only on the home and search pages, named by its label, with placeholder text at 4.5:1 or better. The contents tree holds every chapter with the current one open and the current section marked, under a "Contents" heading in the template's heading font; each chapter with sections has a button named for it, with `aria-expanded` and `aria-controls`, that opens with Enter and closes with Space, loading only that chapter's JSON once (a failed load says so and links to the chapter); "Hide" folds the column on a wide screen, moves focus to "☰ Contents", is remembered on the next page, and "☰ Contents" brings it back; on a phone the tree is behind one closed "Contents" button, one tab stop, above the breadcrumbs, and Hide returns focus to it; with JavaScript off there are no buttons, a wide screen shows the tree, a phone a closed "☰ Contents" fold, and the chapter links work; the heading and text (or a chapter's jump list) start within the first screen at 390px with JavaScript on and off; the skip link passes the tree; the tree scrolls itself (not the page) to the reader's own section, or else the open chapter, and Shift+Tab up it never leaves a focused link or button under its sticky heading; in forced colors the triangles keep 3:1 and the current page keeps its bar. A wide chapter page shows every section's text, its jump list and the tree's links jump within the page, each section's Copy citation copies its citation, "Back to contents" stays in the window and returns to the jump list, and Tab through the whole chapter never leaves focus under "Back to contents"; a phone chapter page (JavaScript on and off) shows only the jump list, linking to the sections' pages, the links follow the width when the window changes, and a link to a copy goes on to the section's own page and part. Pagefind finds a word from a section on its own page and never on a chapter page. The largest fixture chapter page's size is printed. The first breadcrumb is "Home" and the trail lines up with the heading. No law page scrolls sideways from 320px to 1920px wide; the law text is in the body font on screen and in print. Also: section text and the bottom box with JavaScript off, citation jumps (Enter and the Go button, a subdivision, a shared number), a part typed in another case (`#(A)` and `§ N(A)` land on `(a)`, rewrite the address to the real id with no extra history entry, and Copy citation and Copy link use it; of two ids that differ only by case, the exact one or none), a hash that is not percent-encoding (`#%`, `#50%`) leaving Copy citation and Copy link working, word search (snippets, sub-results, paging, filters), Copy citation, the print stylesheet, the skip link, the 404 redirect, and that nothing loads from outside the site. |
| `test/markdown-parity.test.js` | Rebuilds each committed `data/index/markdown/<corpus>.md` from the committed JSON (and the committed structure, when there is one) with `scripts/lib/serialize-markdown.js`, and compares every byte, for every section of all three documents. |
| `test/build-idempotence.test.js` | A rebuild with no source change must leave every tracked output byte-identical. Unit tests for `mergeVersions()` in `scripts/lib/merge-versions.js` (an unchanged corpus keeps its prior `indexedAt`; a changed `currentThrough` or `sectionCount` adopts the fresh one; re-merging is a fixed point), plus two runs of `scripts/update-changelog.js` against a temporary tree, asserting the second leaves `versions.json`, `changelog.json`, `CHANGELOG.md` and `README.md` unchanged. ZIP-free, so it runs in CI. |
| `test/auto-release.test.js` | Unit tests for the pure helpers in `scripts/auto-release.js`: finding the bump commit, shortening AML "current through" lines, listing which corpora moved, and the release-entry text. Starting values are pinned in the test, not read from live data. |
| `test/betanyc-tools.test.js` | `whats_changed` and `about_betanyc`: advertised read-only and strict with an `outputSchema`; every entry in this repo's `WHATS-CHANGED.md` valid and returned; filters; bad arguments rejected by name; every Correction carrying advice; the disclaimer on both, without using up the full footer; and both answers accepted by the MCP SDK client over stdio against their output schemas. Depends on no law text and no package version, so a daily refresh cannot turn it red. |
| `test/about-data.test.js` | `about_data`: every tool has a source in `DATA-SOURCES.json` (`assertEveryToolExplained`, so a new tool cannot ship unexplained); one source per document, from American Legal Publishing, with `figures_official` false because BetaNYC cleans the text; each document's date read from the `versions.json` being served, and "unavailable" when an index has none; BetaNYC's contact address; the disclaimer; and the answer accepted by the MCP SDK client over stdio against its output schema. Depends on no law text and no package version. |
| `test/whats-changed-release.test.js` | The What's changed release gate end to end, in a throwaway git repo with a stub `npm` (needs `python3`; skips without it): a hand bump waiting for its tag (refresh commits data without a bump, CI passes, the gate fails), release day (both headings dated in one commit; the gate and the append-only check pass), the next automatic release (no entry needed, gate passes), and an Unreleased entry beside a published version (refresh commits data, prepares no release, goes red; CI rejects it). |
| `test/auto-release-cli.test.js` | End-to-end runs of `scripts/auto-release.js prepare` and `ensure` against a throwaway git repo with stubbed `npm` and `gh`: version bump, tagging, one release dispatch, and recovery from a depth-1 checkout. The fixture pins the version (0.3.0) and the Rules "current through" date (October 4, 2026), so it does not drift when real releases ship or the law text moves. |

### Evaluation set

`eval/questions.json` holds realistic questions with known answers in the law text (which section sets up the Independent Budget Office, where the Open Data Law is, how long a sidewalk shed can stay up), written on 2026-11-18 before the first scoring run. `npm run eval` runs them offline against the bundled index; `npm run eval -- --save` also writes the results to `eval/runs/` (`--save=NAME` for a named run, `--note=TEXT` to say what it is for), and never overwrites an earlier run. It is not part of `npm test`: run it before a minor release and keep the result.

Results so far, all on 2026-11-18:

- 11 of 12 on the first set ([eval/runs/2026-11-18.json](eval/runs/2026-11-18.json)). Q10, the plain-language sidewalk-shed question, missed Administrative Code § 28-220.1 in the top 10.
- 12 of 17 after five questions asked the way a person would ask, with no citation (Q13 to Q17), were added and Q09 was made to check the penalty amounts it asks about ([review-fixes](eval/runs/2026-11-18-review-fixes.json), and the same again in [round2-before](eval/runs/2026-11-18-round2-before.json)). Q10, Q13, Q14, Q15 and Q16 failed. The cause was not missing word weights, as first written: the word search ranked any section with more of the question's words first, before its weights applied, so long definitions sections won.
- 15 of 17 with the ranking described under `search` ([round2-after](eval/runs/2026-11-18-round2-after.json)). Q10, Q13 and Q16 now pass, and no question that passed before fails. Two still fail, and keyword ranking cannot fix them: in Q14 ("How warm does my landlord have to keep my apartment in winter?") the right section, Administrative Code § 27-2029, "Minimum temperature to be maintained", contains none of the question's words. In Q15 ("Where is smoking banned in NYC?") § 17-503 does contain "smoking", but so do 127 other sections, and it lacks "banned", the rarest word, which 8 other sections have. With the rest of that round's fixes the result is the same, 15 of 17 ([round2-final](eval/runs/2026-11-18-round2-final.json)).

### Differential test (Layer 4 — occasional cadence)

A cross-engine differential test compares our JS extraction against an independent Python reference over 44 committed charter XML fixtures. It is **not part of `npm test`** — it runs only when explicitly invoked:

```bash
npm run test:diff
```

The test shells out to `python3` (stdlib `xml.etree.ElementTree` + `itertext()`) and asserts that both engines agree on normalized section text for all 393 sections across the fixture set. If `python3` is not on PATH, the test skips gracefully rather than erroring.

The fixtures live in `test/fixtures/diff/xml/` — 44 files selected deterministically (every 2nd file by sorted filename from `data/raw/charter/XML/`, always including `0-0-0-1277.xml`). They are committed to the repo so the test runs in CI without downloading ZIPs.

**Calibrated baseline (2026-06-02):** 393/393 sections agree after the comparison normalizer. One intentional formatting difference is neutralized before comparing: the JS path appends a trailing space after standalone digit-dot enumeration markers (`"1."`) to restore a formatting separator that empty `<TAB/>` elements drop; Python's `itertext()` returns raw source text. Both are faithful to the source; the space is a readability aid. The comparison normalizer collapses `"N. "` → `"N."` on the JS side so the comparison tests token order and content only. No allowlist entries are required.

### Continuous integration

`.github/workflows/test.yml` runs `npm ci && npm run build && npm test` on every pull request and push. Node matrix: **20.x and 22.x**. The manifest declares `engines.node ">=20"` — a floor only; the server uses no APIs newer than Node 20, so newer Node releases are supported even though CI tests the 20.x/22.x pair. Node 18 was dropped because it reached End-of-Life on 2025-04-30; the manifest previously declared `>= 18` but CI never tested it.

`.github/workflows/test.yml` also runs a **What's changed** job: `node scripts/auto-release.js check-whats-changed --base-ref <merge base with main>`. It validates `WHATS-CHANGED.md` with `scripts/whats_changed.py` (copied unchanged from BetaNYC's workspace; never edit it here), checks that old entries are only ever added to, that a version bump in a pull request has an entry, and that an `## Unreleased:` entry comes with a hand-bumped, undated release in `RELEASES.md`.

It also runs an **About data** job: `python3 scripts/whats_changed.py about-data check DATA-SOURCES.json --tools-file <the built server's tool list>` (every tool has a source, the file has no errors), `about-data catalog DATA-SOURCES.json --check` (`data.json` is current), and the JSON Schema and DCAT-US 3.0 validators (`scripts/tests/catalog_validate.py`, with `jsonschema==4.26.0`, `referencing==0.37.0` and `rfc3987==1.3.8` pinned through `uv`). `release.yml` runs `about-data check --release` before `npm publish`.

It also runs a **Charter site** job (the name is older than the Administrative Code): `npm run test:site-data` (the site's layout on the committed data), `npm run test:site` in Chromium, and, once the daily refresh has committed `data/structure/`, `npm run build-site` over the whole Charter and Administrative Code. That job deploys nothing; deploying is `deploy-site.yml` (see [Deploy](#deploy)).

`.github/workflows/differential.yml` runs `npm run test:diff` on **manual dispatch** (`workflow_dispatch`) and **nightly at 03:00 UTC**. It is intentionally off the per-PR/per-push path. Python matrix: **3.11 and 3.12** (covers the team's 3.11–3.14 spread; harness uses stdlib-only APIs compatible with 3.8+).

`.github/workflows/refresh-data.yml` refreshes the corpus index from AML **daily at 11:00 UTC** (07:00 EDT / 06:00 EST) and on manual `workflow_dispatch`. It runs the full pipeline (`fetch-data` → `build-index` → a report-only coverage audit → `update-changelog` → `npm test`) and commits the refreshed index back to `main` with the built-in `GITHUB_TOKEN` **only when the corpus version actually advances** — a no-op rebuild produces no commit. A commit with new law text also bumps the patch version and triggers an npm release (see [Releases](#releases)). The [site structure](#site-structure-datastructure) is committed with it; a change to the structure alone (its first build, or a change to the structure code) is committed by itself, with no version bump and no release, since it is not in the package. Either commit also starts the website's deploy (see [Deploy](#deploy)). Because `npm test` runs **after** the fetch and rebuild, the tests see that day's new data. The refresh runs `npm test` only: the website's checks on the real data (`npm run test:site-data`, `npm run test:site`) are kept out of it, so a new title or a new year of local laws can stop a deploy but never the refresh. A test must never assume what `data/index/json/` says today: pin the values it depends on inside the test, or the refresh goes red on exactly the days law text changes and the new text never gets committed. The coverage audit (`npm run audit:coverage`, see [What the index holds](#what-the-index-holds)) writes how much of each document reached the index, and any text that did not, to the run's summary page; it has `continue-on-error` and nothing reads its result, so it never blocks the tests, the commit, a release or a deploy. The "Last index update" block below is stamped by that job.

## Releases

`.github/workflows/release.yml` is the only workflow that publishes to npm. It runs the test suite, checks that the tag matches `package.json`, publishes with provenance, and creates a GitHub Release with generated notes. It starts in one of two ways.

**Automatic patch releases (law text changed).** When the daily refresh commits new law text, the same commit bumps the patch version (`package.json`, `package-lock.json` and `server.json`) and adds a dated "Automatic data release" entry to [RELEASES.md](RELEASES.md) naming which corpora moved. The job then pushes the `vX.Y.Z` tag and starts `release.yml` on it with `gh workflow run` (a tag pushed by the built-in token does not trigger workflows by itself; `workflow_dispatch` is GitHub's documented exception). Days with no new text produce no release. An automatic release ships `main` as it stands, so code merged since the last release goes out in the next one; bump the minor version by hand first if that code warrants it.

If the current version is not on npm yet (for example you bumped it by hand and have not tagged it), the refresh still commits data but does not bump past your version. If the release cannot be prepared (for example the npm registry is unreachable), the new law text is still committed without a version bump and the refresh run goes red. If an automatic release fails, its Release run goes red and every following refresh run goes red too, naming the run to rerun, until the version is published. To recover, fix the cause and rerun the failed Release run (Actions → Release → Re-run, or `gh run rerun <id> --failed`). Never re-tag or bump to recover.

**Manual releases (code changes).**

1. In a pull request: bump the version in `package.json`, `package-lock.json` and `server.json` (both `version` fields), add a [RELEASES.md](RELEASES.md) entry headed `## vX.Y.Z — Unreleased`, and, for a change a reader would notice, a [WHATS-CHANGED.md](WHATS-CHANGED.md) entry headed `## Unreleased: Title`, tagged MCP, whose MCP version line links to `RELEASES.md` with no anchor. `release.yml` refuses to publish if `server.json` differs from `package.json`. Once merged, the refresh keeps committing law text but does not release automatically until this version is on npm, so npm users get no new law text meanwhile. After the hand release has been on `main` for more than two days (New York dates), each refresh run goes red to say so.
2. On release day, one commit on `main`, with the New York date (`TZ=America/New_York date +%F`):
   - `## Unreleased: Title` becomes `## YYYY-MM-DD: Title` in WHATS-CHANGED.md. The title must stay the same; the check rejects a changed one.
   - `## vX.Y.Z — Unreleased` becomes `## vX.Y.Z — YYYY-MM-DD` in RELEASES.md.
   - The entry's MCP version link gains the new RELEASES.md anchor. Compute it, never type it: `python3 -c "import sys; sys.path.insert(0, 'scripts'); import whats_changed as w; print(w.github_slug('vX.Y.Z — YYYY-MM-DD'))"` (for `v0.5.0 — 2026-11-13` it prints `v050--2026-11-13`).
   - Check: `node scripts/auto-release.js check-whats-changed --release` must pass. It is the same gate `release.yml` runs before `npm publish`.
3. Tag that commit and push: `git tag vX.Y.Z && git push origin vX.Y.Z` (the tag must match `package.json`, or the workflow fails).

Automatic data releases never get a WHATS-CHANGED.md entry and pass the gate. The refresh does not prepare one while WHATS-CHANGED.md has an Unreleased entry: in the normal flow that entry sits beside an unpublished hand bump, which already pauses automatic releases. If an Unreleased entry ever sits beside a version that is already on npm, the refresh commits the law text without a release and goes red, naming the fix, rather than ship the entry undated.

**Authentication.** `release.yml` is set up for [npm trusted publishing](https://docs.npmjs.com/trusted-publishers) (OIDC, no stored token). Until the trusted publisher is configured on npmjs.com it falls back to the `NPM_TOKEN` secret. One-time setup, by a package owner:

1. On npmjs.com, open `@betanyc/nyc-charter-laws-rules` → **Settings** → **Trusted Publisher** → **GitHub Actions**.
2. Fill in exactly (case-sensitive): Organization or user `BetaNYC`; Repository `nyc-charter-laws-rules`; Workflow filename `release.yml` (filename only, not the path); Environment name left blank. Under **Allowed actions**, also allow direct publishing with `npm publish`: configurations created after September 3, 2026 allow only `npm stage publish` by default, and the workflow publishes directly, so without this box npm rejects the trusted-publishing publish. Save. npm does not validate these fields when you save them.
3. Set **Settings** → **Publishing access** → "Require two-factor authentication and disallow tokens". npm's docs say trusted publishers keep working under that setting, so the next release can only succeed through trusted publishing: a green Release run after this point is the confirmation, provided its "Publish to npm" step actually ran (release.yml skips that step when the version is already on npm, for example on a rerun). (A success before this step does not prove it, because the workflow falls back to `NPM_TOKEN`, and npm's docs give no way to tell from the run log which one was used.) If that release fails with an authentication error, the trusted publisher is misconfigured. Re-check step 2 and rerun it. If you re-allow tokens instead, repeat step 3 once trusted publishing is fixed.
4. Once a release has succeeded with tokens disallowed, remove this repo's access to the `NPM_TOKEN` secret.

**MCP Registry.** After each successful release, `.github/workflows/publish-mcp.yml` lists that version in the [official MCP Registry](https://registry.modelcontextprotocol.io) as `io.github.BetaNYC/nyc-charter-laws-rules`, from `server.json`, using GitHub OIDC (no secret). `glama.json` claims the server on Glama.

Package release history lives in [RELEASES.md](RELEASES.md); [CHANGELOG.md](CHANGELOG.md) is machine-generated and tracks corpus data updates only. [WHATS-CHANGED.md](WHATS-CHANGED.md) is the plain-language record of what a reader would notice.

---

## Legal disclaimer

This server is for **research and informational purposes only. It does not provide legal advice.**

Caveats are encoded at three levels so no response can be returned without one:

1. **Server instructions** — the full disclaimer below is sent once as the server's `instructions` when a client connects, in every footer mode. Tool descriptions do not repeat it: it went out of them in issue #48, so it is not paid for on every turn. Some clients pass the instructions to the model and some do not, which is why level 2 never goes away.
2. **Response footer** — every payload returned by the server ends with a disclaimer, regardless of which tool was called, what was found, or whether the call failed. By default the first response after the server starts carries the full footer below and every later response carries a one-line version (see `NYC_CLR_FOOTER` under Configuration).
3. **`get_version` instruction** — the `get_version` tool description explicitly instructs the AI to call it before answering legal questions, so every response is grounded in the correct version of the law.

### Full footer (server instructions, and the first response)

> ⚠️ **This information is for research and informational purposes only and does not constitute legal advice.** NYC laws and rules are amended frequently — always verify the current text at [codelibrary.amlegal.com](https://codelibrary.amlegal.com/codes/newyorkcity/latest/overview) before acting on any information. For the latest rules information, see [rules.cityofnewyork.us](https://rules.cityofnewyork.us). For legal matters, consult a licensed attorney.
>
> **Official disclaimer from American Legal Publishing:** The Codes and other documents that appear on this site may not yet reflect the most current legislation or rules adopted by the City. In addition, certain textual errors and omissions may temporarily exist, resulting from problems in the source database provided to American Legal and from which this website was created. Although these errors and omissions are being corrected, any user discovering any such error is invited to contact the publisher at NYC.editor@amlegal.com or 800-445-5588 and/or the NYC Law Department at NYCCodeRulesCharter@law.nyc.gov.
>
> Built by [BetaNYC](https://beta.nyc). Feedback and improvements welcome — [file a GitHub issue](https://github.com/BetaNYC/nyc-charter-laws-rules).

### One-line footer (every later response, by default)

> ⚠️ Not legal advice. Verify at https://codelibrary.amlegal.com/codes/newyorkcity/latest/overview.

---

## Repository structure

```
nyc-charter-laws-rules/
├── WHATS-CHANGED.md            ← what a reader would notice, newest first (ships in the package)
├── DATA-SOURCES.json           ← where the data comes from, for about_data (ships in the package)
├── data.json                   ← DCAT-US 3.0 catalog, generated from DATA-SOURCES.json
├── src/                        ← MCP server (TypeScript); betanyc-tools.ts is a shared copy
├── scripts/
│   ├── whats_changed.py        ← checks WHATS-CHANGED.md and DATA-SOURCES.json, writes data.json (shared copy; never edit here)
│   ├── tests/catalog_validate.py, mcp_shared/  ← CI validators for the two (shared copies)
│   ├── auto-release.js         ← automatic releases and the What's changed release gate
│   ├── fetch-data.js           ← downloads bulk XML ZIPs from AML
│   ├── build-index.js          ← thin CLI: reads ZIPs, writes JSON + Markdown indexes and the site structure
│   ├── audit-coverage.js       ← thin CLI: how much of the ZIPs' text reaches the index, and what does not
│   ├── build-site.js           ← thin CLI: builds the website into _site/ (scripts/lib/site/)
│   ├── serve-site.js           ← previews _site/ on 127.0.0.1
│   └── lib/
│       ├── extract-text.js     ← ordered-tree text-extraction helpers
│       ├── build-corpus.js     ← pure section builder (buildSectionsFromXml), unit-tested
│       ├── coverage.js         ← where every word of one XML file ends up (audit-coverage.js, its tests)
│       ├── build-structure.js  ← site structure: subdivisions, links, chapter and title names
│       ├── render-section.js   ← renderSection: a section as ordered, typed blocks
│       ├── serialize-markdown.js ← the Markdown index, written from renderSection's blocks
│       └── site/               ← the website: data model, pages, HTML writer, sitemaps, New York clock
├── site/
│   ├── template/               ← unchanged copies of BetaNYC's Pages template files
│   └── assets/                 ← the site's own CSS and scripts (jump box, search, 404)
├── data/
│   ├── raw/                    ← downloaded ZIPs (gitignored — build locally)
│   ├── index/
│   │   ├── json/               ← committed: charter.json, admin_code.json, rules.json, versions.json
│   │   └── markdown/           ← committed: charter.md, admin_code.md, rules.md
│   └── structure/              ← site structure per document (committed by the daily refresh; not in the npm package)
├── _site/                      ← the built website (gitignored; npm run build-site)
└── dist/                       ← compiled MCP server (built locally)
```

The JSON and Markdown indexes are committed to the repo. Anyone who clones it gets every section of all three documents immediately — no build step required to browse or run the server.

---

## Data source

All content is sourced from publicly available bulk XML downloads hosted by [American Legal Publishing](https://codelibrary.amlegal.com/codes/newyorkcity/latest/overview). No API key required. [DATA-SOURCES.json](DATA-SOURCES.json) describes each source (what BetaNYC changes, where to check a section, how to report an error), and the `about_data` tool answers from it.

| Document | Sections | Current Through | Bulk XML source |
|---|---|---|---|
| NYC Charter | 854 | LL 2026/094, amendments through May 17, 2026 | `http://files.amlegal.com/pdffiles/NewYorkCity/Charter/XML.zip` |
| NYC Administrative Code | 12,558 | LL 2026/094, amendments through May 17, 2026 | `http://files.amlegal.com/pdffiles/NewYorkCity/Admin/XML.zip` |
| Rules of the City of New York | 8,645 | Rules effective through May 20, 2026 | `http://files.amlegal.com/pdffiles/NewYorkCity/Rules/XML.zip` |

AML publishes updated ZIPs as new local laws and rules are adopted. Re-run `npm run fetch-data && npm run build-index` to refresh the index and commit the updated files.

### What the index holds

Each record has a `citation`, a `heading`, its `text` and American Legal's record `id`. Most records are sections and chapters. Since issue #78 the index also has a record for each part of the publisher's XML that holds text of its own outside a section:

- the Administrative Code's **Building Code Reference Standards** (Title 27, the 1968 code's appendix): `RS 3`, `RS 18-1`, `RS 13-1, Chapter 1` and the rest, about 700,000 characters;
- the Rules' **appendices and schedules**, such as the private sewer appendices (`Title 15, Chapter 23, Appendix A-1` to `A-8`), the Water Board's rate schedule (`Title 15, Chapter 42, Appendix A`, and its `…, Part I`), penalty schedules (`Title 19, Chapter 55, Schedule A` and `B`), and the Personnel Rules' `Title 55, Appendix A, Rule I`;
- the Health Code's **Board of Health resolutions**, one record, `New York City Health Code, Resolutions`, with each resolution under its own heading line (the publisher puts them in a section that has no heading of its own);
- **editor's notes and amendment lines** on a subchapter, article or part (`Title 3, Chapter 2, Subchapter 3`).

A record's citation starts with the numbered levels it sits in, as a chapter's carries its title, then the number its heading starts with: "Subchapter 3: Domestic Partnerships" in Title 3, Chapter 2 is `Title 3, Chapter 2, Subchapter 3`. The publisher numbers subchapters, articles and appendices afresh in each chapter (ten chapters of the Administrative Code have a Subchapter 3), so the number alone would name many records. A reference standard is the exception: "REFERENCE STANDARD RS 18–1" is `RS 18-1`, with a plain hyphen so it can be typed, because the code's own name for it is unique, and the parts inside one are named from it (`RS 13-1, Chapter 1`). A heading with no number goes last, whole (`Title 15, Chapter 20, Appendix`). Two records share a citation only where the publisher gives two subchapters of one chapter the same number (three pairs in the July 2026 Administrative Code, each marked "*" by the publisher); their headings tell them apart. No such record shares a citation with a section or chapter, so `get_section("Schedule A", corpus="rules")` still finds the one section cited that way. When no citation matches, `get_section` looks in headings, so a distinctive piece of one finds its record without the long citation (`Water and Wastewater Rate Schedule`, `Chapter D5`).

Each Administrative Code and Rules record also carries `titleNumber`, the number of the title it is in, as the publisher's title heading writes it (`"15"`, `"16-A"`, `"38-A"`); a chapter record also carries `titleHeading`, that title's heading (`"Title 15: Department of Environmental Protection"`) (issue #59). They come from, in order: the title around the record in its own file; its chapter's anchor name in the XML (`T15C018` is Title 15, Chapter 18); or, for a chapter with neither, the last title before it in the publisher's record order (the `number` on each record). In the July 2026 Rules that last rule places 24 chapters: the Health Code (Title 24), the Rent Guidelines Board's yearly orders (Title 30), Appendix A to Title 62 and Title 3's Chapter 11; for every other record, record order gives the same title as the first two rules (`build-index` prints how many do not, which should be 0). The Charter has no titles, and neither do the Administrative Code's local laws by year, which sit in its "Appendix A: Unconsolidated Local Laws". A Rules citation is `titleNumber`, `RCNY` and the citation: `15 RCNY § 1-01`. An index built before 0.7.0 has neither field.

Each record carries a `level`, the publisher's name for its level, except a section inside a chapter (nearly every record): `Chapter` for a chapter, `Section` for a section in no chapter (the Administrative Code's Title 31), and `Appendix`, `Part`, `Subchapter` and so on for these records. `get_title` reads it to know where a chapter ends (see [`get_title`](#get_title)). An unnumbered part with no sections inside it, such as a reference standard's `CONTENTS`, is read into the record around it, under its heading line. A record never takes text that a section inside it has. The text a publisher puts on a whole title (front matter, and a few editor's notes) is left out: the index has no title records.

When a section's own heading is empty, or its first paragraph starts with the heading and says more, the paragraph is the heading. Two records in the July 2026 files: Building Code § BC 602, whose heading is empty ("Section BC 602: Construction Classification"), and § 21-905, whose heading was only its number.

`npm run audit:coverage` checks this against the ZIPs in `data/raw/`. For each document it counts the characters in the XML, how many reach the index, and what is left out and why: a paragraph that repeats its heading, a heading of a part with no text of its own, title-level text. It then lists every piece of text the index does not have, with its file, record and where it sits. `--check` exits 1 when there is any, or when a piece of text is in two records' text. On the July 2026 files nothing is left unread: the index holds 99.99% of the Charter's text, 99.80% of the Administrative Code's and 99.78% of the Rules', once repeated headings are taken out. The rest is headings of parts with no text of their own, and title-level text.

### Site structure (`data/structure/`)

The index's `text` is flat. Its subdivisions run together, and its cross-references are plain words. `build-index` also writes `data/structure/<corpus>.json` for the website (epic #68), from the same XML in the same run. The MCP server does not read it, and it is not in the npm package.

BetaNYC builds this file from American Legal Publishing's bulk XML. The anchors, link targets and titles taken from the publisher's chapter key are worked out by BetaNYC and can be wrong. It is not an official record.

Per section, in index order:

- `parents`: the Title, Chapter, Subchapter, Article and so on that the section sits in, outermost first, each named in `groups` with its heading. A chapter file that has no Title record around it (the publisher puts a Title's record only in its first chapter's file) takes its title from the publisher's anchor name for the chapter (`T03C007` is Title 3, Chapter 7). When nothing matches, the chapter has no title rather than a guessed one; `titleStats` counts each case.
- `blocks`: the paragraphs of `text`, each a `start`/`end` slice of it. A subdivision has its `label` as printed (`a.`, `(1)`), its `depth` (the publisher's indentation) and an `anchor` built from its labels (`(b)(1)`), with `-2` added when the law repeats a label in one section. Editor's notes are `note` blocks. A subsection's heading line ("102.4 Smoking.", see `subsections` below) is a `subheading` block whose `anchor` is the subsection's number (`102.4`), and the subdivisions under it start a new list anchored under that number: item (1) of 102.4 is `102.4(1)`, whatever other subsections hold a (1). A citation for one of them puts the subsection's number in place of the section's: Section FC 102 and `102.4(1)` make "Section FC 102.4(1)" (`citeWithAnchor` in `site/assets/jump.js`, used for search titles, link names and Copy citation). A subsection whose number does not start with the section's (a few publisher's typos, and the Rules' "3.1.1" under "SECTION I") follows a comma: "Section BC 428, 4285.3.3". A subsection line with no number ("Appendix A") has no anchor, and its subdivisions are anchored at the section as before. `-2` is still added when one list repeats a label inside one subsection or section, and when the publisher gives two subsections one number (3 in the July 2026 Administrative Code).
- `links`: each cross-reference as a `start`/`end` slice of `text` and its target, one of:
  - a section: `corpus`, the publisher's `name` for the target, its `id`, and `anchor` when it points into a subdivision;
  - a Title or Chapter heading that is not a section: `corpus`, `name`, `id` and `group: true`;
  - a web address: `kind: "web"` and `url`;
  - an attached file: `kind: "file"` and `file`;
  - or, when the target is not found, `corpus` and `name` with `resolved: false`. When the publisher put the target's anchor id or name on more than one record, the link is not pointed at either: it also has `ambiguous: true`. `linkStats` counts these.
- `marks` (only when there are any): the publisher's bold and italic runs, each `[start, end, look]`, a slice of `text`, with `look` one of `"b"`, `"i"` or `"bi"`. Read from its `<CHARFORMAT bold="1">` and `<CHARFORMAT italic="1">` elements, the nearest one deciding, so nothing is guessed from wording. Display only: the index's `text` is the same with or without them, byte for byte. A paragraph whose marks would move its text in any way gets none (none in the July 2026 files).
- `rows` (on a table's block only; issue #65): the table's rows, each a list of cells, each cell `[start, end]` or `[start, end, extra]`, a slice of `text`. `extra` holds `h: 1` for a header cell, `cs` and `rs` when the cell spans more than one column or row, `al` (`"r"` or `"c"`) when the publisher right-aligns or centers it, and `br`, the offsets where a new line starts inside the cell. Read from the publisher's markup: a `<TABLE>` is the only content of its paragraph, its `<ROW>`s hold `<COL>`s (the cells), and a `<CELL>` inside a cell's first paragraph says `header="true"`, `cells-merged-right` and `cells-merged-down` (a row under a merged-down cell leaves that column out, as HTML does). A second paragraph or a `<LINEBRK/>` in a cell starts a new line. The cells cut the block's text in order, with a space or nothing between two of them (nothing where the publisher's markup runs two cells' words together, as the index does); if the marks would move the text at all, the block has no `rows`. Display only: the index's text for a table is unchanged. July 2026: 2,324 tables in 767 Rules sections and 5,089 in 982 Administrative Code sections, none in the Charter; every one gets `rows` (196,424 cells), and the structure files grow by about 14% (Rules 11.9 to 13.6 MB, Administrative Code 14.8 to 16.8 MB).
- `pictures` (only when there are any): how many `<PICTURE>` elements the section holds, figures, equations and some tables drawn as images. A picture has no text, so the index cannot show it, and a paragraph holding only a picture adds no block at all.
- `subsections` (only when there are any): how many levels inside the section the index still does not read. The Construction Codes in the Administrative Code (Title 28), and some Rules sections, keep most of a section's text in "Subsection" levels under it (`Section > Subsection > Normal Level`). Since issue #76 the index reads them, in document order: each subsection's heading line, then its body, so `text` reads "80.1 Title. This code shall be known … 80.2 Scope. …". The heading line is the publisher's HEADING when the subsection's own paragraph says the same characters (spaces aside), or only the start of them ("705.2" under "705.2 ABS plastic."), and holds no cross-reference; otherwise it is that paragraph, which keeps the words and the links (the HEADING is empty in 19 Administrative Code subsections and shorter than the paragraph in 2; 23 hold a cross-reference). If a paragraph ever says something other than its HEADING, both are kept, the HEADING first. On the July 2026 files this added text to 1,375 Administrative Code sections (1,356 had none before) and 90 Rules sections, and changed no other section's text by a byte; no level is left unread there, so the field is absent. It counts a level inside a subsection that is not its body, and any other level in a section that is not its body, a subsection or a record indexed on its own. The website says what it leaves out and links to the section at American Legal Publishing.

Known limits. Depth is the publisher's indentation. In the July 2026 build, 13 sections have labels with no indentation, and in 3 of them (Rules § 5000-02, § 5-08 and § 113-07) letters and numbers sit at one depth, so they get anchors like `(1)` and `(1)-2` instead of `(c)(1)`. History lines ("(Am. L.L. ...)") are ordinary text blocks, because the XML does not mark them.

The text is not repeated. Every offset points into `text` in `data/index/json/<corpus>.json`, and the file records that file's `sha256` (`indexSha256`, the same as `versions.json`). A structure file built from other text fails `test/structure.test.js`. `scripts/lib/render-section.js` turns a section and its entry into blocks; the Markdown index is written from them, with the body joined back into one paragraph, so its bytes do not change.

## The website (BetaNYC Law Reader)

`npm run build-site` builds a static website from the index and its structure: the BetaNYC Law Reader, at law.beta.nyc (epic #68). It builds the Charter, the Administrative Code and the Rules of the City of New York (`DEFAULT_BOOKS` in `scripts/lib/site/config.js`). The Rules need an index that names each record's title (`titleNumber`, since 0.7.0); with an older index the build leaves them out, says so on stderr and in `metadata.json` (`skipped`), and builds the other two (see [The Rules](#the-rules)). `--charter-only` builds the Charter alone, for a quick look. The build fetches nothing, and `.github/workflows/deploy-site.yml` publishes it (see [Deploy](#deploy)).

What it builds, into `_site/` (git-ignored, never committed):

- **Pages:** a home page, the Charter's contents, one page per chapter, one page per section at a path from its citation (`/charter/sections/259`), a search page, an About page and a 404 page. Two sections that share a number (§ 20-t, § 530 and § 808) each get the number plus American Legal's id (`/charter/sections/530-0-0-0-6575`), and the plain path lists both. The Administrative Code's pages are described under [The Administrative Code](#the-administrative-code) below, and the Rules' under [The Rules](#the-rules).
- **The contents tree, on every law page** (section, chapter and shared-number pages), after American Legal Publishing's code library: the heading "Contents", the book's name, and every chapter in order as an underlined link, with the reader's chapter open to its sections and the reader's own page marked (`aria-current`). Before each chapter that has sections is a disclosure button (a real button with `aria-expanded` and `aria-controls`, named "Sections in Chapter 2: Council"); only the reader's own chapter's sections are in the page, and opening another chapter loads its list from a small file, `/charter/contents/<chapter>.json`. On a wide screen (900px and wider) the tree is a column on the left that scrolls on its own to the reader's link, and a focused link never hides under its heading; "Hide" folds the column away (remembered on the next page) and "☰ Contents" brings it back. On a phone the tree sits behind "☰ Contents" above the breadcrumbs: a light-blue "you are here" bar naming the reader's chapter ("☰ Contents | Chapter 2: Council ▾", spoken "Contents, Chapter 2: Council"), so it does not look like the top bar's Menu button (Noel, 2026-11-23). Without JavaScript there are no buttons: the chapter links still work, a wide screen shows the tree, and a phone shows a closed "☰ Contents" fold, so the law text still starts near the top. The skip link jumps past the tree. It is the disclosure pattern (lists of links and buttons), not ARIA `role="tree"`.
- **On each section page:** breadcrumbs, Copy link, Copy citation and Print as small chips (a soft fill and a thin border, NYSDS's ghost button recolored), previous and next links, each subdivision indented with its own link (`#(b)(1)`), references to other sections as links, between the three books too (a book the build leaves out, such as the Rules on an index from before 0.7.0 or the other two in a `--charter-only` build, gets plain text instead; links the structure marks unresolved or ambiguous stay plain text too), and one box at the bottom of the page (Noel, 2026-11-23: one warning, at the bottom, in two paragraphs): how current the text is, then how BetaNYC changed the text, a link to the section's own page at American Legal Publishing (`https://codelibrary.amlegal.com/codes/newyorkcity/latest/NYCcharter/<id>`; a chapter page links to the chapter's), and "BetaNYC modified this text. It is not legal advice." The footer's "The text comes from American Legal Publishing, and BetaNYC modified it" sentence is only on About, the one page without the box.
- **On each chapter page:** its own text, if it has any, then a jump list of its sections. On a wide screen the page then shows every section's full text in order, each under its own heading with an "Open this section" link to the section's page and a "Copy citation" button, and a "Back to contents" link that stays at the bottom of the window while the text scrolls and returns to the jump list (focused links are kept clear of it). There the jump list and the tree's links for this chapter jump within the page (`#s-4`); a subdivision in that copy is `#s-4(b)(1)`, and references to sections of the same chapter stay on the page. On a phone the full text is hidden, the jump list's links go to each section's own page, and a link to a copy (`/charter/chapters/1#s-4(b)`) goes on to the section (`/charter/sections/4#(b)`). Search does not index the copies, so each section is found once, on its own page.
- **Notes, wherever law text appears:** the amendment history line at the end of a section (a text block wholly in parentheses that starts with how the text was made or changed, such as "(Am. L.L. 2016/019, 2/19/2016, …)") is set in smaller type below a rule; an editor's note is in a gray box with "Editor's note:" in bold. The words are unchanged.
- **At the bottom of every page but About,** in plain HTML: "American Legal Publishing's text is current through …" (the publisher's line from `versions.json`), "BetaNYC's copy last changed on …" (`indexedAt`, in New York time; the index keeps no date for when the publisher's files were last checked), then, in one paragraph (Noel, 2026-11-23), the bold "BetaNYC modified this text. It is not legal advice." (on pages that are not law pages, "the law text on this site"), how BetaNYC changed the text, where the official text is (on a law page, that record's own page at American Legal Publishing), and a link to the full disclaimer on the About page. The About page (modeled on BetaNYC's Grounding AI with NY Open Data site) says why the site exists, how the law got online (BetaNYC's 2014 testimony in support of Intro 149, which became Local Law 37 of 2014, Administrative Code § 7-111), what BetaNYC changed, how current it is, who built it, how BetaNYC uses AI, the licenses, how to report a mistake (lab@beta.nyc or a GitHub issue) and how to support BetaNYC. It has no warning at the top and no bottom box; it ends with the Disclaimer section, which opens with the same bold line and then shows the full disclaimer, read from `FOOTER` in `src/tools.ts` when the site is built, so the site and the MCP server say the same thing, and says that the paragraph starting "Official disclaimer from American Legal Publishing" is the publisher's, written for its own site. Its last line, "Built by BetaNYC...", is left out, since the page footer says it; if `FOOTER` stops ending with that line, the build stops.
- **Search:** one box, on the home page and the search page; every other page reaches it through the top bar's Search link. Its hint (`Try "§ 259", "259", or "budget office"`) is placeholder text inside the box. A citation (`§ 259`, `259`, `charter 259`, `259(a)`, `chapter 11`) goes straight to its page, from `citations.json`; a number two sections share shows both. Words are searched with [Pagefind](https://pagefind.app/), a static index the browser loads in pieces, with results by book, citation, heading and a highlighted snippet, links to the matching subdivisions, filters and paging. A Rules citation names its title: `15 RCNY § 1-01`, `15 RCNY 1-01`, `Title 15 RCNY § 1-01`, `24 RCNY Health Code § 81.08` and `Health Code § 81.08` go to their page, and a bare `§ 1-01` lists every title's. `Title 28, Chapter 1` without "RCNY" is how the Administrative Code's pages cite its chapters too, so it goes straight only to the Administrative Code; when the Rules have one too, or only the Rules do, the search page lists them to pick from. A citation that names its book looks only in that book, so every citation Copy citation gives, and the MCP's `get_section` takes, comes back to its page: `NYC Administrative Code § 27-506`, `Admin. Code § 27-506` and `NYC Charter § 1133` (never the other book's section of that number), `NYC Administrative Code Title 28, Chapter 1`, `NYC Administrative Code D302 Conversions to a multiple dwelling (MDL 9(2))`, `2 RCNY Appendix A`, `15 RCNY Chapter 19.1, Appendix`. Building and fire code sections go by code: `FC 102`, `§ FC 102`, `Section FC 102`, `fc102`, `RS 18-1`, `Reference Standard RS 18-1`; a subsection with no page of its own goes to its section's page at the subsection (`Section FC 102.4(1)`, `BC E104.2.2`, `2 RCNY § 1-01.1`). A subdivision's letters keep the case they were typed in (`§ 11-1304(d)(2)(C)`), and a page whose address names a part in another case (`#(A)` for `(a)`) goes to the part, when only one id matches. Each record's keys in `citations.json` include the one its own citation reads as (`recordKeys` in `site/assets/jump.js`), and `test/site-data/citation-round-trip.test.js` checks every record of all three books. Without JavaScript, the box is replaced by a link to the contents, and there are no filters. Beside the results, two groups of checkboxes (NYSDS's, named by their labels, all checked to start) narrow them: **Book** (Charter, Administrative Code, Rules, in the site's order) and **Kind of page** (Sections, Chapters, Local laws). They are Pagefind filters (`book` and `kind` on every law page, from `site/assets/filters.js`, which the build and `search.js` share); unchecking one keeps the choice in the address (`?q=noise&book=Charter&book=Rules`, `&kind=Section&kind=Chapter`), so a filtered search can be linked to, and Back and Forward bring back the results and the boxes together. The last checked box in a group stays checked, by keyboard or mouse (no box at all would mean no results, and the address has no way to say "none"); the status line keeps the results count and adds why, and says it again on a second try. The address keeps the book's short name (`book=Admin+Code`), as before. A search link from before the "Local laws" kind (2026-11, issue #65) that names `kind=Section` now leaves the local-law notes out: they were sections then. Each result says which book and which kind it is: Section, Chapter, Local law, or Local laws by year.
- **Data files:** each chapter's list of sections for the contents tree (`/charter/contents/<chapter>.json`), each Administrative Code and Rules title's list of chapters (`/admin-code/contents/titles/<title>.json`, `/rules/contents/titles/<title>.json`), the Rules' numbers that are in one title only (`/rules/numbers.json`, for the 404 page), `redirects.json` (American Legal ids to our paths, for every book and the title records; the 404 page uses it, so `/charter/0-0-0-1263` lands on § 259, `/NYCadmin/0-0-0-48176` on the Building Code's chapter page and `/NYCrules/<id>` on that Rules record's page), `index.json` (the contents as one tree), `metadata.json` (build time in New York time, this repo's commit, each book's index sha256), `citations.json`, a sitemap per book under `sitemap.xml`, and `robots.txt`, which welcomes search engines, AI answer engines and AI training crawlers.
- **Search engines and AI assistants:** each page's title starts with its citation (`NYC Charter § 259: Independent budget office | BetaNYC Law Reader`), with a description of at most 160 characters from the law's own words, a canonical link on `https://law.beta.nyc` (`SITE_BASE` in `scripts/lib/site/config.js`), and `Legislation` and `BreadcrumbList` structured data that uses only properties schema.org defines. The search page is `noindex`.

The frame (top bar, footer, colors, type) is BetaNYC's [Pages template](https://github.com/BetaNYC/betanyc-pages-template): `site/template/` holds unchanged copies of its `site.css`, `nav.js` and logos, and `site/template/README.md` says which commit and how to update them. The breadcrumbs, the search box, buttons, filters, paging and the back-to-top button are parts from the [New York State Design System](https://designsystem.ny.gov/) (`@nysds/components`), colored from the template's variables in `site/assets/law.css`, which names no colors itself. The site does not use NYSDS's global header or footer, or the parts NYSDS reserves for official State sites. The contents tree is the site's own (plain HTML lists and buttons, in `site/assets/law.js` and `law.css`). The section text, the contents tree and the bottom box are plain HTML, and the law text uses the template's body font, so they read with JavaScript off, in a screen reader and in print. License notices for NYSDS (CC0, with Material Icons under Apache 2.0 and Lit under BSD 3-Clause) and Pagefind (MIT) ship with the site in `licenses/`; DOMPurify's notice, which NYSDS includes, is in `assets/nysds/nysds.js`.

The site's layout follows the DC Council's code site, code.dccouncil.gov. No DC code is used.

AI agents use the page too. Every control has a name, and no two share one; `npm run test:site` checks that in the browser's accessibility tree. The site does not offer WebMCP tools yet: those come in Phase 4a (#70). AI assistants that want the law directly should use this repo's MCP server.

Build and look at it locally:

```bash
npm run build-index          # writes data/structure/ (or use the copy the daily refresh commits)
npm run build-site           # writes _site/; --no-search skips the Pagefind index, --charter-only the Administrative Code
npm run serve-site           # http://127.0.0.1:8080/, served the way GitHub Pages serves it
```

`serve-site` takes `--dir` and `--port` (`npm run serve-site -- --dir _site-other --port 8081`).

`build-site` takes `--index-dir`, `--structure-dir` and `--out` to build from other copies of the data. It stops with a message if `data/structure/` is missing or was built from other text than the index, or if `versions.json` disagrees with the index's count. It only ever clears a folder it made itself.

Measured on 2026-11-23 on a Mac (Apple silicon) with Node 26, from the committed index (both books current through Local Law 2026/165), with `npm run build-site` (Pagefind included), counting every file's bytes in the output folder, in decimal megabytes (1 MB = 1,000,000 bytes):

| | Pages | Files | On disk | HTML (gzipped) | Pagefind |
|---|---|---|---|---|---|
| Charter alone (`--charter-only`) | 864 | 1,862 | 24.9 MB | 21.0 MB (5.4 MB) | 2.4 MB |
| Charter and Administrative Code | 13,789 | 27,738 | 386.8 MB | 353.9 MB (83.5 MB) | 26.1 MB |

The Administrative Code adds 361.9 MB: 12,925 pages (1 front page, 39 title pages, 389 chapter pages, 177 part pages, 12,266 section pages and 53 shared-number pages), 332.7 MB of HTML (78.1 MB gzipped), about 23.7 MB of Pagefind index, and 4.3 MB more in `citations.json`, `index.json` and `redirects.json`. Its median page is 21.7 KB; its biggest is § 28-1001.2.1 at 331 KB, one long section, and its biggest part page 318 KB. The Charter's pages grow by 0.2 MB in the full build, because its references into the Administrative Code become links. The build took about 9.5 seconds (pages 3.4 s, Pagefind 5.8 s), and its peak resident memory was 2.2 GB (2,157 MB), most of it Pagefind's. A section page averages about 21 KB. The biggest Charter chapter page, Chapter 1 (50 sections), is 450 KB, 83 KB gzipped: a phone downloads all of it even though it shows only the jump list.

GitHub Pages allows a published site of 1 GB and a deployment of 10 minutes ([GitHub Pages limits](https://docs.github.com/en/pages/getting-started-with-github-pages/github-pages-limits)). The two books use 39% of the size.

All three books, measured on 2026-11-24 on the same Mac from a build of American Legal Publishing's July 2026 files (the committed index has no titles yet, so it builds no Rules), with `npm run build-site` and the same counting: 23,894 pages, 47,111 files, 718.3 MB on disk, of which the Pagefind index is 54.2 MB (23,020 files). The Rules add 9,784 pages (1 front page, 54 title pages, 758 chapter pages, 110 part pages, 7,963 section pages, 55 pages for a citation a title repeats and 843 for a number in several titles) and 269.3 MB in `rules/`. The build took 18.3 seconds (pages 6.8 s, Pagefind 11.5 s), and its peak resident memory was 4.1 GB. That is 72% of the 1 GB limit. The time to deploy that many files has not been measured. Before the titles-first menu, every page listed every chapter, which projected to about 900 MB for the Administrative Code alone.

All three books from the committed index (current through Local Law 2026/165 and rules effective November 14, 2026, with titles), measured on 2026-11-25 on the same Mac with `npm run build-site` and the same counting: 24,036 pages, 47,392 files, 723.8 MB (`du` says 822.6 MB, since most files are smaller than a disk block), of which the Pagefind index is 54.5 MB in 23,159 files. By folder: `admin-code/` 13,359 files, `rules/` 9,907, `pagefind/` 23,159, `charter/` 938. The largest files are `citations.json` (3.8 MB), `index.json` (3.3 MB), `redirects.json` (1.1 MB), `nysds.js` (1.0 MB) and the Administrative Code's sitemap (1.0 MB). 17 seconds, 3.9 GB peak memory. Tables (#65) add 8.9 MB to the July 2026 build (718.8 to 727.8 MB, +1.2%), almost all of it markup; compressed, 0.8 MB.

GitHub's limits ([GitHub Pages limits](https://docs.github.com/en/pages/getting-started-with-github-pages/github-pages-limits), read 2026-11-25), against that build:

| Limit, in GitHub's words | This site | Margin |
|---|---|---|
| "Published GitHub Pages sites may be no larger than 1 GB." | 723.8 MB (733 MB once the structure carries tables) | about 270 MB; the page does not say whether it counts compressed bytes or disk blocks (822.6 MB by `du`) |
| "GitHub Pages deployments will timeout if they take longer than 10 minutes." | the last deploy's Deploy step took 15 seconds (run 45547295846, 2026-11-25); the whole build job about 4 minutes | about 9 minutes 45 seconds |
| "a *soft* bandwidth limit of 100 GB per month" | one full crawl of every file is 724 MB uncompressed | about 138 full crawls a month, fewer if crawlers ignore compression |
| "a *soft* limit of 10 builds per hour", which "does not apply if you build and publish your site with a custom GitHub Actions workflow" | a custom workflow | not limited |
| The artifact is "a compressed `gzip` archive containing a single `tar` file", and "The `tar` file must be under 10GB in size" ([Using custom workflows with GitHub Pages](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages)) | tar 857.9 MB, 145.0 MB gzipped; GitHub stored the last deploy's artifact as 138.4 MB (`gh api repos/BetaNYC/nyc-charter-laws-rules/actions/artifacts`) | about 9.1 GB |

What grows it: law text (each section is on its own page and again in its chapter's or part's copy), new sections and their Pagefind entries, the menu on every law page, and the site-wide `citations.json`, `index.json` and `redirects.json`. The 1 GB published size is the limit to watch.

### The Administrative Code

- **Titles.** A chapter's title comes from the publisher's own Title record in `data/structure/admin_code.json` (38 of them, with their names). `get_title`'s rule in `src/corpus.ts` (the title most of a chapter's § sections are numbered in) is the check: the build stops when the two disagree, except that a lettered title may be numbered in its parent (§ 16-501 is in Title 16-A), since that rule alone cannot tell Title 16 from 16-A, 16-B, 20-A or 21-A. `test/site-admin.test.js` runs both on the committed index. The 16 sections of Title 31 (§ 31-101 to § 31-116) sit in no chapter: Title 31's page shows them as a chapter page would.
- **Local laws by year.** 42 of the publisher's chapters are years ("2016", holding "L.L. 2016/002" and the rest), with no title and no § numbers. The site groups them under "Local laws by year", a name of BetaNYC's: its page says that American Legal Publishing files these local laws by year, outside the titles, and that the group's name is ours. It is the last title card and the last item in the menu, with no number.
- **Local laws in search.** The local-law notes (1,884 in the November 2026 index, cited `L.L. 2016/002`: enactment date, sponsors, the law's title and its unconsolidated provisions) are their own kind of search result, "Local law", and each year's page is "Local laws by year"; the "Local laws" box leaves them all out. At full weight, notes crowded the sections their laws wrote out of the first results, but a note is also the right answer when someone searches for a law's subject. So each paragraph of a note carries a `data-pagefind-weight` (Pagefind's weights work on a quadratic scale): the law's title paragraph ("A Local Law to amend ..., in relation to ...") 1.5 (`LOCAL_LAW_TITLE_WEIGHT` in `scripts/lib/site/pages.js`), the rest (sponsors, dates, the unconsolidated provisions) 0.1 (`LOCAL_LAW_WEIGHT`); the heading keeps Pagefind's own weight. Two measures, with the queries in `test/fixtures/search-ranking/queries.json` and run by `test/site/search-ranking.test.mjs` on the committed November 2026 data: notes in the first 10 results of 20 subject searches (lower is better) and, of 40 notes each searched by its own subject, how many are in the first 10 (higher is better). Every note at full weight: 24 and 21. A whole note at 0.25: 12 and 15. Title 1.5, rest 0.1: 13 and 21. The site tells a note by where `model.js` puts it (`isLocalLaw`: the "Local laws by year" group), and `test/site-data/search-kinds.test.js` checks that against the index's untitled `L.L.` records.
- **Front page** (`/admin-code/`): one card per title and nothing else, as an ordered list of links: the title's number (a screen reader hears "Title 3"), its name, and how many chapters it has. The lede counts the titles, chapters and sections from the data. One column on a phone; on a wider screen as many columns of at least 300px as fit.
- **Title pages** (`/admin-code/titles/28`): the title's chapters, with how many sections each has and how many parts a split chapter has. With JavaScript off, they are how the menu reaches a chapter.
- **The menu** (the contents tree) lists only the titles. The reader's title is open in the HTML with its chapters, the reader's chapter open to its sections, or, in a split chapter, to its parts, with the reader's part open. `law.js` puts a button before each title, named "Chapters in Title 28: New York City Construction Codes" (Title 31: "Sections in …"), with `aria-expanded` and `aria-controls`, that loads the title's chapters from `/admin-code/contents/titles/<title>.json`. While a list loads, "Loading…" is in the menu's one `role="status"` line; if it fails, that line says so, the title stays closed, and pressing again tries again. Focus stays on the button. The button's name is not the title's own, because the title's link next to it has that name.
- **Chapter parts.** A chapter whose full text would pass 100 sections or 150,000 characters of law text (about 300 KB of HTML, a third less than the biggest Charter chapter page) is split, in order, into parts of at most that size; one section bigger than that gets a part to itself. 54 chapters split, into 177 parts; the Building Code (949 sections) into 11. The chapter's own page then shows its own text and the list of its parts. Each part is a page of its own (`/admin-code/titles/27/chapters/1/parts/2`) with the heading "… Building Code, part 2 of 11", the list of parts with its own marked, its sections' jump list and full text, and previous and next part links. Nothing loads as you scroll.
- **Text outside sections.** The records for text held outside a section (see [What the index holds](#what-the-index-holds)), such as the Title 27 reference standards, are pages like any section's, in their chapter's list and its parts, in document order: `/admin-code/sections/rs-18-1`, `/admin-code/sections/title-3-chapter-2-subchapter-3`. Their names leave out the number already in the citation: "RS 10-9. PLYWOOD CONSTRUCTION", "Title 3, Chapter 2, Subchapter 3. Domestic Partnerships", and "RS 18-1" alone when the heading says nothing more.
- **Section paths** follow the Charter's: `/admin-code/sections/28-101.1`. Citations that are not "§ number" are lowercased with other characters made hyphens (`L.L. 2016/002` is `ll-2016-002`, `Section FC 101` is `fc-101`). The 53 numbers two sections share get the Charter's treatment. A chapter is under its title, because each title has its own Chapter 1: `/admin-code/titles/28/chapters/1`.
- **Subsections.** The Construction Codes' subsections (issue #76; see `subsections` under [Site structure](#site-structure-datastructure)) show in the section's text, each heading line as a real heading: an `<h2 class="subhead">` under the section page's `<h1>`, an `<h3>` under the section's `<h2>` in a chapter, part or title page's copy. So a screen reader's list of headings goes section, then its subsections, with no level skipped. Each numbered subheading's id is its number (`/admin-code/sections/fc-102#102.4`), and a link to a subsection goes there. In a chapter page's copy the ids keep the section's prefix with `_` before a subsection's number (`#s-fc-102_102.4(1)`), so a phone opening that link goes on to `/admin-code/sections/fc-102#102.4(1)`.
- **Bold and italic.** The publisher's bold and italic (`marks` in the structure) are `<strong>` and `<em>`: bold defined terms ("Related member."), bold lead-ins ("Modifications.—"), italic catchlines and notes. In a subheading only the italics show, since it is bold already. A paragraph wholly in bold, at most 100 characters, with text after it that is not wholly bold, and not a note ("NOTE:", "Exceptions:"), reads as a heading line ("Introduction–Section 3—Definitions:" in RS 18-1): it gets the subheading's look, the space and thin rule, but stays a paragraph, not a heading element. The XML does not mark these lines as levels, and in the July 2026 files they are also table captions, defined terms and lines said twice in one section, so a heading element would fill a screen reader's list of headings with guesses. A run of bold lines ("382.10 DELETED.", "382.15 DELETED.") stays plain bold. In July 2026, 4,797 Administrative Code paragraphs and 647 Rules paragraphs are wholly bold (none in the Charter); 17,534 and 6,825 open in bold; italics are in 278 Charter, 7,715 Administrative Code and 20,957 Rules paragraphs.
- **Tables** (issue #65; the Rules have them too). A table whose block carries `rows` is a real HTML `<table>`, wrapped in the New York State Design System's `nys-table` (1.23.2, the same `nysds.js` as the site's other NYSDS parts), inside the template's `.table-scroll` box. Header rows at the top are a `<thead>`, every header cell in it `scope="col"`, spanning ones too: under the HTML table model a column header covers each column it spans, while `scope="colgroup"` would apply only inside a `<colgroup>`, which these tables do not have. A header cell further down is a `<th>`; spans, right-aligned and centered cells, and line breaks inside a cell are the publisher's. The page always writes both `<thead>` and `<tbody>`, because `nys-table` rebuilds a table that lacks either and would move the first row holding a header cell to the top. The box scrolls a wide table sideways inside itself, never the page. While it does, `law.js` (`wireTables`, again on every resize) makes it a region named for its section ("Table, 1 RCNY § 101-06", or "Table 2 of 3, …" when a section has more than one; the name is in `data-table-name`, unique on the page, chapter copies included) and a tab stop, so the arrow keys scroll it. A box whose table fits is neither: a page can hold hundreds of small tables (323 on one Administrative Code part page), and most fit on a wide screen. With JavaScript off it is the same plain table with the same borders; the box then has no name and no tab stop of its own, and the keyboard reaches a box that scrolls only where the browser does that itself (Chromium does, checked in `test/site/tables.test.mjs`). In print a table is the page's width, in 8-point type with tight cells, its words kept whole; a table of 8 columns or more (`data-many-columns`, `PRINT_DENSE_COLUMNS` in `render-html.js`) may break a word anywhere, which is what lets the 29-column tables fit the paper. Printed at 720px with words kept whole, 84 of the July build's 14,821 table boxes ran past the page, all of 8 columns or more; with the rule, none does. A box that stops scrolling while it has the focus (the window widened) keeps its tab stop and name until the focus leaves it. A structure from before #65, with no `rows`, shows each table as one paragraph of its words, as before. With its tags removed, a table's HTML is the index's text for it (the block-order test reads it back). The committed structure was built before #65; the daily refresh rebuilds it with `rows` once this code is on `main` (a structure-only commit, no release) and dispatches the deploy.
- **What the copy leaves out.** The index has no pictures (figures, equations and tables drawn as images: 306 in 66 Administrative Code records in the July 2026 files). A section with pictures, or with a level the index still does not read (none in the July 2026 files), says so above its text ("This section has 3 pictures … that BetaNYC's copy does not show") and links to its page at American Legal Publishing; a section with no text says "BetaNYC's copy has no text for this section" with the same link. The counts come from the structure's `pictures` and `subsections` fields.

### The Rules

The Rules of the City of New York are laid out as the Administrative Code is, titles first (title cards, a page per title, chapters split into parts, a page per section, the same menu), with one difference: each title restarts its chapter and section numbers (50 titles have a § 1-01 in the July 2026 files), so everything is per title, from each record's `titleNumber` (issue #59). The title is the record's own, not the structure's Title parent: 24 chapters have none (the Health Code in Title 24, the Rent Guidelines Board's yearly orders in Title 30, Appendix A to Title 62, Title 3's Chapter 11).

- **Paths** are under the title: `/rules/titles/15` for a title, `/rules/titles/15/chapters/18` for a chapter (other chapter citations are lowercased with hyphens: `/rules/titles/24/chapters/new-york-city-health-code`, `/rules/titles/30/chapters/apartment-loft-order-49-2017`), `/rules/titles/24/chapters/new-york-city-health-code/parts/5` for a part, and `/rules/titles/15/sections/1-01` for a section. A group record keeps its chapter in its path (`/rules/titles/19/sections/chapter-55-schedule-a`). Chapters sort as the publisher numbers them: 19, 19A, 19.1, 20 (`adminChapterKey`, shared with the Administrative Code). Where a title repeats a citation (each yearly order's `Notice`, Title 62's two § 6-01), each record gets American Legal's id after it (`/rules/titles/30/sections/notice-<id>`) and the plain path is a page to pick one. A chapter number a title uses twice (Title 43's two Chapter 15s; the Administrative Code's five starred pairs get the same) works the same way: each chapter gets its id (`/rules/titles/43/chapters/15-<id>`) and `/rules/titles/43/chapters/15` is a page to pick one. The plain path never goes away: if a later refresh gives a number to a second chapter, the old link reaches a page listing both, and an id path whose pair goes away lands on the chapter through the 404 page (its id is in `redirects.json`). Keeping the plain path for "the first one" was not chosen: which one is first depends on the sort, and a reader who cites Chapter 15 cannot know which they would get. A number in more than one title has a page to pick one at `/rules/sections/1-01`, grouped by title; a number in one title only has no page there, and the 404 page sends `/rules/sections/<number>` on to it, from `/rules/numbers.json`.
- **Citations** are `fullCitation`'s (`src/corpus.ts`), written the way the Rules are cited: `15 RCNY § 1-01`, `24 RCNY Health Code § 81.08`, `15 RCNY Chapter 18`, and, where a title repeats a citation, with its chapter: `30 RCNY Apartment & Loft Order #49 (2017), Notice`, `62 RCNY Chapter 5, § 6-01`. A group record whose own citation already starts with its title keeps it (`Title 6, Chapter 2, Subchapter B`), because that is the form `get_section` finds. The heading, Copy citation, the page title, the search result's title and links into the Rules all use it; never a bare `§ 1-01`. `test/site-data/rules-layout.test.js` checks that `get_section` finds the same records with each page's citation as with `fullCitation`.
- **Lists** inside a title name records as the title does (`§ 1-01. Scope and Application`); a group record drops the title and chapter already around it (`Schedule A`, `Title III, Article 48` in the Health Code).
- **Phones.** Fill-in blanks in the Rules' forms ("________" for a whole line) and long breadcrumbs break at the screen's edge (`overflow-wrap: anywhere` on the law text and headings; NYSDS's breadcrumbs set nowrap, which law.css undoes). `test/site/overflow.test.mjs` opens, at 390px, every page with a run of 30 characters or more with no space, or a breadcrumb that long, and fails on any that scrolls sideways (732 pages on the July 2026 build, none). It also opens every page that shows a table, at 390px and 320px (2,137 pages with 14,821 table boxes on the July 2026 build with `rows`: none scrolls sideways, and at 320px 1,314 tables scroll inside their own box).
- **The bottom box** of a Rules page links the record's own page at American Legal Publishing and adds that the City posts the latest rules at rules.cityofnewyork.us (as the MCP server's disclaimer does).
- **Links** from the Charter and the Administrative Code into the Rules, and from the Rules out, go to the record's page. A link to one of the publisher's groups that is not a record (a Health Code Article) goes to its first section.
- **Before 0.7.0.** An index without `titleNumber` builds no Rules pages at all, rather than pages whose paths would change once titles arrive; the deploy's check step notes it and the home page still says the Rules are coming. An index with titles on some records only stops the build.

### Deploy

`.github/workflows/deploy-site.yml` builds the site, the Charter, the Administrative Code and the Rules, and publishes it to GitHub Pages at law.beta.nyc. It runs:

- on a push to `main` that changes the site's code or what it reads: `data/index/`, `data/structure/`, `scripts/build-site.js`, `scripts/lib/site/`, `scripts/lib/render-section.js`, `site/`, `src/tools.ts` (the disclaimer), `DATA-SOURCES.json`, `package.json`, the lockfile, or the workflow itself;
- after the daily refresh, only when it committed new law text or a new site structure. The refresh pushes with the built-in `GITHUB_TOKEN`, and GitHub does not start other workflows from that push, so its last step starts this one with `gh workflow run` ([GitHub's docs](https://docs.github.com/en/actions/concepts/security/github_token)). No commit, no deploy;
- by hand: the Actions tab, **Deploy Site**, **Run workflow** on `main`, or `gh workflow run deploy-site.yml --ref main`.

Each run installs with `npm ci`, runs `npm test`, then `npm run test:site-data` (the site's layout on the committed data; see below), and builds the whole site fresh with `npm run build-site`. The build stops the run, before anything is deployed, if `data/structure/` is missing or was built from other text than the index. Nothing is committed: the HTML goes from `_site/` straight to Pages with GitHub's own actions (`configure-pages`, `upload-pages-artifact`, `deploy-pages`). Only `main` deploys, one run at a time. The build step also checks that the contents pages, the Administrative Code's sitemap and the Pagefind index are there, and, when `metadata.json` says the build has the Rules, their contents page, `numbers.json` and sitemap; when it does not, the step adds a notice saying why. On a Mac the build of all three books peaked at 4.1 GB of resident memory, most of it Pagefind's; nobody has measured it on GitHub's runner, so a red build step with no error message is worth checking for running out of memory. After the deploy, the run checks that the home page, `/about`, `/admin-code/` and, when the build has them, `/rules/` answer 200; if they do not, the run goes red, but the deployment stays up. The custom domain is set in the repository's Pages settings, so the site needs no `CNAME` file.

---

## Prerequisites

- Node.js 20 or later (tested on 20.x and 22.x)

---

## Installation

### npx (recommended — no install required)

```bash
npx @betanyc/nyc-charter-laws-rules
```

The corpus data is bundled in the package — no setup required.

### Global install

```bash
npm install -g @betanyc/nyc-charter-laws-rules
nyc-charter-laws-rules
```

### From source (for development or refreshing the index)

```bash
git clone https://github.com/BetaNYC/nyc-charter-laws-rules.git
cd nyc-charter-laws-rules
npm install
```

---

## Claude Desktop configuration

Add to your `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "nyc-charter-laws-rules": {
      "command": "npx",
      "args": ["-y", "@betanyc/nyc-charter-laws-rules"]
    }
  }
}
```

Or if installed globally:

```json
{
  "mcpServers": {
    "nyc-charter-laws-rules": {
      "command": "nyc-charter-laws-rules"
    }
  }
}
```

---

## Setup

**The index is already committed — no data download needed to run the server.**

**Step 1 — Build and start the server (from source only):**

```bash
npm run build
npm start
```

That's it. The committed JSON index is loaded automatically.

### Refreshing the index from AML

Run this when AML publishes a new version of the Charter, Admin Code, or Rules:

```bash
npm run fetch-data    # downloads ~50MB of bulk XML ZIPs into data/raw/
npm run build-index   # parses XML, writes data/index/json/, data/index/markdown/ and data/structure/
```

`fetch-data` sends a User-Agent naming this package and version, gives each download 120 seconds (they are several megabytes each), and retries a 429 or 5xx answer up to twice, honoring Retry-After (`scripts/lib/fetch-retry.js`). If any of the three downloads fails, it stops with an error, so no index is built with a document missing.

Then commit the updated index files and push. The `get_version` tool will reflect the new currency dates after the next server restart.

#### Placing ZIP files manually

If you prefer to download the ZIPs yourself rather than using `npm run fetch-data`, place them in `data/raw/` with these exact filenames before running `npm run build-index`:

```
data/raw/charter.zip       ← http://files.amlegal.com/pdffiles/NewYorkCity/Charter/XML.zip
data/raw/admin_code.zip    ← http://files.amlegal.com/pdffiles/NewYorkCity/Admin/XML.zip
data/raw/rules.zip         ← http://files.amlegal.com/pdffiles/NewYorkCity/Rules/XML.zip
```

The `data/raw/` directory is gitignored — the ZIPs will not be committed.

---

## Configuration

### Claude Code

Add to your project's `.mcp.json` or `.claude/settings.json`:

```json
{
  "mcpServers": {
    "nyc-charter-laws-rules": {
      "command": "npx",
      "args": ["-y", "@betanyc/nyc-charter-laws-rules"]
    }
  }
}
```

Or if running from a local clone:

```json
{
  "mcpServers": {
    "nyc-charter-laws-rules": {
      "command": "node",
      "args": ["/path/to/nyc-charter-laws-rules/dist/index.js"]
    }
  }
}
```

### Getting current law text (`NYC_LAWS_INDEX_DIR`)

The `Refresh Data` workflow commits a refreshed index to `main` every morning when AML has published new text. To serve that text while running the pinned npm package, keep a sparse clone of just the index and point the server at it:

```bash
git clone --filter=blob:none --sparse https://github.com/BetaNYC/nyc-charter-laws-rules.git
cd nyc-charter-laws-rules
git sparse-checkout set data/index/json
# later, to update:
git pull
```

```json
{
  "mcpServers": {
    "nyc-charter-laws-rules": {
      "command": "npx",
      "args": ["-y", "@betanyc/nyc-charter-laws-rules"],
      "env": {
        "NYC_LAWS_INDEX_DIR": "/path/to/nyc-charter-laws-rules/data/index/json"
      }
    }
  }
}
```

- The directory must hold `versions.json`, `charter.json`, `admin_code.json`, and `rules.json`, laid out like `data/index/json/`. A leading `~/` expands to your home directory. Any other relative path resolves against the server process's working directory, which your MCP client chooses, so an absolute path is safest.
- If the variable is set and `versions.json` is not there, the server refuses to start and says why. It never falls back to the bundled index silently. Unset or blank means the bundled index.
- The server notes the directory it is serving on stderr at startup. Restart it after a `git pull`; the index is read once per process.
- `get_version` reports the currency dates of whichever index is loaded.

### Disclaimer footer (`NYC_CLR_FOOTER`)

Every tool response ends with a disclaimer. `NYC_CLR_FOOTER` sets how much of it:

| Value | Behavior |
|---|---|
| `full-then-compact` (default) | The full footer on the first response after the server starts, then the one-line footer on every response after. |
| `full` | The full footer on every response, as through 0.3.x. |

- "First response" means the first since this server process started. MCP does not tell a server when a new chat begins, so a client that keeps the server running across chats sends the full footer only once. The full text also goes out as the server's `instructions` on every connection, in both modes.
- Unset or blank means the default. Any other value means `full` (more disclaimer, never less), and the server prints a warning naming the variable to stderr at startup.

```json
"env": { "NYC_CLR_FOOTER": "full" }
```

---

## Common workflows

### Look up a specific section of the Charter

```
1. get_version()                          → confirm how current the law is
2. get_section("§ 259")                   → retrieve the section text
```

### Find everything the Admin Code says about a topic

```
1. search("sidewalk shed", corpus="admin_code", limit=20)
2. get_section("§ 28-3310.1")            → pull a specific result
```

### Browse the Rules on a subject area

```
1. list_titles("rules")                   → find the agency's title and the chapter by its heading
2. get_title("rules", "Title 15, Chapter 18") → its sections
3. search("fire safety", corpus="rules")  → keyword search within rules
4. get_section("15 RCNY § 18-11")         → one section, cited with its title
```

### Ground a legal answer in the correct version

```
1. get_version()                          → note the effective date for each corpus
2. search("open meetings", corpus="all")  → find relevant sections
3. get_section("§ 1-207")                → retrieve full text
```

---

## Changelog

The complete, dated record of **every index rebuild** lives in **[CHANGELOG.md](CHANGELOG.md)**. Each entry records which corpus version was current at the time of the build and flags whenever a corpus's `currentThrough` version advanced.

The block below is stamped automatically with the most recent rebuild every time `npm run update-changelog` runs — see [CHANGELOG.md](CHANGELOG.md) for the full history.

<!-- LATEST_INDEX_UPDATE:START -->
**Last index update:** 2026-11-24 — ✓ No change

| Corpus | Current through | Sections |
|---|---|---|
| NYC Charter | Current through Local Law 2026/165, enacted November 19, 2026, | 856 |
| NYC Administrative Code | Current through Local Law 2026/165, enacted November 19, 2026, | 12,991 |
| Rules of the City of New York | Current through rules effective November 14, 2026. | 8,786 |
<!-- LATEST_INDEX_UPDATE:END -->

### Release history

Package version history (distinct from the per-rebuild record in CHANGELOG.md):

- **0.1.2 — May 25, 2026:** Charter and Admin Code current through **LL 2026/094** (enacted May 16, 2026), up from LL 2026/086; Rules through **May 20, 2026**, up from May 15; Admin Code 12,551 → 12,558 sections.
- **0.1.1:** Initial published release with full JSON and Markdown indexes committed to repo.
- **0.1.0:** Initial release.

## About BetaNYC

This project is built and maintained by [BetaNYC](https://beta.nyc), New York's
civic technology and open-data community. We work to improve lives in New York
through civic design, technology, data, and public-interest technology.

**Come do civic tech with us.** We run public events, meetups, and hands-on
data classes throughout the year — including [NYC School of Data](https://www.schoolofdata.nyc/)
and [CityCamp NYC](https://citycamp.nyc), and we host frequent civic-tech gatherings. See what's coming up on our
[events calendar](https://www.beta.nyc/events/).

**Sustain this work.** These MCP servers are free and open source. To help keep this work going and find BetaNYC's
tools, please consider [donating and becoming a Beta
Builder](https://beta.nyc/donate).

## Building on this? Tell us!

If you build something with this project, we'd love to hear about it. We can help other New Yorkers find it. BetaNYC publishes a weekly newsletter,
*This Week in NYC's Civic Technology and Open Data*.

- **[Subscribe to the newsletter](https://beta.nyc/newsletter)** to keep up with
  NYC civic tech, open data, and public-interest technology.
- **Built something, or found a story worth sharing?** [Submit a link for the
  newsletter](https://www.beta.nyc/newsletter-inbox/) and we'll consider it for
  an upcoming issue.

## Related BetaNYC MCP servers

BetaNYC maintains a suite of open-source MCP servers for NYC and NYS civic data.
See the full directory, with install details for each, at
**[beta.nyc/ai-tools](https://beta.nyc/ai-tools)**.

This server pairs directly with:

- **[nyc-council-mcp](https://github.com/BetaNYC/nyc-council-mcp)**: see the Council legislation, sponsors, votes, and hearings that create and amend the Code.

---

## Contributing

Issues and pull requests welcome at [github.com/BetaNYC/nyc-charter-laws-rules](https://github.com/BetaNYC/nyc-charter-laws-rules).

---

## Support our work

Freedom isn't free. [Support BetaNYC](https://beta.nyc/donate/).

## License

MIT License

Copyright (c) 2026 BetaNYC

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
