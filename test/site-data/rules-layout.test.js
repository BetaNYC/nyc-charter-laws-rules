// The Rules' layout on the committed data (issue #65): npm run test:site-data.
//
// NOT part of npm test, on purpose (see admin-layout.test.js): a surprise in the data's shape
// must stop the website, never the daily refresh. Nothing here pins a count; every expectation is
// worked out from the data. The Rules need an index that names each record's title (0.7.0, #59);
// an index built before then has none, the site leaves the Rules out, and these tests skip.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { loadBook, rulesReady, linkHref, PART_MAX_SECTIONS, PART_MAX_CHARS } from "../../scripts/lib/site/model.js";
import { rulesPageMakers } from "../../scripts/lib/site/pages-rules.js";
import { siteFacts } from "../../scripts/lib/site/build.js";
import { unescapeHtml } from "../../scripts/lib/site/html.js";
import { getSection, fullCitation } from "../../dist/corpus.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const INDEX = join(ROOT, "data", "index", "json");
const STRUCTURE = join(ROOT, "data", "structure");
const VERSIONS = JSON.parse(readFileSync(join(INDEX, "versions.json"), "utf8"));
const DATA_SOURCES = JSON.parse(readFileSync(join(ROOT, "DATA-SOURCES.json"), "utf8"));

function loadReal(corpus) {
  if (!existsSync(join(STRUCTURE, `${corpus}.json`))) return null;
  const indexText = readFileSync(join(INDEX, `${corpus}.json`), "utf8");
  const structure = JSON.parse(readFileSync(join(STRUCTURE, `${corpus}.json`), "utf8"));
  if (structure.indexSha256 !== createHash("sha256").update(indexText).digest("hex")) return null;
  const index = JSON.parse(indexText);
  if (corpus === "rules" && !rulesReady(index)) return null;
  return { book: loadBook({ corpus, indexJsonText: indexText, structure, versions: VERSIONS }), structure, index };
}
const real = loadReal("rules");
const book = real?.book;
const skip = book ? false : "the committed Rules index has no titles yet (built before 0.7.0), or its structure is missing or from other text";

test("every Rules record has one page, under the title its record names", { skip }, () => {
  assert.equal(book.ordered.length, real.index.length);
  const paths = new Set();
  for (const r of book.ordered) {
    const t = r.level === "Chapter" ? r.titleNode : r.titleNode;
    assert.equal(t.number, r.titleNumber, `${r.id}`);
    assert.ok(r.path.startsWith(`/rules/titles/${r.titleNumber.toLowerCase()}/`), `${r.id} ${r.path}`);
    assert.ok(!paths.has(r.path), `two records at ${r.path}`);
    paths.add(r.path);
  }
});

test("titles are the records' own titleNumbers; chapters with no Title record are placed by theirs", { skip }, () => {
  const numbers = new Set(real.index.map((r) => r.titleNumber));
  assert.deepEqual(new Set(book.titles.map((t) => t.number)), numbers);
  const isTitle = (id) => real.structure.groups[id]?.level === "Title";
  const orphans = book.chapters.filter((c) => !c.structure.parents.some(isTitle));
  for (const c of orphans) assert.ok(c.titleNode.chapters.includes(c), `${c.id} ${c.citation}`);
  // The Health Code is a chapter of Title 24 with no Title record around it.
  const hc = book.chapters.find((c) => /^(?:new york city )?health code$/i.test(c.heading.trim()));
  if (hc) {
    assert.equal(hc.titleNumber, "24");
    for (const s of hc.sections.filter((x) => x.citation.startsWith("§"))) assert.ok(s.fullCitation.startsWith("24 RCNY Health Code § "), s.fullCitation);
  }
  for (const t of book.titles) assert.ok(t.title && t.title !== t.citation, `${t.citation} has a name`);
});

