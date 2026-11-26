// The committed pictures for the Law Reader's picture description page (issue #87):
// npm run alt:images (scripts/lib/alt-text/pictures.js) and the page build-site makes from them
// at /describe-pictures/. Uses the made-up American Legal source in test/alt-text/fixture.js and
// the three-book site fixture. Nothing here reads data/raw/ or touches the network.

import { test } from "node:test";
import assert from "node:assert/strict";
import { cpSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { makeFixture, INDEX } from "./alt-text/fixture.js";
import { openSource } from "../scripts/lib/alt-text/source.js";
import { buildInventory, loadIndex } from "../scripts/lib/alt-text/inventory.js";
import { sha256, sniffFormat } from "../scripts/lib/alt-text/image-info.js";
import { writePictures, loadPictures } from "../scripts/lib/alt-text/pictures.js";
import { saveDraft, saveReview } from "../scripts/lib/alt-text/store.js";
import { ENDPOINT } from "../scripts/lib/alt-text/inbox-payload.js";
import { buildThreeBookFixtureSite, ROOT } from "./site/fixture-site.mjs";

/** The alt-text fixture as both books (the same XML and images), with their inventories. */
function twoBooks() {
  const fx = makeFixture();
  writeFileSync(join(fx.indexDir, "admin_code.json"), JSON.stringify(INDEX.map((r) => ({ ...r, corpus: "admin_code" }))));
  const sources = { admin_code: openSource(fx.source), rules: openSource(fx.source) };
  const inventories = ["admin_code", "rules"].map((b) => buildInventory(b, sources[b], loadIndex(b, fx.indexDir)));
  return { fx, sources, inventories };
}

const listing = (dir) => readdirSync(join(dir, "images")).sort();

test("alt:images writes each distinct picture once, named by its sha256, a BMP as PNG, and an inventory per book", () => {
  const { fx, sources, inventories } = twoBooks();
  const out = join(fx.root, "pictures");
  const r = writePictures({ inventories, sources, outDir: out });
  // The fixture has 3 distinct images used (0-0-0-2 and 0-0-0-3 are the same bytes); 0-0-0-7 is
  // used by no tag and 0-0-0-9 is missing. The two books share their files.
  assert.equal(r.files, 3);
  assert.deepEqual(r.books.rules, { images: 3, tags: 6, missing: 1 });
  const inv = inventories.find((i) => i.book === "rules");
  const bmp = inv.images.find((i) => i.image_ids.includes("0-0-0-4"));
  const files = listing(out);
  assert.deepEqual(files, inv.images.map((i) => `${i.sha256}.${i === bmp ? "png" : i.format === "jpeg" ? "jpg" : i.format}`).sort());
  for (const i of inv.images.filter((x) => x !== bmp)) {
    assert.equal(sha256(readFileSync(join(out, "images", `${i.sha256}.${i.format}`))), i.sha256, "stored unchanged");
  }
  const bmpFile = readFileSync(join(out, "images", `${bmp.sha256}.png`));
  assert.equal(sniffFormat(bmpFile), "png", "the BMP is stored as PNG");

  const m = JSON.parse(readFileSync(join(out, "rules.json"), "utf8"));
  assert.equal(m.book, "rules");
  assert.equal(m.format, 1);
  assert.equal(m.tags, 6);
  const mb = m.images.find((i) => i.sha256 === bmp.sha256);
  assert.deepEqual(mb.shown, { file: `${bmp.sha256}.png`, sha256: sha256(bmpFile), bytes: bmpFile.length, converted_from: "bmp" });
  assert.equal(mb.format, "bmp", "the inventory still says what the publisher's file is");
  assert.deepEqual(m.missing, [{ picture_id: "0-0-0-9-img", image_id: "0-0-0-9", citation: "§ 1-02", section_id: "s2" }]);
  // The text around each use is there for the page; no image bytes are.
  assert.ok(m.images[0].uses[0].paragraph);
  assert.doesNotMatch(readFileSync(join(out, "rules.json"), "utf8"), /"data"|base64/);
  rmSync(fx.root, { recursive: true, force: true });
});

test("alt:images is idempotent and removes only pictures it wrote that are no longer used", () => {
  const { fx, sources, inventories } = twoBooks();
  const out = join(fx.root, "pictures");
  writePictures({ inventories, sources, outDir: out });
  const before = Object.fromEntries(["admin_code.json", "rules.json"].map((f) => [f, readFileSync(join(out, f), "utf8")]));
  const again = writePictures({ inventories, sources, outDir: out });
  assert.deepEqual([again.written, again.kept, again.removed], [0, 3, 0]);
  for (const [f, text] of Object.entries(before)) assert.equal(readFileSync(join(out, f), "utf8"), text, `${f} is byte-identical`);

  const stale = `${"a".repeat(64)}.jpg`;
  writeFileSync(join(out, "images", stale), "old");
  writeFileSync(join(out, "images", "notes.txt"), "a person's file");
  writeFileSync(join(out, "README.md"), "kept");
  // A stored file that was changed by hand is written again.
  const one = listing(out).find((f) => f.endsWith(".gif"));
  writeFileSync(join(out, "images", one), "changed");
  const r = writePictures({ inventories, sources, outDir: out });
  assert.deepEqual([r.written, r.removed], [1, 1]);
  assert.ok(!existsSync(join(out, "images", stale)), "an unused picture is removed");
  assert.ok(existsSync(join(out, "images", "notes.txt")) && existsSync(join(out, "README.md")), "other files are left alone");
  rmSync(fx.root, { recursive: true, force: true });
});

test("alt:images reads every picture before writing any: one it cannot read leaves the folder as it was", () => {
  const { fx, sources, inventories } = twoBooks();
  const out = join(fx.root, "pictures");
  writePictures({ inventories, sources, outDir: out });
  const snapshot = () => [...listing(out), readFileSync(join(out, "rules.json"), "utf8")];
  const before = snapshot();
  // A picture whose bytes are no image format: displayable throws.
  const broken = { ...sources.rules, imageFile: (id) => (id === "0-0-0-2" ? { name: "IMAGES/0-0-0-2.gif", bytes: Buffer.from("not an image at all") } : sources.rules.imageFile(id)) };
  const inv2 = inventories.map((i) => (i.book === "rules" ? { ...i, images: i.images.map((x) => (x.image_ids.includes("0-0-0-2") ? { ...x, sha256: "f".repeat(64) } : x)) } : i));
  assert.throws(() => writePictures({ inventories: inv2, sources: { ...sources, rules: broken }, outDir: out }), /unknown image format/);
  assert.deepEqual(snapshot(), before);
  rmSync(fx.root, { recursive: true, force: true });
});

test("loadPictures checks every stored picture, and says how to make them when one is missing or changed", () => {
  const { fx, sources, inventories } = twoBooks();
  const out = join(fx.root, "pictures");
  writePictures({ inventories, sources, outDir: out });
  const ok = loadPictures(out, ["admin_code", "rules"]);
  assert.equal(ok.inventories.length, 2);
  assert.equal(ok.files, 3);
  const first = ok.inventories[1].images[0];
  assert.equal(ok.fileFor(first), join(out, "images", first.shown.file));

  assert.throws(() => loadPictures(join(fx.root, "nowhere"), ["rules"]), /picture inventory .*rules\.json is missing\. Run npm run alt:images/);
  const victim = join(out, "images", first.shown.file);
  const bytes = readFileSync(victim);
  writeFileSync(victim, Buffer.concat([bytes, Buffer.from("x")]));
  assert.throws(() => loadPictures(out, ["rules"]), /does not match the sha256 in .*rules\.json\. Run npm run alt:images/);
  rmSync(victim);
  assert.throws(() => loadPictures(out, ["rules"]), new RegExp(`the picture ${first.shown.file} \\(${first.image_ids[0]}\\) is not in .*Run npm run alt:images`));
  rmSync(fx.root, { recursive: true, force: true });
});

test("npm run alt:images: the command reads both books from their zips or folders, and refuses --book", () => {
  const { fx } = twoBooks();
  const out = join(fx.root, "pictures");
  const run = (...args) => spawnSync(process.execPath, [join(ROOT, "scripts", "alt-text.js"), "images", "--admin-code", fx.source, "--rules", fx.source, "--index-dir", fx.indexDir, "--out", out, ...args], { encoding: "utf8" });
  const r = run();
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /rules: 6 picture tags, 3 distinct images, 1 tag\(s\) with no image file in the zip/);
  assert.match(r.stdout, /3 pictures, .* MB; wrote 3, already there 0, removed 0/);
  assert.match(run().stdout, /wrote 0, already there 3/);
  const b = run("--book", "rules");
  assert.equal(b.status, 1);
  assert.match(b.stderr, /--book is not used here/);
  // With no source at all it stops before writing anything.
  const none = spawnSync(process.execPath, [join(ROOT, "scripts", "alt-text.js"), "images", "--admin-code", join(fx.root, "no.zip"), "--index-dir", fx.indexDir, "--out", join(fx.root, "p2")], { encoding: "utf8" });
  assert.equal(none.status, 1);
  assert.match(none.stderr, /No source for admin_code/);
  assert.ok(!existsSync(join(fx.root, "p2")));
  rmSync(fx.root, { recursive: true, force: true });
});

