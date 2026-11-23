# Frame from BetaNYC's Pages template

These files are copies, unchanged, of `docs/assets/` in
[BetaNYC/betanyc-pages-template](https://github.com/BetaNYC/betanyc-pages-template) at `main`
commit `afe97dd` (2026-11-22, the merge of PR #1, which includes "Apply QA fixes to the menu
and focus styles", 3b282b8):

| File | sha256 |
|---|---|
| `site.css` | `74303eb9bf5ed94787547a09639cf6015185ead7b3cbba99867895277d150f93` |
| `nav.js` | `a7b522bbd806bdd18a88ae2f31ca36e30e8d1df412d9177de5a5468ce19056f1` |
| `betanyc-wordmark-white.svg` | `77c39b18bac8aa587f3f0810b68f6393d7c12947cb6ace3698e4afbf786ccf89` |
| `betanyc-wordmark-blue.svg` | `52cd07752b34d932dca0441bfa4b3347afe59290430ccf9275937e67ace785e9` |
| `favicon.svg` | `16da08b628223df1a6d810b796ea1ebda9322b855a4a0401d5862acd792530b7` |

Do not edit them here. To take a template update, copy the new files over these, update the
table, and run `npm test` (`test/site-build.test.js` checks the hashes, so an edit made here by
mistake fails the build) and `npm run test:site`:

```sh
for f in site.css nav.js betanyc-wordmark-white.svg betanyc-wordmark-blue.svg favicon.svg; do
  gh api "repos/BetaNYC/betanyc-pages-template/contents/docs/assets/$f" --jq .content | base64 -d > "site/template/$f"
done
```

Anything the law site needs beyond the template lives in `site/assets/law.css`, which names no
colors: it uses only the template's variables, so `site.css` stays the one file that names a color.
The BetaNYC logos are BetaNYC's marks and are not covered by the MIT license.
