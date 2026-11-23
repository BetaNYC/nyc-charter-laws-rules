// Reading the accessibility tree for the site tests (issue #62, "agents on the page").
//
// An AI agent on a page finds controls by role and name, the way a screen reader does. So
// every control needs a name, and no two controls may share one. This reads Playwright's
// aria snapshot (what the browser's accessibility tree exposes, including inside NYSDS's
// shadow roots) and lists every control with its name.

/** Roles a person or agent operates. Links are checked separately (see linkProblems). */
export const CONTROL_ROLES = ["button", "textbox", "searchbox", "checkbox", "radio", "combobox", "switch", "tab", "slider", "spinbutton", "menuitem", "listbox", "option"];

// One node line of an aria snapshot: `- role "name" [attrs]: text` (the name is optional).
const LINE = /^(\s*)- (?:'|")?([a-z]+)(?: "((?:[^"\\]|\\.)*)")?/;

/** Every node in an aria snapshot, with its role, name and (for links) its /url. */
export function parseSnapshot(snapshot) {
  const nodes = [];
  const lines = snapshot.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const m = LINE.exec(lines[i]);
    if (!m) continue;
    const node = { role: m[2], name: m[3] === undefined ? "" : JSON.parse(`"${m[3]}"`), indent: m[1].length, line: lines[i].trim() };
    if (node.role === "link") {
      for (let j = i + 1; j < lines.length; j++) {
        const lead = /^(\s*)/.exec(lines[j])[1].length;
        if (lead <= node.indent) break;
        const u = /^\s*- \/url: (.*)$/.exec(lines[j]);
        if (u) {
          node.url = u[1].replace(/^"|"$/g, "");
          break;
        }
      }
    }
    nodes.push(node);
  }
  return nodes;
}

/** Controls with no name, and names two controls share. */
export function controlProblems(nodes) {
  const controls = nodes.filter((n) => CONTROL_ROLES.includes(n.role));
  const unnamed = controls.filter((c) => !c.name.trim()).map((c) => c.line);
  const byName = new Map();
  for (const c of controls) {
    const k = c.name.trim().toLowerCase();
    if (!k) continue;
    byName.set(k, [...(byName.get(k) ?? []), c.line]);
  }
  const duplicates = [...byName].filter(([, v]) => v.length > 1).map(([k, v]) => `${k}: ${v.join(" | ")}`);
  return { controls, unnamed, duplicates };
}

/** Links with no name, and one name used for links that go to different places. */
export function linkProblems(nodes) {
  const links = nodes.filter((n) => n.role === "link");
  const unnamed = links.filter((l) => !l.name.trim()).map((l) => l.line);
  const byName = new Map();
  for (const l of links) {
    const k = l.name.trim().toLowerCase();
    if (!k) continue;
    if (!byName.has(k)) byName.set(k, new Set());
    byName.get(k).add(l.url ?? "");
  }
  const conflicting = [...byName].filter(([, urls]) => urls.size > 1).map(([k, urls]) => `${k}: ${[...urls].join(" | ")}`);
  return { links, unnamed, conflicting };
}
