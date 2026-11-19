#!/usr/bin/env node
// Runs eval/questions.json against the built server (dist/), offline, and prints one line per
// question. `--save` writes the results to eval/runs/YYYY-MM-DD.json (New York date), or, when
// that file exists, YYYY-MM-DD-2.json and so on: an earlier run is never overwritten.
// `--save=NAME` writes eval/runs/YYYY-MM-DD-NAME.json (same rule). `--note=TEXT` stores TEXT as
// the run's `note`, written before the results are seen when it says what the run is for.
// Exit 1 if any question fails. Usage: npm run eval [-- --save[=NAME] [--note=TEXT]]

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { callTool, TOOLS } from "../dist/tools.js";
import { getVersions } from "../dist/corpus.js";

const { questions } = JSON.parse(readFileSync(new URL("questions.json", import.meta.url), "utf8"));
const citations = (text) => [...text.matchAll(/^\[(?:CHARTER|ADMIN_CODE|RULES)\] (.+?) — /gm)].map((m) => m[1]);
// The same, with the corpus: "admin_code § 24-163".
const sections = (text) => [...text.matchAll(/^\[(CHARTER|ADMIN_CODE|RULES)\] (.+?) — /gm)].map((m) => `${m[1].toLowerCase()} ${m[2]}`);

function check(text, c) {
  const fails = [];
  const top = (n) => citations(text).slice(0, n);
  if (c.heading && !text.toLowerCase().includes(c.heading.toLowerCase())) fails.push(`heading "${c.heading}" not found`);
  if (c.contains && !text.includes(c.contains)) fails.push(`"${c.contains}" not found`);
  for (const s of c.contains_all ?? []) if (!text.includes(s)) fails.push(`"${s}" not found`);
  if (c.section_in_top) {
    const { n, corpus, citation } = c.section_in_top;
    const got = sections(text).slice(0, n);
    if (!got.includes(`${corpus} ${citation}`)) fails.push(`${corpus} ${citation} not in top ${n}: ${got.join(", ")}`);
  }
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

const arg = (name) => {
  const a = process.argv.find((x) => x === `--${name}` || x.startsWith(`--${name}=`));
  return a === undefined ? undefined : a.slice(name.length + 3);
};
const save = arg("save");
if (save !== undefined) {
  const day = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date());
  const base = save ? `${day}-${save.replace(/[^\w.-]/g, "-")}` : day;
  let name = `${base}.json`;
  for (let i = 2; existsSync(new URL(`runs/${name}`, import.meta.url)); i++) name = `${base}-${i}.json`;
  const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
  const note = arg("note");
  const out = { ...(note ? { note } : {}), run_at: new Date().toISOString(), version: pkg.version, tools: TOOLS.length, index: getVersions(), passed, total: results.length, results };
  writeFileSync(new URL(`runs/${name}`, import.meta.url), JSON.stringify(out, null, 2) + "\n", { flag: "wx" });
  console.log(`Saved eval/runs/${name}`);
}
process.exit(passed === results.length ? 0 : 1);
