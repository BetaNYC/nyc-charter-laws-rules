// The alt-text tool's image facts and picture inventory (issue #87):
// scripts/lib/alt-text/image-info.js, source.js and inventory.js, on a made-up source.

import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { inflateSync } from "node:zlib";
import AdmZip from "adm-zip";
import { imageSize, sniffFormat, decodeBmp, encodePng, displayable, sha256 } from "../scripts/lib/alt-text/image-info.js";
import { openSource } from "../scripts/lib/alt-text/source.js";
import { buildInventory, loadIndex, parseCsv, compareWithMap, picturesInXml } from "../scripts/lib/alt-text/inventory.js";
import { makeFixture, png, gif, jpeg, bmp24 } from "./alt-text/fixture.js";

// --- image-info ---------------------------------------------------------------------------

test("imageSize reads PNG, GIF, JPEG and BMP headers", () => {
  assert.deepEqual(imageSize(png(4, 3)), { format: "png", width: 4, height: 3 });
  assert.deepEqual(imageSize(gif(300, 200)), { format: "gif", width: 300, height: 200 });
  assert.deepEqual(imageSize(jpeg(640, 480)), { format: "jpeg", width: 640, height: 480 });
  assert.deepEqual(imageSize(bmp24(3, 2, () => [0, 0, 0])), { format: "bmp", width: 3, height: 2 });
  assert.equal(imageSize(Buffer.from("not an image at all")), null);
  assert.equal(sniffFormat(Buffer.alloc(0)), null);
});

function pngPixels(buf) {
  // Our own encoder writes one IDAT, 8-bit RGBA, filter 0 on every row.
  const w = buf.readUInt32BE(16);
  const h = buf.readUInt32BE(20);
  const idatLen = buf.readUInt32BE(33);
  const raw = inflateSync(buf.subarray(41, 41 + idatLen));
  const px = (x, y) => [...raw.subarray(y * (w * 4 + 1) + 1 + x * 4, y * (w * 4 + 1) + 1 + x * 4 + 4)];
  return { w, h, px };
}

test("a BMP converts to a PNG with the same pixels, top row first", () => {
  const bmp = bmp24(3, 2, (x, y) => [x * 100, y * 100, 50]);
  const out = displayable(bmp);
  assert.equal(out.mediaType, "image/png");
  assert.equal(out.converted, true);
  const { w, h, px } = pngPixels(out.bytes);
  assert.deepEqual([w, h], [3, 2]);
  assert.deepEqual(px(0, 0), [0, 0, 50, 255]);
  assert.deepEqual(px(2, 1), [200, 100, 50, 255]);
});

test("a BMP short of its pixel bytes still decodes (rules 0-0-0-19658 is 12 bytes short)", () => {
  const bmp = bmp24(4, 4, () => [10, 20, 30], 12);
  const { width, height, rgba } = decodeBmp(bmp);
  assert.deepEqual([width, height], [4, 4]);
  // A BMP stores rows bottom-up, so the missing bytes are the top row: it reads as white.
  assert.deepEqual([...rgba.subarray(0, 4)], [255, 255, 255, 255]);
  assert.deepEqual([...rgba.subarray(4 * 4 * 3, 4 * 4 * 3 + 4)], [10, 20, 30, 255]);
});

test("a 32-bit BI_BITFIELDS BMP with no alpha bits reads as opaque", () => {
  const w = 2;
  const h = 1;
  const head = Buffer.alloc(66);
  head.write("BM", 0, "latin1");
  head.writeUInt32LE(66, 10);
  head.writeUInt32LE(40, 14);
  head.writeInt32LE(w, 18);
  head.writeInt32LE(h, 22);
  head.writeUInt16LE(1, 26);
  head.writeUInt16LE(32, 28);
  head.writeUInt32LE(3, 30);
  head.writeUInt32LE(0x00ff0000, 54);
  head.writeUInt32LE(0x0000ff00, 58);
  head.writeUInt32LE(0x000000ff, 62);
  const px = Buffer.from([0x30, 0x20, 0x10, 0x00, 0xfb, 0xfb, 0xfb, 0xff]);
  const { rgba } = decodeBmp(Buffer.concat([head, px]));
  assert.deepEqual([...rgba], [0x10, 0x20, 0x30, 255, 0xfb, 0xfb, 0xfb, 255]);
});

test("displayable passes JPEG, PNG and GIF through unchanged", () => {
  for (const [b, type] of [
    [png(1, 1), "image/png"],
    [gif(1, 1), "image/gif"],
    [jpeg(1, 1), "image/jpeg"],
  ]) {
    const out = displayable(b);
    assert.equal(out.mediaType, type);
    assert.equal(out.bytes, b);
  }
  assert.equal(encodePng({ width: 1, height: 1, rgba: Buffer.from([1, 2, 3, 4]) }).subarray(1, 4).toString(), "PNG");
});

// --- inventory ----------------------------------------------------------------------------

