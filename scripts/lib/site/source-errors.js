// Errors in the publisher's text (data/source-errors.json): mistakes BetaNYC finds in American
// Legal Publishing's files, the text this site and the MCP server are built from. BetaNYC never
// changes that text; it lists each error, checks it, and reports it to the publisher and the
// City. BetaNYC's own bugs are in WHATS-CHANGED.md, not here.
//
// This module is the file's schema and the rule for which entries a build shows. Pure: build.js
// reads the file and passes its text in.

import { z } from "zod";

/** Where to report an error in the publisher's text (DATA-SOURCES.json report_errors, and FOOTER in src/tools.ts). */
export const REPORT_TO = Object.freeze({
  publisher: "NYC.editor@amlegal.com",
  lawDepartment: "NYCCodeRulesCharter@law.nyc.gov",
});

/** The books an entry can name: the index's corpus names. */
export const SOURCE_ERROR_BOOKS = Object.freeze(["charter", "admin_code", "rules"]);

/** Kinds of error, in the order the page lists them, each with the words a reader sees. */
export const SOURCE_ERROR_KINDS = Object.freeze([
  ["picture-text-mismatch", "Picture and text disagree"],
  ["same-picture-twice", "Same picture used twice"],
  ["typo-in-picture", "Mistake inside a picture"],
  ["missing-figure", "Missing figure"],
  ["garbled-text", "Garbled text"],
  ["misplaced-picture", "Picture in the wrong place"],
  ["picture-turned", "Picture turned on its side"],
]);

/**
 * Statuses, in the order an entry moves through them, each with the words a reader sees.
 * found → confirmed (a person at BetaNYC checked it against the XML and the picture) → reported
 * (sent to the publisher and the Law Department) → fixed-upstream (the publisher's files no
 * longer have it). not-an-error: a person checked it and it is not a mistake; never shown.
 */
export const SOURCE_ERROR_STATUSES = Object.freeze([
  ["found", "Found, not yet checked"],
  ["confirmed", "Confirmed"],
  ["reported", "Reported to the publisher"],
  ["fixed-upstream", "Fixed by the publisher"],
  ["not-an-error", "Not an error"],
]);

/** The statuses a normal build shows. */
export const PUBLIC_STATUSES = Object.freeze(["confirmed", "reported", "fixed-upstream"]);

const label = (list, key) => list.find(([k]) => k === key)?.[1] ?? key;
export const kindLabel = (k) => label(SOURCE_ERROR_KINDS, k);
export const statusLabel = (s) => label(SOURCE_ERROR_STATUSES, s);

// A real calendar day, "2026-11-25".
const day = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "a date like 2026-11-25")
  .refine((s) => {
    const d = new Date(`${s}T00:00:00Z`);
    return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
  }, "not a real date");
const text = z.string().trim().min(1);

const image = z
  .object({
    image_id: z.string().regex(/^\d+(?:-\d+)*$/, "an image id like 0-0-0-22810 (the file name in the zip's IMAGES/ folder)"),
    file: z.string().regex(/^IMAGES\/[^/]+$/, "the file's path in the zip, like IMAGES/0-0-0-22810.jpg"),
    sha256: z.string().regex(/^[0-9a-f]{64}$/, "the image file's full sha256, 64 hex digits"),
  })
  .strict();

const evidence = z
  .object({
    // What the publisher's text says, quoted from the XML (not from notes), or null when the
    // error is inside a picture and no text speaks to it.
    text: text.nullable(),
    // The XML records the quote and the pictures come from, so a person can find them again.
    records: z.array(z.string().regex(/^\d+(?:-\d+)*$/)).min(1),
    // What the picture shows, in BetaNYC's words, or null when no picture is involved.
    picture: text.nullable(),
    images: z.array(image),
  })
  .strict()
  .refine((e) => e.text !== null || e.picture !== null, "evidence needs the text, the picture, or both")
  .refine((e) => (e.picture === null) === (e.images.length === 0), "a picture's description and its image files come together");

