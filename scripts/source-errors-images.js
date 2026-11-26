#!/usr/bin/env node
// CLI: copies the pictures named in data/source-errors.json out of American Legal Publishing's
// zips into data/source-errors/images/, so the errors page can show each one beside its error.
// The site's deploy builds without the zips ("the build fetches nothing"), so these few files are
// committed. Each file must match the sha256 its entry records; a mismatch stops with the entry's
// id, because it means the zip is not the one the error was found in.
//
//   npm run source-errors:images              reads data/raw/<book>.zip
//   node scripts/source-errors-images.js [--raw-dir <dir>]

import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, dirname, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { openSource } from "./lib/alt-text/source.js";
import { sha256 } from "./lib/alt-text/image-info.js";
import { parseSourceErrors } from "./lib/site/source-errors.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const rawDir = args[0] === "--raw-dir" && args[1] ? args[1] : join(ROOT, "data", "raw");
const file = join(ROOT, "data", "source-errors.json");
const outDir = join(ROOT, "data", "source-errors", "images");
const { errors } = parseSourceErrors(readFileSync(file, "utf8"), file);

const sources = new Map();
const source = (book) => {
  if (!sources.has(book)) sources.set(book, openSource(join(rawDir, `${book}.zip`)));
  return sources.get(book);
};
mkdirSync(outDir, { recursive: true });
let wrote = 0, kept = 0;
for (const e of errors) {
  for (const i of e.evidence.images) {
    const dest = join(outDir, basename(i.file));
    if (existsSync(dest) && sha256(readFileSync(dest)) === i.sha256) { kept++; continue; }
    const f = source(e.book).imageFile(i.image_id);
    if (!f) throw new Error(`${e.id}: ${i.file} is not in ${join(rawDir, `${e.book}.zip`)}`);
    if (sha256(f.bytes) !== i.sha256) throw new Error(`${e.id}: ${i.file} in the zip does not match the sha256 the entry records`);
    writeFileSync(dest, f.bytes);
    wrote++;
  }
}
console.log(`data/source-errors/images: wrote ${wrote}, already there ${kept}`);
