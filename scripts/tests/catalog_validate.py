"""Validate the about-data files with pinned, official validators. CI and dev only.

    dcat FILE...          data.json against the vendored DCAT-US 3.0 JSON Schema
    data-sources FILE...  DATA-SOURCES.json against scripts/mcp_shared/data-sources.schema.json

Run with pinned validators, outside the project environment (they are not runtime dependencies):

    uv run --no-project --with jsonschema==4.26.0 --with referencing==0.37.0 --with rfc3987==1.3.8 \
        python scripts/tests/catalog_validate.py dcat FILE...

`dcat` mirrors GSA/dcat-us jsonschema/test_json_schema.py at commit 4996591: every definition goes
into a `referencing` Registry and the document is validated with Draft202012Validator and its
format checker against https://resources.data.gov/dcat-us/3.0.0/definitions/catalog. rfc3987 makes
the `iri` format checked rather than skipped. Croissant is validated separately with MLCommons'
own CLI: `mlcroissant validate --jsonld croissant.json` (mlcroissant 1.1.1).
Exit 0 valid, 1 invalid, 2 usage.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

from jsonschema import Draft202012Validator
from referencing import Registry, Resource

SHARED = Path(__file__).resolve().parents[1] / "mcp_shared"
DEFS = SHARED / "vendor" / "dcat-us-3.0.0" / "definitions"
DS_SCHEMA = SHARED / "data-sources.schema.json"
CATALOG_ID = "https://resources.data.gov/dcat-us/3.0.0/definitions/catalog"


def registry() -> Registry:
    reg = Registry()
    for f in sorted(DEFS.glob("*.json")):
        reg = Resource.from_contents(json.loads(f.read_text(encoding="utf-8"))) @ reg
    return reg


def _messages(validator: Draft202012Validator, doc: object) -> list[str]:
    return [f"{'/'.join(map(str, e.absolute_path)) or '(root)'}: {e.message[:300]}"
            for e in sorted(validator.iter_errors(doc), key=lambda e: list(map(str, e.absolute_path)))]


def errors_for(doc: object) -> list[str]:
    """DCAT-US 3.0 errors in a data.json document."""
    return _messages(Draft202012Validator({"$ref": CATALOG_ID}, registry=registry(),
                                          format_checker=Draft202012Validator.FORMAT_CHECKER), doc)


def data_sources_errors(doc: object) -> list[str]:
    schema = json.loads(DS_SCHEMA.read_text(encoding="utf-8"))
    Draft202012Validator.check_schema(schema)
    return _messages(Draft202012Validator(schema, format_checker=Draft202012Validator.FORMAT_CHECKER), doc)


def main(argv: list[str]) -> int:
    if len(argv) < 2 or argv[0] not in ("dcat", "data-sources"):
        print(__doc__, file=sys.stderr)
        return 2
    check, label = (errors_for, "DCAT-US 3.0") if argv[0] == "dcat" else (data_sources_errors, "DATA-SOURCES schema")
    bad = 0
    for name in argv[1:]:
        errs = check(json.loads(Path(name).read_text(encoding="utf-8")))
        for e in errs:
            print(f"{name}: {e}", file=sys.stderr)
        print(f"catalog_validate: {name}: {'INVALID' if errs else 'valid'} {label} ({len(errs)} errors)")
        bad += bool(errs)
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
