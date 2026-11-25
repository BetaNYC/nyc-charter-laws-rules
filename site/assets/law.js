// Small enhancements for every page (issue #62). The page works without this file: the law
// text, the contents and the bottom box are plain HTML.
//   - The search box: a citation ("§ 259") goes straight to its page; anything else goes to
//     the search page.
//   - Copy link, Copy citation and Print on law pages, and Copy citation for each section on a
//     chapter page.
//   - The contents tree (scripts/lib/site/pages.js contentsTree): a disclosure button before each
//     chapter, which loads that chapter's sections from /<book>/contents/<chapter>.json; "Hide"
//     and "☰ Contents"; and, when the tree scrolls on its own (a wide screen), it starts
//     scrolled to the reader's own section, or else the open chapter, rather than the Preamble.
//   - On a chapter page at 900px and wider, where the page shows every section's text, the
//     jump list and the tree's links for this chapter go to those copies (#s-4).
import { lookup, jumpTarget, citeWithAnchor, splitCopyId } from "./jump.js";

/** The width where a chapter page shows its sections' full text and the tree is a column. law.css uses the same. */
export const WIDE = "(min-width: 900px)";
const wide = () => matchMedia(WIDE).matches;
/** Where "Hide" is remembered on a wide screen, so the next page opens the same way. */
const HIDE_KEY = "law-reader.contents";

let citations = null;
export async function loadCitations() {
  if (!citations) {
    const r = await fetch("/citations.json");
    if (!r.ok) throw new Error(`citations.json: HTTP ${r.status}`);
    citations = await r.json();
  }
  return citations;
}

/** Where a query goes: one citation's page, or the search page. */
export async function destination(query) {
  const q = String(query ?? "").trim();
  if (!q) return null;
  try {
    const { matches, anchor, jump } = lookup(await loadCitations(), q);
    if (jump) return jumpTarget(matches[0], anchor);
  } catch (e) {
    console.warn(e);
  }
  return `/search?q=${encodeURIComponent(q)}`;
}

function wireForms() {
  for (const form of document.querySelectorAll("form.jump")) {
    const input = form.querySelector("nys-textinput");
    // The text box sits inside the component, so Enter does not submit the form on its own.
    input?.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        form.requestSubmit();
      }
    });
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const q = new FormData(form).get("q") ?? input?.value ?? "";
      if (form.dataset.handler === "search") {
        form.dispatchEvent(new CustomEvent("law-search", { detail: { q } }));
        return;
      }
      const to = await destination(q);
      if (to) location.assign(to);
    });
  }
}

/**
 * The element a hash names: the one with that id, else the one whose id matches it in any case
 * ("(A)" for "(a)": the jump box keeps the case a reader typed, and anchors keep the publisher's,
 * "(d)(2)(C)"). Only when exactly one id matches that way: two that differ only by case, as
 * "(C)" and "(c)" may, are ambiguous, and then none is.
 */
function anchorFor(hash) {
  if (!hash) return null;
  const exact = document.getElementById(hash);
  if (exact) return exact;
  const want = hash.toLowerCase();
  const found = [...document.querySelectorAll("[id]")].filter((e) => e.id.toLowerCase() === want);
  return found.length === 1 ? found[0] : null;
}

/**
 * The address's hash without its "#", decoded: "#(b)(1)" or "#%28b%29%281%29" → "(b)(1)". A hash
 * that is not valid percent-encoding ("#%", "#50%") is kept as it is rather than throwing, which
 * would stop every script on the page.
 */
