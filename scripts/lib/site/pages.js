// Every page of the site (issue #62), as { path, file, html }. Pure: the build passes the book
// (scripts/lib/site/model.js) and the site facts in, and writes the results.
//
// file is where the page goes in the build folder. A law page's path has no ".html"
// (/charter/sections/259) and its file is charter/sections/259.html: GitHub Pages serves
// /charter/sections/259 from that file, and the canonical link names the path without ".html".

import { renderSection, bodyBlocks } from "../render-section.js";
import { bodyHtml, copyId } from "./render-html.js";
import { linkTarget, isLocalLaw } from "./model.js";
import { page, breadcrumbs, breadcrumbJsonLd, searchForm, currentLine, possessiveHtml, officialLinks, latestRulesLine } from "./layout.js";
import { escapeHtml } from "./html.js";
import { paragraphHtml } from "./disclaimer.js";
import { SITE_NAME, SITE_BASE, REPO_URL, NPM_URL, absoluteUrl } from "./config.js";
import { KIND } from "../../../site/assets/filters.js";
import { sourceErrorNote, SOURCE_ERRORS_PATH, SOURCE_ERRORS_TITLE } from "./pages-source-errors.js";

// The first crumb (Noel, 2026-11-23: "Law Reader" confused people).
export const HOME = { name: "Home", path: "/" };

export function fileFor(path) {
  if (path === "/") return "index.html";
  if (path.endsWith("/")) return path.slice(1) + "index.html";
  return path.slice(1) + ".html";
}

export function titleOf(text) {
  return `${text} | ${SITE_NAME}`;
}

/** Search engines show about this many characters of a description; every description fits. */
export const DESCRIPTION_MAX = 160;

const FOR_RESEARCH = "BetaNYC's copy for research, not the official text.";

// Text cut at a word so that it is at most `max` characters, "…" included.
function cutAtWord(text, max) {
  const t = String(text ?? "").replace(/\s+/g, " ").trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max - 1);
  const at = cut.lastIndexOf(" ");
  return (at > max / 3 ? cut.slice(0, at) : cut).replace(/[\s,;:.]+$/, "") + "…";
}

/** A description: the lead, cut at a word if it must be, then the research note. At most 160 characters. */
export function describe(lead) {
  return `${cutAtWord(lead, DESCRIPTION_MAX - FOR_RESEARCH.length - 1)} ${FOR_RESEARCH}`;
}

/** The meta description for a law page: citation, heading, chapter, then the opening words if they fit. */
export function lawDescription(record) {
  const room = DESCRIPTION_MAX - FOR_RESEARCH.length - 1;
  const where = record.chapter ? ` in ${record.chapter.citation}` : "";
  const base = `${record.fullCitation}, ${record.title}${where}.`;
  if (base.length >= room - 20 || !record.text) return describe(base);
  return describe(`${base} "${cutAtWord(record.text, room - base.length - 3)}"`);
}

export function legislationJsonLd(record, book, site) {
  return {
    "@context": "https://schema.org",
    "@type": "Legislation",
    name: `${record.fullCitation}: ${record.title}`,
    legislationIdentifier: record.fullCitation,
    legislationJurisdiction: "New York City",
    inLanguage: "en",
    url: absoluteUrl(record.path),
    isPartOf: { "@type": "Legislation", name: book.book.name, url: absoluteUrl(`/${book.book.slug}/`) },
    isBasedOn: site.officialUrl,
  };
}

export function pagefindHead(record, book, kind) {
  return searchMeta(book, kind, `${record.citation}. ${record.title}`, record.fullCitation);
}

/**
 * How much a local-law note's words count in search, against 1 for a section's
 * (pagefind.app/docs/weighting: 0 to 10, on a quadratic scale). A note's title paragraph ("A Local
 * Law to amend ..., in relation to ...", localLawTitleBlock) says what the law is about, so it
 * counts a little more (LOCAL_LAW_TITLE_WEIGHT), and a search for the law's subject finds its
 * note; the rest (sponsors, dates, the unconsolidated provisions, often long) counts for little
 * (LOCAL_LAW_WEIGHT), so notes stop crowding out the sections the laws wrote. Tuned on the
 * November 2026 data against both of test/site/search-ranking.test.mjs's measures (issue #65; the
 * journal has the table): every note at 1 put 24 notes in the top 10 of the 20 crowding searches
 * and found 21 of the 40 notes by their subject; 1.5 and 0.1 give 13 and 21.
 */
export const LOCAL_LAW_TITLE_WEIGHT = 1.5;
export const LOCAL_LAW_WEIGHT = 0.1;

/**
 * A local-law note's title paragraph, among its body blocks: the first that starts "A Local Law"
 * (the publisher's form), or else "To amend" or "In relation to" (two notes in November 2026).
 * Null when there is none; then every paragraph gets LOCAL_LAW_WEIGHT.
 */
export function localLawTitleBlock(blocks) {
  return blocks.find((b) => /^\s*A\s+Local\s+Law\b/i.test(b.text ?? "")) ?? blocks.find((b) => /^\s*(?:To amend|In relation to)\b/i.test(b.text ?? "")) ?? null;
}

/** A page's search kind, its result label and the weight of each paragraph of its text. */
export function searchKind(r) {
  if (!isLocalLaw(r)) return { kind: r.level === "Chapter" ? KIND.chapter : KIND.section, weightFor: null };
  const weightFor = (b, blocks) => (b === localLawTitleBlock(blocks) ? LOCAL_LAW_TITLE_WEIGHT : LOCAL_LAW_WEIGHT);
  return { kind: KIND.localLaw, label: r.level === "Chapter" ? "Local laws by year" : KIND.localLaw, weightFor };
}

