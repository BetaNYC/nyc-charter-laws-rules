// The picture description page's inbox mode (issue #87): the JSON body it sends to BetaNYC's
// data-issue intake (scripts/lib/alt-text/inbox-payload.js), what it says about each answer,
// and the inbox build (static-build.js --mode inbox). Field names and limits are the intake's
// contract, kind alt-text-suggestion (betanyc-ai-workspace team/reference/data-issue-intake.md,
// amendment 2026-11-25). Nothing here sends anything.

import { test, before } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, mkdtempSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { openSource } from "../scripts/lib/alt-text/source.js";
import { buildInventory, loadIndex } from "../scripts/lib/alt-text/inventory.js";
import { saveDraft, saveReview } from "../scripts/lib/alt-text/store.js";
import { buildStatic, sectionUrl, inboxCsp, INBOX_PATH } from "../scripts/lib/alt-text/static-build.js";
import { buildPayload, describeResponse, cleanText, charCount, isClientId, isLawReaderUrl, newClientId, LIMITS, ENDPOINT, PRIVACY_URL } from "../scripts/lib/alt-text/inbox-payload.js";
import { makeFixture } from "./alt-text/fixture.js";

const SHA = "004066b9450190182377878f841a91a90fd54b1b7f2eb4b0c699dd4d499507b2";
const PIC = { book: "admin_code", sha256: SHA, picture_ids: ["0-0-0-22858-img"], page_url: "https://law.beta.nyc/admin-code/sections/27-506" };
const CLIENT = "3f2b8c1e-9a4d-4e6f-b1c2-0d9e8f7a6b5c";
const FORM = { alt: "A salt shaker in a black triangle.", long: "", note: "", name: "", email: "", creditOk: false, website: "" };

// --- The body ------------------------------------------------------------------------------

test("the body has the contract's fields, in its order, and nothing else", () => {
  const r = buildPayload(PIC, FORM, CLIENT);
  assert.equal(r.ok, true);
  assert.deepEqual(Object.keys(r.body), ["schema", "tool", "kind", "page_url", "book", "image_sha256", "picture_ids", "suggested_alt", "suggested_long", "note", "credit_ok", "client_id", "website"]);
  assert.equal(r.body.schema, "betanyc-data-issue/1");
  assert.equal(r.body.tool, "law-reader");
  assert.equal(r.body.kind, "alt-text-suggestion");
  assert.equal(r.body.page_url, PIC.page_url);
  assert.equal(r.body.book, "admin_code");
  assert.equal(r.body.image_sha256, SHA);
  assert.deepEqual(r.body.picture_ids, ["0-0-0-22858-img"]);
  assert.equal(r.body.suggested_alt, FORM.alt);
  assert.equal(r.body.suggested_long, "");
  assert.equal(r.body.note, "");
  assert.equal(r.body.credit_ok, false);
  assert.equal(r.body.website, "", "the trap field goes empty");
  for (const k of ["dataset", "batch_id", "answers", "record", "description", "contact"]) assert.equal(k in r.body, false, k);
});

test("the contact block is separate from the report, and left out when empty", () => {
  const none = buildPayload(PIC, { ...FORM, name: "  ", email: "" }, CLIENT).body;
  assert.equal("contact" in none, false);
  const both = buildPayload(PIC, { ...FORM, name: " Ada Lovelace ", email: "ada@example.org", creditOk: true }, CLIENT).body;
  assert.deepEqual(both.contact, { name: "Ada Lovelace", email: "ada@example.org" });
  assert.equal(both.credit_ok, true);
  // The name and email are only in the contact block, never in the report's own fields.
  const report = { ...both };
  delete report.contact;
  assert.doesNotMatch(JSON.stringify(report), /Ada|ada@/);
  assert.deepEqual(buildPayload(PIC, { ...FORM, email: "ada@example.org" }, CLIENT).body.contact, { email: "ada@example.org" });
});

