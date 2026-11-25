// AI drafts of picture descriptions (issue #87): scripts/lib/alt-text/draft.js. No request
// leaves the machine: the SDK's `fetch` option is replaced, and the fake answers with the
// Messages API's documented response shape (id, type "message", role, model, content blocks,
// stop_reason, usage).

import { test } from "node:test";
import assert from "node:assert/strict";
import { openSource } from "../scripts/lib/alt-text/source.js";
import { buildInventory, loadIndex, imageBytes } from "../scripts/lib/alt-text/inventory.js";
import { readStore, saveDraft } from "../scripts/lib/alt-text/store.js";
import * as draftLib from "../scripts/lib/alt-text/draft.js";
import { buildRequest, contextText, pendingJobs, estimate, visualTokens, readResponse, makeClient, runDrafts, DEFAULT_MODEL, FALLBACK_BETA, OUTPUT_SCHEMA, SYSTEM_PROMPT } from "../scripts/lib/alt-text/draft.js";
import { makeFixture } from "./alt-text/fixture.js";

const KEY = "sk-ant-test-0123456789-do-not-print";

function setup() {
  const fx = makeFixture();
  const source = openSource(fx.source);
  const inv = buildInventory("rules", source, loadIndex("rules", fx.indexDir));
  return { fx, source, inv };
}

function message({ text, stop_reason = "end_turn", model = DEFAULT_MODEL, stop_details = null, usage = { input_tokens: 1200, output_tokens: 300 } }) {
  return {
    id: "msg_test",
    type: "message",
    role: "assistant",
    model,
    content: text === undefined ? [] : [{ type: "text", text }],
    stop_reason,
    stop_sequence: null,
    stop_details,
    usage,
  };
}

/** A fake fetch: records requests, answers from `reply(body, n)` → { status, json }. */
function fakeFetch(reply) {
  const calls = [];
  const fn = async (url, init) => {
    const headers = new Headers(init.headers);
    const body = JSON.parse(init.body);
    calls.push({ url: String(url), method: init.method, headers, body });
    const { status = 200, json } = reply(body, calls.length);
    return new Response(JSON.stringify(json), { status, headers: { "content-type": "application/json", "request-id": "req_test" } });
  };
  fn.calls = calls;
  return fn;
}

test("the request has one image block (base64, documented media type) and one text block", () => {
  const { source, inv } = setup();
  const icon = inv.images[0];
  const req = buildRequest({ book: "rules", image: icon, bytes: imageBytes(source, icon) });
  assert.equal(req.model, "claude-fable-5-2");
  assert.equal(req.max_tokens, 16000);
  assert.equal(req.system, SYSTEM_PROMPT);
  assert.equal(req.thinking, undefined, "no thinking field: Fable 5.2 thinks always and rejects a disabled or budgeted config");
  assert.deepEqual(req.output_config, { effort: "high", format: { type: "json_schema", schema: OUTPUT_SCHEMA } });
  assert.equal(req.messages.length, 1);
  const [img, text] = req.messages[0].content;
  assert.equal(img.type, "image");
  assert.deepEqual(Object.keys(img.source), ["type", "media_type", "data"]);
  assert.equal(img.source.type, "base64");
  assert.equal(img.source.media_type, "image/png");
  assert.equal(Buffer.from(img.source.data, "base64").equals(imageBytes(source, icon)), true);
  assert.equal(text.type, "text");
  assert.deepEqual(req.betas, [FALLBACK_BETA]);
  assert.equal(req.fallbacks, "default");
});

test("a BMP is sent as PNG, and fallbacks are left off for models without them or on request", () => {
  const { source, inv } = setup();
  const b = inv.images.find((i) => i.format === "bmp");
  const req = buildRequest({ book: "rules", image: b, bytes: imageBytes(source, b), model: "claude-haiku-5-5" });
  assert.equal(req.messages[0].content[0].source.media_type, "image/png");
  assert.equal(req.betas, undefined);
  assert.equal(req.fallbacks, undefined);
  const off = buildRequest({ book: "rules", image: b, bytes: imageBytes(source, b), fallbacks: false });
  assert.equal(off.fallbacks, undefined);
});

test("an image over the documented size limit is refused before sending", () => {
  const { source, inv } = setup();
  const icon = { ...inv.images[0], width: 9000 };
  assert.throws(() => buildRequest({ book: "rules", image: icon, bytes: imageBytes(source, inv.images[0]) }), /8000 px/);
});

