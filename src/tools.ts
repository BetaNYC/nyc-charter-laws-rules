// Tool table and dispatch for the MCP server.
//
// Kept out of index.ts so tests can import TOOLS/callTool without index.ts's
// top-level `server.connect(new StdioServerTransport())` side effect.

import { readFileSync } from "fs";
import { z } from "zod";
import { toJsonSchemaCompat } from "@modelcontextprotocol/sdk/server/zod-json-schema-compat.js";
import {
  searchWithFallback,
  getSection,
  listTitles,
  getTitle,
  namesTitle,
  getVersions,
  fullCitation,
  titleHeadings,
  hasTitles,
  isEmptyQuery,
  type Corpus,
  type SearchMode,
} from "./corpus.js";
import { createBetanycTools, annotateTools, toolError, provenance, type ObjectJsonSchema } from "./betanyc-tools.js";
import { PACKAGE_VERSION } from "./version.js";

/**
 * whats_changed, about_betanyc and about_data, the three tools BetaNYC adds to each of its MCP
 * servers (betanyc-ai-workspace platform/system/whats-changed-standard.md § 7 and
 * about-data-standard.md). betanyc-tools.ts is a copy of the workspace's canonical file: never
 * edit it here. WHATS-CHANGED.md and DATA-SOURCES.json ship in the npm package (package.json
 * `files`), one level above dist/. This repo has no website, so links go to GitHub.
 *
 * How current each source is comes from the index this server is actually serving: the
 * `indexedAt` time build-index.js writes into versions.json for each document (hooks below).
 * A missing or unreadable index makes the hook throw, which about_data reports as unavailable.
 * `dataSourcesText` is for tests.
 */
export function makeBetanycTools(opts: { dataSourcesText?: string } = {}) {
  return createBetanycTools({
    serverName: "nyc-charter-laws-rules",
    version: PACKAGE_VERSION,
    repoUrl: "https://github.com/BetaNYC/nyc-charter-laws-rules",
    whatsChangedPath: new URL("../WHATS-CHANGED.md", import.meta.url),
    dataSourcesPath: new URL("../DATA-SOURCES.json", import.meta.url),
    ...(opts.dataSourcesText !== undefined ? { dataSourcesText: opts.dataSourcesText } : {}),
    freshness: {
      charter_indexed: () => getVersions().charter?.indexedAt ?? null,
      admin_code_indexed: () => getVersions().admin_code?.indexedAt ?? null,
      rules_indexed: () => getVersions().rules?.indexedAt ?? null,
    },
  });
}

const betanyc = makeBetanycTools();


// The disclaimer goes once in the server instructions (SERVER_INSTRUCTIONS) and at the end
// of every answer (withFooter), not in each tool description (issue #48).

export const FOOTER = `
---
⚠️ **This information is for research and informational purposes only and does not constitute legal advice.** NYC laws and rules are amended frequently — always verify the current text at https://codelibrary.amlegal.com/codes/newyorkcity/latest/overview before acting on any information. For the latest rules information, see https://rules.cityofnewyork.us. For legal matters, consult a licensed attorney.

**Official disclaimer from American Legal Publishing:** The Codes and other documents that appear on this site may not yet reflect the most current legislation or rules adopted by the City. In addition, certain textual errors and omissions may temporarily exist, resulting from problems in the source database provided to American Legal and from which this website was created. Although these errors and omissions are being corrected, any user discovering any such error is invited to contact the publisher at NYC.editor@amlegal.com or 800-445-5588 and/or the NYC Law Department at NYCCodeRulesCharter@law.nyc.gov.

Built by BetaNYC (https://beta.nyc). Feedback and improvements welcome — file a GitHub issue at https://github.com/BetaNYC/nyc-charter-laws-rules.`.trim();

/** The server's MCP instructions, sent once per connection (index.ts): the full disclaimer
 * (#25), then the shared module's instructions (call about_data for where the data comes from
 * and how current it is, about_betanyc for who built the server, whats_changed for fixes). */
export const SERVER_INSTRUCTIONS = `${FOOTER}\n\n${betanyc.instructions}`;

// One line that rides every response once the full footer has been sent
// (issue #25). It must keep the words "legal advice": the regression test
// checks every response in every mode for them.
export const COMPACT_FOOTER =
  "⚠️ Not legal advice. Verify at https://codelibrary.amlegal.com/codes/newyorkcity/latest/overview.";

// NYC_CLR_FOOTER chooses how much of the disclaimer each response carries:
//   full-then-compact (default)  full FOOTER on the first response after the
//                                server process starts, COMPACT_FOOTER after
//   full                         full FOOTER on every response (the behavior
//                                through 0.3.x)
// MCP tells a server nothing about where a chat begins, so "first" means first
// in this process's lifetime. The full text also goes out once per connection
// as the server's `instructions` (index.ts), whatever the mode.
export const FOOTER_ENV = "NYC_CLR_FOOTER";
export const FOOTER_MODES = ["full-then-compact", "full"] as const;
export type FooterMode = (typeof FOOTER_MODES)[number];
export const DEFAULT_FOOTER_MODE: FooterMode = "full-then-compact";

