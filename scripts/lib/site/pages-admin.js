// The Administrative Code's pages, titles first (issue #65).
// Pure, like pages.js: the build passes the book (model.js layoutTitled) and the site facts in.
//
// Paths:
//   /admin-code/                                   contents: one card per title
//   /admin-code/titles/28                          a title: its chapters (and its own sections, Title 31)
//   /admin-code/titles/28/chapters/1               a chapter: full text, or, when split, its parts
//   /admin-code/titles/27/chapters/1/parts/2       part 2 of a split chapter: that part's full text
//   /admin-code/sections/28-101.1                  a section (shared numbers as the Charter's)
//   /admin-code/contents/titles/28.json            a title's chapters, for the contents tree
//
// The contents tree lists only the 39 titles. The reader's title is open in the HTML, with its
// chapters; the reader's chapter is open to its sections, or, for a split chapter, to its parts,
// with the reader's part open to its sections. law.js adds a disclosure button before each title
// ("Chapters in Title 28: ...") that loads the title's chapters from its JSON file. Without
// JavaScript, each title is a link to the title's page, which lists its chapters.

import { renderSection, bodyBlocks } from "../render-section.js";
import { bodyHtml, copyId } from "./render-html.js";
import { page, breadcrumbs, breadcrumbJsonLd } from "./layout.js";
import { escapeHtml } from "./html.js";
import {
  HOME,
  fileFor,
  titleOf,
  describe,
  DESCRIPTION_MAX,
  legislationJsonLd,
  lawRecord,
  lawText,
  TOOLS,
  named,
  CONTENTS_NAME,
  sectionBody,
  copyLinkFor,
  searchMeta,
  searchKind,
} from "./pages.js";

const esc = escapeHtml;
const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;
/** "§ 11-601. Definitions", or the citation alone when the heading is only that. */
export const sectionLine = (x) => x.line ?? (x.title ? `${x.citation}. ${x.title}` : x.citation);
const withTitle = (cite, title) => (title ? `${cite}: ${title}` : cite);

/** Where the build writes a title's list of chapters for the contents tree. */
export function titleChaptersPath(book, t) {
  return `/${book.book.slug}/contents/titles/${t.slug}.json`;
}

/** A title's children for the tree, as law.js reads them: [[path, text], ...]. Its own sections (or parts), then its chapters. */
export function titleChaptersJson(t) {
  const own = t.sections.length ? (t.parts ? t.parts.map((p) => [p.path, p.name]) : t.sections.map((x) => [x.path, sectionLine(x)])) : [];
  return [...own, ...t.chapters.map((c) => [c.path, c.name])];
}

/** The book-and-title crumbs down to a holder (a chapter, or a title holding its own sections). */
export function crumbsTo(book, { title, chapter, part }) {
  const items = [HOME, { name: book.book.label, path: `/${book.book.slug}/` }];
  if (title) items.push({ name: title.citation, path: title.path });
  if (chapter && chapter !== title) items.push({ name: chapter.citation, path: chapter.path });
  if (part) items.push({ name: `Part ${part.n} of ${part.of}`, path: part.path });
  return items;
}

/**
 * The titles-first contents tree.
 * @param {object} book
 * @param {object} [at]
 * @param {object} [at.title]    the title to open
 * @param {object} [at.chapter]  the holder to open (a chapter, or the title itself for its own sections)
 * @param {object} [at.part]     the part to open
 * @param {object} [at.section]  the section this page shows
 * @param {string} [at.here]     this page's path (gets aria-current="page")
 */
