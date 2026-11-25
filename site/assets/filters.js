// What the search page can filter by, and how a result names its kind (issue #65). Shared by the
// build (scripts/lib/site/pages.js and pages-admin.js write each law page's Pagefind filters from
// it) and the browser (search.js builds the checkboxes and labels the results), so the two cannot
// drift. Plain functions, no DOM: the tests import it in Node.
//
// Pagefind's filters (pagefind.app/docs/filtering, /docs/js-api-filtering): each law page carries
// `book` and `kind` as <meta data-pagefind-filter="kind[content]" content="...">; search.js asks
// pagefind.filters() for the values and searches with { kind: { any: [...] } }.

/**
 * The `kind` filter's values, as written on each page. A local-law note is one of the
 * Administrative Code's "Unconsolidated Local Laws" (citations like L.L. 2016/002, filed by year
 * outside the titles); its year's page ("Local laws, 2016") is a local-law page too, so a reader
 * who leaves local laws out sees neither.
 */
export const KIND = Object.freeze({ section: "Section", chapter: "Chapter", localLaw: "Local law" });

/** The kinds in the order the search page lists them, each with its checkbox name. */
export const KINDS = Object.freeze([
  [KIND.section, "Sections"],
  [KIND.chapter, "Chapters"],
  [KIND.localLaw, "Local laws"],
]);

/**
 * What a result says it is, above its title: the page's `kind` meta. Pages built before #65 have
 * only "Section" and "Chapter"; anything unknown reads as a section, the commonest page.
 */
export const KIND_LABELS = Object.freeze({
  [KIND.section]: "Section",
  [KIND.chapter]: "Chapter",
  [KIND.localLaw]: "Local law",
  "Local laws by year": "Local laws by year",
});

export function kindLabel(kind) {
  return KIND_LABELS[kind] ?? KIND_LABELS[KIND.section];
}

/**
 * The search page's filter groups, in the order shown. `books` is the build's list for this site
 * ([[filter value, checkbox name], ...], from the search page's data-books), so the books come in
 * the site's own order (Charter, Administrative Code, Rules) and a Charter-only build offers only
 * the Charter.
 */
export function filterGroups(books = []) {
  return [
    { key: "book", label: "Book", order: books },
    { key: "kind", label: "Kind of page", order: KINDS },
  ];
}

/**
 * The checkboxes for one group: [value, name] for each value Pagefind has (`present`, the keys of
 * pagefind.filters()[group]), in the group's order; a value the order does not know comes last,
 * alphabetically, named by itself.
 */
export function groupOptions(group, present) {
  const have = new Set(present);
  const known = group.order.filter(([v]) => have.has(v));
  const knownValues = new Set(known.map(([v]) => v));
  const rest = [...have].filter((v) => !knownValues.has(v)).sort().map((v) => [v, v]);
  return [...known, ...rest];
}