test("the prompt asks for in-sentence alt text, long descriptions, and no invented text", () => {
  assert.match(SYSTEM_PROMPT, /read as part of that sentence/);
  assert.match(SYSTEM_PROMPT, /map, diagram, chart, graph, or a table drawn as a picture/);
  assert.match(SYSTEM_PROMPT, /Never invent text, numbers, or labels you cannot read/);
});

test("the context names each use, its placement and the text around it", () => {
  const { inv } = setup();
  const t = contextText("rules", inv.images[0]);
  assert.match(t, /used 2 times/);
  assert.match(t, /Use 1: § 1-01/);
  assert.match(t, /Placement: on its own line\./);
  assert.match(t, /Placement: inline/);
  assert.match(t, /"Warning: \[this picture\] means the item is salty\."/);
});

test("visual tokens follow the docs' ⌈w/28⌉×⌈h/28⌉, capped by the high-resolution limits", () => {
  assert.equal(visualTokens(1000, 1000), 1296);
  assert.equal(visualTokens(200, 200), 64);
  assert.ok(visualTokens(3840, 2160) <= 4784);
  assert.ok(visualTokens(3302, 4024) <= 4784);
});

test("pendingJobs skips drafted pictures unless forced, and honors limit and only", async () => {
  const { fx, inv } = setup();
  assert.equal(pendingJobs([inv], fx.storeDir).length, 3);
  await saveDraft(fx.storeDir, "rules", inv.images[0], { draft: { alt: "x" }, model: "m" });
  assert.equal(pendingJobs([inv], fx.storeDir).length, 2);
  assert.equal(pendingJobs([inv], fx.storeDir, { force: true }).length, 3);
  assert.equal(pendingJobs([inv], fx.storeDir, { limit: 1 }).length, 1);
  assert.deepEqual(pendingJobs([inv], fx.storeDir, { only: ["0-0-0-3"] }).map((j) => j.image.image_ids), [["0-0-0-2", "0-0-0-3"]]);
});

test("the estimate counts requests and prices known models only", () => {
  const { inv } = setup();
  const jobs = inv.images.map((image) => ({ book: "rules", image }));
  const e = estimate(jobs);
  assert.equal(e.requests, 3);
  assert.ok(e.input > 0 && e.output > 0 && e.dollars > 0);
  assert.equal(estimate(jobs, "some-other-model").dollars, null);
});

test("readResponse takes the JSON answer and reports refusals, cut-offs and bad JSON", () => {
  assert.deepEqual(readResponse(message({ text: JSON.stringify({ alt: " Ψ ", long: "", unsure: "" }) })), { draft: { alt: "Ψ", long: "", unsure: "" } });
  assert.match(readResponse(message({ stop_reason: "refusal", stop_details: { type: "refusal", category: "cyber", explanation: "" } })).error, /refusal, cyber/);
  assert.match(readResponse(message({ text: '{"alt": "cut', stop_reason: "max_tokens" })).error, /max_tokens/);
  assert.match(readResponse(message({ text: "Sure! Here it is." })).error, /not JSON/);
  assert.match(readResponse(message({ text: '{"alt": 3}' })).error, /missing/);
});

test("makeClient needs a key", () => {
  assert.throws(() => makeClient({ apiKey: "" }), /ANTHROPIC_API_KEY is not set/);
});

test("runDrafts posts to /v1/messages with the beta header, stores each draft, and never logs the key", async () => {
  const { fx, source, inv } = setup();
  const fetch = fakeFetch((body) => ({ json: message({ text: JSON.stringify({ alt: `alt for ${body.messages[0].content[0].source.media_type}`, long: "", unsure: "" }) }) }));
  const client = makeClient({ apiKey: KEY, fetch });
  const logs = [];
  const jobs = pendingJobs([inv], fx.storeDir);
  const r = await runDrafts({ jobs, sources: { rules: source }, storeDir: fx.storeDir, client, log: (l) => logs.push(l) });
  assert.equal(r.done, 3);
  assert.deepEqual(r.failed, []);
  assert.deepEqual(r.usage, { input: 3600, output: 900, byModel: { "claude-fable-5-2": { input: 3600, output: 900 } } });
  assert.equal(fetch.calls.length, 3);
  for (const c of fetch.calls) {
    const u = new URL(c.url);
    assert.equal(u.origin + u.pathname, "https://api.anthropic.com/v1/messages");
    assert.equal(c.method, "POST");
    // SDK releases on API version 2026-10-21 send the key as a bearer token (claude-api skill,
    // shared/api-version-migration.md, change 5); that version also forbids temperature,
    // top_p and top_k, which this request never sends.
    assert.equal(c.headers.get("authorization"), `Bearer ${KEY}`);
    assert.equal(c.headers.get("anthropic-version"), "2026-10-21");
    for (const k of ["temperature", "top_p", "top_k"]) assert.equal(c.body[k], undefined);
    assert.match(c.headers.get("anthropic-beta"), /server-side-fallback-2026-07-01/);
    assert.equal(c.body.betas, undefined, "betas travel as a header, not in the body");
    assert.equal(c.body.fallbacks, "default");
    assert.equal(c.body.model, "claude-fable-5-2");
  }
  const s = readStore(fx.storeDir, "rules");
  assert.equal(Object.keys(s.images).length, 3);
  assert.equal(s.images[inv.images[0].sha256].draft.alt, "alt for image/png");
  assert.equal(s.images[inv.images[0].sha256].draft_model, "claude-fable-5-2");
  assert.ok(!logs.join("\n").includes(KEY));
});

