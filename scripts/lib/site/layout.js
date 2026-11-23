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
 * @param {string} [p.aside]       the side list of chapters (pages.js chapterNav), before <main>, on the left
 * @param {string} [p.nav]         which top-bar link is current: "charter", "search", "about"
 * @param {boolean} [p.noindex]
 * @param {boolean} [p.searchStrip=false] the search box under the top bar: the home page only (Noel,
 *   2026-11-23). Every page reaches search through the top bar's Search link.
 * @param {boolean} [p.bottomBox=true] the box at the bottom (About leaves it off: it ends with the full disclaimer)
 * @param {boolean} [p.sourceBox=false] the page has a source box (law pages), which already says where the
 *   text comes from and that BetaNYC modified it, so the footer does not say it again
 * @param {object[]} [p.jsonLd]
 * @param {string[]} [p.headExtra] more <head> lines (Pagefind filters and metadata)
 * @param {string[]} [p.scripts]   extra module scripts
 * @param {object} p.site          { currentThrough, copyChangedOn, officialUrl, officialBase, officialName, contentsPath }
 * @param {boolean} [p.navPage]  the top-bar link is this page itself (aria-current="page"), not just its section
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
    // The side list comes before <main> (Noel, 2026-11-23: people expect navigation at the
    // top). On a phone it is one closed button above the breadcrumbs; the skip link jumps
    // past it to the law text.
    p.aside
      ? `<div class="wrap layout">\n${p.aside}\n<main id="main">\n${p.main}\n</main>\n</div>`
      : `<main id="main">\n<div class="wrap">\n${p.main}\n</div>\n</main>`,
    p.bottomBox === false ? "" : bottomBox(p.site),
    footer(p.site, { sourceBox: p.sourceBox === true }),
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
 * The one warning on the page, at the bottom, in plain HTML (the template's .warnbox): how
 * current the text is, the bold "BetaNYC's copy" line, and a link to the full disclaimer.
 */
export function bottomBox(site) {
  return `<div class="wrap" data-pagefind-ignore="all">
<aside class="warnbox copy-box" aria-label="About this copy">
<p class="current">${escapeHtml(currentLine(site))}</p>
<p class="lead"><strong>This is BetaNYC's copy, for research. It is not the official text and not legal advice. ${escapeHtml(site.officialName)} is at <a href="${escapeHtml(site.officialUrl)}">American Legal Publishing</a>.</strong></p>
<p><a href="/about#disclaimer">Read the full disclaimer</a></p>
</aside>
</div>`;
}

// The "comes from American Legal Publishing, and BetaNYC modified it" line is left off law
// pages, whose source box says the same thing (copy review S2). The MIT line stays everywhere.
function footer(site, { sourceBox = false } = {}) {
  return `<footer data-pagefind-ignore="all">
  <nys-backtotop></nys-backtotop>
  <div class="wrap">
    <img class="wordmark" src="/assets/betanyc-wordmark-blue.svg" alt="BetaNYC" width="90" height="30">
    <p><strong>${escapeHtml(SITE_NAME)}</strong> is built by <a href="https://beta.nyc">BetaNYC</a>, a project of the Fund for the City of New York. <a href="${REPO_URL}">Source code on GitHub</a>. Found a mistake? <a href="${REPO_URL}/issues">Tell us</a>.</p>
    <p>Want all of it? Download the text as JSON and Markdown <a href="${REPO_URL}/tree/main/data/index">from GitHub</a> instead of copying pages. AI assistants can read the same text through BetaNYC's MCP server, <a href="${NPM_URL}">@betanyc/nyc-charter-laws-rules on npm</a>.</p>
    <p class="small">${sourceBox ? "" : `The text comes from American Legal Publishing, and BetaNYC modified it (<a href="/about#changes">how BetaNYC changed it</a>). `}Our code is MIT licensed; the license does not cover the publisher's text.</p>
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
