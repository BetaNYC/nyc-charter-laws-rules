// The checked download behind fetch-data (issue #55): https only, redirects only to https on
// the same host, then status, Content-Type, length, ZIP layout and a size floor, with a
// provenance record for every ZIP. A fake fetch serves small ZIPs made here with adm-zip, so
// nothing touches the network. One test starts an http server on 127.0.0.1 to pin how Node's
// own fetch answers redirect: "manual", which the redirect check depends on.

import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { createHash, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { deflateRawSync } from "node:zlib";
import { tmpdir } from "node:os";
import { join } from "node:path";
import AdmZip from "adm-zip";
import {
  BASELINE,
  DEFAULT_MAX_BYTES,
  MAX_ENTRY_BYTES,
  MAX_GROWTH_RATIO,
  MAX_REDIRECTS,
  MIN_SIZE_RATIO,
  PROVENANCE_ABOUT,
  SOURCES,
  checkZip,
  downloadZip,
  fetchAll,
  parseAllowSizeChange,
  provenanceRecord,
} from "../scripts/lib/fetch-zip.js";

const ROOT_XML = (through) =>
  `<?xml version="1.0" encoding="utf-8"?><LEVEL style-name="Title"><RECORD><PARA>${through}</PARA></RECORD></LEVEL>`;

function makeZip({ root = "Current through Local Law 2026/1, enacted January 1, 2026,", files } = {}) {
  const zip = new AdmZip();
  const entries = files ?? {
    "XML/0-0-0-1.xml": ROOT_XML(root),
    "XML/0-0-0-2.xml": `<LEVEL><RECORD><PARA>${"§ 1. Text. ".repeat(50)}</PARA></RECORD></LEVEL>`,
    "IMAGES/a.png": randomBytes(64),
  };
  for (const [name, content] of Object.entries(entries)) zip.addFile(name, Buffer.from(content));
  return zip.toBuffer();
}

const GOOD = { charter: makeZip(), admin_code: makeZip(), rules: makeZip() };
// The real sources' floors are megabytes; these tests check the floor and the ceiling on
// their own numbers: the test ZIPs' size, so a floor of half and a ceiling of four times.
const TINY_BASELINE = Object.fromEntries(
  Object.keys(BASELINE).map((k) => [k, { bytes: GOOD[k].length, xmlFiles: 1, label: "the test baseline" }])
);

const zipResponse = (body, headers = {}) =>
  new Response(body, {
    status: 200,
    headers: { "content-type": "application/zip", "content-length": String(body.length), ...headers },
  });

/** A fake fetch. `routes` maps a URL to a function returning a Response; default: GOOD. */
function fakeFetch(routes = {}) {
  const calls = [];
  const impl = async (url, init) => {
    calls.push({ url, init });
    if (routes[url]) return routes[url]();
    const source = SOURCES.find((s) => s.url === url);
    if (source) return zipResponse(GOOD[source.name], { etag: `"${source.name}"`, "last-modified": "Sat, 21 Nov 2026 15:43:45 GMT" });
    return new Response("not found", { status: 404, headers: { "content-type": "text/html" } });
  };
  return { impl, calls };
}

let dir;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "fetch-zip-"));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const paths = () => ({ rawDir: join(dir, "raw"), provenancePath: join(dir, "fetch-provenance.json") });
const quiet = { log: () => {}, warn: () => {}, wait: async () => {} };
const run = (fetchImpl, extra = {}) =>
  fetchAll({ ...paths(), fetchImpl, baseline: TINY_BASELINE, ...quiet, ...extra });
const urlOf = (name) => SOURCES.find((s) => s.name === name).url;

test("the three sources are https on files.amlegal.com", () => {
  assert.deepEqual(SOURCES.map((s) => s.name), ["charter", "admin_code", "rules"]);
  for (const s of SOURCES) assert.match(s.url, /^https:\/\/files\.amlegal\.com\/pdffiles\/NewYorkCity\/(Charter|Admin|Rules)\/XML\.zip$/);
});