export function titlesTree(book, { title = null, chapter = null, part = null, section = null, here = null } = {}) {
  const current = (path, inside) => (path === here ? ` aria-current="page"` : inside ? ` aria-current="true"` : "");
  const sectionItems = (list) =>
    `\n<ul>\n${list.map((x) => `<li><a href="${esc(x.path)}"${current(x.path, false)}>${esc(sectionLine(x))}</a></li>`).join("\n")}\n</ul>\n`;
  // The open holder's children: its parts (the reader's part open to its sections), or its sections.
  const holderItems = (h) => {
    if (!h.parts) return sectionItems(h.sections);
    return `\n<ul>\n${h.parts
      .map((p) => {
        const open = p === part;
        const inner = open ? sectionItems(p.sections) : "";
        return `<li${open ? ` class="open"` : ""}><a href="${esc(p.path)}"${current(p.path, open && !!section)}>${esc(p.name)}</a>${inner}</li>`;
      })
      .join("\n")}\n</ul>\n`;
  };
  const item = (t) => {
    const name = esc(t.name);
    const child = t.chapters.length ? "" : ` data-child="Sections"`;
    if (t !== title) return `<li${child}><a href="${esc(t.path)}">${name}</a></li>`;
    const own = t.sections.length ? (chapter === t ? holderItems(t).replace(/^\n<ul>\n|\n<\/ul>\n$/g, "") : t.parts ? t.parts.map((p) => `<li><a href="${esc(p.path)}">${esc(p.name)}</a></li>`).join("\n") : t.sections.map((x) => `<li><a href="${esc(x.path)}"${current(x.path, false)}>${esc(sectionLine(x))}</a></li>`).join("\n")) : "";
    const chapters = t.chapters
      .map((c) => {
        if (c !== chapter) return `<li><a href="${esc(c.path)}">${esc(c.name)}</a></li>`;
        return `<li class="open"><a href="${esc(c.path)}"${current(c.path, true)}>${esc(c.name)}</a>${c.sections.length ? holderItems(c) : ""}</li>`;
      })
      .join("\n");
    const inner = [own, chapters].filter(Boolean).join("\n");
    return `<li class="open"${child}><a href="${esc(t.path)}"${current(t.path, true)}>${name}</a>\n<ul id="toc-${esc(t.slug)}">\n${inner}\n</ul>\n</li>`;
  };
  return `<div class="toc" data-pagefind-ignore="all">
<details class="contents-fold">
<summary class="contents-summary"><span aria-hidden="true">&#9776; </span>${CONTENTS_NAME}</summary>
<nav class="contents-nav" id="contents" aria-labelledby="contents-h" data-sections="/${esc(book.book.slug)}/contents/titles/" data-child="Chapters">
<div class="contents-top"><h2 id="contents-h">${CONTENTS_NAME}</h2><button type="button" class="contents-hide" aria-label="Hide contents" hidden>Hide</button></div>
<p class="book"><a href="/${esc(book.book.slug)}/">${esc(book.book.name)}</a></p>
<p class="tree-status" role="status"></p>
<ul class="tree">
${book.titles.map(item).join("\n")}
</ul>
</nav>
</details>
</div>`;
}

/** A description for an Admin Code law page: citation, heading, where it sits, then its opening words if they fit. */
function adminDescription(record, where) {
  const FOR_RESEARCH_LEN = 52; // "BetaNYC's copy for research, not the official text."
  const room = DESCRIPTION_MAX - FOR_RESEARCH_LEN - 1;
  const base = `${record.fullCitation}${record.title ? `, ${record.title}` : ""}${where ? ` in ${where}` : ""}.`;
  if (base.length >= room - 20 || !record.text) return describe(base);
  const words = String(record.text).replace(/\s+/g, " ").trim();
  const max = room - base.length - 3;
  const cut = words.length <= max ? words : words.slice(0, max - 1).replace(/\s+\S*$/, "") + "…";
  return describe(`${base} "${cut}"`);
}

/** A copy of one section's text on a chapter, part or title page; links to sections on the same page stay on it. */
function sectionCopy(s, onPage, book, nameNote, site) {
  const blocks = bodyBlocks(renderSection(s, s.structure));
  const linkFor = copyLinkFor(s, (target) => onPage.has(target), book);
  return sectionBody(s, site, blocks.length ? `<div class="law">\n${bodyHtml(blocks, { fullCitation: s.fullCitation, linkFor, copyOf: s.slug, nameNote, headingLevel: 3 })}\n</div>` : "");
}

