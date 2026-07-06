#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import {
  searchCorpus,
  getSection,
  listTitles,
  getTitle,
  getVersions,
} from "./corpus.js";

const CAVEAT =
  "For informational purposes only. Not legal advice. Verify against official sources at codelibrary.amlegal.com before relying on any result.";

const FOOTER = `
---
⚠️ **This information is for research and informational purposes only and does not constitute legal advice.** NYC laws and rules are amended frequently — always verify the current text at https://codelibrary.amlegal.com/codes/newyorkcity/latest/overview before acting on any information. For the latest rules information, see https://rules.cityofnewyork.us. For legal matters, consult a licensed attorney.

**Official disclaimer from American Legal Publishing:** The Codes and other documents that appear on this site may not yet reflect the most current legislation or rules adopted by the City. In addition, certain textual errors and omissions may temporarily exist, resulting from problems in the source database provided to American Legal and from which this website was created. Although these errors and omissions are being corrected, any user discovering any such error is invited to contact the publisher at NYC.editor@amlegal.com or 800-445-5588 and/or the NYC Law Department at NYCCodeRulesCharter@law.nyc.gov.

Built by BetaNYC (https://beta.nyc). Feedback and improvements welcome — file a GitHub issue at https://github.com/BetaNYC/nyc-charter-laws-rules.`.trim();

function withFooter(text: string): string {
  return `${text}\n\n${FOOTER}`;
}

function textResult(text: string) {
  return { content: [{ type: "text" as const, text: withFooter(text) }] };
}

const server = new McpServer({
  name: "nyc-charter-laws-rules",
  version: "0.1.0",
});

server.registerTool(
  "search",
  {
    description: `Search across the NYC Charter, Administrative Code, and Rules of the City of New York by keyword or phrase. ${CAVEAT}`,
    inputSchema: {
      query: z.string().describe("Search term or phrase"),
      corpus: z
        .enum(["charter", "admin_code", "rules", "all"])
        .optional()
        .describe("Which document to search (default: all)"),
      limit: z
        .number()
        .max(50)
        .optional()
        .describe("Max results to return (default 10, max 50)"),
    },
  },
  async ({ query, corpus, limit }) => {
    const results = searchCorpus(query, corpus ?? "all", limit ?? 10);
    if (results.length === 0) {
      return textResult(`No results found for "${query}".`);
    }
    const text = results
      .map(
        (s) =>
          `[${s.corpus.toUpperCase()}] ${s.citation} — ${s.heading}\n${s.text.slice(0, 400)}${s.text.length > 400 ? "…" : ""}`
      )
      .join("\n\n---\n\n");
    return textResult(text);
  }
);

server.registerTool(
  "get_section",
  {
    description: `Retrieve a specific section by its citation (e.g. '§ 259', 'Section 259', 'Chapter 11'). ${CAVEAT}`,
    inputSchema: {
      citation: z.string().describe("Section citation or heading"),
    },
  },
  async ({ citation }) => {
    const section = getSection(citation);
    if (!section) {
      return textResult(`Section not found: "${citation}".`);
    }
    const text = `[${section.corpus.toUpperCase()}] ${section.citation}\n${section.heading}\n\n${section.text}`;
    return textResult(text);
  }
);

server.registerTool(
  "list_titles",
  {
    description: `List the top-level chapters or titles of a document. ${CAVEAT}`,
    inputSchema: {
      corpus: z
        .enum(["charter", "admin_code", "rules"])
        .describe("Which document to list"),
    },
  },
  async ({ corpus }) => {
    const titles = listTitles(corpus);
    if (titles.length === 0) {
      return textResult(`No titles found for ${corpus}.`);
    }
    const text = titles.map((t) => `${t.citation} — ${t.heading}`).join("\n");
    return textResult(text);
  }
);

server.registerTool(
  "get_title",
  {
    description: `Retrieve all sections within a chapter or title. ${CAVEAT}`,
    inputSchema: {
      corpus: z
        .enum(["charter", "admin_code", "rules"])
        .describe("Which document"),
      title: z
        .string()
        .describe("Chapter or title identifier (e.g. 'Chapter 11')"),
    },
  },
  async ({ corpus, title }) => {
    const sections = getTitle(corpus, title);
    if (sections.length === 0) {
      return textResult(`No sections found for "${title}" in ${corpus}.`);
    }
    const text = sections.map((s) => `${s.citation} — ${s.heading}`).join("\n");
    return textResult(text);
  }
);

server.registerTool(
  "get_version",
  {
    description: `Return the currency date for each document — how current the Charter, Administrative Code, and Rules are. Each corpus updates on its own schedule. Always call this tool before answering legal questions so responses are grounded in the correct version of the law. ${CAVEAT}`,
    inputSchema: {},
  },
  async () => {
    const versions = getVersions();
    const lines = [
      `NYC Charter:           ${versions.charter?.currentThrough ?? "unknown"} (${versions.charter?.sectionCount ?? 0} sections)`,
      `Administrative Code:   ${versions.admin_code?.currentThrough ?? "unknown"} (${versions.admin_code?.sectionCount ?? 0} sections)`,
      `Rules of NYC:          ${versions.rules?.currentThrough ?? "unknown"} (${versions.rules?.sectionCount ?? 0} sections)`,
      ``,
      `Index built: ${versions.charter?.indexedAt ?? "unknown"}`,
    ];
    return textResult(lines.join("\n"));
  }
);

const transport = new StdioServerTransport();
await server.connect(transport);
