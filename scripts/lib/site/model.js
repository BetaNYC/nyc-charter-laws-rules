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

  // `indexLevel` keeps the index's own level ("Chapter", a group's level, or none for a section in
  // a chapter), which src/corpus.ts reads; `level` is the structure's, set on every record.
  const records = index.map((r, i) => ({ ...r, indexLevel: r.level, level: structure.sections[i].level, structure: structure.sections[i], order: i }));
  const byId = new Map(records.map((r) => [r.id, r]));
  if (book.rcny) return layoutRules({ corpus, book, v, sha, records, byId, groups: structure.groups ?? {} });
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

/**
 * Chapter order inside a title (the Administrative Code's and the Rules'): "Chapter 2-A" →
 * [1, 2, 0, "A"]; "Chapter 19A" → [1, 19, 0, "A"]; "Chapter 19.1" → [1, 19, 1, ""]; a year
 * "2016" → [1, 2016, 0, ""]. So Chapter 19, 19A and 19.1 come after Chapter 19 and before Chapter
 * 20, as the publisher lists them (Rules Titles 24 and 15). Other citations (the Health Code, the
 * yearly orders, appendices) come after the numbered chapters, in alphabetical order.
 */
export function adminChapterKey(citation) {
  const m = /^(?:Chapter )?(\d+)(?:\.(\d+))?(?:-?([A-Za-z]+))?$/.exec(citation);
  return m ? [1, Number(m[1]), m[2] === undefined ? 0 : Number(m[2]), (m[3] ?? "").toUpperCase()] : [2, 0, 0, citation];
}

/**
 * Chapter paths in a title: the chapter's number (`slugOf`), and, for a number the title gives
 * two chapters (the Administrative Code's starred pairs, Title 43 of the Rules' two Chapter 15s),
 * each one's number plus American Legal's id, and a page at the plain path to pick one
 * (`sharedChapters`, as for sections). The plain path never goes away: a number that becomes
 * shared turns its page into the page to pick one, so an old link still reaches the chapter, and
 * an id-suffixed path that loses its pair lands through the 404 page (its id is in redirects.json).
 */
function chapterPaths(t, slugOf, shared) {
  const bySlug = new Map();
  for (const c of t.chapters) {
    const n = slugOf(c.citation);
    if (!bySlug.has(n)) bySlug.set(n, []);
    bySlug.get(n).push(c);
  }
  for (const [n, list] of bySlug) {
    for (const c of list) c.slug = list.length === 1 ? n : `${n}-${c.id}`;
    if (list.length > 1) shared.push({ number: n, title: t, citation: list[0].citation, path: `${t.path}/chapters/${n}`, chapters: list });
  }
  for (const c of t.chapters) c.path = `${t.path}/chapters/${c.slug}`;
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
  const sharedChapters = [];
  for (const t of titleList) chapterPaths(t, chapterSlug, sharedChapters);

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
  for (const r of [...titleList, ...chapters, ...sections, ...parts, ...shared, ...sharedChapters]) {
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
    sharedChapters,
    parts,
    /** Document order of the index's records: each chapter, then its sections (a title's own sections first). */
    ordered: titleList.flatMap((t) => [...t.sections, ...t.chapters.flatMap((c) => [c, ...c.sections])]),
  };
}

// ---------------------------------------------------------------------------------------------
// The Rules of the City of New York, titles first (issue #65, after #59).
//
// Each title restarts its chapter and section numbers: about fifty titles have a § 1-01. So
// everything here is per title, and the title is each record's `titleNumber` (the index has it
// since 0.6.3), not the structure's Title parent: 24 chapters have none (the Health Code in Title
// 24, the Rent Guidelines Board's yearly orders in Title 30, Appendix A to Title 62, Title 3's
// Chapter 11).
//
// Paths:
//   /rules/titles/15                              a title
//   /rules/titles/15/chapters/1                   a chapter ("Chapter 1"; other chapter citations
//                                                 are slugged: /rules/titles/24/chapters/new-york-city-health-code)
//   /rules/titles/24/chapters/<c>/parts/2         part 2 of a split chapter
//   /rules/titles/15/sections/1-01                a section: the title's number, then the section's
//   /rules/titles/30/sections/notice              a number the title repeats (the yearly orders'
//                                                 "Notice"): a page to pick one; each record is the
//                                                 number plus American Legal's id, as the Admin Code's
//   /rules/sections/1-01                          a number in more than one title: a page to pick one
//
// Citations: rulesCitation, the form src/corpus.ts fullCitation gives, written the way the Rules
// are cited: "15 RCNY § 1-01", "24 RCNY Health Code § 81.08", "15 RCNY Chapter 18", and, where a
// title repeats a citation, with its chapter: "30 RCNY Apartment & Loft Order #49 (2017), Notice".
// get_section takes each of them (test/site-data/rules-layout.test.js checks every record).

