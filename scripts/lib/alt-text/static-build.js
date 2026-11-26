// The picture description page as static files (issue #87): `npm run alt:build-static -- --out
// <folder>`. Two modes:
//   static (the default): "Suggest a better description" opens a prefilled new GitHub issue
//     (issue-url.js). For GitHub Pages or any static host.
//   inbox (--mode inbox): "Send suggestion" posts the suggestion to BetaNYC's data-issue intake
//     on www.beta.nyc (inbox-payload.js), so no GitHub account is needed. The intake accepts it
//     only from https://law.beta.nyc, so this build is for the Law Reader's own site, at a path
//     such as /describe-pictures/. Each picture links to its section page on law.beta.nyc, and
//     the page carries a content security policy whose connect-src is the intake's origin only;
//     the data is written into index.html so the page never fetches anything else.
//
// The site build (scripts/lib/site/build.js) builds the inbox page at /describe-pictures/ on
// law.beta.nyc, from the pictures committed in data/pictures/ (pictures.js, npm run
// alt:images), with no AI drafts. By hand, this command reads the zips instead. The images are
// copied into the output folder (BMPs as PNG). Unreviewed AI drafts are left out unless
// includeDrafts is set; when they are in, the page labels each one "AI draft, not yet checked
// by a person".

import { mkdirSync, writeFileSync, copyFileSync, existsSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { displayable } from "./image-info.js";
import { imageBytes } from "./inventory.js";
import { pageHtml, pageItems, PAGE_DIR } from "./server.js";
import { ENDPOINT, SITE_BASE } from "./inbox-payload.js";
import { BOOKS as SITE_BOOKS } from "../site/config.js";

const HERE = dirname(fileURLToPath(import.meta.url));
export const MODES = ["static", "inbox"];
/** Where the inbox page is meant to live on law.beta.nyc. */
export const INBOX_PATH = "/describe-pictures/";

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

/**
 * The address of a section on law.beta.nyc. With the site's redirects.json (book slug → { id:
 * path }) it is the page itself; without it, the id address (/admin-code/0-0-0-123), which the
 * site's 404 page sends on to the section. Null when the picture is in no indexed section.
 */
export function sectionUrl(book, sectionId, redirects, siteBase = SITE_BASE) {
  const slug = SITE_BOOKS[book]?.slug;
  if (!slug || !sectionId) return null;
  const path = redirects?.[slug]?.[sectionId];
  return `${siteBase}${typeof path === "string" && path.startsWith("/") ? path : `/${slug}/${sectionId}`}`;
}

/** The content security policy the inbox page carries (GitHub Pages cannot send headers). */
export function inboxCsp(endpoint) {
  const origin = new URL(endpoint).origin;
  return `default-src 'none'; img-src 'self'; style-src 'self'; script-src 'self'; connect-src ${origin}; base-uri 'none'; form-action 'none'; object-src 'none'`;
}

// JSON inside <script type="application/json">: every "<" is written as the escape \u003c, so
// no text from the law can close the element or open a comment. JSON.parse reads it back unchanged.
const inlineJson = (v) => JSON.stringify(v).replace(/</g, "\\u003c");
const escAttr = (s) => String(s).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");

/**
 * Build the static page into outDir. mode "static" (GitHub issue links) or "inbox" (posts to
 * the intake). For inbox: endpoint (default ENDPOINT; tests pass a fake one), redirects (the
 * site's redirects.json, optional) and siteBase. The pictures come from `sources` (the zips or
 * folders), or from `imageFor(book, image)` → { bytes, ext } when given (the site build: the
 * committed copies). Returns { items, images, bytes }.
 */
export function buildStatic({ inventories, sources, storeDir, outDir, includeDrafts = false, mode = "static", endpoint = ENDPOINT, redirects = null, siteBase = SITE_BASE, imageFor = null }) {
  if (!MODES.includes(mode)) throw new Error(`mode must be one of ${MODES.join(", ")}`);
  if (mode === "inbox" && !/^https?:\/\//.test(endpoint)) throw new Error("the inbox endpoint must be an http(s) address");
  if (existsSync(outDir) && readdirSync(outDir).length && !existsSync(join(outDir, "data.json"))) {
    throw new Error(`${outDir} is not empty and is not an earlier build of this page; choose an empty folder.`);
  }
  mkdirSync(join(outDir, "images"), { recursive: true });
  const exts = new Map();
  let images = 0;
  let bytes = 0;
  for (const inv of inventories) {
    for (const image of inv.images) {
      const shown = imageFor ? imageFor(inv.book, image) : displayable(imageBytes(sources[inv.book], image));
      exts.set(image.sha256, shown.ext);
      writeFileSync(join(outDir, "images", `${image.sha256}.${shown.ext}`), shown.bytes);
      images++;
      bytes += shown.bytes.length;
    }
  }
  const items = pageItems(inventories, storeDir, (book, image) => `images/${image.sha256}.${exts.get(image.sha256)}`).map((i) => {
    const item = { ...i, entry: publicEntry(i.entry, includeDrafts) };
    if (mode === "inbox") {
      item.uses = i.uses.map((u) => ({ ...u, section_url: sectionUrl(i.book, u.section_id, redirects, siteBase) }));
      // The page the picture is on, for the intake's page_url: its first section, or this page.
      item.page_url = item.uses.find((u) => u.section_url)?.section_url ?? `${siteBase}${INBOX_PATH}`;
    }
    return item;
  });
  const data = { mode, drafts_included: includeDrafts, items };
  const html =
    mode === "inbox"
      ? pageHtml("inbox", "", {
          head: `<meta http-equiv="Content-Security-Policy" content="${escAttr(inboxCsp(endpoint))}">\n<meta name="referrer" content="no-referrer">`,
          endpoint: escAttr(endpoint),
          data: inlineJson(data),
        })
      : pageHtml("static", "");
  writeFileSync(join(outDir, "index.html"), html);
  for (const f of ["app.js", "app.css"]) copyFileSync(join(PAGE_DIR, f), join(outDir, f));
  for (const f of ["issue-url.js", "inbox-payload.js"]) copyFileSync(join(HERE, f), join(outDir, f));
  writeFileSync(join(outDir, "data.json"), `${JSON.stringify(data)}\n`);
  writeFileSync(join(outDir, ".nojekyll"), "");
  return { items: items.length, images, bytes };
}
