#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import {
  searchCorpus,
  getSection,
  listTitles,
  getTitle,
  getVersions,
} from "./corpus.js";

const server = new Server(
  { name: "nyc-charter-laws-rules", version: "0.1.0" },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "search",
      description:
        "Search across the NYC Charter, Administrative Code, and Rules of the City of New York by keyword or phrase.",
      inputSchema: {
        type: "object",
        properties: {
          query: { type: "string", description: "Search term or phrase" },
          corpus: {
            type: "string",
            enum: ["charter", "admin_code", "rules", "all"],
            description: "Which document to search (default: all)",
          },
          limit: {
            type: "number",
            description: "Max results to return (default 10, max 50)",
          },
        },
        required: ["query"],
      },
    },
    {
      name: "get_section",
      description:
        "Retrieve a specific section by its citation (e.g. '§ 259', 'Section 259', 'Chapter 11').",
      inputSchema: {
        type: "object",
        properties: {
          citation: { type: "string", description: "Section citation or heading" },
        },
        required: ["citation"],
      },
    },
    {
      name: "list_titles",
      description: "List the top-level chapters or titles of a document.",
      inputSchema: {
        type: "object",
        properties: {
          corpus: {
            type: "string",
            enum: ["charter", "admin_code", "rules"],
            description: "Which document to list",
          },
        },
        required: ["corpus"],
      },
    },
    {
      name: "get_title",
      description: "Retrieve all sections within a chapter or title.",
      inputSchema: {
        type: "object",
        properties: {
          corpus: {
            type: "string",
            enum: ["charter", "admin_code", "rules"],
            description: "Which document",
          },
          title: {
            type: "string",
            description: "Chapter or title identifier (e.g. 'Chapter 11')",
          },
        },
        required: ["corpus", "title"],
      },
    },
    {
      name: "get_version",
      description:
        "Return the currency date for each document — how current the Charter, Administrative Code, and Rules are.",
      inputSchema: { type: "object", properties: {} },
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    switch (name) {
      case "search": {
        const { query, corpus, limit } = z
          .object({
            query: z.string(),
            corpus: z.enum(["charter", "admin_code", "rules", "all"]).optional(),
            limit: z.number().max(50).optional(),
          })
          .parse(args);
        const results = searchCorpus(query, corpus ?? "all", limit ?? 10);
        if (results.length === 0) {
          return { content: [{ type: "text", text: `No results found for "${query}".` }] };
        }
        const text = results
          .map(
            (s) =>
              `[${s.corpus.toUpperCase()}] ${s.citation} — ${s.heading}\n${s.text.slice(0, 400)}${s.text.length > 400 ? "…" : ""}`
          )
          .join("\n\n---\n\n");
        return { content: [{ type: "text", text }] };
      }

      case "get_section": {
        const { citation } = z.object({ citation: z.string() }).parse(args);
        const section = getSection(citation);
        if (!section) {
          return { content: [{ type: "text", text: `Section not found: "${citation}".` }] };
        }
        const text = `[${section.corpus.toUpperCase()}] ${section.citation}\n${section.heading}\n\n${section.text}`;
        return { content: [{ type: "text", text }] };
      }

      case "list_titles": {
        const { corpus } = z
          .object({ corpus: z.enum(["charter", "admin_code", "rules"]) })
          .parse(args);
        const titles = listTitles(corpus);
        if (titles.length === 0) {
          return { content: [{ type: "text", text: `No titles found for ${corpus}.` }] };
        }
        const text = titles.map((t) => `${t.citation} — ${t.heading}`).join("\n");
        return { content: [{ type: "text", text }] };
      }

      case "get_title": {
        const { corpus, title } = z
          .object({
            corpus: z.enum(["charter", "admin_code", "rules"]),
            title: z.string(),
          })
          .parse(args);
        const sections = getTitle(corpus, title);
        if (sections.length === 0) {
          return { content: [{ type: "text", text: `No sections found for "${title}" in ${corpus}.` }] };
        }
        const text = sections
          .map((s) => `${s.citation} — ${s.heading}`)
          .join("\n");
        return { content: [{ type: "text", text }] };
      }

      case "get_version": {
        const versions = getVersions();
        const lines = [
          `NYC Charter:           ${versions.charter?.currentThrough ?? "unknown"} (${versions.charter?.sectionCount ?? 0} sections)`,
          `Administrative Code:   ${versions.admin_code?.currentThrough ?? "unknown"} (${versions.admin_code?.sectionCount ?? 0} sections)`,
          `Rules of NYC:          ${versions.rules?.currentThrough ?? "unknown"} (${versions.rules?.sectionCount ?? 0} sections)`,
          ``,
          `Index built: ${versions.charter?.indexedAt ?? "unknown"}`,
        ];
        return { content: [{ type: "text", text: lines.join("\n") }] };
      }

      default:
        return {
          content: [{ type: "text", text: `Unknown tool: ${name}` }],
          isError: true,
        };
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { content: [{ type: "text", text: `Error: ${message}` }], isError: true };
  }
});

const transport = new StdioServerTransport();
await server.connect(transport);
