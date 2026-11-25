// A small made-up American Legal source for the alt-text tests (issue #87): XML/ and IMAGES/
// in a temp folder, plus an index with the records the XML's sections start with. Shaped like
// the real files (LEVEL > RECORD > PARA > PICTURE; image file = picture id minus "-img").

import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { encodePng } from "../../scripts/lib/alt-text/image-info.js";

export function png(width, height, rgb = [200, 30, 30]) {
  const rgba = Buffer.alloc(width * height * 4);
  for (let i = 0; i < width * height; i++) rgba.set([...rgb, 255], i * 4);
  return encodePng({ width, height, rgba });
}

export function gif(width, height) {
  // Header and logical screen descriptor are all imageSize reads.
  const b = Buffer.alloc(32);
  b.write("GIF89a", 0, "latin1");
  b.writeUInt16LE(width, 6);
  b.writeUInt16LE(height, 8);
  return b;
}

export function jpeg(width, height) {
  // SOI, an APP0 segment, then SOF0 with the size.
  const app0 = Buffer.from([0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00]);
  const sof = Buffer.alloc(19);
  sof.set([0xff, 0xc0, 0x00, 0x11, 0x08]);
  sof.writeUInt16BE(height, 5);
  sof.writeUInt16BE(width, 7);
  return Buffer.concat([Buffer.from([0xff, 0xd8]), app0, sof, Buffer.from([0xff, 0xd9])]);
}

/** A 24-bit bottom-up BMP; pixels(x, y) → [r, g, b]. `short` drops bytes off the end. */
export function bmp24(width, height, pixels, short = 0) {
  const stride = Math.ceil((24 * width) / 32) * 4;
  const data = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y++) {
    const row = (height - 1 - y) * stride;
    for (let x = 0; x < width; x++) {
      const [r, g, b] = pixels(x, y);
      data.set([b, g, r], row + x * 3);
    }
  }
  const head = Buffer.alloc(54);
  head.write("BM", 0, "latin1");
  head.writeUInt32LE(54 + data.length, 2);
  head.writeUInt32LE(54, 10);
  head.writeUInt32LE(40, 14);
  head.writeInt32LE(width, 18);
  head.writeInt32LE(height, 22);
  head.writeUInt16LE(1, 26);
  head.writeUInt16LE(24, 28);
  head.writeUInt32LE(0, 30);
  const all = Buffer.concat([head, data]);
  return short ? all.subarray(0, all.length - short) : all;
}

export const XML = `﻿<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<DOCUMENT>
<LEVEL style-name="Chapter"><RECORD id="c1"><PARA>Chapter 1: Signs</PARA></RECORD>
  <LEVEL style-name="Section"><RECORD id="s1"><PARA>§ 1-01 Signs.</PARA></RECORD>
    <RECORD id="r2"><PARA><CHARFORMAT><TAB tab-count="1"/>(a)<TAB tab-count="1"/>An icon must appear next to the item: <HIGHLIGHTER>[ALP S-001]</HIGHLIGHTER></CHARFORMAT></PARA></RECORD>
    <RECORD id="r3"><PARA><PARAFORMAT><PICTURE id="0-0-0-1-img" name="Icon" width="10" height="10"/></PARAFORMAT></PARA></RECORD>
    <RECORD id="r4"><PARA><TAB tab-count="1"/>(b)<TAB tab-count="1"/>Post this: "Warning: <PICTURE id="0-0-0-1-img" name="Icon"/> means the item is salty."</PARA></RECORD>
    <RECORD id="r5"><PARA><PICTURE id="0-0-0-2-img" name="Map"/></PARA></RECORD>
  </LEVEL>
  <LEVEL style-name="Section"><RECORD id="s2"><PARA>§ 1-02 Copies.</PARA></RECORD>
    <RECORD id="r6"><PARA><PICTURE id="0-0-0-3-img" name="Map copy"/></PARA></RECORD>
    <RECORD id="r7"><PARA><PICTURE id="0-0-0-4-img" name="Bitmap 1"/></PARA></RECORD>
    <RECORD id="r8"><PARA><PICTURE id="0-0-0-9-img" name="Lost"/></PARA></RECORD>
  </LEVEL>
</LEVEL>
</DOCUMENT>
`;

export const INDEX = [
  { corpus: "rules", id: "c1", citation: "Chapter 1", heading: "Chapter 1: Signs", text: "", level: "Chapter" },
  { corpus: "rules", id: "s1", citation: "§ 1-01", heading: "§ 1-01 Signs.", text: "", level: "Section" },
  { corpus: "rules", id: "s2", citation: "§ 1-02", heading: "§ 1-02 Copies.", text: "", level: "Section" },
];

/**
 * Write the fixture: { root, source (the folder), indexDir, storeDir, files }. Images:
 * 0-0-0-1 PNG icon (used twice), 0-0-0-2 GIF map, 0-0-0-3 the same bytes as 0-0-0-2,
 * 0-0-0-4 a BMP beside an empty .gif twin, 0-0-0-7 a JPEG no tag uses, 0-0-0-9 missing.
 */
export function makeFixture() {
  const root = mkdtempSync(join(tmpdir(), "alt-text-"));
  const source = join(root, "rules");
  mkdirSync(join(source, "XML"), { recursive: true });
  mkdirSync(join(source, "IMAGES"), { recursive: true });
  writeFileSync(join(source, "XML", "0-0-0-1.xml"), XML);
  const files = {
    "0-0-0-1.png": png(4, 3),
    "0-0-0-2.gif": gif(300, 200),
    "0-0-0-3.gif": gif(300, 200),
    "0-0-0-4.bmp": bmp24(3, 2, (x, y) => [x * 100, y * 100, 50]),
    "0-0-0-4.gif": Buffer.alloc(0),
    "0-0-0-7.jpg": jpeg(640, 480),
    "0-0-0-1.rdf": Buffer.from("<folio-object-name>Icon</folio-object-name>"),
  };
  for (const [n, b] of Object.entries(files)) writeFileSync(join(source, "IMAGES", n), b);
  const indexDir = join(root, "index");
  mkdirSync(indexDir);
  writeFileSync(join(indexDir, "rules.json"), JSON.stringify(INDEX));
  const storeDir = join(root, "store");
  return { root, source, indexDir, storeDir, files };
}
