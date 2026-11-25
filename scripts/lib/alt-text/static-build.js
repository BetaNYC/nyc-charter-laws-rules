// The picture description page as static files (issue #87), for GitHub Pages or any static
// host: `npm run alt:build-static -- --out <folder>`. Save becomes "Suggest a better
// description", a prefilled new GitHub issue (issue-url.js).
//
// It is not wired into deploy-site.yml or the law.beta.nyc build: publishing it is a separate
// decision. The images are copied into the output folder (BMPs as PNG), never into the repo.
// Unreviewed AI drafts are left out unless includeDrafts is set, so a public page shows only
// text a person has reviewed.

import { mkdirSync, writeFileSync, copyFileSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { displayable } from "./image-info.js";
import { imageBytes } from "./inventory.js";
import { pageHtml, pageItems, PAGE_DIR } from "./server.js";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));

function publicEntry(entry, includeDrafts) {
  if (!entry) return null;
  const reviewed = entry.status === "reviewed" && entry.review;
  const out = {
    status: reviewed ? "reviewed" : entry.draft && includeDrafts ? entry.status : null,
    review: reviewed ? { alt: entry.review.alt ?? "", long: entry.review.long ?? "" } : null,
    draft: includeDrafts && entry.draft ? { alt: entry.draft.alt ?? "", long: entry.draft.long ?? "", unsure: entry.draft.unsure ?? "" } : null,
    draft_model: includeDrafts ? entry.draft_model ?? null : null,
    drafted_at: includeDrafts ? entry.drafted_at ?? null : null,
    reviewed_at: reviewed ? entry.reviewed_at ?? null : null,
    updated_at: entry.updated_at ?? null,
  };
  return out.status || out.review || out.draft ? out : null;
}

/** Build the static page into outDir. Returns { items, images }. */
export function buildStatic({ inventories, sources, storeDir, outDir, includeDrafts = false }) {
  if (existsSync(outDir) && readdirSync(outDir).length && !existsSync(join(outDir, "data.json"))) {
    throw new Error(`${outDir} is not empty and is not an earlier build of this page; choose an empty folder.`);
  }
  mkdirSync(join(outDir, "images"), { recursive: true });
  const exts = new Map();
  let images = 0;
  for (const inv of inventories) {
    for (const image of inv.images) {
      const shown = displayable(imageBytes(sources[inv.book], image));
      exts.set(image.sha256, shown.ext);
      writeFileSync(join(outDir, "images", `${image.sha256}.${shown.ext}`), shown.bytes);
      images++;
    }
  }
  const items = pageItems(inventories, storeDir, (book, image) => `images/${image.sha256}.${exts.get(image.sha256)}`).map((i) => ({
    ...i,
    entry: publicEntry(i.entry, includeDrafts),
  }));
  writeFileSync(join(outDir, "index.html"), pageHtml("static", ""));
  copyFileSync(join(PAGE_DIR, "app.js"), join(outDir, "app.js"));
  copyFileSync(join(PAGE_DIR, "app.css"), join(outDir, "app.css"));
  copyFileSync(join(HERE, "issue-url.js"), join(outDir, "issue-url.js"));
  writeFileSync(join(outDir, "data.json"), `${JSON.stringify({ mode: "static", drafts_included: includeDrafts, items })}\n`);
  writeFileSync(join(outDir, ".nojekyll"), "");
  return { items: items.length, images };
}