/** The jump list and full text of a run of sections (a whole holder or one part). */
function sectionsBody(list, book, heading, site) {
  if (!list.length) return { list: `<p>No sections here.</p>`, text: "" };
  const onPage = new Set(list);
  // Two sections on the page with one number: their controls' names add what tells them apart.
  const shared = (x) => (list.filter((y) => y.citation === x.citation).length > 1 ? x.dupNote ?? x.title : "");
  const jump = `<nav class="jump" aria-labelledby="sections" data-pagefind-ignore="all">
<h2 id="sections">${esc(heading)}</h2>
<ol class="contents">
${list.map((x) => `<li><a href="${esc(x.path)}">${esc(sectionLine(x))}</a></li>`).join("\n")}
</ol>
</nav>`;
  const text = `<div class="chapter-text" data-pagefind-ignore="all">
${list
  .map(
    (x) => `<div class="chapter-section" id="${esc(copyId(x.slug))}">
<h2>${esc(sectionLine(x))}</h2>
<p class="sec-tools"><a href="${esc(x.path)}" ${named("Open this section", x, shared(x))}>Open this section</a> <button type="button" class="copy-cite" data-cite="${esc(x.fullCitation)}" ${named("Copy citation", x, shared(x))} hidden>Copy citation</button> <span class="copy-status" role="status"></span></p>
${sectionCopy(x, onPage, book, shared(x), site)}
</div>`
  )
  .join("\n")}
<div class="back-wrap"><a class="back-to-contents" href="#sections">Back to contents</a></div>
</div>`;
  return { list: jump, text };
}

/** The list of a split holder's parts, with this page's part marked. */
function partsList(h, here, headingId = "parts") {
  return `<nav class="parts" aria-labelledby="${headingId}" data-pagefind-ignore="all">
<h2 id="${headingId}">Parts of ${esc(h.citation)}</h2>
<p>${esc(h.citation)} has ${plural(h.sections.length, "section")}, in ${h.parts.length} parts, so that no page is too long to load.</p>
<ol class="contents">
${h.parts.map((p) => `<li><a href="${esc(p.path)}"${p === here ? ` aria-current="page"` : ""}>${esc(p.name)}</a> <span class="count">(${plural(p.sections.length, "section")})</span></li>`).join("\n")}
</ol>
</nav>`;
}

function pager(label, prev, next, nameOf) {
  return `<nav class="pager" aria-label="${esc(label)}" data-pagefind-ignore="all">
${prev ? `<a class="prev" href="${esc(prev.path)}"><small>Previous</small> ${esc(nameOf(prev))}</a>` : ""}
${next ? `<a class="next" href="${esc(next.path)}"><small>Next</small> ${esc(nameOf(next))}</a>` : ""}
</nav>`;
}

export function citeHeading(cite, heading) {
  return heading ? `<h1><span class="cite">${esc(cite)}</span> <span class="heading">${esc(heading)}</span></h1>` : `<h1><span class="cite">${esc(cite)}</span></h1>`;
}

/** A section's page: as the Charter's, with the titles-first tree and title crumbs. */
export function adminSectionPage(s, book, site) {
  const holder = s.chapter;
  const found = searchKind(s);
  const title = holder.kind === "title" ? holder : holder.titleNode;
  const crumbs = [...crumbsTo(book, { title, chapter: holder, part: s.part }), { name: s.local ?? s.citation, path: s.path }];
  const main = [
    breadcrumbs(crumbs),
    `<article class="law-page" data-pagefind-body>`,
    citeHeading(s.fullCitation, s.title),
    TOOLS,
    sectionBody(s, site, lawText(s, book, { weightFor: found.weightFor })),
    `</article>`,
    pager("Previous and next section", s.prev, s.next, sectionLine),
  ].join("\n");
  return {
    path: s.path,
    file: fileFor(s.path),
    kind: "section",
    record: s,
    html: page({
      path: s.path,
      title: titleOf(s.pageName ?? withTitle(s.fullCitation, s.title)),
      description: adminDescription(s, holder.kind === "title" ? holder.citation : holder.longName.replace(/: .*$/, "")),
      main,
      aside: titlesTree(book, { title, chapter: holder, part: s.part, section: s, here: s.path }),
      here: s.part ? `${holder.longName ?? holder.name}, part ${s.part.n} of ${s.part.of}` : holder.longName ?? holder.name,
      nav: book.book.slug,
      lawRecord: lawRecord(s, site),
      site,
      // The Rules' search title is the full citation ("15 RCNY § 1-01. Scope"), never a bare "§ 1-01".
      headExtra: searchMeta(book, found.kind, s.searchTitle ?? sectionLine(s), s.fullCitation, found.label),
      jsonLd: [legislationJsonLd(s, book, site), breadcrumbJsonLd(crumbs)],
    }),
  };
}

