// The picture description page (issue #87): the local review server's save endpoint and its
// guards (scripts/lib/alt-text/server.js), the GitHub issue link (issue-url.js) and the static
// build (static-build.js).

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { request } from "node:http";
import { readFileSync, existsSync, mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { openSource } from "../scripts/lib/alt-text/source.js";
import { buildInventory, loadIndex } from "../scripts/lib/alt-text/inventory.js";
import { readStore, saveDraft, storePath } from "../scripts/lib/alt-text/store.js";
import { startReviewServer } from "../scripts/lib/alt-text/server.js";
import { issueUrl, MAX_URL_LENGTH, REPO_ISSUES } from "../scripts/lib/alt-text/issue-url.js";
import { buildStatic } from "../scripts/lib/alt-text/static-build.js";
import { makeFixture } from "./alt-text/fixture.js";

let fx, inv, source, srv;

before(async () => {
  fx = makeFixture();
  source = openSource(fx.source);
  inv = buildInventory("rules", source, loadIndex("rules", fx.indexDir));
  await saveDraft(fx.storeDir, "rules", inv.images[0], { draft: { alt: "draft icon", long: "", unsure: "the color" }, model: "claude-fable-5-2" });
  srv = await startReviewServer({ inventories: [inv], sources: { rules: source }, storeDir: fx.storeDir, port: 0 });
});
after(() => srv?.close());

/** A raw HTTP call, so the Host header can be set by hand. */
function call(path, { method = "GET", headers = {}, body } = {}) {
  const u = new URL(srv.url);
  return new Promise((resolve, reject) => {
    const req = request({ host: "127.0.0.1", port: u.port, path, method, headers: { Host: `127.0.0.1:${u.port}`, ...headers } }, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => {
        const buf = Buffer.concat(chunks);
        const type = res.headers["content-type"] ?? "";
        resolve({ status: res.statusCode, headers: res.headers, body: type.startsWith("application/json") ? JSON.parse(buf.toString()) : buf });
      });
    });
    req.on("error", reject);
    if (body !== undefined) req.write(typeof body === "string" ? body : JSON.stringify(body));
    req.end();
  });
}

const auth = () => ({ "X-Alt-Review-Token": srv.token, "Content-Type": "application/json" });

test("the server listens on 127.0.0.1 only", () => {
  assert.equal(srv.server.address().address, "127.0.0.1");
});

test("the page carries its mode and token, with a strict content security policy", async () => {
  const r = await call("/");
  assert.equal(r.status, 200);
  const html = r.body.toString();
  assert.match(html, /<meta name="alt-review-mode" content="local">/);
  assert.ok(html.includes(srv.token));
  assert.match(r.headers["content-security-policy"], /default-src 'self'/);
  for (const a of ["/app.js", "/app.css", "/issue-url.js"]) assert.equal((await call(a)).status, 200, a);
});

test("a request with another Host is refused (DNS rebinding)", async () => {
  const r = await call("/api/items", { headers: { Host: "evil.example:80", "X-Alt-Review-Token": srv.token } });
  assert.equal(r.status, 403);
});

test("/api calls without the page token are refused", async () => {
  assert.equal((await call("/api/items")).status, 403);
  const r = await call("/api/save", { method: "POST", headers: { "Content-Type": "application/json" }, body: { book: "rules", sha256: inv.images[0].sha256, status: "reviewed", review: { alt: "x" } } });
  assert.equal(r.status, 403);
});

test("the item list has each picture's uses, image link and stored entry", async () => {
  const r = await call("/api/items", { headers: auth() });
  assert.equal(r.status, 200);
  assert.equal(r.body.items.length, 3);
  const icon = r.body.items.find((i) => i.sha256 === inv.images[0].sha256);
  assert.equal(icon.entry.draft.alt, "draft icon");
  assert.equal(icon.uses.length, 2);
  assert.equal(icon.uses[1].inline, true);
  const img = await call(icon.image_url);
  assert.equal(img.status, 200);
  assert.equal(img.headers["content-type"], "image/png");
});

test("a BMP picture is served as PNG", async () => {
  const b = inv.images.find((i) => i.format === "bmp");
  const r = await call(`/image/rules/${b.sha256}`);
  assert.equal(r.headers["content-type"], "image/png");
  assert.equal(r.body.subarray(1, 4).toString(), "PNG");
});

