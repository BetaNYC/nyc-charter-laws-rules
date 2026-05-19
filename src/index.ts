#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";

// TODO: import query functions from ./corpus once XML parsing is implemented
// import { searchCorpus, getSection, listTitles } from "./corpus.js";

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
          limit: { type: "number", description: "Max results to return (default 10, max 50)" },
        },
        required: ["query"],
      },
    },
    {
      name: "get_section",
      description:
        "Retrieve a specific section by its citation (e.g. 'Charter § 20', 'Admin Code § 3-101', 'Rules 1 RCNY § 1-01').",
      inputSchema: {
        type: "object",
        properties: {
          citation: { type: "string", description: "Section citation" },
        },
        required: ["citation"],
      },
    },
    {
      name: "list_titles",
      description:
        "List the top-level titles or chapters of a document.",
      inputSchema: {
        type: "object",
        properties: {
          corpus: {
            type: "string",
            enum: ["charter", "admin_code", "rules"],
            description: "Which document to list titles for",
          },
        },
        required: ["corpus"],
      },
    },
    {
      name: "get_title",
      description:
        "Retrieve all sections within a title or chapter.",
      inputSchema: {
        type: "object",
        properties: {
          corpus: {
            type: "string",
            enum: ["charter", "admin_code", "rules"],
            description: "Which document",
          },
          title: { type: "string", description: "Title or chapter identifier" },
        },
        required: ["corpus", "title"],
      },
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
        // TODO: implement corpus search
        void corpus; void limit;
        return { content: [{ type: "text", text: `Search not yet implemented. Query: "${query}". Run npm run fetch-data to download and index XML source files.` }] };
      }

      case "get_section": {
        const { citation } = z.object({ citation: z.string() }).parse(args);
        // TODO: implement section lookup
        return { content: [{ type: "text", text: `Section lookup not yet implemented. Citation: "${citation}". Run npm run fetch-data to download and index XML source files.` }] };
      }

      case "list_titles": {
        const { corpus } = z.object({ corpus: z.enum(["charter", "admin_code", "rules"]) }).parse(args);
        // TODO: implement title listing
        return { content: [{ type: "text", text: `Title listing not yet implemented for "${corpus}". Run npm run fetch-data to download and index XML source files.` }] };
      }

      case "get_title": {
        const { corpus, title } = z
          .object({
            corpus: z.enum(["charter", "admin_code", "rules"]),
            title: z.string(),
          })
          .parse(args);
        // TODO: implement title retrieval
        void title;
        return { content: [{ type: "text", text: `Title retrieval not yet implemented for "${corpus}". Run npm run fetch-data to download and index XML source files.` }] };
      }

      default:
        return { content: [{ type: "text", text: `Unknown tool: ${name}` }], isError: true };
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { content: [{ type: "text", text: `Error: ${message}` }], isError: true };
  }
});

const transport = new StdioServerTransport();
await server.connect(transport);