test("good ZIPs pass: saved to data/raw, with a provenance entry for each", async () => {
  const { impl, calls } = fakeFetch();
  const record = await run(impl, { now: () => new Date("2026-11-25T11:00:00Z") });
  assert.deepEqual(calls.map((c) => c.url), SOURCES.map((s) => s.url));
  for (const c of calls) assert.equal(c.init.redirect, "manual", "redirects are checked by hand");

  assert.equal(record.about, PROVENANCE_ABOUT);
  for (const [name, body] of Object.entries(GOOD)) {
    const saved = readFileSync(join(paths().rawDir, `${name}.zip`));
    assert.ok(saved.equals(body), `${name}.zip is the downloaded bytes`);
    assert.deepEqual(record.corpora[name], {
      url: urlOf(name),
      bytes: body.length,
      sha256: createHash("sha256").update(body).digest("hex"),
      contentType: "application/zip",
      lastModified: "Sat, 21 Nov 2026 15:43:45 GMT",
      etag: `"${name}"`,
      xmlFiles: 2,
      currentThrough: "Current through Local Law 2026/1, enacted January 1, 2026,",
      firstFetchedAt: "2026-11-25T11:00:00.000Z",
    });
  }
  assert.deepEqual(JSON.parse(readFileSync(paths().provenancePath, "utf8")), record);
  assert.deepEqual(readdirSync(paths().rawDir).sort(), ["admin_code.zip", "charter.zip", "rules.zip"], "no .part file left");
});

test("the same bytes again leave the provenance file byte-identical; new bytes replace the entry", async () => {
  await run(fakeFetch().impl, { now: () => new Date("2026-11-25T11:00:00Z") });
  const first = readFileSync(paths().provenancePath, "utf8");
  await run(fakeFetch().impl, { now: () => new Date("2026-11-26T11:00:00Z") });
  assert.equal(readFileSync(paths().provenancePath, "utf8"), first, "no change in git on a no-change day");

  const newer = makeZip({ root: "Current through Local Law 2026/2, enacted February 1, 2026," });
  const { impl } = fakeFetch({ [urlOf("rules")]: () => zipResponse(newer) });
  const record = await run(impl, { now: () => new Date("2026-11-27T11:00:00Z") });
  assert.equal(record.corpora.rules.firstFetchedAt, "2026-11-27T11:00:00.000Z");
  assert.equal(record.corpora.rules.sha256, createHash("sha256").update(newer).digest("hex"));
  assert.equal(record.corpora.rules.currentThrough, "Current through Local Law 2026/2, enacted February 1, 2026,");
  assert.equal(record.corpora.charter.firstFetchedAt, "2026-11-25T11:00:00.000Z", "unchanged documents keep theirs");
});

test("an http source URL is refused before any request", async () => {
  const { impl, calls } = fakeFetch();
  await assert.rejects(
    fetchAll({ ...paths(), ...quiet, fetchImpl: impl, sources: [{ name: "charter", url: "http://files.amlegal.com/pdffiles/NewYorkCity/Charter/XML.zip" }] }),
    /charter: refusing http:\/\/files\.amlegal\.com\/.*only https is allowed/
  );
  assert.equal(calls.length, 0);
});

const redirect = (location, status = 302) => () =>
  new Response(null, { status, headers: location ? { location } : {} });

test("a redirect to http is refused (no http fallback)", async () => {
  const { impl, calls } = fakeFetch({
    [urlOf("charter")]: redirect("http://files.amlegal.com/pdffiles/NewYorkCity/Charter/XML.zip", 301),
  });
  await assert.rejects(run(impl), /charter: refusing the redirect from https:\/\/files\.amlegal\.com\/.* to http:\/\/files\.amlegal\.com\/.*only https on files\.amlegal\.com/);
  assert.equal(calls.length, 1, "the http URL is never requested");
});

test("a redirect to another host is refused, even over https", async () => {
  const { impl, calls } = fakeFetch({ [urlOf("charter")]: redirect("https://evil.example/XML.zip") });
  await assert.rejects(run(impl), /refusing the redirect .* to https:\/\/evil\.example\/XML\.zip/);
  assert.equal(calls.length, 1);
});

test("a redirect to https on the same host is followed and recorded", async () => {
  const moved = "https://files.amlegal.com/pdffiles/NewYorkCity/Charter/v2/XML.zip";
  const { impl, calls } = fakeFetch({
    [urlOf("charter")]: redirect("/pdffiles/NewYorkCity/Charter/v2/XML.zip", 308),
    [moved]: () => zipResponse(GOOD.charter),
  });
  const record = await run(impl);
  assert.deepEqual(calls.slice(0, 2).map((c) => c.url), [urlOf("charter"), moved]);
  assert.equal(record.corpora.charter.url, moved);
  assert.equal(record.corpora.charter.redirectedFrom, urlOf("charter"));
  assert.equal(record.corpora.rules.redirectedFrom, undefined);
});

