// The Markdown index is written from renderSection's blocks (issue #61). Its bytes must not
// change: this rebuilds each committed data/index/markdown/<corpus>.md from the committed JSON
// (and the committed structure, when there is one) and compares every byte, for every section.
// Offline; it reads only committed files.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { corpusMarkdown } from "../scripts/lib/serialize-markdown.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const versions = JSON.parse(readFileSync(join(ROOT, "data", "index", "json", "versions.json"), "utf8"));

for (const corpus of ["charter", "admin_code", "rules"]) {
  test(`data/index/markdown/${corpus}.md is rebuilt byte for byte from the JSON`, () => {
    const sections = JSON.parse(readFileSync(join(ROOT, "data", "index", "json", `${corpus}.json`), "utf8"));
    const committed = readFileSync(join(ROOT, "data", "index", "markdown", `${corpus}.md`), "utf8");
    // The counts the Markdown states are the counts versions.json states.
    assert.equal(sections.length, versions[corpus].sectionCount);
    const version = versions[corpus].currentThrough;
    const plain = corpusMarkdown({ corpus, version, sections });
    assert.ok(plain === committed, `${corpus}.md differs from the Markdown written from the JSON`);
    const structurePath = join(ROOT, "data", "structure", `${corpus}.json`);
    if (existsSync(structurePath)) {
      const structure = JSON.parse(readFileSync(structurePath, "utf8"));
      assert.ok(corpusMarkdown({ corpus, version, sections, structure }) === committed, `${corpus}.md differs when written from the structure's blocks`);
    }
  });
}
