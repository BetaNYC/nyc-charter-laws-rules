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
import { citeWithAnchor } from "../../../site/assets/jump.js";

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
  if (book.titles) return layoutTitled({ corpus, book, v, sha, records, byId, groups: structure.groups ?? {} });

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
  // Another book links only when the build has it too (book.others, set by build.js when it
  // builds more than one book); a Charter-only build leaves those references as plain text.
  const home = to.corpus === book.corpus ? book : book.others?.get(to.corpus);
  if (!home || !to.id) return null;
  const target = home.byId.get(to.id);
  if (!target || !target.path) return null;
  const frag = to.anchor ? `#${to.anchor}` : "";
  if (target === current) return frag || null;
  return target.path + frag;
}

/** A cross-reference's address and the name of what it points at ("NYC Charter § 8(a)"), or null. */
export function linkTarget(to, book, current) {
  const href = linkHref(to, book, current);
  if (!href) return null;
  if (to.kind === "web") return { href };
  const home = to.corpus === book.corpus ? book : book.others.get(to.corpus);
  const target = home.byId.get(to.id);
  // A target that shares its citation (an Admin Code shared number) adds what tells it apart, so
  // two links with the same words do not share a name and go to two places.
  return { href, label: `${citeWithAnchor(target.fullCitation, to.anchor)}${target.dupNote ? `, ${target.dupNote}` : ""}` };
}

// ---------------------------------------------------------------------------------------------
// The Administrative Code, titles first (issue #65).
//
// Titles. The publisher's own Title record is in each chapter's `parents` (data/structure
// titleStats: 31 from the chapter file, 316 from the chapter key, 42 with none). That is used
// first, because it is the only source of the lettered titles (16-A, 16-B, 20-A, 21-A), whose
// sections are numbered in the parent title (§ 16-501 is in Title 16-A). get_title's rule
// (src/corpus.ts adminCodeTitle: the title most of a chapter's § sections are numbered in) is
// the cross-check, and the fallback for a chapter with no Title record: a chapter whose publisher
// title and numbering disagree stops the build, except that a lettered title may be numbered in
// its parent. The 42 chapters with neither are the publisher's local-law chapters, one per year
// ("2016", holding "L.L. 2016/002" ...); they go in one group of their own, LOCAL_LAWS.
//
// Parts. A chapter (or a title's own sections) whose full text would pass PART_MAX_SECTIONS
// sections or PART_MAX_CHARS characters of law text is split, in order, into parts of at most
// that size (a single section larger than the cap gets a part to itself).

/** get_title's rule, src/corpus.ts ADMIN_CODE_TITLE: the title a § citation is numbered in. */
export const ADMIN_CODE_TITLE = /^§ (\d+[A-Za-z]?)-/;

/** src/corpus.ts adminCodeTitle: the title most of these sections are numbered in, or null. */
export function adminCodeTitle(sections) {
  const counts = new Map();
  for (const s of sections) {
    const m = ADMIN_CODE_TITLE.exec(s.citation);
    if (m) counts.set(m[1], (counts.get(m[1]) ?? 0) + 1);
  }
  let best = null;
  for (const [t, n] of counts) if (best === null || n > counts.get(best)) best = t;
  return best;
}

/** Most sections a part holds. */
export const PART_MAX_SECTIONS = 100;
/** Most characters of law text (the index's `text`) a part holds: about 300 KB of HTML. */
export const PART_MAX_CHARS = 150_000;

/** Split sections, in order, into runs of at most maxSections and maxChars (one oversized section stands alone). */
export function splitIntoParts(sections, { maxSections = PART_MAX_SECTIONS, maxChars = PART_MAX_CHARS } = {}) {
  const parts = [];
  let cur = [];
  let chars = 0;
  for (const s of sections) {
    const n = (s.text ?? "").length;
    if (cur.length && (cur.length >= maxSections || chars + n > maxChars)) {
      parts.push(cur);
      cur = [];
      chars = 0;
    }
    cur.push(s);
    chars += n;
  }
  if (cur.length) parts.push(cur);
  return parts;
}

/**
 * A path segment for any section citation. "§ 28-101.1" → "28-101.1" (sectionSlug, as the
 * Charter), "L.L. 2016/002" → "ll-2016-002", "Section FC 101" → "fc-101", anything else
 * lowercased with each run of other characters made one hyphen.
 */
