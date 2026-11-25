// The local review page for picture descriptions (issue #87): `npm run alt:review`.
//
// One page shows each picture, where it appears, the AI draft (read only) and an editable
// review prefilled with the draft. Save writes straight to data/alt-text/<book>.json, so the
// reviewed text is in the repo with nothing to upload.
//
// Local only: it listens on 127.0.0.1, answers only requests whose Host is 127.0.0.1 or
// localhost on its port (so another site cannot reach it by DNS rebinding), and every /api
// call must carry the random token the page was served with (so another site open in the
// same browser cannot post to it). Node built-ins only.

import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";
import { displayable } from "./image-info.js";
import { imageBytes } from "./inventory.js";
import { readStore, saveReview, ConflictError, STATUSES } from "./store.js";

const HERE = dirname(fileURLToPath(import.meta.url));
export const PAGE_DIR = join(HERE, "page");
const MAX_BODY = 1024 * 1024;

const ASSETS = {
  "/app.js": [join(PAGE_DIR, "app.js"), "text/javascript; charset=utf-8"],
  "/app.css": [join(PAGE_DIR, "app.css"), "text/css; charset=utf-8"],
  "/issue-url.js": [join(HERE, "issue-url.js"), "text/javascript; charset=utf-8"],
};

/** The page's HTML for a mode ("local" or "static"). */
export function pageHtml(mode, token = "") {
  return readFileSync(join(PAGE_DIR, "index.html"), "utf8").replace("{{MODE}}", mode).replace("{{TOKEN}}", token);
}

/**
 * The items the page lists: one per image, with its uses and its stored entry (or null).
 * imageUrl(book, image) gives the image's address in this mode.
 */
export function pageItems(inventories, storeDir, imageUrl) {
  const items = [];
  for (const inv of inventories) {
    const store = readStore(storeDir, inv.book);
    for (const image of inv.images) {
      items.push({
        book: inv.book,
        sha256: image.sha256,
        image_ids: image.image_ids,
        picture_ids: [...new Set(image.uses.map((u) => u.picture_id))].sort(),
        file: image.file,
        width: image.width,
        height: image.height,
        image_url: imageUrl(inv.book, image),
        uses: image.uses.map((u) => ({
          picture_id: u.picture_id,
          citation: u.citation,
          heading: u.heading,
          section_id: u.section_id,
          inline: u.inline,
          paragraph: u.paragraph,
          before: u.before,
          after: u.after,
        })),
        entry: store.images[image.sha256] ?? null,
      });
    }
  }
  return items;
}

function send(res, status, body, type = "application/json; charset=utf-8") {
  res.writeHead(status, {
    "Content-Type": type,
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    "Content-Security-Policy": "default-src 'self'; img-src 'self'; style-src 'self'; script-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
    "Referrer-Policy": "no-referrer",
  });
  res.end(typeof body === "string" || Buffer.isBuffer(body) ? body : JSON.stringify(body));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", (c) => {
      size += c.length;
      if (size > MAX_BODY) {
        reject(new Error("too large"));
        req.destroy();
      } else chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

const str = (v, max = 20000) => (typeof v === "string" ? v.slice(0, max) : "");

/**
 * Start the review server. { inventories, sources: { book: source }, storeDir, port } →
 * { url, token, server, close() }. Port 0 picks a free port.
 */
export function startReviewServer({ inventories, sources, storeDir, port = 8765, host = "127.0.0.1" }) {
  const token = randomBytes(24).toString("hex");
  const byKey = new Map();
  for (const inv of inventories) for (const image of inv.images) byKey.set(`${inv.book}/${image.sha256}`, { book: inv.book, image });

  const server = createServer(async (req, res) => {
    try {
      const actualPort = server.address().port;
      const allowed = new Set([`127.0.0.1:${actualPort}`, `localhost:${actualPort}`]);
      if (!allowed.has(req.headers.host ?? "")) return send(res, 403, { error: "This server answers only on 127.0.0.1." });
      const url = new URL(req.url, `http://${req.headers.host}`);
      const path = url.pathname;

      if (req.method === "GET" && (path === "/" || path === "/index.html")) return send(res, 200, pageHtml("local", token), "text/html; charset=utf-8");
      if (req.method === "GET" && ASSETS[path]) return send(res, 200, readFileSync(ASSETS[path][0]), ASSETS[path][1]);
      if (req.method === "GET" && path.startsWith("/image/")) {
        const hit = byKey.get(path.slice("/image/".length));
        if (!hit) return send(res, 404, { error: "No such picture." });
        const shown = displayable(imageBytes(sources[hit.book], hit.image));
        return send(res, 200, shown.bytes, shown.mediaType);
      }
      if (path.startsWith("/api/")) {
        if (req.headers["x-alt-review-token"] !== token) return send(res, 403, { error: "Missing or wrong page token. Reload the page." });
        if (req.method === "GET" && path === "/api/items") {
          return send(res, 200, { mode: "local", statuses: STATUSES, items: pageItems(inventories, storeDir, (book, image) => `/image/${book}/${image.sha256}`) });
        }
        if (req.method === "POST" && path === "/api/save") {
          if (!(req.headers["content-type"] ?? "").startsWith("application/json")) return send(res, 415, { error: "Send JSON." });
          let body;
          try {
            body = JSON.parse(await readBody(req));
          } catch {
            return send(res, 400, { error: "The request was not valid JSON." });
          }
          const hit = byKey.get(`${body.book}/${body.sha256}`);
          if (!hit) return send(res, 404, { error: "No such picture in this source." });
          if (!STATUSES.includes(body.status)) return send(res, 400, { error: `Status must be one of ${STATUSES.join(", ")}.` });
          const review = { alt: str(body.review?.alt).trim(), long: str(body.review?.long).trim(), note: str(body.review?.note).trim() };
          if (!review.note) delete review.note;
          try {
            const entry = await saveReview(storeDir, hit.book, hit.image, { review, status: body.status, base: body.base ?? null });
            return send(res, 200, { entry });
          } catch (e) {
            if (e instanceof ConflictError) return send(res, 409, { error: e.message, current: e.current });
            throw e;
          }
        }
      }
      return send(res, 404, { error: "Not found." });
    } catch (e) {
      return send(res, 500, { error: `Server error: ${e.message}` });
    }
  });

  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => {
      const p = server.address().port;
      resolve({ url: `http://127.0.0.1:${p}`, token, server, close: () => new Promise((r) => server.close(r)) });
    });
  });
}
