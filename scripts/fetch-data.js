#!/usr/bin/env node
// Downloads the three AML bulk XML ZIPs into data/raw/ over https, checks each one, and
// records what was downloaded in data/fetch-provenance.json (issue #55). The checks are in
// scripts/lib/fetch-zip.js. Run before build-index: npm run fetch-data
//
// Any failed download or check fails the run (issues #39, #55) and replaces no file: carrying
// on would build an index from a document that is missing or not the publisher's.
//
// NYC_CLR_ALLOW_SIZE_CHANGE=<document>[,<document>] accepts a ZIP much smaller or much larger
// than the last good one for those documents only (with a warning), for the day American Legal
// really does change a file's size. Every other check still applies. The daily refresh sets it
// from its manual `allow_size_change` input, for that run only.

import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { fetchAll, parseAllowSizeChange } from "./lib/fetch-zip.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

try {
  await fetchAll({
    rawDir: join(ROOT, "data", "raw"),
    provenancePath: join(ROOT, "data", "fetch-provenance.json"),
    allowSizeChange: parseAllowSizeChange(process.env.NYC_CLR_ALLOW_SIZE_CHANGE),
  });
} catch (e) {
  // fetch() rejects with "fetch failed" and the reason (a TLS or DNS error) in `cause`.
  const cause = e.cause ? ` (${e.cause.code ?? e.cause.message ?? e.cause})` : "";
  console.error(`fetch-data: ${e.message}${cause}`);
  if (e.replaced?.length) {
    // Only a rename failing part way gets here: every check had passed.
    console.error(`fetch-data: already replaced before the failure: ${e.replaced.join(", ")}.`);
    console.error("fetch-data: data/raw/ and data/fetch-provenance.json may not match; run fetch-data again.");
  } else {
    console.error("fetch-data: nothing in data/raw/ or data/fetch-provenance.json was replaced.");
  }
  process.exit(1);
}
