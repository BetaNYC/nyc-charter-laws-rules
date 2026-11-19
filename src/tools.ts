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
  getVersions,
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
    const problems = parsed.error.issues.map((i) => {
      const key = i.path.join(".") || "arguments";
      if (i.code === "invalid_type" && i.received === "undefined") return `'${key}' is required`;
      return `'${key}': ${i.message}`;
    });
    throw new Error(
      `${toolName} was called with bad parameters: ${problems.join("; ")}. ` +
        `Accepted parameters: ${accepted.join(", ") || "none"}. Fix them and call again.`
    );
  }
  throw new Error(
    `${toolName} does not accept ${bad.map((k) => `'${k}'`).join(", ")}. ` +
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
// when it widened to partial matches, that it did.
export function searchNotice(
  mode: SearchMode,
  terms: string[],
  allTermResults: number
): string | null {
  const list = terms.join(", ");
  if (mode === "all-terms") {
    return `No section contains the exact query; showing sections containing all of: ${list}.`;
  }
  if (mode === "some-terms") {
    if (allTermResults === 0) {
      return `No section matched every term; showing sections matching some of: ${list}.`;
    }
    const n = allTermResults === 1 ? "1 section" : `${allTermResults} sections`;
    return `Only ${n} matched every term (listed first); the rest match some of: ${list}.`;
  }
  return null;
}

// The count line after a search's results (issue #42). For a phrase match, how many sections
// matched in all. When search fell back to single terms (issue #30), a section with any one
// term counts as a match, so a plain total would be mostly noise ("Showing 10 of 1526"): say
// how many contain every term, and separately how many contain only some, and do not point
// at a higher limit for those weak matches.
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
  if (o.allTermTotal > o.allTermResults) {
    lines.push(
      `Showing ${o.allTermResults} of ${o.allTermTotal} sections that contain every term, best first. ` +
        `To see others, ${raise}narrow the query, or search one corpus.`
    );
  }
  const partial = o.total - o.allTermTotal;
  const shownPartial = o.shown - o.allTermResults;
  if (partial > 0) {
    const n = partial === 1 ? "1 other section contains" : `${partial} other sections contain`;
    lines.push(
      shownPartial > 0
        ? `${n} only some of the terms; the ${shownPartial} shown after the full matches are the closest of those. ` +
            "Matches on only some terms are weak: fewer, more specific keywords find better ones."
        : `${n} only some of the terms and ${partial === 1 ? "is" : "are"} not shown, as weak matches.`
    );
  }
  return lines.length ? lines.join(" ") : null;
}

// Where each document comes from, read from DATA-SOURCES.json (which ships with the package)
// so the line in each answer says what about_data says (issues #40, #41).
type DocSource = { id: string; title: string; source_name: string; publisher: { name: string }; verify_at: string };
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
// as the publisher wrote it, minus trailing punctuation. Null when the index has none.
export function currentThrough(c: Corpus): string | null {
  const raw = getVersions()[c]?.currentThrough;
  if (typeof raw !== "string") return null;
  const line = raw.replace(/\s+/g, " ").trim().replace(/[\s,.;:]+$/, "");
  return line || null;
}

// Per document an answer came from: the source, its publisher, the date of this server's copy
// (indexedAt in versions.json: when the copy was built, which moves only when the text
// changed), and a link to the official code library, where a person can check the text. Then,
// on its own labeled line, the publisher's "current through" line, when the index has one. The
// index holds no date the source was last checked, so none is shown.
export function sourceLines(corpora: Iterable<Corpus>): string {
  const versions = getVersions();
  return [...new Set(corpora)]
    .map((c) => {
      const line = provenance({
        sourceName: SOURCES[c].source_name,
        publisher: SOURCES[c].publisher.name,
        sourceUrl: SOURCES[c].verify_at,
        kind: "snapshot",
        asOf: versions[c]?.indexedAt ?? null,
      }).text;
      const through = currentThrough(c);
      return through ? `${line}\nThe publisher's own "current through" line for it: ${through}.` : line;
    })
    .join("\n");
}

// A body, then its source lines, then the disclaimer.
function answer(text: string, corpora: Iterable<Corpus>) {
  return { content: [{ type: "text" as const, text: withFooter(`${text}\n\n${sourceLines(corpora)}`) }] };
}