/** A three-book fixture site whose picture page reads the alt-text fixture's pictures. */
async function siteWithPictures({ store = async () => {}, search = false, books, mutate } = {}) {
  const { fx, sources, inventories } = twoBooks();
  const picturesDir = join(fx.root, "pictures");
  writePictures({ inventories, sources, outDir: picturesDir });
  await store(fx, inventories);
  mutate?.(picturesDir);
  const site = await buildThreeBookFixtureSite({ search, ...(books ? { books } : {}), options: { picturesDir, altTextDir: fx.storeDir } });
  return { site, fx, inventories, picturesDir };
}

const pageData = (outDir) => JSON.parse(/<script type="application\/json" id="page-data">([\s\S]*?)<\/script>/.exec(readFileSync(join(outDir, "describe-pictures", "index.html"), "utf8"))[1]);

test("build-site makes /describe-pictures/ in inbox mode from the committed pictures, with no AI drafts", async () => {
  const { site, fx, inventories } = await siteWithPictures({
    store: async (fx, invs) => {
      const rules = invs.find((i) => i.book === "rules");
      const d = await saveDraft(fx.storeDir, "rules", rules.images[0], { draft: { alt: "SECRET AI DRAFT", long: "", unsure: "" }, model: "claude-fable-5-2" });
      await saveReview(fx.storeDir, "rules", rules.images[0], { review: { alt: "the sodium warning icon", long: "" }, status: "reviewed", base: d.updated_at });
      await saveDraft(fx.storeDir, "rules", rules.images[1], { draft: { alt: "ANOTHER AI DRAFT", long: "", unsure: "" }, model: "claude-fable-5-2" });
    },
  });
  try {
    const dir = join(site.outDir, "describe-pictures");
    const html = readFileSync(join(dir, "index.html"), "utf8");
    assert.match(html, /<meta name="alt-review-mode" content="inbox">/);
    assert.ok(html.includes(`<meta name="alt-review-endpoint" content="${ENDPOINT}">`), "posts to the data inbox");
    assert.equal(ENDPOINT, "https://www.beta.nyc/wp-json/betanyc-data/v1/report");
    assert.match(html, /connect-src https:\/\/www\.beta\.nyc;/);
    assert.doesNotMatch(html, /AI DRAFT/, "no AI draft is in the page");
    assert.doesNotMatch(readFileSync(join(dir, "data.json"), "utf8"), /AI DRAFT/);
    for (const f of ["app.js", "app.css", "inbox-payload.js", "issue-url.js"]) assert.ok(existsSync(join(dir, f)), f);

    const data = pageData(site.outDir);
    assert.equal(data.mode, "inbox");
    assert.equal(data.drafts_included, false);
    const rules = inventories.find((i) => i.book === "rules");
    assert.equal(data.items.length, 2 * rules.images.length, "both books' pictures");
    const reviewed = data.items.find((i) => i.book === "rules" && i.sha256 === rules.images[0].sha256);
    assert.equal(reviewed.entry.status, "reviewed");
    assert.equal(reviewed.entry.review.alt, "the sodium warning icon");
    const draftOnly = data.items.find((i) => i.book === "rules" && i.sha256 === rules.images[1].sha256);
    assert.equal(draftOnly.entry, null, "a picture with only an AI draft shows as having no description");
    assert.ok(data.items.filter((i) => i.book === "admin_code").every((i) => i.entry === null));
    // Every picture's file is in the page's own folder, as its sha256, and is the stored copy.
    for (const i of data.items) {
      assert.match(i.image_url, /^images\/[0-9a-f]{64}\.(jpg|png|gif|webp)$/);
      assert.ok(existsSync(join(dir, i.image_url)), i.image_url);
    }
    // Each use links to the section on law.beta.nyc (the fixture's ids are not in the fixture
    // site's books, so the id address the 404 page sends on).
    assert.equal(reviewed.uses[0].section_url, "https://law.beta.nyc/rules/s1");
    assert.equal(site.picturePage.path, "/describe-pictures/");
    assert.equal(site.picturePage.items, data.items.length);
    // The footer of every page links it; the page is not in the sitemaps.
    assert.match(readFileSync(join(site.outDir, "about.html"), "utf8"), /You can suggest a text description for a picture in the law on <a href="\/describe-pictures\/">Picture descriptions<\/a>\./);
    assert.match(readFileSync(join(site.outDir, "index.html"), "utf8"), /href="\/describe-pictures\/"/);
    for (const f of readdirSync(site.outDir).filter((f) => f.endsWith(".xml"))) assert.doesNotMatch(readFileSync(join(site.outDir, f), "utf8"), /describe-pictures/);
  } finally {
    rmSync(fx.root, { recursive: true, force: true });
    rmSync(join(site.outDir, ".."), { recursive: true, force: true });
  }
});

