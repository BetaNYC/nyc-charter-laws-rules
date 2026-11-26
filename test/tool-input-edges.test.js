// Tool inputs at the edges (issue #95, "Tools"): an empty search, one-letter searches, snippets
// that show the match, get_section's text in parts, citation forms people type, and lists of
// matches that page.
//
// Fixtures: a hand-made index written to a temporary directory (the publisher's shapes, not the
// publisher's text), served in a child process because the index directory is fixed at
// startup. A few checks run on the committed index with loose bounds only, since the daily
// refresh runs this suite on new text.
//
// Requires: npm run build (dist/ must exist). Guaranteed by "pretest".

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { callTool } from "../dist/tools.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
const PRESENT = existsSync(join(ROOT, "data", "index", "json", "charter.json"));
const skip = !PRESENT && "corpus index not built";

// ------------------------------------------------------------------ the fixture index

const rec = (corpus, id, citation, heading, text, extra = {}) => ({ corpus, id, citation, heading, text: text ?? `${heading} text.`, ...extra });

// Words with spaces, so a part can end between words: "w0001 w0002 …".
const words = (n, from = 1) => Array.from({ length: n }, (_, i) => `w${String(from + i).padStart(4, "0")}`).join(" ");
// Section BC 722: about 25,000 characters, with its subsection 722.2.1.1.4 and "s ≥ 4t" near the end.
const BC722 = `722.1 General. ${words(3500)} 722.2.1.1.4 Reinforcement. For s ≥ 4t the cover shall be increased. ${words(400, 5000)}`;
// A section whose only match for "drainage" is far past the first 400 characters.
const LATE = `${words(120)} The owner shall keep the roof drainage clear at all times. ${words(60, 200)}`;

const INDEX = {
  charter: [
    rec("charter", "c-ch11", "Chapter 11", "Chapter 11: Independent Budget Office", undefined, { level: "Chapter" }),
    rec("charter", "c-259", "§ 259", "§ 259 Independent budget office.", "a. There shall be an independent budget office."),
    rec("charter", "c-260", "§ 260", "§ 260 Taxes.", "Taxes are due in July. The tax rate is set each year."),
    rec("charter", "c-261", "§ 261", "§ 261 Lines.", "Line x marks the spot. Boxes of wax are exempt."),
    rec("charter", "c-262", "§ 262", "§ 262 Roofs.", LATE),
  ],
  admin_code: [
    rec("admin_code", "a-ch1", "Chapter 1", "Chapter 1: General", undefined, { level: "Chapter", titleNumber: "11" }),
    rec("admin_code", "a-bc-722", "Section BC 722", "Section BC 722: Calculated Fire Resistance", BC722, { titleNumber: "28" }),
    rec("admin_code", "a-bc-102", "Section BC 102", "Section BC 102: Applicability", "102.1 General. 102.4 Referenced codes.", { titleNumber: "28" }),
    rec("admin_code", "a-fc-102", "Section FC 102", "Section FC 102: Applicability", "102.1 General. 102.4 Application of other laws.", { titleNumber: "29" }),
    rec("admin_code", "a-pc-305", "Section PC 305", "Section PC 305: Protection of Pipes", "305.1 Corrosion. Pipes shall be protected.", { titleNumber: "28" }),
    rec("admin_code", "a-mc-918", "Section MC 918", "Section MC 918: Forced-Air Furnaces", "918.1 General.", { titleNumber: "28" }),
    rec("admin_code", "a-2-01", "§ 2-01", "§ 2-01 A number the Rules use too.", "Text.", { titleNumber: "2" }),
  ],
  // § 2-01 in 30 titles of the Rules, so the list of matches runs past one page of 25.
  rules: Array.from({ length: 30 }, (_, i) =>
    rec("rules", `r-${i + 1}-2-01`, "§ 2-01", `§ 2-01 Rule ${i + 1}.`, "Text.", { titleNumber: String(i + 1) }),
  ),
};

