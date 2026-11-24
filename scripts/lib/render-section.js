// renderSection: one section as ordered, typed blocks (issue #61; docs/plans/publication-model.md
// Phase 1). It is pure: no I/O. The Markdown index (scripts/lib/serialize-markdown.js) is written
// from these blocks today, and the site's HTML writer (Phase 2, #62) is to be written from the
// same blocks, so the two show the same text in the same order.
//
// Blocks, in order:
//   { type: "heading", text }          the section's heading
//   { type: "citation", text }         its citation
//   then the body, one block per paragraph of `text`:
//   { type: "subdivision", text, depth, label, anchor?, links? }   "a. The head of each agency..."
//   { type: "text", text, depth?, links? }                          a paragraph with no label
//   { type: "note", text, links? }                                  an editor's note
//   { type: "subheading", text, links? }                            a Subsection's heading line,
//                                                                   "80.1 Title." (issue #76)
//   (a body block can also carry table: true or picture: true, and `marks`, the publisher's bold
//   and italic runs as [start, end, "b" | "i" | "bi"] offsets into its text; its text is still
//   the flat text)
//
// A body block's `text` is a slice of the section's `text` (the MCP server's text), and the body
// blocks' texts joined with one space are exactly the section's `text`. Each link's start and
// end are offsets into its block's `text`.
//
// Without a structure entry (scripts/lib/build-structure.js), the body is one "text" block
// holding all of `text`, which is what the index has always had.

export function renderSection(section, structure = null) {
  const blocks = [
    { type: "heading", text: section.heading },
    { type: "citation", text: section.citation },
  ];
  if (!section.text) return blocks;
  if (!structure || structure.blocks.length === 0) {
    blocks.push({ type: "text", text: section.text });
    return blocks;
  }
  const links = structure.links ?? [];
  for (const b of structure.blocks) {
    const block = { type: b.type, text: section.text.slice(b.start, b.end) };
    for (const k of ["depth", "label", "anchor", "table", "picture"]) {
      if (b[k] !== undefined) block[k] = b[k];
    }
    const inside = links
      .filter((l) => l.start >= b.start && l.end <= b.end)
      .map((l) => ({ start: l.start - b.start, end: l.end - b.start, to: l.to }));
    if (inside.length) block.links = inside;
    // Bold and italic runs (structure `marks`), clipped to the block and made block-relative.
    const marks = (structure.marks ?? [])
      .filter(([x, y]) => x < b.end && y > b.start)
      .map(([x, y, look]) => [Math.max(x, b.start) - b.start, Math.min(y, b.end) - b.start, look]);
    if (marks.length) block.marks = marks;
    blocks.push(block);
  }
  return blocks;
}

/** The body blocks of a rendered section: everything after its heading and citation. */
export function bodyBlocks(blocks) {
  return blocks.filter((b) => b.type !== "heading" && b.type !== "citation");
}