// An unset or blank value is the default. An unrecognized value falls back to
// `full` (more disclaimer, never less) and comes back with a warning for
// index.ts to print to stderr at startup (stdout carries the protocol).
export function resolveFooterMode(
  env: NodeJS.ProcessEnv = process.env
): { mode: FooterMode; warning?: string } {
  const raw = env[FOOTER_ENV]?.trim();
  if (!raw) return { mode: DEFAULT_FOOTER_MODE };
  const value = raw.toLowerCase();
  if ((FOOTER_MODES as readonly string[]).includes(value)) {
    return { mode: value as FooterMode };
  }
  // An unrecognized value errs toward more disclaimer, never less (#25).
  return {
    mode: "full",
    warning:
      `nyc-charter-laws-rules: ${FOOTER_ENV}="${raw}" is not one of ` +
      `${FOOTER_MODES.join(", ")}; using full.`,
  };
}

const initialFooter = resolveFooterMode();
export const FOOTER_WARNING = initialFooter.warning;
let footerMode: FooterMode = initialFooter.mode;
let fullFooterSent = false;

// Test hook: re-read the mode from `env` and forget that the full footer has
// been sent, as if the server process had just started.
export function resetFooterState(env: NodeJS.ProcessEnv = process.env): void {
  footerMode = resolveFooterMode(env).mode;
  fullFooterSent = false;
}

// The disclaimer on whats_changed and about_betanyc. They answer about the server, not from
// the law text, so they do not use up the full footer meant for the first law answer: in
// the default mode they end with the one-line footer, in `full` mode with the full one. The
// standard lets a server append to their text but never change their structuredContent
// (whats-changed-standard.md § 7, "A server's own wrapper").
export function sharedToolFooter(): string {
  return footerMode === "full" ? FOOTER : COMPACT_FOOTER;
}

function withFooter(text: string): string {
  if (footerMode === "full" || !fullFooterSent) {
    fullFooterSent = true;
    return `${text}\n\n${FOOTER}`;
  }
  return `${text}\n\n${COMPACT_FOOTER}`;
}

// Anything the caller sent that an answer repeats back (a query, a citation, a key or tool
// name) goes through echo() first: one line, at most ECHO_MAX characters, ending "…" when cut.
// Before this a 5,000-character query, or one carrying fake stack-trace lines, came back
// whole. The first non-empty line is kept; control and format characters become spaces.
export const ECHO_MAX = 100;
export function echo(value: unknown, max = ECHO_MAX): string {
  const text = typeof value === "string" ? value : String(value);
  const lines = text
    .split(/\r\n|[\n\r\u2028\u2029]/)
    .map((l) => l.replace(/[\p{Cc}\p{Cf}]/gu, " ").replace(/\s+/g, " ").trim())
    .filter(Boolean);
  const out = (lines[0] ?? "") + (lines.length > 1 ? " …" : "");
  const cp = [...out];
  return cp.length > max ? `${cp.slice(0, max - 1).join("").trimEnd()}…` : out;
}

// At most this many unknown parameter names are listed back; the rest are counted.
const MAX_ECHOED_KEYS = 5;

// Reject unknown keys loudly (issue #19). Zod strips them by default, so an
// invented parameter used to be dropped and the tool answered a different
// question with real, correctly formatted data. The message names the offending
// key AND this tool's accepted keys, so the caller can correct itself.
function parseArgs<T extends z.ZodRawShape>(
  toolName: string,
  shape: T,
  args: unknown
): z.infer<z.ZodObject<T, "strict">> {
  const parsed = z.object(shape).strict().safeParse(args ?? {});
  if (parsed.success) return parsed.data;
  const bad = parsed.error.issues.flatMap((i) =>
    i.code === "unrecognized_keys" ? i.keys : []
  );
  const accepted = Object.keys(shape);
  if (bad.length === 0) {
    // A plain sentence per problem, not zod's JSON (issue #46).
    // zod's enum message ends with the value received, which can be any length: that case is
    // written here, with the value through echo(). Other messages hold no caller text.
    const problems = parsed.error.issues.map((i) => {
      const key = echo(i.path.join(".") || "arguments");
      if (i.code === "invalid_type" && i.received === "undefined") return `'${key}' is required`;
      if (i.code === "invalid_enum_value") {
        return `'${key}' must be one of ${i.options.map((o) => `'${String(o)}'`).join(", ")}, not '${echo(i.received)}'`;
      }
      return `'${key}': ${echo(i.message)}`;
    });
    throw new Error(
      `${toolName} was called with bad parameters: ${problems.join("; ")}. ` +
        `Accepted parameters: ${accepted.join(", ") || "none"}. Fix them and call again.`
    );
  }
  const named = bad.slice(0, MAX_ECHOED_KEYS).map((k) => `'${echo(k)}'`).join(", ");
  const others = bad.length > MAX_ECHOED_KEYS ? ` and ${bad.length - MAX_ECHOED_KEYS} more` : "";
  throw new Error(
    `${toolName} does not accept ${named}${others}. ` +
      (accepted.length
        ? `Accepted parameters: ${accepted.join(", ")}. `
        : `${toolName} takes no parameters. `) +
      "Unrecognized parameters are rejected rather than ignored: dropping one " +
      "would return real, correctly formatted results for a different question."
  );
}