test("every citation names its title, and get_section finds the same records with it as with fullCitation", { skip }, () => {
  const all = new Map();
  for (const r of real.index) all.set(r.id, r);
  const ids = (res) => (res.kind === "match" ? [res.section.id] : res.kind === "ambiguous" ? res.candidates.map((s) => s.id).sort() : []);
  for (const r of book.ordered) {
    // "15 RCNY § 1-01", or a group record's own "Title 6, Chapter 2, Subchapter B".
    assert.match(r.fullCitation, /^(?:\d+(?:-[A-Z])? RCNY \S|Title \d+(?:-[A-Z])?, \S)/, r.id);
    // dist/corpus.js reads the same data/index/json; find this record there by its own citation.
    const own = getSection(fullCitation({ ...all.get(r.id) }), "rules");
    const site = ids(getSection(r.fullCitation, "rules"));
    assert.deepEqual(site, ids(own), `${r.fullCitation} (${r.id})`);
    assert.ok(site.includes(r.id), `${r.fullCitation} does not find ${r.id}`);
    // Where one citation names several records (the publisher's own repeats, which fullCitation
    // cannot tell apart either), they are all in one title, and each has a page and name of its own.
    if (site.length > 1) assert.equal(new Set(site.map((id) => all.get(id).titleNumber)).size, 1, `${r.fullCitation}: records in several titles`);
  }
});

test("parts: no part holds more than the caps, and every section of a split holder is in one part", { skip }, () => {
  for (const h of [...book.titles, ...book.chapters].filter((x) => x.parts)) {
    assert.deepEqual(h.parts.flatMap((p) => p.sections), h.sections, h.path);
    for (const p of h.parts) {
      assert.ok(p.sections.length <= PART_MAX_SECTIONS, p.path);
      const chars = p.sections.reduce((n, s) => n + (s.text ?? "").length, 0);
      assert.ok(chars <= PART_MAX_CHARS || p.sections.length === 1, `${p.path}: ${chars} characters`);
    }
  }
});

test("names in lists are unique where a reader picks from them", { skip }, () => {
  for (const t of book.titles) {
    const names = t.chapters.map((c) => c.name);
    const dup = names.filter((n, i) => names.indexOf(n) !== i);
    // Two chapters of one title with one number and heading would read the same: none expected.
    assert.deepEqual(dup, [], `${t.citation}: chapters named alike`);
  }
  for (const h of [...book.titles, ...book.chapters]) {
    const lines = h.sections.map((s) => s.line);
    const dup = [...new Set(lines.filter((n, i) => lines.indexOf(n) !== i))];
    // Same line and same note: told apart only by American Legal's id, which the line then carries.
    for (const d of dup) for (const s of h.sections.filter((x) => x.line === d)) assert.match(s.line, /American Legal id/, `${h.path}: ${d}`);
  }
  for (const sh of book.shared) assert.ok(sh.sections.length > 1 && new Set(sh.sections.map((s) => s.titleNumber)).size === 1, sh.path);
  for (const pk of book.picks) assert.ok(new Set(pk.sections.map((s) => s.titleNumber)).size > 1, pk.path);
  for (const [n, path] of Object.entries(book.numbers)) assert.ok(path.startsWith("/rules/titles/") && path.includes(`/sections/${n}`), `${n} → ${path}`);
});

test("references into the Rules from the Charter and the Administrative Code land on Rules pages", { skip }, () => {
  const others = ["charter", "admin_code"].map(loadReal).filter(Boolean).map((x) => x.book);
  const books = [...others, book];
  for (const b of books) b.others = new Map(books.filter((x) => x !== b).map((x) => [x.corpus, x]));
  let into = 0;
  let landed = 0;
  const walk = (x, b) => {
    if (Array.isArray(x)) return x.forEach((y) => walk(y, b));
    if (!x || typeof x !== "object") return;
    if (x.to && x.to.corpus === "rules" && !x.to.kind && x.to.resolved !== false && !x.to.ambiguous && x.to.id) {
      into++;
      const href = linkHref(x.to, b, null);
      if (href && href.startsWith("/rules/titles/")) landed++;
      else assert.fail(`${b.corpus}: a link to rules ${x.to.id} went to ${href}`);
    }
    for (const v of Object.values(x)) if (v && typeof v === "object") walk(v, b);
  };
  for (const b of books) walk(b.records.map((r) => r.structure), b);
  assert.equal(landed, into);
  assert.ok(into > 0, "the books link into the Rules");
});

