// The page frame (issue #62): BetaNYC's Pages template top bar and footer, the search strip,
// and the one box at the bottom of every page. Section text and the bottom box are plain HTML,
// so they read with JavaScript off; NYSDS web components wrap only the menus, the contents and
// the search.

import { escapeHtml, jsonForScript } from "./html.js";
import { SITE_NAME, SITE_SHORT_NAME, REPO_URL, NPM_URL, absoluteUrl } from "./config.js";

/**
 * A whole page.
 * @param {object} p
 * @param {string} p.path          the page's own path ("/charter/sections/259")
 * @param {string} p.title         <title>
 * @param {string} p.description   meta description
 * @param {string} p.main          the inside of <main>
 * @param {string} [p.aside]       the contents tree (pages.js contentsTree), before <main>, on the left
 * @param {string} [p.here]        the reader's chapter, named on the Contents bar
 * @param {string} [p.nav]         which top-bar link is current: "charter", "search", "about"
 * @param {boolean} [p.noindex]
 * @param {boolean} [p.searchStrip=false] the search box under the top bar: the home page only (Noel,
 *   2026-11-23). Every page reaches search through the top bar's Search link.
 * @param {boolean} [p.bottomBox=true] the box at the bottom (About leaves it off: it ends with the full disclaimer)
 * @param {{citation: string, url: string}} [p.lawRecord] a law page's own record: the bottom box then links
 *   to that record's page at American Legal Publishing
 * @param {object[]} [p.jsonLd]
 * @param {string[]} [p.headExtra] more <head> lines (Pagefind filters and metadata)
 * @param {string[]} [p.scripts]   extra module scripts
 * @param {object} p.site          { currentThrough, copyChangedOn, officialUrl, officialBase, officialName, contentsPath }
 * @param {boolean} [p.navPage]  the top-bar link is this page itself (aria-current="page"), not just its section
 * @param {boolean} [p.backToTop=true] NYSDS's back-to-top button in the footer (a chapter page has its own "Back to contents")
 */
export function page(p) {
  const canonical = absoluteUrl(p.path);
  const head = [
    `<meta charset="utf-8">`,
    `<meta name="viewport" content="width=device-width, initial-scale=1">`,
    `<title>${escapeHtml(p.title)}</title>`,
    `<meta name="description" content="${escapeHtml(p.description)}">`,
    `<link rel="canonical" href="${escapeHtml(canonical)}">`,
    p.noindex ? `<meta name="robots" content="noindex">` : null,
    `<meta property="og:type" content="website">`,
    `<meta property="og:site_name" content="${escapeHtml(SITE_NAME)}">`,
    `<meta property="og:title" content="${escapeHtml(p.title)}">`,
    `<meta property="og:description" content="${escapeHtml(p.description)}">`,
    `<meta property="og:url" content="${escapeHtml(canonical)}">`,
    `<link rel="icon" href="/assets/favicon.svg" type="image/svg+xml">`,
    `<link rel="stylesheet" href="/assets/site.css">`,
    `<link rel="stylesheet" href="/assets/law.css">`,
    `<script src="/assets/nav.js" defer></script>`,
    `<script src="/assets/nysds/nysds.js" defer></script>`,
    `<script type="module" src="/assets/law.js"></script>`,
    ...(p.scripts ?? []).map((s) => `<script type="module" src="${escapeHtml(s)}"></script>`),
    ...(p.headExtra ?? []),
    ...(p.jsonLd ?? []).map((j) => `<script type="application/ld+json">${jsonForScript(j)}</script>`),
  ].filter(Boolean);

  const body = [
    `<a class="skip" href="#main">Skip to main content</a>`,
    topBar(p.nav, p.navPage === true),
    p.searchStrip === true ? searchStrip(p.site) : "",
    // The contents tree comes before <main> (Noel, 2026-11-23: people expect navigation at the
    // top), and the skip link jumps past it to the law text. "☰ Contents" sits at the top of the
    // page's column: it brings the tree back on a wide screen after "Hide", and opens it on a
    // phone. law.js shows it; without JavaScript the tree's own fold does that job.
    p.aside
      ? `<div class="wrap layout">\n${p.aside}\n<div class="main-col">\n${contentsButton(p.here)}\n<main id="main">\n${p.main}\n</main>\n</div>\n</div>`
      : `<main id="main">\n<div class="wrap">\n${p.main}\n</div>\n</main>`,
    p.bottomBox === false ? "" : bottomBox(p.site, p.lawRecord),
    footer(p.site, { sourceLine: p.bottomBox === false, backToTop: p.backToTop !== false }),
  ];
  return `<!DOCTYPE html>\n<html lang="en">\n<head>\n${head.join("\n")}\n</head>\n<body>\n${body.join("\n")}\n</body>\n</html>\n`;
}

