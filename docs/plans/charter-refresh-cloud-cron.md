# Implementation Plan: charter daily refresh (GitHub Actions cron)

**Status:** Proposed (plan only — not yet implemented; uncommitted working doc)
**Author:** BetaNYC software-engineer agent
**Created:** 2026-06-17
**Closes:** issue #2 (`feat: GitHub Actions cron to auto-refresh index and update changelog`)
**Tracking issues:** relates to #2; the daily snapshot branch-cut in `docs/plans/html-render-target.md` §10 wires onto this same workflow later.

> **Doc-location note.** Follows the `docs/plans/` convention established by
> `docs/plans/html-render-target.md`: plain Markdown, no YAML frontmatter. This is
> a review doc only — left uncommitted. The eventual `.github/workflows/refresh-data.yml`
> ships as a normal PR in this repo once this plan is approved.

---

## 1. Goal and non-goals

### Goal
Add `.github/workflows/refresh-data.yml` — a daily GitHub Actions workflow that
runs the full index-refresh pipeline (`fetch-data` → `build-index` →
`update-changelog`), runs the test suite, and **commits the refreshed index back
to `main` only when a corpus version actually advanced**. This is the **cloud**
half of BetaNYC's MCP-refresh automation: charter's index is a committed artifact
in this public repo, so its refresh runs in CI with no operator machine involved.

### Non-goals (explicit)
- **council and nys are out of scope.** Their data lives only on the operator's
  Mac (`~/legistar/legistar.db`, `data/corpus.db`) and is automated separately
  via macOS `launchd` (workspace plan
  `people/noel/work/2026-06-17-local-mcp-refresh-morning-plan.md`). The two
  operations are independent and can ship in either order; charter (this plan)
  is the lower-risk first.
- **record and checkbook MCPs** are pure live-API — nothing to refresh.
- **No HTML render target here.** The `--html` branch-cut and `publication/<date>`
  snapshot (html-render-target plan §10) layer onto this workflow *after* it
  exists; not built in this plan.
- **No new dependencies, no source changes.** This plan adds one YAML file. The
  npm scripts it calls (`fetch-data`, `build-index`, `update-changelog`, `test`)
  already exist (`package.json`).

---

## 2. How the pipeline behaves today (verified on disk, 2026-06-17)

```
npm run fetch-data        → scripts/fetch-data.js   → downloads AML bulk ZIPs to data/raw/ (gitignored, ephemeral)
npm run build-index       → scripts/build-index.js  → parses XML → writes:
                              data/index/json/<corpus>.json     (committed; MCP reads this)
                              data/index/json/versions.json     (committed)
                              data/index/markdown/<corpus>.md   (committed)
npm run update-changelog  → scripts/update-changelog.js → updates data/changelog.json,
                              CHANGELOG.md, and re-stamps README.md "Last index update" block
```

Verified facts that drive the guard design:

| Fact | Evidence |
|---|---|
| `versions.json` carries `currentThrough` per corpus | live file: `charter.currentThrough = "Current through Local Law 2026/110, enacted June 13, 2026,"` |
| `versions.json` ALSO carries `indexedAt` — a fresh ISO timestamp **every build** | `charter.indexedAt = "2026-06-17T13:37:02.407Z"` — churns on every run even with no version change |
| `update-changelog.js` prints `⬆️  Version change detected:` on a real bump, `✓ No version change` otherwise, and sets `entry.changed` accordingly (diffs `currentThrough` against the prior changelog entry) | `scripts/update-changelog.js` lines 110–113, 201–212 |
| `data/changelog.json` and `README.md` are rewritten **every run** (new entry prepended, README re-stamped) regardless of version change | `update-changelog.js` always `unshift`s an entry and calls `stampReadme` |
| `update-changelog.js` `--stamp-only` re-stamps README without appending | lines 27, 74–86 |
| Same-repo push needs no PAT | issue #2: "GITHUB_TOKEN is sufficient for write-back; no branch protection rules currently block it" |

