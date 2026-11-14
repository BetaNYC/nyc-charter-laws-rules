// whats_changed and about_betanyc, two of the three tools BetaNYC adds to each of its MCP servers
// (betanyc-ai-workspace platform/system/whats-changed-standard.md § 7). They read this repo's
// WHATS-CHANGED.md and never touch the network. The third, about_data, is in about-data.test.js.
//
// The daily refresh runs this suite before it commits new law text, and an automatic release
// bumps package.json without a WHATS-CHANGED.md entry. So nothing here may depend on the law
// text or on package.json's version having an entry of its own.
//
// Requires: npm run build (dist/ must exist). Guaranteed by "pretest".

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { callTool, TOOLS, resetFooterState, sharedToolFooter, FOOTER, COMPACT_FOOTER, FOOTER_ENV } from "../dist/tools.js";
import { SHARED_MODULE_VERSION } from "../dist/betanyc-tools.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
const whatsChanged = readFileSync(join(ROOT, "WHATS-CHANGED.md"), "utf8");
const REPO = "https://github.com/BetaNYC/nyc-charter-laws-rules";
// No website: an entry's link goes to the file on GitHub.
const PAGE = `${REPO}/blob/HEAD/WHATS-CHANGED.md`;
// Dated entries only: the tool leaves out an "## Unreleased:" entry (the version waiting for its tag).
const entryCount = (whatsChanged.match(/^## [0-9]{4}-[0-9]{2}-[0-9]{2}: /gm) ?? []).length;
const unreleased = (whatsChanged.match(/^## Unreleased: /gm) ?? []).length;

const textOf = (r) => r.content.map((c) => c.text).join("\n");

test("all three shared tools are advertised, read-only, strict, with an output schema", () => {
  for (const name of ["whats_changed", "about_betanyc", "about_data"]) {
    const t = TOOLS.find((x) => x.name === name);
    assert.ok(t, name);
    assert.equal(t.outputSchema.type, "object", name);
    assert.equal(t.annotations.readOnlyHint, true, name);
    assert.equal(t.inputSchema.additionalProperties, false, name);
  }
  assert.equal(TOOLS.length, 8, "five law tools plus the three shared ones");
});

test("whats_changed answers from this repo's WHATS-CHANGED.md, with every entry valid", async () => {
  resetFooterState({});
  const r = await callTool("whats_changed", { limit: 50 });
  assert.notEqual(r.isError, true, textOf(r));
  const s = r.structuredContent;
  assert.deepEqual(s.server, { name: "nyc-charter-laws-rules", version: pkg.version });
  assert.equal(s.source, PAGE);
  assert.equal(s.history_begins, "2026-05-21");
  assert.ok(entryCount >= 10, `${entryCount} dated entries`);
  assert.equal(s.total_matching, entryCount);
  assert.equal(s.returned, entryCount);
  assert.ok(unreleased <= 1);
  if (unreleased) assert.match(s.note, /not released yet/, "the note says an unreleased entry is left out");
  else assert.equal(s.note, null);
  assert.doesNotMatch(s.note ?? "", /error/, "no entry was left out for an error");
  for (const e of s.entries) {
    assert.ok(e.url.startsWith(`${PAGE}#${e.date}-`), e.url);
    for (const l of e.links) assert.match(l.url, /^https:\/\//, `${e.title}: ${l.url}`);
    // MCP entries link to RELEASES.md (package releases); CHANGELOG.md is the daily robot log.
    if (e.mcp_version) assert.match(e.mcp_version, /\]\(https:\/\/github\.com\/BetaNYC\/nyc-charter-laws-rules\/blob\/HEAD\/RELEASES\.md(#v\d+--\d{4}-\d{2}-\d{2})?\)$/, e.title);
  }
});

test("whats_changed filters: every Correction says what to do if you used the old answer", async () => {
  const r = await callTool("whats_changed", { tag: "correction", limit: 50 });
  assert.equal(r.structuredContent.filters.tag, "Correction", "any case is accepted; answers use the canonical spelling");
  assert.ok(r.structuredContent.returned >= 4);
  for (const e of r.structuredContent.entries) {
    assert.ok(e.tags.includes("Correction"));
    assert.ok(e.if_you_used_the_old_numbers, e.title);
  }
  const since = await callTool("whats_changed", { since: "2026-10-01" });
  assert.ok(since.structuredContent.returned >= 1);
  for (const e of since.structuredContent.entries) assert.ok(e.date >= "2026-10-01", e.date);
});

test("whats_changed rejects bad arguments by name, with a disclaimer", async () => {
  for (const [args, re] of [
    [{ since: "last week" }, /since must be a real date/],
    [{ tag: "Parks" }, /tag must be one of/],
    [{ limit: 51 }, /limit must be a whole number from 1 to 50/],
    [{ corpus: "charter" }, /does not accept 'corpus'/],
  ]) {
    const r = await callTool("whats_changed", args);
    assert.equal(r.isError, true, JSON.stringify(args));
    assert.match(textOf(r), re);
    assert.match(textOf(r), /legal advice/);
  }
});

test("about_betanyc names the server, its version, and where to report a bug or ask for a feature", async () => {
  const r = await callTool("about_betanyc", {});
  assert.notEqual(r.isError, true, textOf(r));
  const s = r.structuredContent;
  assert.deepEqual(s.server, {
    name: "nyc-charter-laws-rules",
    version: pkg.version,
    repository: REPO,
    shared_module_version: SHARED_MODULE_VERSION,
  });
  assert.equal(s.built_by, "BetaNYC, a project of the Fund for the City of New York");
  assert.deepEqual(s.bugs_and_requests, { issues: `${REPO}/issues`, new_issue: `${REPO}/issues/new` });
  assert.equal(s.whats_changed, PAGE);
  const bad = await callTool("about_betanyc", { verbose: true });
  assert.equal(bad.isError, true);
  assert.match(textOf(bad), /takes no parameters/);
});

test("the shared tools carry a disclaimer but leave the full footer for the first law answer", async () => {
  resetFooterState({});
  for (const name of ["whats_changed", "about_betanyc"]) {
    const t = textOf(await callTool(name, {}));
    assert.ok(t.endsWith(`\n\n${COMPACT_FOOTER}`), `${name} ends with the one-line footer`);
    assert.ok(!t.includes(FOOTER), name);
  }
  const law = textOf(await callTool("get_version", {}));
  assert.ok(law.endsWith(FOOTER), "the first law answer still gets the full footer");

  resetFooterState({ [FOOTER_ENV]: "full" });
  assert.equal(sharedToolFooter(), FOOTER);
  assert.ok(textOf(await callTool("about_betanyc", {})).endsWith(`\n\n${FOOTER}`), "full mode: the full footer");
  resetFooterState({});
});

test("the structured answer is the shared module's, untouched by the footer", async () => {
  resetFooterState({});
  const r = await callTool("about_betanyc", {});
  assert.doesNotMatch(JSON.stringify(r.structuredContent), /legal advice/);
});

test("WHATS-CHANGED.md is listed in the package's files", () => {
  assert.ok(pkg.files.includes("WHATS-CHANGED.md"), pkg.files.join(", "));
});

test("over stdio, the SDK client accepts both answers against their output schemas", async () => {
  // Client.callTool validates structuredContent against the outputSchema from tools/list
  // and throws when it does not match, so this is the MCP contract checked end to end.
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [join(ROOT, "dist", "index.js")],
    stderr: "ignore",
  });
  const client = new Client({ name: "betanyc-tools-test", version: "0" });
  await client.connect(transport);
  try {
    const { tools } = await client.listTools();
    assert.equal(tools.length, 8);
    const wc = await client.callTool({ name: "whats_changed", arguments: { limit: 3 } });
    assert.equal(wc.structuredContent.returned, 3);
    const about = await client.callTool({ name: "about_betanyc", arguments: {} });
    assert.equal(about.structuredContent.server.version, pkg.version);
    const v = await client.callTool({ name: "get_version", arguments: {} });
    assert.match(v.content[0].text, /NYC Charter:/, "the law tools still dispatch");
  } finally {
    await client.close();
  }
});
