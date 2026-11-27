// The picture description page (/describe-pictures/, issue #87) in the Law Reader's own page
// frame (Noel, 2026-11-26: one look across the site): the top bar, breadcrumbs, type, buttons,
// bottom box and footer every page has, around the page's working parts (scripts/lib/alt-text/
// page/body.html, run by its app.js). static-build.js calls pictureFrame through its `frame`
// option; the build passes the site facts in.
//
// The page keeps its content security policy, first in <head>: everything it loads is on
// law.beta.nyc ('self'), and it may connect only to the intake's origin. It is not in the top
// bar; the footer links it (layout.js).

import { page, breadcrumbs, breadcrumbJsonLd } from "./layout.js";
import { escapeHtml } from "./html.js";
import { HOME, titleOf, describe } from "./pages.js";

export const PICTURES_PATH = "/describe-pictures/";
export const PICTURES_TITLE = "Picture descriptions";

/**
 * The opening lines, true for what the page holds today: how many pictures have a description a
 * person at BetaNYC reviewed (none, until some do), what a description is, and where a
 * suggestion goes. `items` are the page's pictures; `reviewed` counts those with reviewed text.
 */
export function pictureIntro(items) {
  const reviewed = items.filter((i) => i.entry?.status === "reviewed" && i.entry.review).length;
  const have = reviewed
    ? `${reviewed.toLocaleString("en-US")} of the ${items.length.toLocaleString("en-US")} ${reviewed === 1 ? "has" : "have"} a text description that a person at BetaNYC reviewed; the rest have none yet.`
    : `None of the ${items.length.toLocaleString("en-US")} has a text description yet.`;
  return [
    `<p class="lede">The pictures in New York City's Administrative Code and Rules: drawings, maps, forms, formulas and tables that American Legal Publishing's text includes as images. ${have}</p>`,
    `<p>A description is BetaNYC's work, not part of American Legal Publishing's text, and not an official record.</p>`,
    `<p>To suggest a description for a picture, or a better one, write it below and press "Send suggestion". You do not need an account. Your suggestion goes to BetaNYC, not to a public page, and a person at BetaNYC reads every one before anything on the Law Reader changes.</p>`,
  ].join("\n");
}

/** The frame static-build.js asks for: the whole page's HTML. */
export function pictureFrame(site) {
  return ({ csp, head, body, data, items }) => {
    const crumbs = [HOME, { name: PICTURES_TITLE, path: PICTURES_PATH }];
    const main = [
      breadcrumbs(crumbs),
      `<h1>${escapeHtml(PICTURES_TITLE)}</h1>`,
      pictureIntro(items),
      `<div class="alt-app">`,
      body,
      `</div>`,
      `<script type="application/json" id="page-data">${data}</script>`,
    ].join("\n");
    return page({
      path: PICTURES_PATH,
      title: titleOf(PICTURES_TITLE),
      description: describe("The pictures in New York City's Administrative Code and Rules. Suggest a text description for any of them; a person at BetaNYC reads every suggestion."),
      main,
      csp,
      headExtra: [...head, `<link rel="stylesheet" href="/assets/describe-pictures.css">`],
      scripts: [`${PICTURES_PATH}app.js`],
      site,
      jsonLd: [breadcrumbJsonLd(crumbs)],
    });
  };
}