test("Save writes the review to the sidecar on disk, and a stale page gets a conflict", async () => {
  const sha = inv.images[0].sha256;
  const base = readStore(fx.storeDir, "rules").images[sha].updated_at;
  const ok = await call("/api/save", { method: "POST", headers: auth(), body: { book: "rules", sha256: sha, status: "reviewed", base, review: { alt: "  the sodium warning icon ", long: "", note: "checked" } } });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.entry.status, "reviewed");
  const onDisk = JSON.parse(readFileSync(storePath(fx.storeDir, "rules"), "utf8")).images[sha];
  assert.deepEqual(onDisk.review, { alt: "the sodium warning icon", long: "", note: "checked" });
  assert.equal(onDisk.draft.alt, "draft icon", "the AI draft is kept");

  const stale = await call("/api/save", { method: "POST", headers: auth(), body: { book: "rules", sha256: sha, status: "reviewed", base, review: { alt: "older tab" } } });
  assert.equal(stale.status, 409);
  assert.equal(stale.body.current.review.alt, "the sodium warning icon");
  assert.equal(readStore(fx.storeDir, "rules").images[sha].review.alt, "the sodium warning icon");
});

test("Save works for a picture with no draft yet", async () => {
  const sha = inv.images[2].sha256;
  const r = await call("/api/save", { method: "POST", headers: auth(), body: { book: "rules", sha256: sha, status: "needs-work", base: null, review: { alt: "a bar chart", long: "" } } });
  assert.equal(r.status, 200);
  const e = readStore(fx.storeDir, "rules").images[sha];
  assert.equal(e.status, "needs-work");
  assert.equal(e.draft, null);
});

test("Save refuses bad input: unknown picture, bad status, not JSON, wrong content type", async () => {
  const sha = inv.images[1].sha256;
  assert.equal((await call("/api/save", { method: "POST", headers: auth(), body: { book: "rules", sha256: "0".repeat(64), status: "reviewed", review: {} } })).status, 404);
  assert.equal((await call("/api/save", { method: "POST", headers: auth(), body: { book: "rules", sha256: sha, status: "approved", review: {} } })).status, 400);
  assert.equal((await call("/api/save", { method: "POST", headers: auth(), body: "{not json" })).status, 400);
  assert.equal((await call("/api/save", { method: "POST", headers: { "X-Alt-Review-Token": srv.token, "Content-Type": "text/plain" }, body: "{}" })).status, 415);
});

test("saves sent at the same time for different pictures all land", async () => {
  const fx2 = makeFixture();
  const s2 = openSource(fx2.source);
  const inv2 = buildInventory("rules", s2, loadIndex("rules", fx2.indexDir));
  const srv2 = await startReviewServer({ inventories: [inv2], sources: { rules: s2 }, storeDir: fx2.storeDir, port: 0 });
  try {
    const u = new URL(srv2.url);
    const post = (img) =>
      new Promise((resolve, reject) => {
        const req = request({ host: "127.0.0.1", port: u.port, path: "/api/save", method: "POST", headers: { Host: `127.0.0.1:${u.port}`, "Content-Type": "application/json", "X-Alt-Review-Token": srv2.token } }, (res) => {
          res.resume();
          res.on("end", () => resolve(res.statusCode));
        });
        req.on("error", reject);
        req.end(JSON.stringify({ book: "rules", sha256: img.sha256, status: "reviewed", base: null, review: { alt: img.image_ids[0] } }));
      });
    const codes = await Promise.all(inv2.images.map(post));
    assert.deepEqual(codes, [200, 200, 200]);
    assert.equal(Object.keys(readStore(fx2.storeDir, "rules").images).length, 3);
  } finally {
    await srv2.close();
  }
});

// --- GitHub issue link ----------------------------------------------------------------------

const P = { book: "rules", citation: "§ 81.49", heading: "Sodium Warning", picture_ids: ["0-0-0-266-img"], image_ids: ["0-0-0-266"], sha256: "a".repeat(64), currentLabel: "reviewed by BetaNYC" };

test("the issue link opens a new issue in the repo with the picture's facts and both texts", () => {
  const { url, cut } = issueUrl(P, { alt: "the sodium warning icon", long: "" }, { alt: "the sodium warning icon (a salt shaker in a black triangle)", long: "" });
  assert.equal(cut, false);
  assert.ok(url.startsWith(`${REPO_ISSUES}?title=`));
  const q = new URL(url).searchParams;
  assert.equal(q.get("title"), "Picture description: Rules of the City of New York § 81.49 (0-0-0-266)");
  const body = q.get("body");
  for (const s of ["§ 81.49 — Sodium Warning", "0-0-0-266-img", "a".repeat(64), "Current description (reviewed by BetaNYC)", "Alt text: the sodium warning icon", "a salt shaker in a black triangle", "not by American Legal Publishing"]) assert.ok(body.includes(s), s);
});