export function anySectionSlug(citation) {
  if (/^§\s*\S+$/.test(citation)) return sectionSlug(citation);
  const slug = String(citation)
    .toLowerCase()
    .replace(/^section\s+/, "")
    .replace(/^l\.l\.\s*/, "ll-")
    .replace(/[^0-9a-z.]+/g, "-")
    .replace(/^[-.]+|[-.]+$/g, "");
  if (!SLUG_SAFE.test(slug)) throw new Error(`section citation "${citation}" does not make a safe path`);
  return slug;
}

/**
 * An Admin Code heading without its citation: "§ 11-601 Definitions." → "Definitions";
 * "Section EC 80: General" → "General"; "Chapter 9. Career ..." → "Career ..."; "Section 110.1"
 * (cited "§ 110.1") → "". An empty result means the heading is only the citation.
 */
export function adminShortHeading(record) {
  let h = String(record.heading ?? "").trim();
  if (record.level && record.level !== "Section" && record.level !== "Chapter") return groupShortHeading(h, record.citation);
  if (h.startsWith(record.citation)) h = h.slice(record.citation.length);
  else if (/^§\s/.test(record.citation)) h = h.replace(/^Section\s+\S+/, "");
  return h.replace(/^[\s.:–-]+/, "").replace(/\.$/, "").trim();
}

const foldDashes = (s) => s.replace(/[–—]/g, "-").toLowerCase();

/**
 * A group record's heading without its label (issue #78). The citation's last label ("RS 18-1",
 * or "Chapter 1" in "RS 13-1, Chapter 1") is found at the start of the heading, dashes and case
 * aside, or after "REFERENCE STANDARD": "REFERENCE STANDARD RS 10–9 PLYWOOD CONSTRUCTION" →
 * "PLYWOOD CONSTRUCTION", "REFERENCE STANDARD RS 18–1" → "", "CHAPTER 1 – GENERAL" → "GENERAL",
 * "Part I – Definitions" → "Definitions". A heading with no label, which ends the citation
 * ("Title 15, Chapter 20, Appendix"), → "".
 * A heading with no label found is kept whole.
 */
export function groupShortHeading(heading, citation) {
  const own = String(citation).split(", ").pop();
  const folded = foldDashes(heading);
  for (const label of new Set([own, own.replace(/^RS /, "")])) {
    for (const prefix of ["", "reference standard "]) {
      const start = prefix + foldDashes(label);
      if (folded.startsWith(start) && /^(?:$|[\s.:;,*()[\]–—-])/.test(heading.slice(start.length))) {
        return heading.slice(start.length).replace(/^[\s.:;,*–—-]+/, "").replace(/\.$/, "").trim();
      }
    }
  }
  // A heading with no label ends the citation ("Title 15, Chapter 20, Appendix").
  const whole = heading.replace(/\.$/, "").trim();
  return citation === whole || citation.endsWith(`, ${whole}`) ? "" : whole;
}

/** A section as lists name it: "§ 11-601. Definitions", or the citation alone when it has no heading. */
export function lineOf(s) {
  return s.title ? `${s.citation}. ${s.title}` : s.citation;
}

/**
 * What tells a section apart from others with the same citation and heading: the chapter it is
 * in, when theirs differ; else the innermost of the publisher's groups around it (an Appendix, a
 * Part) that the others are not in; else American Legal's record id.
 */
export function tellApart(s, same, groups) {
  const holder = (x) => x.chapter?.longName ?? x.chapter?.name ?? "";
  if (same.every((o) => o === s || holder(o) !== holder(s)) && holder(s)) return holder(s);
  const headings = (x) => x.structure.parents.map((p) => groups[p]?.heading).filter(Boolean);
  const others = new Set(same.filter((o) => o !== s).flatMap(headings));
  const own = [...headings(s)].reverse().find((h) => !others.has(h));
  return own ?? `American Legal id ${s.id}`;
}

/** "16-A" → [16, "A"], for ordering titles. */
function titleKey(number) {
  const m = /^(\d+)(?:-([A-Z]+))?$/i.exec(number);
  return m ? [0, Number(m[1]), (m[2] ?? "").toUpperCase()] : [1, 0, number];
}

/** Admin Code chapter order inside a title: "Chapter 2-A" → [1, 2, "A"]; a year "2016" → [1, 2016, ""]. */
export function adminChapterKey(citation) {
  const m = /^(?:Chapter )?(\d+)(?:-([A-Za-z]+))?$/.exec(citation);
  return m ? [1, Number(m[1]), (m[2] ?? "").toUpperCase()] : [2, 0, citation];
}

