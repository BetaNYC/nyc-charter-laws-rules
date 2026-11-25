// Polite HTTP for the build-time download (scripts/fetch-data.js, issue #39). The server
// itself makes no network calls: it answers from the bundled index.
//
// - A User-Agent naming this package and its version.
// - A timeout on each attempt. DEFAULT_TIMEOUT_MS is longer than the usual 15 to 30 s on
//   purpose: each attempt includes streaming a bulk ZIP of several megabytes.
// - Up to MAX_RETRIES retries on 429 and 5xx, honoring Retry-After (delay-seconds or an
//   HTTP-date, RFC 9110 § 10.2.3), else 5 s then 10 s; every wait capped at 60 s.
//   No other retries, and nothing runs in the background.
// - `redirect` is passed to fetch as given. fetch-data asks for "manual" and checks each hop
//   itself (scripts/lib/fetch-zip.js, issue #55), so a redirect can never take the download
//   off https or to another host.

import { readFileSync } from "node:fs";

const pkg = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8"));
export const USER_AGENT = `nyc-charter-laws-rules/${pkg.version} (+https://github.com/BetaNYC/nyc-charter-laws-rules)`;
export const DEFAULT_TIMEOUT_MS = 120_000;
export const MAX_RETRIES = 2;
const MAX_WAIT_MS = 60_000;

export function retryWaitMs(retryAfter, attempt, now = Date.now()) {
  const backoff = Math.min(5000 * 2 ** (attempt - 1), MAX_WAIT_MS);
  const v = retryAfter?.trim();
  if (!v) return backoff;
  if (/^\d+$/.test(v)) return Math.min(Number(v) * 1000, MAX_WAIT_MS);
  const at = Date.parse(v);
  return Number.isFinite(at) ? Math.min(Math.max(at - now, 0), MAX_WAIT_MS) : backoff;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** fetch(url) with the rules above. Returns the last response (ok or not); a timeout or
 * network error throws. `fetchImpl` and `wait` are for tests. */
export async function politeFetch(
  url,
  { fetchImpl = fetch, timeoutMs = DEFAULT_TIMEOUT_MS, wait = sleep, redirect = "follow" } = {}
) {
  for (let attempt = 0; ; attempt++) {
    const res = await fetchImpl(url, {
      headers: { "User-Agent": USER_AGENT },
      signal: AbortSignal.timeout(timeoutMs),
      redirect,
    });
    const retryable = res.status === 429 || res.status >= 500;
    if (!retryable || attempt >= MAX_RETRIES) return res;
    await res.body?.cancel();
    await wait(retryWaitMs(res.headers.get("retry-after"), attempt + 1));
  }
}
