// Checked downloads of the three American Legal Publishing bulk XML ZIPs (issue #55).
// scripts/fetch-data.js is the thin CLI. Everything here takes its network (`fetchImpl`) and
// its paths as arguments, so test/fetch-zip.test.js runs it with no network.
//
// Every download is checked before anything uses it. One failure stops the whole run, and no
// file in data/raw/ is replaced:
//   1. https only. Redirects are followed by hand, at most MAX_REDIRECTS, and only to https on
//      the same host and port, with no user name or password. Anything else is refused; there
//      is no http fallback.
//   2. HTTP 200 and a ZIP Content-Type (ZIP_CONTENT_TYPES).
//   3. Not truncated: the bytes received equal Content-Length, when the server sends one.
//   4. Not huge: the body is read as a stream and refused past MAX_GROWTH_RATIO times the last
//      good download (DEFAULT_MAX_BYTES with no record, or when the size check is waived for
//      that document), so a runaway answer cannot fill memory.
//   5. A readable ZIP in the layout build-index.js reads: XML/*.xml files, among them the root
//      file XML/0-0-0-1.xml with its "Current through" line; every XML file decompresses with
//      a good CRC; no entry name that is absolute or climbs out with ".."; no entry that
//      declares more than MAX_ENTRY_BYTES (refused before anything is decompressed).
//   6. Not much smaller than the last good download: at least MIN_SIZE_RATIO of its bytes and
//      of its XML file count (see MIN_SIZE_RATIO for why half). The last good download is the
//      committed data/fetch-provenance.json; before that file exists, BASELINE. The floor and
//      the ceiling follow the last good download: once a file of a new size is accepted and
//      its record committed, it is the new baseline.
// NYC_CLR_ALLOW_SIZE_CHANGE waives 4 and 6 for the documents it names, for one run (the
// ceiling then falls back to DEFAULT_MAX_BYTES). Every other check still applies.
// Then the three ZIPs replace data/raw/*.zip, and data/fetch-provenance.json records, for
// each, the URL, bytes, sha256, Content-Type, Last-Modified, ETag, XML file count, the
// "Current through" line and when those exact bytes were first fetched. All four files are
// written as .part first and renamed only when every check has passed.

import AdmZip from "adm-zip";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { politeFetch } from "./fetch-retry.js";
import { extractVersion } from "./build-corpus.js";

export const SOURCES = [
  { name: "charter", url: "https://files.amlegal.com/pdffiles/NewYorkCity/Charter/XML.zip" },
  { name: "admin_code", url: "https://files.amlegal.com/pdffiles/NewYorkCity/Admin/XML.zip" },
  { name: "rules", url: "https://files.amlegal.com/pdffiles/NewYorkCity/Rules/XML.zip" },
];

export const MAX_REDIRECTS = 5;
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

// American Legal sent `application/zip` on 2026-11-25 (one HEAD per URL, recorded in the
// issue). The other two are the usual names servers give a ZIP. An HTML error page, a login
// page or a captive portal is refused here, before the body is read as a ZIP.
export const ZIP_CONTENT_TYPES = new Set([
  "application/zip",
  "application/x-zip-compressed",
  "application/octet-stream",
]);

// Why half. Between editions the law grows, slowly: from the July 5, 2026 download to the
// November 25, 2026 HEAD the three ZIPs grew 0.1 to 0.7% (BASELINE below; 790,055, 65,528,920
// and 59,533,689 bytes in November). No real edition comes near halving. An error page, an
// empty or partial export, or a ZIP with most of its files missing does. The threshold is
// deliberately loose: it is there to catch a gross failure, not a missing title (the coverage
// audit and the tests look at the text). If American Legal ever shrinks a ZIP on purpose
// (say, stops bundling images), a person checks it and runs once with
// NYC_CLR_ALLOW_SIZE_CHANGE naming that document (allowSizeChangeSteps).
export const MIN_SIZE_RATIO = 0.5;

