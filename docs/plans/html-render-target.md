# Implementation Plan: HTML render target

**Status:** Proposed (plan only — not yet implemented)
**Author:** BetaNYC software-engineer agent
**Created:** 2026-06-05
**Branch:** `feature/html-render-target`
**Tracking issues:** relates to #2 (planned `refresh-data.yml` corpus cron)

> **Doc location note.** This repo had no `docs/` tree before this plan (only
> `README.md` + `CHANGELOG.md`, neither using YAML frontmatter). This plan
> establishes `docs/plans/` as the home for design/implementation plans and
> follows the repo's plain-Markdown, no-frontmatter convention. If the team
> prefers a different location, this file moves wholesale — nothing depends on
> the path.

---

## 1. Goal and non-goals

### Goal
Add **HTML as a third render target** in the index build, a sibling of the
existing JSON and Markdown outputs, modeled on the DC Council `law-xml` /
`law-html` "law as versioned open data" pattern: per-section HTML files keyed by
the durable section `id`, per-corpus tables of contents, a root index, a build
`metadata.json`, a citation→id `redirects.json`, and a daily immutable
`publication/<date>` snapshot branch. The per-section files are the foundation
for future served permalinks (e.g. `code.beta.nyc/charter/0-0-0-1262`).

### Non-goals (explicit)
- **The MCP does not change.** `src/corpus.ts` keeps reading
  `data/index/json/`. Returning an HTML link in MCP results is a trivial future
  one-liner and is **out of scope** for this plan — noted, not built.
- **HTML is not derived from Markdown.** See §2.
- **No served website / hosting** in this plan. We commit static HTML; serving
  `code.beta.nyc` is future work that this layout enables.
- **No image extraction.** Images are addressed as a risk (§11) and are a
  non-issue for the Charter-first rollout (Charter has no `IMAGES/` dir).

---

## 2. Confirmed data flow (verified on disk, 2026-06-05)

The build pipeline today:

```
fetch-data.js  →  data/raw/<corpus>/{XML,IMAGES,DATAOBJECTS}/  (gitignored)
build-index.js →  parses XML ZIP → in-memory sections[]  →  fans out to:
                    data/index/json/<corpus>.json      (committed; MCP reads this)
                    data/index/json/versions.json      (committed)
                    data/index/markdown/<corpus>.md    (committed; lossy monolith)
```

Each `sections[]` element (from `collectSections` in
`scripts/lib/build-corpus.js`) has exactly these fields:

```json
{ "corpus": "charter", "id": "0-0-0-1262", "citation": "Chapter 11",
  "heading": "Chapter 11: Independent Budget Office", "text": "" }
```

Verified facts that drive the design:

| Fact | Evidence |
|---|---|
| JSON carries the stable `id` | `charter.json[0].id === "0-0-0-1262"` |
| Markdown has **discarded** the `id` | `grep "0-0-0-" data/index/markdown/charter.md` → 0 hits |
| Records have **no image field** | record keys are exactly `corpus,id,citation,heading,text` |
| Corpus sizes | charter **854**, admin_code **12,576**, rules **8,656** = **22,086** |
| `versions.json` is committed & carries `currentThrough` | tracked in git; e.g. charter "Current through Local Law 2026/102, enacted May 30, 2026," |
| Raw CSS exists per corpus (gitignored) | `data/raw/{charter/NYCcharter.CSS, admin_code/NYCadmin.CSS, rules/NYCrules.CSS}` |
| Raw `IMAGES/` exist for rules (501) & admin_code (1034), **not charter** | `data/raw/rules/IMAGES`, `data/raw/admin_code/IMAGES`; no `data/raw/charter/IMAGES` |
| Images keyed by same id scheme | e.g. `0-0-0-110.png` |

**Therefore HTML is built from `sections[]`, never from Markdown.** Markdown is a
lossy monolith-per-corpus that has already thrown away the `id` permalink
primitive and re-fused prose; re-parsing it would permanently lose the anchor we
are building the entire feature around.

**`preserveOrder: true` is upstream of all three render targets** — it governs
how `sections[].text` was assembled (inline `<LINK>`/`<CHARFORMAT>` kept in
document order). The render targets consume the already-ordered `text` string;
the renderer core must not re-order or re-tokenize it.

---

## 3. Architecture decisions being implemented (settled inputs)

1. HTML is additive and parallel; MCP untouched.
2. HTML is a third branch off the same in-memory `sections[]`, a **sibling** of
   Markdown — not derived from Markdown.
