// One book of the site (issue #62): the index records and their structure, checked against
// each other, put in document order, with a stable path for every page.
//
// Pure: no I/O. scripts/build-site.js reads the files and passes their contents in.
//
// Order. The index lists records in the order of the publisher's ZIP, not the book's order
// (the Charter's index starts at Chapter 11). Chapters are sorted by their label: Preamble,
// Introductory, then Chapter 1, 2, 2-A, 3 ... Checked 2026-11-22 against the RECORD `number`
// of each chapter file's first record in American Legal's July 2026 Charter XML: the same order
// for all 86 chapter-level records. Sections keep index order inside their chapter, which is
// the order of their file.
//
// Paths. A section's path comes from its citation: § 259 is /charter/sections/259. When two
// sections share a citation (the Charter has two § 20-t, two § 530 and two § 808), each gets
// the citation plus American Legal's record id (/charter/sections/530-0-0-0-6575), and the
// plain path becomes a short page that lists both. A chapter's path comes from its label:
// Chapter 2-A is /charter/chapters/2-a.

import { createHash } from "node:crypto";
import { BOOKS } from "./config.js";

const SLUG_SAFE = /^[0-9a-z][0-9a-z.-]*$/;

/** The sort key for a chapter-level record's citation ("Chapter 2-A" → [1, 2, "A"]). */
export function chapterOrderKey(citation) {
  if (citation === "Preamble") return [0, 0, ""];
  if (citation === "Introductory") return [0, 1, ""];
  const m = /^Chapter (\d+)(?:-([A-Z]+))?$/.exec(citation);
  if (m) return [1, Number(m[1]), m[2] ?? ""];
  return [2, 0, citation];
}

function compareKeys(a, b) {
  for (let i = 0; i < a.length; i++) {
    if (a[i] < b[i]) return -1;
    if (a[i] > b[i]) return 1;
  }
  return 0;
}

/** "Chapter 2-A" → "2-a"; "Preamble" → "preamble". */
export function chapterSlug(citation) {
  const m = /^Chapter (\S+)$/.exec(citation);
  const slug = (m ? m[1] : citation).toLowerCase().replace(/\s+/g, "-");
  if (!SLUG_SAFE.test(slug)) throw new Error(`chapter citation "${citation}" does not make a safe path`);
  return slug;
}

/** "§ 259" → "259"; "§ 20-t" → "20-t". */
export function sectionSlug(citation) {
  const m = /^§\s*(\S+)$/.exec(citation);
  if (!m) throw new Error(`section citation "${citation}" is not "§ <number>"`);
  const slug = m[1].toLowerCase();
  if (!SLUG_SAFE.test(slug)) throw new Error(`section citation "${citation}" does not make a safe path`);
  return slug;
}

/** The heading without its citation: "Section 259. Independent budget office." → "Independent budget office". */
export function shortHeading(record) {
  let h = record.heading.trim();
  if (record.level === "Chapter") {
    h = h.replace(/^Chapter\s+\S+?:\s*/, "");
  } else {
    h = h.replace(/^(?:Section|§)\s+\S+?\.\s+/, "");
  }
  h = h.replace(/\.$/, "").trim();
  return h || record.heading.trim();
}

/**
 * Check the index and structure belong together, and lay the book out.
 *
 * @param {object} p
 * @param {string} p.corpus           "charter"
 * @param {string} p.indexJsonText     data/index/json/<corpus>.json, as text (its sha256 is checked)
 * @param {object} p.structure         data/structure/<corpus>.json, parsed
 * @param {object} p.versions          data/index/json/versions.json, parsed
 */