// A ceiling, for the same reason as the floor: no edition grows fourfold, though a ZIP could
// if American Legal started bundling something new (the Charter ZIP has no IMAGES/ folder;
// the Administrative Code's does). Same waiver as the floor. Without a record of the last
// good download, or with the waiver, a fixed 1 GiB (the largest ZIP was 66 MB in November
// 2026), so memory stays bounded either way.
export const MAX_GROWTH_RATIO = 4;
export const DEFAULT_MAX_BYTES = 1024 ** 3;

// No entry may declare more than this, uncompressed. In the real ZIPs the largest entry is
// 26 MB and the XML files of one ZIP total at most 145 MB; adm-zip allocates the declared size
// before it inflates, so a hostile header could otherwise ask for gigabytes.
export const MAX_ENTRY_BYTES = 256 * 1024 ** 2;

// The last good download before data/fetch-provenance.json existed: the July 5, 2026 ZIPs
// (bytes and XML/*.xml counts read from the files). Used only for a document with no entry in
// that file.
export const BASELINE = {
  charter: { bytes: 784_982, xmlFiles: 87, label: "the July 5, 2026 download" },
  admin_code: { bytes: 65_428_737, xmlFiles: 396, label: "the July 5, 2026 download" },
  rules: { bytes: 59_490_222, xmlFiles: 763, label: "the July 5, 2026 download" },
};

export const PROVENANCE_ABOUT =
  "The American Legal Publishing ZIPs the index was last built from, written by " +
  "scripts/fetch-data.js (issue #55). sha256 is of the ZIP as downloaded. firstFetchedAt is " +
  "when these exact bytes were first downloaded: a later download of the same bytes leaves the " +
  "entry unchanged.";

/** A download that failed a check. The message is one line and names the document. */
export class FetchCheckError extends Error {
  constructor(message) {
    super(message);
    this.name = "FetchCheckError";
  }
}

/**
 * NYC_CLR_ALLOW_SIZE_CHANGE: the documents whose size floor and ceiling are waived for this
 * run, by name, comma-separated ("rules", "charter,admin_code"). Unset or empty waives
 * nothing. An unknown name is an error, so a typo never waives the wrong document or none.
 */
export function parseAllowSizeChange(value, sources = SOURCES) {
  const names = sources.map((s) => s.name);
  const wanted = (value ?? "").split(",").map((v) => v.trim()).filter(Boolean);
  const unknown = wanted.filter((v) => !names.includes(v));
  if (unknown.length) {
    throw new FetchCheckError(
      `NYC_CLR_ALLOW_SIZE_CHANGE names ${unknown.map((u) => `"${u}"`).join(", ")}; ` +
        `use one or more of ${names.join(", ")}, comma-separated, or leave it empty`
    );
  }
  return new Set(wanted);
}

/** One line on how to accept a real change in size for `name`. */
export function allowSizeChangeSteps(name) {
  return (
    `If the change is real, check American Legal's file, then either run Refresh Data by hand ` +
    `(GitHub: Actions > Refresh Data > Run workflow) with allow_size_change set to ${name}, or run ` +
    `NYC_CLR_ALLOW_SIZE_CHANGE=${name} npm run fetch-data and commit data/fetch-provenance.json ` +
    `with the index. The floor and ceiling then follow the new download`
  );
}

function requireHttps(name, url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw new FetchCheckError(`${name}: "${url}" is not a URL`);
  }
  if (parsed.protocol !== "https:") {
    throw new FetchCheckError(`${name}: refusing ${url}: only https is allowed`);
  }
  if (parsed.username || parsed.password) {
    throw new FetchCheckError(`${name}: refusing ${url}: it carries a user name or password`);
  }
  return parsed;
}

/** Where a 3xx answer points, if it is allowed: https on the original host. Else throws. */
export function redirectTarget(name, origin, current, res) {
  const location = res.headers.get("location");
  if (!location) {
    throw new FetchCheckError(`${name}: ${current} answered HTTP ${res.status} with no Location header`);
  }
  const next = new URL(location, current);
  // "https://evil.example@files.amlegal.com/x" is files.amlegal.com with a user name in it:
  // the host check alone would pass it, so a user name or password is refused by itself.
  if (next.username || next.password) {
    throw new FetchCheckError(
      `${name}: refusing the redirect from ${current} to ${location}: it carries a user name or password`
    );
  }
  // URL lower-cases the host and drops a default port, so FILES.AMLEGAL.COM and :443 pass and
  // any other port does not.
  if (next.protocol !== "https:" || next.host !== new URL(origin).host) {
    throw new FetchCheckError(
      `${name}: refusing the redirect from ${current} to ${next.href}: ` +
        `only https on ${new URL(origin).host} is allowed`
    );
  }
  return next.href;
}

