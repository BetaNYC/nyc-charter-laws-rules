// Every page of the site (issue #62), as { path, file, html }. Pure: the build passes the book
// (scripts/lib/site/model.js) and the site facts in, and writes the results.
//
// file is where the page goes in the build folder. A law page's path has no ".html"
// (/charter/sections/259) and its file is charter/sections/259.html: GitHub Pages serves
// /charter/sections/259 from that file, and the canonical link names the path without ".html".

import { renderSection, bodyBlocks } from "../render-section.js";
import { bodyHtml } from "./render-html.js";
import { linkTarget } from "./model.js";
import { page, breadcrumbs, breadcrumbJsonLd, searchForm } from "./layout.js";
import { escapeHtml } from "./html.js";
import { paragraphHtml } from "./disclaimer.js";
import { SITE_NAME, SITE_BASE, REPO_URL, absoluteUrl } from "./config.js";

const HOME = { name: "Law Reader", path: "/" };

function fileFor(path) {
  if (path === "/") return "index.html";
  if (path.endsWith("/")) return path.slice(1) + "index.html";
  return path.slice(1) + ".html";
}

function titleOf(text) {
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

function legislationJsonLd(record, book, site) {
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

function pagefindHead(record, book, kind) {
  return [
    `<meta data-pagefind-filter="book[content]" content="${escapeHtml(book.book.short)}">`,
    `<meta data-pagefind-filter="kind[content]" content="${kind}">`,
    `<meta data-pagefind-meta="title[content]" content="${escapeHtml(`${record.citation}. ${record.title}`)}">`,
    `<meta data-pagefind-meta="citation[content]" content="${escapeHtml(record.fullCitation)}">`,
    `<meta data-pagefind-meta="book[content]" content="${escapeHtml(book.book.label)}">`,
    `<meta data-pagefind-meta="kind[content]" content="${kind}">`,
  ];
}

function sourceBox(record, site) {
  return `<div class="note source" data-pagefind-ignore="all">
<p>${escapeHtml(site.creditLine)} <a href="${escapeHtml(site.officialUrl)}">Official text at American Legal Publishing</a>.</p>
<p><strong>BetaNYC modified this.</strong> We built this page from American Legal Publishing's bulk XML: we split the text into its parts, added links between sections, and removed the publisher's editing marks. Check the official text before you rely on it.</p>
<p>American Legal's id for this text: <code>${escapeHtml(record.id)}</code>. Links that use it still land here.</p>
</div>`;
}

function lawText(record, book) {
  const blocks = bodyBlocks(renderSection(record, record.structure));
  if (!blocks.length) return "";
  const html = bodyHtml(blocks, {
    fullCitation: record.fullCitation,
    linkFor: (to) => linkTarget(to, book, record),
  });
  return `<div class="law">\n${html}\n</div>`;
}

const TOOLS = `<div class="tools" data-pagefind-ignore="all">
<nys-button class="tool-link" variant="outline" size="sm" label="Copy link"></nys-button>
<nys-button class="tool-cite" variant="outline" size="sm" label="Copy citation"></nys-button>
<nys-button class="tool-print" variant="outline" size="sm" label="Print"></nys-button>
<p class="copy-status" role="status"></p>
</div>`;

function h1(record) {
  return `<h1><span class="cite">${escapeHtml(record.fullCitation)}</span> <span class="heading">${escapeHtml(record.title)}</span></h1>`;
}

/** A chapter's name in lists: "Chapter 2-A: Council", or just "Preamble" when that is all it has. */
export function chapterName(c) {
  return c.title === c.citation ? c.title : `${c.citation}: ${c.title}`;
}

/** The side list's name: the phone button's label and the name of its navigation landmark. */
export function chapterNavName(book) {
  return `${book.book.short} chapters`;
}

/**
 * The side list on the book's pages: every chapter, as a link to its page, with one chapter
 * open to show its sections. A plain nested list, so it reads with JavaScript off; NYSDS's
 * vertical navigation wraps it when scripts run. NYSDS gives it no visible heading on a wide
 * screen and folds it behind one button (named by `heading`) below 1024px.
 *
 * The open chapter's link is aria-current="true" (the part of the site the reader is in), or
 * "page" on the chapter's own page; the section's own link is aria-current="page".
 *
 * @param {object} book
 * @param {object} [at]
 * @param {object} [at.chapter]  the chapter to open
 * @param {object} [at.section]  the section this page shows
 */
export function chapterNav(book, { chapter = null, section = null } = {}) {
  const item = (c) => {
    if (c !== chapter) return `<li><a href="${escapeHtml(c.path)}">${escapeHtml(chapterName(c))}</a></li>`;
    const current = section ? "true" : "page";
    const sections = c.sections.length
      ? `\n<ul>\n${c.sections
          .map((x) => `<li><a href="${escapeHtml(x.path)}"${x === section ? ` aria-current="page"` : ""}>${escapeHtml(`${x.citation}. ${x.title}`)}</a></li>`)
          .join("\n")}\n</ul>\n`
      : "";
    return `<li class="open"><a href="${escapeHtml(c.path)}" aria-current="${current}">${escapeHtml(chapterName(c))}</a>${sections}</li>`;
  };
  return `<div class="toc" data-pagefind-ignore="all">
<nys-verticalnav heading="${escapeHtml(chapterNavName(book))}" hideHeading headingLevel="h2">
<ul>
${book.chapters.map(item).join("\n")}
</ul>
</nys-verticalnav>
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
  const toc = chapterNav(book, { chapter: s.chapter, section: s });
  const pager = `<nav class="pager" aria-label="Previous and next section" data-pagefind-ignore="all">
${s.prev ? `<a class="prev" href="${escapeHtml(s.prev.path)}"><small>Previous</small> ${escapeHtml(`${s.prev.citation}. ${s.prev.title}`)}</a>` : ""}
${s.next ? `<a class="next" href="${escapeHtml(s.next.path)}"><small>Next</small> ${escapeHtml(`${s.next.citation}. ${s.next.title}`)}</a>` : ""}
</nav>`;
  const main = [
    breadcrumbs(crumbs),
    `<article class="law-page" data-pagefind-body>`,
    h1(s),
    TOOLS,
    lawText(s, book) || `<p class="empty">American Legal Publishing's file has no text for this section.</p>`,
    `</article>`,
    sourceBox(s, site),
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
      nav: book.book.slug,
      site,
      headExtra: pagefindHead(s, book, "Section"),
      jsonLd: [legislationJsonLd(s, book, site), breadcrumbJsonLd(crumbs)],
    }),
  };
}

