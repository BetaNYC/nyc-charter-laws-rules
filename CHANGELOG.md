# Changelog

Tracks every index rebuild of the NYC Charter, Administrative Code, and Rules of the City of New York.
Each entry records which corpus version was current at the time of the build.

"Changed" means the `currentThrough` version string advanced since the prior build.

---

## 2026-06-02 (test: Layer 4 differential)

**Branch:** `test/differential-parser` (PR-C)  
**No index rebuild** — test infrastructure only.

Added the Layer 4 differential parser test (`npm run test:diff`): compares JS extraction against Python stdlib `xml.etree` + `itertext()` over 44 committed charter XML fixtures. 393 sections compared; 393 agreed. Also added `test:diff` script to `package.json`, Python harness at `test/fixtures/diff/extract_itertext.py`, committed XML fixtures at `test/fixtures/diff/xml/`, and nightly dispatch CI job at `.github/workflows/differential.yml`.

---

## 2026-06-02

**Index built:** 2026-06-02T04:46:39.537Z  
**Status:** ⬆️ **Updated**

| Corpus | Current through | Sections | Changed |
|---|---|---|---|
| NYC Charter | Current through Local Law 2026/094, enacted May 16, 2026,and includes amendments effective through May 28, 2026. | 854 | ✅ Yes |
| NYC Administrative Code | Current through Local Law 2026/094, enacted May 16, 2026,and includes amendments effective through May 28, 2026. | 12,569 | ✅ Yes |
| Rules of the City of New York | Current through rules effective May 31, 2026. | 8,656 | ✅ Yes |

**What changed:**

- **NYC Charter:** Current through Local Law 2026/094, enacted May 16, 2026,and includes amendments effective through May 27, 2026. → Current through Local Law 2026/094, enacted May 16, 2026,and includes amendments effective through May 28, 2026.
- **NYC Administrative Code:** Current through Local Law 2026/094, enacted May 16, 2026,and includes amendments effective through May 27, 2026. → Current through Local Law 2026/094, enacted May 16, 2026,and includes amendments effective through May 28, 2026.
- **Rules of the City of New York:** Current through rules effective May 20, 2026. → Current through rules effective May 31, 2026.

---

## 2026-05-29

**Index built:** 2026-05-29T03:42:19.428Z  
**Status:** ⬆️ **Updated**

| Corpus | Current through | Sections | Changed |
|---|---|---|---|
| NYC Charter | Current through Local Law 2026/094, enacted May 16, 2026,and includes amendments effective through May 27, 2026. | 854 | ✅ Yes |
| NYC Administrative Code | Current through Local Law 2026/094, enacted May 16, 2026,and includes amendments effective through May 27, 2026. | 12,558 | ✅ Yes |
| Rules of the City of New York | Current through rules effective May 20, 2026. | 8,645 | — |

**What changed:**

- **NYC Charter:** Current through Local Law 2026/094, enacted May 16, 2026,and includes amendments effective through May 17, 2026. → Current through Local Law 2026/094, enacted May 16, 2026,and includes amendments effective through May 27, 2026.
- **NYC Administrative Code:** Current through Local Law 2026/094, enacted May 16, 2026,and includes amendments effective through May 17, 2026. → Current through Local Law 2026/094, enacted May 16, 2026,and includes amendments effective through May 27, 2026.

---

## 2026-05-26

**Index built:** 2026-05-26T20:43:15.119Z  
**Status:** ✓ No change

| Corpus | Current through | Sections | Changed |
|---|---|---|---|
| NYC Charter | Current through Local Law 2026/094, enacted May 16, 2026,and includes amendments effective through May 17, 2026. | 854 | — |
| NYC Administrative Code | Current through Local Law 2026/094, enacted May 16, 2026,and includes amendments effective through May 17, 2026. | 12,558 | — |
| Rules of the City of New York | Current through rules effective May 20, 2026. | 8,645 | — |

---

## 2026-05-26

**Index built:** 2026-05-26T19:02:21.570Z  
**Status:** ✓ No change

| Corpus | Current through | Sections | Changed |
|---|---|---|---|
| NYC Charter | Current through Local Law 2026/094, enacted May 16, 2026,and includes amendments effective through May 17, 2026. | 854 | — |
| NYC Administrative Code | Current through Local Law 2026/094, enacted May 16, 2026,and includes amendments effective through May 17, 2026. | 12,558 | — |
| Rules of the City of New York | Current through rules effective May 20, 2026. | 8,645 | — |

---

## 2026-05-26

**Index built:** 2026-05-26T01:30:51.847Z  
**Status:** ✓ No change

| Corpus | Current through | Sections | Changed |
|---|---|---|---|
| NYC Charter | Current through Local Law 2026/094, enacted May 16, 2026,and includes amendments effective through May 17, 2026. | 854 | — |
| NYC Administrative Code | Current through Local Law 2026/094, enacted May 16, 2026,and includes amendments effective through May 17, 2026. | 12,558 | — |
| Rules of the City of New York | Current through rules effective May 20, 2026. | 8,645 | — |

---