/**
 * Pagefind's filters and result fields for a law page (pagefind.app/docs/filtering, /docs/metadata).
 * `book` filters by the book's short name (the top bar's: "Admin Code"), which search links carry
 * (?book=Admin+Code); the search page names the checkbox by the book's long name. `kind` is one of
 * filters.js KIND; `label` is what the result says it is, when that is not the kind itself (a year
 * of local laws is filtered as a local law and labeled "Local laws by year").
 */
export function searchMeta(book, kind, title, citation, label = kind) {
  if (!Object.values(KIND).includes(kind)) throw new Error(`unknown search kind "${kind}"`);
  return [
    `<meta data-pagefind-filter="book[content]" content="${escapeHtml(book.book.short)}">`,
    `<meta data-pagefind-filter="kind[content]" content="${escapeHtml(kind)}">`,
    `<meta data-pagefind-meta="title[content]" content="${escapeHtml(title)}">`,
    `<meta data-pagefind-meta="citation[content]" content="${escapeHtml(citation)}">`,
    `<meta data-pagefind-meta="book[content]" content="${escapeHtml(book.book.label)}">`,
    `<meta data-pagefind-meta="kind[content]" content="${escapeHtml(label)}">`,
  ];
}

/** The record's own page at American Legal Publishing: the official text of this section or chapter. */
export function officialRecordUrl(record, site) {
  return `${site.officialBase}${encodeURIComponent(record.id)}`;
}

/** What a law page's bottom box needs: the record's citation and its own page at American Legal. */
export function lawRecord(record, site) {
  return { citation: record.fullCitation, url: officialRecordUrl(record, site) };
}

/**
 * A record's own text on its own page, under the page's h1: a Subsection's heading line
 * (issue #76) is an h2. A chapter, part or title page's copy of a section sits under that
 * section's h2, so its subheadings are h3 (sectionCopy).
 */
export function lawText(record, book, { weightFor = null } = {}) {
  const blocks = bodyBlocks(renderSection(record, record.structure));
  if (!blocks.length) return "";
  const html = bodyHtml(blocks, {
    fullCitation: record.fullCitation,
    linkFor: (to) => linkTarget(to, book, record),
    // Pagefind ranks a paragraph's words by its data-pagefind-weight (pagefind.app/docs/weighting:
    // 0 to 10, default 1, on a quadratic scale). Only a local-law note sets one (searchKind).
    weightFor: weightFor ? (b) => weightFor(b, blocks) : null,
  });
  return `<div class="law">\n${html}\n</div>`;
}

const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;

/**
 * What BetaNYC's copy leaves out of a section, from its structure: pictures (figures, equations,
 * tables drawn as images, which have no text) and levels the index still does not read (the
 * structure's `subsections`: since issue #76 the Construction Codes' subsections are read, so
 * this counts only a level nested where the index does not look, none in July 2026). One
 * sentence and a link to the section's own page at American Legal Publishing; "" when nothing is
 * left out. Not indexed by search.
 */
export function leftOutNote(record, site) {
  const st = record.structure ?? {};
  // A structure built before `pictures` was counted still marks a block that holds one (with text
  // beside it), but cannot say how many there are: then the note gives no number.
  const counted = st.pictures !== undefined;
  const pictures = counted ? st.pictures : (st.blocks ?? []).some((b) => b.picture) ? 1 : 0;
  const subsections = st.subsections ?? 0;
  if (!pictures && !subsections) return "";
  const what = [
    subsections ? plural(subsections, "subsection") : null,
    pictures ? `${counted ? plural(pictures, "picture") : "pictures"} (figures, equations, or tables drawn as images)` : null,
  ]
    .filter(Boolean)
    .join(" and ");
  return `<p class="left-out" data-pagefind-ignore="all">This section has ${what} that BetaNYC's copy does not show. <a href="${escapeHtml(officialRecordUrl(record, site))}">Read ${escapeHtml(record.citeAs ?? record.citation)} at American Legal Publishing</a>.</p>`;
}

/** A section with no text in BetaNYC's copy: say so, and link to its page at American Legal Publishing. */
export function emptyText(record, site) {
  return `<p class="empty">BetaNYC's copy has no text for this section. <a href="${escapeHtml(officialRecordUrl(record, site))}">Read ${escapeHtml(record.citeAs ?? record.citation)} at American Legal Publishing</a>.</p>`;
}

/** A section's body: what is left out, then its text, or the empty-text line when it has none and nothing explains why. */
export function sectionBody(record, site, textHtml) {
  const note = leftOutNote(record, site);
  if (textHtml) return note ? `${note}\n${textHtml}` : textHtml;
  return note || emptyText(record, site);
}

export const TOOLS = `<div class="tools" data-pagefind-ignore="all">
<nys-button class="tool-link" variant="ghost" size="sm" label="Copy link"></nys-button>
<nys-button class="tool-cite" variant="ghost" size="sm" label="Copy citation"></nys-button>
<nys-button class="tool-print" variant="ghost" size="sm" label="Print"></nys-button>
<p class="copy-status" role="status"></p>
</div>`;