test(`more than ${MAX_REDIRECTS} redirects, or a redirect with no Location, is refused`, async () => {
  const loop = fakeFetch({ [urlOf("charter")]: redirect(urlOf("charter")) });
  await assert.rejects(run(loop.impl), new RegExp(`charter: more than ${MAX_REDIRECTS} redirects`));
  assert.equal(loop.calls.length, MAX_REDIRECTS + 1);

  const bare = fakeFetch({ [urlOf("charter")]: redirect(null) });
  await assert.rejects(run(bare.impl), /charter: .* answered HTTP 302 with no Location header/);
});

test("a fetch that followed a redirect off https anyway is refused", async () => {
  const followed = () => {
    const res = zipResponse(GOOD.charter);
    Object.defineProperty(res, "redirected", { value: true });
    Object.defineProperty(res, "url", { value: "http://files.amlegal.com/x.zip" });
    return res;
  };
  await assert.rejects(run(fakeFetch({ [urlOf("charter")]: followed }).impl), /charter: refusing http:\/\/files\.amlegal\.com\/x\.zip/);
});

test("a status other than 200 is refused", async () => {
  for (const status of [403, 404, 206]) {
    const { impl } = fakeFetch({ [urlOf("admin_code")]: () => new Response("no", { status, headers: { "content-type": "application/zip" } }) });
    await assert.rejects(run(impl), new RegExp(`admin_code: HTTP ${status} from https://files\\.amlegal\\.com/`));
  }
});

test("a Content-Type that is not a ZIP is refused", async () => {
  const html = fakeFetch({ [urlOf("rules")]: () => zipResponse(Buffer.from("<html>Sign in</html>"), { "content-type": "text/html; charset=utf-8" }) });
  await assert.rejects(run(html.impl), /rules: .* sent Content-Type "text\/html; charset=utf-8", not a ZIP/);
  const none = fakeFetch({ [urlOf("rules")]: () => new Response(GOOD.rules, { status: 200 }) });
  await assert.rejects(run(none.impl), /rules: .* sent Content-Type \(none\), not a ZIP/);
  // Parameters and case do not matter.
  const ok = fakeFetch({ [urlOf("rules")]: () => zipResponse(GOOD.rules, { "content-type": "Application/ZIP; foo=bar" }) });
  await run(ok.impl);
});

test("a body shorter than Content-Length is refused as truncated", async () => {
  const short = GOOD.charter.subarray(0, GOOD.charter.length - 100);
  const { impl } = fakeFetch({ [urlOf("charter")]: () => zipResponse(short, { "content-length": String(GOOD.charter.length) }) });
  await assert.rejects(run(impl), new RegExp(`charter: received ${short.length} bytes .* but Content-Length was ${GOOD.charter.length} \\(truncated\\?\\)`));
});

test("a truncated ZIP with no Content-Length is still refused: not a readable ZIP", async () => {
  const short = GOOD.charter.subarray(0, Math.floor(GOOD.charter.length / 2));
  const { impl } = fakeFetch({ [urlOf("charter")]: () => new Response(short, { status: 200, headers: { "content-type": "application/zip" } }) });
  await assert.rejects(run(impl), /charter: not a readable ZIP/);
});

test("a body that is not a ZIP is refused", async () => {
  const { impl } = fakeFetch({ [urlOf("charter")]: () => zipResponse(Buffer.from("<html><body>Service unavailable</body></html>")) });
  await assert.rejects(run(impl), /charter: not a readable ZIP/);
});

test("a ZIP not in American Legal's layout is refused", () => {
  assert.throws(() => checkZip("charter", makeZip({ files: { "0-0-0-1.xml": ROOT_XML("Current through x"), "readme.txt": "hi" } })),
    /charter: the ZIP has no XML\/\*\.xml files/);
  assert.throws(() => checkZip("charter", makeZip({ files: { "XML/0-0-0-2.xml": "<LEVEL/>" } })),
    /charter: the ZIP has no root file XML\/0-0-0-1\.xml/);
  assert.throws(() => checkZip("charter", makeZip({ files: { "XML/0-0-0-1.xml": ROOT_XML("Effective whenever") } })),
    /charter: XML\/0-0-0-1\.xml has no "Current through" line/);
  assert.deepEqual(checkZip("charter", GOOD.charter), { xmlFiles: 2, currentThrough: "Current through Local Law 2026/1, enacted January 1, 2026," });
});