/** A chapter's page: its own text, if it has any, then a plain list of its sections. */
export function chapterPage(c, book, site) {
  const crumbs = [HOME, { name: book.book.label, path: `/${book.book.slug}/` }, { name: c.citation, path: c.path }];
  const list = c.sections.length
    ? `<h2 id="sections" data-pagefind-ignore>Sections in ${escapeHtml(c.citation)}</h2>
<ol class="contents" data-pagefind-ignore="all">
${c.sections.map((x) => `<li><a href="${escapeHtml(x.path)}">${escapeHtml(`${x.citation}. ${x.title}`)}</a></li>`).join("\n")}
</ol>`
    : `<p>No sections in this chapter.</p>`;
  const pager = `<nav class="pager" aria-label="Previous and next chapter" data-pagefind-ignore="all">
${c.prev ? `<a class="prev" href="${escapeHtml(c.prev.path)}"><small>Previous</small> ${escapeHtml(`${c.prev.citation}: ${c.prev.title}`)}</a>` : ""}
${c.next ? `<a class="next" href="${escapeHtml(c.next.path)}"><small>Next</small> ${escapeHtml(`${c.next.citation}: ${c.next.title}`)}</a>` : ""}
</nav>`;
  const heading = c.title === c.citation ? escapeHtml(c.title) : `<span class="cite">${escapeHtml(`${book.book.label} ${c.citation}`)}</span> <span class="heading">${escapeHtml(c.title)}</span>`;
  const main = [
    breadcrumbs(crumbs),
    `<article class="law-page" data-pagefind-body>`,
    `<h1>${heading}</h1>`,
    lawText(c, book),
    list,
    `</article>`,
    sourceBox(c, site),
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
      aside: chapterNav(book, { chapter: c }),
      nav: book.book.slug,
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
      aside: chapterNav(book),
      nav: book.book.slug,
      site,
      jsonLd: [breadcrumbJsonLd(crumbs)],
    }),
  };
}