export function h1(record) {
  return `<h1><span class="cite">${escapeHtml(record.fullCitation)}</span> <span class="heading">${escapeHtml(record.title)}</span></h1>`;
}

/** A chapter's name in lists: "Chapter 2-A: Council", or just "Preamble" when that is all it has. */
export function chapterName(c) {
  return c.title === c.citation ? c.title : `${c.citation}: ${c.title}`;
}

/** The contents tree's heading, the name of its navigation landmark, and the phone button's label. */
export const CONTENTS_NAME = "Contents";

/** Where the build writes a chapter's list of sections for the contents tree: /charter/contents/1.json. */
export function chapterSectionsPath(book, c) {
  return `/${book.book.slug}/contents/${c.slug}.json`;
}

/** A chapter's list of sections for the contents tree, as law.js reads it: [[path, "§ 3. Office powers"], ...]. */
export function chapterSectionsJson(c) {
  return c.sections.map((x) => [x.path, `${x.citation}. ${x.title}`]);
}

/** The id of the current chapter's list of sections in the contents tree. */
export function treeListId(c) {
  return `toc-${c.slug}`;
}

/**
 * The contents tree on every law page (Noel, 2026-11-23, after American Legal Publishing's code
 * library): the heading "Contents", the book, and every chapter in order as a link, with the
 * current chapter open to show its sections. It replaces the side list of chapters.
 *
 * Only the current chapter's sections are in the HTML, so a page stays small when the book has
 * hundreds of chapters. law.js adds a disclosure button (a real <button aria-expanded
 * aria-controls>, named "Sections in Chapter 2: Council") before each chapter that has sections;
 * opening another chapter loads its list from chapterSectionsPath. Without JavaScript there are no
 * buttons, and every chapter link still goes to the chapter's page. A disclosure pattern (lists
 * of links and buttons), not ARIA role="tree".
 *
 * law.js also adds "Hide" (the column folds away on a wide screen) and "☰ Contents" (layout.js,
 * which brings it back, and opens it on a phone). Without JavaScript the tree sits in a <details>
 * fold whose summary is "☰ Contents": closed on a phone, so the law text starts near the top;
 * on a wide screen law.css shows the tree whether the fold is open or not.
 *
 * aria-current: "page" on this page's own link; "true" on the open chapter's link on a section
 * page (the part of the book the reader is in).
 *
 * @param {object} book
 * @param {object} [at]
 * @param {object} [at.chapter]  the chapter to open
 * @param {object} [at.section]  the section this page shows
 */
export function contentsTree(book, { chapter = null, section = null } = {}) {
  const item = (c) => {
    const name = escapeHtml(chapterName(c));
    const cls = c === chapter ? "open" : c.sections.length ? "" : "empty";
    const li = cls ? `<li class="${cls}">` : "<li>";
    if (c !== chapter) return `${li}<a href="${escapeHtml(c.path)}">${name}</a></li>`;
    const sections = c.sections.length
      ? `\n<ul id="${treeListId(c)}">\n${c.sections
          .map((x) => `<li><a href="${escapeHtml(x.path)}"${x === section ? ` aria-current="page"` : ""}>${escapeHtml(`${x.citation}. ${x.title}`)}</a></li>`)
          .join("\n")}\n</ul>\n`
      : "";
    return `${li}<a href="${escapeHtml(c.path)}" aria-current="${section ? "true" : "page"}">${name}</a>${sections}</li>`;
  };
  return `<div class="toc" data-pagefind-ignore="all">
<details class="contents-fold">
<summary class="contents-summary"><span aria-hidden="true">&#9776; </span>${CONTENTS_NAME}</summary>
<nav class="contents-nav" id="contents" aria-labelledby="contents-h" data-sections="/${escapeHtml(book.book.slug)}/contents/">
<div class="contents-top"><h2 id="contents-h">${CONTENTS_NAME}</h2><button type="button" class="contents-hide" aria-label="Hide contents" hidden>Hide</button></div>
<p class="book"><a href="/${escapeHtml(book.book.slug)}/">${escapeHtml(book.book.name)}</a></p>
<ul class="tree">
${book.chapters.map(item).join("\n")}
</ul>
</nav>
</details>
</div>`;
}

/** A section's page. */
export function sectionPage(s, book, site) {
  const crumbs = [
    HOME,
    { name: book.book.label, path: `/${book.book.slug}/` },
    { name: s.chapter.citation, path: s.chapter.path },
    { name: s.citation, path: s.path },
  ];
  const toc = contentsTree(book, { chapter: s.chapter, section: s });
  const pager = `<nav class="pager" aria-label="Previous and next section" data-pagefind-ignore="all">
${s.prev ? `<a class="prev" href="${escapeHtml(s.prev.path)}"><small>Previous</small> ${escapeHtml(`${s.prev.citation}. ${s.prev.title}`)}</a>` : ""}
${s.next ? `<a class="next" href="${escapeHtml(s.next.path)}"><small>Next</small> ${escapeHtml(`${s.next.citation}. ${s.next.title}`)}</a>` : ""}
</nav>`;
  const main = [
    breadcrumbs(crumbs),
    `<article class="law-page" data-pagefind-body>`,
    h1(s),
    TOOLS,
    sourceErrorNote(book.sourceErrors?.get(s.id)),
    sectionBody(s, site, lawText(s, book)),
    `</article>`,
    pager,
  ].join("\n");
  return {
    path: s.path,
    file: fileFor(s.path),
    kind: "section",
    record: s,
    html: page({
      path: s.path,
      title: titleOf(`${s.fullCitation}: ${s.title}`),
      description: lawDescription(s),
      main,
      aside: toc,
      here: chapterName(s.chapter),
      nav: book.book.slug,
      lawRecord: lawRecord(s, site),
      site,
      headExtra: pagefindHead(s, book, "Section"),
      jsonLd: [legislationJsonLd(s, book, site), breadcrumbJsonLd(crumbs)],
    }),
  };
}