/**
 * A chapter's page. Not split: its own text, the jump list and every section's full text, as the
 * Charter's chapter page. Split: its own text and the list of its parts; the text is on the parts.
 */
export function adminChapterPage(c, book, site) {
  const t = c.titleNode;
  const found = searchKind(c);
  const crumbs = crumbsTo(book, { title: t, chapter: c });
  const body = c.parts ? { list: partsList(c, null), text: "" } : sectionsBody(c.sections, book, `Sections in ${c.citation}`, site);
  const main = [
    breadcrumbs(crumbs),
    `<article class="law-page" data-pagefind-body>`,
    !c.title ? `<h1>${esc(c.fullCitation)}</h1>` : citeHeading(c.fullCitation, c.title),
    lawText(c, book, { weightFor: found.weightFor }),
    c.sections.length ? body.list : `<p>No sections in this chapter.</p>`,
    body.text,
    `</article>`,
    pager("Previous and next chapter", c.prev, c.next, (x) => x.longName),
  ].join("\n");
  return {
    path: c.path,
    file: fileFor(c.path),
    kind: "chapter",
    record: c,
    html: page({
      path: c.path,
      title: titleOf(`${c.fullCitation}${!c.title ? "" : `: ${c.title}`}`),
      description: describe(`${c.fullCitation}${!c.title ? "" : `, ${c.title}`}: ${plural(c.sections.length, "section")}${c.parts ? `, in ${c.parts.length} parts` : ""}.`),
      main,
      aside: titlesTree(book, { title: t, chapter: c, here: c.path }),
      here: c.longName,
      nav: book.book.slug,
      lawRecord: lawRecord(c, site),
      backToTop: c.sections.length === 0 || !!c.parts,
      site,
      headExtra: searchMeta(book, found.kind, c.searchTitle ?? c.longName, c.fullCitation, found.label),
      jsonLd: [legislationJsonLd(c, book, site), breadcrumbJsonLd(crumbs)],
    }),
  };
}

/** One part of a split chapter (or of a title's own sections): its sections' full text. Not indexed by search. */
export function adminPartPage(p, book, site) {
  const h = p.holder;
  const t = h.kind === "title" ? h : h.titleNode;
  const crumbs = crumbsTo(book, { title: t, chapter: h, part: p });
  const body = sectionsBody(p.sections, book, `Sections in part ${p.n}`, site);
  const holderCite = h.fullCitation;
  const main = [
    breadcrumbs(crumbs),
    `<article class="law-page">`,
    citeHeading(holderCite, `${!h.title ? "" : `${h.title}, `}part ${p.n} of ${p.of}`),
    `<p class="lede">${esc(p.name.replace(/^Part \d+ of \d+: /, ""))}: ${plural(p.sections.length, "section")}.</p>`,
    partsList(h, p),
    body.list,
    body.text,
    `</article>`,
    pager("Previous and next part", p.prev, p.next, (x) => x.name),
  ].join("\n");
  return {
    path: p.path,
    file: fileFor(p.path),
    kind: "part",
    html: page({
      path: p.path,
      title: titleOf(`${holderCite}${!h.title ? "" : `: ${h.title}`}, part ${p.n} of ${p.of}`),
      description: describe(`${holderCite}, part ${p.n} of ${p.of}: ${p.name.replace(/^Part \d+ of \d+: /, "")}.`),
      main,
      aside: titlesTree(book, { title: t, chapter: h, part: p, here: p.path }),
      here: `${h.longName ?? h.name}, part ${p.n} of ${p.of}`,
      nav: book.book.slug,
      backToTop: false,
      site,
      jsonLd: [breadcrumbJsonLd(crumbs)],
    }),
  };
}

