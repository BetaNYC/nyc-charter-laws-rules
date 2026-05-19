# nyc-charter-laws-rules

> **Status: Early development.** Tools are scaffolded; XML parsing and search are not yet implemented.

An [MCP (Model Context Protocol)](https://modelcontextprotocol.io/) server giving AI assistants access to New York City's primary legal documents:

- **The New York City Charter**
- **The New York City Administrative Code**
- **The Rules of the City of New York**

Built by [BetaNYC](https://beta.nyc).

---

## Data source

All content is sourced from publicly available bulk XML downloads hosted by [American Legal Publishing](https://codelibrary.amlegal.com/codes/newyorkcity/latest/overview):

| Document | Source |
|---|---|
| NYC Charter | `http://files.amlegal.com/pdffiles/NewYorkCity/Charter/XML.zip` |
| NYC Administrative Code | `http://files.amlegal.com/pdffiles/NewYorkCity/Admin/XML.zip` |
| Rules of the City of New York | `http://files.amlegal.com/pdffiles/NewYorkCity/Rules/XML.zip` |

No API key required. Run `npm run fetch-data` to download the source files locally.

---

## Tools (planned)

| Tool | Description |
|---|---|
| `search` | Search across all three documents by keyword or phrase |
| `get_section` | Retrieve a specific section by citation (e.g. `Charter § 20`) |
| `list_titles` | List top-level titles or chapters of a document |
| `get_title` | Retrieve all sections within a title or chapter |

---

## Prerequisites

- Node.js 18 or later

---

## Installation

```bash
git clone https://github.com/BetaNYC/nyc-charter-laws-rules.git
cd nyc-charter-laws-rules
npm install
npm run fetch-data
npm run build
npm start
```

---

## Contributing

Issues and pull requests welcome at [github.com/BetaNYC/nyc-charter-laws-rules](https://github.com/BetaNYC/nyc-charter-laws-rules).

---

## License

MIT © [BetaNYC](https://beta.nyc)
