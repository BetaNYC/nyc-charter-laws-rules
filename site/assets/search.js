// The search page (issue #62). One box, two jobs:
//   - a citation ("§ 259", "259", "charter 259") goes straight to its page, or, when several
//     pages share it, shows a short list to pick from (citations.json, written by the build);
//   - words are searched with Pagefind's static index (pagefind/pagefind.js, written by the
//     build), which the browser loads in pieces. Built against Pagefind 1.6's search API docs
//     (pagefind.app/docs/api, /docs/js-api-filtering, /docs/sub-results).
// The address keeps the query, the page and the filters (?q=...&page=2&kind=Section&book=Rules), so a
// search can be linked to and the back button works.
// The filters (book, and kind of page: sections, chapters, local laws) and the result labels come
// from filters.js, which the build uses too (issue #65).
import { lookup, jumpTarget, pageUrl } from "./jump.js";
import { loadCitations } from "./law.js";
import { filterGroups, groupOptions, kindLabel } from "./filters.js";

const PAGE_SIZE = 10;

const form = document.querySelector('form.jump[data-handler="search"]');
const input = form?.querySelector("nys-textinput");
const status = document.getElementById("search-status");
const results = document.getElementById("results");
const pick = document.getElementById("pick");
const pager = document.getElementById("pages");
const filtersBox = document.getElementById("filters");

function siteBooks() {
  try {
    return JSON.parse(filtersBox?.dataset.books ?? "[]");
  } catch {
    return [];
  }
}
const FILTER_GROUPS = filterGroups(siteBooks());

let pagefind = null;
async function engine() {
  if (!pagefind) {
    pagefind = await import("/pagefind/pagefind.js");
    await pagefind.options({ excerptLength: 30 });
  }
  return pagefind;
}

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

function readState() {
  const u = new URLSearchParams(location.search);
  const state = { q: (u.get("q") ?? "").trim(), page: Math.max(1, parseInt(u.get("page") ?? "1", 10) || 1), filters: {} };
  for (const g of FILTER_GROUPS) {
    const v = u.getAll(g.key);
    if (v.length) state.filters[g.key] = v;
  }
  return state;
}

function writeState(state, push) {
  const u = new URLSearchParams();
  if (state.q) u.set("q", state.q);
  if (state.page > 1) u.set("page", String(state.page));
  for (const [k, vs] of Object.entries(state.filters)) for (const v of vs) u.append(k, v);
  const url = `/search${u.toString() ? `?${u}` : ""}`;
  if (push) history.pushState(null, "", url);
  else history.replaceState(null, "", url);
}

function say(text) {
  status.textContent = text;
}

let filtersBuilt = false;
async function buildFilters(state) {
  if (filtersBuilt) return;
  const all = await (await engine()).filters();
  const parts = [];
  for (const g of FILTER_GROUPS) {
    const options = groupOptions(g, Object.keys(all[g.key] ?? {}));
    if (!options.length) continue;
    const boxes = options
      .map(([v, name]) => {
        const checked = !state.filters[g.key] || state.filters[g.key].includes(v);
        return `<nys-checkbox name="${esc(g.key)}" value="${esc(v)}" label="${esc(name)}"${checked ? " checked" : ""}></nys-checkbox>`;
      })
      .join("");
    parts.push(`<nys-checkboxgroup label="${esc(g.label)}" data-group="${esc(g.key)}">${boxes}</nys-checkboxgroup>`);
  }
  filtersBox.innerHTML = `<h2 class="filters-h">Show results from</h2>${parts.join("")}`;
  filtersBox.hidden = false;
  filtersBuilt = true;
  filtersBox.addEventListener("nys-change", async (e) => {
    if (!e.target.matches?.("nys-checkbox")) return;
    // Every box in a group unchecked would mean no results, and the address cannot say "none"
    // (no value means "all"). So the last box stays checked, and the status line says why.
    const group = e.target.closest("nys-checkboxgroup");
    if (group && ![...group.querySelectorAll("nys-checkbox")].some((b) => b.checked)) {
      // A mouse click fires nys-change from the inner input's change event, before the checkbox
      // (a Lit element) has drawn itself unchecked (NYSDS 1.23 nys-checkbox _handleChange); setting
      // `checked` back at once would be folded into that same draw and leave the inner input
      // unchecked. So wait for the draw (Lit's updateComplete), then check it again.
      await e.target.updateComplete;
      e.target.checked = true;
      await e.target.updateComplete;
      // Keep the results line and add why. Clear the status first so a screen reader announces
      // the line again when the same box is tried twice.
      const line = status.textContent.replace(/\s*At least one box under “[^”]*” stays checked\.$/, "");
      say("");
      setTimeout(() => say(`${line ? `${line} ` : ""}At least one box under “${group.getAttribute("label")}” stays checked.`), 100);
      return;
    }
    const s = readState();
    s.filters = {};
    for (const g of filtersBox.querySelectorAll("nys-checkboxgroup")) {
      const key = g.dataset.group;
      const boxes = [...g.querySelectorAll("nys-checkbox")];
      const on = boxes.filter((b) => b.checked).map((b) => b.value);
      if (on.length && on.length < boxes.length) s.filters[key] = on;
    }
    s.page = 1;
    writeState(s, true);
    run();
  });
}

