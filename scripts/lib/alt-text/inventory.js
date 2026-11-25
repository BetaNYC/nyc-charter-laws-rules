// The picture inventory for the alt-text tool (issue #87): every <PICTURE> tag American Legal
// Publishing's XML uses, the image file it shows, the Law Reader section that holds it, and
// the text around it.
//
// How a tag maps to a file (checked 2026-11-25 for all 507 tags in the July 2026 zips, two
// ways; workspace journal 2026-11-25-law-reader-images-alt-text.md): the tag id minus "-img"
// is the file name in IMAGES/ (`0-0-0-266-img` → `IMAGES/0-0-0-266.png`). Files no tag uses
// (285 of them) are left out.
//
// The section is the innermost LEVEL around the picture whose head RECORD is a record in the
// index (data/index/json/<book>.json), or else the picture's own RECORD when that is indexed.
//
// The context is the section's text with the picture's place marked, cut to a window before
// and after it, plus the whole paragraph the picture sits in. A picture is "inline" when its
// paragraph has words besides pictures: Rules § 81.49's warning reads "Warning: [icon]
// indicates that the sodium (salt) content...", so its alt text has to read as part of that
// sentence.
//
// The inventory is rebuilt from the source each time a command runs. It is not stored: the
// sidecar files in data/alt-text/ hold only what BetaNYC writes.

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { makeParser, tagOf, getAttr, normalize } from "../extract-text.js";
import { imageSize, sha256 } from "./image-info.js";

export const CONTEXT_CHARS = 700;

const MARK_OPEN = "";
const MARK_CLOSE = "";
const MARK = /(\d+)/g;

/** id → { citation, heading, level } from data/index/json/<book>.json. */
export function loadIndex(book, indexDir) {
  const file = join(indexDir, `${book}.json`);
  if (!existsSync(file)) throw new Error(`Index not found: ${file}`);
  const rows = JSON.parse(readFileSync(file, "utf8"));
  const byId = new Map();
  for (const r of rows) byId.set(r.id, { citation: r.citation ?? "", heading: r.heading ?? "", level: r.level ?? "" });
  return byId;
}

function kidsOf(node) {
  const k = node[tagOf(node)];
  return Array.isArray(k) ? k : [];
}

// A paragraph's text, with each picture replaced by a numbered marker.
function markedText(nodes, numberOf) {
  let s = "";
  for (const node of nodes) {
    if ("#text" in node) {
      s += String(node["#text"]);
      continue;
    }
    const tag = tagOf(node);
    if (!tag) continue;
    if (tag === "TAB" || tag === "LINEBRK") s += " ";
    else if (tag === "PICTURE") s += numberOf.has(node) ? `${MARK_OPEN}${numberOf.get(node)}${MARK_CLOSE}` : "";
    else if (tag === "PARA") s += ` ${markedText(kidsOf(node), numberOf)} `;
    else s += markedText(kidsOf(node), numberOf);
  }
  return s;
}

function collectParas(node, numberOf, out) {
  const tag = tagOf(node);
  if (!tag) return;
  if (tag === "PARA") {
    out.push(normalize(markedText(kidsOf(node), numberOf)));
    return;
  }
  for (const k of kidsOf(node)) collectParas(k, numberOf, out);
}

const unmark = (s, own) =>
  s.replace(MARK, (_, n) => (Number(n) === own ? "[this picture]" : "[picture]")).replace(/\s+\n/g, "\n");

function clipStart(s, n) {
  if (s.length <= n) return s.trimStart();
  const cut = s.slice(s.length - n);
  const sp = cut.search(/\s/);
  return `…${sp >= 0 ? cut.slice(sp + 1) : cut}`;
}

function clipEnd(s, n) {
  if (s.length <= n) return s.trimEnd();
  const cut = s.slice(0, n);
  const sp = cut.lastIndexOf(" ");
  return `${sp > 0 ? cut.slice(0, sp) : cut}…`;
}

/**
 * Every <PICTURE> in one XML file, as uses: { picture_id, image_id, name, xml_file,
 * record_id, section_id, section_level, citation, heading, inline, paragraph, before, after }.
 */
export function picturesInXml(xml, xmlFile, index, { contextChars = CONTEXT_CHARS } = {}) {
  if (!xml.includes("<PICTURE")) return [];
  const tree = makeParser().parse(xml);
  const found = [];
  const numberOf = new Map();

  const walk = (nodes, levels, record, para) => {
    for (const node of nodes) {
      const tag = tagOf(node);
      if (!tag) continue;
      let lv = levels;
      let rec = record;
      let p = para;
      if (tag === "LEVEL") {
        const head = kidsOf(node).find((k) => tagOf(k) === "RECORD");
        lv = [...levels, { node, style: getAttr(node, "style-name"), headId: head ? getAttr(head, "id") : null }];
      } else if (tag === "RECORD") rec = { node, id: getAttr(node, "id") };
      else if (tag === "PARA" && !para) p = node;
      else if (tag === "PICTURE") {
        let owner = null;
        for (let i = lv.length - 1; i >= 0; i--) {
          if (lv[i].headId && index.has(lv[i].headId)) {
            owner = { node: lv[i].node, id: lv[i].headId, level: lv[i].style };
            break;
          }
        }
        if (!owner && rec && index.has(rec.id)) owner = { node: rec.node, id: rec.id, level: "Record" };
        const n = found.length;
        numberOf.set(node, n);
        found.push({ node, owner, record: rec?.id ?? null, para: p });
      }
      walk(kidsOf(node), lv, rec, p);
    }
  };
  walk(tree, [], null, null);

  const ownerText = new Map();
  const textFor = (owner) => {
    if (!ownerText.has(owner.node)) {
      const paras = [];
      collectParas(owner.node, numberOf, paras);
      ownerText.set(owner.node, paras.filter(Boolean).join("\n"));
    }
    return ownerText.get(owner.node);
  };

  return found.map((f, n) => {
    const id = getAttr(f.node, "id");
    const mark = `${MARK_OPEN}${n}${MARK_CLOSE}`;
    const paraRaw = f.para ? normalize(markedText(kidsOf(f.para), numberOf)) : mark;
    const words = paraRaw.replace(MARK, "").trim();
    let before = "";
    let after = "";
    if (f.owner) {
      const full = textFor(f.owner);
      const at = full.indexOf(mark);
      if (at >= 0) {
        before = clipStart(unmark(full.slice(0, at), n), contextChars).trimEnd();
        after = clipEnd(unmark(full.slice(at + mark.length), n), contextChars).trimStart();
      }
    }
    const entry = f.owner ? index.get(f.owner.id) : null;
    return {
      picture_id: id,
      image_id: id.endsWith("-img") ? id.slice(0, -4) : id,
      name: getAttr(f.node, "name"),
      xml_file: xmlFile,
      record_id: f.record,
      section_id: f.owner?.id ?? null,
      section_level: f.owner?.level ?? null,
      citation: entry?.citation ?? "",
      heading: entry?.heading ?? "",
      inline: words.length > 0,
      paragraph: unmark(paraRaw, n),
      before,
      after,
    };
  });
}

