// The "Errors in the publisher's text" page (/source-errors/) and the note a section page shows
// when its section has one. Pure: build.js passes in the entries a build shows
// (source-errors.js visibleErrors) and how to find each one's page.
//
// The whole list is plain HTML, so it reads with JavaScript off. site/assets/source-errors.js
// adds the filters (book, kind, status) and hides the rows they leave out.

import { escapeHtml } from "./html.js";
import { page, breadcrumbs, breadcrumbJsonLd } from "./layout.js";
import { BOOKS, REPO_URL } from "./config.js";
import { HOME, titleOf, describe } from "./pages.js";
import { REPORT_TO, SOURCE_ERROR_BOOKS, SOURCE_ERROR_KINDS, SOURCE_ERROR_STATUSES, kindLabel, statusLabel, longDay } from "./source-errors.js";

export const SOURCE_ERRORS_PATH = "/source-errors/";
export const SOURCE_ERRORS_TITLE = "Errors in the publisher's text";

/** The id a row has on the page, and its address: /source-errors/#SE-0001. */
export const rowHref = (id) => `${SOURCE_ERRORS_PATH}#${id}`;

const mail = (a) => `<a href="mailto:${escapeHtml(a)}">${escapeHtml(a)}</a>`;
const bookName = (b) => BOOKS[b]?.name ?? b;

/**
 * The note at the top of a section page whose section has an error in this build's list. One
 * short line, linking to each row. "" when there is none.
 * @param {object[]} [entries] the shown entries for this section, in the file's order
 */
export function sourceErrorNote(entries) {
  if (!entries?.length) return "";
  const unchecked = entries.every((e) => e.status === "found");
  const links = entries.map((e) => `<a href="${escapeHtml(rowHref(e.id))}">error ${escapeHtml(e.id)}</a>`);
  const list = links.length === 1 ? links[0] : `${links.slice(0, -1).join(", ")} and ${links.at(-1)}`;
  const what = unchecked
    ? `BetaNYC found ${entries.length === 1 ? "a possible error" : "possible errors"}, not yet checked, in the publisher's text of this section.`
    : `The publisher's text of this section has ${entries.length === 1 ? "an error" : "errors"} that BetaNYC found.`;
  return `<p class="source-error-note" data-pagefind-ignore="all">${what} We show the text as the publisher has it. Read about ${list}.</p>`;
}

/** One <option> per value present, in the given order, after "All …". */
function select(id, name, all, options) {
  return `<div class="se-filter"><label for="${id}">${escapeHtml(name)}</label>
<select id="${id}" name="${id.replace(/^se-/, "")}">
<option value="">${escapeHtml(all)}</option>
${options.map(([v, text]) => `<option value="${escapeHtml(v)}">${escapeHtml(text)}</option>`).join("\n")}
</select></div>`;
}

function filters(entries) {
  const present = (key, order) => order.filter(([v]) => entries.some((e) => e[key] === v));
  return `<form class="se-filters" id="se-filters" aria-label="Filter the errors" hidden>
${select("se-book", "Book", "All books", present("book", SOURCE_ERROR_BOOKS.map((b) => [b, bookName(b)])))}
${select("se-kind", "Kind of error", "All kinds", present("kind", SOURCE_ERROR_KINDS))}
${select("se-status", "Status", "All statuses", present("status", SOURCE_ERROR_STATUSES))}
</form>`;
}

/**
 * One row: the citation (a link to our page for the section, when this build has it), the id,
 * the status, the summary, the facts, the evidence, and "Check at American Legal".
 * @param {object} e
 * @param {{path: string}|null} ours  the section's page on this site, or null (a book this build left out)
 * @param {string} amlegalUrl
 */
export function sourceErrorRow(e, ours, amlegalUrl) {
  const cite = ours ? `<a href="${escapeHtml(ours.path)}">${escapeHtml(e.citation)}</a>` : escapeHtml(e.citation);
  const dates = [
    ["Found", `${longDay(e.found)}, in ${e.found_in}`],
    e.confirmed_at ? ["Confirmed", longDay(e.confirmed_at)] : null,
    e.reported_at ? ["Reported", longDay(e.reported_at)] : null,
    e.fixed_at ? ["Fixed by the publisher", longDay(e.fixed_at)] : null,
  ].filter(Boolean);
  const ev = e.evidence;
  const evidence = [
    ev.text !== null ? `<p class="se-ev-label">What the publisher's text says (quoted from its XML):</p>\n<blockquote class="se-quote">${escapeHtml(ev.text)}</blockquote>` : "",
    ev.picture !== null ? `<p class="se-ev-label">What the picture shows (BetaNYC's description):</p>\n<p class="se-picture">${escapeHtml(ev.picture)}</p>` : "",
    ev.images.length
      ? `<p class="se-files">${ev.images.length === 1 ? "Picture file" : "Picture files"}: ${ev.images.map((i) => `<code>${escapeHtml(i.file)}</code> (sha256 <code>${escapeHtml(i.sha256.slice(0, 12))}</code>…)`).join(", ")}. Records in the XML: ${ev.records.map((r) => `<code>${escapeHtml(r)}</code>`).join(", ")}.</p>`
      : `<p class="se-files">Records in the XML: ${ev.records.map((r) => `<code>${escapeHtml(r)}</code>`).join(", ")}.</p>`,
  ]
    .filter(Boolean)
    .join("\n");
  // The link's name adds the citation and the id, so no two "Check at American Legal" links
  // share a name (they go to different places); it starts with the visible words (WCAG 2.5.3).
  const checkName = `Check at American Legal: ${e.citation} (${e.id})`;
  return `<li class="se se-${escapeHtml(e.status)}" id="${escapeHtml(e.id)}" data-book="${escapeHtml(e.book)}" data-kind="${escapeHtml(e.kind)}" data-status="${escapeHtml(e.status)}">
<h3 class="se-head"><span class="se-id">${escapeHtml(e.id)}</span> ${cite}</h3>
<p class="se-status-line"><span class="se-badge se-badge-${escapeHtml(e.status)}">${escapeHtml(statusLabel(e.status))}</span> <span class="se-kind">${escapeHtml(kindLabel(e.kind))}</span> <span class="se-book">${escapeHtml(bookName(e.book))}</span></p>
<p class="se-summary">${escapeHtml(e.summary)}</p>
<p class="se-check"><a href="${escapeHtml(amlegalUrl)}" aria-label="${escapeHtml(checkName)}">Check at American Legal</a></p>
<div class="se-evidence">
<h4>Evidence</h4>
${evidence}
</div>
<dl class="se-facts">
${dates.map(([k, v]) => `<dt>${escapeHtml(k)}</dt><dd>${escapeHtml(v)}</dd>`).join("\n")}
${e.notes ? `<dt>Notes</dt><dd>${escapeHtml(e.notes)}</dd>` : ""}
</dl>
</li>`;
}