// The current part of the site gets aria-current="true"; "page" only on that link's own page.
function topBar(current, isPage) {
  const link = (key, href, text) =>
    `<li><a href="${href}"${current === key ? ` aria-current="${isPage ? "page" : "true"}"` : ""}>${text}</a></li>`;
  return `<header class="site-bar">
  <div class="wrap">
    <a class="home" href="/"><img src="/assets/betanyc-wordmark-white.svg" alt="BetaNYC" width="78" height="26"><span>${escapeHtml(SITE_SHORT_NAME)}</span></a>
    <button class="menu-btn" type="button" aria-expanded="false" aria-controls="site-menu" hidden><svg aria-hidden="true" focusable="false" viewBox="0 0 20 20"><path d="M2 4h16M2 10h16M2 16h16" stroke="currentColor" stroke-width="2" fill="none"/></svg>Menu</button>
    <nav id="site-menu" aria-label="Site">
      <ul>
        ${link("charter", "/charter/", "Charter")}
        ${link("search", "/search", "Search")}
        ${link("about", "/about", "About")}
        <li><a href="${REPO_URL}">GitHub</a></li>
      </ul>
    </nav>
  </div>
</header>`;
}

/**
 * "☰ Contents": shows the contents tree (pages.js contentsTree). Hidden until law.js wires it.
 * It is a full-width "you are here" bar, not an outlined button, so it does not look like the
 * top bar's Menu (Noel, 2026-11-23): Menu goes around the site, Contents around this book. It
 * names the reader's chapter; its accessible name starts with "Contents".
 * @param {string} [here] the reader's chapter, as the tree names it ("Chapter 2: Council")
 */
export function contentsButton(here) {
  // Its spoken name is "Contents, Chapter 2: Council", the words on the bar, in order. A hidden
  // comma span would not do: Chrome puts a space before it in the accessible name.
  const where = here ? ` <span class="contents-here">${escapeHtml(here)}</span>` : "";
  const label = here ? ` aria-label="${escapeHtml(`Contents, ${here}`)}"` : "";
  return `<button type="button" class="contents-open" aria-controls="contents" aria-expanded="false"${label} hidden><svg class="cb-icon" aria-hidden="true" focusable="false" viewBox="0 0 20 20"><path d="M2 4h16M2 10h16M2 16h16" stroke="currentColor" stroke-width="2" fill="none"/></svg><span class="contents-word">Contents</span>${where}<svg class="cb-chev" aria-hidden="true" focusable="false" viewBox="0 0 20 20"><path d="M5 7l5 6 5-6" stroke="currentColor" stroke-width="2" fill="none"/></svg></button>`;
}

/**
 * The search box: on the home page (the strip) and the search page. Its hint is placeholder
 * text inside the box, not a line of its own; the visible label stays its name. Without
 * JavaScript it shows a link to the contents.
 */
export function searchForm({ contentsPath, id, handler }) {
  return `<form class="jump" action="/search" method="get" role="search" aria-label="Go to a section or search"${handler ? ` data-handler="${handler}"` : ""}>
  <nys-textinput id="${id}" name="q" type="search" width="full" label="Go to a section, or search the words" placeholder="Try &quot;§ 259&quot;, &quot;259&quot;, or &quot;budget office&quot;"></nys-textinput>
  <nys-button type="submit" variant="filled" label="Go"></nys-button>
</form>
<noscript><p class="nojs">Search needs JavaScript. <a href="${contentsPath}">Browse the Charter's contents</a> instead.</p></noscript>`;
}

function searchStrip(site) {
  return `<div class="find" data-pagefind-ignore="all">
  <div class="wrap">
${searchForm({ contentsPath: site.contentsPath, id: "q" })}
  </div>
</div>`;
}

/**
 * How current the text is, as two claims with their owners (copy review S1): the "current
 * through" line is American Legal Publishing's, from versions.json; the date BetaNYC's copy
 * last changed is BetaNYC's own (indexedAt). site.currentThrough is the publisher's line
 * ("Current through Local Law 2026/165, enacted November 19, 2026."); a line that does not
 * start "Current through" stops the build, so a person decides how to word it.
 */
