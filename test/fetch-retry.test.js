// The build-time download (scripts/fetch-data.js) through politeFetch (issue #39): a
// User-Agent, a timeout, and a bounded retry on 429 and 5xx that honors Retry-After. A fake
// fetch stands in for the network.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { politeFetch, retryWaitMs, USER_AGENT, MAX_RETRIES } from "../scripts/lib/fetch-retry.js";

const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));

function fakeFetch(statuses, headers = {}) {
  const calls = [];
  const impl = async (url, init) => {
    calls.push(init);
    const status = statuses[Math.min(calls.length - 1, statuses.length - 1)];
    return new Response(status === 200 ? "zip" : "busy", { status, headers });
  };
  return { impl, calls };
}

test("sends a User-Agent with the package name and version, and a timeout signal", async () => {
  const { impl, calls } = fakeFetch([200]);
  const res = await politeFetch("https://example.test/x.zip", { fetchImpl: impl, wait: async () => {} });
  assert.equal(res.status, 200);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].headers["User-Agent"], USER_AGENT);
  assert.match(USER_AGENT, new RegExp(`^nyc-charter-laws-rules/${pkg.version.replace(/\./g, "\\.")} `));
  assert.ok(calls[0].signal instanceof AbortSignal);
});

test("retries 429 and 5xx, honoring Retry-After, then succeeds", async () => {
  const waits = [];
  const { impl, calls } = fakeFetch([503, 429, 200], { "Retry-After": "3" });
  const res = await politeFetch("https://example.test/x.zip", { fetchImpl: impl, wait: async (ms) => waits.push(ms) });
  assert.equal(res.status, 200);
  assert.equal(calls.length, 3);
  assert.deepEqual(waits, [3000, 3000]);
});

test(`gives up after ${MAX_RETRIES} retries and returns the failing response`, async () => {
  const { impl, calls } = fakeFetch([500]);
  const res = await politeFetch("https://example.test/x.zip", { fetchImpl: impl, wait: async () => {} });
  assert.equal(res.status, 500);
  assert.equal(calls.length, MAX_RETRIES + 1);
});

test("does not retry a 404", async () => {
  const { impl, calls } = fakeFetch([404]);
  const res = await politeFetch("https://example.test/x.zip", { fetchImpl: impl, wait: async () => {} });
  assert.equal(res.status, 404);
  assert.equal(calls.length, 1);
});

test("a timeout aborts the request", async () => {
  const hang = (url, init) => new Promise((_, reject) => init.signal.addEventListener("abort", () => reject(init.signal.reason)));
  await assert.rejects(politeFetch("https://example.test/x.zip", { fetchImpl: hang, timeoutMs: 20 }), /TimeoutError|aborted|timed out/i);
});

test("Retry-After: seconds, an HTTP date, garbage, and the 60 s cap", () => {
  const now = Date.parse("2026-11-18T12:00:00Z");
  assert.equal(retryWaitMs("7", 1, now), 7000);
  assert.equal(retryWaitMs("Wed, 18 Nov 2026 12:00:10 GMT", 1, now), 10_000);
  assert.equal(retryWaitMs("soon", 1, now), 5000);
  assert.equal(retryWaitMs(null, 2, now), 10_000);
  assert.equal(retryWaitMs("3600", 1, now), 60_000);
});
