// The committed pictures for /describe-pictures/ (data/pictures/, npm run alt:images, issue #87)
// against the committed books (npm run test:site-data, before a deploy): every stored picture
// matches its inventory, no stored file is left over, and every place a picture is used is a
// section page the site has, so its "Read ... on the Law Reader" link opens that page. Kept out
// of npm test, which the daily refresh runs: a surprise here stops the deploy, never the refresh.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { loadBook, rulesReady } from "../../scripts/lib/site/model.js";
import { loadPictures, IMAGES_DIR } from "../../scripts/lib/alt-text/pictures.js";
import { sniffFormat } from "../../scripts/lib/alt-text/image-info.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const INDEX = join(ROOT, "data", "index", "json");
const STRUCTURE = join(ROOT, "data", "structure");
const PICTURES = join(ROOT, "data", "pictures");
const VERSIONS = JSON.parse(readFileSync(join(INDEX, "versions.json"), "utf8"));
const BOOKS = ["admin_code", "rules"];

function loadReal(corpus) {
  if (!existsSync(join(STRUCTURE, `${corpus}.json`))) return null;
  const indexText = readFileSync(join(INDEX, `${corpus}.json`), "utf8");
  const structure = JSON.parse(readFileSync(join(STRUCTURE, `${corpus}.json`), "utf8"));
  if (structure.indexSha256 !== createHash("sha256").update(indexText).digest("hex")) return null;
  if (corpus === "rules" && !rulesReady(JSON.parse(indexText))) return null;
  return loadBook({ corpus, indexJsonText: indexText, structure, versions: VERSIONS });
}

const pictures = loadPictures(PICTURES, BOOKS);

test("every committed picture matches its inventory, and no stored file is left over", () => {
  // loadPictures above already checked each file's sha256.
  const named = new Set(pictures.inventories.flatMap((inv) => inv.images.map((i) => i.shown.file)));
  const stored = readdirSync(join(PICTURES, IMAGES_DIR));
  assert.deepEqual(stored.filter((f) => !named.has(f)), [], "files in data/pictures/images/ no inventory names: run npm run alt:images");
  assert.equal(named.size, stored.length);
  for (const inv of pictures.inventories) {
    assert.ok(inv.images.length > 0, `${inv.book} has pictures`);
    for (const i of inv.images) {
      const bytes = readFileSync(pictures.fileFor(i));
      const format = sniffFormat(bytes);
      assert.ok(["jpeg", "png", "gif", "webp"].includes(format), `${i.shown.file} is a format browsers show (${format})`);
      if (i.format === "bmp") assert.equal(format, "png", `${i.image_ids[0]}: the BMP is stored as PNG`);
    }
  }
  // GitHub Pages allows 1 GB for the whole site; the pictures are about 44 MB.
  assert.ok(pictures.bytes < 150 * 1024 * 1024, `the pictures are ${(pictures.bytes / 1048576).toFixed(1)} MB`);
});

test("every use of a picture is in a section page the site has", () => {
  for (const inv of pictures.inventories) {
    const book = loadReal(inv.book);
    if (!book) continue; // a book the committed data cannot build
    const lost = [];
    for (const i of inv.images) for (const u of i.uses) if (!book.byId.get(u.section_id)?.path) lost.push(`${u.picture_id} (${u.citation}, section ${u.section_id})`);
    assert.deepEqual(lost, [], `${inv.book}: pictures in sections the site does not have; run npm run alt:images on the zips the index was built from`);
  }
});