test("a ZIP entry name that climbs out of the archive is refused", () => {
  const zip = new AdmZip(GOOD.charter);
  // addFile cleans names, so rename an entry after the fact, as a hostile ZIP would have it.
  zip.getEntry("XML/0-0-0-2.xml").entryName = "XML/../../evil.xml";
  assert.throws(() => checkZip("charter", zip.toBuffer()), /charter: the ZIP has an unsafe entry name "XML\/\.\.\/\.\.\/evil\.xml"/);
});

test("an XML file that fails its CRC is refused", () => {
  const payload = randomBytes(4096); // does not compress, so its bytes sit in the ZIP as is
  const zip = makeZip({ files: { "XML/0-0-0-1.xml": ROOT_XML("Current through x"), "XML/0-0-0-2.xml": payload } });
  const at = zip.indexOf(payload.subarray(1000, 1032));
  assert.ok(at > 0, "found the stored payload");
  const damaged = Buffer.from(zip);
  damaged[at] ^= 0xff;
  assert.throws(() => checkZip("charter", damaged), /charter: XML\/0-0-0-2\.xml in the ZIP is damaged/);
});

test(`a download under ${MIN_SIZE_RATIO * 100}% of the last good one is refused, unless NYC_CLR_ALLOW_SIZE_CHANGE names it`, async () => {
  await run(fakeFetch().impl);
  const good = JSON.parse(readFileSync(paths().provenancePath, "utf8"));
  // Make the recorded charter twice as big plus one byte: today's good ZIP is now under half.
  const bigger = structuredClone(good);
  bigger.corpora.charter.bytes = GOOD.charter.length * 2 + 1;
  bigger.corpora.charter.sha256 = "f".repeat(64); // a different, bigger earlier download
  writeFileSync(paths().provenancePath, JSON.stringify(bigger));
  await assert.rejects(
    run(fakeFetch().impl),
    /charter: \d+ bytes is less than 50% of the last good download \(sha256 [0-9a-f]{12}…\) \(\d+ bytes\)\. If the change is real, .*Run workflow\) with allow_size_change set to charter, or run NYC_CLR_ALLOW_SIZE_CHANGE=charter npm run fetch-data and commit data\/fetch-provenance\.json/
  );
  assert.equal(readFileSync(paths().provenancePath, "utf8"), JSON.stringify(bigger), "a refused run writes no record");

  // Waiving another document's floor does not waive this one.
  await assert.rejects(run(fakeFetch().impl, { allowSizeChange: new Set(["rules"]) }), /charter: \d+ bytes is less than 50%/);

  const warnings = [];
  const record = await run(fakeFetch().impl, { allowSizeChange: new Set(["charter"]), warn: (m) => warnings.push(m) });
  assert.equal(warnings.length, 2);
  assert.match(warnings[0], /NYC_CLR_ALLOW_SIZE_CHANGE names charter: its size floor and ceiling are waived for this run/);
  assert.match(warnings[1], /NYC_CLR_ALLOW_SIZE_CHANGE names charter, so accepting it anyway: charter: /);
  // The floor follows the last good download: the accepted, smaller file is the new baseline.
  assert.equal(record.corpora.charter.bytes, GOOD.charter.length);
  await run(fakeFetch().impl);

  // The XML file count has the same floor.
  const fewer = structuredClone(good);
  fewer.corpora.rules.xmlFiles = 5;
  fewer.corpora.rules.sha256 = "0".repeat(64);
  writeFileSync(paths().provenancePath, JSON.stringify(fewer));
  await assert.rejects(run(fakeFetch().impl), /rules: 2 XML files is less than 50% of the last good download .*\(5 XML files\)/);
});

test("with no record yet, the floor is the July 2026 baseline", async () => {
  // Defaults: the real BASELINE, against which the tiny test ZIPs are far too small.
  await assert.rejects(
    fetchAll({ ...paths(), ...quiet, fetchImpl: fakeFetch().impl }),
    new RegExp(`charter: \\d+ bytes is less than 50% of the July 5, 2026 download \\(${BASELINE.charter.bytes} bytes\\)`)
  );
});

