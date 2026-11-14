---
title: "Vendored DCAT-US 3.0 JSON Schema"
created: 2026-11-12
type: reference
status: active
tags: [type/reference, domain/engineering]
---

# Vendored DCAT-US 3.0 JSON Schema

`definitions/` is an unchanged copy of `jsonschema/definitions/` from
[GSA/dcat-us](https://github.com/GSA/dcat-us) at commit
`4996591483b52f4ccc0cb72c42e4ec3fe59a4b06` (2026-10-07, "Merge pull request #180 from
GSA/documentation-updates"), fetched 2026-11-12 with `gh api ... -H "Accept: application/vnd.github.raw"`.
Every file's `$id` is under `https://resources.data.gov/dcat-us/3.0.0/definitions/`.

License: CC0 1.0 Universal, a work of the United States Government (`LICENSE.md`, copied from the same commit).

It is vendored so CI never depends on a live URL changing. CI validates the example `data.json`
against `definitions/Catalog.json` with `scripts/tests/catalog_validate.py dcat`, which loads every
file into a `referencing` registry and validates with `Draft202012Validator`, the way GSA's own
`jsonschema/test_json_schema.py` does at that commit.

To update: fetch the new commit's `jsonschema/definitions/` into `definitions/`, replace this
file's commit, date and the hash list, run the CI job, and record the change in the change-log.

## sha256 of each file

```
86f42cb373dc3df1c870f74847d5b1e2054b0e709f285e051e41491a1f6cc812  AccessRestriction.json
9459c82a914555abfc998d57c9e0004b8fefbe8b9c1321a39f05a12247532214  Activity.json
a71eaee3e1cda731d7724bc5b880f1f7285a668f8250e34c7928c0d63503ab4b  Address.json
c3a8dd6103a0a72af12bbfcf8d8641df5deb71e505176bb6a6e112d1f3d4b636  Agent.json
089eabc39498a08b9459bc8c44e5b8696c2e3055d747a58499cf5ae9df3cafd8  Attribution.json
c380e6ab8625c2cff2bab522ae47d0d9fe210c100304b81181e6c6e9236a3075  CUIRestriction.json
d8fd1a1ef46b2d6af3e12a5af75ba4dbd94243d355d58809fb05840cec7181b8  Catalog.json
3520e634156fb0045a9735a67ba37f7fe18a295bfb6cbd4e505964c9d25f4205  CatalogRecord.json
fb2efdbfec4a620f065c1d16bfe3b2681d7a11203f3da7bc1e937bbf5a177a2d  Checksum.json
86fa9ce21ed5482df8325b5a99157fbd6592623315e14a734e6326be6aee9b2d  Concept.json
52e18b5f0d380f7321346c36688584df5e2cc3f627f17a65d6be631bce657414  ConceptScheme.json
0aef863056fce337af53209cdf89efdd68061c09a9d79d8de480514745a9a428  DataService.json
957f1a33ef25abe0746031b89e91a5914525928617c7ee5259da7241907044a9  Dataset.json
d03477c091d60c8eb5509850b5e73eeb79ea5de9f0bb0a3bca108b2ecb2b1396  DatasetSeries.json
c039f69f8e93e1f13b093a42a0310216bc95ae1a7bfefc8975e3a8fcbf9de2a8  Distribution.json
d270d10e2e97524038aaa00bfdabf90db41609940dc2b054e0d0bcf6edab7172  Document.json
7e8d769d3d6213a63c1bce867e8ab0369c4859d8778e10ce2b0cdab99face543  Identifier.json
06c11ceb9b1cd6646ce808676611e0cb4f4fc95f80b9dd3cf3a5f0027a3d6b54  Kind.json
394363091f89b7eaddf33fc00917e825700deafe2d101c534a7631455b5ac830  Location.json
f0677522d162a9f89c78981e7617eb53e41a6a54106f5ab0599d05292ff9de58  Metric.json
18edc2eaadf8d600d8f1b4e2ec27e46562c2b6404779d92d88f6a65562a5f143  Organization.json
16c2580806d91791842eed877f5d44053e1295ba0ded389e88491d5ceb58d14b  PeriodOfTime.json
b31bdfeaf59e9e087e2e21f1d94f4ff236777a66b75b98a2ea185e89607fcc21  QualityMeasurement.json
c2f470e8a900cffff02756e53b6d78c2725f6cba0e7197182da329a433f0b6f2  Relationship.json
17696088895efe91f409a5e27f4cbedce19cc4f0b3a6d2b6b9258489a8d762ca  Standard.json
dc32705962486f2170dd515c8f53b2e33e01cc3bc9943b93daa17a2282a8712e  UseRestriction.json
```
