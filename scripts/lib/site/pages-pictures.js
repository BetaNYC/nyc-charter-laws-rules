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

const fmt = (n) => n.toLocaleString("en-US");
const isReviewed = (e) => e?.status === "reviewed" && !!e.review && !!(e.review.alt || e.review.long);
const isDraft = (e) => !isReviewed(e) && !!e?.draft && !!(e.draft.alt || e.draft.long);

/**
 * The opening lines, true for what the page holds: how many pictures have a description a person
 * at BetaNYC reviewed, how many have only an AI draft no person has checked (labeled so, as the
 * page labels each one), and how many have none; what a description is; and where a suggestion
 * goes. Never names the AI model. `items` are the page's pictures, with their public entries.
 */
export function pictureIntro(items) {
  const total = items.length;
  const reviewed = items.filter((i) => isReviewed(i.entry)).length;
  const drafted = items.filter((i) => isDraft(i.entry)).length;
  const none = total - reviewed - drafted;
  const lines = [];
  if (reviewed) lines.push(`${fmt(reviewed)} of the ${fmt(total)} ${reviewed === 1 ? "has" : "have"} a text description that a person at BetaNYC reviewed.`);
  if (drafted === total) lines.push(`Each has a text description that an AI model drafted for BetaNYC. No person has checked these drafts yet, and each is labeled "AI draft, not yet checked by a person".`);
  else if (drafted) lines.push(`${fmt(drafted)} of the ${fmt(total)} ${drafted === 1 ? "has" : "have"} only a text description that an AI model drafted for BetaNYC, which no person has checked yet, labeled "AI draft, not yet checked by a person".`);
  if (none === total) lines.push(`None of the ${fmt(total)} has a text description yet.`);
  else if (none) lines.push(`${fmt(none)} of the ${fmt(total)} ${none === 1 ? "has" : "have"} none yet.`);
  const have = lines.join(" ");
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