test("a refusal stores no text for that picture, and the model that answered is recorded", async () => {
  const { fx, source, inv } = setup();
  const fetch = fakeFetch((_, n) =>
    n === 1
      ? { json: message({ stop_reason: "refusal", stop_details: { type: "refusal", category: null, explanation: "declined" } }) }
      : { json: message({ text: JSON.stringify({ alt: "x", long: "", unsure: "" }), model: "claude-opus-4-8" }) },
  );
  const client = makeClient({ apiKey: KEY, fetch });
  const logs = [];
  const r = await runDrafts({ jobs: pendingJobs([inv], fx.storeDir), sources: { rules: source }, storeDir: fx.storeDir, client, concurrency: 1, log: (l) => logs.push(l) });
  assert.equal(r.done, 2);
  assert.equal(r.failed.length, 1);
  assert.match(r.failed[0].error, /refusal/);
  const s = readStore(fx.storeDir, "rules");
  assert.equal(s.images[inv.images[0].sha256].draft, undefined, "no text is stored for a refusal");
  assert.equal(s.images[inv.images[1].sha256].draft_model, "claude-opus-4-8");
  assert.ok(logs.some((l) => l.includes("answered by claude-opus-4-8")));
});

test("a refused API key stops the run at once and is not printed", async () => {
  const { fx, source, inv } = setup();
  const fetch = fakeFetch(() => ({ status: 401, json: { type: "error", error: { type: "authentication_error", message: "invalid x-api-key" } } }));
  const client = makeClient({ apiKey: KEY, fetch });
  const logs = [];
  const r = await runDrafts({ jobs: pendingJobs([inv], fx.storeDir), sources: { rules: source }, storeDir: fx.storeDir, client, concurrency: 1, log: (l) => logs.push(l) });
  assert.equal(fetch.calls.length, 1, "no retries and no further pictures after a 401");
  assert.equal(r.done, 0);
  assert.match(r.stopped, /API key was refused/);
  assert.ok(!logs.join("\n").includes(KEY));
  assert.deepEqual(readStore(fx.storeDir, "rules").images, {});
});

test("an API error reports the API's own type, message and request id, and never the key", async () => {
  const { fx, source, inv } = setup();
  const fetch = fakeFetch((_, n) =>
    n === 1
      ? { status: 400, json: { type: "error", error: { type: "invalid_request_error", message: `Could not process image (key ${KEY})` }, request_id: "req_test" } }
      : { json: message({ text: JSON.stringify({ alt: "x", long: "", unsure: "" }) }) },
  );
  const client = makeClient({ apiKey: KEY, fetch });
  const logs = [];
  const r = await runDrafts({ jobs: pendingJobs([inv], fx.storeDir), sources: { rules: source }, storeDir: fx.storeDir, client, concurrency: 1, log: (l) => logs.push(l) });
  assert.equal(r.done, 2, "one picture's 400 does not stop the run");
  assert.equal(r.failed.length, 1);
  assert.match(r.failed[0].error, /400 invalid_request_error: Could not process image/);
  assert.match(r.failed[0].error, /request id req_test/);
  assert.ok(!logs.join("\n").includes(KEY), "the key is hidden even when the API's message repeats it");
  assert.match(logs.join("\n"), /\[API key hidden\]/);
});