function runServer(body) {
  const dir = mkdtempSync(join(tmpdir(), "tool-edges-index-"));
  try {
    for (const [corpus, list] of Object.entries(INDEX)) writeFileSync(join(dir, `${corpus}.json`), JSON.stringify(list));
    const v = (list) => ({ currentThrough: "test", indexedAt: "2026-11-26T00:00:00Z", sectionCount: list.length });
    writeFileSync(join(dir, "versions.json"), JSON.stringify(Object.fromEntries(Object.entries(INDEX).map(([k, l]) => [k, v(l)]))));
    const code = `const c = await import(${JSON.stringify(pathToFileURL(join(ROOT, "dist", "corpus.js")).href)});
      const t = await import(${JSON.stringify(pathToFileURL(join(ROOT, "dist", "tools.js")).href)});
      const cite = (q, k) => { const r = c.getSection(q, k); const ids = r.kind === "match" ? r.section.id : r.kind === "ambiguous" ? r.candidates.map((s) => s.id) : "none"; return r.subdivision ? { ids, part: r.subdivision } : ids; };
      const call = async (name, args) => { const r = await t.callTool(name, args); return { isError: Boolean(r.isError), text: r.content[0].text, body: r.content[0].text.split(/\\n\\n(?:Source: |BetaNYC modified this data: |---\\n⚠️|⚠️)/)[0] }; };
      const out = {};
      ${body}
      console.log(JSON.stringify(out));`;
    const env = { ...process.env, NYC_LAWS_INDEX_DIR: dir };
    delete env.NYC_CLR_FOOTER;
    const r = spawnSync(process.execPath, ["--input-type=module", "-e", code], { env, cwd: ROOT, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
    assert.equal(r.status, 0, r.stderr);
    return JSON.parse(r.stdout);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const out = runServer(`
  for (const q of ["", "   ", '""', "“ ”", "''"]) out["empty " + JSON.stringify(q)] = await call("search", { query: q });
  out["x"] = await call("search", { query: "x" });
  out["tax"] = await call("search", { query: "tax" });
  out["taxe"] = await call("search", { query: "taxe" });
  out["wax tax"] = await call("search", { query: "boxes wax tax zzz" });
  out["late"] = await call("search", { query: "roof drainage" });
  out["late terms"] = await call("search", { query: "zzz drainage" });
  out["s ≥ 4t"] = await call("search", { query: "s ≥ 4t" });
  out["short whole"] = await call("search", { query: "line x" });
  out["722 default"] = await call("get_section", { citation: "Section BC 722" });
  out["722 small"] = await call("get_section", { citation: "Section BC 722", max_chars: 1000 });
  out["722 beyond"] = await call("get_section", { citation: "Section BC 722", offset: 999999 });
  out["722 bad max"] = await call("get_section", { citation: "Section BC 722", max_chars: 10 });
  out["259 whole"] = await call("get_section", { citation: "§ 259" });
  out["259 offset"] = await call("get_section", { citation: "§ 259", offset: 2 });
  // Read the whole text back, part by part, following each answer's own next offset.
  {
    const parts = [];
    let offset = 0;
    for (let i = 0; i < 10; i++) {
      const r = await call("get_section", { citation: "Section BC 722", offset });
      const m = /Showing characters (\\d+) to (\\d+) of (\\d+)\\.(?: Call again with offset (\\d+) for the next part\\.)?/.exec(r.body);
      if (!m) throw new Error("no part line: " + r.body.slice(0, 300));
      parts.push(r.body.slice(r.body.indexOf(m[0]) + m[0].length).replace(/^\\n\\n/, "").replace(/…$/, ""));
      if (!m[4]) break;
      offset = Number(m[4]);
    }
    out["722 parts"] = parts;
  }
  for (const q of ["§ 259.", "§ 259", "Building Code 722.2.1.1.4", "NYC Building Code § 722.2.1.1.4", "building code section 722",
    "Fire Code 102.4", "Plumbing Code 305.1", "Mechanical Code 918", "722.2.1.1.4", "§ 722.2.1.1.4", "102.4", "305.1", "Building code requirements", "999.1",
    "Building Code 722.2.1.1.4."]) out[q] = cite(q);
  out["building in charter"] = c.getSection("Building Code 722", "charter");
  out["bare in rules"] = cite("722.2.1.1.4", "rules");
  out["tool building in charter"] = await call("get_section", { citation: "Building Code 722", corpus: "charter" });
  out["tool bare"] = await call("get_section", { citation: "722.2.1.1.4" });
  out["tool bare ambiguous"] = await call("get_section", { citation: "102.4" });
  out["title 11 charter"] = await call("get_title", { corpus: "charter", title: "11" });
  out["title 11 admin"] = await call("get_title", { corpus: "admin_code", title: "11" });
  out["title 99 charter"] = await call("get_title", { corpus: "charter", title: "99" });
  out["2-01 rules"] = await call("get_section", { citation: "§ 2-01", corpus: "rules" });
  out["2-01 rules 25"] = await call("get_section", { citation: "§ 2-01", corpus: "rules", offset: 25 });
  out["2-01 rules 40"] = await call("get_section", { citation: "§ 2-01", corpus: "rules", offset: 40 });
  out["2-01 all"] = await call("get_section", { citation: "§ 2-01" });
`);

// ------------------------------------------------------------------ search

describe("search: an empty query is an error that says what to send", () => {
  for (const q of ["", "   ", '""', "“ ”", "''"]) {
    test(JSON.stringify(q), () => {
      const r = out[`empty ${JSON.stringify(q)}`];
      assert.equal(r.isError, true, r.text.slice(0, 200));
      assert.match(r.text, /^Error: search needs words to look for/);
      assert.match(r.text, /get_section/);
      assert.match(r.text, /legal advice/i, "the disclaimer is still there");
    });
  }
});

describe("search: 3 or fewer letters and digits match whole words only", () => {
  test("'x' finds the word x, not the x in 'wax' or 'boxes'", () => {
    assert.match(out.x.body, /^\[CHARTER\] § 261 /m);
    assert.equal((out.x.body.match(/^\[CHARTER\] /gm) ?? []).length, 1, out.x.body);
    assert.match(out.x.body, /3 or fewer letters and digits, so it matched whole words only/);
  });
  test("'tax' is a whole word ('The tax rate'), not the start of 'Taxes'", () => {
    assert.match(out.tax.body, /^\[CHARTER\] § 260 /m);
    assert.equal((out.tax.body.match(/^\[CHARTER\] /gm) ?? []).length, 1);
  });
  test("a longer query still matches inside words, and says nothing about whole words", () => {
    assert.match(out.taxe.body, /^\[CHARTER\] § 260 /m);
    assert.doesNotMatch(out.taxe.body, /whole words/);
  });
  test("in the word fallback, short terms match whole words and the answer names them", () => {
    // "wax" and "tax" are whole words in § 261 and § 260; "boxes" is a longer term.
    assert.match(out["wax tax"].body, /^No section matched every term/);
    assert.match(out["wax tax"].body, /Terms of 3 or fewer letters and digits \(wax, tax, zzz\) matched whole words only\./);
  });
  test("a short phrase with a symbol in it still matches ('s ≥ 4t')", () => {
    assert.match(out["s ≥ 4t"].body, /^\[ADMIN_CODE\] Section BC 722 /m);
  });
  test("'line x' (5 letters) matches as a phrase anywhere", () => {
    assert.match(out["short whole"].body, /^\[CHARTER\] § 261 /m);
    assert.doesNotMatch(out["short whole"].body, /whole words/);
  });
});

describe("search: each snippet shows the text around the first match", () => {
  test("a match past the first 400 characters is in the snippet, with … where text is left out", () => {
    const snip = out.late.body.split("\n")[1];
    assert.match(snip, /^…/);
    assert.match(snip, /roof drainage/);
    assert.match(snip, /…$/);
    assert.ok(snip.replace(/^…|…$/g, "").length <= 400, `${snip.length}`);
    assert.match(out.late.body, /Each snippet is at most 400 characters of the section, around the first match; … marks text left out\. get_section returns a section's full text\./);
  });
  test("in the word fallback too", () => {
    const lines = out["late terms"].body.split("\n");
    assert.ok(lines.some((l) => /^….*drainage.*…$/.test(l)), out["late terms"].body.slice(0, 600));
  });
  test("a snippet starts at a word, not inside one", () => {
    const snip = out.late.body.split("\n")[1];
    assert.match(snip, /^…w\d{4} /);
  });
  test("the BC 722 hit shows 's ≥ 4t', not 722.1's opening", () => {
    const lines = out["s ≥ 4t"].body.split("\n");
    const snip = lines[lines.findIndex((l) => l.startsWith("[ADMIN_CODE] Section BC 722")) + 1];
    assert.match(snip, /s ≥ 4t/);
    assert.doesNotMatch(snip, /^722\.1 General/);
  });
});

// ------------------------------------------------------------------ get_section's text in parts

describe("get_section: a long text comes in parts", () => {
  const total = BC722.length;
  test("by default, 20,000 characters at most, and the answer says how much there is and how to get the next part", () => {
    const b = out["722 default"].body;
    const m = /^Showing characters 1 to (\d+) of (\d+)\. Call again with offset (\d+) for the next part\.$/m.exec(b);
    assert.ok(m, b.slice(0, 400));
    assert.equal(Number(m[2]), total);
    assert.ok(Number(m[1]) <= 20000 && Number(m[1]) > 19000, m[1]);
    assert.equal(Number(m[3]), Number(m[1]));
    // The header and heading lines are unchanged, so existing callers still read them.
    assert.match(b, /^\[ADMIN_CODE\] Section BC 722 \(matched in corpus: admin_code\)\nSection BC 722: Calculated Fire Resistance\n\n/);
  });
  test("max_chars sets the size of a part", () => {
    const m = /^Showing characters 1 to (\d+) of \d+\. Call again with offset (\d+)/m.exec(out["722 small"].body);
    assert.ok(m && Number(m[1]) <= 1000 && Number(m[1]) > 900, out["722 small"].body.slice(0, 300));
  });
  test("following each part's offset gives back the whole text, cut between words", () => {
    const parts = out["722 parts"];
    assert.ok(parts.length >= 2);
    assert.equal(parts.join(""), BC722);
    for (const p of parts.slice(0, -1)) assert.match(p, /\s$/, "each part but the last ends after a space");
  });
  test("the last part says it is the end", () => {
    // The loop stops at the part with no next offset; its line ends "of N." alone.
    assert.ok(out["722 parts"].length <= 3);
  });
  test("an offset past the end says how long the text is", () => {
    assert.match(out["722 beyond"].body, new RegExp(`Nothing at offset 999999: the text has ${total} characters\\. Call again with a smaller offset\\.`));
    assert.equal(out["722 beyond"].isError, false);
  });
  test("max_chars under 1000 is refused", () => {
    assert.equal(out["722 bad max"].isError, true);
  });
  test("a short section is whole, with no part line", () => {
    assert.doesNotMatch(out["259 whole"].body, /Showing characters/);
    assert.match(out["259 whole"].body, /a\. There shall be an independent budget office\.$/);
  });
  test("an offset into a short section shows the rest, and says so", () => {
    assert.match(out["259 offset"].body, /^Showing characters 3 to \d+ of \d+\.$/m);
    assert.match(out["259 offset"].body, /There shall be/);
  });
});

// ------------------------------------------------------------------ citation forms

describe("get_section: citation forms people type", () => {
  test("a trailing period is ignored: '§ 259.'", () => {
    assert.equal(out["§ 259."], "c-259");
  });
  test("a construction code named in words: Building, Fire, Plumbing, Mechanical", () => {
    assert.deepEqual(out["Building Code 722.2.1.1.4"], { ids: "a-bc-722", part: "722.2.1.1.4" });
    assert.deepEqual(out["NYC Building Code § 722.2.1.1.4"], { ids: "a-bc-722", part: "722.2.1.1.4" });
    assert.deepEqual(out["Building Code 722.2.1.1.4."], { ids: "a-bc-722", part: "722.2.1.1.4" });
    assert.equal(out["building code section 722"], "a-bc-722");
    assert.deepEqual(out["Fire Code 102.4"], { ids: "a-fc-102", part: "102.4" });
    assert.deepEqual(out["Plumbing Code 305.1"], { ids: "a-pc-305", part: "305.1" });
    assert.equal(out["Mechanical Code 918"], "a-mc-918");
  });
  test("words that start with a code's name are looked up as typed", () => {
    assert.equal(out["Building code requirements"], "none");
  });
  test("a code named in words is a citation of the Administrative Code, so another corpus says so", () => {
    assert.deepEqual(out["building in charter"], { kind: "none", bookCitation: "admin_code" });
    assert.match(out["tool building in charter"].body, /is a citation of the New York City Administrative Code, so it is not looked for in the New York City Charter/);
  });
  test("a bare code number: one code has it, so that section", () => {
    assert.deepEqual(out["722.2.1.1.4"], { ids: "a-bc-722", part: "722.2.1.1.4" });
    assert.deepEqual(out["§ 722.2.1.1.4"], { ids: "a-bc-722", part: "722.2.1.1.4" });
    assert.deepEqual(out["305.1"], { ids: "a-pc-305", part: "305.1" });
    assert.match(out["tool bare"].body, /^You asked for 722\.2\.1\.1\.4, a part of Section BC 722\./);
  });
  test("a bare code number two codes have lists both", () => {
    assert.deepEqual(out["102.4"], { ids: ["a-bc-102", "a-fc-102"], part: "102.4" });
    assert.match(out["tool bare ambiguous"].body, /\[ADMIN_CODE\] Section BC 102 .*\n\[ADMIN_CODE\] Section FC 102 /);
  });
  test("a bare number no code has finds nothing, and none is looked for outside the Administrative Code", () => {
    assert.equal(out["999.1"], "none");
    assert.equal(out["bare in rules"], "none");
  });
});

describe("get_title: a bare number", () => {
  test("in the Charter, which has chapters and no titles, '11' is Chapter 11, and the answer says so", () => {
    const b = out["title 11 charter"].body;
    assert.match(b, /^Read "11" as "Chapter 11": the Charter has chapters, not titles\./);
    assert.match(b, /^Chapter 11 — Chapter 11: Independent Budget Office$/m);
  });
  test("in the Administrative Code, the answer says to name a title or a chapter", () => {
    assert.match(out["title 11 admin"].body, /^No sections found for "11" in admin_code\. Ask for 'Title 11' or 'Chapter 11'\./);
  });
  test("a Charter chapter that does not exist still finds nothing, with the hint", () => {
    assert.match(out["title 99 charter"].body, /^No sections found for "99" in charter\. The Charter has no Chapter 99; list_titles lists its chapters\./);
  });
});

describe("get_section: a list of matches says what to add, and pages", () => {
  test("with corpus given, it asks for the title, not the corpus", () => {
    const b = out["2-01 rules"].body;
    assert.doesNotMatch(b, /'corpus'/);
    assert.match(b, /^Multiple sections match "§ 2-01"\. To get one, name its title in the citation, as each line below does: '1 RCNY § 2-01'\.\n\n/);
    assert.match(b, /^Showing 1 to 25 of 30\. Call again with offset 25 for the next ones\.$/m);
    assert.equal(b.split("\n").filter((l) => l.startsWith("[RULES] ")).length, 25);
  });
  test("offset gives the next page, in the same order", () => {
    const b = out["2-01 rules 25"].body;
    assert.match(b, /^Showing 26 to 30 of 30\.$/m);
    assert.deepEqual(b.split("\n").filter((l) => l.startsWith("[RULES] ")).map((l) => l.split(" — ")[0]),
      [26, 27, 28, 29, 30].map((n) => `[RULES] ${n} RCNY § 2-01`));
  });
  test("an offset past the end says how many there are", () => {
    assert.match(out["2-01 rules 40"].body, /Nothing at offset 40: there are 30 in all\. Call again with a smaller offset\./);
  });
  test("with no corpus and matches in two documents, it names 'corpus' too", () => {
    assert.match(out["2-01 all"].body, /^Multiple sections match "§ 2-01"\. To get one, set 'corpus' \(admin_code or rules\), or name its title in the citation, as each line below does: '1 RCNY § 2-01'\./);
  });
});

// ------------------------------------------------------------------ the committed index

const realText = async (name, args) => {
  const r = await callTool(name, args);
  return { isError: Boolean(r.isError), text: r.content[0].text };
};

describe("on the committed index", () => {
  test("an empty search is an error, not every section", { skip }, async () => {
    const r = await realText("search", { query: "" });
    assert.equal(r.isError, true);
    assert.doesNotMatch(r.text, /Showing \d+ of \d+/);
  });
  test("'§ 259.' is Charter § 259", { skip }, async () => {
    const r = await realText("get_section", { citation: "§ 259." });
    assert.match(r.text, /^\[CHARTER\] § 259 /);
  });
  test("Building Code 722.2.1.1.4 is part of Section BC 722, which comes in parts", { skip }, async () => {
    const r = await realText("get_section", { citation: "Building Code 722.2.1.1.4" });
    assert.match(r.text, /^You asked for 722\.2\.1\.1\.4, a part of Section BC 722\./);
    assert.match(r.text, /^Showing characters 1 to \d+ of \d+\. Call again with offset \d+ for the next part\.$/m);
    assert.ok(r.text.length < 25000, `${r.text.length}`);
  });
  test("Rules § 2-01 lists more than 25 and pages", { skip }, async () => {
    const first = await realText("get_section", { citation: "§ 2-01", corpus: "rules" });
    const m = /^Showing 1 to 25 of (\d+)\. Call again with offset 25 for the next ones\.$/m.exec(first.text);
    assert.ok(m && Number(m[1]) > 25, first.text.slice(0, 300));
    const next = await realText("get_section", { citation: "§ 2-01", corpus: "rules", offset: 25 });
    assert.match(next.text, new RegExp(`^Showing 26 to \\d+ of ${m[1]}\\.`, "m"));
  });
  test("Charter get_title '11' is Chapter 11", { skip }, async () => {
    const r = await realText("get_title", { corpus: "charter", title: "11" });
    assert.match(r.text, /^Read "11" as "Chapter 11"/);
  });
});