export function loadBook({ corpus, indexJsonText, structure, versions }) {
  const book = BOOKS[corpus];
  if (!book) throw new Error(`no site settings for "${corpus}"`);
  const index = JSON.parse(indexJsonText);
  const sha = createHash("sha256").update(indexJsonText).digest("hex");
  if (structure.corpus !== corpus) throw new Error(`structure file is for "${structure.corpus}", not "${corpus}"`);
  if (structure.indexSha256 !== sha) {
    throw new Error(
      `data/structure/${corpus}.json was built from other text (its indexSha256 ${structure.indexSha256.slice(0, 12)}..., ` +
        `the index ${sha.slice(0, 12)}...). Rebuild both with npm run build-index.`
    );
  }
  if (structure.sections.length !== index.length || structure.sections.some((s, i) => s.id !== index[i].id)) {
    throw new Error(`structure for ${corpus} does not line up with its index`);
  }
  const v = versions?.[corpus];
  if (!v) throw new Error(`versions.json has no entry for ${corpus}`);
  if (v.sectionCount !== index.length) {
    throw new Error(`versions.json says ${v.sectionCount} ${corpus} records, the index has ${index.length}`);
  }
  if (v.sha256 && v.sha256 !== sha) throw new Error(`versions.json sha256 for ${corpus} does not match its index file`);

  const records = index.map((r, i) => ({ ...r, level: structure.sections[i].level, structure: structure.sections[i], order: i }));
  const byId = new Map(records.map((r) => [r.id, r]));

  const chapters = records.filter((r) => r.level === "Chapter");
  chapters.sort((a, b) => compareKeys(chapterOrderKey(a.citation), chapterOrderKey(b.citation)) || a.order - b.order);
  const chapterIds = new Set(chapters.map((c) => c.id));
  for (const c of chapters) c.sections = [];
  for (const r of records) {
    if (r.level === "Chapter") continue;
    const parent = [...r.structure.parents].reverse().find((p) => chapterIds.has(p));
    if (!parent) throw new Error(`${r.citation} (${r.id}) sits in no chapter; the ${corpus} site cannot place it`);
    r.chapter = byId.get(parent);
    r.chapter.sections.push(r);
  }

  // Paths.
  const seenChapter = new Map();
  for (const c of chapters) {
    c.slug = chapterSlug(c.citation);
    if (seenChapter.has(c.slug)) throw new Error(`two chapters make the path ${c.slug}`);
    seenChapter.set(c.slug, c);
    c.path = `/${book.slug}/chapters/${c.slug}`;
  }
  const sections = chapters.flatMap((c) => c.sections);
  const byNumber = new Map();
  for (const s of sections) {
    const n = sectionSlug(s.citation);
    if (!byNumber.has(n)) byNumber.set(n, []);
    byNumber.get(n).push(s);
  }
  const shared = [];
  for (const [n, list] of byNumber) {
    if (list.length === 1) {
      list[0].slug = n;
    } else {
      for (const s of list) s.slug = `${n}-${s.id}`;
      shared.push({ number: n, citation: list[0].citation, path: `/${book.slug}/sections/${n}`, sections: list });
    }
  }
  for (const s of sections) s.path = `/${book.slug}/sections/${s.slug}`;
  const paths = new Set();
  for (const r of [...chapters, ...sections]) {
    if (paths.has(r.path)) throw new Error(`two pages share the path ${r.path}`);
    paths.add(r.path);
  }

  // Display names and neighbors, in document order.
  for (const r of records) {
    r.title = shortHeading(r);
    r.fullCitation = `${book.label} ${r.citation}`;
  }
  sections.forEach((s, i) => {
    s.prev = sections[i - 1] ?? null;
    s.next = sections[i + 1] ?? null;
  });
  chapters.forEach((c, i) => {
    c.prev = chapters[i - 1] ?? null;
    c.next = chapters[i + 1] ?? null;
  });

  return {
    corpus,
    book,
    version: v,
    indexSha256: sha,
    records,
    byId,
    chapters,
    sections,
    shared,
    /** Document order: each chapter, then its sections. */
    ordered: chapters.flatMap((c) => [c, ...c.sections]),
  };
}

/**
 * Where a cross-reference goes on this site, or null to leave it as plain text: a link the
 * structure marks unresolved or ambiguous, a link into a book the site does not have yet,
 * an attached file, or a web address that is not http(s).
 */
export function linkHref(to, book, current) {
  if (!to) return null;
  if (to.kind === "web") return /^https?:\/\//i.test(to.url ?? "") ? to.url : null;
  if (to.kind) return null; // "file": attached files are not on the site
  if (to.resolved === false || to.ambiguous) return null;
  if (to.corpus !== book.corpus || !to.id) return null;
  const target = book.byId.get(to.id);
  if (!target || !target.path) return null;
  const frag = to.anchor ? `#${to.anchor}` : "";
  if (target === current) return frag || null;
  return target.path + frag;
}