**The churn problem.** Because `indexedAt` (in `versions.json`), the prepended
`changelog.json` entry, and the README stamp all change on *every* run, a naive
`git diff --quiet` would report changes every single day and produce a
timestamp-only commit daily — exactly what the prompt forbids. The guard must key
off **`currentThrough`**, the only field that moves on a real version bump.

> **Update (2026-06-17, branch `fix/eliminate-commit-churn`):** the no-op churn was fixed at the source — `indexedAt`/changelog/README stamps are now preserved on rebuilds with no content change, so a no-op rebuild yields zero `git diff`. The guard below can therefore simplify to a plain `git diff --quiet` (no longer needs to diff `currentThrough` lines specifically). See `scripts/lib/merge-versions.js` and the `build-idempotence` test.

---

## 3. The commit guard (the critical decision)

**Rule:** commit + push to `main` **only when at least one corpus's
`currentThrough` advanced** AND the test suite passed. A timestamp-only / churn
day produces **no commit**.

### Recommended detection: targeted `git diff` on `currentThrough`

After `update-changelog`, compare the rebuilt `versions.json` `currentThrough`
values against the committed (pre-build) ones. Two robust, equivalent options —
**recommend (A)** as the primary signal because it does not depend on parsing
human-readable script stdout:

**(A) `git diff` filtered to the `currentThrough` lines of `versions.json`** —
the field is one JSON line per corpus. Diff the working tree against `HEAD` for
just that file and grep the changed (`+`/`-`) lines for `currentThrough`:

```
changed_versions="$(git diff -- data/index/json/versions.json \
  | grep -E '^[+-][[:space:]]*"currentThrough"' || true)"
```

If `changed_versions` is non-empty → a real version bump → commit. If empty →
only `indexedAt` (and downstream changelog/README) churned → **skip commit**.
This is robust because `currentThrough` is a stable, single-line field and the
check ignores the `indexedAt` churn entirely.

**(B) Corroborate with `update-changelog.js` output / `changelog.json`.**
`update-changelog` already computes `entry.changed`. As a defensive
cross-check, read `data/changelog.json`'s newest entry `.changed` flag (e.g. via
`node -e` or `jq`) and assert it agrees with (A). If they disagree, **fail the
job loudly** rather than guess — a disagreement means the guard's assumptions
broke and a human should look. (A) is the gate; (B) is the tripwire.

> **Why not trust `git diff --quiet` on the whole tree?** It would fire on
> `indexedAt` every day. **Why not trust script stdout alone?** Parsing the
> `⬆️ Version change detected` string is brittle to wording changes; the
> structured `currentThrough` diff (A) plus the `changelog.json .changed` flag
> (B) are both machine-stable.

### On a real change — what gets committed

When (A) fires, stage the legitimate refresh artifacts and commit:

- `data/index/json/<corpus>.json`
- `data/index/json/versions.json`
- `data/index/markdown/<corpus>.md`
- `data/changelog.json`
- `CHANGELOG.md`
- `README.md` (the auto-stamped "Last index update" block — a legitimate refresh
  artifact, per the 2026-06-04 journal note)

**Exclude `package-lock.json`** from the commit (it can churn from `npm ci`
install resolution and is unrelated to a data refresh — matches the manual
`/mcp-refresh-data` playbook). Use an explicit `git add` of the data paths
above (allow-list), **not** `git add -A`, so lockfile churn can never ride along.

**Commit message format:**
```
chore: refresh index YYYY-MM-DD — <what changed>
```
where `<what changed>` is derived from the newest `changelog.json` entry's
per-corpus `previousThrough → currentThrough` deltas (e.g.
`charter LL 2026/108 → LL 2026/110; admin_code LL 2026/108 → LL 2026/110`).
A `node -e` one-liner reading `changelog.json` produces this string; fall back to
a generic `index version bump` if parsing fails (fail-soft on the *message* only,
never on the guard).

### Idempotency

A re-run on an unchanged day is a no-op: `fetch-data`/`build-index` regenerate
identical `currentThrough`, the guard (A) finds no change, nothing is committed.
Safe to run daily, and safe to re-trigger manually the same day. (Per
engineering-standards §6.)

---

## 4. Workflow shape

`.github/workflows/refresh-data.yml`:

