
# Plan: Publish NYC's code on the DC Council model

**Plan created:** 2026-08-06
**Supersedes:** `docs/plans/html-render-target.md` (2026-06-05, never implemented — removed in the same commit that added this file; recoverable from git history)
**Repo:** `BetaNYC/nyc-charter-laws-rules` @ `0.2.0`
**Proposed branch:** `feature/publication-model`
**Owner:** Noel
**Status:** draft — awaiting review

---

## Context

The repo currently fetches American Legal Publishing's bulk XML for the NYC Charter, Administrative Code, and Rules; parses it; commits a derived JSON + Markdown index; and serves it over MCP. A daily GitHub Action refreshes it. `main` always holds the latest state and nothing else — **there is no way to ask what the law said on a past date.**

A plan to change that already exists in the repo (`docs/plans/html-render-target.md`, 2026-06-05), explicitly modeled on DC Council's `law-xml` / `law-html` pattern. It was never implemented and its branch was never cut. Two months of `main` movement have since invalidated parts of it.

This revision does three things: refreshes the June plan against current `main`, widens it from "add an HTML target" to "adopt the parts of DC's publishing model that actually apply to us," and states plainly which part of that model **doesn't** transfer and why.

## What DC actually does

Read from the live repos on 2026-08-06. Note that `DCCouncil/dc-law` is only a landing page (last pushed 2020); the working system is the `law-*` family, all pushed within the last two days.

| Practice | How DC does it | Adopt? |
|---|---|---|
| **Format separation** | `law-xml` (source) → `law-xml-codified` → `law-html`, `law-rdf`. Rule: *"generated from xml. Do not make manual commits."* | **Yes**, single-repo variant |
| **Publication branches** | `law-xml-codified` default branch is `publication/2021-10-18`; 100+ siblings like `publication/2021-10-18.2021-11-22`. Point-in-time law. | **Yes** — the highest-value piece |
| **Commit grammar** | `codify: xx-xxx`, `recodify:`, `technical:`, `system:`. Git history *is* the codification record. | **Yes**, adapted |
| **Cryptographic authentication** | Separate `law` repo running TUF: `root.json`, `snapshot.json`, `timestamp.json`, `mirrors.json`, 11 rotated root keys. | **Reframed** — see below |
| **CC0 licensing** | All repos CC0, contributors license each PR explicitly. | **Review separately** — repo currently has its own LICENSE |
| **Multi-repo split** | 8+ repos by format and stage. | **No** — decided 2026-08-06, single repo |

### The authentication piece, stated honestly

DC Council **publishes its own law**. It can attest that a document is the authentic law of the District because it is the body that made it.

BetaNYC mirrors American Legal Publishing's codification of NYC's law. The MCP's own tool descriptions already tell users to verify against `codelibrary.amlegal.com`. We cannot make DC's claim and should not build something shaped like it, because a TUF-signed BetaNYC corpus would assert an authority we don't have.

There is a narrower claim we *can* make and that is worth making: **this mirror faithfully reproduces what AML served on a given date.** That is a provenance and integrity claim about our own pipeline, not an authenticity claim about the law. Implementation is modest — record SHA-256 of each fetched ZIP in build metadata, so any published snapshot can be traced to the exact upstream bytes it came from.

This plan builds that. It does not build TUF. If we ever want stronger guarantees, signed git tags on publication branches are the proportionate next step, not a signing infrastructure.

## Goals

1. Any past state of the NYC Charter, Admin Code, or Rules can be retrieved by date.
2. Every published snapshot is traceable to the exact upstream AML bytes it was built from.
3. Markdown and HTML renderings provably cannot drift apart.
4. Per-section durable URLs exist as committed files, laying groundwork for a future `code.beta.nyc/charter/0-0-0-1262`.
5. The MCP server's behavior is unchanged throughout.

## Scope

**In scope:**

- Shared `renderSection` core + Markdown and HTML serializers (carried over from the June plan, §5)
- Per-section HTML keyed by durable id, per-corpus and root TOCs (§4, §6)
- `metadata.json` build provenance, extended with upstream ZIP checksums (§7, revised)
- `redirects.json` citation-slug → id mapping (§7)
- `publication/YYYY-MM-DD` immutable snapshot branches, wired into the **existing** refresh workflow (§10, revised)
- Structured commit grammar for corpus changes (**new**)
- Invariant tests for completeness, count parity, and MD/HTML block-order parity (§9, §12)

**Out of scope:**

- **Splitting into multiple repos.** **Decided 2026-08-06 (Noel): single repo.** DC's 8-repo split reflects a full publishing pipeline with staff behind it. One repo with clear directories does the same job here at a fraction of the operational cost. Revisit only if the repo becomes genuinely unwieldy.
- **TUF or any signing infrastructure.** Reasoning above.
- **RDF output.** DC has `law-rdf`; no demonstrated consumer for an NYC equivalent. Note it, don't build it.
- **A served website.** This plan commits static HTML. Serving `code.beta.nyc` is downstream work this enables.
- **MCP changes.** `src/corpus.ts` keeps reading `data/index/json/`. Returning an HTML permalink in MCP results is a later one-liner.
- **Real cross-reference links.** `section.text` discards `destination-id` before it reaches the index; capturing it is a parser change. v1 renders cross-refs as text, as today.
- **Image handling.** Deferred to Phase 2 decision (Charter has no `IMAGES/`).

