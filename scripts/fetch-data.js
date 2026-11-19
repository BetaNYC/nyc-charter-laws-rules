#!/usr/bin/env node
// Downloads and unzips the three AML bulk XML files into data/raw/.
// Run once before starting the server: npm run fetch-data

import { createWriteStream, mkdirSync } from "fs";
import { pipeline } from "stream/promises";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { politeFetch } from "./lib/fetch-retry.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, "..", "data", "raw");

const SOURCES = [
  {
    name: "charter",
    url: "http://files.amlegal.com/pdffiles/NewYorkCity/Charter/XML.zip",
  },
  {
    name: "admin_code",
    url: "http://files.amlegal.com/pdffiles/NewYorkCity/Admin/XML.zip",
  },
  {
    name: "rules",
    url: "http://files.amlegal.com/pdffiles/NewYorkCity/Rules/XML.zip",
  },
];

mkdirSync(DATA_DIR, { recursive: true });

// A failed download fails the run (issue #39): carrying on would build an index with a
// document missing.
for (const source of SOURCES) {
  console.log(`Downloading ${source.name}...`);
  const dest = join(DATA_DIR, `${source.name}.zip`);
  const response = await politeFetch(source.url);
  if (!response.ok) {
    console.error(`Failed to fetch ${source.name}: HTTP ${response.status} from ${source.url}`);
    process.exit(1);
  }
  await pipeline(response.body, createWriteStream(dest));
  console.log(`  Saved to ${dest}`);
}

console.log("\nDone. Unzip each file in data/raw/ to access the XML source files.");