/**
 * The inventory of one book: { book, tags, images, missing }. `images` has one row per
 * distinct image (by sha256): { sha256, image_ids, file, format, width, height, bytes, uses }.
 * `missing` lists uses whose image file is not in the source.
 */
export function buildInventory(book, source, index, opts = {}) {
  const uses = [];
  for (const name of source.xmlNames()) uses.push(...picturesInXml(source.readXml(name), name, index, opts));

  const byImageId = new Map();
  for (const u of uses) {
    if (!byImageId.has(u.image_id)) byImageId.set(u.image_id, []);
    byImageId.get(u.image_id).push(u);
  }
  const bySha = new Map();
  const missing = [];
  for (const [imageId, list] of byImageId) {
    const file = source.imageFile(imageId);
    if (!file) {
      missing.push(...list);
      continue;
    }
    const sha = sha256(file.bytes);
    const size = imageSize(file.bytes) ?? { format: null, width: null, height: null };
    if (!bySha.has(sha)) {
      bySha.set(sha, {
        sha256: sha,
        image_ids: [],
        file: file.name,
        format: size.format,
        width: size.width,
        height: size.height,
        bytes: file.bytes.length,
        uses: [],
      });
    }
    const row = bySha.get(sha);
    row.image_ids.push(imageId);
    row.uses.push(...list);
  }
  const images = [...bySha.values()];
  for (const r of images) r.image_ids.sort();
  images.sort((a, b) => (a.uses[0].citation + a.image_ids[0]).localeCompare(b.uses[0].citation + b.image_ids[0]));
  return { book, tags: uses.length, images, missing };
}

/** Read the bytes of one inventory image from its source. */
export function imageBytes(source, image) {
  const f = source.imageFile(image.image_ids[0]);
  if (!f) throw new Error(`Image ${image.image_ids[0]} is not in the source`);
  return f.bytes;
}

// --- Checking against the 2026-11-25 picture map (workspace journal CSV) ------------------

/** Parse a CSV with a header row (RFC 4180 quoting). */
export function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') q = false;
      else field += c;
    } else if (c === '"') q = true;
    else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else field += c;
  }
  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }
  const [head, ...rest] = rows.filter((r) => r.length > 1 || r[0]);
  return rest.map((r) => Object.fromEntries(head.map((h, i) => [h, r[i] ?? ""])));
}

/**
 * Compare an inventory with the picture map's rows for the same book. Returns a list of
 * differences (empty when they agree): tag count, the set of (picture id, record id) pairs,
 * each tag's section, and each image's sha256.
 */
export function compareWithMap(inventory, mapRows) {
  const rows = mapRows.filter((r) => r.book === inventory.book);
  const diffs = [];
  const uses = [
    ...inventory.images.flatMap((img) => img.uses.map((u) => ({ ...u, sha256: img.sha256 }))),
    ...inventory.missing.map((u) => ({ ...u, sha256: "" })),
  ];
  if (rows.length !== inventory.tags) diffs.push(`tags: map ${rows.length}, inventory ${inventory.tags}`);
  const key = (pid, rec) => `${pid}@${rec}`;
  const mine = new Map(uses.map((u) => [key(u.picture_id, u.record_id), u]));
  for (const r of rows) {
    const u = mine.get(key(r.picture_id, r.record_id));
    if (!u) {
      diffs.push(`in map, not inventory: ${r.picture_id} in record ${r.record_id}`);
      continue;
    }
    if ((r.section_id || null) !== (u.section_id || null)) diffs.push(`${r.picture_id}: section map ${r.section_id}, inventory ${u.section_id}`);
    if (r.sha256 && r.sha256 !== u.sha256) diffs.push(`${r.picture_id}: sha256 differs`);
  }
  const theirs = new Set(rows.map((r) => key(r.picture_id, r.record_id)));
  for (const [k] of mine) if (!theirs.has(k)) diffs.push(`in inventory, not map: ${k}`);
  const mapIds = new Set(rows.map((r) => r.picture_id));
  const myIds = new Set(uses.map((u) => u.picture_id));
  if (mapIds.size !== myIds.size) diffs.push(`distinct picture ids: map ${mapIds.size}, inventory ${myIds.size}`);
  return diffs;
}
