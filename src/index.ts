#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { TOOLS, callTool } from "./tools.js";
import { INDEX_DIR, INDEX_DIR_ENV } from "./corpus.js";
import { PACKAGE_VERSION } from "./version.js";

const server = new Server(
  {
    name: "nyc-charter-laws-rules",
    version: PACKAGE_VERSION,
  },
  {
    capabilities: { tools: {} },
  }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

server.setRequestHandler(CallToolRequestSchema, async (request) =>
  callTool(request.params.name, request.params.arguments)
);

// stdout carries the MCP protocol; diagnostics go to stderr.
if (process.env[INDEX_DIR_ENV]?.trim()) {
  console.error(`nyc-charter-laws-rules: serving index from ${INDEX_DIR} (${INDEX_DIR_ENV})`);
}

const transport = new StdioServerTransport();
await server.connect(transport);