test("a 404 (wrong model) stops the run at once; the same 400 twice stops it too", async () => {
  for (const [status, type, calls] of [
    [404, "not_found_error", 1],
    [400, "invalid_request_error", 2],
  ]) {
    const { fx, source, inv } = setup();
    const fetch = fakeFetch(() => ({ status, json: { type: "error", error: { type, message: "model: claude-nope" } } }));
    const client = makeClient({ apiKey: KEY, fetch });
    const r = await runDrafts({ jobs: pendingJobs([inv], fx.storeDir), sources: { rules: source }, storeDir: fx.storeDir, client, concurrency: 1, log: () => {} });
    assert.equal(fetch.calls.length, calls, `${status}: ${calls} call(s)`);
    assert.match(r.stopped, new RegExp(`${status} ${type}: model: claude-nope`));
  }
});

test("a refused or cut-off draft is recorded (reason, model, time) and skipped next time unless retried", async () => {
  const { fx, source, inv } = setup();
  const fetch = fakeFetch((_, n) =>
    n === 1
      ? { json: message({ stop_reason: "refusal", model: "claude-opus-4-8", stop_details: { type: "refusal", category: "cyber", explanation: "declined" } }) }
      : n === 2
        ? { json: message({ text: '{"alt": "cut', stop_reason: "max_tokens" }) }
        : { json: message({ text: JSON.stringify({ alt: "x", long: "", unsure: "" }) }) },
  );
  const client = makeClient({ apiKey: KEY, fetch });
  await runDrafts({ jobs: pendingJobs([inv], fx.storeDir), sources: { rules: source }, storeDir: fx.storeDir, client, concurrency: 1, at: "2026-11-25T12:00:00.000Z", log: () => {} });
  const s = readStore(fx.storeDir, "rules");
  const refused = s.images[inv.images[0].sha256];
  assert.deepEqual(refused.draft_failed, { reason: "declined by the model (refusal, cyber)", model: "claude-opus-4-8", at: "2026-11-25T12:00:00.000Z" });
  assert.equal(refused.status, undefined, "a failure is not a status");
  assert.equal(refused.draft, undefined);
  assert.equal(s.images[inv.images[1].sha256].draft_failed.reason, "ran out of output tokens (max_tokens)");
  assert.equal(pendingJobs([inv], fx.storeDir).length, 0, "failed pictures are not paid for again");
  assert.equal(pendingJobs([inv], fx.storeDir, { retryFailed: true }).length, 2);
  // A later successful draft clears the failure.
  const ok = fakeFetch(() => ({ json: message({ text: JSON.stringify({ alt: "y", long: "", unsure: "" }) }) }));
  await runDrafts({ jobs: pendingJobs([inv], fx.storeDir, { retryFailed: true }), sources: { rules: source }, storeDir: fx.storeDir, client: makeClient({ apiKey: KEY, fetch: ok }), log: () => {} });
  const after = readStore(fx.storeDir, "rules").images[inv.images[0].sha256];
  assert.equal(after.draft.alt, "y");
  assert.equal(after.draft_failed, undefined);
  assert.equal(after.status, "drafted");
});

test("spend is counted per model that ran, fallbacks included", async () => {
  const { fx, source, inv } = setup();
  const usage = {
    input_tokens: 1000,
    output_tokens: 300,
    iterations: [
      { type: "message", model: "claude-fable-5-2", input_tokens: 1000, output_tokens: 10, cache_creation: null, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
      { type: "fallback_message", model: "claude-opus-4-8", input_tokens: 1000, output_tokens: 300, cache_creation: null, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
    ],
  };
  const fetch = fakeFetch((_, n) => (n === 1 ? { json: message({ text: JSON.stringify({ alt: "x", long: "", unsure: "" }), model: "claude-opus-4-8", usage }) } : { json: message({ text: JSON.stringify({ alt: "x", long: "", unsure: "" }), model: "claude-opus-4-8" }) }));
  const client = makeClient({ apiKey: KEY, fetch });
  const r = await runDrafts({ jobs: pendingJobs([inv], fx.storeDir).slice(0, 2), sources: { rules: source }, storeDir: fx.storeDir, client, concurrency: 1, log: () => {} });
  assert.deepEqual(r.usage.byModel, { "claude-fable-5-2": { input: 1000, output: 10 }, "claude-opus-4-8": { input: 2200, output: 600 } });
  assert.equal(typeof draftLib.spend, "function");
  // fable 5.2: 8/40 per million; opus 4.8: 5/25 per million.
  assert.equal(draftLib.spend(r.usage).toFixed(6), ((1000 * 8 + 10 * 40 + 2200 * 5 + 600 * 25) / 1e6).toFixed(6));
  assert.equal(draftLib.spend({ byModel: { "claude-unknown": { input: 1, output: 1 } } }), null);
});
