// betanyc-shared: betanyc-tools.ts v1.2.4
// betanyc-shared-sha256: c668d2c4e950453d50b3f78dd29f96322c6b45c8cad957d4f5592470b03d5d99
// Canonical copy: betanyc-ai-workspace scripts/mcp_shared/betanyc-tools.ts. Do not edit a copy
// in a server repo; change the canonical file, re-stamp it, and copy it again.
// Drift check: scripts/whats_changed_drift.py. Standard: platform/system/whats-changed-standard.md.
//
// The two tools BetaNYC is adding to each of its MCP servers (the standard requires both), with
// identical names, inputs and output:
//   whats_changed   query this server's WHATS-CHANGED.md
//   about_betanyc   who built this server and how to reach BetaNYC
//
// Dependency-free: only node:fs. Uses no TypeScript syntax that needs transforming (no enums,
// namespaces or parameter properties), so Node 22.18+ runs it directly by type stripping and
// tsc compiles it in a server repo unchanged.
//
// MCP contract followed (spec 2025-11-25, as shipped in @modelcontextprotocol/sdk 1.32.2
// types.js): a tool may declare `outputSchema` (root `type: "object"`); when it does, a
// successful result MUST carry `structuredContent` matching it. Clients skip that check when
// `isError` is true. `annotations` uses ToolAnnotations (title, readOnlyHint, openWorldHint).

import { readFileSync } from "node:fs";

export const SHARED_MODULE_VERSION = "1.2.4";

// --------------------------------------------------------------------------- types

export type Tag = "Site" | "Data" | "MCP" | "Correction";
export const TAGS: readonly Tag[] = ["Site", "Data", "MCP", "Correction"];
const SUBJECT_TAGS: readonly Tag[] = ["Site", "Data", "MCP"];

export interface EntryLink {
  text: string;
  url: string;
}

export interface EntryUpdate {
  date: string;
  text: string;
}

/** One entry, as parsed. Same keys and values as `whats_changed.py json`. */
export interface Entry {
  /** YYYY-MM-DD, or null for the one "## Unreleased: Title" entry waiting for its release date. */
  date: string | null;
  /** True for the "## Unreleased:" entry. The whats_changed tool never returns it. */
  unreleased: boolean;
  title: string;
  anchor: string;
  tags: Tag[];
  summary: string | null;
  if_you_used_the_old_numbers: string | null;
  who_it_affects: string | null;
  mcp_version: string | null;
  notice_on: string[];
  more_detail: string | null;
  updates: EntryUpdate[];
  links: EntryLink[];
  line: number;
  /** False when any error falls inside this entry. Invalid entries are never shown. */
  valid: boolean;
}

export interface ParseError {
  code: string;
  line: number;
}

export interface ParsedFile {
  title: string;
  history_begins: string | null;
  data_refresh: string | null;
  intro: string;
  entries: Entry[];
  errors: ParseError[];
}

export type TextContent = {
  type: "text";
  text: string;
};

/** A CallToolResult. A type alias with an index signature, not an interface, so it is
 * assignable to the SDK's own result type (which is a loose object) in a server's handler. */
export type ToolResult = {
  [key: string]: unknown;
  content: TextContent[];
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
};

/** A tool's input or output JSON Schema, typed to match the MCP SDK's `Tool` type
 * (`@modelcontextprotocol/sdk` 1.29 to 1.32, `types.d.ts` ToolSchema): a literal `type: "object"`,
 * optional `properties` and `required`, and any other keys. So these definitions can go into a
 * server's `Tool[]` with no cast and without this file importing the SDK. */
export type ObjectJsonSchema = {
  type: "object";
  properties?: Record<string, object>;
  required?: string[];
  [key: string]: unknown;
};

/** ToolAnnotations as the SDK declares them (all optional). */
export type ToolAnnotations = {
  title?: string;
  readOnlyHint?: boolean;
  destructiveHint?: boolean;
  idempotentHint?: boolean;
  openWorldHint?: boolean;
};

export interface ToolDefinition {
  name: string;
  title: string;
  description: string;
  inputSchema: ObjectJsonSchema;
  outputSchema: ObjectJsonSchema;
  annotations: ToolAnnotations;
}

export interface BetanycServerConfig {
  /** The server's name, as in `new Server({ name })`, e.g. "nyc-charter-laws-rules". */
  serverName: string;
  /** The package version the server reports. */
  version: string;
  /** https://github.com/BetaNYC/<repo>, no trailing slash needed. */
  repoUrl: string;
  /** Where WHATS-CHANGED.md is at run time, e.g. new URL("../WHATS-CHANGED.md", import.meta.url). */
  whatsChangedPath?: string | URL;
  /** The file's text, when the build embeds it instead of shipping the file. Wins over the path. */
  whatsChangedText?: string;
  /** The site's "What's changed" page, when there is one. Entry links point there. */
  pageUrl?: string;
  /** Map repo-relative links under `prefix` (e.g. "viz/") to `url` (the published site). */
  siteBase?: { prefix: string; url: string };
}

// --------------------------------------------------------------------------- parsing

const FIELDS: Record<string, keyof Entry> = {
  "Tags": "tags",
  "What changed": "summary",
  "If you used the old numbers": "if_you_used_the_old_numbers",
  "Who it affects": "who_it_affects",
  "MCP version": "mcp_version",
  "Notice on": "notice_on",
  "More detail": "more_detail",
};
const PREAMBLE_FIELDS: Record<string, "history_begins" | "data_refresh"> = {
  "History begins": "history_begins",
  "Data refresh": "data_refresh",
};