/** A title's page: its chapters, as a plain list (the tree's no-JavaScript fallback), and its own sections if it has any. */
export function adminTitlePage(t, book, site) {
  const crumbs = crumbsTo(book, { title: t });
  const chapters = t.chapters.length
    ? `<h2 id="chapters">Chapters in ${esc(t.citation)}</h2>
<ol class="contents chapters">
${t.chapters
  .map((c) => `<li><a href="${esc(c.path)}">${esc(c.name)}</a> <span class="count">(${plural(c.sections.length, "section")}${c.parts ? `, in ${c.parts.length} parts` : ""})</span></li>`)
  .join("\n")}
</ol>`
    : "";
  let own = { list: "", text: "" };
  if (t.sections.length) own = t.parts ? { list: partsList(t, null), text: "" } : sectionsBody(t.sections, book, `Sections in ${t.citation}`, site);
  const main = [
    breadcrumbs(crumbs),
    t.synthetic ? `<h1>${esc(t.title)}</h1>` : citeHeading(t.fullCitation, t.title),
    t.synthetic ? `<p class="lede">American Legal Publishing files these local laws by the year they were enacted, outside the titles. BetaNYC groups them here; the group's name is ours.</p>` : "",
    chapters,
    own.list,
    own.text,
    pager("Previous and next title", t.prev, t.next, (x) => x.name),
  ].join("\n");
  return {
    path: t.path,
    file: fileFor(t.path),
    kind: "title",
    html: page({
      path: t.path,
      title: titleOf(t.synthetic ? `${book.book.label}: ${t.title}` : `${t.fullCitation}: ${t.title}`),
      description: describe(`${t.synthetic ? `${book.book.label}, ${t.title}` : `${t.fullCitation}, ${t.title}`}: ${plural(t.chapters.length, "chapter")}${t.sections.length ? `, ${plural(t.sections.length, "section")}` : ""}.`),
      main,
      aside: titlesTree(book, { title: t, chapter: t.sections.length ? t : null, here: t.path }),
      here: t.name,
      nav: book.book.slug,
      lawRecord: t.id.startsWith("0-") ? { citation: t.fullCitation, url: `${site.officialBase}${encodeURIComponent(t.id)}` } : undefined,
      backToTop: !own.text,
      site,
      jsonLd: [breadcrumbJsonLd(crumbs)],
    }),
  };
}

/**
 * The Admin Code's front page (Noel, 2026-11-23): one card per title, and nothing else. Each card
 * is one link: the title's number (read as "Title 3", with "Title " visually hidden), its name,
 * and how many chapters it has. "Local laws by year" comes last, with no number. The chapters are
 * on each title's page; this page lists none of them.
 */
export function titleCard(t) {
  const num = t.synthetic ? "" : `<span class="vh">Title </span>${esc(t.number)}`;
  const count = t.chapters.length ? plural(t.chapters.length, "chapter") : plural(t.sections.length, "section");
  return `<li><a href="${esc(t.path)}"><span class="tc-top"><span class="tc-num">${num}</span><span class="tc-name">${esc(t.title)}</span><span class="tc-count">${count}</span></span></a></li>`;
}

export function adminContentsPage(book, site) {
  const path = `/${book.book.slug}/`;
  const crumbs = [HOME, { name: book.book.label, path }];
  const numbered = book.titles.filter((t) => !t.synthetic).length;
  const byYear = book.titles.length > numbered ? " plus local laws by year" : "";
  const n = (x) => x.toLocaleString("en-US");
  const main = [
    breadcrumbs(crumbs),
    `<h1>${esc(book.book.name)}</h1>`,
    `<p class="lede">Pick a title to see its chapters. ${numbered} titles${byYear}: ${n(book.chapters.length)} chapters, ${n(book.sections.length)} sections.</p>`,
    `<ol class="title-cards">`,
    ...book.titles.map(titleCard),
    `</ol>`,
  ].join("\n");
  return {
    path,
    file: fileFor(path),
    kind: "contents",
    html: page({
      path,
      title: titleOf(`${book.book.name}: contents`),
      description: describe(`The ${numbered} titles of the ${book.book.name}${byYear}: pick one to see its chapters, then read any section on its own page.`),
      main,
      nav: book.book.slug,
      navPage: true,
      site,
      jsonLd: [breadcrumbJsonLd(crumbs)],
    }),
  };
}