/**
 * Downloads one ZIP over https, following only allowed redirects, and checks the status,
 * Content-Type and length. Returns { url, buffer, contentType, lastModified, etag }.
 */
export async function downloadZip(
  source,
  { fetchImpl, wait, timeoutMs, maxBytes = DEFAULT_MAX_BYTES, maxBytesWhy = "the most a ZIP may be" } = {}
) {
  const { name } = source;
  requireHttps(name, source.url);
  let url = source.url;
  for (let hop = 0; ; hop++) {
    const res = await politeFetch(url, { fetchImpl, wait, timeoutMs, redirect: "manual" });

    if (REDIRECT_STATUSES.has(res.status)) {
      await res.body?.cancel();
      if (hop >= MAX_REDIRECTS) {
        throw new FetchCheckError(`${name}: more than ${MAX_REDIRECTS} redirects from ${source.url}`);
      }
      url = redirectTarget(name, source.url, url, res);
      continue;
    }
    // A fetch that ignored redirect: "manual" (browsers give an opaque redirect) or followed
    // one anyway is refused rather than trusted.
    if (res.type === "opaqueredirect") {
      throw new FetchCheckError(`${name}: ${url} redirected and the redirect could not be read`);
    }
    if (res.redirected && res.url) {
      const landed = new URL(res.url);
      if (landed.protocol !== "https:" || landed.host !== new URL(source.url).host) {
        await res.body?.cancel();
        throw new FetchCheckError(`${name}: refusing ${res.url}: only https on ${new URL(source.url).host} is allowed`);
      }
    }

    if (res.status !== 200) {
      await res.body?.cancel();
      throw new FetchCheckError(`${name}: HTTP ${res.status} from ${url}`);
    }
    const contentType = res.headers.get("content-type");
    const mediaType = (contentType ?? "").split(";")[0].trim().toLowerCase();
    if (!ZIP_CONTENT_TYPES.has(mediaType)) {
      await res.body?.cancel();
      throw new FetchCheckError(
        `${name}: ${url} sent Content-Type ${contentType ? `"${contentType}"` : "(none)"}, not a ZIP`
      );
    }

    // Content-Length counts the bytes as sent. With a Content-Encoding, fetch has already
    // decoded the body, so the two cannot be compared; the ZIP's own CRCs still are.
    const encoding = (res.headers.get("content-encoding") ?? "identity").trim().toLowerCase();
    const declared = res.headers.get("content-length");
    let expected = null;
    if (declared !== null && encoding === "identity") {
      expected = Number(declared);
      if (!Number.isSafeInteger(expected) || expected < 0) {
        await res.body?.cancel();
        throw new FetchCheckError(`${name}: ${url} sent Content-Length "${declared}", not a number of bytes`);
      }
    }
    const tooBig = (n) => new FetchCheckError(`${name}: ${url} is over ${maxBytes} bytes (${n}), ${maxBytesWhy}`);
    if (expected !== null && expected > maxBytes) {
      await res.body?.cancel();
      throw tooBig(expected);
    }

    // Read as a stream, so an answer past maxBytes is stopped there, not held in memory whole.
    const chunks = [];
    let total = 0;
    if (res.body) {
      const reader = res.body.getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.length;
        if (total > maxBytes) {
          await reader.cancel();
          throw tooBig(`${total} so far`);
        }
        chunks.push(value);
      }
    }
    const buffer = Buffer.concat(chunks, total);

    if (expected !== null) {
      if (buffer.length !== expected) {
        throw new FetchCheckError(
          `${name}: received ${buffer.length} bytes from ${url}, but Content-Length was ${expected} (truncated?)`
        );
      }
    }

    return {
      url,
      buffer,
      contentType,
      lastModified: res.headers.get("last-modified"),
      etag: res.headers.get("etag"),
    };
  }
}

