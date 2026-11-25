// Pages that could scroll sideways on a phone (issue #65 review): every page whose main text has
// a run with no space in it long enough to pass a 390px screen's line ("________" blanks in the
// Rules' forms, long addresses), and every page with a long breadcrumb (NYSDS sets crumbs
// nowrap, so a long name can pass the line even with spaces in it). The browser test (overflow.test.mjs) opens every one of them at
// 390px; reading the HTML picks them all, rather than a sample.

import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { unescapeHtml } from "../../scripts/lib/site/html.js";

/**
 * The shortest run worth a look. At 390px the law text's line is about 330px of 18px type; the
 * narrowest characters there are about 5px wide, so a run under 30 characters cannot pass it
 * even unindented. Erring low only means more pages to open.
 */
export const LONG_RUN = 30;

/** The longest run with no whitespace in a page's <main>, as text. */
export function longestRun(html) {
  const start = html.indexOf('<main id="main">');
  const end = html.indexOf("</main>");
  if (start < 0 || end < 0) return "";
  // Tags are boundaries for where a page breaks only when they hold space; treat them as nothing,
  // so a run split by <a> or <strong> counts whole. Line breaks inside the HTML are spaces.
  const text = unescapeHtml(html.slice(start, end).replace(/<[^>]+>/g, ""));
  let best = "";
  for (const run of text.split(/\s+/)) if (run.length > best.length) best = run;
  return best;
}

/** The longest breadcrumb's text. */
export function longestCrumb(html) {
  const m = /<nys-breadcrumbs[^>]*>([\s\S]*?)<\/nys-breadcrumbs>/.exec(html);
  if (!m) return "";
  let best = "";
  for (const li of m[1].matchAll(/<li>([\s\S]*?)<\/li>/g)) {
    const t = unescapeHtml(li[1].replace(/<[^>]+>/g, "")).trim();
    if (t.length > best.length) best = t;
  }
  return best;
}

/** Every page in a built site whose main text has a run of at least `min` characters, or a crumb that long: [{ path, run }]. */
export function pagesWithLongRuns(outDir, min = LONG_RUN) {
  const out = [];
  const walk = (dir) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name);
      if (e.isDirectory()) {
        if (e.name !== "pagefind" && e.name !== "assets") walk(p);
      } else if (e.name.endsWith(".html")) {
        const html = readFileSync(p, "utf8");
        const run = [longestRun(html), longestCrumb(html)].find((x) => x.length >= min);
        if (run) {
          const rel = "/" + relative(outDir, p).replace(/\\/g, "/");
          const path = rel.endsWith("/index.html") ? rel.slice(0, -"index.html".length) : rel === "/index.html" ? "/" : rel.replace(/\.html$/, "");
          out.push({ path, run });
        }
      }
    }
  };
  walk(outDir);
  return out.sort((a, b) => a.path.localeCompare(b.path));
}

/**
 * Every page in a built site that shows a table as a table (issue #65; render-html.js tableHtml):
 * [{ path, tables }]. A table's box scrolls a wide table inside itself; overflow.test.mjs opens
 * each of these at 390px and 320px to check that the page itself does not scroll sideways.
 */
export function pagesWithTables(outDir) {
  const out = [];
  const walk = (dir) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name);
      if (e.isDirectory()) {
        if (e.name !== "pagefind" && e.name !== "assets") walk(p);
      } else if (e.name.endsWith(".html")) {
        const tables = (readFileSync(p, "utf8").match(/<div class="table-scroll" /g) ?? []).length;
        if (tables) {
          const rel = "/" + relative(outDir, p).replace(/\\/g, "/");
          const path = rel.endsWith("/index.html") ? rel.slice(0, -"index.html".length) : rel.replace(/\.html$/, "");
          out.push({ path, tables });
        }
      }
    }
  };
  walk(outDir);
  return out.sort((a, b) => a.path.localeCompare(b.path));
}
