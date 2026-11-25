// Titles on the committed data (issue #59): npm run test:site-data.
//
// NOT part of npm test, on purpose: the daily refresh runs npm test on the freshly rebuilt index,
// and a surprise in the data's shape must stop the website, not the data (see admin-layout.test.js).
// Nothing here pins a count. An index built before 0.7.0 has no titles; these tests then skip.
//
// The Rules website (next step) builds its citations ("15 RCNY § 1-01") and per-title paths from
// `titleNumber`, so every Rules record must have one.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { getSection, fullCitation, getTitle, listTitles } from "../../dist/corpus.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const INDEX = join(ROOT, "data", "index", "json");
const STRUCTURE = join(ROOT, "data", "structure");
const read = (corpus) => JSON.parse(readFileSync(join(INDEX, `${corpus}.json`), "utf8"));
const rules = read("rules");
const admin = read("admin_code");
const charter = read("charter");
const skip = rules.some((s) => s.titleNumber) ? false : "the committed index was built before 0.7.0 and records no titles";

test("every Rules record has a title; the Charter has none", { skip }, () => {
  const missing = rules.filter((s) => !s.titleNumber);
  assert.deepEqual(missing.slice(0, 10).map((s) => `${s.id} ${s.citation}`), [], `${missing.length} Rules records with no title`);
  assert.ok(charter.every((s) => !("titleNumber" in s) && !("titleHeading" in s)));
});

test("a chapter's titleHeading names its own title, and every title has one name", { skip }, () => {
  for (const book of [rules, admin]) {
    const names = new Map();
    for (const s of book) {
      if (s.titleHeading) {
        assert.equal(s.level, "Chapter", `${s.id}: titleHeading only on chapter records`);
        assert.match(s.titleHeading, new RegExp(`^Title ${s.titleNumber.replace("-", "-?")}\\b`, "i"), s.id);
        assert.equal(names.get(s.titleNumber) ?? s.titleHeading, s.titleHeading, `Title ${s.titleNumber} has two names`);
        names.set(s.titleNumber, s.titleHeading);
      }
    }
    assert.ok(names.size > 0);
  }
});

test("the index's title agrees with the structure's Title parent wherever the structure has one", { skip }, (t) => {
  for (const [corpus, book] of [["rules", rules], ["admin_code", admin]]) {
    if (!existsSync(join(STRUCTURE, `${corpus}.json`))) continue;
    const structure = JSON.parse(readFileSync(join(STRUCTURE, `${corpus}.json`), "utf8"));
    const label = (id) => (structure.groups[id]?.level === "Title" ? structure.groups[id].label : null);
    let checked = 0;
    let noParent = 0;
    structure.sections.forEach((s, i) => {
      assert.equal(s.id, book[i].id);
      const title = s.parents.map(label).find(Boolean);
      if (!title) {
        noParent++;
        return;
      }
      if (!/^Title \S+$/.test(title)) return;
      assert.equal(title.toUpperCase(), `TITLE ${book[i].titleNumber ?? ""}`.toUpperCase(), `${corpus} ${book[i].id} ${book[i].citation}`);
      checked++;
    });
    assert.ok(checked > 0);
    t.diagnostic(`${corpus}: ${checked} records agree; ${noParent} have no Title parent in the structure (record order or Appendix A)`);
  }
});

test("every Rules record whose full citation is its own is found by it", { skip }, () => {
  // "15 RCNY § 1-01", "Title 30, Apartment & Loft Order #49 (2017), Notice"... A full citation two
  // records share is the publisher's own repeat (two "§ 1" in one chapter, or two chapters it
  // numbered alike and marked "*"); those come back as a list and are not checked here.
  const count = new Map();
  for (const s of rules) count.set(fullCitation(s).toLowerCase(), (count.get(fullCitation(s).toLowerCase()) ?? 0) + 1);
  const lost = [];
  for (const s of rules) {
    const full = fullCitation(s);
    if (count.get(full.toLowerCase()) > 1) continue;
    const r = getSection(full, "rules");
    if (r.kind !== "match" || r.section.id !== s.id) lost.push(`${s.id} ${full}`);
  }
  assert.deepEqual(lost.slice(0, 10), [], `${lost.length} Rules records not found by their own full citation`);
});

test("Administrative Code: 'Title 16' is Title 16's chapters, and each lettered title is its own", { skip }, () => {
  const lettered = [...new Set(admin.map((s) => s.titleNumber).filter((t) => /^\d+-[A-Z]$/.test(t ?? "")))];
  assert.ok(lettered.length > 0);
  for (const t of lettered) {
    const parent = t.replace(/-[A-Z]$/, "");
    assert.ok(getTitle("admin_code", `Title ${parent}`).every((s) => s.titleNumber === parent), `Title ${parent} holds only its own records`);
    const own = getTitle("admin_code", `Title ${t}`);
    assert.ok(own.length > 0 && own.every((s) => s.titleNumber === t), `Title ${t}`);
  }
});

test("get_title 'Title N' gives exactly the records with that title, for every title; list_titles lists every chapter", { skip }, () => {
  // Review of #59: Rules chapters with no number (the Health Code, the Rent Guidelines Board's
  // orders, appendices) were in no chapter, so "Title 24" left the Health Code out and "Title 30"
  // found nothing.
  for (const [corpus, book] of [["rules", rules], ["admin_code", admin]]) {
    const byTitle = new Map();
    for (const s of book) if (s.titleNumber) byTitle.set(s.titleNumber, [...(byTitle.get(s.titleNumber) ?? []), s.id]);
    for (const [t, want] of byTitle) {
      const got = getTitle(corpus, `Title ${t}`).map((s) => s.id);
      assert.equal(new Set(got).size, got.length, `${corpus} Title ${t}: no record twice`);
      assert.deepEqual([...got].sort(), [...want].sort(), `${corpus} Title ${t}`);
    }
    const listed = new Set(listTitles(corpus).map((e) => e.heading));
    const chapters = book.filter((s) => s.level === "Chapter" && s.titleNumber);
    assert.deepEqual(chapters.filter((s) => !listed.has(s.heading)).map((s) => `${s.id} ${s.heading}`).slice(0, 10), [], `${corpus}: every titled chapter record is in list_titles`);
  }
});
