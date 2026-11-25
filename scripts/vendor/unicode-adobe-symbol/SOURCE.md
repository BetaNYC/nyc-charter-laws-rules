---
title: "Vendored Adobe Symbol to Unicode mapping"
created: 2026-11-25
type: reference
status: active
tags: [type/reference, domain/engineering]
---

# Vendored Adobe Symbol to Unicode mapping

`symbol.txt` is an unchanged copy of the Unicode Consortium's mapping table for the Adobe
Symbol font, "Adobe Symbol Encoding to Unicode", table version 1.0, dated 2011 July 12:

- Source: <https://unicode.org/Public/MAPPINGS/VENDORS/ADOBE/symbol.txt>
- Fetched 2026-11-25 (`Last-Modified: Tue, 12 Jul 2011 19:29:29 GMT`)
- sha256 `deb78ca840a429311939b9d165890873f71fb23ef223ceeb144a6c6d641a7e52`

Terms: the file's own header, kept with it as it asks. Unicode, Inc. grants the right to use
the information in it freely and to copy it in any form, as long as the notice stays attached.
It is provided as-is, with no warranty.

## What uses it

`scripts/lib/symbol-font.js` (issue #88). American Legal Publishing's XML sets some text in the
old Symbol font (`<CHARFORMAT font-name="Symbol" character-set="symbol">`), which puts Greek
letters and math signs on ordinary code points: the XML has `³` where the page shows `≥`. The
index build reads this table to turn the text inside those runs into the Unicode character the
font draws. Text in any other font is left alone.

The table is written Unicode → Symbol, and four Symbol codes have two Unicode values
(`0x20` space and no-break space, `0x44` Delta and increment, `0x57` Omega and ohm,
`0x6D` mu and micro, `0xA4` fraction slash and division slash). The build uses the one that
Unicode normalization (NFKC) leaves unchanged, and the first in the file when both are: space,
Greek capital delta, Greek capital omega, Greek small mu, fraction slash. The 29 codes the
table puts in the Corporate Use Subarea (private-use code points, marked `(CUS)`) are not
mapped, because a private-use character means nothing to a reader; the build reports any it
meets instead.

To update: replace `symbol.txt` with the new version, update the date and hash above, rebuild
the index and check `test/symbol-font.test.js`.