// First line of a search response whose query did not match as typed
// (issue #30). The response must never quietly answer a different question
// (the principle behind #19), so it says which terms it searched for and,
// when it widened to partial matches, that it did. The word fallback sorts by
// score alone (corpus.ts termScore), so a section with every term is not
// necessarily listed first: the line says "no section matched every term" only
// when none in the documents searched does (allTermTotal 0), not when none of
// them made this page.
export function searchNotice(
  mode: SearchMode,
  terms: string[],
  allTermTotal: number
): string | null {
  const list = echo(terms.join(", "));
  if (mode === "all-terms") {
    return `No section contains the exact query; showing sections containing all of: ${list}.`;
  }
  if (mode === "some-terms") {
    if (allTermTotal === 0) {
      return `No section matched every term; showing sections matching some of: ${list}.`;
    }
    return `No section contains the exact query; showing the best matches for some or all of: ${list}.`;
  }
  return null;
}

const sections = (n: number) => (n === 1 ? "1 section" : `${n} sections`);
const isAre = (n: number) => (n === 1 ? "is" : "are");

// The count line after a search's results (issue #42). For a phrase match, how many sections
// matched in all. When search fell back to single terms (issue #30), a section with any one
// term counts as a match, so a plain total would be mostly noise ("Showing 10 of 1526"): it
// says how many contain every term and how many of those are shown, then separately how many
// contain only some, and does not point at a higher limit for those. It never says the
// every-term sections come first, or that the others are worse: under the word ranking a section
// with fewer, rarer terms in its heading can rank above one with every term.
export function searchCountLine(o: {
  mode: SearchMode;
  shown: number;
  allTermResults: number;
  total: number;
  allTermTotal: number;
  limit: number;
}): string | null {
  const raise = o.limit < 50 ? "raise limit (max 50), " : "";
  if (o.mode === "phrase") {
    return o.total > o.shown
      ? `Showing ${o.shown} of ${o.total} matching sections, best first. To see others, ${raise}narrow the query, or search one corpus.`
      : null;
  }
  const lines: string[] = [];
  const all = o.allTermTotal;
  const allShown = o.allTermResults;
  // Every-term matches: said when some are not shown, or when partial matches are shown
  // beside them (so the reader can tell the two apart).
  if (all > 0 && (allShown < all || o.mode === "some-terms")) {
    const contain = all === 1 ? "1 section contains every term" : `${all} sections contain every term`;
    const which =
      allShown === all ? (all === 1 ? "it is shown" : "all are shown")
      : allShown === 0 ? (all === 1 ? "it does not rank in this list" : "none of them ranks in this list")
      : `${allShown} of them ${isAre(allShown)} shown`;
    const more = allShown < all ? ` To see more of them, ${raise}narrow the query, or search one corpus.` : "";
    lines.push(`${contain}; ${which}.${more}`);
  }
  const partial = o.total - all;
  const partialShown = o.shown - allShown;
  if (partial > 0) {
    const who = all === 0
      ? `${sections(partial)} contain${partial === 1 ? "s" : ""} some of the terms`
      : `${partial === 1 ? "1 other section contains" : `${partial} other sections contain`} only some of the terms`;
    lines.push(
      partialShown === 0
        ? `${who} and ${isAre(partial)} not shown.`
        : `${who}; ${partialShown === partial ? (partial === 1 ? "it is shown" : "all are shown") : `the ${partialShown} shown ${isAre(partialShown)} the best-ranked of those`}. ` +
            "Fewer, more specific keywords usually find better ones."
    );
  }
  return lines.length ? lines.join(" ") : null;
}

// Where each document comes from, read from DATA-SOURCES.json (which ships with the package)
// so the line in each answer says what about_data says (issues #40, #41).
type DocSource = { id: string; title: string; source_name: string; changes: { changed: boolean }; publisher: { name: string }; verify_at: string };
const SOURCES = Object.fromEntries(
  (JSON.parse(readFileSync(new URL("../DATA-SOURCES.json", import.meta.url), "utf8")).sources as DocSource[])
    .map((src) => [src.id.replace(/-/g, "_"), src])
) as Record<Corpus, DocSource>;

const ALL_CORPORA: Corpus[] = ["charter", "admin_code", "rules"];

// "Searched: the New York City Charter and the Administrative Code." for a not-found answer,
// so it says where the server looked, not only that it found nothing.
function searchedLine(corpora: Corpus[]): string {
  const names = corpora.map((c) => `the ${SOURCES[c].title}`);
  const list = names.length < 3 ? names.join(" and ") : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
  return `Searched: ${list}.`;
}

// The publisher's own "current through" line from the XML (versions.json currentThrough),
// exactly as the publisher gives it, trailing comma included ("…November 10, 2026,"), as
// get_version shows it. Only line breaks and runs of spaces become one space, so it stays on
// one line. Null when the index has none.
export function currentThrough(c: Corpus): string | null {
  const raw = getVersions()[c]?.currentThrough;
  if (typeof raw !== "string") return null;
  const line = raw.replace(/\s+/g, " ").trim();
  return line || null;
}