test("a long suggestion is cut to keep the link under the limit, and says so", () => {
  const long = "Ψ and words, ".repeat(2000);
  const { url, cut } = issueUrl({ ...P, why: "because ".repeat(500) }, { alt: "x", long }, { alt: "y", long });
  assert.equal(cut, true);
  assert.ok(url.length <= MAX_URL_LENGTH, `${url.length}`);
  const body = new URL(url).searchParams.get("body");
  assert.match(body, /cut to fit the link/);
  assert.ok(body.includes("a".repeat(64)), "the facts are never cut");
});

// --- Static build -------------------------------------------------------------------------

test("the static build writes the page, its data and the images, and leaves out unreviewed drafts", async () => {
  const out = join(mkdtempSync(join(tmpdir(), "alt-static-")), "site");
  const r = buildStatic({ inventories: [inv], sources: { rules: source }, storeDir: fx.storeDir, outDir: out });
  assert.equal(r.items, 3);
  for (const f of ["index.html", "app.js", "app.css", "issue-url.js", "data.json", ".nojekyll"]) assert.ok(existsSync(join(out, f)), f);
  const html = readFileSync(join(out, "index.html"), "utf8");
  assert.match(html, /content="static"/);
  assert.ok(!html.includes("{{"), "placeholders filled");
  const data = JSON.parse(readFileSync(join(out, "data.json"), "utf8"));
  for (const item of data.items) assert.ok(existsSync(join(out, item.image_url)), item.image_url);
  assert.ok(data.items.every((i) => !i.image_url.startsWith("/")), "relative links work under a GitHub Pages subpath");
  const bmp = data.items.find((i) => i.image_ids.includes("0-0-0-4"));
  assert.match(bmp.image_url, /\.png$/);
  const reviewed = data.items.find((i) => i.sha256 === inv.images[0].sha256);
  assert.equal(reviewed.entry.review.alt, "the sodium warning icon");
  assert.equal(reviewed.entry.review.note, undefined, "the reviewer's private note is not published");
  assert.equal(reviewed.entry.draft, null, "AI drafts are left out by default");
  const needsWork = data.items.find((i) => i.sha256 === inv.images[2].sha256);
  assert.equal(needsWork.entry, null, "a review not marked reviewed is not published");

  const out2 = join(mkdtempSync(join(tmpdir(), "alt-static-")), "site");
  buildStatic({ inventories: [inv], sources: { rules: source }, storeDir: fx.storeDir, outDir: out2, includeDrafts: true });
  const d2 = JSON.parse(readFileSync(join(out2, "data.json"), "utf8"));
  assert.equal(d2.items.find((i) => i.sha256 === inv.images[0].sha256).entry.draft.alt, "draft icon");
});

test("the static build refuses a folder with other files in it", () => {
  const out = mkdtempSync(join(tmpdir(), "alt-static-"));
  writeFileSync(join(out, "important.txt"), "keep me");
  assert.throws(() => buildStatic({ inventories: [inv], sources: { rules: source }, storeDir: fx.storeDir, outDir: out }), /not empty/);
});

test("a review field over 20,000 characters is refused with a clear message, not cut", async () => {
  const sha = inv.images[1].sha256;
  const r = await call("/api/save", { method: "POST", headers: auth(), body: { book: "rules", sha256: sha, status: "needs-work", base: null, review: { alt: "x", long: "y".repeat(20001) } } });
  assert.equal(r.status, 413);
  assert.match(r.body.error, /long description is 20,001 characters; the limit is 20,000/i);
  assert.equal(readStore(fx.storeDir, "rules").images[sha], undefined, "nothing was written");
});

test("the issue link never splits an emoji or a math letter (no URIError, no broken character)", () => {
  for (const ch of ["😀", "𝑥"]) {
    for (let pad = 0; pad < 8; pad++) {
      const long = "a".repeat(pad) + ch.repeat(3000);
      const { url, cut } = issueUrl(P, { alt: "x", long }, { alt: "y" + "b".repeat(pad), long });
      assert.equal(cut, true);
      assert.ok(url.length <= MAX_URL_LENGTH, `${url.length}`);
      assert.ok(!new URL(url).searchParams.get("body").includes("�"), `pad ${pad}: no broken character`);
    }
  }
  // A lone surrogate (half of a pair, as a pasted fragment can carry) does not throw either.
  assert.doesNotThrow(() => issueUrl(P, { alt: "x" }, { alt: "broken \uD835 half" }));
});
