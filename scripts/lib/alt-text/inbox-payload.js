// "Send a better description" for the picture description page's inbox mode (issue #87): the
// JSON body the page POSTs to BetaNYC's data-issue intake on www.beta.nyc, and what the page
// says about each answer. The intake files each suggestion as an issue in a private repo, where
// a person at BetaNYC reads it; nothing on law.beta.nyc changes until they do.
//
// Built against the intake's contract, kind `alt-text-suggestion` (betanyc-ai-workspace
// team/reference/data-issue-intake.md, "Contract amendment 2026-11-25: Law Reader picture
// descriptions"). Every field name, limit and answer below is from that section:
//   - body: schema, tool "law-reader", kind "alt-text-suggestion", page_url (under
//     https://law.beta.nyc, at most 500 characters), book ("admin_code" | "rules"),
//     image_sha256 (64 lowercase hex), picture_ids (1 to 20 of ^[A-Za-z0-9_.:-]{1,64}$),
//     suggested_alt (at most 1,000), suggested_long (at most 10,000), at least one of the two
//     non-empty, note (at most 500), credit_ok (boolean), client_id (^[A-Za-z0-9-]{16,64}$),
//     contact { name (at most 100), email (at most 200) }, website (the trap field, "").
//   - characters are code points after cleaning (NFKC, control and format characters removed
//     except newline, trimmed): cleanText() does the same here, so a count matches the server's.
//   - answers: 201 { ok: true }; 400 { ok: false, error: <fixed string> }; 403 (origin);
//     429 with Retry-After in seconds; 503.
//
// The contact block is its own object: the intake files it under "### Contact" in the private
// repo, never in the report. This file is also served to the browser as-is (no Node imports).

export const ENDPOINT = "https://www.beta.nyc/wp-json/betanyc-data/v1/report";
export const SITE_BASE = "https://law.beta.nyc";
export const PRIVACY_URL = "https://www.beta.nyc/privacy-policy/";
export const SCHEMA = "betanyc-data-issue/1";
export const TOOL = "law-reader";
export const KIND = "alt-text-suggestion";
export const BOOKS = ["admin_code", "rules"];
export const LIMITS = { alt: 1000, long: 10000, note: 500, name: 100, email: 200, page_url: 500, picture_ids: 20 };

const FIELD_NAMES = { alt: "alt text", long: "long description", note: "note", name: "name", email: "email" };
const SHA = /^[0-9a-f]{64}$/;
const PICTURE_ID = /^[A-Za-z0-9_.:-]{1,64}$/;
const CLIENT_ID = /^[A-Za-z0-9-]{16,64}$/;
// What the endpoint's is_email() would plainly refuse. Not a full check: the server decides.
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** The intake's cleaning: NFKC, then every control and format character but "\n" removed, trimmed. */
export function cleanText(s) {
  return String(s ?? "")
    .normalize("NFKC")
    .replace(/(?!\n)[\p{Cc}\p{Cf}]/gu, "")
    .trim();
}

/** Characters as the intake counts them: code points after cleaning. */
export const charCount = (s) => Array.from(cleanText(s)).length;

export const isClientId = (s) => typeof s === "string" && CLIENT_ID.test(s);

/** True for https://law.beta.nyc exactly, or followed by "/", "?" or "#", at most 500 characters. */
export function isLawReaderUrl(url) {
  if (typeof url !== "string" || /\s/.test(url) || Array.from(url).length > LIMITS.page_url) return false;
  if (!url.startsWith(SITE_BASE)) return false;
  const next = url.slice(SITE_BASE.length, SITE_BASE.length + 1);
  return next === "" || next === "/" || next === "?" || next === "#";
}

/** A new random id for this browser: 32 hex characters. `crypto` is the Web Crypto object. */
export function newClientId(cryptoObj = globalThis.crypto) {
  if (typeof cryptoObj?.randomUUID === "function") return cryptoObj.randomUUID();
  const b = new Uint8Array(16);
  cryptoObj.getRandomValues(b);
  return Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
}

function over(field, n) {
  return { field, message: `The ${FIELD_NAMES[field]} is ${n.toLocaleString("en-US")} characters; the limit is ${LIMITS[field].toLocaleString("en-US")}. Shorten it and send again.` };
}

/**
 * The body to send for one suggestion, or the problems that stop it.
 * picture: { book, sha256, picture_ids, page_url }; form: { alt, long, note, name, email,
 * creditOk, website }; clientId: from storage (left out when it is not a valid id).
 * Returns { ok: true, body } or { ok: false, problems: [{ field, message }] }.
 */
