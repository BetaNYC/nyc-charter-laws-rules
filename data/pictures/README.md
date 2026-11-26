# Pictures for the Law Reader (`data/pictures/`)

The pictures in New York City's Administrative Code and Rules that law.beta.nyc shows on
[/describe-pictures/](https://law.beta.nyc/describe-pictures/), where anyone can suggest a text
description (issue #87).

**The image files are American Legal Publishing's**, copied unchanged from its XML zips, except that
the two BMP files are stored as PNG so browsers show them. They are not BetaNYC's work and not
covered by this repository's MIT license. BetaNYC's descriptions of them live in
[`data/alt-text/`](../alt-text/README.md).

- `images/<sha256>.<ext>`: one file per distinct picture, named by the sha256 of the publisher's file.
- `admin_code.json`, `rules.json`: each book's inventory: the image ids, size, and every place the
  picture is used, with its citation, section and the text around it; and the stored file's name,
  size and sha256.

Written by `npm run alt:images` from `data/raw/<book>.zip` (the daily refresh runs it after
`build-index`). Do not edit by hand. `npm run build-site` checks every file against its sha256 and
stops when one is missing or changed. Not in the npm package. See
[README.md § Picture descriptions](../../README.md#picture-descriptions-alt-text-issue-87).
