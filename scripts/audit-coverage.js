#!/usr/bin/env node
// CLI: how much of the publisher's XML reaches the index, per book, and every piece that does not
// (issue #78). Reads the ZIPs in data/raw/ (npm run fetch-data puts them there); never fetches.
//
//   npm run audit:coverage                       all three books
//   node scripts/audit-coverage.js [--raw-dir DIR] [--check] [--all] [charter|admin_code|rules ...]
//
// For each book: characters in the XML (no whitespace, edit markers removed), the share in the
// index, and the dropped text by reason (scripts/lib/coverage.js explains the reasons). Then every
// unread piece of text: file, record, where it sits, size and its first words. Unread text is a
// bug: it is law text the MCP server and the website do not have.
//
//   --check   exit 1 when any text is unread, or read into two records (for a refresh or a release)
//   --all     list every unread text node, not one line per file and place

import AdmZip from "adm-zip";
import { existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { coverFile, emptyTally, percentages } from "./lib/coverage.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const CORPORA = { charter: "charter.zip", admin_code: "admin_code.zip", rules: "rules.zip" };

function parseArgs(argv) {
  const opts = { rawDir: join(ROOT, "data", "raw"), check: false, all: false, books: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--raw-dir") opts.rawDir = argv[++i];
    else if (a === "--check") opts.check = true;
    else if (a === "--all") opts.all = true;
    else if (a === "--help" || a === "-h") {
      console.log("Usage: node scripts/audit-coverage.js [--raw-dir DIR] [--check] [--all] [charter|admin_code|rules ...]");
      process.exit(0);
    } else if (CORPORA[a]) opts.books.push(a);
    else throw new Error(`unknown option or book "${a}"`);
  }
  if (!opts.rawDir) throw new Error("--raw-dir needs a value");
  if (!opts.books.length) opts.books = Object.keys(CORPORA);
  return opts;
}

const n = (x) => x.toLocaleString("en-US");
const pct = (x) => `${x.toFixed(2)}%`;
const snip = (s, k = 110) => (s.length > k ? `${s.slice(0, k)}…` : s);

function main() {
  const opts = parseArgs(process.argv.slice(2));
  let unreadTotal = 0;
  for (const corpus of opts.books) {
    const zipPath = join(opts.rawDir, CORPORA[corpus]);
    if (!existsSync(zipPath)) throw new Error(`${zipPath} is missing. Run npm run fetch-data first, or pass --raw-dir.`);
    const tally = emptyTally();
    const entries = new AdmZip(zipPath).getEntries().filter((e) => e.entryName.startsWith("XML/") && e.entryName.endsWith(".xml"));
    for (const e of entries) coverFile(e.getData().toString("utf8"), corpus, e.entryName.replace(/^XML\//, ""), tally);
    const p = percentages(tally);
    const d = tally.dropped;
    console.log(`\n${corpus}: ${n(tally.files)} files, ${n(tally.records)} index records`);
    console.log(`  source text        ${n(tally.chars)} characters (no whitespace; ${n(tally.alpChars)} more in edit markers, removed)`);
    console.log(`  in the index       ${n(tally.text)} in text, ${n(tally.heading)} in headings: ${pct(p.indexed)} of the source, ${pct(p.indexedNet)} once repeats are taken out`);
    console.log(`  left out on purpose  repeats ${n(d.repeat)}, group headings ${n(d["group heading"])}, title-level text ${n(d.title)}`);
    console.log(`  UNREAD             ${n(d.unread)} characters (${pct(p.unreadNet)}) in ${n(tally.unread.length)} text nodes`);
    console.log(`  read twice         ${n(tally.twice)} text nodes in the text of two records (must be 0)`);
    console.log(`  pictures           ${n(tally.pictures.indexed)} in index records, ${n(tally.pictures.dropped)} outside them (no text in the XML either way)`);
    unreadTotal += d.unread + tally.twice;
    if (!tally.unread.length) continue;
    if (opts.all) {
      for (const u of tally.unread) console.log(`    ${u.file} record ${u.record ?? "-"}: ${u.where}: ${u.chars} chars: ${snip(u.text)}`);
      continue;
    }
    const groups = new Map();
    for (const u of tally.unread) {
      const k = `${u.file} | ${u.where}`;
      const g = groups.get(k) ?? { chars: 0, nodes: 0, records: new Set(), sample: u.text };
      g.chars += u.chars;
      g.nodes++;
      g.records.add(u.record);
      groups.set(k, g);
    }
    for (const [k, g] of [...groups].sort((a, b) => b[1].chars - a[1].chars)) {
      console.log(`    ${k}: ${n(g.chars)} chars, ${g.nodes} nodes, ${g.records.size} records: ${snip(g.sample)}`);
    }
  }
  if (opts.check && unreadTotal > 0) {
    console.error(`\naudit-coverage: some source text is not in the index, or is in it twice (see above).`);
    process.exit(1);
  }
}

try {
  main();
} catch (e) {
  console.error(`audit-coverage: ${e.message}`);
  process.exit(2);
}