test("credit_ok is a boolean and false unless the box is ticked; ticking it needs a name", () => {
  assert.equal(buildPayload(PIC, { ...FORM, creditOk: "yes" }, CLIENT).body.credit_ok, false);
  const r = buildPayload(PIC, { ...FORM, creditOk: true }, CLIENT);
  assert.equal(r.ok, false);
  assert.equal(r.problems[0].field, "name");
});

test("the trap field is sent as the form holds it, so a robot's fill reaches the intake", () => {
  assert.equal(buildPayload(PIC, { ...FORM, website: "http://spam.example" }, CLIENT).body.website, "http://spam.example");
  assert.equal(buildPayload(PIC, { ...FORM, website: undefined }, CLIENT).body.website, "");
});

test("client_id: sent when it fits ^[A-Za-z0-9-]{16,64}$, left out when it does not", () => {
  assert.equal(buildPayload(PIC, FORM, CLIENT).body.client_id, CLIENT);
  for (const bad of [null, undefined, "", "short", "x".repeat(65), "has space in it!!", "under_score_is_not_allowed"]) {
    assert.equal("client_id" in buildPayload(PIC, FORM, bad).body, false, String(bad));
  }
  assert.equal(isClientId("a".repeat(16)), true);
  assert.equal(isClientId("a".repeat(64)), true);
  // A new id fits, with randomUUID and without it.
  assert.equal(isClientId(newClientId()), true);
  assert.equal(isClientId(newClientId({ getRandomValues: (b) => b.fill(171) })), true);
  assert.equal(newClientId({ getRandomValues: (b) => b.fill(171) }), "ab".repeat(16));
});

test("lengths: each limit is allowed exactly, one more is refused with the field named", () => {
  const cases = [
    ["alt", LIMITS.alt, 1000],
    ["long", LIMITS.long, 10000],
    ["note", LIMITS.note, 500],
    ["name", LIMITS.name, 100],
  ];
  for (const [field, limit, expected] of cases) {
    assert.equal(limit, expected, `${field} limit`);
    const ok = buildPayload(PIC, { ...FORM, [field]: "a".repeat(limit) }, CLIENT);
    assert.equal(ok.ok, true, `${field} at ${limit}`);
    const no = buildPayload(PIC, { ...FORM, [field]: "a".repeat(limit + 1) }, CLIENT);
    assert.equal(no.ok, false, `${field} at ${limit + 1}`);
    assert.equal(no.problems[0].field, field);
    assert.match(no.problems[0].message, new RegExp(`${(limit + 1).toLocaleString("en-US")} characters; the limit is ${limit.toLocaleString("en-US")}`));
  }
  const email = `${"a".repeat(188)}@example.org`;
  assert.equal(email.length, 200);
  assert.equal(buildPayload(PIC, { ...FORM, email }, CLIENT).ok, true);
  assert.equal(buildPayload(PIC, { ...FORM, email: `a${email}` }, CLIENT).problems[0].field, "email");
});

test("characters are counted as the intake counts them: code points, after NFKC and cleaning", () => {
  // An emoji is two UTF-16 units but one character.
  assert.equal(buildPayload(PIC, { ...FORM, alt: "😀".repeat(1000) }, CLIENT).ok, true);
  assert.equal(buildPayload(PIC, { ...FORM, alt: "😀".repeat(1001) }, CLIENT).ok, false);
  // Zero-width and bidi characters are removed before counting; a newline stays and counts.
  assert.equal(cleanText("a​b‮c\n d\u0007"), "abc\n d");
  assert.equal(charCount(" a​\nb "), 3);
  // NFKC: a ligature becomes two letters (so the count can grow), full-width becomes ASCII.
  assert.equal(cleanText("ﬁ"), "fi");
  assert.equal(cleanText("ＡＢＣ"), "ABC");
  assert.equal(buildPayload(PIC, { ...FORM, alt: "ﬁ".repeat(501) }, CLIENT).ok, false, "1,002 characters after NFKC");
  // What is sent is the cleaned text.
  assert.equal(buildPayload(PIC, { ...FORM, alt: "  salt​ shaker  " }, CLIENT).body.suggested_alt, "salt shaker");
});