/** True when every record of a Rules index names its title; false when none does. Mixed stops the build. */
export function rulesReady(index) {
  const titled = index.filter((r) => r.titleNumber).length;
  if (titled === 0) return false;
  if (titled !== index.length) throw new Error(`the Rules index names a title on ${titled} of ${index.length} records; rebuild it with npm run build-index`);
  return true;
}

// src/corpus.ts HEALTH_CODE_HEADING: the Health Code's chapter record, in Title 24.
const HEALTH_CODE_HEADING = /^(?:the\s+)?(?:new york city\s+)?health code$/i;

// src/corpus.ts normalizeCitation, then citationKey (commas as spaces).
const citationKey = (c) =>
  String(c)
    .toLowerCase()
    .replace(/[‐-―−]/g, "-")
    .replace(/§§?\s*/g, "")
    .replace(/^section\s+/, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\s*,\s*/g, " ");

// src/corpus.ts titledCitation, for the Rules.
function titledRuleCitation(r, healthCode) {
  const t = r.titleNumber;
  if (/^title\s/i.test(r.citation)) return r.citation;
  if (r.citation.startsWith("§")) return `${t} RCNY ${healthCode ? "Health Code " : ""}${r.citation}`;
  return `Title ${t}, ${r.citation}`;
}

/** "Title 15, Chapter 18" → "15 RCNY Chapter 18"; a citation that already says "RCNY" is kept. */
export function rcnyForm(citation, titleNumber) {
  const prefix = `Title ${titleNumber}, `;
  return citation.startsWith(prefix) ? `${titleNumber} RCNY ${citation.slice(prefix.length)}` : citation;
}

/**
 * Every Rules record's citation (Map id → citation), as src/corpus.ts fullCitation gives it, in
 * the RCNY form. `records` in index order; `chapterOf` is the chapter record each sits in.
 */
export function rulesCitations(records, chapterOf) {
  const healthCode = new Set();
  let inside = false;
  for (const r of records) {
    if (r.indexLevel === "Chapter") inside = HEALTH_CODE_HEADING.test(r.heading.trim());
    if (inside) healthCode.add(r.id);
  }
  const own = new Map(records.map((r) => [r.id, titledRuleCitation(r, healthCode.has(r.id))]));
  const counts = new Map();
  for (const c of own.values()) counts.set(citationKey(c), (counts.get(citationKey(c)) ?? 0) + 1);
  const out = new Map();
  for (const r of records) {
    let c = own.get(r.id);
    const ch = chapterOf(r);
    if ((counts.get(citationKey(c)) ?? 0) >= 2 && ch) c = `Title ${r.titleNumber}, ${ch.citation}, ${r.citation}`;
    // A record whose own citation starts with its title ("Title 6, Chapter 2, Subchapter B", a
    // group record) keeps it: get_section finds it by that citation, not by "6 RCNY Chapter 2, ...".
    out.set(r.id, /^title\s/i.test(r.citation) ? c : rcnyForm(c, r.titleNumber));
  }
  return { citations: out, healthCode };
}

/**
 * What a Rules record is called inside its own title and chapter: "Title 19, Chapter 55,
 * Schedule A" in Title 19's Chapter 55 is "Schedule A"; "New York City Health Code, Title III,
 * Article 48" in the Health Code is "Title III, Article 48". Section citations are unchanged.
 */
export function localCitation(citation, titleNumber, chapter) {
  let c = String(citation);
  const t = `Title ${titleNumber}, `;
  if (c.toLowerCase().startsWith(t.toLowerCase())) c = c.slice(t.length);
  if (chapter && c.startsWith(`${chapter.citation}, `)) c = c.slice(chapter.citation.length + 2);
  return c;
}

/** A Rules chapter's path segment: "Chapter 18" → "18"; "Apartment & Loft Order #49 (2017)" → "apartment-loft-order-49-2017". */
export function rulesChapterSlug(citation) {
  const m = /^Chapter (\S+)$/.exec(citation);
  if (m && SLUG_SAFE.test(m[1].toLowerCase())) return m[1].toLowerCase();
  return anySectionSlug(citation);
}