const DATE_RE = /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/;
const MIN_YEAR = 1990;
const H1_RE = /^# (.+?)[ \t]*$/s; // s: "." matches U+2028/2029, as Python's "." does
const H2_RE = /^## (.*?)[ \t]*$/s;
const DEEPER_RE = /^#{3,} /;
const ENTRY_HEADING_RE = /^([0-9]{4}-[0-9]{2}-[0-9]{2}): ([^ \t].*)$/s;
// A version bump merges before its tag, so the newest entry may wait for its release date.
const UNRELEASED_HEADING_RE = /^Unreleased: ([^ \t].*)$/s;
const FIELD_RE = /^- \*\*(.+?):\*\*(?: (.*))?$/s;
const UPDATE_LABEL_RE = /^Update ([^ \t]+)$/;
const CONT_RE = /^ {2,}[^ \t]/;
// Link text may not contain brackets: that keeps matching linear on lines full of "[".
const LINK_RE = /\[([^\[\]]+)\]\(([^() \t]+)\)/g;
// An optional "v" before the version ("v0.4.5") is allowed; it is not part of the version.
const SEMVER_RE = /(?<![0-9A-Za-z.])v?([0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]*[0-9A-Za-z])?)(?![0-9A-Za-z])/;
// Characters GitHub treats as markup or entities in a heading, so its anchor would not match ours.
const TITLE_MARKUP_RE = /[*`\[\]<>&_~#\\]/;
const FENCE_RE = /^(```|~~~)/;
const HISTORY_RE = /^([0-9]{4}-[0-9]{2}-[0-9]{2})(?![0-9-])/;
const SCHEME_RE = /^([A-Za-z][A-Za-z0-9+.-]*):/;
const SAFE_SCHEMES = ["http", "https", "mailto"];
const CONTROL_RE = /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f-\x9f\u2028\u2029]/; // C0, DEL, C1, line/para separators
const PLACEHOLDER_RE = /SITE OR SERVER NAME|HOW OFTEN THE DATA UPDATES|BetaNYC\/REPO(?![A-Za-z0-9_-])/;
const EXAMPLE_TITLE_RE = /^example:/i;
/** The one whitespace set both parsers trim (space, tab, no-break space, BOM). */
const TRIM_CHARS = " \t\u00a0\ufeff";
export const MAX_CHARS = 1_000_000;
export const MAX_LINE = 5_000;
/** File-level problems: they do not make the entry they sit beside invalid. */
const FILE_LEVEL_CODES = [
  "unterminated-comment", "unterminated-fence", "no-h1", "missing-history-begins", "bad-history-begins",
  "history-after-entry", "file-too-large",
];

function trim(s: string): string {
  let a = 0;
  let b = s.length;
  while (a < b && TRIM_CHARS.includes(s[a])) a++;
  while (b > a && TRIM_CHARS.includes(s[b - 1])) b--;
  return s.slice(a, b);
}

function rtrim(s: string): string {
  let b = s.length;
  while (b > 0 && TRIM_CHARS.includes(s[b - 1])) b--;
  return s.slice(0, b);
}

function ltrim(s: string): string {
  let a = 0;
  while (a < s.length && TRIM_CHARS.includes(s[a])) a++;
  return s.slice(a);
}

/** The anchor GitHub gives a heading (docs.github.com, "Section links"): lowercase, spaces
 * become hyphens, other punctuation and whitespace removed. Letters, marks, numbers,
 * underscores (connector punctuation) and hyphens are kept. */
export function githubSlug(text: string): string {
  return trim(text).toLowerCase().replace(/[^\p{L}\p{M}\p{N}\p{Pc} -]/gu, "").replace(/ /g, "-");
}

/** YYYY-MM-DD in ASCII digits, a real calendar day, year 1990 or later. */
export function isRealDate(s: string): boolean {
  if (!DATE_RE.test(s)) return false;
  const [y, m, d] = s.split("-").map(Number);
  if (y < MIN_YEAR) return false;
  const t = new Date(0);
  t.setUTCFullYear(y, m - 1, d); // setUTCFullYear, unlike Date.UTC, never maps years 0-99 to 1900s
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d;
}

/** Only http, https, mailto, relative paths and #fragments. Never javascript:, data:, or //host. */
export function isSafeUrl(url: string): boolean {
  if (url.startsWith("#")) return true;
  if (url.startsWith("//")) return false;
  const m = SCHEME_RE.exec(url);
  return m === null || SAFE_SCHEMES.includes(m[1].toLowerCase());
}