/** The book's contents: a plain list of its chapters. It has no side list: the page is that list. */
export function contentsPage(book, site) {
  const path = `/${book.book.slug}/`;
  const crumbs = [HOME, { name: book.book.label, path }];
  const main = [
    breadcrumbs(crumbs),
    `<h1>${escapeHtml(book.book.name)}</h1>`,
    `<p class="lede">The ${escapeHtml(book.book.short)}'s ${book.chapters.length} chapters and ${book.sections.length} sections, in order. ${escapeHtml(site.currentThrough)}</p>`,
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

export function homePage(book, site) {
  const main = `<section class="hero-law">
<h1>${escapeHtml(SITE_NAME)}</h1>
<p class="lede">New York City's Charter, one page per section, with links between sections and a search box. BetaNYC builds it from American Legal Publishing's copy of the law, for research.</p>
<p><a class="button" href="/${book.book.slug}/">Browse the ${escapeHtml(book.book.short)}</a></p>
</section>
<h2 id="books">What is here</h2>
<ul class="contents">
<li><a href="/${book.book.slug}/">${escapeHtml(book.book.name)}</a>: ${book.chapters.length} chapters, ${book.sections.length} sections. ${escapeHtml(site.currentThrough)}</li>
</ul>
<p>The Administrative Code and the Rules of the City of New York come later.</p>
<h2 id="how">How to use it</h2>
<p>Type a section number, like <code>§ 259</code> or <code>259</code>, in the box at the top of this page or on the <a href="/search">search page</a> to go straight to it, or type words to search the text. Every part of a section has its own link: select the letter or number at its start.</p>
<h2 id="data">The data and the MCP server</h2>
<p>The same text is in BetaNYC's <a href="${REPO_URL}">nyc-charter-laws-rules</a> repository, as JSON and Markdown you can download, and AI assistants can read it through BetaNYC's MCP server. Please download the data rather than copying pages one at a time.</p>`;
  return {
    path: "/",
    file: "index.html",
    kind: "home",
    html: page({
      path: "/",
      title: `${SITE_NAME}: the NYC Charter, section by section`,
      description: describe("Read New York City's Charter one section at a time, with links between sections and search."),
      main,
      searchStrip: true,
      site,
      jsonLd: [{ "@context": "https://schema.org", "@type": "WebSite", name: SITE_NAME, url: SITE_BASE + "/" }],
    }),
  };
}

export function searchPage(book, site) {
  const crumbs = [HOME, { name: "Search", path: "/search" }];
  const main = [
    breadcrumbs(crumbs),
    `<h1>Search</h1>`,
    searchForm({ contentsPath: site.contentsPath, id: "search-q", handler: "search" }),
    `<p class="summary" id="search-status" role="status"></p>`,
    `<div class="results-layout">`,
    `<div class="filters" id="filters" hidden></div>`,
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
      description: describe(`Search the ${book.book.name} by section number or by words.`),
      main,
      nav: "search",
      navPage: true,
      noindex: true,
      site,
      scripts: ["/assets/search.js"],
    }),
  };
}

export function aboutPage(book, site, { paragraphs, metadata }) {
  const crumbs = [HOME, { name: "About this copy", path: "/about" }];
  const main = [
    breadcrumbs(crumbs),
    `<h1>About this copy</h1>`,
    `<p class="lede"><strong>This is BetaNYC's copy, for research. It is not the official text and not legal advice. ${escapeHtml(site.officialName)} is at <a href="${escapeHtml(site.officialUrl)}">American Legal Publishing</a>.</strong></p>`,
    `<h2 id="disclaimer">Disclaimer</h2>`,
    `<p>This is the disclaimer BetaNYC's MCP server gives. Its second paragraph is American Legal Publishing's disclaimer for its own site, codelibrary.amlegal.com.</p>`,
    `<div class="disclaimer">`,
    ...paragraphs.map((p) => `<p>${paragraphHtml(p)}</p>`),
    `</div>`,
    `<h2 id="changes">What BetaNYC changed</h2>`,
    `<p>American Legal Publishing publishes the ${escapeHtml(book.book.name)} for the City of New York. BetaNYC downloads its bulk XML file and builds this site from it. We split each section into its parts (a, b, (1), (2)...), give each part its own link, turn references to other sections into links, and remove the publisher's editing marks (such as [ALP S-054]). Section numbers are worked out from each heading, and can be wrong. References into the Administrative Code and the Rules are plain text until those books are on this site.</p>`,
    `<h2 id="current">How current it is</h2>`,
    `<p>${escapeHtml(site.currentThrough)} BetaNYC's copy of the text last changed on ${escapeHtml(site.copyChangedOn)}. That is the date BetaNYC's index last changed, from a change in American Legal Publishing's files or in how BetaNYC builds the index. The index keeps no date for when the files were last checked, so none is shown. This site was built on ${escapeHtml(metadata.builtOnLong)} (New York time).</p>`,
    `<h2 id="software">Software</h2>`,
    `<p>The page frame is BetaNYC's Pages template (MIT license). Menus, breadcrumbs, contents and search controls are from the <a href="https://designsystem.ny.gov/">New York State Design System</a>, used as a library on a site that is not a New York State site; its notice, which covers the State's own work (CC0), Google's Material Icons (Apache License 2.0) and Lit (BSD 3-Clause), is in <a href="/licenses/nysds-LICENSE.md">nysds-LICENSE.md</a>, and DOMPurify, which NYSDS includes, carries its notice in <a href="/assets/nysds/nysds.js">nysds.js</a>. Search uses <a href="https://pagefind.app/">Pagefind</a> (MIT license, <a href="/licenses/pagefind-LICENSE.txt">notice</a>). This site's code is <a href="${REPO_URL}">on GitHub</a> under the MIT license.</p>`,
  ].join("\n");
  return {
    path: "/about",
    file: "about.html",
    kind: "about",
    html: page({
      path: "/about",
      title: titleOf("About this copy"),
      description: describe(`Where the ${book.book.name} on this site comes from, how BetaNYC changed it, and the full disclaimer.`),
      main,
      nav: "about",
      navPage: true,
      site,
      jsonLd: [breadcrumbJsonLd(crumbs)],
    }),
  };
}

export function notFoundPage(book, site) {
  const main = `<h1>Page not found</h1>
<p id="redirect-status" role="status">There is no page at this address.</p>
<p>Try <a href="/${book.book.slug}/">the ${escapeHtml(book.book.short)}'s contents</a>, or <a href="/search">search</a>.</p>`;
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