test("one failure replaces nothing: earlier ZIPs stay, no .part file is left, no record is written", async () => {
  const { rawDir, provenancePath } = paths();
  await run(fakeFetch().impl);
  const before = readFileSync(provenancePath, "utf8");
  const oldCharter = readFileSync(join(rawDir, "charter.zip"));

  const newer = makeZip({ root: "Current through Local Law 2026/9, enacted March 1, 2026," });
  const { impl } = fakeFetch({
    [urlOf("charter")]: () => zipResponse(newer),
    [urlOf("rules")]: () => new Response("busy", { status: 404 }),
  });
  await assert.rejects(run(impl), /rules: HTTP 404/);
  assert.ok(readFileSync(join(rawDir, "charter.zip")).equals(oldCharter), "charter.zip was not replaced");
  assert.equal(readFileSync(provenancePath, "utf8"), before);
  assert.deepEqual(readdirSync(rawDir).sort(), ["admin_code.zip", "charter.zip", "rules.zip"]);
});

test("an unreadable or misshapen provenance file stops the run", async () => {
  writeFileSync(paths().provenancePath, "{ not json");
  await assert.rejects(run(fakeFetch().impl), /fetch-provenance\.json is not valid JSON .* restore it from git/);
  writeFileSync(paths().provenancePath, JSON.stringify({ corpora: { charter: { bytes: "big" } } }));
  await assert.rejects(run(fakeFetch().impl), /fetch-provenance\.json does not have the expected shape/);
  assert.equal(existsSync(join(paths().rawDir, "charter.zip")), false, "nothing downloaded");
});

test("provenanceRecord keeps an entry whose bytes did not change, exactly", () => {
  const old = { url: "u", sha256: "a", bytes: 1, xmlFiles: 1, firstFetchedAt: "then", etag: '"1"' };
  const same = { ...old, firstFetchedAt: "now", etag: '"2"' };
  assert.equal(provenanceRecord({ charter: same }, { corpora: { charter: old } }).corpora.charter, old);
  const moved = { ...same, sha256: "b" };
  assert.equal(provenanceRecord({ charter: moved }, { corpora: { charter: old } }).corpora.charter, moved);
  assert.equal(provenanceRecord({ charter: same }, null).corpora.charter, same);
});

test("NYC_CLR_ALLOW_SIZE_CHANGE names documents; unset or empty names none; anything else stops", () => {
  assert.deepEqual(parseAllowSizeChange(undefined), new Set());
  assert.deepEqual(parseAllowSizeChange(""), new Set());
  assert.deepEqual(parseAllowSizeChange("rules"), new Set(["rules"]));
  assert.deepEqual(parseAllowSizeChange(" charter , admin_code,"), new Set(["charter", "admin_code"]));
  for (const bad of ["1", "all", "Rules", "rules,admin"]) {
    assert.throws(() => parseAllowSizeChange(bad), /NYC_CLR_ALLOW_SIZE_CHANGE names .*; use one or more of charter, admin_code, rules/);
  }
});