function localToday(): string {
  const now = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`;
}

function extractLinks(values: string[]): EntryLink[] {
  const links: EntryLink[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    for (const m of value.matchAll(LINK_RE)) {
      const url = m[2];
      if (seen.has(url) || !isSafeUrl(url)) continue;
      seen.add(url);
      links.push({ text: m[1], url });
    }
  }
  return links;
}

function hasUnsafeLink(value: string): boolean {
  for (const m of value.matchAll(LINK_RE)) if (!isSafeUrl(m[2])) return true;
  return false;
}

function splitList(value: string): string[] {
  return value.split(",").map(trim).filter((t) => t.length > 0);
}

interface Working extends Entry {
  _seen: Set<string>;
  _rawTags: [string, number] | null;
  _fieldLines: Record<string, number>;
  _updateLines: number[];
}

/** Parse WHATS-CHANGED.md. Never throws on bad input: problems come back in `errors`, and each
 * entry says whether it is `valid` (no error inside it). `today` (YYYY-MM-DD) is used for the
 * future-date checks; default is the local date. */
export function parseWhatsChanged(input: string, today?: string): ParsedFile {
  const day = today ?? localToday();
  if (input.length > MAX_CHARS) {
    return { title: "", history_begins: null, data_refresh: null, intro: "", entries: [], errors: [{ code: "file-too-large", line: 1 }] };
  }
  const text = input.startsWith("\ufeff") ? input.slice(1) : input;
  const lines = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
  const errors: ParseError[] = [];
  const err = (code: string, line: number) => errors.push({ code, line });
  const checkPlaceholders = (value: string, lineno: number) => {
    if (PLACEHOLDER_RE.test(value)) err("template-placeholder", lineno);
  };

  let i = 0;
  if (lines.length && trim(lines[0]) === "---") {
    for (let j = 1; j < lines.length; j++) {
      if (trim(lines[j]) === "---") {
        i = j + 1;
        break;
      }
    }
  }

  let title: string | null = null;
  const intro: string[] = [];
  const preamble: { history_begins: string | null; data_refresh: string | null } = {
    history_begins: null,
    data_refresh: null,
  };
  const preambleLines: Record<string, number> = {};
  const entries: Working[] = [];
  const h2Lines: number[] = [];
  let current: Working | null = null;
  let skipping = false;
  let lastField: string | null = null;
  let inComment = false;
  let commentStart = 0;
  let inFence = false;
  let fenceStart = 0;

  for (let idx = i; idx < lines.length; idx++) {
    const lineno = idx + 1;
    const raw = lines[idx];
    if (raw.length > MAX_LINE) {
      err("line-too-long", lineno);
      continue;
    }
    if (CONTROL_RE.test(raw)) err("control-character", lineno);
    const line = rtrim(raw);

    if (inComment) {
      if (line.includes("-->")) {
        inComment = false;
        if (trim(line.slice(line.indexOf("-->") + 3))) err("text-after-comment", lineno); // GitHub shows it; we would drop it
      }
      continue;
    }
    if (!inFence && ltrim(line).startsWith("<!--")) {
      if (!line.includes("-->")) {
        inComment = true;
        commentStart = lineno;
      } else if (trim(line.slice(line.indexOf("-->") + 3))) {
        err("text-after-comment", lineno);
      }
      continue;
    }
    if (!inFence && line.includes("<!--")) err("inline-comment", lineno);

    if (title === null) {
      if (!trim(line)) continue;
      const m = H1_RE.exec(line);
      if (m) {
        title = trim(m[1]);
        // The page title reaches Jekyll and Quarto front matter, and layouts print it.
        if (TITLE_MARKUP_RE.test(title)) err("title-markup", lineno);
        continue;
      }
      err("no-h1", lineno);
      title = "";
    }

    if (FENCE_RE.test(trim(line))) {
      inFence = !inFence;
      fenceStart = lineno;
      if (current !== null && !skipping) err("stray-text", lineno);
      else if (current === null) intro.push(line);
      continue;
    }
    if (inFence) {
      if (current === null) intro.push(line);
      else if (!skipping) err("stray-text", lineno);
      continue;
    }

    const h2 = H2_RE.exec(line);
    if (h2) {
      lastField = null;
      h2Lines.push(lineno);
      const m = ENTRY_HEADING_RE.exec(h2[1]);
      const um = m ? null : UNRELEASED_HEADING_RE.exec(h2[1]);
      if (!m && !um) {
        err("bad-heading", lineno);
        current = null;
        skipping = true;
        continue;
      }
      skipping = false;
      const date: string | null = m ? m[1] : null;
      const etitle = trim(m ? m[2] : um![1]);
      if (date === null) {
        if (entries.some((e) => e.unreleased)) err("duplicate-unreleased", lineno);
        else if (entries.length) err("unreleased-not-first", lineno);
      }
      current = {
        date,
        unreleased: date === null,
        title: etitle,
        anchor: githubSlug(`${date ?? "Unreleased"}: ${etitle}`),
        tags: [],
        summary: null,
        if_you_used_the_old_numbers: null,
        who_it_affects: null,
        mcp_version: null,
        notice_on: [],
        more_detail: null,
        updates: [],
        links: [],
        line: lineno,
        valid: true,
        _seen: new Set<string>(),
        _rawTags: null,
        _fieldLines: {},
        _updateLines: [],
      };
      if (date === null) {
        // waits for its release date; `check --release` fails while it is here
      } else if (!isRealDate(date)) err("bad-date", lineno);
      else if (date > day) err("future-date", lineno);
      if (TITLE_MARKUP_RE.test(etitle)) err("title-markup", lineno);
      if (EXAMPLE_TITLE_RE.test(etitle)) err("template-placeholder", lineno);
      else checkPlaceholders(etitle, lineno);
      entries.push(current);
      continue;
    }

    if (skipping) continue;

    if (current === null) {
      checkPlaceholders(line, lineno);
      const fm = FIELD_RE.exec(line);
      if (fm && Object.hasOwn(PREAMBLE_FIELDS, fm[1])) {
        const key = PREAMBLE_FIELDS[fm[1]];
        preamble[key] = trim(fm[2] ?? "");
        preambleLines[key] = lineno;
      }
      intro.push(line);
      continue;
    }

    if (!trim(line)) continue;
    if (DEEPER_RE.test(line) || H1_RE.test(line)) {
      err("stray-text", lineno);
      lastField = null;
      continue;
    }
    const fm = FIELD_RE.exec(line);
    if (fm) {
      const label = fm[1];
      const value = trim(fm[2] ?? "");
      checkPlaceholders(value, lineno);
      const um = UPDATE_LABEL_RE.exec(label);
      if (um) {
        const udate = um[1];
        if (!isRealDate(udate) || udate < (current.date ?? "") || udate > day) err("bad-update-date", lineno);
        if (!value) err("empty-field", lineno);
        current.updates.push({ date: udate, text: value });
        current._updateLines.push(lineno);
        lastField = "update";
        continue;
      }
      if (!Object.hasOwn(FIELDS, label)) {
        err("unknown-field", lineno);
        lastField = null;
        continue;
      }
      const key = FIELDS[label];
      if (current._seen.has(key)) {
        err("duplicate-field", lineno);
        lastField = null;
        continue;
      }
      current._seen.add(key);
      if (!value) err("empty-field", lineno);
      if (key === "tags") current._rawTags = [value, lineno];
      else if (key === "notice_on") current.notice_on = splitList(value);
      else {
        (current as unknown as Record<string, unknown>)[key] = value;
        current._fieldLines[key] = lineno;
      }
      lastField = key;
      continue;
    }
    if (CONT_RE.test(raw) && lastField !== null) {
      const extra = trim(line);
      checkPlaceholders(extra, lineno);
      if (lastField === "update") {
        const u = current.updates[current.updates.length - 1];
        u.text = trim(`${u.text} ${extra}`);
      } else if (lastField === "tags" && current._rawTags) {
        current._rawTags = [trim(`${current._rawTags[0]} ${extra}`), current._rawTags[1]];
      } else if (lastField === "notice_on") {
        current.notice_on.push(...splitList(extra));
      } else {
        const rec = current as unknown as Record<string, string | null>;
        rec[lastField] = trim(`${rec[lastField] ?? ""} ${extra}`);
      }
      continue;
    }
    err("stray-text", lineno);
    lastField = null;
  }

  if (inComment) err("unterminated-comment", commentStart);
  if (inFence) err("unterminated-fence", fenceStart); // GitHub shows everything after it as code
  if (title === null) {
    err("no-h1", 1);
    title = "";
  }

  const seenAnchors = new Set<string>();
  let prevDate: string | null = null;
  const out: Entry[] = [];
  for (const w of entries) {
    const { _seen, _rawTags, _fieldLines, _updateLines, ...e } = w;
    void _seen;
    const ln = e.line;
    if (_rawTags === null) {
      err("missing-tags", ln);
    } else {
      const [value, tln] = _rawTags;
      for (const t of splitList(value)) {
        if (!(TAGS as readonly string[]).includes(t)) err("bad-tag", tln);
        else if (e.tags.includes(t as Tag)) err("duplicate-tag", tln);
        else e.tags.push(t as Tag);
      }
    }
    if (!e.summary) err("missing-summary", ln);
    if (e.tags.includes("Correction")) {
      if (!e.tags.some((t) => SUBJECT_TAGS.includes(t))) err("correction-alone", ln);
      if (!e.if_you_used_the_old_numbers) err("missing-old-numbers", ln);
    } else if (e.notice_on.length) {
      err("notice-without-correction", ln);
    }
    if (e.tags.includes("MCP") && !e.mcp_version) err("missing-mcp-version", ln);
    if (e.mcp_version && !SEMVER_RE.test(e.mcp_version)) err("bad-mcp-version", ln);
    if (seenAnchors.has(e.anchor)) err("duplicate-anchor", ln);
    seenAnchors.add(e.anchor);
    if (e.date !== null && prevDate && isRealDate(e.date) && isRealDate(prevDate) && e.date > prevDate) err("out-of-order", ln);
    if (e.date !== null && isRealDate(e.date)) prevDate = e.date;
    for (const key of ["summary", "if_you_used_the_old_numbers", "who_it_affects", "mcp_version", "more_detail"] as const) {
      const v = e[key];
      if (v && hasUnsafeLink(v)) err("unsafe-link", _fieldLines[key] ?? ln);
    }
    e.updates.forEach((u, k) => {
      if (hasUnsafeLink(u.text)) err("unsafe-link", _updateLines[k]);
    });
    const values = [e.summary, e.if_you_used_the_old_numbers, e.who_it_affects, e.mcp_version, e.more_detail]
      .filter((v): v is string => !!v);
    e.links = extractLinks([...values, ...e.updates.map((u) => u.text)]);
    out.push(e);
  }

  const hb = preamble.history_begins;
  let hbDate: string | null = null;
  if (hb === null) {
    err("missing-history-begins", 1);
  } else {
    const hm = HISTORY_RE.exec(hb);
    if (!hm || !isRealDate(hm[1])) {
      err("bad-history-begins", preambleLines.history_begins);
    } else {
      hbDate = hm[1];
      const dated = out.map((e) => e.date).filter((d): d is string => d !== null && isRealDate(d)).sort();
      if (dated.length && hbDate > dated[0]) err("history-after-entry", preambleLines.history_begins);
    }
  }

  // An entry is valid when no entry-level error falls between its heading and the next one.
  const bounds = [...h2Lines].sort((a, b) => a - b);
  for (const e of out) {
    const next = bounds.find((b) => b > e.line);
    const end = next ?? lines.length + 1;
    e.valid = !errors.some((x) => x.line >= e.line && x.line < end && !FILE_LEVEL_CODES.includes(x.code));
  }

  errors.sort((a, b) => (a.line - b.line) || (a.code < b.code ? -1 : a.code > b.code ? 1 : 0));
  while (intro.length && !trim(intro[0])) intro.shift();
  while (intro.length && !trim(intro[intro.length - 1])) intro.pop();
  return {
    title,
    history_begins: hbDate,
    data_refresh: preamble.data_refresh,
    intro: intro.join("\n"),
    entries: out,
    errors,
  };
}

// --------------------------------------------------------------------------- query

export const DEFAULT_LIMIT = 10;
export const MAX_LIMIT = 50;

export interface Query {
  since?: string;
  tag?: Tag;
  limit?: number;
}

/** Valid, released entries newest first (the file's order); an entry with any error, and the
 * "Unreleased" entry, are never returned.
 * `since` keeps an entry dated on or after it, or one
 * with an Update dated on or after it, so a later update to an old correction still shows. */
export function queryEntries(parsed: ParsedFile, q: Query = {}): { matching: Entry[]; returned: Entry[] } {
  const matching = parsed.entries.filter((e) => {
    if (!e.valid || e.unreleased || e.date === null) return false;
    if (q.tag && !e.tags.includes(q.tag)) return false;
    if (q.since && !(e.date >= q.since || e.updates.some((u) => u.date >= q.since!))) return false;
    return true;
  });
  return { matching, returned: matching.slice(0, q.limit ?? DEFAULT_LIMIT) };
}

// --------------------------------------------------------------------------- links

function repoBase(repoUrl: string): string {
  return repoUrl.replace(/\/+$/, "");
}

/** Where readers find the file: the site page if there is one, else the file on GitHub. */
export function whatsChangedUrl(config: BetanycServerConfig): string {
  return config.pageUrl ?? `${repoBase(config.repoUrl)}/blob/HEAD/WHATS-CHANGED.md`;
}

/** Make a link from the file absolute, or null for a link that must not be followed
 * (anything but http, https, mailto, a repo path or a #anchor). Absolute URLs stay; "#anchor" points into the
 * What's changed page; a path under siteBase.prefix goes to the site; any other relative path
 * goes to the file on GitHub. */
export function absoluteLink(url: string, config: BetanycServerConfig): string | null {
  if (!isSafeUrl(url)) return null;
  if (SCHEME_RE.test(url)) return url;
  if (url.startsWith("#")) return whatsChangedUrl(config) + url;
  const path = (url.startsWith("./") ? url.slice(2) : url).replace(/^\/+/, "");
  const sb = config.siteBase;
  if (sb) {
    const prefix = sb.prefix.replace(/^\/+|\/+$/g, "") + "/";
    if (path.startsWith(prefix)) return sb.url.replace(/\/+$/, "") + "/" + path.slice(prefix.length);
  }
  return `${repoBase(config.repoUrl)}/blob/HEAD/${path}`;
}

/** Rewrite every markdown link inside a field to its absolute form. */
function absolutizeText(text: string | null, config: BetanycServerConfig): string | null {
  if (text === null) return null;
  return text.replace(LINK_RE, (_m, t: string, u: string) => {
    const abs = absoluteLink(u, config);
    return abs === null ? t : `[${t}](${abs})`; // an unsafe link keeps its words, loses its target
  });
}

// --------------------------------------------------------------------------- about BetaNYC

/** Every fact below is sourced. Mission and history: platform/system/org-context.md
 * (Version A tagline; "founded in 2008; operating as BetaNYC since 2013"). "A project of the
 * Fund for the City of New York" is the LICENSE wording in engineering-standards.md. No tax or
 * 501(c)(3) wording, on purpose: BetaNYC is not itself the 501(c)(3), and a model paraphrasing a
 * sentence about it could say it is. Each URL returned 200 on a GET on 2026-11-12. Change these only from a source, and record the check in the standard. */
export const BETANYC_ABOUT = {
  built_by: "BetaNYC, a project of the Fund for the City of New York",
  about:
    "BetaNYC is a civic organization dedicated to improving lives in New York through civic design, technology, and data.",
  history: "Founded in 2008 as the NYC Open Government meetup; operating as BetaNYC since 2013.",
  support: "To support BetaNYC's work, give at https://www.beta.nyc/donate/.",
  links: {
    website: "https://www.beta.nyc/",
    about: "https://www.beta.nyc/about/",
    history: "https://www.beta.nyc/our-history/",
    events: "https://www.beta.nyc/events/",
    newsletter: "https://www.beta.nyc/newsletter/",
    get_involved: "https://www.beta.nyc/our-work/get-involved/",
    donate: "https://www.beta.nyc/donate/",
  },
} as const;

// --------------------------------------------------------------------------- tool definitions

const LINK_SCHEMA = {
  type: "object",
  properties: { text: { type: "string" }, url: { type: "string" } },
  required: ["text", "url"],
};

const NULLABLE_STRING = { type: ["string", "null"] };

const ENTRY_SCHEMA = {
  type: "object",
  properties: {
    date: { type: "string", description: "YYYY-MM-DD, the day the change went live" },
    title: { type: "string" },
    url: { type: "string", description: "Link to this entry" },
    tags: { type: "array", items: { type: "string", enum: [...TAGS] } },
    summary: NULLABLE_STRING,
    if_you_used_the_old_numbers: {
      type: ["string", "null"],
      description: "For corrections: what to re-check and how",
    },
    who_it_affects: NULLABLE_STRING,
    mcp_version: NULLABLE_STRING,
    more_detail: NULLABLE_STRING,
    updates: {
      type: "array",
      items: {
        type: "object",
        properties: { date: { type: "string" }, text: { type: "string" } },
        required: ["date", "text"],
      },
    },
    links: { type: "array", items: LINK_SCHEMA },
  },
  required: [
    "date", "title", "url", "tags", "summary", "if_you_used_the_old_numbers",
    "who_it_affects", "mcp_version", "more_detail", "updates", "links",
  ],
};

export const WHATS_CHANGED_TOOL: ToolDefinition = {
  name: "whats_changed",
  title: "What's changed",
  description:
    "What has changed in this server, its data and its website, newest first, from the project's WHATS-CHANGED.md: new tools and pages, new data, data fixes, and corrections when BetaNYC published something wrong. " +
    "Each correction says what to re-check if you used the old numbers. Call this before relying on a figure you got from this server earlier, or when a user asks whether something was fixed. " +
    "Filter with since (YYYY-MM-DD; also keeps older entries that have an update on or after that date) and tag (Site, Data, MCP or Correction).",
  inputSchema: {
    type: "object",
    properties: {
      since: {
        type: "string",
        pattern: "^\\d{4}-\\d{2}-\\d{2}$",
        description: "Only changes on or after this date, YYYY-MM-DD",
      },
      tag: {
        type: "string",
        description: "Only changes with this tag: Site, Data, MCP or Correction (any case; answers use these spellings). Correction lists every correction.",
      },
      limit: {
        type: "integer",
        minimum: 1,
        maximum: MAX_LIMIT,
        description: `Most entries to return (default ${DEFAULT_LIMIT}, max ${MAX_LIMIT})`,
      },
    },
    additionalProperties: false,
  },
  outputSchema: {
    type: "object",
    properties: {
      server: {
        type: "object",
        properties: { name: { type: "string" }, version: { type: "string" } },
        required: ["name", "version"],
      },
      source: { type: "string", description: "Where to read the full history" },
      history_begins: NULLABLE_STRING,
      filters: {
        type: "object",
        properties: { since: NULLABLE_STRING, tag: NULLABLE_STRING, limit: { type: "integer" } },
        required: ["since", "tag", "limit"],
      },
      total_matching: { type: "integer" },
      returned: { type: "integer" },
      entries: { type: "array", items: ENTRY_SCHEMA },
      note: NULLABLE_STRING,
    },
    required: ["server", "source", "history_begins", "filters", "total_matching", "returned", "entries", "note"],
  },
  annotations: { title: "What's changed", readOnlyHint: true, openWorldHint: false },
};

export const ABOUT_BETANYC_TOOL: ToolDefinition = {
  name: "about_betanyc",
  title: "About BetaNYC and this server",
  description:
    "Who built this server and how to reach them: BetaNYC, a project of the Fund for the City of New York. " +
    "Returns what BetaNYC is, links to its events, newsletter and donation page, where to report a bug in this server or ask for a new feature (this server's GitHub issues), and this server's name and version.",
  inputSchema: { type: "object", properties: {}, additionalProperties: false },
  outputSchema: {
    type: "object",
    properties: {
      server: {
        type: "object",
        properties: {
          name: { type: "string" },
          version: { type: "string" },
          repository: { type: "string" },
          shared_module_version: { type: "string" },
        },
        required: ["name", "version", "repository", "shared_module_version"],
      },
      built_by: { type: "string" },
      about: { type: "string" },
      history: { type: "string" },
      support: { type: "string" },
      links: {
        type: "object",
        properties: Object.fromEntries(Object.keys(BETANYC_ABOUT.links).map((k) => [k, { type: "string" }])),
        required: Object.keys(BETANYC_ABOUT.links),
      },
      bugs_and_requests: {
        type: "object",
        properties: { issues: { type: "string" }, new_issue: { type: "string" } },
        required: ["issues", "new_issue"],
      },
      whats_changed: { type: "string" },
    },
    required: ["server", "built_by", "about", "history", "support", "links", "bugs_and_requests", "whats_changed"],
  },
  annotations: { title: "About BetaNYC and this server", readOnlyHint: true, openWorldHint: false },
};

export const BETANYC_TOOLS: readonly ToolDefinition[] = [WHATS_CHANGED_TOOL, ABOUT_BETANYC_TOOL];
export const BETANYC_TOOL_NAMES: readonly string[] = BETANYC_TOOLS.map((t) => t.name);

// --------------------------------------------------------------------------- handlers

function textResult(text: string, structured: Record<string, unknown>): ToolResult {
  return { content: [{ type: "text", text }], structuredContent: structured };
}

function errorResult(text: string): ToolResult {
  return { content: [{ type: "text", text: `Error: ${text}` }], isError: true };
}

/** Reject unknown keys and wrong types by name, as the BetaNYC servers do (an ignored
 * parameter would answer a different question with real-looking results). */
function checkArgs(tool: string, args: unknown, allowed: string[]): Record<string, unknown> {
  if (args === undefined || args === null) return {};
  if (typeof args !== "object" || Array.isArray(args)) throw new Error(`${tool} takes an object of arguments.`);
  const rec = args as Record<string, unknown>;
  const bad = Object.keys(rec).filter((k) => !allowed.includes(k));
  if (bad.length) {
    throw new Error(
      `${tool} does not accept ${bad.map((k) => `'${k}'`).join(", ")}. ` +
        (allowed.length ? `Accepted parameters: ${allowed.join(", ")}. ` : `${tool} takes no parameters. `) +
        "Unknown parameters are rejected rather than ignored, because ignoring one would answer a different question.",
    );
  }
  return rec;
}

function parseQuery(args: unknown): Query {
  const a = checkArgs("whats_changed", args, ["since", "tag", "limit"]);
  const q: Query = {};
  if (a.since !== undefined) {
    if (typeof a.since !== "string" || !isRealDate(a.since)) {
      throw new Error("since must be a real date written YYYY-MM-DD, for example 2026-11-01.");
    }
    q.since = a.since;
  }
  if (a.tag !== undefined) {
    const t = typeof a.tag === "string" ? TAGS.find((x) => x.toLowerCase() === (a.tag as string).trim().toLowerCase()) : undefined;
    if (!t) throw new Error(`tag must be one of ${TAGS.join(", ")}.`);
    q.tag = t;
  }
  if (a.limit !== undefined) {
    if (typeof a.limit !== "number" || !Number.isInteger(a.limit) || a.limit < 1 || a.limit > MAX_LIMIT) {
      throw new Error(`limit must be a whole number from 1 to ${MAX_LIMIT}.`);
    }
    q.limit = a.limit;
  }
  return q;
}

type Loaded = { kind: "ok"; text: string } | { kind: "missing" } | { kind: "unreadable"; message: string };

function loadText(config: BetanycServerConfig): Loaded {
  if (typeof config.whatsChangedText === "string") return { kind: "ok", text: config.whatsChangedText };
  if (!config.whatsChangedPath) return { kind: "missing" };
  try {
    return { kind: "ok", text: readFileSync(config.whatsChangedPath, "utf8") };
  } catch (e) {
    const code = (e as { code?: string }).code;
    if (code === "ENOENT") return { kind: "missing" };
    return { kind: "unreadable", message: e instanceof Error ? e.message : String(e) };
  }
}

function plural(n: number, word: string): string {
  if (n === 1) return `${n} ${word}`;
  return `${n} ${word.endsWith("y") ? `${word.slice(0, -1)}ies` : `${word}s`}`;
}

/** The whats_changed handler. Pure apart from reading the file; `today` is for tests. */
export function handleWhatsChanged(config: BetanycServerConfig, args: unknown, today?: string): ToolResult {
  let q: Query;
  try {
    q = parseQuery(args);
  } catch (e) {
    return errorResult(e instanceof Error ? e.message : String(e));
  }
  const limit = q.limit ?? DEFAULT_LIMIT;
  const server = { name: config.serverName, version: config.version };
  const source = whatsChangedUrl(config);
  const issues = `${repoBase(config.repoUrl)}/issues`;
  const base = {
    server,
    source,
    filters: { since: q.since ?? null, tag: q.tag ?? null, limit },
  };

  const loaded = loadText(config);
  if (loaded.kind !== "ok") {
    const why = loaded.kind === "missing"
      ? `${config.serverName} ${config.version} has no WHATS-CHANGED.md yet, so there is no change history to show.`
      : `${config.serverName} ${config.version} could not read its WHATS-CHANGED.md (${loaded.message}).`;
    const note = `${why} Release notes for developers: ${repoBase(config.repoUrl)}/releases. Report a bug in this server or ask for a new feature: ${issues}.`;
    return textResult(note, { ...base, history_begins: null, total_matching: 0, returned: 0, entries: [], note });
  }

  const parsed = parseWhatsChanged(loaded.text, today);
  const { matching, returned } = queryEntries(parsed, q);
  const notes: string[] = [];
  if (!parsed.entries.some((e) => e.valid && !e.unreleased)) notes.push("The change history has no entries to show yet.");
  else if (!matching.length) notes.push("No change matches those filters.");
  if (matching.length > returned.length) {
    notes.push(`Showing ${returned.length} of ${matching.length}; raise limit (max ${MAX_LIMIT}) or narrow since to see more.`);
  }
  const unreadable = parsed.errors.filter((e) => e.code === "bad-heading").length +
    parsed.entries.filter((e) => !e.valid).length;
  if (unreadable) notes.push(`${plural(unreadable, "entry")} in the file ${unreadable === 1 ? "has" : "have"} errors and ${unreadable === 1 ? "is" : "are"} left out. Full file: ${source}`);
  const waiting = parsed.entries.filter((e) => e.unreleased && e.valid).length;
  if (waiting) notes.push(`${plural(waiting, "change")} not released yet ${waiting === 1 ? "is" : "are"} left out until ${waiting === 1 ? "its" : "their"} release date is set.`);
  const hidden = parsed.errors.find((e) => ["unterminated-comment", "unterminated-fence", "file-too-large"].includes(e.code));
  if (hidden) notes.push(`The file has a problem at line ${hidden.line} (${hidden.code}), so entries after it may be missing. Full file: ${source}`);
  const note = notes.length ? notes.join(" ") : null;

  const entries = returned.map((e) => ({
    date: e.date,
    title: e.title,
    url: `${source}#${e.anchor}`,
    tags: e.tags,
    summary: absolutizeText(e.summary, config),
    if_you_used_the_old_numbers: absolutizeText(e.if_you_used_the_old_numbers, config),
    who_it_affects: absolutizeText(e.who_it_affects, config),
    mcp_version: absolutizeText(e.mcp_version, config),
    more_detail: absolutizeText(e.more_detail, config),
    updates: e.updates.map((u) => ({ date: u.date, text: absolutizeText(u.text, config) ?? "" })),
    links: e.links.flatMap((l) => {
      const url = absoluteLink(l.url, config);
      return url === null ? [] : [{ text: l.text, url }];
    }),
  }));

  const filterWords = [q.tag ? `tagged ${q.tag}` : "", q.since ? `since ${q.since}` : ""].filter(Boolean).join(", ");
  const head = [
    `What's changed in ${config.serverName} ${config.version}, newest first.` +
      (filterWords ? ` ${plural(matching.length, "change")} ${filterWords}.` : ` ${plural(matching.length, "change")} in all.`),
    parsed.history_begins ? `This history begins ${parsed.history_begins}; earlier corrections may be missing.` : "",
    `Full history: ${source}`,
  ].filter(Boolean);
  const blocks = entries.map((e) => {
    const lines = [`${e.date}: ${e.title} [${e.tags.join(", ")}]`];
    if (e.summary) lines.push(`What changed: ${e.summary}`);
    if (e.if_you_used_the_old_numbers) lines.push(`If you used the old numbers: ${e.if_you_used_the_old_numbers}`);
    if (e.who_it_affects) lines.push(`Who it affects: ${e.who_it_affects}`);
    if (e.mcp_version) lines.push(`MCP version: ${e.mcp_version}`);
    if (e.more_detail) lines.push(`More detail: ${e.more_detail}`);
    for (const u of e.updates) lines.push(`Update ${u.date}: ${u.text}`);
    lines.push(`Link: ${e.url}`);
    return lines.join("\n");
  });
  const text = [head.join("\n"), ...blocks, note ?? ""].filter(Boolean).join("\n\n");
  return textResult(text, {
    ...base,
    history_begins: parsed.history_begins,
    total_matching: matching.length,
    returned: entries.length,
    entries,
    note,
  });
}

