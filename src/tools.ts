// Tool table and dispatch for the MCP server.
//
// Kept out of index.ts so tests can import TOOLS/callTool without index.ts's
// top-level `server.connect(new StdioServerTransport())` side effect.

import { z } from "zod";
import {
  searchWithFallback,
  getSection,
  listTitles,
  getTitle,
  getVersions,
  type SearchMode,
} from "./corpus.js";

const CAVEAT =
  "For informational purposes only. Not legal advice. Verify against official sources at codelibrary.amlegal.com before relying on any result.";

export const FOOTER = `
---
⚠️ **This information is for research and informational purposes only and does not constitute legal advice.** NYC laws and rules are amended frequently — always verify the current text at https://codelibrary.amlegal.com/codes/newyorkcity/latest/overview before acting on any information. For the latest rules information, see https://rules.cityofnewyork.us. For legal matters, consult a licensed attorney.

**Official disclaimer from American Legal Publishing:** The Codes and other documents that appear on this site may not yet reflect the most current legislation or rules adopted by the City. In addition, certain textual errors and omissions may temporarily exist, resulting from problems in the source database provided to American Legal and from which this website was created. Although these errors and omissions are being corrected, any user discovering any such error is invited to contact the publisher at NYC.editor@amlegal.com or 800-445-5588 and/or the NYC Law Department at NYCCodeRulesCharter@law.nyc.gov.

Built by BetaNYC (https://beta.nyc). Feedback and improvements welcome — file a GitHub issue at https://github.com/BetaNYC/nyc-charter-laws-rules.`.trim();

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
  if (bad.length === 0) throw parsed.error;
  const accepted = Object.keys(shape);
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

export const TOOLS = [
  {
    name: "search",
    description: `Keyword search across the NYC Charter, Administrative Code, and Rules of the City of New York. This is keyword matching, not a question-answering engine: short keyword queries work best (e.g. 'sidewalk shed', 'water tank inspection'), not full questions. The query is first matched as an exact phrase; results are relevance-ranked, with heading matches above citation matches above body-text matches, and whole-word matches above substring matches. If the phrase matches nothing, question words and common words are dropped and sections containing the remaining terms are returned, those with every term first; the response's first line says when this happened and which terms were used. ${CAVEAT}`,
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Keywords or an exact phrase (short keyword queries work best)" },
        corpus: {
          type: "string",
          enum: ["charter", "admin_code", "rules", "all"],
          description: "Which document to search (default: all)",
        },
        limit: {
          type: "number",
          description: "Max results to return (default 10, max 50)",
        },
      },
      additionalProperties: false,
      required: ["query"],
    },
  },
  {
    name: "get_section",
    description: `Retrieve a specific section by its citation (e.g. '§ 259', 'Section 259', '11-602.1', 'Chapter 11'). Input is normalized (with or without '§', any case). Pass 'corpus' to disambiguate when the same citation exists in multiple documents (e.g. charter 'Chapter 3' vs a rules chapter); if multiple sections still match, a disambiguation list is returned. ${CAVEAT}`,
    inputSchema: {
      type: "object",
      properties: {
        citation: { type: "string", description: "Section citation or heading" },
        corpus: {
          type: "string",
          enum: ["charter", "admin_code", "rules"],
          description: "Which document to look in (default: all three)",
        },
      },
      additionalProperties: false,
      required: ["citation"],
    },
  },
  {
    name: "list_titles",
    description: `List the top-level chapters or titles of a document. ${CAVEAT}`,
    inputSchema: {
      type: "object",
      properties: {
        corpus: {
          type: "string",
          enum: ["charter", "admin_code", "rules"],
          description: "Which document to list",
        },
      },
      additionalProperties: false,
      required: ["corpus"],
    },
  },
  {
    name: "get_title",
    description: `Retrieve chapter/title records matching an identifier (whole-token match: 'Chapter 1' does not match 'Chapter 10'). Note: the index is flat — deep hierarchy (every section nested within a title) is not indexed, so this returns matching chapter/title-level records, not full title contents. ${CAVEAT}`,
    inputSchema: {
      type: "object",
      properties: {
        corpus: {
          type: "string",
          enum: ["charter", "admin_code", "rules"],
          description: "Which document",
        },
        title: {
          type: "string",
          description: "Chapter or title identifier (e.g. 'Chapter 11')",
        },
      },
      additionalProperties: false,
      required: ["corpus", "title"],
    },
  },
  {
    name: "get_version",
    description: `Return the currency date for each document — how current the Charter, Administrative Code, and Rules are. Each corpus updates on its own schedule. Always call this tool before answering legal questions so responses are grounded in the correct version of the law. ${CAVEAT}`,
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
];