- **Triggers:**
  - `schedule:` daily `cron`. Target ~**07:00 ET**. GitHub Actions cron is **UTC
    and can lag several minutes under load**, so pick a UTC value and accept a few
    minutes' drift. **ET is UTC−4 (EDT) / UTC−5 (EST)** — GitHub cron has no
    timezone and does **not** observe DST, so a fixed UTC time shifts by an hour
    across the year. Recommended: `cron: "0 11 * * *"` (11:00 UTC = **07:00 EDT /
    06:00 EST**). Document this in a comment in the YAML. AML publishes
    irregularly, so the exact minute is immaterial; "once each morning" is the
    requirement.
  - `workflow_dispatch:` for manual dry runs (with an optional `reason` input,
    mirroring `differential.yml`).
- **Concurrency guard** — prevent overlapping runs (a slow `fetch-data` must not
  race a second trigger):
  ```yaml
  concurrency:
    group: refresh-data
    cancel-in-progress: false   # let an in-flight refresh finish; queue the next
  ```
  `cancel-in-progress: false` so a running refresh is never killed mid-commit.
- **Permissions** — least privilege, write only what's needed:
  ```yaml
  permissions:
    contents: write   # required to push the refreshed index back to main
  ```
- **Runner:** `ubuntu-latest`. **Node:** `actions/setup-node@v4` with
  `node-version: "22.x"` and `cache: "npm"` (single version is fine — this is an
  *operational* build, not the cross-version *test matrix*; 22.x is the upper end
  of the existing `test.yml` matrix and satisfies `engines.node ">=18"`).

### Step sequence

```
1. actions/checkout@v4                         # committed index is the diff baseline
2. actions/setup-node@v4 (22.x, cache: npm)
3. npm ci                                        # reproducible install from lockfile
4. npm run fetch-data                            # pull AML bulk ZIPs (public, no auth)
5. npm run build-index                           # rebuild json + markdown + versions.json
6. npm run update-changelog                      # changelog.json + CHANGELOG.md + README stamp
7. npm test                                       # full suite (node --test); MUST pass before any commit
8. guard + commit step (§3):
     - compute currentThrough diff (A) + changelog .changed cross-check (B)
     - if changed AND tests passed:
         git add <allow-list>      (NOT -A; excludes package-lock.json)
         git -c user.name=... -c user.email=... commit -m "chore: refresh index <date> — <delta>"
         git push origin main
     - else: echo "no version change — skipping commit" and exit 0
```

Tests (step 7) run **before** the guard/commit so a broken build never reaches
`main`. If `npm test` fails, the job fails red and nothing is committed.

**Commit author identity:** use the GitHub Actions bot identity, e.g.
`github-actions[bot] <41898282+github-actions[bot]@users.noreply.github.com>`,
set inline on the commit (`git -c user.name=... -c user.email=...`) so no global
git config is needed.

---

## 5. Auth

- **Same-repo push uses the built-in `GITHUB_TOKEN`.** With
  `permissions: contents: write`, the default `actions/checkout` token can push to
  `main` — **no PAT, no repository secret, no deploy key needed.** State this
  explicitly so no one provisions a secret that isn't required.
- **The AML fetch is public.** `fetch-data` downloads AML bulk ZIPs over public
  HTTP — no credential. (Contrast: the workspace `nys` refresh needs an API key;
  charter needs none. This is *why* charter is cloud-automatable and nys is not.)
- **Branch protection caveat:** issue #2 confirms no branch-protection rule
  currently blocks the `GITHUB_TOKEN` write-back. If branch protection is added
  later (e.g. required PR reviews on `main`), the auto-push will start failing —
  flagged in §8. The fix at that point is either a `contents: write` bypass for
  the bot or routing the refresh through an auto-merged PR; out of scope now.

---

## 6. Failure handling & visibility

- **Fetch failure → fail loud, no partial commit.** If `fetch-data` errors
  (AML endpoint down/flaky), the step fails red, the job stops *before*
  `build-index`, and nothing is staged or committed. No partial/half-refreshed
  index can land. (Per engineering-standards §6 "fail fast and loud.")