/** The about_betanyc handler. */
export function handleAboutBetanyc(config: BetanycServerConfig, args: unknown): ToolResult {
  try {
    checkArgs("about_betanyc", args, []);
  } catch (e) {
    return errorResult(e instanceof Error ? e.message : String(e));
  }
  const repo = repoBase(config.repoUrl);
  const L = BETANYC_ABOUT.links;
  const structured = {
    server: {
      name: config.serverName,
      version: config.version,
      repository: repo,
      shared_module_version: SHARED_MODULE_VERSION,
    },
    built_by: BETANYC_ABOUT.built_by,
    about: BETANYC_ABOUT.about,
    history: BETANYC_ABOUT.history,
    support: BETANYC_ABOUT.support,
    links: { ...L },
    bugs_and_requests: { issues: `${repo}/issues`, new_issue: `${repo}/issues/new` },
    whats_changed: whatsChangedUrl(config),
  };
  const text = [
    `${config.serverName} ${config.version} was built by ${BETANYC_ABOUT.built_by}.`,
    `${BETANYC_ABOUT.about} ${BETANYC_ABOUT.history} More: ${L.about}`,
    `Events and workshops: ${L.events}\nNewsletter: ${L.newsletter}\nJoin the community: ${L.get_involved}`,
    BETANYC_ABOUT.support,
    `Report a bug in this server or ask for a new feature: ${repo}/issues (new issue: ${repo}/issues/new)`,
    `What's changed in this server: ${structured.whats_changed}`,
  ].join("\n\n");
  return textResult(text, structured);
}

