# Picture descriptions (`data/alt-text/`)

Text descriptions for the pictures in New York City's Administrative Code and Rules (issue #87).

**BetaNYC writes these, not American Legal Publishing.** An AI model drafts each one, and a person at BetaNYC reviews it. They are not part of the law's text and are not an official record. American Legal's files have no descriptions for their pictures (checked 2026-11-25: none in the XML or the image files' metadata, and none on the two pages of the live code library a person checked; issue #87).

## Files

- `admin_code.json` and `rules.json`: one file per book. Each entry is keyed by the **sha256 of the image file**. If American Legal replaces a picture, the new file has a new hash, so the old description no longer matches it. `npm run alt:inventory` lists such stale entries. Nothing is deleted on its own.
- Each entry has: `image_ids` (the file names in the zip's `IMAGES/` folder; byte-identical copies share one entry), `picture_ids` (the `<PICTURE>` tags that show it), `citation` and `citations` (where it appears), `status` (`drafted`, `needs-work` or `reviewed`), `draft` (the AI text: `alt`, `long`, `unsure`), `draft_model`, `drafted_at`, `draft_failed` (only when the last AI draft failed: `reason`, `model`, `at`, and no text; `alt:draft` skips the picture until `--retry-failed`, and a later draft removes it), `review` (the person's text: `alt`, `long`, and an optional private `note`), `reviewed_at` and `updated_at`.
- Only `reviewed` entries are shown to readers: law.beta.nyc/describe-pictures/ (built by `npm run build-site`) shows a `reviewed` entry's `review` text and never an AI `draft`. The `note` is never published.

The files are written by the tool (`scripts/alt-text.js`), with a fixed key order, so a change shows up as a small diff. Saving takes a lock file (`<book>.json.lock`) and replaces the file in one step. A lock left by a crashed process is taken over after 30 seconds, under a second short lock (`<book>.json.lock.takeover`) so two waiters cannot both take it. The locks and any temp file are git-ignored.

## Commands

See [README.md § Picture descriptions](../../README.md#picture-descriptions-alt-text-issue-87).