// What BetaNYC did to the law text, for the source line of an answer from it (round 2 of the
// #49 review). about_data says each document was modified (DATA-SOURCES.json `changes`), so
// the answer says so too, in the shared module's words, instead of naming only the publisher.
// One line, kept in step with DATA-SOURCES.json's `changes.detail` and `known_gaps`.
export const CONVERSION_DETAIL =
  "converted by BetaNYC from the publisher's bulk XML files: line breaks are collapsed, so tables run together; " +
  "the publisher's editing markers are removed and character codes decoded; " +
  "math signs and Greek letters set in the old Symbol font are changed to the characters the font shows (³ to ≥) where BetaNYC has checked them; " +
  "citations are worked out by BetaNYC from headings and can be wrong or cut short";
export const SNIPPET_CHARS = 400;
export const SNIPPET_DETAIL = `; search snippets are cut at ${SNIPPET_CHARS} characters`;

// How much of the text before the first match a snippet keeps (issue #95).
export const SNIPPET_LEAD = 100;
const isHigh = (code: number) => code >= 0xd800 && code <= 0xdbff;
const isLow = (code: number) => code >= 0xdc00 && code <= 0xdfff;

/**
 * At most SNIPPET_CHARS characters of a section's text, around the first match of any of
 * `patterns` (issue #95), with "…" where text is left out. Through 0.7.x a snippet was always the
 * first 400 characters, so a match further in did not show. The snippet starts up to SNIPPET_LEAD
 * characters before the match, at the start of a word, and no later than the last full window of
 * the text. A match only in the heading or citation, or none found, gives the opening, as before.
 */
export function snippet(text: string, patterns: RegExp[], max = SNIPPET_CHARS): string {
  if (text.length <= max) return text;
  let at = -1;
  for (const re of patterns) {
    const m = re.exec(text);
    if (m && (at < 0 || m.index < at)) at = m.index;
  }
  let start = 0;
  if (at > SNIPPET_LEAD) {
    start = Math.min(at - SNIPPET_LEAD, text.length - max);
    if (!/\s/.test(text[start - 1])) {
      const space = text.slice(start, at).search(/\s/);
      if (space >= 0) start += space + 1;
    }
    if (isLow(text.charCodeAt(start))) start++;
  }
  let end = Math.min(text.length, start + max);
  if (end < text.length && isHigh(text.charCodeAt(end - 1))) end--;
  return `${start > 0 ? "…" : ""}${text.slice(start, end)}${end < text.length ? "…" : ""}`;
}

// get_section's text in parts (issue #95). BC 722 and RS 18-1 run 80,000 to 110,000 characters,
// and clients that cap a tool's answer cut them off. About 2% of sections are longer than the
// default part; the rest come whole, as before.
export const DEFAULT_MAX_CHARS = 20_000;
export const MIN_MAX_CHARS = 1_000;
export const MAX_MAX_CHARS = 100_000;

/**
 * The part of `text` from `offset`, at most `max` characters, ending after a space when there is
 * one in the last fifth (so a word is not cut in two), and never inside a surrogate pair. `end` is
 * the offset of the next part. Following each part's `end` gives back the whole text.
 */
export function textPart(text: string, offset: number, max: number): { part: string; end: number } {
  let end = Math.min(text.length, offset + max);
  if (end < text.length) {
    const space = text.slice(offset, end).search(/\s\S*$/);
    if (space >= 0 && space >= Math.floor(max * 0.8)) end = offset + space + 1;
    else if (isHigh(text.charCodeAt(end - 1))) end--;
  }
  return { part: text.slice(offset, end), end };
}

// The line before a part of a section's text, or null when the whole text is shown.
export function partLine(length: number, offset: number, end: number): string | null {
  if (offset > 0 && offset >= length) {
    return `Nothing at offset ${offset}: the text has ${length} characters. Call again with a smaller offset.`;
  }
  if (offset === 0 && end >= length) return null;
  const more = end < length ? ` Call again with offset ${end} for the next part.` : "";
  return `Showing characters ${offset + 1} to ${end} of ${length}.${more}`;
}

// "admin_code or rules"; "charter, admin_code or rules".
const orList = (items: string[]) => (items.length < 3 ? items.join(" or ") : `${items.slice(0, -1).join(", ")} or ${items[items.length - 1]}`);

// "text": an answer from the converted law text (search, get_section, list_titles, get_title).
// "snippets": the same, with search snippets. "dates": get_version, which reports the index's
// dates and counts, not law text, so its lines name the source plainly.
type SourceUse = "text" | "snippets" | "dates";