/**
 * The page.
 * @param {object} o
 * @param {object[]} o.entries          the entries this build shows (visibleErrors)
 * @param {boolean} o.preview           built with --include-unconfirmed-errors
 * @param {(e: object) => ({path: string}|null)} o.ours   our page for an entry's section
 * @param {(e: object) => string} o.amlegalUrl            its page at American Legal Publishing
 * @param {object} o.site               the shared site facts (layout.js page)
 */
export function sourceErrorsPage({ entries, preview, ours, amlegalUrl, site }) {
  const crumbs = [HOME, { name: SOURCE_ERRORS_TITLE, path: SOURCE_ERRORS_PATH }];
  const n = entries.length;
  const unchecked = entries.filter((e) => e.status === "found").length;
  const countLine = n === 0 ? "" : `${n} ${n === 1 ? "error" : "errors"}${unchecked ? `, ${unchecked} not yet checked` : ""}.`;
  const main = [
    breadcrumbs(crumbs),
    `<h1>${escapeHtml(SOURCE_ERRORS_TITLE)}</h1>`,
    preview
      ? `<p class="se-preview" role="note"><strong>Preview build.</strong> This page includes errors BetaNYC has found but a person has not checked yet, marked “Found, not yet checked”. The public site shows only checked errors.</p>`
      : "",
    `<p>The law on this site comes from American Legal Publishing's files, the same text as the City's official code library. Sometimes those files have a mistake of their own: a picture that says something different from the text around it, the same picture used for two different equations, or garbled words. This page lists the ones BetaNYC has found.</p>`,
    `<p>BetaNYC does not change the publisher's text. Our pages show it as the publisher has it, and a section with a listed error links here. A person at BetaNYC checks each error against the publisher's files before it is listed, and then we report it to American Legal Publishing and the NYC Law Department. Each row links to the section's page at American Legal, so you can check it yourself.</p>`,
    `<h2 id="report">Report an error in the publisher's text</h2>`,
    `<p>American Legal Publishing's disclaimer asks readers to write to the publisher at ${mail(REPORT_TO.publisher)} or the NYC Law Department at ${mail(REPORT_TO.lawDepartment)}. If you find one, please tell us too, at <a href="${REPO_URL}/issues">GitHub</a> or <a href="mailto:lab@beta.nyc">lab@beta.nyc</a>, so we can list it. If the mistake is in this site and not in the publisher's text, that is our bug: <a href="/about#mistakes">tell us about it</a>.</p>`,
    `<h2 id="errors">The errors</h2>`,
    `<p>Each error moves from <strong>${escapeHtml(statusLabel("confirmed"))}</strong> (checked by a person at BetaNYC) to <strong>${escapeHtml(statusLabel("reported"))}</strong> (sent to the publisher and the Law Department) to <strong>${escapeHtml(statusLabel("fixed-upstream"))}</strong> (the publisher's files no longer have it).</p>`,
    n === 0
      ? `<p class="se-empty">There are no confirmed errors yet.</p>`
      : [
          filters(entries),
          `<p class="summary" id="se-count" role="status">${escapeHtml(countLine)}</p>`,
          `<ol class="se-list" id="se-list">`,
          ...entries.map((e) => sourceErrorRow(e, ours(e), amlegalUrl(e))),
          `</ol>`,
        ].join("\n"),
  ].join("\n");
  return {
    path: SOURCE_ERRORS_PATH,
    file: "source-errors/index.html",
    kind: "source-errors",
    html: page({
      path: SOURCE_ERRORS_PATH,
      title: titleOf(SOURCE_ERRORS_TITLE),
      description: describe("Mistakes BetaNYC found in American Legal Publishing's text of the City's laws, and where each one stands."),
      main,
      // A preview is never published, and is never indexed if someone does.
      noindex: preview,
      site,
      scripts: n ? ["/assets/source-errors.js"] : [],
      jsonLd: [breadcrumbJsonLd(crumbs)],
    }),
  };
}