/**
 * Checks that `buffer` is a readable ZIP in the layout build-index.js reads (see the top of
 * this file). Returns { xmlFiles, currentThrough }.
 */
export function checkZip(name, buffer) {
  let entries;
  try {
    entries = new AdmZip(buffer).getEntries();
  } catch (e) {
    throw new FetchCheckError(`${name}: not a readable ZIP (${e.message})`);
  }
  for (const entry of entries) {
    const entryName = entry.entryName;
    if (entryName.startsWith("/") || entryName.includes("\\") || entryName.split("/").includes("..")) {
      throw new FetchCheckError(`${name}: the ZIP has an unsafe entry name "${entryName}"`);
    }
    if (entry.header.size > MAX_ENTRY_BYTES) {
      throw new FetchCheckError(
        `${name}: ${entryName} in the ZIP declares ${entry.header.size} bytes, over the ${MAX_ENTRY_BYTES}-byte limit for one file`
      );
    }
  }
  const xml = entries.filter(
    (e) => !e.isDirectory && e.entryName.startsWith("XML/") && e.entryName.endsWith(".xml")
  );
  if (xml.length === 0) {
    throw new FetchCheckError(`${name}: the ZIP has no XML/*.xml files, so it is not in American Legal's layout`);
  }
  const root = xml.find((e) => e.entryName === "XML/0-0-0-1.xml");
  if (!root) {
    throw new FetchCheckError(`${name}: the ZIP has no root file XML/0-0-0-1.xml, so it is not in American Legal's layout`);
  }
  let rootXml;
  for (const entry of xml) {
    let data;
    try {
      data = entry.getData();
    } catch (e) {
      throw new FetchCheckError(`${name}: ${entry.entryName} in the ZIP is damaged (${e.message})`);
    }
    if (entry === root) rootXml = data.toString("utf8");
  }
  const currentThrough = extractVersion(rootXml);
  if (currentThrough === "Unknown") {
    throw new FetchCheckError(`${name}: XML/0-0-0-1.xml has no "Current through" line`);
  }
  return { xmlFiles: xml.length, currentThrough };
}

/** Refuses a download much smaller than the last good one (see MIN_SIZE_RATIO). */
export function checkSize(name, got, last, ratio = MIN_SIZE_RATIO) {
  if (!last) return;
  const label = last.label ?? `the last good download (sha256 ${String(last.sha256).slice(0, 12)}…)`;
  const pct = Math.round(ratio * 100);
  for (const [field, unit] of [["bytes", "bytes"], ["xmlFiles", "XML files"]]) {
    if (typeof last[field] === "number" && got[field] < ratio * last[field]) {
      throw new FetchCheckError(
        `${name}: ${got[field]} ${unit} is less than ${pct}% of ${label} (${last[field]} ${unit}). ` +
          allowSizeChangeSteps(name)
      );
    }
  }
}

/** Reads data/fetch-provenance.json. Missing is null; unreadable or the wrong shape throws. */
export function readProvenance(path) {
  if (!existsSync(path)) return null;
  let record;
  try {
    record = JSON.parse(readFileSync(path, "utf8"));
  } catch (e) {
    throw new FetchCheckError(`${path} is not valid JSON (${e.message}); restore it from git`);
  }
  const corpora = record?.corpora;
  const ok =
    corpora &&
    typeof corpora === "object" &&
    Object.values(corpora).every(
      (c) => c && typeof c.sha256 === "string" && Number.isSafeInteger(c.bytes) && Number.isSafeInteger(c.xmlFiles)
    );
  if (!ok) throw new FetchCheckError(`${path} does not have the expected shape; restore it from git`);
  return record;
}

/**
 * The provenance record for `fresh` (one entry per document). An entry whose URL and sha256
 * match the prior record is kept exactly as it was, so a download of unchanged bytes changes
 * nothing in git (the refresh commits only real changes).
 */
export function provenanceRecord(fresh, prior) {
  const corpora = {};
  for (const [key, entry] of Object.entries(fresh)) {
    const old = prior?.corpora?.[key];
    corpora[key] = old && old.sha256 === entry.sha256 && old.url === entry.url ? old : entry;
  }
  return { about: PROVENANCE_ABOUT, corpora };
}