3. A shared `renderSection(section)` core returns ordered blocks; thin
   per-format serializers (Markdown, HTML) consume those blocks, so the two
   human-readable formats cannot drift. The **existing Markdown writer is
   refactored onto this core** — it does not stay a separate code path.
4. Per-section HTML files keyed by `id` (`html/<corpus>/<id>.html`), plus
   per-corpus TOC `index.html` and a root `index.html`.
5. DC best-practices folded in: `html/metadata.json`, `html/redirects.json`, an
   in-sync invariant test, optional bulk zip.
6. One `publication/YYYY-MM-DD` branch per day any corpus changes (single daily
   timeline, not per-corpus branches); `main` = rolling latest. Wired into the
   planned `refresh-data.yml` cron.
7. Markdown stays (human-reviewable diff surface; renders inline on github.com),
   refactored onto the shared core.

---

## 4. Target file / directory layout

New committed tree (sibling of `data/index/json` and `data/index/markdown`):

```
data/index/html/
├── index.html                      # root TOC: links to the three corpus TOCs
├── metadata.json                   # build provenance (see §7)
├── redirects.json                  # citation-slug → id-based filename (see §7)
├── charter/
│   ├── index.html                  # per-corpus TOC (chapters → sections)
│   ├── 0-0-0-1262.html             # one file per section, keyed by stable id
│   ├── 0-0-0-1325.html
│   └── … (854 files)
├── admin_code/
│   ├── index.html
│   └── … (12,576 files)            # Phase 2
└── rules/
    ├── index.html
    └── … (8,656 files)             # Phase 2
```

**Why `data/index/html/` and not top-level `html/`:** it sits beside the other
two render targets, keeps the "everything the build produces lives under
`data/index/`" invariant, and is naturally covered by the existing
`package.json` `files: ["dist", "data/index"]` allow-list. (If we deliberately
want to *exclude* HTML from the npm tarball to keep the package small, we add a
narrower `files` entry — flagged in §11 as an open decision.)

**Filename = `<id>.html`, not citation.** IDs are durable across rebuilds;
citation formatting drifts (`§ 259` vs `Section 259`). `redirects.json` maps the
human-citation slug to the id file so a re-cite never 404s once served.

---

## 5. The `renderSection` core refactor (the heart of the change)

New module: `scripts/lib/render-section.js` (pure, no I/O, unit-testable —
mirrors the `build-corpus.js` / `extract-text.js` pattern).

```js
// renderSection(section) → ordered array of typed blocks.
// Format-agnostic. The ONLY place section semantics live.
export function renderSection(section) {
  // returns blocks like:
  //   { type: "heading", level: 2, text: section.heading }
  //   { type: "citation", text: section.citation }
  //   { type: "body", text: section.text }    // empty-text chapters → omitted or "no text"
  // Order is fixed here so MD and HTML cannot diverge.
}
```

Thin serializers consume the blocks:

- `scripts/lib/serialize-markdown.js` — `blocks → string` reproducing the
  **exact current** Markdown output (`## heading`, `**Citation:** …`, body or
  `_No text extracted._`, `---`). This is a **behavior-preserving refactor**:
  the regression bar is byte-identical (or test-justified) output vs. today.
- `scripts/lib/serialize-html.js` — `blocks → HTML string` for one section page
  (semantic `<article>`, `<h1>`/`<h2>`, a `<dl>`/`<span>` citation, body
  paragraphs, the BetaNYC/AML disclaimer footer mirroring `src/index.ts`'s
  `FOOTER`, and `<link rel="canonical">` / id anchor for permalink stability).

`build-index.js` then fans `sections[]` out to **three** branches that all route
through `renderSection`:

```
sections[] ──renderSection──► blocks ──► serialize-markdown ──► data/index/markdown/<corpus>.md
                                    └──► serialize-html     ──► data/index/html/<corpus>/<id>.html
           ──► (unchanged) JSON.stringify(sections)        ──► data/index/json/<corpus>.json
```

**Cross-reference handling is preserved unchanged.** `section.text` already
encodes the `preserveOrder` interleaving as a flat string; the HTML serializer
escapes it and wraps it, but does **not** re-parse or re-order it. Making the
inline `<LINK>` cross-references into real `<a href>` links is **deferred** (see
§11 "cross-reference linkability") — v1 HTML renders them as today's text.

---

## 6. TOC generation