test("at least one of the alt text and the long description is needed", () => {
  const none = buildPayload(PIC, { ...FORM, alt: " ​ ", long: "" }, CLIENT);
  assert.equal(none.ok, false);
  assert.equal(none.problems[0].field, "alt");
  const longOnly = buildPayload(PIC, { ...FORM, alt: "", long: "A map of the five boroughs." }, CLIENT);
  assert.equal(longOnly.ok, true);
  assert.equal(longOnly.body.suggested_alt, "");
});

test("the picture's own facts must fit the contract, or nothing is built", () => {
  const bad = [
    { ...PIC, book: "charter" },
    { ...PIC, sha256: SHA.toUpperCase() },
    { ...PIC, sha256: SHA.slice(1) },
    { ...PIC, picture_ids: [] },
    { ...PIC, picture_ids: Array.from({ length: 21 }, (_, i) => `0-0-0-${i}-img`) },
    { ...PIC, picture_ids: ["has space"] },
    { ...PIC, page_url: "https://www.beta.nyc/boardstat/" },
    { ...PIC, page_url: "https://law.beta.nyc.evil.example/x" },
  ];
  for (const p of bad) assert.equal(buildPayload(p, FORM, CLIENT).ok, false, JSON.stringify(p));
  assert.equal(buildPayload({ ...PIC, picture_ids: Array.from({ length: 20 }, (_, i) => `0-0-0-${i}-img`) }, FORM, CLIENT).ok, true);
});

test("page_url must be https://law.beta.nyc exactly, or followed by /, ? or #, at most 500 characters", () => {
  for (const ok of ["https://law.beta.nyc", "https://law.beta.nyc/", "https://law.beta.nyc?x", "https://law.beta.nyc#a", "https://law.beta.nyc/rules/titles/15/sections/1-01"]) assert.equal(isLawReaderUrl(ok), true, ok);
  for (const no of ["http://law.beta.nyc/", "https://law.beta.nycx/", "https://law.beta.nyc.evil.example/", "https://law.beta.nyc@evil.example/", "https://law.beta.nyc:443/", "https://law.beta.nyc/ a", `https://law.beta.nyc/${"a".repeat(480)}`]) {
    assert.equal(isLawReaderUrl(no), false, no);
  }
});

test("the whole body stays under the intake's 64 KB cap at every limit, in 4-byte characters", () => {
  const big = buildPayload(PIC, { alt: "😀".repeat(1000), long: "😀".repeat(10000), note: "😀".repeat(500), name: "😀".repeat(100), email: "", creditOk: true, website: "" }, CLIENT);
  assert.equal(big.ok, true);
  assert.ok(Buffer.byteLength(JSON.stringify(big.body)) < 65536, `${Buffer.byteLength(JSON.stringify(big.body))} bytes`);
});

// --- The answers ---------------------------------------------------------------------------