/** Wire both tools into a server. Throws at startup on a bad config, so a mistake shows when
 * the server starts, not when a user calls the tool.
 *
 *   const betanyc = createBetanycTools({ serverName, version, repoUrl,
 *     whatsChangedPath: new URL("../WHATS-CHANGED.md", import.meta.url) });
 *   export const TOOLS = [ ...existingTools, ...betanyc.tools ];
 *   // first line of callTool():
 *   if (betanyc.handles(name)) return betanyc.call(name, args);
 */
export function createBetanycTools(config: BetanycServerConfig): {
  tools: ToolDefinition[];
  handles: (name: string) => boolean;
  call: (name: string, args: unknown) => ToolResult;
} {
  const problems: string[] = [];
  if (!config.serverName?.trim()) problems.push("serverName is empty");
  if (!config.version?.trim()) problems.push("version is empty");
  if (!/^https:\/\/github\.com\/[^/\s]+\/[^/\s]+\/?$/.test(config.repoUrl ?? "")) {
    problems.push(`repoUrl must look like https://github.com/BetaNYC/<repo> (got ${JSON.stringify(config.repoUrl)})`);
  }
  if (config.whatsChangedPath === undefined && config.whatsChangedText === undefined) {
    problems.push("give whatsChangedPath or whatsChangedText");
  }
  if (problems.length) throw new Error(`betanyc-tools: ${problems.join("; ")}`);
  return {
    tools: BETANYC_TOOLS.map((t) => ({ ...t })),
    handles: (name) => BETANYC_TOOL_NAMES.includes(name),
    call: (name, args) =>
      name === "whats_changed" ? handleWhatsChanged(config, args)
        : name === "about_betanyc" ? handleAboutBetanyc(config, args)
          : errorResult(`Unknown tool: ${name}`),
  };
}