- **Per-corpus `index.html`:** iterate that corpus's `sections[]` in document
  order (already correct — `collectSections` preserves source order). Group
  under `Chapter`/`Title` headings (detectable via the same predicate
  `listTitles` uses in `src/corpus.ts`: heading starts with "chapter"/"title"),
  each section linking to `<id>.html`. No new data needed — order + heading
  prefixes are sufficient for a flat-to-one-level TOC. (A deeper nested tree
  would need parent-id capture in `collectSections`; **out of scope for v1** —
  flagged in §11.)
- **Root `index.html`:** three links to the corpus TOCs + `currentThrough` per
  corpus pulled from the same version data that feeds `versions.json`, + a build
  date. Mirrors `get_version` MCP output for consistency.

---

## 7. `metadata.json` and `redirects.json`

`data/index/html/metadata.json` (DC `law-html`-style build provenance):

```json
{
  "generatedAt": "2026-06-05T00:00:00.000Z",
  "generator": "nyc-charter-laws-rules@0.1.2",
  "sourceCommit": "<git rev-parse HEAD at build time>",
  "corpora": {
    "charter":    { "currentThrough": "…LL 2026/102…", "sectionCount": 854 },
    "admin_code": { "currentThrough": "…", "sectionCount": 12576 },
    "rules":      { "currentThrough": "…", "sectionCount": 8656 }
  }
}
```

- `currentThrough` and `sectionCount` are reused from the existing version
  extraction (`extractVersion` / the `versions` object in `build-index.js`) — no
  new parsing.
- `sourceCommit`: `git rev-parse HEAD` via `child_process` at build time, with a
  graceful `"unknown"` fallback if git is unavailable (keeps the build working
  in a tarball/CI checkout without `.git`). Fail-soft, logged — not fail-loud,
  because provenance is metadata, not a runtime dependency.

`data/index/html/redirects.json` — citation-slug → id file, so re-citations
never 404 once served:

```json
{ "charter": { "section-259": "0-0-0-1481", "chapter-11": "0-0-0-1262" } }
```

- Slug derivation is deterministic from `citation` (lowercase, `§`→`section-`,
  spaces→`-`). **Collision policy:** if two sections slugify identically, log a
  warning and keep first-wins (document order); the invariant test (§9) asserts
  zero unexpected collisions so a real clash surfaces loudly rather than silently
  shadowing a section.

---

## 8. npm script + build wiring

- New script in `package.json`:
  `"build-html": "node scripts/build-html.js"` — a standalone entry that loads
  the committed `data/index/json/<corpus>.json` (the same artifact the MCP reads)
  and emits the `html/` tree. **Decoupling rationale:** building HTML from the
  committed JSON (not only from an in-memory build run) means HTML can be
  regenerated without re-fetching/re-parsing the multi-MB ZIPs, and the
  Phase-1 Charter rollout can run in isolation. The shared `renderSection` core
  is identical either way.
- `build-index.js` gains an **opt-in** call into the HTML branch behind a flag
  (`--html`, default off in Phase 1) so the existing build is unchanged until we
  flip it on. Markdown refactor onto the shared core lands **in the same PR** as
  the core (behavior-preserving), so MD and HTML share one code path from day
  one.
- A `"build-all"` convenience script chaining `build-index` (+`--html` once
  enabled) is optional; flagged, not required.

Version safety (per `engineering-standards.md`): the new scripts use only
Node APIs available across the declared `engines.node ">=18"` range and tested
on the existing 20.x/22.x matrix — no syntax/stdlib that only works at one end.
No new runtime dependencies (string templating + `node:fs` + `node:child_process`
only); if a templating helper is ever added it gets a bounded `<` ceiling and a
lockfile entry. `deptry`-equivalent for Node: keep `dependencies` clean (no new
deps planned).

---

## 9. Invariant test(s)

New `test/html-invariants.test.js`, in the same spirit as
`corpus-invariants.test.js` / `content-leak.test.js`, asserting **`html/`
matches the current index** ("in-sync invariant"):

1. **Completeness:** for the rolled-out corpus, every `sections[]` entry has a
   corresponding `html/<corpus>/<id>.html`, and there are **no orphan** HTML
   files without a matching section (catches stale files after a section is
   removed upstream).
2. **Count parity:** `# html files == sections.length == versions.json
   sectionCount` for the rolled-out corpus (mirrors corpus-invariants
   Invariant 6).
3. **id integrity:** every section has a non-empty `id` (precondition for the
   filename scheme — already asserted by corpus-invariants Invariant 6, re-checked
   here as a guard since the filename depends on it).
4. **No content leak into HTML:** rendered body contains no raw AML XML tags, no
   undecoded entities, no `[ALP …]` markers (the HTML escaping must not *re-introduce*
   or fail to carry the upstream cleanups). Reuses the regex families from
   `content-leak.test.js`.
