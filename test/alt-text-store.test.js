// The alt-text sidecar files (issue #87): scripts/lib/alt-text/store.js. Key order, sha256
// keying (a changed image loses its text), conflicts, and saves that run at the same time,
// in one process and across two.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, existsSync, readdirSync, mkdtempSync, utimesSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { openSource } from "../scripts/lib/alt-text/source.js";
import { buildInventory, loadIndex } from "../scripts/lib/alt-text/inventory.js";
import { readStore, saveDraft, saveReview, staleEntries, serializeStore, storePath, ConflictError, ABOUT, withStoreLock } from "../scripts/lib/alt-text/store.js";
import { makeFixture, png } from "./alt-text/fixture.js";

const STORE_JS = fileURLToPath(new URL("../scripts/lib/alt-text/store.js", import.meta.url));

function setup() {
  const fx = makeFixture();
  const inv = buildInventory("rules", openSource(fx.source), loadIndex("rules", fx.indexDir));
  return { fx, inv };
}

const fakeImage = (n) => ({ sha256: n.toString(16).padStart(64, "0"), image_ids: [`0-0-0-${n}`], uses: [{ picture_id: `0-0-0-${n}-img`, citation: `§ ${n}` }] });

test("an absent sidecar reads as empty, and says the text is BetaNYC's", () => {
  const dir = mkdtempSync(join(tmpdir(), "alt-store-"));
  const s = readStore(dir, "rules");
  assert.deepEqual(s.images, {});
  assert.equal(s.book, "rules");
  assert.match(ABOUT, /BetaNYC/);
  assert.match(ABOUT, /not part of American Legal Publishing's text/);
});

test("a draft is stored under the image's sha256 with its picture ids and citation", async () => {
  const { fx, inv } = setup();
  const icon = inv.images[0];
  const e = await saveDraft(fx.storeDir, "rules", icon, { draft: { long: "", alt: "the salt icon", unsure: "" }, model: "claude-fable-5-2", at: "2026-11-25T17:00:00.000Z" });
  assert.equal(e.status, "drafted");
  const s = readStore(fx.storeDir, "rules");
  const stored = s.images[icon.sha256];
  assert.deepEqual(stored.image_ids, ["0-0-0-1"]);
  assert.deepEqual(stored.picture_ids, ["0-0-0-1-img"]);
  assert.equal(stored.citation, "§ 1-01");
  assert.deepEqual(stored.draft, { alt: "the salt icon", long: "", unsure: "" });
  assert.equal(stored.draft_model, "claude-fable-5-2");
  assert.equal(stored.drafted_at, "2026-11-25T17:00:00.000Z");
  assert.equal(stored.review, null);
  assert.equal(stored.reviewed_at, null);
});

test("the file has a stable key order and sorted hashes, so diffs stay readable", async () => {
  const { fx, inv } = setup();
  for (const img of [...inv.images].reverse()) await saveDraft(fx.storeDir, "rules", img, { draft: { unsure: "", long: "L", alt: "A" }, model: "m", at: "2026-11-25T17:00:00.000Z" });
  const text = readFileSync(storePath(fx.storeDir, "rules"), "utf8");
  const data = JSON.parse(text);
  assert.deepEqual(Object.keys(data), ["about", "book", "format", "images"]);
  assert.deepEqual(Object.keys(data.images), [...Object.keys(data.images)].sort());
  const first = Object.values(data.images)[0];
  assert.deepEqual(Object.keys(first), ["image_ids", "picture_ids", "citation", "citations", "status", "draft", "draft_model", "drafted_at", "review", "reviewed_at", "updated_at"]);
  assert.deepEqual(Object.keys(first.draft), ["alt", "long", "unsure"]);
  assert.ok(text.endsWith("}\n"));
  assert.equal(serializeStore(data), text, "re-serializing changes nothing");
});

test("a review keeps the draft, sets the status, and a later draft does not undo the review", async () => {
  const { fx, inv } = setup();
  const icon = inv.images[0];
  const d = await saveDraft(fx.storeDir, "rules", icon, { draft: { alt: "draft alt", long: "", unsure: "" }, model: "m" });
  const r = await saveReview(fx.storeDir, "rules", icon, { review: { alt: "the sodium warning icon", long: "" }, status: "reviewed", base: d.updated_at });
  assert.equal(r.status, "reviewed");
  assert.equal(r.draft.alt, "draft alt");
  assert.equal(r.review.alt, "the sodium warning icon");
  assert.ok(r.reviewed_at);
  const again = await saveDraft(fx.storeDir, "rules", icon, { draft: { alt: "new draft", long: "", unsure: "" }, model: "m2" });
  assert.equal(again.status, "reviewed");
  assert.equal(again.review.alt, "the sodium warning icon");
  assert.equal(again.draft.alt, "new draft");
});

test("a review from a stale page is refused as a conflict, not written over", async () => {
  const { fx, inv } = setup();
  const icon = inv.images[0];
  const d = await saveDraft(fx.storeDir, "rules", icon, { draft: { alt: "a", long: "", unsure: "" }, model: "m" });
  await saveReview(fx.storeDir, "rules", icon, { review: { alt: "first", long: "" }, status: "reviewed", base: d.updated_at });
  await assert.rejects(
    saveReview(fx.storeDir, "rules", icon, { review: { alt: "second", long: "" }, status: "reviewed", base: d.updated_at }),
    (e) => e instanceof ConflictError && e.current.review.alt === "first",
  );
  // A page that saw no entry cannot create one over an entry made since.
  await assert.rejects(saveReview(fx.storeDir, "rules", icon, { review: { alt: "x", long: "" }, status: "reviewed", base: null }), ConflictError);
  // A base for an entry that does not exist is a conflict too.
  await assert.rejects(saveReview(fx.storeDir, "rules", inv.images[1], { review: { alt: "x", long: "" }, status: "reviewed", base: "2026-01-01T00:00:00.000Z" }), ConflictError);
  assert.equal(readStore(fx.storeDir, "rules").images[icon.sha256].review.alt, "first");
});

test("a review with an unknown status is refused", async () => {
  const { fx, inv } = setup();
  await assert.rejects(saveReview(fx.storeDir, "rules", inv.images[0], { review: { alt: "x" }, status: "approved", base: null }), /status must be one of/);
});

test("two changes in the same millisecond get different versions", async () => {
  const { fx, inv } = setup();
  const icon = inv.images[0];
  const at = "2026-11-25T17:00:00.000Z";
  const a = await saveDraft(fx.storeDir, "rules", icon, { draft: { alt: "a" }, model: "m", at });
  const b = await saveReview(fx.storeDir, "rules", icon, { review: { alt: "b" }, status: "reviewed", base: a.updated_at, at });
  assert.notEqual(b.updated_at, a.updated_at);
  await assert.rejects(saveReview(fx.storeDir, "rules", icon, { review: { alt: "c" }, status: "reviewed", base: a.updated_at, at }), ConflictError);
});

test("a changed image (new sha256) has no text, and its old entry is reported stale", async () => {
  const { fx, inv } = setup();
  await saveDraft(fx.storeDir, "rules", inv.images[0], { draft: { alt: "old icon" }, model: "m" });
  // American Legal replaces the icon file with different bytes under the same name.
  writeFileSync(join(fx.source, "IMAGES", "0-0-0-1.png"), png(4, 3, [0, 0, 255]));
  const next = buildInventory("rules", openSource(fx.source), loadIndex("rules", fx.indexDir));
  const icon = next.images.find((i) => i.image_ids.includes("0-0-0-1"));
  assert.notEqual(icon.sha256, inv.images[0].sha256);
  const s = readStore(fx.storeDir, "rules");
  assert.equal(s.images[icon.sha256], undefined, "the new image starts with no description");
  const stale = staleEntries(s, next);
  assert.equal(stale.length, 1);
  assert.deepEqual(stale[0].image_ids, ["0-0-0-1"]);
});

test("saves running at the same time in one process all land", async () => {
  const dir = mkdtempSync(join(tmpdir(), "alt-store-"));
  await Promise.all(Array.from({ length: 30 }, (_, i) => saveDraft(dir, "rules", fakeImage(i + 1), { draft: { alt: `alt ${i + 1}` }, model: "m" })));
  const s = readStore(dir, "rules");
  assert.equal(Object.keys(s.images).length, 30);
  assert.ok(!readdirSync(dir).some((n) => n.includes(".tmp-") || n.endsWith(".lock")), "no temp or lock files left");
});

test("saves from two processes at the same time all land (the lock file works)", async () => {
  const dir = mkdtempSync(join(tmpdir(), "alt-store-"));
  const worker = (start) =>
    new Promise((resolve, reject) => {
      const code = `
        const { saveDraft } = await import(${JSON.stringify(STORE_JS)});
        const img = (n) => ({ sha256: n.toString(16).padStart(64, "0"), image_ids: ["0-0-0-" + n], uses: [] });
        await Promise.all(Array.from({ length: 25 }, (_, i) => saveDraft(${JSON.stringify(dir)}, "rules", img(${start} + i), { draft: { alt: "x" }, model: "m" })));
      `;
      const p = spawn(process.execPath, ["--input-type=module", "-e", code], { stdio: ["ignore", "ignore", "pipe"] });
      let err = "";
      p.stderr.on("data", (d) => (err += d));
      p.on("exit", (c) => (c === 0 ? resolve() : reject(new Error(err))));
    });
  await Promise.all([worker(1), worker(1001)]);
  assert.equal(Object.keys(readStore(dir, "rules").images).length, 50);
});

test("a lock left by a dead process is taken over after it goes stale", async () => {
  const dir = mkdtempSync(join(tmpdir(), "alt-store-"));
  const lock = `${storePath(dir, "rules")}.lock`;
  writeFileSync(lock, "");
  const old = new Date(Date.now() - 60_000);
  utimesSync(lock, old, old);
  await saveDraft(dir, "rules", fakeImage(7), { draft: { alt: "x" }, model: "m" });
  assert.ok(existsSync(storePath(dir, "rules")));
  assert.ok(!existsSync(lock));
});

test("a failed change leaves the file as it was and frees the lock", async () => {
  const dir = mkdtempSync(join(tmpdir(), "alt-store-"));
  await saveDraft(dir, "rules", fakeImage(1), { draft: { alt: "x" }, model: "m" });
  const before = readFileSync(storePath(dir, "rules"), "utf8");
  await assert.rejects(
    withStoreLock(dir, "rules", () => {
      throw new Error("boom");
    }),
    /boom/,
  );
  assert.equal(readFileSync(storePath(dir, "rules"), "utf8"), before);
  await saveDraft(dir, "rules", fakeImage(2), { draft: { alt: "y" }, model: "m" });
  assert.equal(Object.keys(readStore(dir, "rules").images).length, 2);
});

test("two waiters that both saw a stale lock cannot both take it: a fresh lock is never deleted", async () => {
  const store = await import("../scripts/lib/alt-text/store.js");
  assert.equal(typeof store._acquireLockFile, "function", "the lock takeover is testable");
  const dir = mkdtempSync(join(tmpdir(), "alt-store-"));
  const lock = `${storePath(dir, "rules")}.lock`;
  writeFileSync(lock, "dead");
  const old = new Date(Date.now() - 60_000);
  utimesSync(lock, old, old);
  // Between this waiter seeing the stale lock and acting on it, another waiter takes the lock
  // over and now holds a fresh one.
  const hook = () => writeFileSync(lock, "holder A");
  await assert.rejects(store._acquireLockFile(lock, { waitMs: 300, afterStaleSeen: hook }), /Timed out/);
  assert.equal(readFileSync(lock, "utf8"), "holder A", "the other waiter's fresh lock is still there");
});
