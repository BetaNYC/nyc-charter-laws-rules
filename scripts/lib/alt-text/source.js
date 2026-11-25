// Where the alt-text tool reads American Legal Publishing's files from: an extracted folder
// (with XML/ and IMAGES/ inside) or the zip itself (data/raw/<book>.zip, as fetch-data writes
// it). Read only; nothing here touches the network.

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, basename, extname } from "node:path";
import AdmZip from "adm-zip";

export const BOOKS = ["admin_code", "rules"];

const stem = (name) => basename(name, extname(name));

/**
 * Open a source. Returns { path, xmlNames(), readXml(name), imageFile(id) }, where
 * imageFile(id) is { name: "IMAGES/<id>.<ext>", bytes } or null. When an id has two files
 * (three do: a real .bmp beside an empty .gif), the non-empty one wins.
 */
export function openSource(path) {
  if (!path || !existsSync(path)) throw new Error(`Source not found: ${path}`);
  if (statSync(path).isDirectory()) return openFolder(path);
  if (path.toLowerCase().endsWith(".zip")) return openZip(path);
  throw new Error(`Source must be a folder with XML/ and IMAGES/, or a .zip: ${path}`);
}

function pickImages(entries) {
  // entries: [{ name, size, read }]
  const byId = new Map();
  for (const e of entries) {
    const ext = extname(e.name).toLowerCase();
    if (!ext || ext === ".rdf") continue;
    const id = stem(e.name);
    const prev = byId.get(id);
    if (!prev || (prev.size === 0 && e.size > 0)) byId.set(id, e);
  }
  return byId;
}

function openFolder(dir) {
  const xmlDir = join(dir, "XML");
  const imgDir = join(dir, "IMAGES");
  if (!existsSync(xmlDir)) throw new Error(`No XML/ folder in ${dir}`);
  const images = pickImages(
    existsSync(imgDir)
      ? readdirSync(imgDir).map((n) => ({
          name: `IMAGES/${n}`,
          size: statSync(join(imgDir, n)).size,
          read: () => readFileSync(join(imgDir, n)),
        }))
      : [],
  );
  return {
    path: dir,
    xmlNames: () => readdirSync(xmlDir).filter((n) => n.toLowerCase().endsWith(".xml")).sort(),
    readXml: (name) => readFileSync(join(xmlDir, name), "utf8"),
    imageFile: (id) => {
      const e = images.get(id);
      return e ? { name: e.name, bytes: e.read() } : null;
    },
  };
}

function openZip(file) {
  const zip = new AdmZip(file);
  const entries = zip.getEntries();
  const xml = new Map();
  const imgs = [];
  for (const e of entries) {
    if (e.isDirectory) continue;
    const parts = e.entryName.split("/");
    const folder = parts.length > 1 ? parts[parts.length - 2] : "";
    if (folder === "XML" && e.entryName.toLowerCase().endsWith(".xml")) xml.set(basename(e.entryName), e);
    if (folder === "IMAGES") imgs.push({ name: `IMAGES/${basename(e.entryName)}`, size: e.header.size, read: () => e.getData() });
  }
  const images = pickImages(imgs);
  return {
    path: file,
    xmlNames: () => [...xml.keys()].sort(),
    readXml: (name) => xml.get(name).getData().toString("utf8"),
    imageFile: (id) => {
      const e = images.get(id);
      return e ? { name: e.name, bytes: e.read() } : null;
    },
  };
}