export function buildPayload(picture, form, clientId) {
  const problems = [];
  const t = {};
  for (const k of ["alt", "long", "note", "name", "email"]) t[k] = cleanText(form?.[k]);
  for (const k of ["alt", "long", "note", "name", "email"]) {
    const n = Array.from(t[k]).length;
    if (n > LIMITS[k]) problems.push(over(k, n));
  }
  if (!t.alt && !t.long) problems.push({ field: "alt", message: "Write an alt text or a long description before you send." });
  if (t.email && !EMAIL.test(t.email)) problems.push({ field: "email", message: "That email address does not look complete. Fix it, or leave it empty." });
  if (form?.creditOk === true && !t.name) problems.push({ field: "name", message: "To be credited by name, write your name, or untick the box." });
  // The picture's own facts come from the page's data, not from the person; a bad one is a
  // problem with the page build, said plainly rather than sent and refused.
  const pictureIds = Array.isArray(picture?.picture_ids) ? picture.picture_ids : [];
  if (!BOOKS.includes(picture?.book) || !SHA.test(picture?.sha256 ?? "") || !pictureIds.length || pictureIds.length > LIMITS.picture_ids || !pictureIds.every((p) => typeof p === "string" && PICTURE_ID.test(p)) || !isLawReaderUrl(picture?.page_url)) {
    problems.push({ field: null, message: "This picture's details are not in the form the inbox takes, so it cannot be sent from this page. Please tell BetaNYC at lab@beta.nyc." });
  }
  if (problems.length) return { ok: false, problems };

  const body = {
    schema: SCHEMA,
    tool: TOOL,
    kind: KIND,
    page_url: picture.page_url,
    book: picture.book,
    image_sha256: picture.sha256,
    picture_ids: [...pictureIds],
    suggested_alt: t.alt,
    suggested_long: t.long,
    note: t.note,
    credit_ok: form?.creditOk === true,
  };
  if (isClientId(clientId)) body.client_id = clientId;
  const contact = {};
  if (t.name) contact.name = t.name;
  if (t.email) contact.email = t.email;
  if (Object.keys(contact).length) body.contact = contact;
  // The trap field goes as the form holds it: a person never sees it, so it is "" unless a
  // robot filled it, and then the intake answers 201 and files nothing.
  body.website = typeof form?.website === "string" ? form.website : "";
  return { ok: true, body };
}

/** Minutes, rounded up, for a Retry-After header in seconds (or null). */
function waitText(retryAfter) {
  const s = Number(retryAfter);
  if (!Number.isFinite(s) || s <= 0) return "a while";
  const m = Math.ceil(s / 60);
  if (m <= 1) return "a minute";
  if (m < 120) return `${m} minutes`;
  return `${Math.ceil(m / 60)} hours`;
}

// The intake's fixed error strings for this kind, in words a reader can act on.
const ERRORS = {
  "Invalid suggested_alt.": "the alt text is too long or not plain text.",
  "Invalid suggested_long.": "the long description is too long or not plain text.",
  "Invalid note.": "the note is too long or not plain text.",
  "Invalid suggestion.": "write an alt text or a long description first.",
  "Invalid contact email.": "that email address was not accepted. Fix it, or leave it empty.",
  "Invalid contact name.": "the name is too long.",
  "Body too large.": "the suggestion is too long to send in one go.",
};

/**
 * What the page says about the intake's answer. status: the HTTP status (0 when the request
 * never got an answer); data: the parsed JSON body or null; retryAfter: the Retry-After header.
 * Returns { kind: "sent" | "rejected" | "origin" | "rate" | "unavailable" | "network" | "other", message }.
 */
export function describeResponse(status, data, retryAfter) {
  const kept = " Your text is still here.";
  if (status === 201 && data?.ok === true) return { kind: "sent", message: "Sent. Thank you. A person at BetaNYC will read your suggestion before anything on the Law Reader changes." };
  if (status === 0) return { kind: "network", message: `Not sent: the page could not reach www.beta.nyc. Check your connection and try again.${kept}` };
  if (status === 400) {
    const said = typeof data?.error === "string" ? data.error : "";
    return { kind: "rejected", message: `Not sent: ${ERRORS[said] ?? `the inbox refused it${said ? ` (“${said}”)` : ""}.`}${kept}` };
  }
  if (status === 403) return { kind: "origin", message: `Not sent: suggestions can only be sent from the Law Reader at law.beta.nyc.${kept}` };
  if (status === 429) return { kind: "rate", message: `Not sent: too many suggestions have come from your connection, or from everyone today. Try again in ${waitText(retryAfter)}.${kept}` };
  if (status === 503) return { kind: "unavailable", message: `Not sent: the inbox is not working right now. Try again later.${kept}` };
  return { kind: "other", message: `Not sent: the inbox gave an answer this page does not understand (status ${status}). Try again later.${kept}` };
}