test("each answer from the intake gets its own message, and a failure says the text is kept", () => {
  assert.equal(describeResponse(201, { ok: true }).kind, "sent");
  assert.match(describeResponse(201, { ok: true }).message, /^Sent\./);
  assert.equal(describeResponse(201, null).kind, "other", "a 201 without {ok:true} is not taken as sent");
  const bad = describeResponse(400, { ok: false, error: "Invalid suggested_alt." });
  assert.equal(bad.kind, "rejected");
  assert.match(bad.message, /alt text is too long/);
  assert.match(describeResponse(400, { ok: false, error: "Something new." }).message, /Something new\./);
  assert.equal(describeResponse(403, { ok: false, error: "Origin not allowed." }).kind, "origin");
  const rate = describeResponse(429, { ok: false, error: "Too many requests." }, "3600");
  assert.equal(rate.kind, "rate");
  assert.match(rate.message, /Try again in 60 minutes/);
  assert.match(describeResponse(429, null, "30").message, /a minute/);
  assert.match(describeResponse(429, null, null).message, /a while/);
  assert.match(describeResponse(429, null, "86400").message, /24 hours/);
  assert.equal(describeResponse(503, { ok: false, error: "Service unavailable." }).kind, "unavailable");
  assert.equal(describeResponse(0, null).kind, "network");
  assert.equal(describeResponse(500, null).kind, "other");
  for (const [s, d] of [[400, null], [403, null], [429, null], [503, null], [0, null], [500, null]]) {
    assert.match(describeResponse(s, d, "60").message, /^Not sent: .*Your text is still here\.$/, String(s));
  }
});

// --- The inbox build -----------------------------------------------------------------------

let fx, inv, source;
before(async () => {
  fx = makeFixture();
  source = openSource(fx.source);
  inv = buildInventory("rules", source, loadIndex("rules", fx.indexDir));
  const d = await saveDraft(fx.storeDir, "rules", inv.images[0], { draft: { alt: "draft icon </script><!-- $& $1", long: "", unsure: "" }, model: "claude-fable-5-2" });
  await saveReview(fx.storeDir, "rules", inv.images[0], { review: { alt: "the sodium warning icon", long: "", note: "private" }, status: "reviewed", base: d.updated_at });
  await saveDraft(fx.storeDir, "rules", inv.images[1], { draft: { alt: "a map", long: "", unsure: "" }, model: "claude-fable-5-2" });
});

const FAKE = "http://127.0.0.1:9/fake-intake";

test("section links: the page from redirects.json, else the id address the 404 page sends on", () => {
  assert.equal(sectionUrl("rules", "s1", { rules: { s1: "/rules/titles/1/sections/1-01" } }), "https://law.beta.nyc/rules/titles/1/sections/1-01");
  assert.equal(sectionUrl("admin_code", "0-0-0-5", null), "https://law.beta.nyc/admin-code/0-0-0-5");
  assert.equal(sectionUrl("rules", null, null), null);
  assert.equal(sectionUrl("charter-ish", "x", null), null);
});

test("the inbox CSP lets the page connect to the intake's origin only", () => {
  const csp = inboxCsp(ENDPOINT);
  assert.match(csp, /connect-src https:\/\/www\.beta\.nyc;/);
  assert.doesNotMatch(csp, /connect-src[^;]*'self'/);
  assert.match(csp, /default-src 'none'/);
  assert.match(csp, /script-src 'self';/);
  assert.match(csp, /form-action 'none'/);
});