/**
 * A chapter page's copy of one section's text. Links to a section of the same chapter, or to a
 * part of one, jump within the page (#s-4, #s-4(b)); the copy only shows on a wide screen, where
 * that section is on the page too. Other links go where they go on the section's own page.
 */
/**
 * Where a cross-reference in a page's copy of section `s` goes: to the copy on this page when its
 * target is one (`onPage(target)`), else where it goes on the section's own page. A reference into
 * another book never stays on the page, even when that book has a record with the same id (68
 * ids are in both the Charter and the Administrative Code).
 */
export function copyLinkFor(s, onPage, book) {
  return (to) => {
    const t = linkTarget(to, book, s);
    if (!t || to?.kind || to.corpus !== book.corpus) return t;
    const target = book.byId.get(to.id);
    if (!target?.slug || !onPage(target)) return t;
    return { href: `#${copyId(target.slug, to.anchor ?? "")}`, label: t.label };
  };
}

function sectionCopy(s, c, book, nameNote, site) {
  const blocks = bodyBlocks(renderSection(s, s.structure));
  const linkFor = copyLinkFor(s, (target) => target.chapter === c, book);
  return sectionBody(s, site, blocks.length ? `<div class="law">\n${bodyHtml(blocks, { fullCitation: s.fullCitation, linkFor, copyOf: s.slug, nameNote, headingLevel: 3 })}\n</div>` : "");
}

// "Open this section" and "Copy citation" are on every section of a chapter page, so each one's
// name adds its citation ("Open this section: § 4"), and its heading too when two sections in
// the chapter share the number (§ 20-t, § 530, § 808). The name starts with the visible words
// (WCAG 2.5.3, label in name).
export const named = (words, s, note) => `aria-label="${escapeHtml(`${words}: ${s.citation}${note ? `, ${note}` : ""}`)}"`;

/**
 * A chapter's page (Noel, 2026-11-23). Its own text, if it has any; then a jump list of its
 * sections ("Sections in Chapter 1"); then, for a wide screen, every section's full text in
 * order, each under an <h2> with an "Open this section" link to its own page and a "Copy
 * citation" button, and a "Back to contents" link that stays on screen while the text scrolls.
 *
 * One HTML page for both widths. Below 900px law.css hides the full text, so a phone shows the
 * jump list, whose links go to each section's own page. At 900px and wider, law.js points the
 * jump list and the contents tree's links for this chapter at the copies on the page (#s-4);
 * with JavaScript off they go to the sections' own pages, and the full text is still there.
 *
 * The copies are data-pagefind-ignore (one search hit per section, on its own page), carry no
 * data-block (the block-order test reads the chapter's own text), and prefix their ids (#s-4(b)).
 */
export function chapterPage(c, book, site) {
  const crumbs = [HOME, { name: book.book.label, path: `/${book.book.slug}/` }, { name: c.citation, path: c.path }];
  const list = c.sections.length
    ? `<nav class="jump" aria-labelledby="sections" data-pagefind-ignore="all">
<h2 id="sections">Sections in ${escapeHtml(c.citation)}</h2>
<ol class="contents">
${c.sections.map((x) => `<li><a href="${escapeHtml(x.path)}">${escapeHtml(`${x.citation}. ${x.title}`)}</a></li>`).join("\n")}
</ol>
</nav>`
    : `<p>No sections in this chapter.</p>`;
  const shared = (x) => (c.sections.filter((y) => y.citation === x.citation).length > 1 ? x.title : "");
  const text = c.sections.length
    ? `<div class="chapter-text" data-pagefind-ignore="all">
${c.sections
  .map(
    (x) => `<div class="chapter-section" id="${escapeHtml(copyId(x.slug))}">
<h2>${escapeHtml(`${x.citation}. ${x.title}`)}</h2>
<p class="sec-tools"><a href="${escapeHtml(x.path)}" ${named("Open this section", x, shared(x))}>Open this section</a> <button type="button" class="copy-cite" data-cite="${escapeHtml(x.fullCitation)}" ${named("Copy citation", x, shared(x))} hidden>Copy citation</button> <span class="copy-status" role="status"></span></p>
${sectionCopy(x, c, book, shared(x), site)}
</div>`
  )
  .join("\n")}
<div class="back-wrap"><a class="back-to-contents" href="#sections">Back to contents</a></div>
</div>`
    : "";
  const pager = `<nav class="pager" aria-label="Previous and next chapter" data-pagefind-ignore="all">
${c.prev ? `<a class="prev" href="${escapeHtml(c.prev.path)}"><small>Previous</small> ${escapeHtml(chapterName(c.prev))}</a>` : ""}
${c.next ? `<a class="next" href="${escapeHtml(c.next.path)}"><small>Next</small> ${escapeHtml(chapterName(c.next))}</a>` : ""}
</nav>`;
  const heading = c.title === c.citation ? escapeHtml(c.title) : `<span class="cite">${escapeHtml(`${book.book.label} ${c.citation}`)}</span> <span class="heading">${escapeHtml(c.title)}</span>`;
  const main = [
    breadcrumbs(crumbs),
    `<article class="law-page" data-pagefind-body>`,
    `<h1>${heading}</h1>`,
    lawText(c, book),
    list,
    text,
    `</article>`,
    pager,
  ].join("\n");
  return {
    path: c.path,
    file: fileFor(c.path),
    kind: "chapter",
    record: c,
    html: page({
      path: c.path,
      title: titleOf(c.title === c.citation ? `${book.book.label}: ${c.title}` : `${book.book.label} ${c.citation}: ${c.title}`),
      description: describe(`${book.book.label} ${c.citation}${c.title === c.citation ? "" : `, ${c.title}`}: ${c.sections.length} section${c.sections.length === 1 ? "" : "s"}.`),
      main,
      aside: contentsTree(book, { chapter: c }),
      here: chapterName(c),
      nav: book.book.slug,
      lawRecord: lawRecord(c, site),
      // "Back to contents" does that job here, and two floating buttons would crowd the corner.
      backToTop: c.sections.length === 0,
      site,
      headExtra: pagefindHead(c, book, "Chapter"),
      jsonLd: [legislationJsonLd(c, book, site), breadcrumbJsonLd(crumbs)],
    }),
  };
}