test("every page: one h1, no skipped heading levels in the text, a unique title, the citation in the heading", { skip }, () => {
  const { perBook } = siteFacts([{ corpus: "rules", book: book.book, version: book.version }], DATA_SOURCES);
  const site = perBook.get("rules");
  const titles = new Set();
  for (const make of rulesPageMakers(book, site)) {
    const p = make();
    const main = p.html.slice(p.html.indexOf('<main id="main">'));
    const levels = [...main.matchAll(/<h([1-6])\b/g)].map((m) => Number(m[1]));
    assert.equal(levels.filter((l) => l === 1).length, 1, `${p.path}: one h1`);
    for (let i = 1; i < levels.length; i++) assert.ok(levels[i] <= levels[i - 1] + 1, `${p.path}: h${levels[i - 1]} then h${levels[i]}`);
    const title = /<title>([^<]*)<\/title>/.exec(p.html)[1];
    assert.ok(!titles.has(title), `${p.path}: title "${title}" is used twice`);
    titles.add(title);
    if (p.kind === "section") {
      const cite = unescapeHtml(/<h1><span class="cite">([^<]*)<\/span>/.exec(p.html)?.[1] ?? "");
      assert.equal(cite, p.record.fullCitation, p.path);
    }
  }
});

// The repo's rule (test/site/a11y-tree.mjs), on every Rules page in memory, as admin-layout.test.js
// does for the Administrative Code: one link name never goes to two places, and no two buttons
// share a name. The browser test (test/site/rules.test.mjs) checks a sample in the accessibility tree.
test("every Rules page: one link name never goes to two places; no two buttons share a name", { skip }, (t) => {
  const others = ["charter", "admin_code"].map(loadReal).filter(Boolean).map((x) => x.book);
  const linked = { ...book, others: new Map(others.map((b) => [b.corpus, b])) };
  const { perBook } = siteFacts([{ corpus: "rules", book: book.book, version: book.version }], DATA_SOURCES);
  const text = (s) => unescapeHtml(s.replace(/<[^>]+>/g, "")).replace(/\s+/g, " ").trim().toLowerCase();
  const problems = [];
  const publisher = [];
  for (const make of rulesPageMakers(linked, perBook.get("rules"))) {
    const p = make();
    const byName = new Map();
    for (const m of p.html.matchAll(/<a ([^>]*)>([\s\S]*?)<\/a>/g)) {
      const href = /href="([^"]*)"/.exec(m[1])?.[1];
      const label = /aria-label="([^"]*)"/.exec(m[1])?.[1];
      const name = label !== undefined ? text(label) : text(m[2]);
      if (!href || !name) continue;
      if (!byName.has(name)) byName.set(name, new Set());
      byName.get(name).add(href);
    }
    for (const [name, hrefs] of byName) {
      if (hrefs.size < 2) continue;
      const list = [...hrefs];
      // One section two ways: its own page, and its copy on this chapter page (a chapter's own
      // note that cites a section of the chapter, as Title 16, Chapter 20's does).
      const pages = new Set(list.map((h) => (h.startsWith("#s-") ? h.slice(3).split("(")[0] : h.split("#")[0].split("/").pop())));
      if (pages.size === 1 && list.every((h) => h.startsWith("#s-") || h.startsWith("/rules/"))) continue;
      // The publisher's own web links: one name, a page and the same page through an email
      // client's link wrapper (safelinks.protection.outlook.com). Their text, not ours.
      if (list.every((h) => /^https?:/.test(h))) {
        publisher.push(`${p.path}: "${name}"`);
        continue;
      }
      problems.push(`${p.path}: "${name}" goes to ${list.join(" | ")}`);
    }
    const buttons = [...p.html.matchAll(/<button [^>]*aria-label="([^"]*)"/g)].map((m) => text(m[1]));
    const dup = buttons.filter((b, i) => buttons.indexOf(b) !== i);
    if (dup.length) problems.push(`${p.path}: buttons share ${dup.join(", ")}`);
  }
  assert.deepEqual(problems.slice(0, 20), [], `${problems.length} pages with a shared name`);
  if (publisher.length) t.diagnostic(`the publisher's own web links share a name on ${publisher.length} pages: ${publisher.slice(0, 5).join("; ")}`);
});
