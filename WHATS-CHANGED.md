# What's changed

This page lists the changes to nyc-charter-laws-rules that a reader would notice: new tools, changes to how the law text reaches you, and corrections when the server gave a wrong answer. Newest first.

- **History begins:** 2026-05-21, the first release. Corrections made before this date may be missing.
- **Data refresh:** Every morning, from American Legal Publishing's bulk files of the Charter, the Administrative Code and the Rules. When the text has changed, a new version of the package is published the same day. Those daily updates are not listed here. [CHANGELOG.md](CHANGELOG.md) lists every one, with the date each document is current through, and [RELEASES.md](RELEASES.md) lists every release.

To report a bug in this server or ask for a new feature, [open an issue on GitHub](https://github.com/BetaNYC/nyc-charter-laws-rules/issues).

## 2026-11-24: Missing building and fire code text and appendices, and wrong chapter lists

- **Tags:** MCP, Data, Correction
- **What changed:** Since the first release on May 21, 2026, this server did not read all of the text in American Legal Publishing's files of the Administrative Code and the Rules. In the July 2026 files, 1,375 sections of the City's building and fire codes (the Building, Fire, Plumbing, Mechanical, Fuel Gas, Electrical and Existing Building codes) were missing some or all of their text, because those codes keep most of a section's words in numbered subsections, such as "80.1 Title." in Section EC 80. So were 90 Rules sections, text that sits outside any section (the 1968 Building Code's reference standards such as RS 18-1, Rules appendices and schedules such as the Water Board's rate schedule, and the Health Code's Board of Health resolutions), and Building Code section BC 602, which was skipped because its heading was blank. Since version 0.6.0 (November 19, 2026), asking get_title for a chapter could also list records that belong elsewhere, such as the Charter's Preamble under Chapter 64 and the Health Code under Rules Chapter 21. Each title of the Rules numbers its own chapters and sections, so in the July 2026 files 50 titles each have a § 1-01, and asking for § 1-01 gave a list with nothing but the headings to tell which agency's rule each was. You can now ask by title, the way the Rules are cited: "15 RCNY § 1-01", "Title 15 § 1-01", or "24 RCNY Health Code § 81.08". Answers name the title and its agency, and the list of Rules chapters is grouped by title ("Title 15, Chapter 18"). Asking get_title for an Administrative Code title such as Title 16 also listed Titles 16-A and 16-B, which share its section numbers; each lettered title is now its own, and a title now lists all of its chapters. The list of Rules chapters now also has the Health Code, the Rent Guidelines Board's yearly orders and the Rules' appendices, which have no chapter number. A citation copied from the BetaNYC Law Reader website, such as "NYC Administrative Code § 27-506" or "NYC Charter § 1133", now works in get_section, which looks only in the book it names. A citation of a part of a section, such as "§ 1133(b)(1)" or "Section FC 102.4(1)", now returns the whole section, with a first line that names the part you asked for. The law did not change: these are fixes to how BetaNYC reads the publisher's files.
- **If you used the old numbers:** If this server told you a building or fire code section had no text, or a search found nothing in these codes, the appendices or the Health Code's resolutions, ask again with version 0.7.0 or later. If you quoted or summarized one of these sections before this release, check it against American Legal Publishing's site: 19 Administrative Code sections and 16 Rules sections came back with only part of their text. If you listed a chapter with get_title since November 19, 2026, list it again. Charter Chapters 25 and 64, Rules Chapter 21, Administrative Code Title 28 Chapter 3, and 26 other Administrative Code chapters that each also listed a year of local laws included records from elsewhere. If you listed an Administrative Code title with get_title since November 19, 2026, list it again. Titles 16, 20 and 21 also held Titles 16-A and 16-B, 20-A and 21-A. Some titles left out chapters. In the July 2026 files, Title 29 (the Fire Code) listed 5 records instead of 417, Title 28 left out the Building Code's Chapters K1 to K3, Title 31 listed nothing, and Titles 8, 26 and 27 each left out a chapter or two. If you took a Rules section from a list of several with the same number, check that it is from the right agency's title. Other text is unchanged, except that BetaNYC now takes § 21-905's title from its first line, because the publisher's heading gives only the number. Search results may come in a different order, since there is more text to search. Still not included: pictures, which have no text in the publisher's files, and notes on a whole title. This server's text is BetaNYC's modified copy, not the official text.
- **Who it affects:** Anyone who looks up the building and fire codes, the Rules' appendices and schedules, or the Health Code through this server, anyone who cites the Rules, and anyone who listed a chapter with get_title since November 19, 2026.
- **MCP version:** [nyc-charter-laws-rules 0.7.0](RELEASES.md#v070--2026-11-24)
- **More detail:** [Missing subsection text](https://github.com/BetaNYC/nyc-charter-laws-rules/issues/76) · [Text outside sections](https://github.com/BetaNYC/nyc-charter-laws-rules/issues/78) · [Rules titles](https://github.com/BetaNYC/nyc-charter-laws-rules/issues/59) · [Release notes](RELEASES.md)

## 2026-11-19: Ask where the law text comes from

- **Tags:** MCP
- **What changed:** A new tool, about_data, answers "where does this text come from?" Ask your AI assistant and it can say that the Charter, the Administrative Code and the Rules come from American Legal Publishing's code library for the City, the site the NYC Law Department contracted for. It also says that BetaNYC reformats and cleans up the text, so it is not the official text; when this server last read each document; where to check a section against the official site; and how to report a mistake in the law text or in this server. For questions about the data, write to BetaNYC at lab@beta.nyc. Every answer from the law text now also ends with where it came from, even when nothing was found: that BetaNYC converted the text and how (so a section's citation, worked out by BetaNYC, can be wrong), the date of the copy this server answers from, the official record at American Legal Publishing with a link to check it, and the publisher's own "current through" line, as the publisher gives it. Long lists say how many there are and how to get the rest: a search says how many sections matched, not only the first ten, and says when a snippet is cut short. Search results for a plain-language question are ranked differently: rare words and words in a section's heading count most, so a long definitions section no longer wins just because it holds every word. Such a search says how many sections contain every word and how many only some. About 1,900 Administrative Code records, such as Local Law texts, showed a cut-short citation like "L"; the next daily data update gives them their full label, such as "L.L. 2016/002". Asking for a chapter now lists the sections in it, not only the chapter's name, and asking for an Administrative Code title, such as Title 6, lists its chapters and sections instead of finding nothing. The list of chapters is now in order, with whole chapter numbers such as 18-A. Lists longer than 200, such as the Administrative Code and the Rules, now come in pages of 200.
- **Who it affects:** Anyone who quotes or cites the law text from this server, such as journalists and community board staff.
- **MCP version:** [nyc-charter-laws-rules 0.6.0](RELEASES.md#v060--2026-11-19)
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