// Per document an answer came from: the source, its publisher, the date of this server's copy
// (indexedAt in versions.json: when the copy was built, which moves only when the text
// changed), and a link to the official code library, where a person can check the text. For
// law text, the line first says BetaNYC modified it and how (provenance's changedByBetanyc),
// and names the publisher's copy as the official record. Then, on its own labeled line, the
// publisher's "current through" line, when the index has one. The index holds no date the
// source was last checked, so none is shown.
export function sourceLines(corpora: Iterable<Corpus>, use: SourceUse = "text"): string {
  const versions = getVersions();
  return [...new Set(corpora)]
    .map((c) => {
      const modified = use !== "dates" && SOURCES[c].changes.changed;
      const line = provenance({
        sourceName: SOURCES[c].source_name,
        publisher: SOURCES[c].publisher.name,
        sourceUrl: SOURCES[c].verify_at,
        kind: "snapshot",
        asOf: versions[c]?.indexedAt ?? null,
        ...(modified
          ? { changedByBetanyc: { kind: "modified-by-betanyc" as const, detail: CONVERSION_DETAIL + (use === "snippets" ? SNIPPET_DETAIL : "") } }
          : {}),
      }).text;
      const through = currentThrough(c);
      return through ? `${line}\nThe publisher's own "current through" line for it, as given: "${through}"` : line;
    })
    .join("\n");
}

// A body, then its source lines, then the disclaimer.
function answer(text: string, corpora: Iterable<Corpus>, use: SourceUse = "text") {
  return { content: [{ type: "text" as const, text: withFooter(`${text}\n\n${sourceLines(corpora, use)}`) }] };
}

// The heading of the title a record is in ("Title 15: Department of Environmental Protection"),
// when the index has it (issue #59).
function titleName(s: { corpus: Corpus; titleNumber?: string }): string | undefined {
  return s.titleNumber ? titleHeadings(s.corpus).get(s.titleNumber) : undefined;
}

// Rules lists (list_titles, get_title) name each title once, on its own line before its first
// chapter, with a blank line before it (issue #59): every Rules title has its own Chapter 1, and
// a title is an agency's. An item with no `titleHeading` never starts a title. Other documents'
// lists are one line per item, as before.
export function withTitleLines(
  corpus: Corpus,
  items: { line: string; title: string | null; titleHeading: string | null }[],
): string {
  if (corpus !== "rules") return items.map((i) => i.line).join("\n");
  const out: string[] = [];
  let last: string | null = null;
  for (const i of items) {
    if (i.titleHeading && i.title !== last) {
      if (out.length) out.push("");
      out.push(i.titleHeading);
      last = i.title;
    }
    out.push(i.line);
  }
  return out.join("\n");
}

// Lists (issue #42): a page of `items` and a line saying which part of how many it is, and
// how to get the rest. No line when everything fits on the first page.
export const MAX_CANDIDATES = 25;
export function page<T>(items: T[], offset: number, limit: number): { shown: T[]; note: string | null } {
  const shown = items.slice(offset, offset + limit);
  if (offset === 0 && shown.length === items.length) return { shown, note: null };
  if (shown.length === 0) {
    return { shown, note: `Nothing at offset ${offset}: there are ${items.length} in all. Call again with a smaller offset.` };
  }
  const end = offset + shown.length;
  const more = end < items.length ? ` Call again with offset ${end} for the next ones.` : "";
  return { shown, note: `Showing ${offset + 1} to ${end} of ${items.length}.${more}` };
}

// Each tool's parameters, written once (issue #22). parseArgs() validates calls against them
// and inputSchema() turns them into the JSON Schema that tools/list advertises, so the two
// cannot drift. Strict on purpose (issue #19): see parseArgs().
const CORPUS = z.enum(["charter", "admin_code", "rules"]);
const SHAPES = {
  search: {
    query: z.string().describe("Keywords or an exact phrase (short keyword queries work best)"),
    corpus: z.enum(["charter", "admin_code", "rules", "all"]).optional().describe("Which document to search (default: all)"),
    limit: z.number().int().min(1).max(50).optional().describe("Max results to return (default 10, max 50)"),
  },
  get_section: {
    citation: z.string().describe("Section citation or heading; a Rules citation with its title ('15 RCNY § 1-01'); may name its book ('NYC Charter § 1133') or a part ('§ 1133(b)(1)')"),
    corpus: CORPUS.optional().describe("Which document to look in (default: all three)"),
    max_chars: z.number().int().min(MIN_MAX_CHARS).max(MAX_MAX_CHARS).optional().describe(`Most characters of text per answer (default ${DEFAULT_MAX_CHARS}, ${MIN_MAX_CHARS} to ${MAX_MAX_CHARS}); longer text comes in parts`),
    offset: z.number().int().min(0).optional().describe("Where to start: characters into a section's text, or matches into a list (default 0)"),
  },
  list_titles: {
    corpus: CORPUS.describe("Which document to list"),
    limit: z.number().int().min(1).max(1000).optional().describe("Max titles to return (default 200, max 1000)"),
    offset: z.number().int().min(0).optional().describe("How many to skip, to get the next page (default 0)"),
  },
  get_title: {
    corpus: CORPUS.describe("Which document"),
    title: z.string().describe("A chapter ('Chapter 11'), or in the Administrative Code and the Rules a title ('Title 6') or both ('Title 15, Chapter 18')"),
    limit: z.number().int().min(1).max(1000).optional().describe("Max records to return (default 200, max 1000)"),
    offset: z.number().int().min(0).optional().describe("How many to skip, to get the next page (default 0)"),
  },
  get_version: {},
} satisfies Record<string, z.ZodRawShape>;

