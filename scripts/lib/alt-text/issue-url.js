// The "Suggest a better description" link for the alt-text page's GitHub Pages mode (issue
// #87): a prefilled https://github.com/BetaNYC/nyc-charter-laws-rules/issues/new link, so a
// reader's suggestion arrives as a new GitHub issue for a person to review. Nothing is sent
// until the reader presses GitHub's own submit button.
//
// GitHub reads `title` and `body` from the query string ("Creating an issue from a URL query",
// docs.github.com). GitHub does not document a length limit; very long URLs fail, so the
// whole URL is kept under MAX_URL_LENGTH by cutting the longest texts first and saying so.
// This file is also served to the browser as-is (no Node imports).

export const REPO_ISSUES = "https://github.com/BetaNYC/nyc-charter-laws-rules/issues/new";
export const MAX_URL_LENGTH = 6000;
export const BOOK_NAMES = { admin_code: "Administrative Code", rules: "Rules of the City of New York" };
const CUT = " […cut to fit the link; please paste the rest here]";

function describe(t) {
  if (!t || (!t.alt && !t.long)) return "(none)";
  const lines = [`Alt text: ${t.alt || "(empty)"}`];
  if (t.long) lines.push("", `Long description: ${t.long}`);
  return lines.join("\n");
}

function bodyOf(p, current, suggestion) {
  return [
    `**Book:** ${BOOK_NAMES[p.book] ?? p.book}`,
    `**Where:** ${(p.heading && p.citation && p.heading.startsWith(p.citation) ? p.heading : [p.citation, p.heading].filter(Boolean).join(" — ")) || "(unknown)"}`,
    `**Picture ids:** ${(p.picture_ids ?? []).join(", ")}`,
    `**Image file:** ${(p.image_ids ?? []).join(", ")}`,
    `**Image sha256:** \`${p.sha256}\``,
    "",
    `### Current description (${p.currentLabel ?? "BetaNYC"})`,
    "",
    describe(current),
    "",
    "### Suggested description",
    "",
    describe(suggestion),
    ...(p.why ? ["", "### Why", "", p.why] : []),
    "",
    "_Sent from BetaNYC's picture description page. These descriptions are written by BetaNYC, not by American Legal Publishing. A person at BetaNYC reviews every suggestion before it is used._",
  ].join("\n");
}

// encodeURIComponent throws on a lone surrogate (half of an emoji or a math letter, as a
// pasted fragment can carry), so such a half is replaced with U+FFFD first.
const wellFormed = (s) => (typeof s.toWellFormed === "function" ? s.toWellFormed() : s.replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, "\uFFFD"));
const enc = (s) => encodeURIComponent(wellFormed(s));

function build(title, body) {
  return `${REPO_ISSUES}?title=${enc(title)}&body=${enc(body)}`;
}

// Cut on a code point boundary: never between the two halves of a surrogate pair.
function shorten(s, by) {
  if (!s) return s;
  let keep = Math.max(0, s.length - by - CUT.length);
  if (keep >= s.length) return s;
  const last = s.charCodeAt(keep - 1);
  if (keep > 0 && last >= 0xd800 && last <= 0xdbff) keep--;
  return `${s.slice(0, keep)}${CUT}`;
}

/**
 * The issue link for one picture. p: { book, citation, heading, picture_ids, image_ids, sha256,
 * currentLabel, why }; current and suggestion: { alt, long }. Returns { url, cut }, where cut
 * is true when some text was shortened to fit.
 */
export function issueUrl(p, current, suggestion, maxLength = MAX_URL_LENGTH) {
  const title = `Picture description: ${BOOK_NAMES[p.book] ?? p.book} ${p.citation || ""} (${(p.image_ids ?? [])[0] ?? p.sha256.slice(0, 12)})`.replace(/\s+/g, " ");
  let cur = { ...(current ?? {}) };
  let sug = { ...(suggestion ?? {}) };
  let why = p.why;
  let url = build(title, bodyOf({ ...p, why }, cur, sug));
  let cut = false;
  // Cut the longest field (in encoded characters) until it fits; each pass removes at least
  // the overflow measured in raw characters, which is never more than the encoded overflow.
  for (let i = 0; url.length > maxLength && i < 20; i++) {
    cut = true;
    const over = url.length - maxLength;
    const fields = [
      ["cur.long", cur.long],
      ["sug.long", sug.long],
      ["why", why],
      ["cur.alt", cur.alt],
      ["sug.alt", sug.alt],
    ].filter(([, v]) => v);
    if (!fields.length) break;
    fields.sort((a, b) => enc(b[1]).length - enc(a[1]).length);
    const [name, value] = fields[0];
    const ratio = value.length / enc(value).length;
    const by = Math.max(1, Math.ceil(over * ratio) + CUT.length);
    const next = shorten(value, by);
    if (name === "cur.long") cur.long = next;
    else if (name === "sug.long") sug.long = next;
    else if (name === "why") why = next;
    else if (name === "cur.alt") cur.alt = next;
    else sug.alt = next;
    url = build(title, bodyOf({ ...p, why }, cur, sug));
  }
  return { url, cut };
}
