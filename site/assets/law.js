// Small enhancements for every page (issue #62). The page works without this file: the law
// text, the contents and the bottom box are plain HTML.
//   - The search box: a citation ("§ 259") goes straight to its page; anything else goes to
//     the search page.
//   - Copy link, Copy citation and Print on law pages.
//   - The side list of chapters, when it scrolls on its own (a wide screen), starts scrolled
//     to the open chapter rather than to the Preamble.
import { lookup, jumpTarget } from "./jump.js";

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
    const { matches, anchor } = lookup(await loadCitations(), q);
    if (matches.length === 1) return jumpTarget(matches[0], anchor);
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

function citationText() {
  const cite = document.querySelector("h1 .cite")?.textContent?.trim() ?? document.title;
  const hash = decodeURIComponent(location.hash.slice(1));
  return hash && document.getElementById(hash) ? cite + hash : cite;
}

function wireTools() {
  const tools = document.querySelector(".tools");
  if (!tools) return;
  const status = tools.querySelector(".copy-status");
  const say = (t) => {
    if (status) status.textContent = t;
  };
  async function copy(text, what) {
    try {
      await navigator.clipboard.writeText(text);
      say(`Copied the ${what}: ${text}`);
    } catch {
      say(`Could not copy. The ${what} is: ${text}`);
    }
  }
  tools.querySelector(".tool-link")?.addEventListener("click", () => {
    const canonical = document.querySelector('link[rel="canonical"]')?.href ?? location.href.split("#")[0];
    copy(canonical + location.hash, "link");
  });
  tools.querySelector(".tool-cite")?.addEventListener("click", () => copy(citationText(), "citation"));
  tools.querySelector(".tool-print")?.addEventListener("click", () => window.print());
}

/** Scroll the side list, and only the side list, so the open chapter sits a quarter of the way down it. */
export function showOpenChapter(toc = document.querySelector(".toc")) {
  const open = toc?.querySelector('li.open > a, a[aria-current="page"]');
  if (!open || toc.scrollHeight <= toc.clientHeight + 1) return false;
  const offset = open.getBoundingClientRect().top - toc.getBoundingClientRect().top;
  if (offset >= 0 && offset < toc.clientHeight / 2) return false;
  toc.scrollTop += offset - Math.round(toc.clientHeight / 4);
  return true;
}

wireForms();
wireTools();
if (document.querySelector(".toc")) customElements.whenDefined("nys-verticalnav").then(() => requestAnimationFrame(() => showOpenChapter()));