/** A short page for a section number two sections share: it lists both. */
export function sharedNumberPage(sh, book, site) {
  const crumbs = [HOME, { name: book.book.label, path: `/${book.book.slug}/` }, { name: sh.citation, path: sh.path }];
  const main = [
    breadcrumbs(crumbs),
    `<h1><span class="cite">${escapeHtml(`${book.book.label} ${sh.citation}`)}</span> <span class="heading">${sh.sections.length} sections have this number</span></h1>`,
    `<p>The ${escapeHtml(book.book.short)} has ${sh.sections.length} sections numbered ${escapeHtml(sh.citation)}. Pick one:</p>`,
    `<ul class="contents">`,
    ...sh.sections.map((s) => `<li><a href="${escapeHtml(s.path)}">${escapeHtml(`${s.citation}. ${s.title}`)}</a> (${escapeHtml(s.chapter.citation)})</li>`),
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
      aside: contentsTree(book),
      nav: book.book.slug,
      site,
      jsonLd: [breadcrumbJsonLd(crumbs)],
    }),
  };
}

/** The book's contents: a plain list of its chapters. It has no contents tree: the page is that list. */
export function contentsPage(book, site) {
  const path = `/${book.book.slug}/`;
  const crumbs = [HOME, { name: book.book.label, path }];
  const main = [
    breadcrumbs(crumbs),
    `<h1>${escapeHtml(book.book.name)}</h1>`,
    `<p class="lede">The ${escapeHtml(book.book.short)}'s ${book.chapters.length} chapters and ${book.sections.length} sections, in order.</p>`,
    `<ol class="contents chapters">`,
    ...book.chapters.map(
      (c) =>
        `<li><a href="${escapeHtml(c.path)}">${escapeHtml(chapterName(c))}</a> <span class="count">(${c.sections.length} section${c.sections.length === 1 ? "" : "s"})</span></li>`
    ),
    `</ol>`,
  ].join("\n");
  return {
    path,
    file: fileFor(path),
    kind: "contents",
    html: page({
      path,
      title: titleOf(`${book.book.name}: contents`),
      description: describe(`Every chapter and section of the ${book.book.name}, one page each, with links between sections.`),
      main,
      nav: book.book.slug,
      navPage: true,
      site,
      jsonLd: [breadcrumbJsonLd(crumbs)],
    }),
  };
}

/** "Charter" or "Charter and Administrative Code": the books' names in running text. */
export function bookNames(books) {
  const names = books.map((b) => b.book.long ?? b.book.short);
  return names.length < 3 ? names.join(" and ") : `${names.slice(0, -1).join(", ")}, and ${names.at(-1)}`;
}

/** A book's line under "What is here": its parts, counted. */
function bookCounts(b) {
  if (!b.titles) return `${b.chapters.length} chapters, ${b.sections.length} sections`;
  const numbered = b.titles.filter((t) => !t.synthetic).length;
  const extra = b.titles.length > numbered ? " plus local laws by year" : "";
  return `${numbered} titles${extra}, ${b.chapters.length.toLocaleString("en-US")} chapters, ${b.sections.length.toLocaleString("en-US")} sections`;
}