## What changed since the June plan

These are corrections to the original, verified against `origin/main` on 2026-08-06:

| June plan says | Actually true now | Consequence |
|---|---|---|
| `refresh-data.yml` is "planned (issue #2), not yet built" | **Built and running daily** at 11:00 UTC, with a `git diff --quiet` change guard and idempotent build | Phase 3 shrinks to *adding a branch-cut step to an existing workflow* — much smaller |
| `engines.node: ">=18"` | **`">=20"`** | §8's version-safety note relaxes; Node 20 APIs are fair game |
| Generator string `@0.1.2` | **`0.2.0`** | Cosmetic, but `metadata.json` must read the version, not hardcode it |
| admin_code 12,576 / rules 8,656 sections | **12,591 / 8,686** | Phase 2 file-count estimates rise ~45; immaterial, but don't cite the old figures |
| `src/index.ts` holds tool definitions | **27-line entrypoint**; definitions live in `src/tools.ts` (239 lines) with `.strict()` | Unrelated to this plan, but see Sequencing |

## Sequencing — read this before starting

Open PR **#15** (`refactor/mcpserver-migration`, draft, conflicting) touches `scripts/build-index.js`, `scripts/lib/build-corpus.js`, and `src/corpus.ts` — the same files this plan restructures. Per the 2026-08-06 evaluation, that PR splits into:

- **Half A** — dead-code removal across 6 files (+51/−74), conflict-free, still applies cleanly
- **Half B** — a `registerTool` migration that `main` has overtaken and would silently undo the `.strict()` fix

**Land Half A first, as the first commit on this plan's branch.** It removes dead paths from exactly the files `renderSection` reorganizes, so the refactor starts from a smaller surface. Half B stays closed / re-filed as its own issue and is not part of this work.

## Approach

### Phase 0 — Prepare (½ day)

1. Cut `feature/publication-model` from current `main`.
2. Cherry-pick Half A of PR #15 as the first commit. Run the full suite; `data/` must rebuild byte-identical (the PR's zero-diff proof already demonstrated this at its merge base — re-prove at ours).
3. Move the revised plan into `docs/plans/` under its new name, retiring `html-render-target.md`.

### Phase 1 — Charter only (the proof)

Carried over from the June plan essentially unchanged; it was well-specified.

4. `scripts/lib/render-section.js` — pure, no I/O. `renderSection(section)` returns ordered typed blocks. The only place section semantics live.
5. `scripts/lib/serialize-markdown.js` — refactor the **existing** Markdown writer onto the core. Behavior-preserving; regression bar is byte-identical output.
6. `scripts/lib/serialize-html.js` — semantic per-section page, canonical link, disclaimer footer mirroring `src/index.ts`'s `FOOTER`.
7. `scripts/build-html.js` — reads committed `data/index/json/<corpus>.json`, emits `data/index/html/`. Decoupled from fetch/parse so HTML can regenerate without re-pulling ZIPs.
8. Charter tree: 854 section files + corpus TOC + root TOC + `metadata.json` + `redirects.json`.
9. Tests: `render-section.test.js` (MD byte-stability + MD/HTML block-order parity) and `html-invariants.test.js` (completeness, count parity, no orphans), Charter-scoped.

**Gate to Phase 2:** invariants green; ~10 pages eyeballed (an empty-text chapter, a long section, one heavy with cross-refs, `§ 259`); redirects resolve; `main` size delta measured and recorded.

### Phase 2 — Provenance and commit grammar (new, small)

10. Extend `metadata.json` with per-corpus upstream provenance: source URL, SHA-256 of the fetched ZIP, fetch timestamp, and `sourceCommit`.
11. Adopt structured commit subjects for corpus changes, adapting DC's grammar to our situation — we don't codify, we mirror:
    - `codify: LL 2026/116` — upstream reflects a newly enacted local law
    - `refresh: rules eff. 2026-07-23` — routine upstream republication
    - `technical: …` — corrections to our parsing or rendering, no upstream change
    - `system: …` — build-system changes touching committed output

    Document in `CONTRIBUTING` or the README; enforce loosely (a commit-msg hook is optional and probably not worth it).

### Phase 3 — Publication branches (the payoff)

12. Add a branch-cut step to the **existing** `refresh-data.yml`, after its change-guard commit succeeds:
    - one `publication/YYYY-MM-DD` branch per day on which anything changed
    - skip if the ref already exists (snapshots are immutable)
    - one daily timeline, not per-corpus branches; per-corpus detail lives in the commit body and `metadata.json`
13. Document the retrieval story in the README: how to check out the law as of a date, and what the snapshot does and does not attest.

### Phase 4 — Scale to admin_code + rules (decision point, not automatic)