test("build-site: a missing or changed committed picture stops the build with the command to run", async () => {
  const { fx, sources, inventories } = twoBooks();
  const picturesDir = join(fx.root, "pictures");
  writePictures({ inventories, sources, outDir: picturesDir });
  const broken = join(fx.root, "broken");
  cpSync(picturesDir, broken, { recursive: true });
  rmSync(join(broken, "images", listing(broken)[0]));
  await assert.rejects(buildThreeBookFixtureSite({ options: { picturesDir: broken, altTextDir: fx.storeDir } }), /is not in .*images\. Run npm run alt:images/);
  await assert.rejects(buildThreeBookFixtureSite({ options: { picturesDir: join(fx.root, "none"), altTextDir: fx.storeDir } }), /picture inventory .*admin_code\.json is missing/);
  rmSync(fx.root, { recursive: true, force: true });
});

test("build-site: a Charter-only build makes no picture page and no footer link to one", async () => {
  const site = await buildThreeBookFixtureSite({ books: ["charter"], options: { picturesDir: join(tmpdir(), "no-pictures-here") } });
  try {
    assert.equal(site.picturePage, null);
    assert.ok(!existsSync(join(site.outDir, "describe-pictures")));
    assert.doesNotMatch(readFileSync(join(site.outDir, "about.html"), "utf8"), /describe-pictures/);
  } finally {
    rmSync(join(site.outDir, ".."), { recursive: true, force: true });
  }
});

test("build-site: the search index leaves the picture page out", async () => {
  const { site, fx } = await siteWithPictures({ search: true });
  try {
    const out = site.outDir;
    assert.ok(site.pagefind?.indexedPages > 0);
    const pageCount = readdirSync(out, { recursive: true }).filter((f) => String(f).endsWith(".html")).length;
    assert.equal(site.pagefind.indexedPages, pageCount - 1, "every HTML page but /describe-pictures/");
  } finally {
    rmSync(fx.root, { recursive: true, force: true });
    rmSync(join(site.outDir, ".."), { recursive: true, force: true });
  }
});

test("the committed pictures are kept out of the npm package", () => {
  const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
  for (const f of ["data/pictures/rules.json", "data/pictures/images/x.png"]) assert.ok(!pkg.files.some((p) => f === p || f.startsWith(`${p}/`)), `${f} is not shipped`);
  // And the folder the site reads is the one alt:images writes by default.
  assert.match(readFileSync(join(ROOT, "scripts", "alt-text.js"), "utf8"), /join\(ROOT, "data\/pictures"\)/);
  assert.match(readFileSync(join(ROOT, "scripts", "lib", "site", "build.js"), "utf8"), /join\(ROOT, "data", "pictures"\)/);
});