/** The group for the local-law chapters, which have no Title record and no § numbering. Its name is BetaNYC's. */
export const LOCAL_LAWS = { slug: "local-laws", citation: "Local laws", title: "Local laws by year" };

function layoutTitled({ corpus, book, v, sha, records, byId, groups }) {
  const chapterRecs = records.filter((r) => r.level === "Chapter");
  const chapterIds = new Set(chapterRecs.map((c) => c.id));
  const titles = new Map(); // number → title node
  const titleNode = (number, groupId) => {
    if (!titles.has(number)) {
      const g = groupId ? groups[groupId] : null;
      const heading = g?.heading ?? "";
      const t =
        number === LOCAL_LAWS.slug
          ? { ...LOCAL_LAWS, synthetic: true }
          : { citation: `Title ${number}`, title: heading.replace(/^Title\s+\S+?:\s*/, "").trim() || `Title ${number}`, slug: number.toLowerCase() };
      Object.assign(t, { kind: "title", id: groupId ?? `title-${t.slug}`, number, chapters: [], sections: [], fullCitation: `${book.label} ${t.citation}` });
      t.path = `/${book.slug}/titles/${t.slug}`;
      titles.set(number, t);
    } else if (groupId && !titles.get(number).id.startsWith("0-")) {
      titles.get(number).id = groupId;
    }
    return titles.get(number);
  };

  // Sections into chapters, or straight into a title (Title 31's sections sit in no chapter).
  for (const c of chapterRecs) c.sections = [];
  const direct = new Map(); // title group id → sections
  for (const r of records) {
    if (r.level === "Chapter") continue;
    const parent = [...r.structure.parents].reverse().find((p) => chapterIds.has(p));
    if (parent) {
      r.chapter = byId.get(parent);
      r.chapter.sections.push(r);
      continue;
    }
    const tg = [...r.structure.parents].reverse().find((p) => groups[p]?.level === "Title");
    if (!tg) throw new Error(`${r.citation} (${r.id}) sits in no chapter or title; the ${corpus} site cannot place it`);
    if (!direct.has(tg)) direct.set(tg, []);
    direct.get(tg).push(r);
  }

  // Chapters into titles.
  const titleNotes = [];
  for (const c of chapterRecs) {
    const tg = c.structure.parents.find((p) => groups[p]?.level === "Title");
    const fromRecord = tg ? groups[tg].label.replace(/^Title\s+/, "") : null;
    const fromNumbers = adminCodeTitle(c.sections);
    if (fromRecord && fromNumbers) {
      const same = fromRecord.toLowerCase() === fromNumbers.toLowerCase();
      const parent = fromRecord.replace(/-[A-Z]+$/i, "").toLowerCase() === fromNumbers.toLowerCase();
      if (!same && !parent) throw new Error(`${c.heading} (${c.id}): the publisher puts it in Title ${fromRecord}, its sections are numbered in Title ${fromNumbers}`);
      if (!same) titleNotes.push({ chapter: c.id, record: fromRecord, numbers: fromNumbers });
    }
    const number = fromRecord ?? fromNumbers;
    let t;
    if (number) t = titleNode(number, tg ?? null);
    else if (/^\d{4}$/.test(c.citation)) t = titleNode(LOCAL_LAWS.slug, null);
    else throw new Error(`${c.heading} (${c.id}) has no title, and its sections name none`);
    c.titleNode = t;
    t.chapters.push(c);
  }
  for (const [tg, list] of direct) {
    const t = titleNode(groups[tg].label.replace(/^Title\s+/, ""), tg);
    t.sections = list;
    for (const s of list) s.chapter = t;
  }

  const titleList = [...titles.values()].sort((a, b) => compareKeys(titleKey(a.number), titleKey(b.number)));
  for (const t of titleList) {
    t.chapters.sort((a, b) => compareKeys(adminChapterKey(a.citation), adminChapterKey(b.citation)) || a.order - b.order);
    if (!SLUG_SAFE.test(t.slug)) throw new Error(`title "${t.citation}" does not make a safe path`);
  }

  // Chapter paths, under their title. Two chapters of one title with one number (four pairs in
  // the publisher's file, each marked "*") each get the number plus American Legal's id.
  for (const t of titleList) {
    const bySlug = new Map();
    for (const c of t.chapters) {
      const n = chapterSlug(c.citation);
      if (!bySlug.has(n)) bySlug.set(n, []);
      bySlug.get(n).push(c);
    }
    for (const [n, list] of bySlug) for (const c of list) c.slug = list.length === 1 ? n : `${n}-${c.id}`;
    for (const c of t.chapters) c.path = `${t.path}/chapters/${c.slug}`;
  }

  // Display names. A chapter's number repeats across titles, so its long name and citation carry its title.
  for (const r of records) r.title = adminShortHeading(r);
  for (const t of titleList) {
    t.name = t.synthetic ? t.title : `${t.citation}: ${t.title}`;
    t.longName = t.name;
    for (const c of t.chapters) {
      c.name = c.title ? `${c.citation}: ${c.title}` : c.citation;
      c.longName = `${t.citation}, ${c.name}`;
      c.fullCitation = `${book.label} ${t.citation}, ${c.citation}`;
    }
  }

  // Document order: each title's own sections, then its chapters, each followed by its sections.
  const holders = titleList.flatMap((t) => [...(t.sections.length ? [t] : []), ...t.chapters]);
  const sections = holders.flatMap((h) => h.sections);
  const chapters = titleList.flatMap((t) => t.chapters);

  // Section paths: as the Charter's, one segment from the citation; shared numbers get the id.
  const byNumber = new Map();
  for (const s of sections) {
    const n = anySectionSlug(s.citation);
    if (!byNumber.has(n)) byNumber.set(n, []);
    byNumber.get(n).push(s);
  }
  const shared = [];
  for (const [n, list] of byNumber) {
    if (list.length === 1) list[0].slug = n;
    else {
      for (const s of list) s.slug = `${n}-${s.id}`;
      shared.push({ number: n, citation: list[0].citation, path: `/${book.slug}/sections/${n}`, sections: list });
    }
  }
  for (const s of sections) {
    s.path = `/${book.slug}/sections/${s.slug}`;
    s.fullCitation = `${book.label} ${s.citation}`;
    s.line = lineOf(s);
  }
  // Sections that share a number: `dupNote` tells each apart (its heading, when the headings
  // differ; else its chapter, the publisher's group around it, or American Legal's id), and
  // `line`, the name every list gives it, carries the note when the heading alone does not.
  for (const sh of shared) {
    for (const s of sh.sections) {
      const same = sh.sections.filter((o) => lineOf(o) === lineOf(s));
      if (same.length === 1) {
        s.dupNote = s.title || null;
        continue;
      }
      s.dupNote = tellApart(s, same, groups);
      s.line = `${lineOf(s)} (${s.dupNote})`;
    }
  }

  // Parts.
  for (const h of holders) {
    const runs = splitIntoParts(h.sections);
    if (runs.length < 2) {
      h.parts = null;
      continue;
    }
    h.parts = runs.map((list, i) => ({
      n: i + 1,
      of: runs.length,
      holder: h,
      sections: list,
      path: `${h.path}/parts/${i + 1}`,
    }));
    for (const p of h.parts) {
      p.name = `Part ${p.n} of ${p.of}: ${p.sections[0].citation}${p.sections.length > 1 ? ` to ${p.sections[p.sections.length - 1].citation}` : ""}`;
      for (const s of p.sections) s.part = p;
    }
    h.parts.forEach((p, i) => {
      p.prev = h.parts[i - 1] ?? null;
      p.next = h.parts[i + 1] ?? null;
    });
  }

  const paths = new Set();
  const parts = holders.flatMap((h) => h.parts ?? []);
  for (const r of [...titleList, ...chapters, ...sections, ...parts, ...shared]) {
    if (paths.has(r.path)) throw new Error(`two pages share the path ${r.path}`);
    paths.add(r.path);
  }

  sections.forEach((s, i) => {
    s.prev = sections[i - 1] ?? null;
    s.next = sections[i + 1] ?? null;
  });
  chapters.forEach((c, i) => {
    c.prev = chapters[i - 1] ?? null;
    c.next = chapters[i + 1] ?? null;
  });
  titleList.forEach((t, i) => {
    t.prev = titleList[i - 1] ?? null;
    t.next = titleList[i + 1] ?? null;
  });
  // Links to a Title heading (group: true) go to the title's page.
  for (const t of titleList) if (!byId.has(t.id)) byId.set(t.id, t);

  return {
    corpus,
    book,
    version: v,
    indexSha256: sha,
    records,
    byId,
    titles: titleList,
    titleNotes,
    chapters,
    sections,
    shared,
    parts,
    /** Document order of the index's records: each chapter, then its sections (a title's own sections first). */
    ordered: titleList.flatMap((t) => [...t.sections, ...t.chapters.flatMap((c) => [c, ...c.sections])]),
  };
}
