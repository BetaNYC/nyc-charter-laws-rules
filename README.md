# nyc-charter-laws-rules

An [MCP (Model Context Protocol)](https://modelcontextprotocol.io/) server giving AI assistants access to New York City's three primary legal documents:

- **The New York City Charter**
- **The New York City Administrative Code**
- **The Rules of the City of New York**

Built by [BetaNYC](https://beta.nyc).

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
NYC Charter:           Current through Local Law 2026/086, enacted April 25, 2026, and includes amendments effective through May 17, 2026. (854 sections)
Administrative Code:   Current through Local Law 2026/086, enacted April 25, 2026, and includes amendments effective through May 17, 2026. (12551 sections)
Rules of NYC:          Current through rules effective May 15, 2026. (8645 sections)

Index built: 2026-05-19T19:57:18.179Z
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
> Built by [BetaNYC](https://beta.nyc). Feedback and improvements welcome — [file a GitHub issue](https://github.com/BetaNYC/nyc-charter-laws-rules).

---

## Data source

All content is sourced from publicly available bulk XML downloads hosted by [American Legal Publishing](https://codelibrary.amlegal.com/codes/newyorkcity/latest/overview). No API key required.

| Document | Bulk XML source |
|---|---|
| NYC Charter | `http://files.amlegal.com/pdffiles/NewYorkCity/Charter/XML.zip` |
| NYC Administrative Code | `http://files.amlegal.com/pdffiles/NewYorkCity/Admin/XML.zip` |
| Rules of the City of New York | `http://files.amlegal.com/pdffiles/NewYorkCity/Rules/XML.zip` |

AML publishes updated ZIPs as new local laws and rules are adopted. Re-run `npm run fetch-data && npm run build-index` to refresh the index.

---

## Prerequisites

- Node.js 18 or later

---

## Installation

```bash
git clone https://github.com/BetaNYC/nyc-charter-laws-rules.git
cd nyc-charter-laws-rules
npm install
```

---

## Setup: download and index the data

The XML source files are not included in the repo — each user builds the index locally from the public AML downloads.

**Step 1 — Download the bulk XML ZIPs:**

```bash
npm run fetch-data
```

This downloads three ZIP files (~50MB total) into `data/raw/`.

**Step 2 — Parse and index the XML:**

```bash
npm run build-index
```

This unzips and parses all XML files, extracts sections and version dates, and writes the index to `data/index/`. Expect about 30–60 seconds on a modern machine.

**Step 3 — Build and start the server:**

```bash
npm run build
npm start
```

---

## Configuration

### Claude Desktop

Add to your `claude_desktop_config.json`:

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

### Claude Code

Add to your project's `.mcp.json` or `.claude/settings.json`:

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

## Refreshing the index

AML publishes updated ZIPs as laws and rules change. To update your local index:

```bash
npm run fetch-data && npm run build-index
```

The `get_version` tool will reflect the new currency dates after the next server restart.

---

## Contributing

Issues and pull requests welcome at [github.com/BetaNYC/nyc-charter-laws-rules](https://github.com/BetaNYC/nyc-charter-laws-rules).

---

## License

MIT © [BetaNYC](https://beta.nyc)