// Lists (issue #42): a page of `items` and a line saying which part of how many it is, and
// how to get the rest. No line when everything fits on the first page.
export const SNIPPET_CHARS = 400;
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
    citation: z.string().describe("Section citation or heading"),
    corpus: CORPUS.optional().describe("Which document to look in (default: all three)"),
  },
  list_titles: {
    corpus: CORPUS.describe("Which document to list"),
    limit: z.number().int().min(1).max(1000).optional().describe("Max titles to return (default 200, max 1000)"),
    offset: z.number().int().min(0).optional().describe("How many to skip, to get the next page (default 0)"),
  },
  get_title: {
    corpus: CORPUS.describe("Which document"),
    title: z.string().describe("Chapter or title identifier (e.g. 'Chapter 11')"),
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
    description: `Keyword search across the NYC Charter, Administrative Code, and Rules of the City of New York. This is keyword matching, not a question-answering engine: short keyword queries work best (e.g. 'sidewalk shed', 'water tank inspection'), not full questions. The query is first matched as an exact phrase (quotes around the whole query are removed first); results are relevance-ranked, with heading matches above citation matches above body-text matches, and whole-word matches above substring matches. If the phrase matches nothing, question words and common words are dropped and sections containing the remaining terms are returned, those with every term first; the response's first line says when this happened and which terms were used.`,
    inputSchema: inputSchema(SHAPES.search),
  },
  {
    name: "get_section",
    title: "Get a section",
    description: `Retrieve a specific section by its citation (e.g. '§ 259', 'Section 259', '11-602.1', 'Chapter 11'). Input is normalized (with or without '§', any case). Pass 'corpus' to disambiguate when the same citation exists in multiple documents (e.g. charter 'Chapter 3' vs a rules chapter); if multiple sections still match, a disambiguation list is returned.`,
    inputSchema: inputSchema(SHAPES.get_section),
  },
  {
    name: "list_titles",
    title: "List chapters or titles",
    description: `List the top-level chapters or titles of a document.`,
    inputSchema: inputSchema(SHAPES.list_titles),
  },
  {
    name: "get_title",
    title: "Get a chapter or title",
    description: `Retrieve chapter/title records matching an identifier (whole-token match: 'Chapter 1' does not match 'Chapter 10'). Note: the index is flat — deep hierarchy (every section nested within a title) is not indexed, so this returns matching chapter/title-level records, not full title contents.`,
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

// Every failure: isError, a plain sentence (stack-frame lines dropped by toolError), and the
// disclaimer like any other answer (issue #46).
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
        const max = limit ?? 10;
        const { results, mode, terms, allTermResults, total, allTermTotal } = searchWithFallback(
          query,
          corpus ?? "all",
          max
        );
        if (results.length === 0) {
          const searched = corpus && corpus !== "all" ? [corpus] : ALL_CORPORA;
          return answer(`No results found for "${query}". ${searchedLine(searched)}`, searched);
        }
        const notice = searchNotice(mode, terms, allTermResults);
        const count = searchCountLine({ mode, shown: results.length, allTermResults, total, allTermTotal, limit: max });
        let cut = false;
        const body = results
          .map((s) => {
            const long = s.text.length > SNIPPET_CHARS;
            cut ||= long;
            return `[${s.corpus.toUpperCase()}] ${s.citation} — ${s.heading}\n${s.text.slice(0, SNIPPET_CHARS)}${long ? "…" : ""}`;
          })
          .join("\n\n---\n\n");
        const cutNote = cut
          ? `Snippets are cut at ${SNIPPET_CHARS} characters (marked …); get_section returns a section's full text.`
          : null;
        // After the results, so the first line stays the notice (issue #30) and results start on line 3.
        const text = [notice, body, count, cutNote].filter(Boolean).join("\n\n");
        return answer(text, results.map((s) => s.corpus));
      }

      case "get_section": {
        const { citation, corpus } = parseArgs("get_section", SHAPES.get_section, args);
        const result = getSection(citation, corpus);
        if (result.kind === "none") {
          const searched = corpus ? [corpus] : ALL_CORPORA;
          return answer(`Section not found: "${citation}". ${searchedLine(searched)}`, searched);
        }
        if (result.kind === "ambiguous") {
          const { shown, note } = page(result.candidates, 0, MAX_CANDIDATES);
          const list = shown
            .map((s) => `[${s.corpus.toUpperCase()}] ${s.citation} — ${s.heading}`)
            .join("\n");
          const more = note ? `\n\n${note.replace(/ Call again.*$/, "")} Narrow it with 'corpus' or a more specific citation to see the others.` : "";
          return answer(
            `Multiple sections match "${citation}". Re-run get_section with the 'corpus' parameter and/or a more specific citation:\n\n${list}${more}`,
            shown.map((s) => s.corpus)
          );
        }
        const section = result.section;
        const text = `[${section.corpus.toUpperCase()}] ${section.citation} (matched in corpus: ${section.corpus})\n${section.heading}\n\n${section.text}`;
        return answer(text, [section.corpus]);
      }

      case "list_titles": {
        const { corpus, limit, offset } = parseArgs("list_titles", SHAPES.list_titles, args);
        const titles = listTitles(corpus);
        if (titles.length === 0) {
          return answer(`No titles found for ${corpus}. ${searchedLine([corpus])}`, [corpus]);
        }
        const { shown, note } = page(titles, offset ?? 0, limit ?? 200);
        const text = [note, shown.map((t) => `${t.citation} — ${t.heading}`).join("\n")].filter(Boolean).join("\n\n");
        return answer(text, [corpus]);
      }

      case "get_title": {
        const { corpus, title, limit, offset } = parseArgs("get_title", SHAPES.get_title, args);
        const sections = getTitle(corpus, title);
        if (sections.length === 0) {
          return answer(`No sections found for "${title}" in ${corpus}. ${searchedLine([corpus])}`, [corpus]);
        }
        const { shown, note } = page(sections, offset ?? 0, limit ?? 200);
        const text = [note, shown.map((s) => `${s.citation} — ${s.heading}`).join("\n")].filter(Boolean).join("\n\n");
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
        return answer(lines.join("\n"), ALL_CORPORA);
      }

      default:
        return failed(`There is no tool named '${name}'. Available tools: ${TOOLS.map((t) => t.name).join(", ")}.`);
    }
  } catch (err) {
    return failed(err instanceof Error ? err.message : String(err));
  }
}