// The SDK's own zod-to-JSON-Schema step, with the options McpServer.registerTool uses, so the
// advertised schema is what registerTool would send. It is always z.object(shape).strict(),
// never the raw shape: registerTool's raw-shape form strips unknown keys (issue #22).
export function inputSchema(shape: z.ZodRawShape): ObjectJsonSchema {
  const { $schema: _drop, ...schema } = toJsonSchemaCompat(z.object(shape).strict(), {
    strictUnions: true,
    pipeStrategy: "input",
  }) as ObjectJsonSchema;
  return schema as ObjectJsonSchema;
}

// Every tool only reads. The five law-text tools answer from the bundled index, never a live
// API, so openWorldHint is false; the shared tools bring their own annotations (issue #38).
const LOCAL = { search: false, get_section: false, list_titles: false, get_title: false, get_version: false };

export const TOOLS = annotateTools([
  {
    name: "search",
    title: "Search the law text",
    description: `Keyword search across the NYC Charter, Administrative Code, and Rules of the City of New York. This is keyword matching, not a question-answering engine: short keyword queries work best (e.g. 'sidewalk shed', 'water tank inspection'), not full questions. An empty query is an error. A query or term of 3 or fewer letters and digits matches whole words only ('x' is not the x in 'wax'). The query is first matched as an exact phrase (quotes around the whole query are removed first); results are relevance-ranked, with heading matches above citation matches above body-text matches, and whole-word matches above substring matches. If the phrase matches nothing, question words and common words are dropped and sections containing the remaining terms are returned, ranked so rare words and words in a heading count most; the response's first line says when this happened and which terms were used. Each snippet is the text around the first match.`,
    inputSchema: inputSchema(SHAPES.search),
  },
  {
    name: "get_section",
    title: "Get a section",
    description: `Retrieve a specific section by its citation (e.g. '§ 259', 'Section 259', '11-602.1', 'Chapter 11'). Input is normalized (with or without '§', any case). Pass 'corpus' to disambiguate when the same citation exists in multiple documents (e.g. charter 'Chapter 3' vs a rules chapter); if multiple sections still match, a disambiguation list is returned. Each title of the Rules restarts its numbers, so name the title: '15 RCNY § 1-01' or 'Title 15 § 1-01' ('24 RCNY Health Code § 81.08'); a bare '§ 1-01' lists every title's, each labeled with its title. A citation may name its book ('NYC Charter § 1133', 'Admin. Code § 27-506'); then only that book is looked in. Code sections: 'FC 102', 'RS 18-1'. A code may be named in words ('Building Code 722.2.1.1.4'); a bare code number ('722.2.1.1.4') is looked for in every code. A part of a section ('§ 1133(b)(1)', 'Section FC 102.4(1)') returns the whole section; the first line names the part. Long text comes in parts, long lists in pages of 25; the answer gives the offset for the next.`,
    inputSchema: inputSchema(SHAPES.get_section),
  },
  {
    name: "list_titles",
    title: "List chapters or titles",
    description: `List a document's chapters in order, each with its heading. Administrative Code chapters show their section range, since several share a number: 'Chapter 1 (§ 3-101 to § 3-196)'. Rules chapters are listed by title, each title named before its chapters: 'Title 15, Chapter 18'; a chapter with no number, such as the Health Code, by its name: 'Title 24, New York City Health Code'.`,
    inputSchema: inputSchema(SHAPES.list_titles),
  },
  {
    name: "get_title",
    title: "Get a chapter or title",
    description: `List a chapter's sections in order: its heading, then each section's citation and heading (get_section gives the text). 'Chapter 70' gives every chapter with that number. Administrative Code and Rules: 'Title 24' gives every record in that title, chapter by chapter, including chapters with no number such as the Health Code ('Title 16' is not 16-A); 'Title 15, Chapter 18' gives only its Chapter 18. Numbers match whole: 'Chapter 1' is not 'Chapter 10' or 'Chapter 1-A'.`,
    inputSchema: inputSchema(SHAPES.get_title),
  },
  {
    name: "get_version",
    title: "How current the text is",
    description: `Return the currency date for each document — how current the Charter, Administrative Code, and Rules are. Each corpus updates on its own schedule. Always call this tool before answering legal questions so responses are grounded in the correct version of the law.`,
    inputSchema: inputSchema(SHAPES.get_version),
  },
  // What changed in this server, who built it, and where its data comes from (BetaNYC standard tools).
  ...betanyc.tools,
], LOCAL);

// Every failure: isError, a plain sentence, and the disclaimer like any other answer (issue
// #46). toolError (shared module 1.5.2) drops only real stack-frame lines ("    at f (x.js:1:2)")
// from the message, keeps every other line, and caps it at 1,000 characters. It does not shorten
// a value the caller sent: callers cut those with echo() first.
function failed(message: string) {
  const r = toolError(message);
  return { ...r, content: [{ type: "text" as const, text: withFooter(r.content[0].text) }] };
}

