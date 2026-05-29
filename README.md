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

Search across the NYC Charter, Administrative Code, and Rules by keyword or phrase.

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

Retrieve a specific section by citation or heading fragment.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `citation` | string | yes | Section citation or heading (e.g. `§ 259`, `Section 20-f`, `Chapter 11`) |

```
get_section("§ 259")
get_section("Section 20-f")
get_section("Chapter 11")
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

Retrieve all sections within a chapter or title.

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
NYC Charter:           Current through Local Law 2026/094, enacted May 16, 2026, and includes amendments effective through May 17, 2026. (854 sections)
Administrative Code:   Current through Local Law 2026/094, enacted May 16, 2026, and includes amendments effective through May 17, 2026. (12558 sections)
Rules of NYC:          Current through rules effective May 20, 2026. (8645 sections)

Index built: 2026-05-26T01:30:51.847Z
```

---

## Legal disclaimer

This server is for **research and informational purposes only. It does not provide legal advice.**

Caveats are encoded at three levels so no response can be returned without them:

1. **Tool descriptions** — every tool description includes a caveat line that the AI reads before responding. This ensures the AI naturally carries the disclaimer into any answer it gives.
2. **Response footer** — every payload returned by the server includes a full disclaimer footer, regardless of which tool was called or what was found.
3. **`get_version` instruction** — the `get_version` tool description explicitly instructs the AI to call it before answering legal questions, so every response is grounded in the correct version of the law.

### Footer included on every response

> ⚠️ This information is for research and informational purposes only and does not constitute legal advice. NYC laws and rules are amended frequently — always verify the current text at [codelibrary.amlegal.com](https://codelibrary.amlegal.com/codes/newyorkcity/latest/overview) before acting on any information. For the latest rules information, see [rules.cityofnewyork.us](https://rules.cityofnewyork.us). For legal matters, consult a licensed attorney.
>
> **Official disclaimer from American Legal Publishing:** The Codes and other documents that appear on this site may not yet reflect the most current legislation or rules adopted by the City. In addition, certain textual errors and omissions may temporarily exist, resulting from problems in the source database provided to American Legal and from which this website was created. Although these errors and omissions are being corrected, any user discovering any such error is invited to contact the publisher at NYC.editor@amlegal.com or 800-445-5588 and/or the NYC Law Department at NYCCodeRulesCharter@law.nyc.gov.
>
> Vibe coded with [Claude](https://claude.ai) by [BetaNYC](https://beta.nyc). Feedback and improvements welcome — [file a GitHub issue](https://github.com/BetaNYC/nyc-charter-laws-rules).

---

## Repository structure

```
nyc-charter-laws-rules/
├── src/                        ← MCP server (TypeScript)
├── scripts/
│   ├── fetch-data.js           ← downloads bulk XML ZIPs from AML
│   └── build-index.js          ← parses XML, writes JSON + Markdown indexes
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

- Node.js 18 or later

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
**Last index update:** 2026-05-29 — ⬆️ Updated

| Corpus | Current through | Sections |
|---|---|---|
| NYC Charter | Current through Local Law 2026/094, enacted May 16, 2026,and includes amendments effective through May 27, 2026. | 854 |
| NYC Administrative Code | Current through Local Law 2026/094, enacted May 16, 2026,and includes amendments effective through May 27, 2026. | 12,558 |
| Rules of the City of New York | Current through rules effective May 20, 2026. | 8,645 |
<!-- LATEST_INDEX_UPDATE:END -->

### Release history

Package version history (distinct from the per-rebuild record in CHANGELOG.md):

- **0.1.2 — May 25, 2026:** Charter and Admin Code current through **LL 2026/094** (enacted May 16, 2026), up from LL 2026/086; Rules through **May 20, 2026**, up from May 15; Admin Code 12,551 → 12,558 sections.
- **0.1.1:** Initial published release with full JSON and Markdown indexes committed to repo.
- **0.1.0:** Initial release.

---

## Contributing

Issues and pull requests welcome at [github.com/BetaNYC/nyc-charter-laws-rules](https://github.com/BetaNYC/nyc-charter-laws-rules).

---

## License

MIT License

Copyright (c) 2026 BetaNYC

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