export async function callTool(name: string, args: unknown) {
  try {
    switch (name) {
      case "search": {
        const { query, corpus, limit } = parseArgs("search", {
          query: z.string(),
          corpus: z.enum(["charter", "admin_code", "rules", "all"]).optional(),
          limit: z.number().int().min(1).max(50).optional(),
        }, args);
        const { results, mode, terms, allTermResults } = searchWithFallback(
          query,
          corpus ?? "all",
          limit ?? 10
        );
        if (results.length === 0) {
          return { content: [{ type: "text", text: withFooter(`No results found for "${query}".`) }] };
        }
        const notice = searchNotice(mode, terms, allTermResults);
        const body = results
          .map(
            (s) =>
              `[${s.corpus.toUpperCase()}] ${s.citation} — ${s.heading}\n${s.text.slice(0, 400)}${s.text.length > 400 ? "…" : ""}`
          )
          .join("\n\n---\n\n");
        const text = notice ? `${notice}\n\n${body}` : body;
        return { content: [{ type: "text", text: withFooter(text) }] };
      }

      case "get_section": {
        const { citation, corpus } = parseArgs("get_section", {
          citation: z.string(),
          corpus: z.enum(["charter", "admin_code", "rules"]).optional(),
        }, args);
        const result = getSection(citation, corpus);
        if (result.kind === "none") {
          return { content: [{ type: "text", text: withFooter(`Section not found: "${citation}".`) }] };
        }
        if (result.kind === "ambiguous") {
          const list = result.candidates
            .map((s) => `[${s.corpus.toUpperCase()}] ${s.citation} — ${s.heading}`)
            .join("\n");
          return {
            content: [
              {
                type: "text",
                text: withFooter(
                  `Multiple sections match "${citation}". Re-run get_section with the 'corpus' parameter and/or a more specific citation:\n\n${list}`
                ),
              },
            ],
          };
        }
        const section = result.section;
        const text = `[${section.corpus.toUpperCase()}] ${section.citation} (matched in corpus: ${section.corpus})\n${section.heading}\n\n${section.text}`;
        return { content: [{ type: "text", text: withFooter(text) }] };
      }

      case "list_titles": {
        const { corpus } = parseArgs("list_titles", {
          corpus: z.enum(["charter", "admin_code", "rules"]),
        }, args);
        const titles = listTitles(corpus);
        if (titles.length === 0) {
          return { content: [{ type: "text", text: withFooter(`No titles found for ${corpus}.`) }] };
        }
        const text = titles.map((t) => `${t.citation} — ${t.heading}`).join("\n");
        return { content: [{ type: "text", text: withFooter(text) }] };
      }

      case "get_title": {
        const { corpus, title } = parseArgs("get_title", {
          corpus: z.enum(["charter", "admin_code", "rules"]),
          title: z.string(),
        }, args);
        const sections = getTitle(corpus, title);
        if (sections.length === 0) {
          return { content: [{ type: "text", text: withFooter(`No sections found for "${title}" in ${corpus}.`) }] };
        }
        const text = sections
          .map((s) => `${s.citation} — ${s.heading}`)
          .join("\n");
        return { content: [{ type: "text", text: withFooter(text) }] };
      }

      case "get_version": {
        parseArgs("get_version", {}, args);
        const versions = getVersions();
        const fmt = (label: string, v?: { currentThrough: string; indexedAt: string; sectionCount: number }) =>
          `${label} ${v?.currentThrough ?? "unknown"} (${v?.sectionCount ?? 0} sections; indexed ${v?.indexedAt ?? "unknown"})`;
        const lines = [
          fmt("NYC Charter:          ", versions.charter),
          fmt("Administrative Code:  ", versions.admin_code),
          fmt("Rules of NYC:         ", versions.rules),
        ];
        return { content: [{ type: "text", text: withFooter(lines.join("\n")) }] };
      }

      default:
        return {
          content: [{ type: "text", text: withFooter(`Unknown tool: ${name}`) }],
          isError: true,
        };
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { content: [{ type: "text", text: withFooter(`Error: ${message}`) }], isError: true };
  }
}