test("Node's fetch with redirect: \"manual\" hands back the 3xx and its Location (127.0.0.1 only)", async () => {
  // downloadZip relies on this to see every hop. A fetch that hid the redirect instead (an
  // opaque redirect, as browsers give) is refused by downloadZip, never followed.
  const server = createServer((req, res) => {
    if (req.url === "/a") {
      res.writeHead(302, { location: "http://127.0.0.1:1/elsewhere" });
      res.end();
    } else {
      res.writeHead(404);
      res.end();
    }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const { port } = server.address();
    const res = await fetch(`http://127.0.0.1:${port}/a`, { redirect: "manual" });
    assert.equal(res.status, 302);
    assert.equal(res.headers.get("location"), "http://127.0.0.1:1/elsewhere");
    assert.equal(res.redirected, false);
    await res.body?.cancel();
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("downloadZip on a lone source returns the bytes and headers it checked", async () => {
  const { impl } = fakeFetch();
  const got = await downloadZip(SOURCES[0], { fetchImpl: impl, wait: async () => {} });
  assert.ok(got.buffer.equals(GOOD.charter));
  assert.equal(got.url, SOURCES[0].url);
  assert.equal(got.etag, '"charter"');
});

test("the refresh workflow commits the record fetch-data writes, with no git add -A", () => {
  const root = new URL("..", import.meta.url);
  const cli = readFileSync(new URL("scripts/fetch-data.js", root), "utf8");
  assert.match(cli, /provenancePath: join\(ROOT, "data", "fetch-provenance\.json"\)/);
  const yml = readFileSync(new URL(".github/workflows/refresh-data.yml", root), "utf8");
  assert.match(yml, /^ {10}UNSHIPPED_PATHS=\(data\/structure data\/fetch-provenance\.json\)$/m);
  assert.match(yml, /^ {10}PATHS\+=\("\$\{UNSHIPPED_PATHS\[@\]\}"\)$/m, "staged with the index on a release day");
  assert.match(yml, /^ {14}git add -- "\$\{UNSHIPPED_PATHS\[@\]\}"$/m, "and by itself when only it changed");
  assert.doesNotMatch(yml, /^\s+git add (-A|--all|\.)/m, "no command stages everything");
  // The fetch still runs before the build.
  assert.ok(yml.indexOf("run: npm run fetch-data") < yml.indexOf("run: npm run build-index"));
  // Not in the npm package, so a change to it alone needs no release.
  const pkg = JSON.parse(readFileSync(new URL("package.json", root), "utf8"));
  assert.ok(!pkg.files.some((f) => "data/fetch-provenance.json".startsWith(f)), "not shipped");
});

// --- Review fixes (2026-11-25) ---

// CRC-32 (IEEE), for the hand-built ZIP below. zlib.crc32 is newer than Node 20.0.
const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};

/**
 * A ZIP written the way American Legal's are: deflated entries with general-purpose flag bit 3
 * set, so the local header carries no CRC or sizes and a data descriptor (with its signature)
 * follows the data (APPNOTE.TXT 4.3.9). adm-zip never writes these itself. `declaredSize`
 * overrides one entry's uncompressed size in the central directory.
 */
function zipWithDescriptors(files, { declaredSize = {} } = {}) {
  const parts = [];
  const central = [];
  let offset = 0;
  for (const [name, content] of Object.entries(files)) {
    const data = Buffer.from(content);
    const nameBuf = Buffer.from(name);
    const comp = deflateRawSync(data);
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4); // version needed
    local.writeUInt16LE(0x0008, 6); // bit 3: sizes and CRC in the data descriptor
    local.writeUInt16LE(8, 8); // deflate
    local.writeUInt16LE(nameBuf.length, 26);
    const descriptor = Buffer.alloc(16);
    descriptor.writeUInt32LE(0x08074b50, 0);
    descriptor.writeUInt32LE(crc, 4);
    descriptor.writeUInt32LE(comp.length, 8);
    descriptor.writeUInt32LE(data.length, 12);
    const cen = Buffer.alloc(46);
    cen.writeUInt32LE(0x02014b50, 0);
    cen.writeUInt16LE(20, 4);
    cen.writeUInt16LE(20, 6);
    cen.writeUInt16LE(0x0008, 8);
    cen.writeUInt16LE(8, 10);
    cen.writeUInt32LE(crc, 16);
    cen.writeUInt32LE(comp.length, 20);
    cen.writeUInt32LE(declaredSize[name] ?? data.length, 24);
    cen.writeUInt16LE(nameBuf.length, 28);
    cen.writeUInt32LE(offset, 42);
    parts.push(local, nameBuf, comp, descriptor);
    central.push(cen, nameBuf);
    offset += local.length + nameBuf.length + comp.length + descriptor.length;
  }
  const cd = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(central.length / 2, 8);
  end.writeUInt16LE(central.length / 2, 10);
  end.writeUInt32LE(cd.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...parts, cd, end]);
}

test("a ZIP with data descriptors, like American Legal's, passes; a flipped byte in it fails its CRC", () => {
  const payload = randomBytes(4096);
  const files = { "XML/0-0-0-1.xml": ROOT_XML("Current through Local Law 2026/3,"), "XML/0-0-0-2.xml": payload };
  const zip = zipWithDescriptors(files);
  assert.ok(new AdmZip(zip).getEntries().every((e) => e.header.flags_desc), "every entry uses a data descriptor");
  assert.deepEqual(checkZip("rules", zip), { xmlFiles: 2, currentThrough: "Current through Local Law 2026/3," });

  const at = zip.indexOf(deflateRawSync(payload).subarray(1000, 1032));
  assert.ok(at > 0, "found the deflated payload");
  const damaged = Buffer.from(zip);
  damaged[at] ^= 0xff;
  assert.throws(() => checkZip("rules", damaged), /rules: XML\/0-0-0-2\.xml in the ZIP is damaged/);
});

test(`an entry that declares more than ${MAX_ENTRY_BYTES} bytes is refused before it is read`, () => {
  const files = { "XML/0-0-0-1.xml": ROOT_XML("Current through x"), "IMAGES/big.png": "tiny" };
  const zip = zipWithDescriptors(files, { declaredSize: { "IMAGES/big.png": MAX_ENTRY_BYTES + 1 } });
  assert.throws(
    () => checkZip("admin_code", zip),
    new RegExp(`admin_code: IMAGES/big\\.png in the ZIP declares ${MAX_ENTRY_BYTES + 1} bytes, over the ${MAX_ENTRY_BYTES}-byte limit`)
  );
});

test(`a body over ${MAX_GROWTH_RATIO} times the last good download is refused, by Content-Length or while streaming`, async () => {
  const cap = MAX_GROWTH_RATIO * GOOD.charter.length;
  const declared = fakeFetch({
    [urlOf("charter")]: () => new Response("x", { status: 200, headers: { "content-type": "application/zip", "content-length": String(cap + 1) } }),
  });
  await assert.rejects(run(declared.impl), new RegExp(`charter: .* is over ${cap} bytes \\(${cap + 1}\\)`));

  // No Content-Length and a body that never ends: reading stops just past the cap.
  let pulled = 0;
  const endless = () =>
    new Response(
      new ReadableStream({
        pull(controller) {
          pulled++;
          // Ends at 8 times the cap, so a missing cap fails this test fast instead of hanging.
          if (pulled * 256 > 8 * cap) controller.close();
          else controller.enqueue(new Uint8Array(256));
        },
      }),
      { status: 200, headers: { "content-type": "application/zip" } }
    );
  await assert.rejects(run(fakeFetch({ [urlOf("charter")]: endless }).impl), new RegExp(`charter: .* is over ${cap} bytes \\(\\d+ so far\\)`));
  assert.ok(pulled * 256 <= cap + 512, `stopped near the cap (read ${pulled * 256} bytes)`);
});

test("a redirect carrying a user name or password, or to another port, is refused; host case does not matter", async () => {
  const userinfo = fakeFetch({ [urlOf("charter")]: redirect("https://evil.example@files.amlegal.com/x.zip") });
  await assert.rejects(run(userinfo.impl), /charter: refusing the redirect from .* to https:\/\/evil\.example@files\.amlegal\.com\/x\.zip: it carries a user name or password/);
  const password = fakeFetch({ [urlOf("charter")]: redirect("https://u:p@files.amlegal.com/x.zip") });
  await assert.rejects(run(password.impl), /it carries a user name or password/);

  const port = fakeFetch({ [urlOf("charter")]: redirect("https://files.amlegal.com:8443/x.zip") });
  await assert.rejects(run(port.impl), /refusing the redirect .* to https:\/\/files\.amlegal\.com:8443\/x\.zip: only https on files\.amlegal\.com/);

  // URL lower-cases the host and drops the default port, so this is files.amlegal.com.
  const moved = "https://files.amlegal.com/pdffiles/NewYorkCity/Charter/v2/XML.zip";
  const { impl, calls } = fakeFetch({
    [urlOf("charter")]: redirect("https://FILES.AMLEGAL.COM:443/pdffiles/NewYorkCity/Charter/v2/XML.zip"),
    [moved]: () => zipResponse(GOOD.charter),
  });
  const record = await run(impl);
  assert.equal(calls[1].url, moved);
  assert.equal(record.corpora.charter.url, moved);
});

test("a rename that fails part way says which files it had already replaced; a failed record write replaces nothing", async () => {
  const { rawDir, provenancePath } = paths();
  // rules.zip is a directory, so renaming rules.zip.part onto it fails after charter and
  // admin_code were renamed.
  mkdirSync(join(rawDir, "rules.zip"), { recursive: true });
  const err = await run(fakeFetch().impl).catch((e) => e);
  assert.ok(err instanceof Error);
  assert.deepEqual(err.replaced, [join(rawDir, "charter.zip"), join(rawDir, "admin_code.zip")]);
  assert.equal(existsSync(provenancePath), false, "the record is renamed last, so it names no missing bytes");
  assert.equal(existsSync(`${provenancePath}.part`), false, "no .part left");
  assert.equal(existsSync(join(rawDir, "rules.zip.part")), false);

  // The record's .part cannot be written: nothing is replaced and the ZIPs' .part files go.
  const dir2 = mkdtempSync(join(tmpdir(), "fetch-zip-"));
  try {
    const raw2 = join(dir2, "raw");
    const record2 = join(dir2, "fetch-provenance.json");
    mkdirSync(`${record2}.part`, { recursive: true });
    const err2 = await fetchAll({ rawDir: raw2, provenancePath: record2, fetchImpl: fakeFetch().impl, baseline: TINY_BASELINE, ...quiet }).catch((e) => e);
    assert.ok(err2 instanceof Error);
    assert.equal(err2.replaced, undefined);
    assert.deepEqual(readdirSync(raw2), [], "no ZIP replaced, no .part left");
  } finally {
    rmSync(dir2, { recursive: true, force: true });
  }
});

test("a ZIP past the ceiling is refused with the recovery steps; the waiver covers growth too; waive, shrink, restore", async () => {
  // The Charter ZIP as it would be if American Legal started bundling images in it.
  const BIG = makeZip({
    files: {
      "XML/0-0-0-1.xml": ROOT_XML("Current through Local Law 2026/1, enacted January 1, 2026,"),
      "XML/0-0-0-2.xml": "<LEVEL/>",
      "IMAGES/a.png": randomBytes(16 * 1024),
    },
  });
  assert.ok(BIG.length > MAX_GROWTH_RATIO * GOOD.charter.length, "BIG is past the ceiling over GOOD");
  const serve = (body) => fakeFetch({ [urlOf("charter")]: () => zipResponse(body) }).impl;
  const charter = () => JSON.parse(readFileSync(paths().provenancePath, "utf8")).corpora.charter.bytes;
  const waive = { allowSizeChange: new Set(["charter"]) };
  const steps = /If the change is real, .* with allow_size_change set to charter, or run NYC_CLR_ALLOW_SIZE_CHANGE=charter npm run fetch-data/;

  await run(serve(GOOD.charter));
  assert.equal(charter(), GOOD.charter.length);

  // Grows past four times: refused, with what to do next.
  const grown = await run(serve(BIG)).catch((e) => e);
  assert.match(grown.message, new RegExp(`charter: .* is over ${MAX_GROWTH_RATIO * GOOD.charter.length} bytes .*, more than ${MAX_GROWTH_RATIO} times the last good download \\(${GOOD.charter.length} bytes\\)\\.`));
  assert.match(grown.message, steps);
  assert.equal(charter(), GOOD.charter.length, "nothing recorded");

  // Waived: accepted, and BIG is the new baseline.
  await run(serve(BIG), waive);
  assert.equal(charter(), BIG.length);

  // Shrinks back under half of BIG: refused by the floor, accepted with the waiver.
  await assert.rejects(run(serve(GOOD.charter)), /charter: \d+ bytes is less than 50% of the last good download/);
  await run(serve(GOOD.charter), waive);
  assert.equal(charter(), GOOD.charter.length);

  // Restored to BIG the next day: the ceiling now follows the small file, so it is refused
  // again, with the same steps, and the waiver accepts it.
  const restored = await run(serve(BIG)).catch((e) => e);
  assert.match(restored.message, steps);
  await run(serve(BIG), waive);
  assert.equal(charter(), BIG.length);
});

test("with the waiver the ceiling is still the fixed limit, so memory stays bounded", async () => {
  const huge = fakeFetch({
    [urlOf("charter")]: () =>
      new Response("x", { status: 200, headers: { "content-type": "application/zip", "content-length": String(DEFAULT_MAX_BYTES + 1) } }),
  });
  await assert.rejects(
    run(huge.impl, { allowSizeChange: new Set(["charter"]) }),
    new RegExp(`charter: .* is over ${DEFAULT_MAX_BYTES} bytes \\(${DEFAULT_MAX_BYTES + 1}\\), the limit even with NYC_CLR_ALLOW_SIZE_CHANGE`)
  );
});