export const SourceErrorSchema = z
  .object({
    id: z.string().regex(/^SE-\d{4}$/, "an id like SE-0001"),
    book: z.enum(SOURCE_ERROR_BOOKS),
    // The section's citation as its page on this site writes it (its h1).
    citation: text,
    // American Legal's id for the section: https://codelibrary.amlegal.com/codes/newyorkcity/latest/<book>/<id>.
    amlegal_id: z.string().regex(/^\d+(?:-\d+)*$/, "American Legal's record id, like 0-0-0-179409"),
    kind: z.enum(SOURCE_ERROR_KINDS.map(([k]) => k)),
    summary: text,
    evidence,
    found: day,
    found_in: text,
    status: z.enum(SOURCE_ERROR_STATUSES.map(([k]) => k)),
    confirmed_at: day.nullable(),
    reported_at: day.nullable(),
    fixed_at: day.nullable(),
    notes: z.string(),
  })
  .strict();

export const SourceErrorsFileSchema = z
  .object({
    about: text,
    format: z.literal(1),
    errors: z.array(SourceErrorSchema),
  })
  .strict();

/**
 * Checks across fields and entries that the schema cannot: unique ids, the dates each status
 * needs, and dates in order. Returns a list of problems ("SE-0003: ..."), empty when all is well.
 */
export function crossCheck(errors) {
  const problems = [];
  const seen = new Set();
  for (const e of errors) {
    const say = (m) => problems.push(`${e.id}: ${m}`);
    if (seen.has(e.id)) say("id used twice");
    seen.add(e.id);
    const need = { found: [], confirmed: ["confirmed_at"], reported: ["confirmed_at", "reported_at"], "fixed-upstream": ["confirmed_at", "reported_at", "fixed_at"], "not-an-error": [] }[e.status];
    for (const f of need) if (!e[f]) say(`status ${e.status} needs ${f}`);
    if (e.status === "found") for (const f of ["confirmed_at", "reported_at", "fixed_at"]) if (e[f]) say(`status found cannot have ${f} (move the status forward)`);
    if (e.status === "confirmed") for (const f of ["reported_at", "fixed_at"]) if (e[f]) say(`status confirmed cannot have ${f}`);
    if (e.status === "reported" && e.fixed_at) say("status reported cannot have fixed_at");
    const order = [["found", e.found], ["confirmed_at", e.confirmed_at], ["reported_at", e.reported_at], ["fixed_at", e.fixed_at]].filter(([, v]) => v);
    for (let i = 1; i < order.length; i++) if (order[i][1] < order[i - 1][1]) say(`${order[i][0]} (${order[i][1]}) is before ${order[i - 1][0]} (${order[i - 1][1]})`);
  }
  return problems;
}

/**
 * Parse and check the file's text. Throws one error listing every problem, so a bad edit stops
 * the build (and the deploy) with the fix in plain view.
 */
export function parseSourceErrors(jsonText, file = "data/source-errors.json") {
  let raw;
  try {
    raw = JSON.parse(jsonText);
  } catch (e) {
    throw new Error(`${file} is not valid JSON: ${e.message}`);
  }
  const r = SourceErrorsFileSchema.safeParse(raw);
  if (!r.success) {
    // "SE-0003 evidence.images[0].sha256: ..." (the entry by its id, or by its place when it has none).
    const pathText = (path) => path.map((p) => (typeof p === "number" ? `[${p}]` : `.${p}`)).join("").replace(/^\./, "");
    const lines = r.error.issues.map((i) => {
      if (i.path[0] === "errors" && typeof i.path[1] === "number") {
        const id = raw.errors?.[i.path[1]]?.id;
        const who = typeof id === "string" && id ? id : `errors[${i.path[1]}]`;
        const rest = pathText(i.path.slice(2));
        return `${who}${rest ? ` ${rest}` : ""}: ${i.message}`;
      }
      return `${pathText(i.path) || "(top)"}: ${i.message}`;
    });
    throw new Error(`${file} does not match its schema:\n  ${lines.join("\n  ")}`);
  }
  const problems = crossCheck(r.data.errors);
  if (problems.length) throw new Error(`${file} has problems:\n  ${problems.join("\n  ")}`);
  return r.data;
}

/**
 * The entries a build shows: confirmed, reported and fixed-upstream; with includeUnconfirmed (the
 * preview build, --include-unconfirmed-errors), also those only found. Never not-an-error.
 * In the file's order.
 */
export function visibleErrors(errors, { includeUnconfirmed = false } = {}) {
  return errors.filter((e) => PUBLIC_STATUSES.includes(e.status) || (includeUnconfirmed && e.status === "found"));
}

/** "2026-11-25" → "November 25, 2026" (a calendar day, no time zone to apply). */
export function longDay(s) {
  const [y, m, d] = s.split("-").map(Number);
  const month = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"][m - 1];
  return `${month} ${d}, ${y}`;
}