/**
 * Downloads and checks every source, then moves the ZIPs into `rawDir` and writes the
 * provenance record. Throws if any download fails a check; then nothing is replaced. If a
 * rename fails part way (a disk error), the thrown error's `replaced` lists the files that
 * were already replaced, so the caller can say how far it got.
 */
export async function fetchAll({
  sources = SOURCES,
  rawDir,
  provenancePath,
  fetchImpl,
  wait,
  timeoutMs,
  allowSizeChange = new Set(),
  baseline = BASELINE,
  now = () => new Date(),
  log = console.log,
  warn = console.warn,
}) {
  const prior = readProvenance(provenancePath);
  mkdirSync(rawDir, { recursive: true });
  const staged = [];
  const fresh = {};
  const cleanUp = () => {
    for (const { part } of staged) {
      try {
        rmSync(part, { force: true });
      } catch {
        // Leave it; the error that got us here is the one to report.
      }
    }
  };
  try {
    for (const source of sources) {
      log(`Downloading ${source.name} from ${source.url}...`);
      const last = prior?.corpora?.[source.name] ?? baseline[source.name];
      const waived = allowSizeChange.has(source.name);
      const ceiling =
        !waived && last?.bytes
          ? {
              maxBytes: MAX_GROWTH_RATIO * last.bytes,
              maxBytesWhy:
                `more than ${MAX_GROWTH_RATIO} times ${last.label ?? "the last good download"} ` +
                `(${last.bytes} bytes). ${allowSizeChangeSteps(source.name)}`,
            }
          : {
              maxBytes: DEFAULT_MAX_BYTES,
              maxBytesWhy: waived
                ? "the limit even with NYC_CLR_ALLOW_SIZE_CHANGE"
                : "more than a ZIP from it should ever be",
            };
      if (waived) warn(`  NYC_CLR_ALLOW_SIZE_CHANGE names ${source.name}: its size floor and ceiling are waived for this run`);
      const got = await downloadZip(source, { fetchImpl, wait, timeoutMs, ...ceiling });
      const sha256 = createHash("sha256").update(got.buffer).digest("hex");
      const { xmlFiles, currentThrough } = checkZip(source.name, got.buffer);
      const size = { bytes: got.buffer.length, xmlFiles };
      if (waived) {
        try {
          checkSize(source.name, size, last);
        } catch (e) {
          warn(`  NYC_CLR_ALLOW_SIZE_CHANGE names ${source.name}, so accepting it anyway: ${e.message}`);
        }
      } else {
        checkSize(source.name, size, last);
      }

      const part = join(rawDir, `${source.name}.zip.part`);
      // Staged before the write, so a write that fails half way is cleaned up too.
      staged.push({ part, dest: join(rawDir, `${source.name}.zip`) });
      writeFileSync(part, got.buffer);
      fresh[source.name] = {
        url: got.url,
        ...(got.url !== source.url ? { redirectedFrom: source.url } : {}),
        bytes: got.buffer.length,
        sha256,
        contentType: got.contentType,
        lastModified: got.lastModified,
        etag: got.etag,
        xmlFiles,
        currentThrough,
        firstFetchedAt: now().toISOString(),
      };
      log(`  ${got.buffer.length} bytes, sha256 ${sha256}, ${xmlFiles} XML files. ${currentThrough}`);
    }
    const record = provenanceRecord(fresh, prior);
    const recordPart = `${provenancePath}.part`;
    staged.push({ part: recordPart, dest: provenancePath });
    writeFileSync(recordPart, JSON.stringify(record, null, 2) + "\n");

    // The ZIPs first and the record last, so the record never names bytes that are not there.
    const replaced = [];
    try {
      for (const { part, dest } of staged) {
        renameSync(part, dest);
        replaced.push(dest);
      }
    } catch (e) {
      e.replaced = replaced;
      throw e;
    }
    log(`Saved ${staged.length - 1} ZIPs to ${rawDir} and their record to ${provenancePath}`);
    return record;
  } catch (e) {
    cleanUp();
    throw e;
  }
}
