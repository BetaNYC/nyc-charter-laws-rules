# What's changed

This page lists the changes to nyc-charter-laws-rules that a reader would notice: new tools, changes to how the law text reaches you, and corrections when the server gave a wrong answer. Newest first.

- **History begins:** 2026-05-21, the first release. Corrections made before this date may be missing.
- **Data refresh:** Every morning, from American Legal Publishing's bulk files of the Charter, the Administrative Code and the Rules. When the text has changed, a new version of the package is published the same day. Those daily updates are not listed here. [CHANGELOG.md](CHANGELOG.md) lists every one, with the date each document is current through, and [RELEASES.md](RELEASES.md) lists every release.

To report a bug in this server or ask for a new feature, [open an issue on GitHub](https://github.com/BetaNYC/nyc-charter-laws-rules/issues).

## Unreleased: Ask where the law text comes from

- **Tags:** MCP
- **What changed:** A new tool, about_data, answers "where does this text come from?" Ask your AI assistant and it can say that the Charter, the Administrative Code and the Rules come from American Legal Publishing's code library for the City, the site the NYC Law Department contracted for. It also says that BetaNYC reformats and cleans up the text, so it is not the official text; when this server last read each document; where to check a section against the official site; and how to report a mistake in the law text or in this server. For questions about the data, write to BetaNYC at lab@beta.nyc.
- **Who it affects:** Anyone who quotes or cites the law text from this server, such as journalists and community board staff.
- **MCP version:** [nyc-charter-laws-rules 0.6.0](RELEASES.md)
- **More detail:** [Where the data comes from](DATA-SOURCES.json) · [Release notes](RELEASES.md)

## 2026-11-13: Two tools that explain the server and list what changed

- **Tags:** MCP
- **What changed:** Two new tools let your AI assistant answer "what changed in this server?" from this page, and "who built this?" with links to BetaNYC and to the place to report a bug in this server or ask for a new feature. This page is new too. It lists the changes a reader would notice, back to the first release.
- **MCP version:** [nyc-charter-laws-rules 0.5.0](RELEASES.md#v050--2026-11-13)
- **More detail:** [Release notes](RELEASES.md)

## 2026-10-31: New law text now reaches the npm package on its own

- **Tags:** MCP, Data
- **What changed:** When the morning check finds new law text, a new version of the package is now published with it the same day. Before this, an install from npm carried the text from the day of the last hand release; in September 2026 that was about 30 local laws behind. The get_version tool has always said how current the text you are using is.
- **Who it affects:** Anyone who installs the server from npm.
- **MCP version:** [nyc-charter-laws-rules 0.4.1](RELEASES.md#v041--2026-10-31)
- **More detail:** [How releases work](README.md#releases) · [Every release since](RELEASES.md) · [The pull request](https://github.com/BetaNYC/nyc-charter-laws-rules/pull/29)

## 2026-10-21: A shorter disclaimer, and search that understands questions

- **Tags:** MCP
- **What changed:** Every answer used to end with the full legal disclaimer, about 1,170 characters. Now the first answer after the server starts carries it and later answers end with one line, "Not legal advice," with a link to the text on American Legal Publishing's site; a setting brings back the full text every time. Plain-language questions such as "How long can a sidewalk shed stay up?" used to find nothing, and search now drops words like "how" and "can", looks for the rest, and says when it has done so.
- **MCP version:** [nyc-charter-laws-rules 0.4.0](RELEASES.md#v040--2026-10-21)
- **More detail:** [Release notes](RELEASES.md#v040--2026-10-21) · [The disclaimer issue](https://github.com/BetaNYC/nyc-charter-laws-rules/issues/25) · [The search issue](https://github.com/BetaNYC/nyc-charter-laws-rules/issues/30)

## 2026-10-11: Current law text without waiting for a release

- **Tags:** MCP, Data
- **What changed:** A new setting lets the server read the law text from a folder you keep up to date, such as a copy of this repository, instead of the text that came with the package. This release also brought the packaged text up to date: version 0.2.0 had carried Charter text through Local Law 2026/112. A user doing legislative research asked for this.
- **MCP version:** [nyc-charter-laws-rules 0.3.0](RELEASES.md#v030--2026-10-11)
- **More detail:** [How to use it](README.md#getting-current-law-text-nyc_laws_index_dir) · [The issue](https://github.com/BetaNYC/nyc-charter-laws-rules/issues/26) · [Release notes](RELEASES.md#v030--2026-10-11)

## 2026-10-11: Subdivision letters and numbers ran into the next word

- **Tags:** MCP, Data, Correction
- **What changed:** Until October 11, 2026, many sections showed a subdivision label joined to the word after it, as in Charter § 259, "a.There shall be". Before the fix, 333 Charter, 3,122 Administrative Code and 192 Rules sections had a label like this. Version 0.3.0 puts a space after the label; the words of the law did not change.
- **If you used the old numbers:** The words were right, but it was easy to misread where a subdivision starts. If you quoted or cited a subdivision from text you got before October 11, 2026, check it against the current text or the text on American Legal Publishing's site.
- **MCP version:** [nyc-charter-laws-rules 0.3.0](RELEASES.md#v030--2026-10-11)
- **More detail:** [The issue](https://github.com/BetaNYC/nyc-charter-laws-rules/issues/27) · [The fix](https://github.com/BetaNYC/nyc-charter-laws-rules/pull/28) · [Release notes](RELEASES.md#v030--2026-10-11)

## 2026-07-21: Tools ignored settings they did not have, without saying so

- **Tags:** MCP, Correction
- **What changed:** From May 21 to July 21, 2026, when an AI assistant passed a setting a tool does not have, the tool dropped it without saying so. The answer looked right but could answer a different question. Version 0.2.0 refuses the call and names the settings the tool does accept.
- **If you used the old numbers:** We know of no wrong answer this caused. If you asked a question then that named something a tool could not filter on, ask it again with the current version.
- **MCP version:** [nyc-charter-laws-rules 0.2.0](RELEASES.md#v020--2026-07-21)
- **More detail:** [The issue](https://github.com/BetaNYC/nyc-charter-laws-rules/issues/19) · [The fix](https://github.com/BetaNYC/nyc-charter-laws-rules/pull/20)

## 2026-07-06: Better search ranking and section lookup

- **Tags:** MCP
- **What changed:** Search results are ranked, with matches in a section's heading first, so results from the Administrative Code and the Rules are no longer crowded out. Looking up a section works with or without the § sign, can be limited to one of the three documents, and lists every match when the same number is used in more than one place. The get_version tool now gives each document's own date.
- **MCP version:** [nyc-charter-laws-rules 0.1.3](RELEASES.md#v013--2026-07-06)
- **More detail:** [Release notes](RELEASES.md#v013--2026-07-06) · [The pull request](https://github.com/BetaNYC/nyc-charter-laws-rules/pull/16)

## 2026-07-06: Sections with a decimal in their number were filed under the wrong number

- **Tags:** MCP, Data, Correction
- **What changed:** From May 21 to July 6, 2026, a section number with a decimal part lost it: Administrative Code § 11-602.1 was filed as § 11-602, the number of a different section. Version 0.1.3 keeps the full number, and a lookup now lists every section that shares a number instead of returning the first one it finds. The fix changed section numbers only, not section text.
- **If you used the old numbers:** If you looked up a section by its number in that period, check that the answer was the section you asked for, especially for a number with a decimal part, like 11-602.1, or a Rules section number that more than one title uses.
- **MCP version:** [nyc-charter-laws-rules 0.1.3](RELEASES.md#v013--2026-07-06)
- **More detail:** [The fix](https://github.com/BetaNYC/nyc-charter-laws-rules/pull/16) · [Release notes](RELEASES.md#v013--2026-07-06)

## 2026-07-06: A request for Chapter 1 also returned Chapter 10

- **Tags:** MCP, Correction
- **What changed:** Until July 6, 2026, asking the server for the sections of a chapter or title also matched any chapter or title whose name began the same way, so a request for Chapter 1 also returned sections of Chapter 10, a chapter nobody asked for. Version 0.1.3 matches the whole chapter or title name.
- **If you used the old numbers:** If you asked for a chapter or title in that period, check which chapter or title each section in the answer came from, and set aside any you did not ask for.
- **MCP version:** [nyc-charter-laws-rules 0.1.3](RELEASES.md#v013--2026-07-06)
- **More detail:** [Release notes](RELEASES.md#v013--2026-07-06) · [The fix](https://github.com/BetaNYC/nyc-charter-laws-rules/pull/16)

## 2026-07-06: Law text had cross-references out of place, wrong section numbers, stray codes

- **Tags:** MCP, Data, Correction
- **What changed:** From May 21 to July 6, 2026, the law text from the server moved the words of a cross-reference to the end of the paragraph, so in Charter § 292 "established pursuant to section two hundred ninety-eight of this chapter" read "established pursuant to sectionof this chapter". Some section numbers inside the text were turned into wrong ones: in Rules § 59E-02, "RCNY § 59E-08" read "RCNY § 5.9e-7". The text also carried leftover formatting codes and American Legal Publishing's editorial markers, and numbered items ran into the next word, so in Charter § 1043 "a. Authority. 1. Each agency" read "a. Authority. [ALP S-054] 1Each agency" and a stray formatting code before the marker.
- **If you used the old numbers:** If you quoted or cited law text from this server in that period, compare it with the current text or the text on American Legal Publishing's site. Check every section number cited inside the quoted text, not only the sentences that refer to another section. The copy of the text in this repository was fixed on June 3, 2026; the npm package got the fix in version 0.1.3.
- **MCP version:** [nyc-charter-laws-rules 0.1.3](RELEASES.md#v013--2026-07-06)
- **More detail:** [The issue](https://github.com/BetaNYC/nyc-charter-laws-rules/issues/3) · [The fix for cross-references](https://github.com/BetaNYC/nyc-charter-laws-rules/pull/4) · [The fix for numbers, codes and markers](https://github.com/BetaNYC/nyc-charter-laws-rules/pull/9)

## 2026-06-17: The law text in this repository is checked every morning

- **Tags:** Data
- **What changed:** A daily job checks American Legal Publishing's bulk files and saves any new law text to this repository, with a dated entry in CHANGELOG.md. The npm package got the new text only at its next release until October 31, 2026, when releases with new text became automatic.
- **More detail:** [The pull request](https://github.com/BetaNYC/nyc-charter-laws-rules/pull/11) · [Every update to the text](CHANGELOG.md)

## 2026-05-21: First release: search and read the Charter, Administrative Code and Rules

- **Tags:** MCP
- **What changed:** The first version on npm had five tools: search the three documents, read a section by its citation, list the chapters or titles of a document, read every section in a chapter or title, and say how current each document is. The law text comes from American Legal Publishing's bulk files and ships with the package. The code was on GitHub from May 19.
- **MCP version:** [nyc-charter-laws-rules 0.1.0](RELEASES.md#v010--2026-05-21)
- **More detail:** [Release notes](RELEASES.md#v010--2026-05-21) · [The package on npm](https://www.npmjs.com/package/@betanyc/nyc-charter-laws-rules)
