// The site's data files (issue #62): redirects.json, index.json, metadata.json, the citation
// list for the jump box, the sitemaps and robots.txt. Pure.

import { SITE_BASE, SITE_NAME, absoluteUrl } from "./config.js";
import { citationKeys } from "../../../site/assets/jump.js";

/** American Legal ids to our paths, per book: links that carry an id still land (DC's redirects.json). */
export function redirectsJson(books) {
  const out = {};
  for (const b of books) {
    out[b.book.slug] = Object.fromEntries(b.ordered.map((r) => [r.id, r.path]));
  }
  return out;
}

/** The whole table of contents as one tree. */
export function indexJson(books) {
  return {
    site: SITE_NAME,
    base: SITE_BASE,
    books: books.map((b) => ({
      book: b.book.slug,
      name: b.book.name,
      path: `/${b.book.slug}/`,
      currentThrough: b.version.currentThrough,
      children: b.chapters.map((c) => ({
        kind: "chapter",
        id: c.id,
        citation: c.citation,
        heading: c.title,
        path: c.path,
        children: c.sections.map((s) => ({ kind: "section", id: s.id, citation: s.citation, heading: s.title, path: s.path })),
      })),
    })),
  };
}

/**
 * The jump box's list: every chapter and section, with the keys a reader might type for it.
 * Short field names keep it small: k keys, c citation, h heading, p path, b book.
 */
export function citationsJson(books) {
  const list = [];
  for (const b of books) {
    for (const r of b.ordered) {
      list.push({ k: citationKeys(r.citation), c: `${b.book.label} ${r.citation}`, h: r.title, p: r.path, b: b.book.short });
    }
  }
  return list;
}

/** Build facts. `builtAt` is an ISO time in New York (the one clock); `commit` is this repo's. */
export function metadataJson({ books, builtAt, builtOn, commit, structureFormat }) {
  return {
    site: SITE_NAME,
    base: SITE_BASE,
    builtAt,
    builtOn,
    sourceCommit: commit,
    sourceRepository: "https://github.com/BetaNYC/nyc-charter-laws-rules",
    structureFormat,
    books: Object.fromEntries(
      books.map((b) => [
        b.book.slug,
        {
          currentThrough: b.version.currentThrough,
          indexedAt: b.version.indexedAt,
          records: b.records.length,
          chapters: b.chapters.length,
          sections: b.sections.length,
          indexSha256: b.indexSha256,
        },
      ])
    ),
  };
}

function xmlEscape(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * One sitemap per book, plus one for the site's own pages, under a sitemap index. No
 * `lastmod`: the index does not record when each section's text last changed, and the build
 * date is not that (search engines use lastmod only when it is accurate). It can come with the
 * law's history (Phase 6, #66).
 */
export function sitemaps(books, otherPaths) {
  const urlset = (paths) =>
    `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${paths
      .map((p) => `<url><loc>${xmlEscape(absoluteUrl(p))}</loc></url>`)
      .join("\n")}\n</urlset>\n`;
  const files = {};
  files["sitemaps/pages.xml"] = urlset(otherPaths);
  for (const b of books) {
    files[`sitemaps/${b.book.slug}.xml`] = urlset([`/${b.book.slug}/`, ...b.ordered.map((r) => r.path), ...b.shared.map((s) => s.path)]);
  }
  files["sitemap.xml"] = `<?xml version="1.0" encoding="UTF-8"?>\n<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${Object.keys(files)
    .map((f) => `<sitemap><loc>${xmlEscape(absoluteUrl("/" + f))}</loc></sitemap>`)
    .join("\n")}\n</sitemapindex>\n`;
  return files;
}

/**
 * robots.txt: every crawler may read every page (epic #68 decision 8: search, AI-answer and
 * AI-training crawlers are welcome). The named agents include ones American Legal Publishing
 * (https://codelibrary.amlegal.com/robots.txt) and DC Council's code site
 * (https://code.dccouncil.gov/robots.txt) disallow; naming them says on purpose that they are
 * welcome here. A crawler with no group of its own follows `*`.
 */
export const WELCOMED_CRAWLERS = [
  "Googlebot",
  "Bingbot",
  "OAI-SearchBot",
  "GPTBot",
  "PerplexityBot",
  "Claude-SearchBot",
  "Claude-User",
  "ClaudeBot",
  "Google-Extended",
  "Applebot-Extended",
  "CCBot",
];

export function robotsTxt() {
  return [
    `# ${SITE_NAME}: search engines, AI answer engines and AI training crawlers are all welcome.`,
    `# The law is public. Please use the bulk download (https://github.com/BetaNYC/nyc-charter-laws-rules) for all of it.`,
    ...WELCOMED_CRAWLERS.map((a) => `User-agent: ${a}`),
    `Allow: /`,
    ``,
    `User-agent: *`,
    `Allow: /`,
    ``,
    `Sitemap: ${absoluteUrl("/sitemap.xml")}`,
    ``,
  ].join("\n");
}
