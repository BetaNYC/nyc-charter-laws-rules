#!/usr/bin/env node
// Runs eval/questions.json against the built server (dist/), offline, and prints one line per
// question. `--save` writes the results to eval/runs/YYYY-MM-DD.json (New York date).
// Exit 1 if any question fails. Usage: npm run eval [-- --save]

import { readFileSync, writeFileSync } from "node:fs";
import { callTool, TOOLS } from "../dist/tools.js";
import { getVersions } from "../dist/corpus.js";

const { questions } = JSON.parse(readFileSync(new URL("questions.json", import.meta.url), "utf8"));
const citations = (text) => [...text.matchAll(/^\[(?:CHARTER|ADMIN_CODE|RULES)\] (.+?) — /gm)].map((m) => m[1]);

function check(text, c) {
  const fails = [];
  const top = (n) => citations(text).slice(0, n);
  if (c.heading && !text.toLowerCase().includes(c.heading.toLowerCase())) fails.push(`heading "${c.heading}" not found`);
  if (c.contains && !text.includes(c.contains)) fails.push(`"${c.contains}" not found`);
  if (c.first_line && !new RegExp(c.first_line).test(text.split("\n")[0])) fails.push(`first line: ${text.split("\n")[0].slice(0, 80)}`);
  if (c.citation_in_top && !top(c.citation_in_top.n).includes(c.citation_in_top.citation)) {
    fails.push(`${c.citation_in_top.citation} not in top ${c.citation_in_top.n}: ${top(c.citation_in_top.n).join(", ")}`);
  }
  if (c.citation_prefix_in_top && !top(c.citation_prefix_in_top.n).some((x) => x.startsWith(c.citation_prefix_in_top.prefix))) {
    fails.push(`no ${c.citation_prefix_in_top.prefix}… in top ${c.citation_prefix_in_top.n}: ${top(c.citation_prefix_in_top.n).join(", ")}`);
  }
  if (!/^Source: .*\(American Legal Publishing\)\./m.test(text)) fails.push("no source line");
  if (!/legal advice/i.test(text)) fails.push("no disclaimer");
  return fails;
}

const results = [];
for (const q of questions) {
  const fails = [];
  for (const s of q.steps) {
    const r = await callTool(s.tool, s.args);
    if (r.isError) fails.push(`${s.tool} error: ${r.content[0].text.split("\n")[0]}`);
    else fails.push(...check(r.content[0].text, s.check).map((f) => `${s.tool}: ${f}`));
  }
  results.push({ id: q.id, q: q.q, pass: fails.length === 0, fails });
  console.log(`${fails.length ? "FAIL" : "pass"}  ${q.id}  ${q.q}${fails.length ? `\n      ${fails.join("\n      ")}` : ""}`);
}
const passed = results.filter((r) => r.pass).length;
console.log(`\n${passed} of ${results.length} passed`);

if (process.argv.includes("--save")) {
  const day = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date());
  const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
  const out = { run_at: new Date().toISOString(), version: pkg.version, tools: TOOLS.length, index: getVersions(), passed, total: results.length, results };
  writeFileSync(new URL(`runs/${day}.json`, import.meta.url), JSON.stringify(out, null, 2) + "\n");
  console.log(`Saved eval/runs/${day}.json`);
}
process.exit(passed === results.length ? 0 : 1);