export async function callTool(name: string, args: unknown) {
  if (betanyc.handles(name)) {
    const out = betanyc.call(name, args);
    return { ...out, content: [{ type: "text" as const, text: `${out.content[0].text}\n\n${sharedToolFooter()}` }] };
  }
  try {
    switch (name) {
      case "search": {
        const { query, corpus, limit } = parseArgs("search", SHAPES.search, args);
        // Through 0.7.x an empty query matched every section (issue #95).
        if (isEmptyQuery(query)) {
          return failed(
            `search needs words to look for, and the query was empty${query ? " (only spaces or quote marks)" : ""}. ` +
              "Send a keyword or a phrase, such as 'sidewalk shed'. For a section you know by its citation, call get_section, such as get_section('§ 259')."
          );
        }
        const max = limit ?? 10;
        const { results, mode, terms, allTermResults, total, allTermTotal, patterns, wholeWords } = searchWithFallback(
          query,
          corpus ?? "all",
          max
        );
        // Short queries and terms match whole words only (issue #95): the answer says which.
        const whole =
          wholeWords.length === 0 ? null
          : mode === "phrase" ? `"${echo(wholeWords[0])}" has 3 or fewer letters and digits, so it matched whole words only, not inside longer words.`
          : wholeWords.length === 1 ? `The term "${echo(wholeWords[0])}" has 3 or fewer letters and digits, so it matched whole words only.`
          : `Terms of 3 or fewer letters and digits (${echo(wholeWords.join(", "))}) matched whole words only.`;
        if (results.length === 0) {
          const searched = corpus && corpus !== "all" ? [corpus] : ALL_CORPORA;
          return answer(`No results found for "${echo(query)}".${whole ? ` ${whole}` : ""} ${searchedLine(searched)}`, searched);
        }
        const notice = searchNotice(mode, terms, allTermTotal);
        const count = searchCountLine({ mode, shown: results.length, allTermResults, total, allTermTotal, limit: max });
        let cut = false;
        const body = results
          .map((s) => {
            cut ||= s.text.length > SNIPPET_CHARS;
            return `[${s.corpus.toUpperCase()}] ${fullCitation(s)} — ${s.heading}\n${snippet(s.text, patterns)}`;
          })
          .join("\n\n---\n\n");
        const cutNote = cut
          ? `Each snippet is at most ${SNIPPET_CHARS} characters of the section, around the first match; … marks text left out. get_section returns a section's full text.`
          : null;
        // After the results, so the first line stays the notice (issue #30) and results start on line 3.
        const text = [notice, body, count, whole, cutNote].filter(Boolean).join("\n\n");
        return answer(text, results.map((s) => s.corpus), "snippets");
      }

      case "get_section": {
        const { citation, corpus, max_chars, offset } = parseArgs("get_section", SHAPES.get_section, args);
        const result = getSection(citation, corpus);
        if (result.kind === "none") {
          if (result.rulesCitation && corpus) {
            // "RCNY" names the Rules (issue #59): it is not looked for in another document.
            return answer(
              `Section not found: "${echo(citation)}" is a citation of the Rules of the City of New York ("RCNY"), so it is not looked for in the ${SOURCES[corpus].title}. Ask again with corpus 'rules', or with no corpus.`,
              [corpus],
            );
          }
          if (result.bookCitation && corpus) {
            // "NYC Charter § 1133" names its book: it is not looked for in another.
            return answer(
              `Section not found: "${echo(citation)}" is a citation of the ${SOURCES[result.bookCitation].title}, so it is not looked for in the ${SOURCES[corpus].title}. Ask again with corpus '${result.bookCitation}', or with no corpus.`,
              [corpus],
            );
          }
          const searched = corpus ? [corpus] : ALL_CORPORA;
          return answer(`Section not found: "${echo(citation)}". ${searchedLine(searched)}`, searched);
        }
        if (result.kind === "ambiguous") {
          // In pages of MAX_CANDIDATES, with `offset` (issue #95), worded as the other lists are.
          const { shown, note } = page(result.candidates, offset ?? 0, MAX_CANDIDATES);
          // Each candidate with its title (issue #59), so a person can tell the Rules' many
          // "§ 1-01" apart and ask again for the one they mean: "15 RCNY § 1-01".
          const list = shown
            .map((s) => {
              const name = titleName(s);
              return `[${s.corpus.toUpperCase()}] ${fullCitation(s)} — ${s.heading}${name ? ` (${name})` : ""}`;
            })
            .join("\n");
          // What to add to get one (issue #95): 'corpus' only when it was not given and the matches
          // are in more than one document; the title when the full citations name one.
          const corpora = [...new Set(result.candidates.map((s) => s.corpus))];
          const ways: string[] = [];
          if (!corpus && corpora.length > 1) ways.push(`set 'corpus' (${orList(corpora)})`);
          const example = result.candidates.find((s) => fullCitation(s) !== s.citation);
          ways.push(example
            ? `name its title in the citation, as each line below does: '${fullCitation(example)}'`
            : "use a more specific citation, or words from its heading");
          return answer(
            `${result.subdivision ? `You asked for ${echo(result.subdivision)}, a part of a section. The index holds whole sections, so these are the whole sections it may be in.\n\n` : ""}Multiple sections match "${echo(citation)}". To get one, ${ways.join(", or ")}.${list ? `\n\n${list}` : ""}${note ? `\n\n${note}` : ""}`,
            (shown.length ? shown : result.candidates).map((s) => s.corpus)
          );
        }
        const section = result.section;
        const name = titleName(section);
        // A part of a section (issue #76): the index has whole sections, so the first line says
        // which part was asked for and that the whole section follows.
        const part = result.subdivision
          ? `You asked for ${echo(result.subdivision)}, a part of ${fullCitation(section)}. The index holds whole sections, so the whole section follows.\n\n`
          : "";
        // The text in parts (issue #95): a line before it says which characters of how many, and
        // the offset for the next part. A text that fits whole has no such line, as before.
        const from = offset ?? 0;
        const { part: piece, end } = textPart(section.text, from, max_chars ?? DEFAULT_MAX_CHARS);
        const line = partLine(section.text.length, from, end);
        const text = `${part}[${section.corpus.toUpperCase()}] ${fullCitation(section)} (matched in corpus: ${section.corpus}${name ? `; in ${name}` : ""})\n${section.heading}\n\n${line ? `${line}\n\n` : ""}${piece}`;
        return answer(text, [section.corpus]);
      }

      case "list_titles": {
        const { corpus, limit, offset } = parseArgs("list_titles", SHAPES.list_titles, args);
        const titles = listTitles(corpus);
        if (titles.length === 0) {
          return answer(`No titles found for ${corpus}. ${searchedLine([corpus])}`, [corpus]);
        }
        const { shown, note } = page(titles, offset ?? 0, limit ?? 200);
        const byTitle = corpus === "rules" && titles.some((t) => t.titleHeading);
        const count = note ?? `${titles.length} chapters, in order${byTitle ? ", under their titles" : ""}.`;
        const lines = withTitleLines(corpus, shown.map((t) => ({ line: `${t.citation} — ${t.heading}`, title: t.title, titleHeading: t.titleHeading })));
        const text = [count, lines].join("\n\n");
        return answer(text, [corpus]);
      }

      case "get_title": {
        const { corpus, title, limit, offset } = parseArgs("get_title", SHAPES.get_title, args);
        let sections = getTitle(corpus, title);
        // A bare number (issue #95): the Charter has chapters and no titles, so "11" is Chapter 11,
        // and the answer says so. Elsewhere it could be a title or a chapter: the answer asks.
        const bare = /^[A-Za-z]?\d[\dA-Za-z.-]*$/.test(title.trim()) ? title.trim() : null;
        let readAs: string | null = null;
        let bareHint = "";
        if (sections.length === 0 && bare) {
          if (corpus === "charter") {
            sections = getTitle(corpus, `Chapter ${bare}`);
            if (sections.length) readAs = `Read "${echo(bare)}" as "Chapter ${echo(bare)}": the Charter has chapters, not titles.`;
            else bareHint = ` The Charter has no Chapter ${echo(bare)}; list_titles lists its chapters.`;
          } else {
            bareHint = ` Ask for 'Title ${echo(bare)}' or 'Chapter ${echo(bare)}'.`;
          }
        }
        if (sections.length === 0) {
          const hint = bareHint ? bareHint : !namesTitle(title) || corpus === "admin_code"
            ? ""
            : corpus === "charter"
              ? " The Charter has no titles; ask for a chapter, which list_titles lists."
              : hasTitles(corpus)
                ? " list_titles lists each title's chapters."
                : " This copy of the index does not record Rules titles (it was built before 0.7.0); ask for a chapter, which list_titles lists.";
          return answer(`No sections found for "${echo(title)}" in ${corpus}.${hint} ${searchedLine([corpus])}`, [corpus]);
        }
        const { shown, note } = page(sections, offset ?? 0, limit ?? 200);
        const count = note ?? `${sections.length} records: each chapter's heading, then its sections in order.`;
        const lines = withTitleLines(
          corpus,
          shown.map((s) => ({ line: `${s.citation} — ${s.heading}`, title: s.titleNumber ?? null, titleHeading: s.level === "Chapter" ? (s.titleHeading ?? null) : null })),
        );
        const text = [readAs, count, lines].filter(Boolean).join("\n\n");
        return answer(text, [corpus]);
      }

      case "get_version": {
        parseArgs("get_version", SHAPES.get_version, args);
        const versions = getVersions();
        const fmt = (label: string, v?: { currentThrough: string; indexedAt: string; sectionCount: number }) =>
          `${label} ${v?.currentThrough ?? "unknown"} (${v?.sectionCount ?? 0} sections; indexed ${v?.indexedAt ?? "unknown"})`;
        const lines = [
          fmt("NYC Charter:          ", versions.charter),
          fmt("Administrative Code:  ", versions.admin_code),
          fmt("Rules of NYC:         ", versions.rules),
        ];
        return answer(lines.join("\n"), ALL_CORPORA, "dates");
      }

      default:
        return failed(`There is no tool named '${echo(name)}'. Available tools: ${TOOLS.map((t) => t.name).join(", ")}.`);
    }
  } catch (err) {
    return failed(err instanceof Error ? err.message : String(err));
  }
}
