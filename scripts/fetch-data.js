#!/usr/bin/env node
// Downloads and unzips the three AML bulk XML files into data/raw/.
// Run once before starting the server: npm run fetch-data

import { createWriteStream, mkdirSync } from "fs";
import { pipeline } from "stream/promises";
import { createGunzip } from "zlib";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

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

for (const source of SOURCES) {
  console.log(`Downloading ${source.name}...`);
  const dest = join(DATA_DIR, `${source.name}.zip`);
  const response = await fetch(source.url);
  if (!response.ok) {
    console.error(`Failed to fetch ${source.name}: ${response.status}`);
    continue;
  }
  await pipeline(response.body, createWriteStream(dest));
  console.log(`  Saved to ${dest}`);
}

console.log("\nDone. Unzip each file in data/raw/ to access the XML source files.");
console.log("XML parsing and indexing — coming soon.");