export function homePage(book, site, others = []) {
  const all = [book, ...others];
  const many = others.length > 0;
  const lede = many
    ? `New York City's ${escapeHtml(bookNames(all))}, one page per section, with links between sections and a search box. BetaNYC builds them from American Legal Publishing's copy of the law, for research.`
    : `New York City's Charter, one page per section, with links between sections and a search box. BetaNYC builds it from American Legal Publishing's copy of the law, for research.`;
  const buttons = all.map((b) => `<a class="button" href="/${b.book.slug}/">Browse the ${escapeHtml(many ? b.book.long : b.book.short)}</a>`).join(" ");
  const rules = all.find((b) => b.book.rcny);
  const coming = rules
    ? ""
    : many
      ? `<p>The Rules of the City of New York are still to come: we are working to parse and display them.</p>`
      : `<p>We are now working to parse and display the Administrative Code and the Rules of the City of New York.</p>`;
  // One example per book on the site: "like § 259 in the Charter, § 28-101.1 in the Administrative Code, or 15 RCNY § 1-01 in the Rules".
  const EXAMPLES = { charter: "§ 259", admin_code: "§ 28-101.1", rules: "15 RCNY § 1-01" };
  const examples = all.filter((b) => EXAMPLES[b.corpus]).map((b) => `<code>${escapeHtml(EXAMPLES[b.corpus])}</code> in the ${escapeHtml(b.book.long)}`);
  const example = many
    ? `like ${examples.length < 3 ? examples.join(" or ") : `${examples.slice(0, -1).join(", ")}, or ${examples.at(-1)}`}`
    : `like <code>§ 259</code> or <code>259</code>`;
  const main = `<section class="hero-law">
<h1>${escapeHtml(SITE_NAME)}</h1>
<p class="lede">${lede}</p>
<p${many ? ` class="buttons"` : ""}>${buttons}</p>
</section>
<h2 id="books">What is here</h2>
<ul class="contents">
${all.map((b) => `<li><a href="/${b.book.slug}/">${escapeHtml(b.book.name)}</a>: ${bookCounts(b)}.</li>`).join("\n")}
</ul>
${coming ? `${coming}\n` : ""}<h2 id="how">How to use it</h2>
<p>Type a section number, ${example}, in the box above or on the <a href="/search">search page</a> to go straight to it, or type words to search the text. Every part of a section has its own link: select the letter or number at its start.</p>
`;
  return {
    path: "/",
    file: "index.html",
    kind: "home",
    html: page({
      path: "/",
      title: `${SITE_NAME}: the NYC ${bookNames(all)}, section by section`,
      description: describe(`Read New York City's ${bookNames(all)} one section at a time, with links between sections and search.`),
      main,
      searchStrip: true,
      site,
      jsonLd: [{ "@context": "https://schema.org", "@type": "WebSite", name: SITE_NAME, url: SITE_BASE + "/" }],
    }),
  };
}

export function searchPage(book, site, others = []) {
  const crumbs = [HOME, { name: "Search", path: "/search" }];
  const main = [
    breadcrumbs(crumbs),
    `<h1>Search</h1>`,
    searchForm({ contentsPath: site.contentsPath, id: "search-q", handler: "search", books: site.books }),
    `<p class="summary" id="search-status" role="status"></p>`,
    `<div class="results-layout">`,
    // The book filter's checkboxes, in the site's order: [filter value, name] (site/assets/filters.js).
    `<div class="filters" id="filters" data-books="${escapeHtml(JSON.stringify([book, ...others].map((b) => [b.book.short, b.book.long])))}" hidden></div>`,
    `<div class="results">`,
    `<div id="pick" hidden></div>`,
    `<ol class="hits" id="results"></ol>`,
    `<nys-pagination id="pages" hidden></nys-pagination>`,
    `</div>`,
    `</div>`,
  ].join("\n");
  return {
    path: "/search",
    file: "search.html",
    kind: "search",
    html: page({
      path: "/search",
      title: titleOf("Search"),
      description: describe(`Search the ${others.length ? `New York City ${bookNames([book, ...others])}` : book.book.name} by section number or by words.`),
      main,
      nav: "search",
      navPage: true,
      noindex: true,
      site,
      scripts: ["/assets/search.js"],
    }),
  };
}

// The About page, modeled on BetaNYC's Grounding AI with NY Open Data site (Noel, 2026-11-23).
// The disclaimer comes last; the bottom box on every page links straight to it (#disclaimer).
const CONTACT_EMAIL = "lab@beta.nyc";
const ABOUT_SECTIONS = [
  ["why", "Why this exists"],
  ["history", "How the law got online"],
  ["changes", "What BetaNYC changed"],
  ["current", "How current it is"],
  ["built-by", "Built by BetaNYC"],
  ["ai", "How we use AI"],
  ["licenses", "Licenses"],
  ["mistakes", "Found a mistake?"],
  ["support", "Support our work"],
  ["disclaimer", "Disclaimer"],
];
export const ABOUT_TITLE = `About ${SITE_NAME}`;

// BetaNYC's part in getting the City's laws online, from beta.nyc and the Council's record
// (read 2026-11-23). Intro 149 became Local Law 37 of 2014, Administrative Code § 7-111.
const HISTORY = {
  roadmap: "https://nycroadmap.us/index.html#31",
  dcDecoded: "https://github.com/openlawdc/dc-decoded",
  testimony: "https://www.beta.nyc/2014/06/11/betanycs-support-of-three-bills-that-would-put/",
  law: "https://legistar.council.nyc.gov/LegislationDetail.aspx?ID=1681066&GUID=0AA72ECF-4B97-41D0-B3B2-965B7AFC0F24",
  statement: "https://www.beta.nyc/2014/08/07/betanycs-statement-on-the-signing-of-nycs/",
  mcp: "https://www.beta.nyc/2026/05/21/new-nyc-digital-democracy-tools-for-ai/",
};