14. 21,277 additional section files. **Decide first:** image policy (both corpora have `IMAGES/`), and whether `data/index/html/` is excluded from the npm tarball — `package.json` `files` is currently `["dist", "data/index"]`, so HTML would ship to every installer unless narrowed.
15. Extend invariants to all three corpora.

Phase 4 should be its own go/no-go after Phase 1's measured size delta, not a foregone conclusion.

## Critical files and areas

| File / area | Action |
|---|---|
| `scripts/lib/render-section.js` | Create — the anti-drift core |
| `scripts/lib/serialize-markdown.js` | Create — existing MD writer refactored onto core |
| `scripts/lib/serialize-html.js` | Create |
| `scripts/build-html.js` | Create |
| `scripts/build-index.js` | Edit — fan out through the core; `--html` opt-in |
| `scripts/fetch-data.js` | Edit — record ZIP checksums for provenance |
| `.github/workflows/refresh-data.yml` | Edit — add guarded branch-cut step |
| `package.json` | Edit — `build-html` script; decide `files` scoping before Phase 4 |
| `data/index/html/` | Create — committed output tree |
| `docs/plans/` | Replace `html-render-target.md` with this |
| `README.md` | Edit — point-in-time retrieval, provenance scope, commit grammar |

## Risks and open questions

| Risk / question | Mitigation / who decides |
|---|---|
| **Repo weight.** ~22k committed HTML files on `main`; each formatting change rewrites many. | Phase 1 measures Charter's delta before Phase 4 commits to the rest. Snapshot *branches* are near-free (shared blobs) — the growth is on `main`. |
| **npm tarball bloat.** `files: ["dist", "data/index"]` publishes HTML to every installer. | Decide before Phase 4. Recommend narrowing to `data/index/json` + `data/index/markdown`. **Noel decides.** |
| **Publication branch proliferation.** DC has 100+ and counting. | Acceptable — that *is* the feature. Branches are cheap; consider annual tags if navigation degrades. |
| **Snapshot misread as authoritative.** Someone cites a BetaNYC publication branch as the law. | README and rendered footer state the mirror's status explicitly; provenance metadata names AML as source. Non-negotiable copy, not a nicety. |
| **Styling.** AML's CSS is theirs and drifts. | Ship one small BetaNYC stylesheet; semantic class-annotated HTML. Carried from June §13(1). |
| **Cross-references stay unlinked in v1.** | Known; `destination-id` capture is a parser change, filed separately. |
| **Images.** Both large corpora have them; records carry no image field today. | Phase 4 decision. Placeholders/alt-text likely, not committed binaries. |
| **CC0?** DC licenses everything CC0. Our repo has its own LICENSE. | Separate decision, not blocking. Worth asking whether derived index files should be CC0 regardless. |

## Acceptance criteria

- [ ] Half A landed; `data/` rebuilds byte-identical
- [ ] `renderSection` core exists; Markdown output byte-identical to pre-refactor
- [ ] MD and HTML provably emit the same block order (test, not assertion)
- [ ] Charter: 854 HTML files, no orphans, count parity with `versions.json`
- [ ] `metadata.json` carries generator version, source commit, and upstream ZIP SHA-256 per corpus
- [ ] `redirects.json` resolves every Charter citation slug; zero unexpected collisions
- [ ] `refresh-data.yml` cuts exactly one `publication/<date>` branch on a changed day, none on an unchanged day, and never re-cuts an existing ref
- [ ] README documents point-in-time retrieval and states the mirror's provenance scope
- [ ] MCP tool surface unchanged — existing tests green

## Verification steps

1. `npm run build && npm test` — full suite green on the Node 20/22 matrix.
2. Rebuild twice with no upstream change; `git status` clean both times (idempotence).
3. Manually trigger `refresh-data.yml` twice in a row: first run may commit + branch, second must be a no-op with no duplicate branch.
4. Check out a `publication/<date>` branch and confirm `data/index/json/charter.json` matches that date's `metadata.json` checksums.
5. Spot-check 10 Charter pages by eye against `codelibrary.amlegal.com`.
6. `npm pack --dry-run` — confirm the tarball contains what we intended and nothing more.

## Effort estimate

| Phase | Estimate |
|---|---|
| 0 — prepare + Half A | ½ day |
| 1 — Charter render + tests | 2–3 days |
| 2 — provenance + commit grammar | ½ day |
| 3 — publication branches | ½–1 day |
| **Subtotal to a working point-in-time archive for Charter** | **~4–5 days** |
| 4 — scale to all corpora | separate go/no-go |

## Open questions for review

1. ~~**Repo scope**~~ — **RESOLVED 2026-08-06 (Noel): single repo.** Not revisited unless the repo becomes unwieldy.
2. **npm `files`** — exclude `data/index/html/` from the published package? (Recommend yes.) *Blocks Phase 4 only.*
3. **Phase 4 appetite** — is the goal all three corpora eventually, or is Charter-with-history genuinely enough for now? *Blocks Phase 4 only.*
4. **CC0** — worth aligning the derived index with DC's licensing posture, or leave the existing LICENSE alone? *Non-blocking.*

None of the remaining questions block Phases 0–3.