test("the inventory finds every picture tag, groups files by sha256, and skips unused files", () => {
  const fx = makeFixture();
  const inv = buildInventory("rules", openSource(fx.source), loadIndex("rules", fx.indexDir));
  assert.equal(inv.tags, 6);
  assert.equal(inv.images.length, 3, "0-0-0-1, 0-0-0-2 = 0-0-0-3 (same bytes), 0-0-0-4");
  assert.deepEqual(
    inv.images.map((i) => i.image_ids),
    [["0-0-0-1"], ["0-0-0-2", "0-0-0-3"], ["0-0-0-4"]],
  );
  assert.ok(!inv.images.some((i) => i.image_ids.includes("0-0-0-7")), "a file no tag uses is left out");
  assert.deepEqual(inv.missing.map((m) => m.picture_id), ["0-0-0-9-img"]);
  const icon = inv.images[0];
  assert.equal(icon.sha256, sha256(fx.files["0-0-0-1.png"]));
  assert.deepEqual([icon.format, icon.width, icon.height], ["png", 4, 3]);
  assert.equal(icon.uses.length, 2);
});

test("an image id with an empty twin uses the non-empty file", () => {
  const fx = makeFixture();
  const inv = buildInventory("rules", openSource(fx.source), loadIndex("rules", fx.indexDir));
  const b = inv.images.find((i) => i.image_ids.includes("0-0-0-4"));
  assert.equal(b.file, "IMAGES/0-0-0-4.bmp");
  assert.equal(b.format, "bmp");
});

test("each use names its section, says whether it sits in a sentence, and carries context", () => {
  const fx = makeFixture();
  const inv = buildInventory("rules", openSource(fx.source), loadIndex("rules", fx.indexDir));
  const [own, inline] = inv.images[0].uses;
  assert.equal(own.section_id, "s1");
  assert.equal(own.section_level, "Section");
  assert.equal(own.citation, "§ 1-01");
  assert.equal(own.record_id, "r3");
  assert.equal(own.inline, false);
  assert.equal(own.paragraph, "[this picture]");
  assert.match(own.before, /An icon must appear next to the item:$/);
  assert.ok(!own.before.includes("[ALP"), "publisher edit markers are stripped");
  assert.match(own.after, /^\(b\) Post this: "Warning: \[picture\] means the item is salty\."/);

  assert.equal(inline.inline, true);
  assert.equal(inline.paragraph, '(b) Post this: "Warning: [this picture] means the item is salty."');
  assert.match(inline.before, /\[picture\]\n\(b\) Post this: "Warning:$/);
  assert.match(inline.after, /^means the item is salty\."/);

  const copy = inv.images[1].uses.find((u) => u.picture_id === "0-0-0-3-img");
  assert.equal(copy.section_id, "s2");
  assert.equal(copy.citation, "§ 1-02");
});

test("context is cut to the window, at a word boundary, and marked with an ellipsis", () => {
  const words = Array.from({ length: 400 }, (_, i) => `word${i}`).join(" ");
  const xml = `<DOCUMENT><LEVEL style-name="Section"><RECORD id="s1"><PARA>${words} <PICTURE id="0-0-0-5-img"/> ${words}</PARA></RECORD></LEVEL></DOCUMENT>`;
  const [u] = picturesInXml(xml, "x.xml", new Map([["s1", { citation: "§ 1", heading: "", level: "Section" }]]), { contextChars: 100 });
  assert.ok(u.before.startsWith("…word"));
  assert.ok(u.before.length <= 102);
  assert.ok(u.after.endsWith("…"));
  assert.ok(u.after.length <= 102);
});

test("a zip source reads the same as the folder", () => {
  const fx = makeFixture();
  const zip = new AdmZip();
  zip.addLocalFolder(fx.source);
  const zipPath = join(fx.root, "rules.zip");
  zip.writeZip(zipPath);
  const idx = loadIndex("rules", fx.indexDir);
  const a = buildInventory("rules", openSource(fx.source), idx);
  const b = buildInventory("rules", openSource(zipPath), idx);
  assert.deepEqual(b, a);
});

test("compareWithMap agrees with a matching picture map and names each difference", () => {
  const fx = makeFixture();
  const inv = buildInventory("rules", openSource(fx.source), loadIndex("rules", fx.indexDir));
  const rows = [
    ...inv.images.flatMap((img) => img.uses.map((u) => ({ book: "rules", picture_id: u.picture_id, record_id: u.record_id, section_id: u.section_id, sha256: img.sha256 }))),
    ...inv.missing.map((u) => ({ book: "rules", picture_id: u.picture_id, record_id: u.record_id, section_id: u.section_id, sha256: "" })),
  ];
  assert.deepEqual(compareWithMap(inv, rows), []);
  const broken = rows.map((r, i) => (i === 0 ? { ...r, section_id: "elsewhere" } : r)).slice(0, -1);
  const diffs = compareWithMap(inv, broken);
  assert.ok(diffs.some((d) => d.startsWith("tags:")));
  assert.ok(diffs.some((d) => d.includes("section map elsewhere")));
  assert.ok(diffs.some((d) => d.startsWith("in inventory, not map")));
});

test("parseCsv handles quoted commas and doubled quotes", () => {
  const rows = parseCsv('a,b,c\n1,"x, y","he said ""hi"""\n2,,\n');
  assert.deepEqual(rows, [
    { a: "1", b: "x, y", c: 'he said "hi"' },
    { a: "2", b: "", c: "" },
  ]);
});