export function currentLine(site) {
  const t = String(site.currentThrough ?? "");
  if (!/^Current through /.test(t)) throw new Error(`the publisher's line does not start "Current through": "${t.slice(0, 60)}"`);
  return `American Legal Publishing's text is c${t.slice(1)} BetaNYC's copy last changed on ${site.copyChangedOn}.`;
}

/**
 * The one warning on the page, at the bottom, in plain HTML (the template's .warnbox), in two
 * paragraphs (Noel, 2026-11-23): how current the text is; then, in bold, that BetaNYC modified
 * the text and it is not legal advice, how BetaNYC changed it, where the official text is, and a
 * link to the full disclaimer. On a law page the official link goes to that record's own page at
 * American Legal Publishing; elsewhere it goes to the book.
 * @param {object} site
 * @param {{citation: string, url: string}} [law] the law page's record
 */
export function bottomBox(site, law) {
  const what = law ? "this text" : "the law text on this site";
  const official = law
    ? `The official text of ${escapeHtml(law.citation)} is at <a href="${escapeHtml(law.url)}">American Legal Publishing</a>.`
    : `${escapeHtml(site.officialName)} is at <a href="${escapeHtml(site.officialUrl)}">American Legal Publishing</a>.`;
  return `<div class="wrap" data-pagefind-ignore="all">
<aside class="warnbox copy-box" aria-label="About this copy">
<p class="current">${escapeHtml(currentLine(site))}</p>
<p class="lead"><strong>BetaNYC modified ${what}. It is not legal advice.</strong> We built it from American Legal Publishing's bulk XML, split it into its parts, added links between sections, and removed the publisher's editing marks. ${official} <a href="/about#disclaimer">Read the full disclaimer</a></p>
</aside>
</div>`;
}

// The "comes from American Legal Publishing, and BetaNYC modified it" line is left off every page
// with a bottom box, which says the same thing (copy review S2); only About, which has no box,
// keeps it. The MIT line stays everywhere.
function footer(site, { sourceLine = false, backToTop = true } = {}) {
  return `<footer data-pagefind-ignore="all">${backToTop ? "\n  <nys-backtotop></nys-backtotop>" : ""}
  <div class="wrap">
    <img class="wordmark" src="/assets/betanyc-wordmark-blue.svg" alt="BetaNYC" width="90" height="30">
    <p><strong>${escapeHtml(SITE_NAME)}</strong> is built by <a href="https://beta.nyc">BetaNYC</a>, a project of the Fund for the City of New York. <a href="${REPO_URL}">Source code on GitHub</a>. Found a mistake? <a href="${REPO_URL}/issues">Tell us</a>.</p>
    <p>Want all of it? Download the text as JSON and Markdown <a href="${REPO_URL}/tree/main/data/index">from GitHub</a> instead of copying pages. AI assistants can read the same text through BetaNYC's MCP server, <a href="${NPM_URL}">@betanyc/nyc-charter-laws-rules on npm</a>.</p>
    <p class="small">${!sourceLine ? "" : `The text comes from American Legal Publishing, and BetaNYC modified it (<a href="/about#changes">how BetaNYC changed it</a>). `}Our code is MIT licensed; the license does not cover the publisher's text.</p>
  </div>
</footer>`;
}

/** Breadcrumbs: NYSDS breadcrumbs around a plain list, so they read with JavaScript off. */
export function breadcrumbs(items) {
  const lis = items.map((it, i) =>
    i === items.length - 1 || !it.path
      ? `<li><span aria-current="page">${escapeHtml(it.name)}</span></li>`
      : `<li><a href="${escapeHtml(it.path)}">${escapeHtml(it.name)}</a></li>`
  );
  return `<nys-breadcrumbs class="crumbs" data-pagefind-ignore="all">\n<ol>\n${lis.join("\n")}\n</ol>\n</nys-breadcrumbs>`;
}

/** schema.org BreadcrumbList for the same items (Google: the last item may omit `item`). */
export function breadcrumbJsonLd(items) {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items.map((it, i) => {
      const li = { "@type": "ListItem", position: i + 1, name: it.name };
      if (it.path && i < items.length - 1) li.item = absoluteUrl(it.path);
      return li;
    }),
  };
}
