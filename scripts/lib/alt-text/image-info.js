// Image facts for the alt-text tool (issue #87): format, pixel size and sha256 of a picture
// file from American Legal Publishing's zip, read from the file's own header bytes, with no
// image library. Also converts the zip's few BMP files to PNG, because the Messages API and
// browsers' <img> handling disagree on BMP, and the API takes only JPEG, PNG, GIF and WebP
// ("Supported formats", https://platform.claude.com/docs/en/build-with-claude/vision, read
// 2026-11-25).
//
// The used pictures (July 2026 zips) are 332 JPEG, 105 GIF, 42 PNG and 2 BMP. One BMP
// (rules 0-0-0-19658, the DEP logo) is a 32-bit BI_BITFIELDS file 12 bytes short of its
// declared pixel data; decodeBmp pads the missing bytes with white rather than refusing it.

import { createHash } from "node:crypto";
import { deflateSync } from "node:zlib";

export function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

/** The format of an image from its first bytes: "jpeg" | "png" | "gif" | "bmp" | "webp" | null. */
export function sniffFormat(b) {
  if (!b || b.length < 12) return null;
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "jpeg";
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return "png";
  if (b.toString("latin1", 0, 4) === "GIF8") return "gif";
  if (b[0] === 0x42 && b[1] === 0x4d) return "bmp";
  if (b.toString("latin1", 0, 4) === "RIFF" && b.toString("latin1", 8, 12) === "WEBP") return "webp";
  return null;
}

export const MEDIA_TYPES = { jpeg: "image/jpeg", png: "image/png", gif: "image/gif", webp: "image/webp", bmp: "image/bmp" };

function jpegSize(b) {
  let i = 2;
  while (i + 9 < b.length) {
    if (b[i] !== 0xff) {
      i++;
      continue;
    }
    const marker = b[i + 1];
    // Fill bytes and markers with no length.
    if (marker === 0xff) {
      i++;
      continue;
    }
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      i += 2;
      continue;
    }
    const len = b.readUInt16BE(i + 2);
    // SOF0..SOF15, except DHT (C4), JPG (C8) and DAC (CC).
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return { width: b.readUInt16BE(i + 7), height: b.readUInt16BE(i + 5) };
    }
    i += 2 + len;
  }
  return null;
}