- **Build or test failure → no commit.** Steps 5–7 are gates; any red stops the
  job before §8.
- **Visibility:** a failed scheduled run surfaces in the repo's Actions tab and
  (per the operator's GitHub notification settings) emails the repo admins. No
  extra alerting wired in this plan; if silent scheduled-failure becomes a
  concern, add a failure-only notification step (Slack/issue-open) as a follow-up
  — noted, not built.
- **Structured logs:** each step echoes a one-line marker (script + event +
  per-corpus `currentThrough` + whether a commit was made) so a run is auditable
  from the log alone, without opening the diff.

---

## 7. Testing the workflow

Before relying on the schedule:

1. **Manual `workflow_dispatch` dry run on a no-op day.** Trigger the workflow
   manually when no AML change is expected. Expected: pipeline runs green,
   guard (A) finds no `currentThrough` change, log prints
   `no version change — skipping commit`, **no commit appears on `main`**. This is
   the critical test — it proves timestamp churn does **not** produce a commit.
2. **Verify the guard fires on a real change.** Hard to schedule on demand
   (depends on AML publishing). Two ways to prove the commit path without waiting:
   (a) review the §3 guard logic against a known historical bump (e.g. the
   2026-06-04 LL 2026/094 → LL 2026/102 commit `0f287ef`), confirming the
   `currentThrough` diff would have been non-empty; (b) optionally, in a scratch
   branch, hand-edit the committed `versions.json` `currentThrough` to an older
   value and run the workflow against that branch — the rebuilt newer value
   produces a non-empty diff and exercises the commit/push path end to end. Do
   **not** test the real-change path against `main`.
3. **Confirm the allow-list excludes `package-lock.json`** — inspect the staged
   set in the run log on a real-change run (or the scratch-branch test).

The pre-PR test plan (per workspace branch discipline / engineering-standards §3)
records these as already-run when the workflow ships.

---

## 8. Open questions / risks

1. **AML fetch flakiness.** `fetch-data` depends on AML's public endpoint; a
   transient outage fails the day's run. Mitigation: daily cadence means the next
   day self-heals (idempotent — no partial state). Optional future hardening:
   a bounded retry on `fetch-data`. Surfaced, not built.
2. **GitHub cron drift / DST.** UTC cron does not track ET DST, so the local run
   time shifts an hour seasonally, and Actions cron can lag minutes under load.
   Immaterial for "once each morning"; documented in the YAML comment.
3. **Branch-protection interaction (§5).** If `main` gains required-review
   protection later, the `GITHUB_TOKEN` auto-push breaks. Re-evaluate then.
4. **Guard wording drift.** The cross-check (B) reads the structured
   `changelog.json .changed` flag, not script prose, specifically to survive
   wording changes in `update-changelog.js`. If `update-changelog.js`'s output
   schema changes, revisit (B). (A) — the `currentThrough` diff — is the
   independent primary signal and is unaffected.
5. **"Only-commit-on-change" was the chosen policy** (issue #2 open question);
   the audit trail of every *check* is **not** kept in git. If a full
   check-history audit is later wanted, the html-render-target `publication/<date>`
   branch mechanism or a lightweight run-log artifact could provide it without
   polluting `main` history — noted, not adopted here.

---

## 9. Documentation-currency targets (apply when the workflow ships)

When `refresh-data.yml` is built (PR in this repo):
- **`README.md`** — note the automated daily refresh under the index/build
  section (the file already has the auto-stamped "Last index update" block; add a
  one-line "refreshed daily via GitHub Actions" note).
- **Close issue #2** in the PR (`Closes #2`).
- The `test.yml` / `differential.yml` header comments already reference the
  planned `refresh-data.yml` by name — no rename needed; the chosen filename
  matches.
- No workspace-side docs change is required by this plan (it lives entirely in the
  MCP repo). The workspace `/mcp-refresh-data` command and `scripts/mcp_refresh_data.sh`
  remain the manual path and the `--only=council,nys` local automation target;
  charter simply no longer *needs* the manual path once this lands (worth a
  one-line note in the workspace change-log when both halves are live).
```