export function aboutPage(book, site, { paragraphs, metadata, others = [] }) {
  const many = others.length > 0;
  const admin = others.find((b) => b.corpus === "admin_code");
  const rules = others.find((b) => b.book.rcny);
  const crumbs = [HOME, { name: "About", path: "/about" }];
  const h2 = (id) => `<h2 id="${id}">${escapeHtml(ABOUT_SECTIONS.find(([k]) => k === id)[1])}</h2>`;
  const mail = `<a href="mailto:${CONTACT_EMAIL}">${CONTACT_EMAIL}</a>`;
  const name = escapeHtml(book.book.name);
  const main = [
    breadcrumbs(crumbs),
    `<h1>${escapeHtml(ABOUT_TITLE)}</h1>`,
    `<nav class="on-this-page" aria-labelledby="on-this-page"><h2 id="on-this-page">On this page</h2><ul>`,
    ...ABOUT_SECTIONS.map(([id, text]) => `<li><a href="#${id}">${escapeHtml(text)}</a></li>`),
    `</ul></nav>`,
    h2("why"),
    `<p>The ${name} sets up the City's government: the Council, the Mayor, the Comptroller, the Public Advocate, the borough presidents, community boards, and the agencies. Reporters, Council staff, community board members, advocates, and students all end up reading it.</p>`,
    admin
      ? `<p>The ${escapeHtml(admin.book.name)} collects the City's local laws by subject, in ${admin.titles.filter((t) => !t.synthetic).length} titles such as Taxation and Finance, Health, and Housing and Buildings.</p>`
      : "",
    rules
      ? `<p>The ${escapeHtml(rules.book.name)} are the rules that City agencies, boards, and commissions adopt, in ${rules.titles.length} titles, such as the Department of Environmental Protection's (Title 15) and the Department of Health and Mental Hygiene's (Title 24, which includes the New York City Health Code).</p>`
      : "",
    `<p>We built this site so the ${escapeHtml(many ? bookNames([book, ...others]) : book.book.short)} ${many ? "are" : "is"} easy to read, search, and cite. Every section, and every lettered or numbered part of a section, has its own link you can paste into an email or testimony. Search finds a section by its number or by its words.</p>`,
    h2("history"),
    `<p>At the end of 2013, BetaNYC and its community wrote <a href="${escapeHtml(HISTORY.roadmap)}">The People's Roadmap to a Digital New York City</a> for the City's incoming leaders. It asked the City to put the Charter, the Rules, and the Administrative Code online with open tools, like <a href="${escapeHtml(HISTORY.dcDecoded)}">DC Decoded</a> in Washington, D.C. It also asked the City to publish its records in machine-readable formats.</p>`,
    `<p>In June 2014, BetaNYC <a href="${escapeHtml(HISTORY.testimony)}">testified before the Council</a> in support of Intro 149, the bill to put the City's laws online, and asked that it require bulk downloads in machine-readable formats. Mayor de Blasio signed it on August 7, 2014, as <a href="${escapeHtml(HISTORY.law)}">Local Law 37 of 2014</a>, and <a href="${escapeHtml(HISTORY.statement)}">we welcomed it</a> the same day. The law, now section 7-111 of the Administrative Code, requires the City's Law Department to publish the Charter, the Administrative Code, and the Rules on its website, searchable, in formats that can be downloaded in bulk, and updated within four weeks of a change.</p>`,
    `<p>American Legal Publishing publishes that compilation for the City and offers it as bulk XML files. In May 2026, BetaNYC built <a href="${escapeHtml(HISTORY.mcp)}">an MCP server</a> from those files so AI assistants can quote the law and name the section they quote. This site puts the same text in front of people.</p>`,
    h2("changes"),
    `<p>BetaNYC modified the text. We split each section into its parts (a, b, (1), (2)…), give each part its own link, turn references to other sections into links, and remove the publisher's editing marks (such as [ALP S-054]). Section numbers are worked out from each heading, and can be wrong. ${
      rules
        ? "References between the Charter, the Administrative Code, and the Rules are links."
        : many
          ? "References between the Charter and the Administrative Code are links. References into the Rules are plain text until the Rules are on this site."
          : "References into the Administrative Code and the Rules are plain text until those books are on this site."
    }</p>`,
    admin
      ? `<p>In the Administrative Code, sections are grouped under the publisher's own titles, and a long chapter is split into parts of at most 100 sections, so no page is too long to load. American Legal Publishing files some local laws by the year they were enacted, outside the titles; we gather those under a heading of our own, “Local laws by year”. Some sections hold pictures (figures, equations, and tables drawn as images) that our copy does not include: those sections say so and link to their page at American Legal Publishing.</p>`
      : "",
    rules
      ? `<p>In the Rules, each title numbers its own chapters and sections, so § 1-01 is in dozens of titles. Every Rules page and citation names its title, the way the Rules are cited: 15 RCNY § 1-01 is § 1-01 of Title 15, and its page is at /rules/titles/15/sections/1-01. The Health Code, in Title 24, is cited 24 RCNY Health Code § 81.08. Where a title repeats a number itself, as the Rent Guidelines Board's yearly orders in Title 30 each have a “Notice”, the citation adds the chapter, and a page lists them all to pick from.</p>`
      : "",
    h2("current"),
    `<p>${escapeHtml(currentLine(site))} That date changes when American Legal Publishing's files change or when BetaNYC changes how it reads them. This site was built on ${escapeHtml(metadata.builtOnLong)} (New York time).</p>`,
    h2("built-by"),
    `<p>BetaNYC is New York's civic organization dedicated to improving lives through public interest technology, open data, and civic design. We build tools, train the public, and advocate for a more transparent, accountable, and participatory city government. BetaNYC is a project of the Fund for the City of New York.</p>`,
    `<p>Related work:</p>`,
    `<ul>`,
    `<li><a href="${NPM_URL}">@betanyc/nyc-charter-laws-rules</a>, the MCP server that gives AI assistants the Charter, the Administrative Code, and the Rules of the City of New York.</li>`,
    `<li><a href="https://www.beta.nyc/featured-tools/ai-tools-for-nyc-democracy/">All our AI tools for NYC's democracy</a>.</li>`,
    `<li><a href="https://betanyc.github.io/grounding-ai-with-ny-open-data/">Grounding AI with NY Open Data</a>, our guide to connecting AI assistants to City and State records.</li>`,
    `<li><a href="https://www.beta.nyc/betabuilders/">Join BetaBuilders</a>, our volunteer community.</li>`,
    `</ul>`,
    h2("ai"),
    `<p>We built this site's code with AI coding assistants, directed and reviewed by BetaNYC staff. No AI model writes or changes the law's text. Every word in a section comes from American Legal Publishing's files, and the changes listed under “What BetaNYC changed” are made by ordinary code that runs the same way every time.</p>`,
    `<p>Read <a href="https://www.beta.nyc/about/ai-policy/">BetaNYC's AI policy</a>. Questions: ${mail}.</p>`,
    h2("licenses"),
    `<p>This site's code is <a href="${REPO_URL}">on GitHub</a> under the MIT license. That license covers our code, not American Legal Publishing's text.</p>`,
    `<p>The page frame is BetaNYC's Pages template (MIT license). Menus, breadcrumbs, buttons, and search controls come from the <a href="https://designsystem.ny.gov/">New York State Design System</a>. This is not a New York State site; we use the design system as a library. Its notice covers the State's own work (CC0), Google's Material Icons (Apache License 2.0), and Lit (BSD 3-Clause): see <a href="/licenses/nysds-LICENSE.md">nysds-LICENSE.md</a>. DOMPurify, which the design system includes, carries its notice in <a href="/assets/nysds/nysds.js">nysds.js</a>. Search uses <a href="https://pagefind.app/">Pagefind</a> (MIT license, <a href="/licenses/pagefind-LICENSE.txt">notice</a>).</p>`,
    h2("mistakes"),
    `<p>If a section is wrong, missing, or out of date here, <a href="${REPO_URL}/issues">open an issue on GitHub</a> or email ${mail}. Tell us the section number and what looks wrong. Fixes to the code are welcome as pull requests.</p>`,
    `<p>If the mistake is in the publisher's text itself, American Legal Publishing's disclaimer asks readers to tell the publisher at <a href="mailto:NYC.editor@amlegal.com">NYC.editor@amlegal.com</a> or the NYC Law Department at <a href="mailto:NYCCodeRulesCharter@law.nyc.gov">NYCCodeRulesCharter@law.nyc.gov</a>. BetaNYC does not change the publisher's text; we list the errors we find in it, and where each one stands, on <a href="${SOURCE_ERRORS_PATH}">${escapeHtml(SOURCE_ERRORS_TITLE)}</a>.</p>`,
    h2("support"),
    `<p>This site is free and has no ads. If it helps your work, please <a href="https://beta.nyc/donate/">support BetaNYC</a>.</p>`,
    h2("disclaimer"),
    many
      ? `<p><strong>This is BetaNYC's copy, for research. It is not the official text and not legal advice. The official texts are at American Legal Publishing: ${officialLinks(site.books)}.${latestRulesLine(site.books.find((b) => b.latestUrl)?.latestUrl)}</strong></p>`
      : `<p><strong>This is BetaNYC's copy, for research. It is not the official text and not legal advice. ${escapeHtml(site.officialName)} is at <a href="${escapeHtml(site.officialUrl)}">American Legal Publishing</a>.</strong></p>`,
    `<p>BetaNYC's MCP server ends its answers with the disclaimer below. The paragraph that starts “Official disclaimer from American Legal Publishing” is the publisher's, written for its own site, codelibrary.amlegal.com, so “this site” in it means theirs.</p>`,
    `<div class="disclaimer">`,
    ...paragraphs.map((p) => `<p>${paragraphHtml(p)}</p>`),
    `</div>`,
  ].join("\n");
  return {
    path: "/about",
    file: "about.html",
    kind: "about",
    html: page({
      path: "/about",
      title: titleOf("About"),
      description: describe(
        many
          ? `Who built ${SITE_NAME}, where its copies of the ${bookNames([book, ...others])} come from, how BetaNYC changed them, and the full disclaimer.`
          : `Who built ${SITE_NAME}, where its copy of the ${book.book.name} comes from, how BetaNYC changed it, and the full disclaimer.`
      ),
      main,
      nav: "about",
      navPage: true,
      // The page ends with the full disclaimer, so the bottom box, which links to it, is left off.
      bottomBox: false,
      site,
      jsonLd: [breadcrumbJsonLd(crumbs)],
    }),
  };
}

export function notFoundPage(book, site, others = []) {
  const contents = [book, ...others].map((b) => `<a href="/${b.book.slug}/">the ${possessiveHtml(others.length ? b.book.long : b.book.short)} contents</a>`);
  const main = `<h1>Page not found</h1>
<p id="redirect-status" role="status">There is no page at this address.</p>
<p>Try ${contents.join(", ")}, or <a href="/search">search</a>.</p>`;
  return {
    path: "/404",
    file: "404.html",
    kind: "404",
    html: page({
      path: "/404",
      title: titleOf("Page not found"),
      description: describe("This page does not exist."),
      main,
      noindex: true,
      site,
      scripts: ["/assets/not-found.js"],
    }),
  };
}
