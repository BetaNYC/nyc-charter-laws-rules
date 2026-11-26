// The pictures the Law Reader's picture description page shows (issue #87), committed to the
// repo so the site's deploy can build the page without American Legal Publishing's zips ("the
// build fetches nothing", as with data/source-errors/images/).
//
// `npm run alt:images` writes, from data/raw/<book>.zip and the committed index:
//   data/pictures/images/<sha256>.<ext>  every picture a <PICTURE> tag uses, once per distinct
//                                        image, named by the sha256 of the zip's file. BMPs are
//                                        stored as PNG (image-info.js displayable), so a BMP's
//                                        stored file has its own sha256 (`shown.sha256`).
//   data/pictures/<book>.json            the book's inventory (inventory.js): each image's ids,
//                                        size and uses (citation, section, the text around it),
//                                        plus the stored file's name, bytes and sha256.
// Files in images/ that no image uses any more are removed; nothing else in the folder is
// touched. The same zips and index give byte-identical output, so the daily refresh commits only
// a real change.
//
// The site build reads the inventories back with loadPictures, which stops with the command to
// run when a picture is missing or does not match its inventory.

import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { displayable, sha256 } from "./image-info.js";
import { imageBytes } from "./inventory.js";

export const PICTURES_FORMAT = 1;
export const IMAGES_DIR = "images";
const STORED_NAME = /^[0-9a-f]{64}\.(?:jpg|png|gif|webp)$/;

const ABOUT =
  "The pictures American Legal Publishing's XML uses in this book, for the Law Reader's picture description page (/describe-pictures/). The image files are the publisher's, from its zip, unchanged except that BMP files are stored as PNG. Written by npm run alt:images; do not edit by hand.";

/** The inventory as stored: no bytes, the stored file added to each image. */
function manifest(inv, shownFor) {
  return {
    about: ABOUT,
    book: inv.book,
    format: PICTURES_FORMAT,
    tags: inv.tags,
    images: inv.images.map((i) => ({
      sha256: i.sha256,
      image_ids: i.image_ids,
      file: i.file,
      format: i.format,
      width: i.width,
      height: i.height,
      bytes: i.bytes,
      shown: shownFor.get(i.sha256).meta,
      uses: i.uses,
    })),
    missing: inv.missing.map((u) => ({ picture_id: u.picture_id, image_id: u.image_id, citation: u.citation, section_id: u.section_id })),
  };
}

/**
 * Write the pictures and inventories for these books into outDir. Every image is read and
 * converted before anything is written, so a picture that cannot be read leaves the folder as
 * it was. Returns { books: { book: { images, tags, missing } }, written, kept, removed, files, bytes }.
 */
export function writePictures({ inventories, sources, outDir }) {
  const shown = new Map();
  for (const inv of inventories) {
    for (const image of inv.images) {
      if (shown.has(image.sha256)) continue;
      const d = displayable(imageBytes(sources[inv.book], image));
      const name = `${image.sha256}.${d.ext}`;
      shown.set(image.sha256, { bytes: d.bytes, meta: { file: name, sha256: d.converted ? sha256(d.bytes) : image.sha256, bytes: d.bytes.length, ...(d.converted ? { converted_from: image.format } : {}) } });
    }
  }
  const imagesDir = join(outDir, IMAGES_DIR);
  mkdirSync(imagesDir, { recursive: true });
  let written = 0;
  let kept = 0;
  let bytes = 0;
  const wanted = new Set();
  for (const { bytes: b, meta } of shown.values()) {
    wanted.add(meta.file);
    bytes += b.length;
    const dest = join(imagesDir, meta.file);
    if (existsSync(dest) && sha256(readFileSync(dest)) === meta.sha256) {
      kept++;
      continue;
    }
    writeFileSync(dest, b);
    written++;
  }
  let removed = 0;
  for (const name of readdirSync(imagesDir)) {
    if (STORED_NAME.test(name) && !wanted.has(name)) {
      rmSync(join(imagesDir, name));
      removed++;
    }
  }
  const books = {};
  for (const inv of inventories) {
    writeFileSync(join(outDir, `${inv.book}.json`), `${JSON.stringify(manifest(inv, shown), null, 2)}\n`);
    books[inv.book] = { images: inv.images.length, tags: inv.tags, missing: inv.missing.length };
  }
  return { books, written, kept, removed, files: shown.size, bytes };
}

/**
 * Read the committed inventories for these books and check every stored picture against its
 * sha256. Returns { inventories, fileFor(image) → absolute path, files, bytes }. A missing
 * inventory or picture, or one that does not match, throws with the command that makes them.
 */
export function loadPictures(dir, books) {
  const fix = "Run npm run alt:images (it reads data/raw/<book>.zip from npm run fetch-data) and commit data/pictures/.";
  const inventories = [];
  const paths = new Map();
  let bytes = 0;
  for (const book of books) {
    const file = join(dir, `${book}.json`);
    if (!existsSync(file)) throw new Error(`the picture inventory ${file} is missing. ${fix}`);
    const m = JSON.parse(readFileSync(file, "utf8"));
    if (m.format !== PICTURES_FORMAT || m.book !== book || !Array.isArray(m.images)) throw new Error(`${file} is not a format ${PICTURES_FORMAT} picture inventory for ${book}. ${fix}`);
    for (const image of m.images) {
      const name = image.shown?.file;
      if (!name || !STORED_NAME.test(name)) throw new Error(`${file}: picture ${image.sha256} names no stored file. ${fix}`);
      if (!paths.has(image.sha256)) {
        const path = join(dir, IMAGES_DIR, name);
        if (!existsSync(path)) throw new Error(`${book}: the picture ${name} (${image.image_ids.join(", ")}) is not in ${join(dir, IMAGES_DIR)}. ${fix}`);
        const b = readFileSync(path);
        if (sha256(b) !== image.shown.sha256) throw new Error(`${book}: ${path} does not match the sha256 in ${file}. ${fix}`);
        paths.set(image.sha256, path);
        bytes += b.length;
      }
    }
    inventories.push({ book, tags: m.tags, images: m.images, missing: m.missing ?? [] });
  }
  return { inventories, fileFor: (image) => paths.get(image.sha256), files: paths.size, bytes };
}
