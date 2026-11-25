// The alt-text sidecar files (issue #87): data/alt-text/<book>.json, one per book, keyed by
// the image's sha256. If American Legal replaces an image, its new bytes have a new sha256,
// so the old text no longer matches it: lookups by the new hash find nothing, and the
// inventory reports the old entry as stale. The text here is written by BetaNYC (an AI draft,
// then a person's review), not by American Legal Publishing.
//
// Writes are safe against each other: every change re-reads the file under a lock (an
// in-process queue plus a lock file beside the sidecar, so the review server and a draft run
// in another terminal do not overwrite each other), changes one entry, and replaces the file
// in one rename. A save from the review page names the entry's `updated_at` it started from;
// if the entry changed since, the save is refused (a conflict) instead of overwriting it.

import { existsSync, readFileSync, writeFileSync, renameSync, openSync, closeSync, statSync, unlinkSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { randomBytes } from "node:crypto";

export const STORE_FORMAT = 1;
export const STATUSES = ["drafted", "needs-work", "reviewed"];
export const ABOUT =
  "Image descriptions written for BetaNYC: AI drafts, then a person's review. They are not part of American Legal Publishing's text, and not an official record. Keyed by the image file's sha256, so a replaced image loses its description until it is reviewed again.";

const ENTRY_KEYS = [
  "image_ids",
  "picture_ids",
  "citation",
  "citations",
  "status",
  "draft",
  "draft_model",
  "drafted_at",
  "draft_failed",
  "review",
  "reviewed_at",
  "updated_at",
];
const TEXT_KEYS = ["alt", "long", "unsure", "note"];

export class ConflictError extends Error {
  constructor(current) {
    super("This description changed since the page loaded it.");
    this.current = current;
  }
}

export function storePath(dir, book) {
  return join(dir, `${book}.json`);
}

function emptyStore(book) {
  return { about: ABOUT, book, format: STORE_FORMAT, images: {} };
}

/** Read a book's sidecar; an absent file reads as empty. */
export function readStore(dir, book) {
  const file = storePath(dir, book);
  if (!existsSync(file)) return emptyStore(book);
  const data = JSON.parse(readFileSync(file, "utf8"));
  if (data.book !== book) throw new Error(`${file} is for ${data.book}, not ${book}`);
  data.images ??= {};
  return data;
}

function orderText(t) {
  if (t == null) return null;
  const out = {};
  for (const k of TEXT_KEYS) if (t[k] !== undefined) out[k] = t[k];
  for (const k of Object.keys(t).sort()) if (!(k in out)) out[k] = t[k];
  return out;
}

function orderEntry(e) {
  const out = {};
  for (const k of ENTRY_KEYS) {
    if (e[k] === undefined) continue;
    out[k] = k === "draft" || k === "review" ? orderText(e[k]) : e[k];
  }
  for (const k of Object.keys(e).sort()) if (!(k in out)) out[k] = e[k];
  return out;
}

/** The file's text: fixed key order, hashes sorted, two-space indent, final newline. */
export function serializeStore(data) {
  const images = {};
  for (const sha of Object.keys(data.images).sort()) images[sha] = orderEntry(data.images[sha]);
  return `${JSON.stringify({ about: ABOUT, book: data.book, format: STORE_FORMAT, images }, null, 2)}\n`;
}

// --- Locking ------------------------------------------------------------------------------

const queues = new Map();
const LOCK_STALE_MS = 30_000;
const LOCK_WAIT_MS = 15_000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// A lock older than LOCK_STALE_MS was left by a process that died mid-write and may be taken
// over. Two waiters can both see the same stale lock; if both deleted it, the slower one could
// delete the faster one's fresh lock. So a takeover happens only while holding a second,
// short-lived lock (`<lock>.takeover`), and the lock is checked again under it: a fresh lock
// is never deleted. The takeover lock is held for two file calls; it is cleared only if a
// crash inside that window left it behind for LOCK_STALE_MS.
function tryCreate(path) {
  try {
    closeSync(openSync(path, "wx"));
    return true;
  } catch (e) {
    if (e.code !== "EEXIST") throw e;
    return false;
  }
}

function ageMs(path) {
  try {
    return Date.now() - statSync(path).mtimeMs;
  } catch (e) {
    if (e.code === "ENOENT") return null;
    throw e;
  }
}

function unlinkIfThere(path) {
  try {
    unlinkSync(path);
  } catch (e) {
    if (e.code !== "ENOENT") throw e;
  }
}

function takeOverStale(lock, staleMs) {
  const takeover = `${lock}.takeover`;
  if (!tryCreate(takeover)) {
    const age = ageMs(takeover);
    if (age !== null && age > staleMs) unlinkIfThere(takeover);
    return;
  }
  try {
    const age = ageMs(lock);
    if (age !== null && age > staleMs) unlinkIfThere(lock);
  } finally {
    unlinkIfThere(takeover);
  }
}

/** Create the lock file, waiting for it. Options are for tests. */
export async function _acquireLockFile(lock, { waitMs = LOCK_WAIT_MS, staleMs = LOCK_STALE_MS, afterStaleSeen } = {}) {
  const start = Date.now();
  for (;;) {
    if (tryCreate(lock)) return;
    const age = ageMs(lock);
    if (age === null) continue; // released between the open and the stat
    if (age > staleMs) {
      afterStaleSeen?.();
      takeOverStale(lock, staleMs);
      continue;
    }
    if (Date.now() - start > waitMs) throw new Error(`Timed out waiting for ${lock}`);
    await sleep(25 + Math.random() * 50);
  }
}

/** Run fn while holding the book's lock (in this process and across processes). */
export function withStoreLock(dir, book, fn) {
  const file = storePath(dir, book);
  const prev = queues.get(file) ?? Promise.resolve();
  const run = prev.then(async () => {
    mkdirSync(dirname(file), { recursive: true });
    const lock = `${file}.lock`;
    await _acquireLockFile(lock);
    try {
      return await fn();
    } finally {
      try {
        unlinkSync(lock);
      } catch {}
    }
  });
  queues.set(
    file,
    run.catch(() => {}),
  );
  return run;
}

function writeAtomic(file, text) {
  const tmp = `${file}.tmp-${process.pid}-${randomBytes(4).toString("hex")}`;
  writeFileSync(tmp, text);
  renameSync(tmp, file);
}

/**
 * Change one entry under the lock: re-read the file, call change(entry or undefined) and store
 * what it returns (undefined leaves the file alone). Returns the stored entry.
 */
export async function updateEntry(dir, book, sha, change) {
  return withStoreLock(dir, book, () => {
    const data = readStore(dir, book);
    const next = change(data.images[sha] ? structuredClone(data.images[sha]) : undefined);
    if (next === undefined) return data.images[sha];
    data.images[sha] = next;
    writeAtomic(storePath(dir, book), serializeStore(data));
    return orderEntry(next);
  });
}

function identity(image) {
  const uses = image.uses ?? [];
  const citations = [...new Set(uses.map((u) => u.citation).filter(Boolean))];
  return {
    image_ids: [...image.image_ids],
    picture_ids: [...new Set(uses.map((u) => u.picture_id))].sort(),
    citation: citations[0] ?? "",
    citations,
  };
}

const now = () => new Date().toISOString();

// updated_at is the entry's version for conflict checks, so two changes must never share
// one: a change in the same millisecond as the last one is stamped a millisecond later.
function nextStamp(prev, at) {
  if (prev && at <= prev) return new Date(Date.parse(prev) + 1).toISOString();
  return at;
}

/** Store an AI draft for an inventory image. Leaves a person's review and status alone. */
export function saveDraft(dir, book, image, { draft, model, at = now() }) {
  return updateEntry(dir, book, image.sha256, (e) => {
    const stamp = nextStamp(e?.updated_at, at);
    return {
      ...e,
      ...identity(image),
      status: e?.status && e.status !== "drafted" ? e.status : "drafted",
      draft: orderText(draft),
      draft_model: model,
      drafted_at: stamp,
      draft_failed: undefined,
      review: e?.review ?? null,
      reviewed_at: e?.reviewed_at ?? null,
      updated_at: stamp,
    };
  });
}

/**
 * Record that a draft failed (a refusal, or an answer cut off or not usable), so the next run
 * does not pay for the same picture again unless asked to retry. No text is stored, and the
 * entry's status, draft and review are left alone.
 */
export function saveDraftFailure(dir, book, image, { reason, model, at = now() }) {
  return updateEntry(dir, book, image.sha256, (e) => {
    const stamp = nextStamp(e?.updated_at, at);
    return { ...e, ...identity(image), draft_failed: { reason, model, at }, updated_at: stamp };
  });
}

/**
 * Store a person's review. `base` is the entry's updated_at when the page loaded it (null for
 * a picture with no entry yet); a different value on disk is a conflict.
 */
export async function saveReview(dir, book, image, { review, status, base, at = now() }) {
  if (!STATUSES.includes(status)) throw new Error(`status must be one of ${STATUSES.join(", ")}`);
  let conflicted = false;
  let current = null;
  const out = await updateEntry(dir, book, image.sha256, (e) => {
    const onDisk = e?.updated_at ?? null;
    if ((base ?? null) !== onDisk) {
      conflicted = true;
      current = e ? orderEntry(e) : null;
      return undefined;
    }
    const stamp = nextStamp(onDisk, at);
    return {
      ...e,
      ...identity(image),
      status,
      draft: e?.draft ?? null,
      draft_model: e?.draft_model ?? null,
      drafted_at: e?.drafted_at ?? null,
      review: orderText(review),
      reviewed_at: stamp,
      updated_at: stamp,
    };
  });
  if (conflicted) throw new ConflictError(current);
  return out;
}

/** Entries whose sha256 matches no image in the inventory (the image changed or went away). */
export function staleEntries(data, inventory) {
  const live = new Set(inventory.images.map((i) => i.sha256));
  return Object.entries(data.images)
    .filter(([sha]) => !live.has(sha))
    .map(([sha, e]) => ({ sha256: sha, ...e }));
}
