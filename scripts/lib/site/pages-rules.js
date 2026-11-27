// The Rules of the City of New York's pages, titles first (issue #65, after #59).
// Pure, like pages.js: the build passes the book (model.js layoutRules) and the site facts in.
//
// The Rules are laid out as the Administrative Code is (pages-admin.js: title cards, a page per
// title, chapters split into parts, a page per section, the titles-first contents tree), with
// two differences, both because each title restarts its numbers:
//   - every path is under its title (/rules/titles/15/sections/1-01), and every citation names
//     the title ("15 RCNY § 1-01");
//   - a number in more than one title has a page to pick one, /rules/sections/1-01, and a number
//     a title repeats has one too, /rules/titles/30/sections/notice.
// Paths and citations: model.js, "The Rules of the City of New York".

import { page, breadcrumbs, breadcrumbJsonLd } from "./layout.js";
import { escapeHtml } from "./html.js";
import { HOME, fileFor, titleOf, describe } from "./pages.js";
import {
  adminContentsPage,
  adminTitlePage,
  adminChapterPage,
  adminPartPage,
  adminSectionPage,
  titlesTree,
  citeHeading,
  sharedChapterPage,
} from "./pages-admin.js";

const esc = escapeHtml;

/**
 * Each record's link in a list to pick from: its full citation and heading, and, where the
 * publisher repeats both (two § 4-11 in one chapter of Title 6), what tells it apart, so no two
 * links share a name (test/site/a11y-tree.mjs).
 */
function pickLinks(list) {
  const base = (s) => (s.title ? `${s.fullCitation}. ${s.title}` : s.fullCitation);
  return list.map((s) => {
    const same = list.filter((o) => base(o) === base(s));
    const text = same.length > 1 ? `${base(s)} (${s.dupNote && s.dupNote !== s.title ? s.dupNote : `American Legal id ${s.id}`})` : base(s);
    return `<a href="${esc(s.path)}">${esc(text)}</a>`;
  });
}

/** Where the build writes the numbers that are in one title only, for the 404 page: { "3-01": path }. */
export function rulesNumbersPath(book) {
  return `/${book.book.slug}/numbers.json`;
}

/** A number one title repeats (Title 30's yearly orders each have a "Notice"): pick one. */
export function rulesSharedNumberPage(sh, book, site) {
  const t = sh.title;
  const crumbs = [HOME, { name: book.book.label, path: `/${book.book.slug}/` }, { name: t.citation, path: t.path }, { name: sh.citation, path: sh.path }];
  const where = (s) => (s.chapter.kind === "title" ? s.chapter.citation : s.chapter.name);
  // "§ 6-01" is a number; "Notice" (each yearly order's) is a citation.
  const what = sh.citation.startsWith("§") ? "number" : "citation";
  const main = [
    breadcrumbs(crumbs),
    citeHeading(sh.fullCitation, `${sh.sections.length} records share this ${what}`),
    `<p>${esc(t.name)} has ${sh.sections.length} records ${what === "number" ? "numbered" : "cited"} ${esc(sh.citation)}, so each one's citation names its chapter. Pick one:</p>`,
    `<ul class="contents">`,
    ...pickLinks(sh.sections).map((a, i) => `<li>${a} (${esc(where(sh.sections[i]))})</li>`),
    `</ul>`,
  ].join("\n");
  return {
    path: sh.path,
    file: fileFor(sh.path),
    kind: "shared",
    html: page({
      path: sh.path,
      title: titleOf(`${sh.fullCitation}: ${sh.sections.length} records share this ${what}`),
      description: describe(`${t.name} has ${sh.sections.length} records ${what === "number" ? "numbered" : "cited"} ${sh.citation}. Pick the one you mean.`),
      main,
      aside: titlesTree(book, { title: t, here: sh.path }),
      here: t.name,
      nav: book.book.slug,
      site,
      jsonLd: [breadcrumbJsonLd(crumbs)],
    }),
  };
}

/**
 * A number in more than one title (§ 1-01 is in about fifty): a page to pick one, grouped by
 * title. "§ 1-01" alone is not a citation of the Rules; the title is part of it.
 */
export function rulesPickPage(pk, book, site) {
  const crumbs = [HOME, { name: book.book.label, path: `/${book.book.slug}/` }, { name: pk.citation, path: pk.path }];
  const titles = [...new Set(pk.sections.map((s) => s.titleNode))];
  const main = [
    breadcrumbs(crumbs),
    citeHeading(`${book.book.label} ${pk.citation}`, `${pk.citation} is in ${titles.length} titles`),
    `<p>Each title of the ${esc(book.book.name)} numbers its own sections, so ${esc(pk.citation)} is in ${titles.length} titles. A citation names the title first: ${esc(pk.sections[0].fullCitation)} is ${esc(pk.citation)} of ${esc(pk.sections[0].titleNode.citation)}. Pick one:</p>`,
    `<ul class="contents pick-titles">`,
    ...titles.map((t) => {
      const list = pk.sections.filter((s) => s.titleNode === t);
      const items = pickLinks(list).map((a) => `<li>${a}</li>`).join("\n");
      return `<li>${esc(t.name)}\n<ul>\n${items}\n</ul>\n</li>`;
    }),
    `</ul>`,
  ].join("\n");
  return {
    path: pk.path,
    file: fileFor(pk.path),
    kind: "pick",
    html: page({
      path: pk.path,
      title: titleOf(`${book.book.label} ${pk.citation} is in ${titles.length} titles`),
      description: describe(`${pk.citation} is in ${titles.length} titles of the ${book.book.name}. Pick the title you mean.`),
      main,
      aside: titlesTree(book),
      nav: book.book.slug,
      site,
      jsonLd: [breadcrumbJsonLd(crumbs)],
    }),
  };
}

/** Every page of the Rules, as functions that each make one page (written one at a time, not held in memory). */
export function rulesPageMakers(book, site) {
  return [
    () => adminContentsPage(book, site),
    ...book.titles.map((t) => () => adminTitlePage(t, book, site)),
    ...book.chapters.map((c) => () => adminChapterPage(c, book, site)),
    ...book.parts.map((p) => () => adminPartPage(p, book, site)),
    ...book.sections.map((s) => () => adminSectionPage(s, book, site)),
    ...book.shared.map((sh) => () => rulesSharedNumberPage(sh, book, site)),
    ...book.picks.map((pk) => () => rulesPickPage(pk, book, site)),
    ...book.sharedChapters.map((sc) => () => sharedChapterPage(sc, book, site)),
  ];
}
