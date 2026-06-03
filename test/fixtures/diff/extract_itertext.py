#!/usr/bin/env python3
"""
extract_itertext.py — Reference text extractor using Python stdlib xml.etree.

Reads one AML XML file (or every XML file in a directory) and emits JSON
mapping section-record-id → normalized body text, using the same tree-walking
logic as the JS collectSections() in scripts/lib/build-corpus.js.

The JS path indexes text for a RECORD by aggregating PARA text from all
Normal Level child records — NOT from the RECORD's own PARA (which is just
the heading). This harness mirrors that exact structure so the comparison is
apples-to-apples.

For each Section- or Chapter-style LEVEL:
  - Find its RECORD to get the section id and heading.
  - Collect PARA text from RECORD children under child LEVEL[style-name=Normal Level].
  - Emit {section_record_id: normalized_body_text}.

Used by the differential test (test/diff/differential.mjs) as the independent
reference implementation against which our JS extraction is compared.

Usage:
    python3 extract_itertext.py <path-to-xml-or-dir>
    python3 extract_itertext.py <file1.xml> <file2.xml> ...

Output: a single JSON object {record_id: normalized_body_text} on stdout.

Design notes:
- Uses xml.etree.ElementTree — stdlib only, no third-party packages.
- itertext() yields all text content in document order, which is the canonical
  reference for detecting ordering bugs (the whole point of this differential).
- BOM stripping: AML files begin with a UTF-8 BOM (0xEF 0xBB 0xBF). We strip
  it from the raw bytes before parsing, mirroring the JS path in build-corpus.js
  (xml.replace(/^\\ufeff/, "")).
- Normalization: apply the same whitespace collapse as the JS normalize():
    1. Strip ALP source-edit markers: [ALP S-<digits>] and closed [ALP ...].
    2. Collapse runs of whitespace (\\s, including U+00A0 decoded from &#160;)
       to a single space and trim.
  ElementTree.itertext() decodes XML/numeric entities natively (&#160; → U+00A0,
  &#167; → §, &amp; → &, etc.), so no separate decoding step is needed.
  U+00A0 is matched by Python's \\s in re.sub, so it collapses automatically.

Compatibility: plain Python 3.x stdlib. No APIs newer than Python 3.8.
Tested on Python 3.11 and 3.14.
"""

import json
import os
import re
import sys
import xml.etree.ElementTree as ET

# ---------------------------------------------------------------------------
# Normalization helpers — mirrors extract-text.js normalize() exactly
# ---------------------------------------------------------------------------

_ALP_MARKER_RE_1 = re.compile(r'\[ALP\s+S-\d+\s*\]?')
_ALP_MARKER_RE_2 = re.compile(r'\[ALP\b[^\]]*\]')


def strip_alp_markers(s: str) -> str:
    """Remove ALP source-edit markers (same two-pass logic as stripAlpMarkers in JS)."""
    s = _ALP_MARKER_RE_1.sub('', s)
    s = _ALP_MARKER_RE_2.sub('', s)
    return s


def normalize(s: str) -> str:
    """
    Collapse whitespace and trim, matching the JS normalize() in extract-text.js.

    ElementTree.itertext() already decodes XML/numeric entities (&#160; to U+00A0,
    &#167; to §, &amp; to &, etc.), so no separate decoding step is needed here.
    U+00A0 (nbsp) is a whitespace character matched by Python's \\s in re.sub.
    """
    s = strip_alp_markers(s)
    # \s matches Unicode whitespace including U+00A0 in Python 3
    s = re.sub(r'\s+', ' ', s)
    return s.strip()


# ---------------------------------------------------------------------------
# Tree-walking — mirrors collectSections() in scripts/lib/build-corpus.js
# ---------------------------------------------------------------------------

def collect_sections_from_level(level_elem, results: dict) -> None:
    """
    Recursively walk a LEVEL element, collecting sections exactly as
    collectSections() does in JS:

    For each child LEVEL:
      - If style-name is Section or Chapter, and it has a RECORD with a
        non-empty heading (> 3 chars), collect the body text from child
        Normal Level RECORD PARA elements.
      - Recurse into nested levels.
    """
    style_name = level_elem.get('style-name', '')
    records = level_elem.findall('RECORD')

    if records and (style_name == 'Section' or style_name == 'Chapter'):
        # The Section/Chapter RECORD holds the id and heading.
        record = records[0]
        record_id = record.get('id', '')
        heading_elem = record.find('HEADING')
        heading = normalize(''.join(heading_elem.itertext())) if heading_elem is not None else ''

        if record_id and len(heading) > 3:
            # Collect body text from Normal Level child records (same as JS).
            body_parts = []
            for child_level in level_elem.findall('LEVEL'):
                if child_level.get('style-name', '') == 'Normal Level':
                    for child_record in child_level.findall('RECORD'):
                        for para in child_record.findall('PARA'):
                            # itertext() yields all text in document order —
                            # the canonical reference this differential is based on.
                            text = normalize(''.join(para.itertext()))
                            if text:
                                body_parts.append(text)

            body = normalize(' '.join(body_parts))
            if body:
                results[record_id] = body

    # Recurse into all child LEVEL elements (mirrors collectSections recursion).
    for child_level in level_elem.findall('LEVEL'):
        collect_sections_from_level(child_level, results)


def extract_from_file(path: str) -> dict:
    """
    Parse one AML XML file and return {section_record_id: normalized_body_text}
    for every indexed section, mirroring the JS collectSections() logic.

    BOM is stripped from raw bytes before parsing.
    """
    with open(path, 'rb') as fh:
        raw = fh.read()

    # Strip UTF-8 BOM if present
    if raw.startswith(b'\xef\xbb\xbf'):
        raw = raw[3:]

    try:
        root = ET.fromstring(raw)
    except ET.ParseError as exc:
        print(f'[WARN] ParseError in {path}: {exc}', file=sys.stderr)
        return {}

    results = {}

    # The AML tree: DOCUMENT > LEVEL > ... The root IS the DOCUMENT element.
    # Recursively walk all top-level LEVEL children (mirrors the JS
    # collectSections(findDocument(parsed), ...) call).
    for top_level in root.findall('LEVEL'):
        collect_sections_from_level(top_level, results)

    return results


def collect_xml_files(paths: list) -> list:
    """Expand a list of file/directory paths to a flat list of .xml file paths."""
    xml_files = []
    for p in paths:
        if os.path.isdir(p):
            for fname in sorted(os.listdir(p)):
                if fname.lower().endswith('.xml'):
                    xml_files.append(os.path.join(p, fname))
        elif os.path.isfile(p):
            xml_files.append(p)
        else:
            print(f'[WARN] Not found: {p}', file=sys.stderr)
    return xml_files


def main():
    if len(sys.argv) < 2:
        print('Usage: extract_itertext.py <xml-file-or-dir> [...]', file=sys.stderr)
        sys.exit(1)

    xml_files = collect_xml_files(sys.argv[1:])
    if not xml_files:
        print('No XML files found.', file=sys.stderr)
        sys.exit(1)

    combined = {}
    for path in xml_files:
        combined.update(extract_from_file(path))

    print(json.dumps(combined, ensure_ascii=False))


if __name__ == '__main__':
    main()