5. **HTML well-formedness (lightweight):** each emitted page parses without
   unclosed-tag errors via a minimal check (no heavy DOM dep — a structural
   regex/assert or a tiny well-formedness pass), and contains the disclaimer
   footer.
6. **redirects.json integrity:** every slug resolves to an existing
   `html/<corpus>/<id>.html`; no unexpected slug collisions (§7).
7. **metadata.json integrity:** has all rolled-out corpora, `sectionCount`
   matches `versions.json`, `generatedAt` parses as a date.

`renderSection` + both serializers also get a **unit test**
(`test/render-section.test.js`) proving (a) MD serializer output is unchanged vs.
the pre-refactor format on a fixture, and (b) MD and HTML emit the **same
ordered blocks** for the same section (the anti-drift guarantee). This is the
test that would have caught the Markdown refactor silently changing output.

---

## 10. `refresh-data.yml` branch-cut workflow (wiring the daily snapshot)

The planned `refresh-data.yml` cron (issue #2, not yet built) gains the
branch-cut step. Sequence:

```
on: schedule (daily) + workflow_dispatch
1. checkout main
2. npm ci
3. npm run fetch-data            # pull AML bulk ZIPs
4. npm run build-index --html    # rebuild JSON + MD + HTML from sections[]
5. if `git diff` shows ANY change in data/index/ for ANY corpus:
     a. commit to main:   "data: refresh corpora + render (<date>)"
        (include per-corpus changes in the message body / changelog,
         since per-corpus granularity lives in metadata/changelog, NOT branches)
     b. push main
     c. cut & push ONE immutable snapshot branch: publication/<today>
        (git branch publication/$(date +%F) && git push origin publication/$(date +%F))
6. if no change: no commit, no branch (idempotent — safe to run daily).
```

Design notes:
- **One branch per day, not per corpus.** Single daily timeline. Per-corpus
  detail is recorded in the commit body + `CHANGELOG.md` + `metadata.json`, not
  in branch names. Unchanged blobs are shared across daily branches, so each
  snapshot is near-free in storage (the §11 repo-weight caveat is about `main`
  growth from regenerated HTML, not branch count).
- **Idempotency** (engineering-standards §6): the "if changed" guard means a
  re-run on an unchanged day is a no-op — no duplicate commits, no duplicate
  branches. Re-cutting an existing `publication/<date>` must be guarded (skip if
  the ref already exists) to keep the snapshot immutable.
- **Env validation:** the workflow validates required inputs (e.g. AML source
  URLs / `GITHUB_TOKEN` push perms) at the top and fails fast/loud if missing,
  per the 2026-06-01 incident shape.
- **Structured logs:** each step echoes script name + event + corpus + counts.
- This is the **last** phase to land (Phase 3) — only after Charter render +
  URLs + invariants are proven manually.

---

## 11. Staged rollout

Deliberately incremental (engineering-standards §6 "ship small, rollback path").

### Phase 1 — Charter only (prove the mechanism)
- 854 sections. **Charter has no `IMAGES/` dir**, so this phase sidesteps image
  handling entirely — the cleanest possible proof.
- Land: `renderSection` core + both serializers (MD refactored onto it,
  behavior-preserving) + `serialize-html` + `build-html.js` + Charter `html/`
  tree + root/corpus TOC for Charter + `metadata.json` + `redirects.json`
  (Charter only) + `test/render-section.test.js` + `test/html-invariants.test.js`
  (scoped to Charter).
- **Gate to Phase 2:** invariants green; spot-check ~10 rendered Charter pages
  by eye (a chapter w/ empty text, a long section, a section heavy with inline
  cross-refs, `§ 259`); URLs resolve to the right `id`; redirects map correctly.
- Rollback: HTML branch is opt-in (`--html` off by default) and the `html/` tree
  is additive — reverting the PR removes it with zero impact on JSON/MD/MCP.

### Phase 2 — admin_code + rules (scale)
- 12,576 + 8,656 = 21,230 more files. **Both have `IMAGES/`** → decide image
  policy first (§ open questions). v1 likely renders image *placeholders* /
  alt-text references rather than copying binaries (keeps repo weight down);
  full image handling can be its own phase.
- Extend invariant test to all three corpora.
- This is the phase where the §11 repo-weight caveat actually bites — measure
  `main` size delta on Charter (Phase 1) first to forecast it.

### Phase 3 — automation
- Wire `refresh-data.yml` branch-cut (§10). Only after Phases 1–2 are stable on
  `main`.

---

## 12. Test plan

| Layer | What | When |
|---|---|---|
| `test/render-section.test.js` | MD serializer byte-stable vs. pre-refactor fixture; MD & HTML share identical block order | per-PR (`test.yml`) |
| `test/html-invariants.test.js` | completeness, count parity, no content leak, well-formedness, redirects + metadata integrity (Charter in P1; all in P2) | per-PR |
| Existing `corpus-invariants` / `content-leak` / `build-smoke` / `extract-text` / `mcp-tools` | must stay green — proves JSON/MD/MCP unaffected | per-PR |
| Manual spot-check | render ~10 Charter pages, eyeball, click-through TOC, verify a redirect | Phase-1 gate (recorded in PR) |
| `differential.yml` | unaffected (parser path unchanged) | nightly |

Per engineering-standards §3: every change ships with a test that would have
caught its regression; tests are **run and real output pasted into the PR** — no
claimed-but-unrun tests. The Node matrix (20.x/22.x) in `test.yml` already tests
both ends of the declared `engines` range.

---

## 13. Open questions / risks

1. **CSS / styling approach** — raw per-corpus CSS exists
   (`NYCcharter.CSS`, `NYCadmin.CSS`, `NYCrules.CSS`) but is gitignored under
   `data/raw/` and is AML's presentational stylesheet, not ours. Options:
   (a) ship a single small hand-written BetaNYC stylesheet (`html/assets/style.css`)
   — recommended, keeps us off AML's drifting CSS and small; (b) adapt the AML
   CSS (couples us to their formatting); (c) inline minimal styles / ship
   class-only semantic HTML and style at serve time. **Decision deferred** —
   Phase 1 can ship semantic, class-annotated HTML with one tiny shared
   stylesheet and revisit.
2. **Image handling** — `rules` (501) and `admin_code` (1034) have `IMAGES/`
   keyed by the same id scheme; **records carry no image field today**, so
   surfacing images requires *new XML extraction* in `collectSections`, not just
   a render change. Charter has none, so Phase 1 is unaffected. Phase-2 options:
   placeholder/alt-text refs (light), copy binaries into `html/<corpus>/images/`
   (heavy on repo weight), or defer images to a dedicated phase. **Deferred.**
3. **Cross-reference linkability** — `section.text` preserves inline `<LINK>`
   cross-refs *as text* (the `preserveOrder` fix). Turning them into real
   `<a href>` to the target section's `<id>.html` is high-value for a served
   site but needs the link's `destination-id` (e.g. `destination-id="0-0-0-461"`
   in the XML), which is **discarded** before `sections[].text`. Capturing it
   means extending `collectSections` to emit structured inline-link metadata —
   a parser change, not a render change. **v1 renders cross-refs as text;**
   real links are a follow-up that also benefits the future served permalinks.