test("the inbox build: CSP, endpoint, data in the page (safe from </script>), links and labels", () => {
  const out = join(mkdtempSync(join(tmpdir(), "alt-inbox-")), "describe-pictures");
  const r = buildStatic({ inventories: [inv], sources: { rules: source }, storeDir: fx.storeDir, outDir: out, includeDrafts: true, mode: "inbox", endpoint: FAKE, redirects: { rules: { s1: "/rules/titles/1/sections/1-01" } } });
  assert.equal(r.items, 3);
  assert.ok(r.bytes > 0);
  for (const f of ["index.html", "app.js", "app.css", "issue-url.js", "inbox-payload.js", "data.json", ".nojekyll"]) assert.ok(existsSync(join(out, f)), f);
  const html = readFileSync(join(out, "index.html"), "utf8");
  assert.match(html, /<meta name="alt-review-mode" content="inbox">/);
  assert.match(html, /<meta name="alt-review-endpoint" content="http:\/\/127\.0\.0\.1:9\/fake-intake">/);
  assert.match(html, /<meta http-equiv="Content-Security-Policy" content="[^"]*connect-src http:\/\/127\.0\.0\.1:9;/);
  assert.match(html, /<meta name="referrer" content="no-referrer">/);
  assert.ok(html.includes(`href="${PRIVACY_URL}"`), "the privacy policy is linked");
  assert.ok(!/\{\{[A-Z_]+\}\}/.test(html), "placeholders filled");
  // The draft's "</script><!--" cannot end the data element: only one closing tag, at its end.
  const m = /<script type="application\/json" id="page-data">([\s\S]*?)<\/script>/.exec(html);
  assert.ok(m, "the data is in the page");
  assert.ok(!m[1].includes("<"), "no raw < inside the data");
  const data = JSON.parse(m[1]);
  assert.equal(data.mode, "inbox");
  assert.equal(data.drafts_included, true);
  const first = data.items.find((i) => i.sha256 === inv.images[0].sha256);
  assert.equal(first.entry.status, "reviewed");
  assert.equal(first.entry.review.alt, "the sodium warning icon");
  assert.equal(first.entry.review.note, undefined, "the reviewer's private note is not published");
  assert.equal(first.entry.draft.alt, "draft icon </script><!-- $& $1", "the text survives, $ patterns included");
  assert.equal(first.uses[0].section_url, "https://law.beta.nyc/rules/titles/1/sections/1-01");
  assert.equal(first.page_url, "https://law.beta.nyc/rules/titles/1/sections/1-01");
  const other = data.items.find((i) => i.uses[0].section_id === "s2");
  assert.equal(other.uses[0].section_url, "https://law.beta.nyc/rules/s2", "no redirect: the id address");
  for (const i of data.items) assert.equal(isLawReaderUrl(i.page_url), true, i.page_url);
  // A body built from the build's data is one the intake takes.
  assert.equal(buildPayload(first, FORM, CLIENT).ok, true);
});

test("without drafts, the inbox build shows only reviewed text; a picture with none falls back to this page's address", () => {
  const out = join(mkdtempSync(join(tmpdir(), "alt-inbox-")), "describe-pictures");
  buildStatic({ inventories: [inv], sources: { rules: source }, storeDir: fx.storeDir, outDir: out, mode: "inbox", endpoint: FAKE });
  const data = JSON.parse(readFileSync(join(out, "data.json"), "utf8"));
  assert.equal(data.drafts_included, false);
  assert.equal(data.items.find((i) => i.sha256 === inv.images[1].sha256).entry, null, "the unreviewed draft is left out");
  assert.equal(data.items.find((i) => i.sha256 === inv.images[0].sha256).entry.draft, null);
  assert.equal(`https://law.beta.nyc${INBOX_PATH}`, "https://law.beta.nyc/describe-pictures/");
});

test("the inbox build refuses an unknown mode and a non-http endpoint", () => {
  const out = join(mkdtempSync(join(tmpdir(), "alt-inbox-")), "x");
  assert.throws(() => buildStatic({ inventories: [inv], sources: { rules: source }, storeDir: fx.storeDir, outDir: out, mode: "email" }), /mode must be one of/);
  assert.throws(() => buildStatic({ inventories: [inv], sources: { rules: source }, storeDir: fx.storeDir, outDir: out, mode: "inbox", endpoint: "javascript:alert(1)" }), /http/);
});

test("the static (GitHub issue) build is unchanged: no CSP meta, no endpoint, data fetched from data.json", () => {
  const out = join(mkdtempSync(join(tmpdir(), "alt-static-")), "site");
  buildStatic({ inventories: [inv], sources: { rules: source }, storeDir: fx.storeDir, outDir: out });
  const html = readFileSync(join(out, "index.html"), "utf8");
  assert.match(html, /content="static"/);
  assert.doesNotMatch(html, /Content-Security-Policy/);
  assert.match(html, /<meta name="alt-review-endpoint" content="">/);
  assert.match(html, /<script type="application\/json" id="page-data"><\/script>/);
});
