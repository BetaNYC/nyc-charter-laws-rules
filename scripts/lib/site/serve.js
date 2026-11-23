// A small static server for previewing the built site and for the browser tests (issue #62).
// It answers the way GitHub Pages does for this site: /charter/sections/259 is served from
// charter/sections/259.html, /charter/ from charter/index.html, and an unknown path gets
// 404.html with status 404. Local only: it listens on 127.0.0.1.

import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { join, resolve, extname, sep } from "node:path";

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".xml": "application/xml; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
  ".svg": "image/svg+xml",
  ".wasm": "application/wasm",
};

async function isFile(p) {
  try {
    return (await stat(p)).isFile();
  } catch {
    return false;
  }
}

/** The file a request path maps to, or null. Never outside `root`. */
export async function resolveFile(root, urlPath) {
  let path;
  try {
    path = decodeURIComponent(urlPath.split("?")[0].split("#")[0]);
  } catch {
    return null;
  }
  const base = resolve(root);
  const full = resolve(join(base, path));
  if (full !== base && !full.startsWith(base + sep)) return null;
  const tries = path.endsWith("/") ? [join(full, "index.html")] : [full, `${full}.html`, join(full, "index.html")];
  for (const t of tries) if (await isFile(t)) return t;
  return null;
}

export function startServer(root, port = 0) {
  const server = createServer(async (req, res) => {
    const file = await resolveFile(root, req.url ?? "/");
    const target = file ?? join(root, "404.html");
    try {
      const body = await readFile(target);
      res.writeHead(file ? 200 : 404, { "content-type": TYPES[extname(target)] ?? "application/octet-stream" });
      res.end(body);
    } catch {
      res.writeHead(404, { "content-type": "text/plain" });
      res.end("not found");
    }
  });
  return new Promise((ok) => server.listen(port, "127.0.0.1", () => ok({ server, url: `http://127.0.0.1:${server.address().port}` })));
}