/** A short page for a section number two sections share. */
export function adminSharedNumberPage(sh, book, site) {
  const crumbs = [HOME, { name: book.book.label, path: `/${book.book.slug}/` }, { name: sh.citation, path: sh.path }];
  const where = (s) => (s.chapter.kind === "title" ? s.chapter.citation : s.chapter.longName.replace(/: .*$/, ""));
  const main = [
    breadcrumbs(crumbs),
    citeHeading(`${book.book.label} ${sh.citation}`, `${sh.sections.length} sections have this number`),
    `<p>The ${esc(book.book.short)} has ${sh.sections.length} sections numbered ${esc(sh.citation)}. Pick one:</p>`,
    `<ul class="contents">`,
    ...sh.sections.map((s) => `<li><a href="${esc(s.path)}">${esc(sectionLine(s))}</a> (${esc(where(s))})</li>`),
    `</ul>`,
  ].join("\n");
  return {
    path: sh.path,
    file: fileFor(sh.path),
    kind: "shared",
    html: page({
      path: sh.path,
      title: titleOf(`${book.book.label} ${sh.citation}: ${sh.sections.length} sections share this number`),
      description: describe(`${book.book.label} has ${sh.sections.length} sections numbered ${sh.citation}: ${sh.sections.map((s) => s.title).join("; ")}.`),
      main,
      aside: titlesTree(book),
      nav: book.book.slug,
      site,
      jsonLd: [breadcrumbJsonLd(crumbs)],
    }),
  };
}

/**
 * A chapter number one title gives two chapters (the Administrative Code's starred pairs, Rules
 * Title 43's two Chapter 15s): a page at the plain path to pick one (model.js chapterPaths).
 */
export function sharedChapterPage(sc, book, site) {
  const t = sc.title;
  const crumbs = [...crumbsTo(book, { title: t }), { name: sc.citation, path: sc.path }];
  const name = (c) => (sc.chapters.filter((o) => o.name === c.name).length > 1 ? `${c.name} (American Legal id ${c.id})` : c.name);
  const main = [
    breadcrumbs(crumbs),
    citeHeading(sc.chapters[0].fullCitation, `${sc.chapters.length} chapters have this number`),
    `<p>${esc(t.name)} has ${sc.chapters.length} chapters numbered ${esc(sc.citation.replace(/^Chapter /, ""))}. Pick one:</p>`,
    `<ul class="contents">`,
    ...sc.chapters.map((c) => `<li><a href="${esc(c.path)}">${esc(name(c))}</a> <span class="count">(${plural(c.sections.length, "section")})</span></li>`),
    `</ul>`,
  ].join("\n");
  return {
    path: sc.path,
    file: fileFor(sc.path),
    kind: "shared",
    html: page({
      path: sc.path,
      title: titleOf(`${sc.chapters[0].fullCitation}: ${sc.chapters.length} chapters share this number`),
      description: describe(`${t.name} has ${sc.chapters.length} chapters numbered ${sc.citation.replace(/^Chapter /, "")}: ${sc.chapters.map((c) => c.title || c.citation).join("; ")}.`),
      main,
      aside: titlesTree(book, { title: t, here: sc.path }),
      here: t.name,
      nav: book.book.slug,
      site,
      jsonLd: [breadcrumbJsonLd(crumbs)],
    }),
  };
}

/** Every page of the Admin Code, as functions that each make one page (12,000+ pages are written one at a time, not held in memory). */
export function adminPageMakers(book, site) {
  return [
    () => adminContentsPage(book, site),
    ...book.titles.map((t) => () => adminTitlePage(t, book, site)),
    ...book.chapters.map((c) => () => adminChapterPage(c, book, site)),
    ...book.parts.map((p) => () => adminPartPage(p, book, site)),
    ...book.sections.map((s) => () => adminSectionPage(s, book, site)),
    ...book.shared.map((sh) => () => adminSharedNumberPage(sh, book, site)),
    ...(book.sharedChapters ?? []).map((sc) => () => sharedChapterPage(sc, book, site)),
  ];
}