function layoutRules({ corpus, book, v, sha, records, byId, groups }) {
  const chapterRecs = records.filter((r) => r.level === "Chapter");
  const chapterIds = new Set(chapterRecs.map((c) => c.id));
  for (const r of records) if (!r.titleNumber) throw new Error(`${r.citation} (${r.id}) has no titleNumber; the Rules site needs an index built by 0.6.3 or later`);

  // The Title records, by number: their headings name the titles, and their ids link to American Legal.
  const titleGroups = new Map();
  for (const [id, g] of Object.entries(groups)) {
    if (g.level !== "Title") continue;
    const n = String(g.label ?? "").replace(/^Title\s+/, "");
    if (n && !titleGroups.has(n)) titleGroups.set(n, { id, heading: g.heading });
  }
  const titles = new Map();
  const titleNode = (number) => {
    if (!titles.has(number)) {
      const g = titleGroups.get(number);
      const heading = g?.heading ?? chapterRecs.find((c) => c.titleNumber === number && c.titleHeading)?.titleHeading ?? "";
      const slug = number.toLowerCase();
      if (!SLUG_SAFE.test(slug)) throw new Error(`Rules title "${number}" does not make a safe path`);
      const t = {
        kind: "title",
        id: g?.id ?? `title-${slug}`,
        number,
        slug,
        citation: `Title ${number}`,
        title: heading.replace(/^Title\s+\S+?:\s*/, "").trim() || `Title ${number}`,
        fullCitation: `${book.label} Title ${number}`,
        chapters: [],
        sections: [],
        path: `/${book.slug}/titles/${slug}`,
      };
      titles.set(number, t);
    }
    return titles.get(number);
  };

  // Sections into their chapter (the structure's parents); a record in no chapter goes straight
  // into its title (none in July 2026, but a title's own sections are laid out as the Admin Code's).
  for (const c of chapterRecs) {
    c.sections = [];
    c.titleNode = titleNode(c.titleNumber);
    c.titleNode.chapters.push(c);
  }
  for (const r of records) {
    if (r.level === "Chapter") continue;
    const parent = [...r.structure.parents].reverse().find((p) => chapterIds.has(p));
    if (parent) {
      r.chapter = byId.get(parent);
      if (r.chapter.titleNumber !== r.titleNumber) throw new Error(`${r.citation} (${r.id}) is in Title ${r.titleNumber}, its chapter ${r.chapter.citation} in Title ${r.chapter.titleNumber}`);
      r.chapter.sections.push(r);
    } else {
      const t = titleNode(r.titleNumber);
      t.sections.push(r);
      r.chapter = t;
    }
  }

  const titleList = [...titles.values()].sort((a, b) => compareKeys(titleKey(a.number), titleKey(b.number)));
  for (const t of titleList) t.chapters.sort((a, b) => compareKeys(adminChapterKey(a.citation), adminChapterKey(b.citation)) || a.order - b.order);

  // Citations (src/corpus.ts fullCitation), and what a record is called inside its chapter.
  const { citations, healthCode } = rulesCitations(records, (r) => (r.level === "Chapter" ? null : r.chapter?.kind === "title" ? null : r.chapter));
  for (const r of records) {
    r.fullCitation = citations.get(r.id);
    // How the page names the record in running text ("Read 15 RCNY § 1-01 at American Legal Publishing").
    r.citeAs = r.fullCitation;
    r.healthCode = healthCode.has(r.id);
    r.title = adminShortHeading(r);
    r.local = r.level === "Chapter" ? r.citation : localCitation(r.citation, r.titleNumber, r.chapter?.kind === "title" ? null : r.chapter);
  }

  // Chapter paths, under their title; two chapters of one title with one number get American Legal's id too.
  const sharedChapters = [];
  for (const t of titleList) {
    chapterPaths(t, rulesChapterSlug, sharedChapters);
    t.name = `${t.citation}: ${t.title}`;
    t.longName = t.name;
    t.synthetic = false;
    for (const c of t.chapters) {
      c.name = c.title ? `${c.citation}: ${c.title}` : c.citation;
      c.longName = `${t.citation}, ${c.name}`;
      c.searchTitle = c.title ? `${c.fullCitation}: ${c.title}` : c.fullCitation;
    }
  }

  // Document order: each title's own sections, then its chapters, each followed by its sections.
  const holders = titleList.flatMap((t) => [...(t.sections.length ? [t] : []), ...t.chapters]);
  const sections = holders.flatMap((h) => h.sections);
  const chapters = titleList.flatMap((t) => t.chapters);

  // Section paths, per title. A number the title repeats gets American Legal's id, and a page to
  // pick one at the plain path (`shared`); a number in more than one title gets a page to pick one
  // at /rules/sections/<number> (`picks`).
  const shared = [];
  const lineOfRule = (s) => (s.title ? `${s.local}. ${s.title}` : s.local);
  for (const t of titleList) {
    const own = [...t.sections, ...t.chapters.flatMap((c) => c.sections)];
    const byNumber = new Map();
    for (const s of own) {
      // A group record's path keeps its chapter ("chapter-2-subchapter-b"); its name in lists does not.
      const n = anySectionSlug(localCitation(s.citation, s.titleNumber, null));
      s.number = n;
      if (!byNumber.has(n)) byNumber.set(n, []);
      byNumber.get(n).push(s);
    }
    for (const [n, list] of byNumber) {
      if (list.length === 1) list[0].slug = n;
      else {
        for (const s of list) s.slug = `${n}-${s.id}`;
        shared.push({ number: n, title: t, citation: list[0].local, fullCitation: rcnyForm(`Title ${t.number}, ${localCitation(list[0].citation, t.number, null)}`, t.number).replace(/^(\S+ RCNY) (?=§)/, list.every((x) => x.healthCode) ? "$1 Health Code " : "$1 "), path: `${t.path}/sections/${n}`, sections: list });
      }
    }
    for (const s of own) s.path = `${t.path}/sections/${s.slug}`;
  }
  for (const s of sections) {
    s.line = lineOfRule(s);
    s.searchTitle = s.title ? `${s.fullCitation}. ${s.title}` : s.fullCitation;
  }
  for (const sh of shared) {
    for (const s of sh.sections) {
      const same = sh.sections.filter((o) => lineOfRule(o) === lineOfRule(s));
      if (same.length === 1) {
        s.dupNote = s.title || null;
        continue;
      }
      s.dupNote = tellApart(s, same, groups);
      s.line = `${lineOfRule(s)} (${s.dupNote})`;
    }
  }
  // A page's title: the citation and heading, and what tells it apart when another record has both.
  const named = new Map();
  for (const s of sections) {
    const k = s.title ? `${s.fullCitation}: ${s.title}` : s.fullCitation;
    named.set(k, (named.get(k) ?? 0) + 1);
  }
  for (const s of sections) {
    const k = s.title ? `${s.fullCitation}: ${s.title}` : s.fullCitation;
    s.pageName = named.get(k) > 1 ? `${k} (${s.dupNote ?? tellApart(s, sections.filter((o) => o.fullCitation === s.fullCitation), groups)})` : k;
  }
  for (const s of sections) s.titleNode = s.chapter.kind === "title" ? s.chapter : s.chapter.titleNode;
  const byBare = new Map();
  for (const s of sections) {
    if (!byBare.has(s.number)) byBare.set(s.number, []);
    byBare.get(s.number).push(s);
  }
  const picks = [];
  const numbers = {};
  for (const [n, list] of byBare) {
    const inTitles = new Set(list.map((s) => s.titleNumber));
    if (inTitles.size > 1) picks.push({ number: n, citation: localCitation(list[0].citation, list[0].titleNumber, null), path: `/${book.slug}/sections/${n}`, sections: list });
    // A number in one title: /rules/sections/<n> goes to its page (or its title's page to pick one), from not-found.js.
    else numbers[n] = list.length === 1 ? list[0].path : `${list[0].titleNode.path}/sections/${n}`;
  }

  // Parts.
  for (const h of holders) {
    const runs = splitIntoParts(h.sections);
    if (runs.length < 2) {
      h.parts = null;
      continue;
    }
    h.parts = runs.map((list, i) => ({ n: i + 1, of: runs.length, holder: h, sections: list, path: `${h.path}/parts/${i + 1}` }));
    for (const p of h.parts) {
      const first = p.sections[0].local;
      const last = p.sections[p.sections.length - 1].local;
      p.name = `Part ${p.n} of ${p.of}: ${first}${p.sections.length > 1 ? ` to ${last}` : ""}`;
      for (const s of p.sections) s.part = p;
    }
    h.parts.forEach((p, i) => {
      p.prev = h.parts[i - 1] ?? null;
      p.next = h.parts[i + 1] ?? null;
    });
  }

  const paths = new Set();
  const parts = holders.flatMap((h) => h.parts ?? []);
  for (const r of [...titleList, ...chapters, ...sections, ...parts, ...shared, ...picks, ...sharedChapters]) {
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
  for (const t of titleList) if (!byId.has(t.id)) byId.set(t.id, t);
  // A link to one of the publisher's groups that is not a record of its own (a Health Code
  // Article, a Subchapter) goes to the group's first section, named by its chapter and label.
  for (const s of sections) {
    for (const gid of s.structure.parents) {
      const g = groups[gid];
      if (byId.has(gid) || !g || g.level === "Title" || g.level === "Chapter") continue;
      byId.set(gid, { id: gid, group: true, path: s.path, fullCitation: `${s.chapter.fullCitation}, ${g.label ?? g.heading}` });
    }
  }

  return {
    corpus,
    book,
    version: v,
    indexSha256: sha,
    records,
    byId,
    titles: titleList,
    titleNotes: [],
    chapters,
    sections,
    shared,
    sharedChapters,
    picks,
    numbers,
    parts,
    ordered: titleList.flatMap((t) => [...t.sections, ...t.chapters.flatMap((c) => [c, ...c.sections])]),
  };
}
