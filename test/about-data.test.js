// about_data: where this server's data comes from (betanyc-ai-workspace
// platform/system/about-data-standard.md). It answers from DATA-SOURCES.json through BetaNYC's
// shared module (src/betanyc-tools.ts, a copy: never edit it here). How current each document
// is comes from the index this server is serving: the indexedAt times in versions.json.
//
// Like betanyc-tools.test.js, nothing here may depend on the law text or on package.json's
// version: the daily refresh runs this suite before it commits a new index.
//
// Requires: npm run build (dist/ must exist). Guaranteed by "pretest".

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { callTool, TOOLS, makeBetanycTools, SERVER_INSTRUCTIONS, resetFooterState, COMPACT_FOOTER } from "../dist/tools.js";
import { assertEveryToolExplained, SHARED_MODULE_VERSION } from "../dist/betanyc-tools.js";
import { INDEX_DIR } from "../dist/corpus.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DS_TEXT = readFileSync(join(ROOT, "DATA-SOURCES.json"), "utf8");
const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
const versions = JSON.parse(readFileSync(join(INDEX_DIR, "versions.json"), "utf8"));
const TOPICS = ["charter", "admin-code", "rules"];
const LAW_TOOLS = ["search", "get_section", "list_titles", "get_title", "get_version"];

const ask = (args) => makeBetanycTools().call("about_data", args);
const one = (body, topic) => body.sources.find((s) => s.topic === topic);

test("every tool says where its data comes from, so a new tool cannot ship unexplained", () => {
  assertEveryToolExplained(DS_TEXT, TOOLS.map((t) => t.name));
  // and the check bites: a tool with no source fails
  assert.throws(() => assertEveryToolExplained(DS_TEXT, [...TOOLS.map((t) => t.name), "brand_new_tool"]), /brand_new_tool/);
});

test("three sources, one per document, each naming its publisher, link and officialness", () => {
  const body = ask({}).structuredContent;
  assert.deepEqual(body.topics, TOPICS);
  for (const s of body.sources) {
    assert.equal(s.publisher, "American Legal Publishing", s.topic);
    assert.match(s.source_url, /^https:\/\/files\.amlegal\.com\/pdffiles\/NewYorkCity\/(Charter|Admin|Rules)\/XML\.zip$/, s.topic);
    assert.deepEqual(s.tools, LAW_TOOLS, s.topic);
  }
});