4. **Repo weight** — committing generated HTML for ~22,086 sections grows
   `main`. Charter alone is 854 small files; admin_code + rules add ~21k. Daily
   `publication/<date>` branches are near-free (shared blobs), but each *rebuild*
   that changes formatting rewrites many files on `main`. Mitigations: the staged
   rollout (measure Charter delta before scaling), consider gzip/bulk-zip
   artifact instead of (or alongside) loose files, and decide whether `html/` is
   excluded from the **npm tarball** via `package.json` `files` (it's currently
   inside `data/index/` which IS published — likely we want to *exclude* it to
   keep the installed package lean while still committing it to git). **Open
   decision, surfaced not decided.**
5. **TOC depth** — v1 is a flat/one-level TOC (chapter → section) derivable from
   existing data. A deep nested tree needs parent-id capture in
   `collectSections` (parser change). Deferred.
6. **npm publish surface** — see #4; resolve `files` scoping before Phase 2 so we
   don't bloat the published package.

---

## 14. Summary of phases

- **Phase 1 (Charter):** shared `renderSection` core + MD refactor + HTML
  serializer + `build-html.js` + Charter `html/` tree + TOCs + metadata +
  redirects + invariant & render-section tests. Image-free, opt-in, fully
  reversible. **Proves render + URLs + invariant.**
- **Phase 2 (admin_code + rules):** scale to all 22k sections; decide image and
  npm-`files` policy; extend invariants.
- **Phase 3 (automation):** wire the `publication/<date>` daily branch-cut into
  `refresh-data.yml` (issue #2).

The single biggest correctness guarantee is the shared `renderSection` core with
its anti-drift unit test: Markdown and HTML provably cannot diverge, and the
Markdown refactor is behavior-preserving and test-locked.
