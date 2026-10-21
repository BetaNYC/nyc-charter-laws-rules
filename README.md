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

Clone the repo and everything is ready to use. No setup required to browse or query the current index. Run `npm run fetch-data && npm run build-index` only when you want to refresh from AML.

Vibe coded with [Claude](https://claude.ai) by [BetaNYC](https://beta.nyc).

---

## API key

**No API key is required.** The Charter, Administrative Code, and Rules are served from an offline corpus bundled with the package, so this server works out of the box — no signup, no token, no environment variables to set.

**The bundled text is as of the release.** An npm install carries the law text from the day that version was published. When the daily refresh picks up new law text, it also publishes a new patch release automatically (see [Releases](#releases)), so the law text in `npx -y @betanyc/nyc-charter-laws-rules` is normally at most a day behind `main`'s. Code changes ship with the next release. Automatic releases pause while a hand-bumped version is waiting to be published or a release run has failed. `get_version` reports the dates you are actually serving. To serve `main`'s index directly, see [Getting current law text](#getting-current-law-text-nyc_laws_index_dir).

---

## What it does

Exposes 5 tools over MCP:

| Tool | Description |
|---|---|
| `search` | Search across all three documents by keyword or phrase |
| `get_section` | Retrieve a specific section by citation (e.g. `§ 259`, `Chapter 11`) |
| `list_titles` | List the top-level chapters or titles of a document |
| `get_title` | Retrieve all sections within a chapter or title |
| `get_version` | Return the currency date for each document — so responses can be grounded in exactly how current the law is |

---

## Tools reference

### `search`

Search across the NYC Charter, Administrative Code, and Rules by keyword or phrase. Results are relevance-ranked: heading matches rank above citation matches, which rank above body-text matches, and whole-word matches rank above substring matches.

| Parameter | Type | Required | Default | Description |
|---|---|---|---|---|
| `query` | string | yes | — | Search term or phrase |
| `corpus` | string | no | `all` | `charter`, `admin_code`, `rules`, or `all` |
| `limit` | number | no | 10 | Max results (max 50) |

```
search("open data")
search("landlord inspection", corpus="admin_code", limit=20)
search("board of health", corpus="rules")
```

---

### `get_section`

Retrieve a specific section by citation or heading fragment. Input is normalized (with or without `§`, any case, extra whitespace). If the same citation exists in more than one document (e.g. charter `Chapter 3` vs a rules chapter, or a rules section number repeated across titles), a disambiguation list is returned — re-run with the `corpus` parameter.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `citation` | string | yes | Section citation or heading (e.g. `§ 259`, `Section 20-f`, `11-602.1`, `Chapter 11`) |
| `corpus` | string | no | `charter`, `admin_code`, or `rules` (default: all three) |

```
get_section("§ 259")
get_section("11-602.1")
get_section("Chapter 11", corpus="charter")
```

---

### `list_titles`

List the top-level chapters or titles of a document.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `corpus` | string | yes | `charter`, `admin_code`, or `rules` |

```
list_titles("charter")
list_titles("rules")
```

---

### `get_title`

Retrieve chapter/title records matching an identifier. Matching is whole-token (`Chapter 1` does not match `Chapter 10`). Note: the index is flat — deep hierarchy (every section nested within a title) is not indexed, so this returns matching chapter/title-level records, not full title contents. Title-level indexing is a tracked future feature.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `corpus` | string | yes | `charter`, `admin_code`, or `rules` |
| `title` | string | yes | Chapter or title identifier (e.g. `Chapter 11`) |

```
get_title("charter", "Chapter 11")
get_title("admin_code", "Title 6")
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

## Testing and CI

### Running tests

```bash
npm test
```

`npm test` builds the TypeScript source first (`pretest` script), then runs the full suite with `node --test`. All three test layers run together; the suite completes in under 2 seconds on a laptop.

### Test layers

| File | What it covers |
|---|---|
| `test/extract-text.test.js` | Unit tests for the `extractText`, `normalize`, `childrenByTag`, `getAttr`, and `tagOf` helpers in `scripts/lib/extract-text.js`. Covers inline-LINK document order (issue #3 regression), entity decoding, ALP-marker stripping, enumeration-marker repair, empty/self-closing elements, deep nesting, whitespace-only text nodes, and helper edge cases. |
| `test/content-leak.test.js` | Regression tests for the content-leak fix (PR-A0): undecoded `&#160;` nbsp entities, `[ALP S-xxx]` editorial markers, and leading-digit run-ons (`1Each`). Includes scope guards confirming that inline labels with no `<TAB/>` after them in the source (`(6)the`) are left untouched. |
| `test/corpus-invariants.test.js` | Invariant assertions over the committed `data/index/json/*.json` (all 22,079 sections across charter, admin\_code, and rules). Asserts: no run-together text, no subdivision label fused to the next word (`a.There`, issue #27), no leaked XML tags, no undecoded entities, no double spaces, no leading/trailing whitespace, and structural integrity against `versions.json` counts. Collects all violations before asserting, with corpus/id/citation/snippet in the failure message. |
| `test/mcp-tools.test.js` | In-process tests for the MCP handler functions (`searchCorpus`, `getSection`, `listTitles`, `getTitle`, `getVersions`) imported from `dist/corpus.js`. Grounded in real index data: verifies § 292 text content (the issue-#3 corrected phrase), negative lookups, version presence, and title listing. |
| `test/index-dir.test.js` | The `NYC_LAWS_INDEX_DIR` override (issue #26), each case in a child process: unset and blank serve the bundled index; a set directory serves its versions and section text; relative paths resolve against the working directory; a directory without `versions.json` fails at startup naming the variable, with no silent fallback. Also starts the server over stdio and checks that `serverInfo.version` matches `package.json` and that `get_version` reports the override. |
| `test/footer-modes.test.js` | Disclaimer footer modes (issue #25). `NYC_CLR_FOOTER` parsing (unset, blank, both modes, a typo falling back to the default with a warning); the default sending the full footer once and the one-line footer after; `full` sending it every time; not-found, empty and error responses carrying a disclaimer; and the invariant that every response in every mode, including an unrecognized one, says "legal advice". Also starts the server over stdio to check `instructions`, the first and second responses, and the single stderr warning. |
| `test/strict-schema.test.js` | Strict tool schemas (issue #19). Asserts every tool in `TOOLS` (from `dist/tools.js`) advertises `additionalProperties: false`, and that `callTool()` rejects an undeclared parameter with an error naming both the offending key and that tool's accepted keys — rather than silently dropping it and returning unfiltered results. Includes regression guards that valid calls, with and without optional params, still succeed. |
| `test/build-smoke.test.js` | Build pipeline smoke test (Layer 5a). Feeds tiny hand-authored AML-shaped XML fixtures to the pure builder `buildSectionsFromXml` in `scripts/lib/build-corpus.js` — no multi-MB ZIPs. Asserts correct section shape, citation derivation (`Section 292.` → `§ 292`), clean text (no tags/entities/edge whitespace), document-order LINK extraction, and that non-qualifying records (wrong style-name, too-short heading) are filtered out. |
| `test/auto-release.test.js` | Unit tests for the pure helpers in `scripts/auto-release.js`: finding the bump commit, shortening AML "current through" lines, listing which corpora moved, and the release-entry text. Starting values are pinned in the test, not read from live data. |
| `test/auto-release-cli.test.js` | End-to-end runs of `scripts/auto-release.js prepare` and `ensure` against a throwaway git repo with stubbed `npm` and `gh`: version bump, tagging, one release dispatch, and recovery from a depth-1 checkout. The fixture pins the version (0.3.0) and the Rules "current through" date (October 4, 2026), so it does not drift when real releases ship or the law text moves. |

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

`.github/workflows/differential.yml` runs `npm run test:diff` on **manual dispatch** (`workflow_dispatch`) and **nightly at 03:00 UTC**. It is intentionally off the per-PR/per-push path. Python matrix: **3.11 and 3.12** (covers the team's 3.11–3.14 spread; harness uses stdlib-only APIs compatible with 3.8+).

`.github/workflows/refresh-data.yml` refreshes the corpus index from AML **daily at 11:00 UTC** (07:00 EDT / 06:00 EST) and on manual `workflow_dispatch`. It runs the full pipeline (`fetch-data` → `build-index` → `update-changelog` → `npm test`) and commits the refreshed index back to `main` with the built-in `GITHUB_TOKEN` **only when the corpus version actually advances** — a no-op rebuild produces no commit. A commit with new law text also bumps the patch version and triggers an npm release (see [Releases](#releases)). Because `npm test` runs **after** the fetch and rebuild, the tests see that day's new data. A test must never assume what `data/index/json/` says today: pin the values it depends on inside the test, or the refresh goes red on exactly the days law text changes and the new text never gets committed. The "Last index update" block below is stamped by that job.

## Releases

`.github/workflows/release.yml` is the only workflow that publishes to npm. It runs the test suite, checks that the tag matches `package.json`, publishes with provenance, and creates a GitHub Release with generated notes. It starts in one of two ways.

**Automatic patch releases (law text changed).** When the daily refresh commits new law text, the same commit bumps the patch version (`package.json` and `package-lock.json`) and adds a dated "Automatic data release" entry to [RELEASES.md](RELEASES.md) naming which corpora moved. The job then pushes the `vX.Y.Z` tag and starts `release.yml` on it with `gh workflow run` (a tag pushed by the built-in token does not trigger workflows by itself; `workflow_dispatch` is GitHub's documented exception). Days with no new text produce no release. An automatic release ships `main` as it stands, so code merged since the last release goes out in the next one; bump the minor version by hand first if that code warrants it.

If the current version is not on npm yet (for example you bumped it by hand and have not tagged it), the refresh still commits data but does not bump past your version. If the release cannot be prepared (for example the npm registry is unreachable), the new law text is still committed without a version bump and the refresh run goes red. If an automatic release fails, its Release run goes red and every following refresh run goes red too, naming the run to rerun, until the version is published. To recover, fix the cause and rerun the failed Release run (Actions → Release → Re-run, or `gh run rerun <id> --failed`). Never re-tag or bump to recover.

**Manual releases (code changes).**

1. Bump `version` in `package.json` on `main` and add an entry to [RELEASES.md](RELEASES.md).
2. Tag and push: `git tag vX.Y.Z && git push origin vX.Y.Z` (the tag must match `package.json`, or the workflow fails).

**Authentication.** `release.yml` is set up for [npm trusted publishing](https://docs.npmjs.com/trusted-publishers) (OIDC, no stored token). Until the trusted publisher is configured on npmjs.com it falls back to the `NPM_TOKEN` secret. One-time setup, by a package owner:

1. On npmjs.com, open `@betanyc/nyc-charter-laws-rules` → **Settings** → **Trusted Publisher** → **GitHub Actions**.
2. Fill in exactly (case-sensitive): Organization or user `BetaNYC`; Repository `nyc-charter-laws-rules`; Workflow filename `release.yml` (filename only, not the path); Environment name left blank. Under **Allowed actions**, also allow direct publishing with `npm publish`: configurations created after September 3, 2026 allow only `npm stage publish` by default, and the workflow publishes directly, so without this box npm rejects the trusted-publishing publish. Save. npm does not validate these fields when you save them.
3. Set **Settings** → **Publishing access** → "Require two-factor authentication and disallow tokens". npm's docs say trusted publishers keep working under that setting, so the next release can only succeed through trusted publishing: a green Release run after this point is the confirmation, provided its "Publish to npm" step actually ran (release.yml skips that step when the version is already on npm, for example on a rerun). (A success before this step does not prove it, because the workflow falls back to `NPM_TOKEN`, and npm's docs give no way to tell from the run log which one was used.) If that release fails with an authentication error, the trusted publisher is misconfigured. Re-check step 2 and rerun it. If you re-allow tokens instead, repeat step 3 once trusted publishing is fixed.
4. Once a release has succeeded with tokens disallowed, remove this repo's access to the `NPM_TOKEN` secret.

Package release history lives in [RELEASES.md](RELEASES.md); [CHANGELOG.md](CHANGELOG.md) is machine-generated and tracks corpus data updates only.

---

## Legal disclaimer

This server is for **research and informational purposes only. It does not provide legal advice.**

Caveats are encoded at four levels so no response can be returned without one:

1. **Tool descriptions** — every tool description includes a caveat line that the AI reads before responding. This ensures the AI naturally carries the disclaimer into any answer it gives.
2. **Server instructions** — the full disclaimer below is sent as the server's `instructions` when a client connects, in every footer mode. Some clients pass these to the model and some do not, which is why level 3 never goes away.
3. **Response footer** — every payload returned by the server ends with a disclaimer, regardless of which tool was called, what was found, or whether the call failed. By default the first response after the server starts carries the full footer below and every later response carries a one-line version (see `NYC_CLR_FOOTER` under Configuration).
4. **`get_version` instruction** — the `get_version` tool description explicitly instructs the AI to call it before answering legal questions, so every response is grounded in the correct version of the law.

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
├── src/                        ← MCP server (TypeScript)
├── scripts/
│   ├── fetch-data.js           ← downloads bulk XML ZIPs from AML
│   ├── build-index.js          ← thin CLI: reads ZIPs, writes JSON + Markdown indexes
│   └── lib/
│       ├── extract-text.js     ← ordered-tree text-extraction helpers
│       └── build-corpus.js     ← pure section builder (buildSectionsFromXml), unit-tested
├── data/
│   ├── raw/                    ← downloaded ZIPs (gitignored — build locally)
│   └── index/
│       ├── json/               ← committed: charter.json, admin_code.json, rules.json, versions.json
│       └── markdown/           ← committed: charter.md, admin_code.md, rules.md
└── dist/                       ← compiled MCP server (built locally)
```

The JSON and Markdown indexes are committed to the repo. Anyone who clones it gets 22,057 sections across all three documents immediately — no build step required to browse or run the server.

---

## Data source

All content is sourced from publicly available bulk XML downloads hosted by [American Legal Publishing](https://codelibrary.amlegal.com/codes/newyorkcity/latest/overview). No API key required.

| Document | Sections | Current Through | Bulk XML source |
|---|---|---|---|
| NYC Charter | 854 | LL 2026/094, amendments through May 17, 2026 | `http://files.amlegal.com/pdffiles/NewYorkCity/Charter/XML.zip` |
| NYC Administrative Code | 12,558 | LL 2026/094, amendments through May 17, 2026 | `http://files.amlegal.com/pdffiles/NewYorkCity/Admin/XML.zip` |
| Rules of the City of New York | 8,645 | Rules effective through May 20, 2026 | `http://files.amlegal.com/pdffiles/NewYorkCity/Rules/XML.zip` |

AML publishes updated ZIPs as new local laws and rules are adopted. Re-run `npm run fetch-data && npm run build-index` to refresh the index and commit the updated files.

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
npm run build-index   # parses XML, writes data/index/json/ and data/index/markdown/
```

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
- Unset or blank means the default. Any other value also means the default, and the server prints a warning naming the variable to stderr at startup.

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
1. list_titles("rules")                   → find the relevant title
2. get_title("rules", "Title 15")         → see all sections in that title
3. search("fire safety", corpus="rules")  → keyword search within rules
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
**Last index update:** 2026-10-06 — ⬆️ Updated

| Corpus | Current through | Sections |
|---|---|---|
| NYC Charter | Current through Local Law 2026/147, enacted September 12, 2026, | 856 |
| NYC Administrative Code | Current through Local Law 2026/147, enacted September 12, 2026, | 12,616 |
| Rules of the City of New York | Current through rules effective October 4, 2026. | 8,713 |
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