/** Set each box from the address (after Back or Forward), so the boxes match the results. */
function syncFilters(state) {
  if (!filtersBuilt) return;
  for (const group of filtersBox.querySelectorAll("nys-checkboxgroup")) {
    const on = state.filters[group.dataset.group];
    for (const box of group.querySelectorAll("nys-checkbox")) {
      const want = !on || on.includes(box.value);
      if (box.checked !== want) box.checked = want;
    }
  }
}

function pagefindFilters(filters) {
  const out = {};
  for (const [k, vs] of Object.entries(filters)) out[k] = { any: vs };
  return out;
}

function hitHtml(d) {
  const book = d.meta?.book ?? "";
  const kind = kindLabel(d.meta?.kind);
  const subs = (d.sub_results ?? []).filter((s) => s.anchor).slice(0, 3);
  return `<li class="hit">
<p class="where"><span class="badge">${esc(book)}</span> ${esc(kind)}</p>
<h2><a href="${esc(pageUrl(d.url))}">${esc(d.meta?.title ?? d.url)}</a></h2>
<p class="snip">${d.excerpt}</p>
${subs.length ? `<ul class="subs">${subs.map((s) => `<li><a href="${esc(pageUrl(s.url))}">${esc(s.title)}</a>: <span class="snip">${s.excerpt}</span></li>`).join("")}</ul>` : ""}
</li>`;
}

async function showPick(matches, anchor, q) {
  // One match is shown as a choice too when the query did not name its book ("Title 17, Chapter 3" in the Rules).
  if (!matches.length) {
    pick.hidden = true;
    pick.innerHTML = "";
    return;
  }
  pick.innerHTML = `<h2>Pages numbered “${esc(q)}”</h2><ul class="contents">${matches
    .map((m) => `<li><a href="${esc(jumpTarget(m, anchor))}">${esc(m.h ? `${m.c}. ${m.h}` : m.c)}</a></li>`)
    .join("")}</ul>`;
  pick.hidden = false;
}

let runId = 0;
export async function run() {
  const id = ++runId;
  const state = readState();
  if (input && input.value !== state.q) input.value = state.q;
  syncFilters(state);
  results.innerHTML = "";
  pager.hidden = true;
  if (!state.q) {
    pick.hidden = true;
    say("Type a section number, like § 259, or some words.");
    return;
  }
  let matches = [];
  let anchor = "";
  let jump = false;
  try {
    ({ matches, anchor, jump } = lookup(await loadCitations(), state.q));
  } catch (e) {
    console.warn(e);
  }
  if (jump) {
    say(`Going to ${matches[0].c}.`);
    location.replace(jumpTarget(matches[0], anchor));
    return;
  }
  await showPick(matches, anchor, state.q);
  say(`Searching for “${state.q}”…`);
  let search;
  try {
    const pf = await engine();
    await buildFilters(state);
    search = await pf.search(state.q, { filters: pagefindFilters(state.filters) });
  } catch (e) {
    console.error(e);
    say("Search could not load. Browse the contents instead.");
    return;
  }
  if (id !== runId) return;
  const total = search.results.length;
  if (!total) {
    say(`No results for “${state.q}”.`);
    return;
  }
  const pages = Math.ceil(total / PAGE_SIZE);
  const page = Math.min(state.page, pages);
  const slice = search.results.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const data = await Promise.all(slice.map((r) => r.data()));
  if (id !== runId) return;
  results.innerHTML = data.map(hitHtml).join("\n");
  results.start = (page - 1) * PAGE_SIZE + 1;
  const from = (page - 1) * PAGE_SIZE + 1;
  const to = from + data.length - 1;
  say(`${total} result${total === 1 ? "" : "s"} for “${state.q}”. Showing ${from} to ${to}.`);
  if (pages > 1) {
    pager.setAttribute("totalPages", String(pages));
    pager.setAttribute("currentPage", String(page));
    pager.hidden = false;
  }
}

if (form && status) {
  form.addEventListener("law-search", async (e) => {
    const s = readState();
    s.q = String(e.detail.q ?? "").trim();
    s.page = 1;
    writeState(s, true);
    run();
  });
  pager?.addEventListener("nys-change", (e) => {
    const s = readState();
    s.page = Number(e.detail?.page) || 1;
    writeState(s, true);
    run().then(() => status.scrollIntoView?.({ block: "start" }));
  });
  window.addEventListener("popstate", () => run());
  run();
}