test("BetaNYC's text is derived, not the official text: figures_official is false", () => {
  const r = ask({ topic: "charter" });
  const s = r.structuredContent.sources[0];
  assert.equal(s.official, true, "the code library is the publisher's own record");
  assert.equal(s.figures_official, false, "BetaNYC cleans the text, so it is not the official text");
  assert.deepEqual(s.changed_by_betanyc.steps, ["reshaped", "cleaned"]);
  assert.match(r.content[0].text, /These figures are BetaNYC's, derived from it/);
  assert.match(r.content[0].text, /Report an error in these figures to BetaNYC/);
});

test("how current: each document's indexedAt from the versions.json being served", () => {
  const body = ask({}).structuredContent;
  const key = { charter: "charter", "admin-code": "admin_code", rules: "rules" };
  for (const topic of TOPICS) {
    const s = one(body, topic);
    assert.equal(s.as_of_status, "read", topic);
    assert.equal(s.as_of, versions[key[topic]].indexedAt, topic);
  }
});

test("about_data gives BetaNYC's contact address, lab@beta.nyc", () => {
  const r = ask({});
  assert.equal(r.structuredContent.contact_email, "lab@beta.nyc");
  assert.match(r.content[0].text, /^Questions or error reports about this data, to BetaNYC: lab@beta\.nyc$/m);
});

test("errors in the law text go to American Legal Publishing's address", () => {
  const s = one(ask({}).structuredContent, "rules");
  assert.equal(s.report_errors.in_the_data_email, "NYC.editor@amlegal.com");
});

test("a tool name works as a topic: search covers all three documents", () => {
  assert.deepEqual(ask({ topic: "search" }).structuredContent.sources.map((s) => s.topic), TOPICS);
});

test("an unknown topic is an error that lists the topics", () => {
  const r = ask({ topic: "zoning" });
  assert.equal(r.isError, true);
  assert.match(r.content[0].text, /admin-code/);
});

test("an unreadable DATA-SOURCES.json: the answer says so, with no error flag", () => {
  const r = makeBetanycTools({ dataSourcesText: "{" }).call("about_data", {});
  assert.notEqual(r.isError, true);
  assert.match(r.structuredContent.note, /cannot be read/);
  assert.equal(r.structuredContent.contact_email, null);
});

test("the server fails at startup when DATA-SOURCES.json names another repo", () => {
  const other = DS_TEXT.replace('"repository": "https://github.com/BetaNYC/nyc-charter-laws-rules"', '"repository": "https://github.com/BetaNYC/other"');
  assert.throws(() => makeBetanycTools({ dataSourcesText: other }), /repository/);
});

test("about_data ends with the one-line disclaimer, like the other shared tools", async () => {
  resetFooterState({});
  const r = await callTool("about_data", {});
  assert.ok(r.content[0].text.endsWith(COMPACT_FOOTER));
  assert.equal(r.structuredContent.contact_email, "lab@beta.nyc", "structuredContent is untouched");
});

test("the server's instructions tell the AI app to call about_data and about_betanyc", () => {
  assert.match(SERVER_INSTRUCTIONS, /call about_data/);
  assert.match(SERVER_INSTRUCTIONS, /figures_official/);
  assert.match(SERVER_INSTRUCTIONS, /call about_betanyc/);
});

test("the package ships DATA-SOURCES.json and data.json", () => {
  for (const f of ["DATA-SOURCES.json", "data.json"]) assert.ok(pkg.files.includes(f), f);
});

async function connect(env) {
  const client = new Client({ name: "about-data-test", version: "0" });
  await client.connect(new StdioClientTransport({
    command: process.execPath,
    args: [join(ROOT, "dist", "index.js")],
    env: { ...process.env, ...env },
    stderr: "ignore",
  }));
  return client;
}

// Through the MCP protocol, the way an AI app calls it. The SDK client checks structuredContent
// against about_data's declared outputSchema.
test("over stdio: about_data is listed with its topics and answers against its schema", async () => {
  const client = await connect({});
  try {
    const listed = (await client.listTools()).tools.find((t) => t.name === "about_data");
    assert.ok(listed, "about_data is listed");
    assert.match(listed.description, /Topics on this server: charter, admin-code, rules/);
    assert.match(client.getInstructions() ?? "", /call about_data/);
    const r = await client.callTool({ name: "about_data", arguments: { topic: "admin-code" } });
    assert.equal(r.structuredContent.sources[0].as_of, versions.admin_code.indexedAt);
    assert.match(r.content[0].text, /files\.amlegal\.com/);
    const about = await client.callTool({ name: "about_betanyc", arguments: {} });
    assert.equal(about.structuredContent.server.shared_module_version, SHARED_MODULE_VERSION);
  } finally {
    await client.close();
  }
});

test("over stdio: an index with no date for a document says so instead of a date", async () => {
  const dir = mkdtempSync(join(tmpdir(), "clr-about-"));
  writeFileSync(join(dir, "versions.json"), JSON.stringify({ charter: versions.charter }));
  const client = await connect({ NYC_LAWS_INDEX_DIR: dir });
  try {
    const r = await client.callTool({ name: "about_data", arguments: {} });
    const body = r.structuredContent;
    assert.equal(one(body, "charter").as_of, versions.charter.indexedAt);
    for (const topic of ["admin-code", "rules"]) {
      assert.equal(one(body, topic).as_of_status, "unavailable", topic);
      assert.doesNotMatch(one(body, topic).as_of, /\d{4}-\d{2}-\d{2}/, topic);
    }
  } finally {
    await client.close();
  }
});

test("package.json version is what about_betanyc reports", async () => {
  const r = await callTool("about_betanyc", {});
  assert.equal(r.structuredContent.server.version, pkg.version);
});