function hashText(hash = location.hash) {
  const raw = hash.replace(/^#/, "");
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

/** On load and on each hash change: a hash that names an id in another case goes to that id. */
function landOnAnchor() {
  const hash = hashText();
  if (!hash || document.getElementById(hash)) return;
  const el = anchorFor(hash);
  // replace, not assign: the address gets the real id (so Copy link and Copy citation use it)
  // without a second history entry, and the browser scrolls there and sets :target.
  if (el) location.replace(`#${el.id}`);
}

function citationText() {
  const cite = document.querySelector("h1 .cite")?.textContent?.trim() ?? document.title;
  const el = anchorFor(hashText());
  return el ? citeWithAnchor(cite, el.id) : cite;
}

/**
 * Browsers give a page the Clipboard API only over https (a "secure context"). Over plain http
 * (law.beta.nyc before its certificate, Noel's phone 2026-11-24) `navigator.clipboard` is
 * undefined, so copy the old way: select the text in a hidden, read-only textarea and run
 * `execCommand("copy")`. That runs before any `await`, so it is still inside the click.
 */
function copyBySelection(text) {
  const area = document.createElement("textarea");
  area.value = text;
  area.setAttribute("readonly", "");
  area.setAttribute("aria-hidden", "true");
  area.style.cssText = "position:fixed;top:0;left:0;opacity:0;font-size:16px";
  const back = document.activeElement;
  document.body.append(area);
  area.focus({ preventScroll: true });
  area.select();
  area.setSelectionRange(0, text.length);
  let ok = false;
  try {
    ok = document.execCommand("copy");
  } catch {
    ok = false;
  }
  area.remove();
  back?.focus?.({ preventScroll: true });
  return ok;
}

async function copyText(text, what, status) {
  const say = (t) => {
    if (status) status.textContent = t;
  };
  let ok = false;
  if (window.isSecureContext && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      ok = true;
    } catch {
      ok = false;
    }
  } else {
    ok = copyBySelection(text);
  }
  say(ok ? `Copied the ${what}: ${text}` : `Could not copy. The ${what} is: ${text}`);
}

function wireTools() {
  for (const b of document.querySelectorAll("button.copy-cite")) {
    b.hidden = false;
    b.addEventListener("click", () => copyText(b.dataset.cite, "citation", b.parentElement.querySelector(".copy-status")));
  }
  const tools = document.querySelector(".tools");
  if (!tools) return;
  const status = tools.querySelector(".copy-status");
  const copy = (text, what) => copyText(text, what, status);
  tools.querySelector(".tool-link")?.addEventListener("click", () => {
    const canonical = document.querySelector('link[rel="canonical"]')?.href ?? location.href.split("#")[0];
    copy(canonical + location.hash, "link");
  });
  tools.querySelector(".tool-cite")?.addEventListener("click", () => copy(citationText(), "citation"));
  tools.querySelector(".tool-print")?.addEventListener("click", () => window.print());
}

/**
 * Scroll the contents tree, and only the tree, so the reader's own link sits a quarter of the
 * way down it: the section's link on a section page, else the open chapter's (code review S1:
 * one selector for both found the chapter first, so a section deep in a long chapter stayed
 * out of view). A link already in the top half, below the sticky heading, is left where it is.
 */
export function showOpenChapter(toc = document.querySelector(".toc")) {
  const open = toc?.querySelector('a[aria-current="page"]') ?? toc?.querySelector("li.open > a");
  if (!open || toc.scrollHeight <= toc.clientHeight + 1) return false;
  const head = toc.querySelector(".contents-top");
  const covered = head && head.offsetParent !== null ? head.getBoundingClientRect().height : 0;
  const offset = open.getBoundingClientRect().top - toc.getBoundingClientRect().top;
  if (offset >= covered && offset + open.getBoundingClientRect().height <= toc.clientHeight / 2) return false;
  toc.scrollTop += offset - Math.round(toc.clientHeight / 4);
  return true;
}

const SVG = "http://www.w3.org/2000/svg";
/** The triangle: an SVG drawn in the button's own color, so it shows in forced colors too. */
function triangle(doc) {
  const svg = doc.createElementNS(SVG, "svg");
  svg.setAttribute("viewBox", "0 0 12 12");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("focusable", "false");
  const path = doc.createElementNS(SVG, "path");
  path.setAttribute("d", "M3 1.5 9.5 6 3 10.5Z");
  path.setAttribute("fill", "currentColor");
  svg.append(path);
  return svg;
}

const lastSegment = (href) => String(href).split("#")[0].split("/").pop();

/** One chapter's list of sections, from the JSON the build writes: [[path, text], ...]. */
async function loadSections(nav, chapterHref, list) {
  const r = await fetch(`${nav.dataset.sections}${lastSegment(chapterHref)}.json`);
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const doc = list.ownerDocument;
  for (const [path, text] of await r.json()) {
    const li = doc.createElement("li");
    const a = doc.createElement("a");
    a.href = path;
    a.textContent = text;
    li.append(a);
    list.append(li);
  }
}

/**
 * A disclosure button before a chapter's link: named "Sections in <chapter>", aria-expanded, and
 * aria-controls on the chapter's list. The current chapter's list is in the page; another's is
 * made empty and filled the first time it opens.
 */
function addDisclosure(li, nav) {
  const doc = li.ownerDocument;
  const link = li.querySelector(":scope > a");
  let list = li.querySelector(":scope > ul");
  if (!link || li.classList.contains("empty") || (li.classList.contains("open") && !list)) return null;
  if (!list) {
    list = doc.createElement("ul");
    list.id = `toc-${lastSegment(link.getAttribute("href"))}`;
    list.hidden = true;
    li.append(list);
  }
  const button = doc.createElement("button");
  button.type = "button";
  button.className = "tw";
  button.setAttribute("aria-expanded", String(!list.hidden));
  button.setAttribute("aria-controls", list.id);
  // What the button opens: "Sections" (the Charter's chapters), or, in a titles-first tree, the
  // nav's data-child ("Chapters"), unless the item names its own (a title with only sections).
  const child = li.dataset.child ?? nav.dataset.child ?? "Sections";
  button.setAttribute("aria-label", `${child} in ${link.textContent}`);
  button.append(triangle(doc));
  li.prepend(button);
  // A titles-first tree has one status line: "Loading…" while a list loads, and the failure
  // there if it does not. Focus stays on the button throughout.
  const status = nav.querySelector(".tree-status");
  button.addEventListener("click", async () => {
    // A press while the list is still loading does nothing: no second fetch, no list twice.
    if (button.getAttribute("aria-busy") === "true") return;
    if (button.getAttribute("aria-expanded") === "true") {
      list.hidden = true;
      button.setAttribute("aria-expanded", "false");
      return;
    }
    if (!list.children.length) {
      button.setAttribute("aria-busy", "true");
      if (status) status.textContent = "Loading…";
      try {
        await loadSections(nav, link.getAttribute("href"), list);
        if (status) status.textContent = "";
      } catch (e) {
        console.warn(e);
        if (status) {
          // Left closed, so the next press tries again; the title's link still lists them.
          list.replaceChildren();
          status.textContent = `Could not load the ${child.toLowerCase()} in ${link.textContent}. Press the button to try again, or follow the link to its page.`;
          button.removeAttribute("aria-busy");
          return;
        }
        const note = doc.createElement("li");
        note.className = "load-error";
        const a = doc.createElement("a");
        a.href = link.getAttribute("href");
        a.textContent = `Open ${link.textContent}`;
        note.append("Could not load these sections. ", a);
        list.append(note);
      } finally {
        button.removeAttribute("aria-busy");
      }
    }
    list.hidden = false;
    button.setAttribute("aria-expanded", "true");
  });
  return button;
}

/**
 * The contents tree, with scripts: open its fold (law.css then hides the fold's summary), add the
 * disclosure buttons, and wire "Hide" and "☰ Contents". On a wide screen "Hide" folds the column
 * away and is remembered; on a phone the tree starts closed and "☰ Contents" opens it. State is
 * two classes on <html>, read by law.css: contents-hidden (wide) and contents-shown (phone).
 */
export function wireContents(doc = document) {
  const nav = doc.getElementById("contents");
  if (!nav) return false;
  const root = doc.documentElement;
  const fold = nav.closest("details");
  if (fold) fold.open = true;
  for (const li of nav.querySelectorAll(".tree > li")) addDisclosure(li, nav);
  const openButton = doc.querySelector(".contents-open");
  const hideButton = nav.querySelector(".contents-hide");
  let remembered = false;
  try {
    remembered = localStorage.getItem(HIDE_KEY) === "hidden";
  } catch {}
  root.classList.toggle("contents-hidden", remembered);
  const remember = (hidden) => {
    try {
      if (hidden) localStorage.setItem(HIDE_KEY, "hidden");
      else localStorage.removeItem(HIDE_KEY);
    } catch {}
  };
  const sync = () => {
    const shown = wide() ? !root.classList.contains("contents-hidden") : root.classList.contains("contents-shown");
    openButton?.setAttribute("aria-expanded", String(shown));
  };
  hideButton?.addEventListener("click", () => {
    if (wide()) {
      root.classList.add("contents-hidden");
      remember(true);
    } else root.classList.remove("contents-shown");
    sync();
    openButton?.focus();
  });
  openButton?.addEventListener("click", () => {
    if (wide()) {
      root.classList.remove("contents-hidden");
      remember(false);
    } else root.classList.add("contents-shown");
    sync();
    hideButton?.focus();
    showOpenChapter();
  });
  matchMedia(WIDE).addEventListener("change", sync);
  if (openButton) openButton.hidden = false;
  if (hideButton) hideButton.hidden = false;
  root.classList.add("contents-ready");
  sync();
  return true;
}

/**
 * A chapter page on a wide screen shows every section's text, so its jump list and the tree's
 * links for this chapter go to those copies (#s-4); below 900px, where the copies are hidden,
 * they go back to each section's own page. A link to a copy opened on a phone
 * (/charter/chapters/1#s-4(b)) goes on to the section's own page (/charter/sections/4#(b)), and
 * one to a subsection's part (#s-fc-102_102.4(1)) to /admin-code/sections/fc-102#102.4(1).
 */
export function pointAtCopies(doc = document) {
  if (!doc.querySelector(".chapter-text")) return false;
  const links = [...doc.querySelectorAll('.jump a, .tree li.open > ul a[href*="/sections/"]')];
  const copyOf = (a) => doc.getElementById(`s-${lastSegment(a.dataset.page)}`);
  const apply = () => {
    for (const a of links) {
      a.dataset.page ??= a.getAttribute("href");
      a.setAttribute("href", wide() && copyOf(a) ? `#s-${lastSegment(a.dataset.page)}` : a.dataset.page);
    }
  };
  apply();
  matchMedia(WIDE).addEventListener("change", apply);
  if (!wide() && location.hash.startsWith("#s-")) {
    const { slug, anchor } = splitCopyId(hashText().slice(2));
    const to = links.find((a) => lastSegment(a.dataset.page) === slug);
    if (to) location.replace(to.dataset.page + (anchor ? `#${anchor}` : ""));
  }
  return true;
}

wireForms();
wireTools();
wireContents();
pointAtCopies();
// Last, so nothing it meets can keep the page's controls from being wired.
landOnAnchor();
window.addEventListener("hashchange", landOnAnchor);
if (document.querySelector(".toc")) requestAnimationFrame(() => showOpenChapter());