/** { format, width, height } read from the header, or null when the bytes are not an image. */
export function imageSize(b) {
  const format = sniffFormat(b);
  if (!format) return null;
  let wh = null;
  if (format === "png") wh = { width: b.readUInt32BE(16), height: b.readUInt32BE(20) };
  else if (format === "gif") wh = { width: b.readUInt16LE(6), height: b.readUInt16LE(8) };
  else if (format === "bmp") wh = { width: b.readInt32LE(18), height: Math.abs(b.readInt32LE(22)) };
  else if (format === "jpeg") wh = jpegSize(b);
  else if (format === "webp") {
    const chunk = b.toString("latin1", 12, 16);
    if (chunk === "VP8X") wh = { width: 1 + b.readUIntLE(24, 3), height: 1 + b.readUIntLE(27, 3) };
    else if (chunk === "VP8L") {
      const bits = b.readUInt32LE(21);
      wh = { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
    } else if (chunk === "VP8 ") wh = { width: b.readUInt16LE(26) & 0x3fff, height: b.readUInt16LE(28) & 0x3fff };
  }
  if (!wh) return { format, width: null, height: null };
  return { format, ...wh };
}

// --- BMP to PNG -------------------------------------------------------------------------

function maskShift(mask) {
  if (!mask) return { shift: 0, bits: 0 };
  let shift = 0;
  while (((mask >>> shift) & 1) === 0) shift++;
  let bits = 0;
  while (((mask >>> (shift + bits)) & 1) === 1) bits++;
  return { shift, bits };
}

function channel(px, m) {
  if (!m.bits) return null;
  const v = (px >>> m.shift) & ((1 << m.bits) - 1);
  return m.bits === 8 ? v : Math.round((v * 255) / ((1 << m.bits) - 1));
}

/**
 * Decode an uncompressed BMP (1, 4, 8, 24 or 32 bits; BI_RGB or BI_BITFIELDS) into RGBA.
 * Missing trailing pixel bytes read as white. Throws on compressed BMPs (RLE), which the
 * zips do not use.
 */
export function decodeBmp(b) {
  if (sniffFormat(b) !== "bmp") throw new Error("not a BMP file");
  const dataOffset = b.readUInt32LE(10);
  const headerSize = b.readUInt32LE(14);
  const width = b.readInt32LE(18);
  const rawHeight = b.readInt32LE(22);
  const height = Math.abs(rawHeight);
  const topDown = rawHeight < 0;
  const bpp = b.readUInt16LE(28);
  const compression = headerSize >= 40 ? b.readUInt32LE(30) : 0;
  if (compression !== 0 && compression !== 3) throw new Error(`BMP compression ${compression} is not supported`);
  if (width <= 0 || height <= 0 || width > 20000 || height > 20000) throw new Error("BMP size out of range");

  let masks = null;
  if (compression === 3) {
    // The three masks follow a 40-byte header, or sit inside a V4/V5 header at the same place.
    const at = 14 + 40;
    masks = [b.readUInt32LE(at), b.readUInt32LE(at + 4), b.readUInt32LE(at + 8)];
    const alphaMask = headerSize >= 56 ? b.readUInt32LE(at + 12) : 0;
    masks.push(alphaMask);
  } else if (bpp === 32) masks = [0x00ff0000, 0x0000ff00, 0x000000ff, 0];
  else if (bpp === 16) masks = [0x7c00, 0x03e0, 0x001f, 0];
  const m = masks ? masks.map(maskShift) : null;

  let palette = null;
  if (bpp <= 8) {
    const colors = (headerSize >= 40 ? b.readUInt32LE(46) : 0) || 1 << bpp;
    palette = [];
    for (let i = 0; i < colors; i++) {
      const p = 14 + headerSize + i * 4;
      palette.push([b[p + 2], b[p + 1], b[p]]);
    }
  }

  const stride = Math.ceil((bpp * width) / 32) * 4;
  const byteAt = (i) => (i < b.length ? b[i] : 0xff);
  const rgba = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y++) {
    const srcRow = topDown ? y : height - 1 - y;
    const row = dataOffset + srcRow * stride;
    for (let x = 0; x < width; x++) {
      let r, g, bl, a = 255;
      if (bpp === 24) {
        const p = row + x * 3;
        bl = byteAt(p);
        g = byteAt(p + 1);
        r = byteAt(p + 2);
      } else if (bpp === 32 || bpp === 16) {
        const size = bpp / 8;
        const p = row + x * size;
        let px = 0;
        for (let k = size - 1; k >= 0; k--) px = px * 256 + byteAt(p + k);
        r = channel(px, m[0]);
        g = channel(px, m[1]);
        bl = channel(px, m[2]);
        const al = channel(px, m[3]);
        if (al !== null) a = al;
      } else if (bpp <= 8) {
        const bitPos = x * bpp;
        const byte = byteAt(row + (bitPos >> 3));
        const idx = (byte >> (8 - bpp - (bitPos & 7))) & ((1 << bpp) - 1);
        [r, g, bl] = palette[idx] ?? [0, 0, 0];
      } else throw new Error(`BMP depth ${bpp} is not supported`);
      const o = (y * width + x) * 4;
      rgba[o] = r;
      rgba[o + 1] = g;
      rgba[o + 2] = bl;
      rgba[o + 3] = a;
    }
  }
  // An alpha mask that is zero everywhere means the file never meant to be transparent.
  let anyAlpha = false;
  for (let o = 3; o < rgba.length; o += 4) if (rgba[o] !== 0) anyAlpha = true;
  if (!anyAlpha) for (let o = 3; o < rgba.length; o += 4) rgba[o] = 255;
  return { width, height, rgba };
}

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, "latin1"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

/** Encode RGBA pixels as a PNG (8-bit RGBA, no filtering). */
export function encodePng({ width, height, rgba }) {
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0;
    rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", deflateSync(raw)),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

/**
 * The bytes to show or send for a picture: the file itself when the API and browsers take its
 * format, a PNG when it is a BMP. { bytes, mediaType, ext, converted }.
 */
export function displayable(bytes) {
  const format = sniffFormat(bytes);
  if (format === "bmp") return { bytes: encodePng(decodeBmp(bytes)), mediaType: "image/png", ext: "png", converted: true };
  if (!format) throw new Error("unknown image format");
  return { bytes, mediaType: MEDIA_TYPES[format], ext: format === "jpeg" ? "jpg" : format, converted: false };
}
