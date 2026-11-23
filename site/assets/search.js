// The search page (issue #62). One box, two jobs:
//   - a citation ("§ 259", "259", "charter 259") goes straight to its page, or, when several
//     pages share it, shows a short list to pick from (citations.json, written by the build);
//   - words are searched with Pagefind's static index (pagefind/pagefind.js, written by the
//     build), which the browser loads in pieces. Built against Pagefind 1.6's search API docs
//     (pagefind.app/docs/api, /docs/js-api-filtering, /docs/sub-results).
// The address keeps the query, the page and the filters (?q=...&page=2&kind=Section), so a
// search can be linked to and the back button works.
import { lookup, jumpTarget, pageUrl } from "./jump.js";
import { loadCitations } from "./law.js";

const PAGE_SIZE = 10;
const FILTER_GROUPS = [
  { key: "book", label: "Book" },
  { key: "kind", label: "Kind of page", names: { Section: "Sections", Chapter: "Chapters" } },
];

const form = document.querySelector('form.jump[data-handler="search"]');
const input = form?.querySelector("nys-textinput");
const status = document.getElementById("search-status");
const results = document.getElementById("results");
const pick = document.getElementById("pick");
const pager = document.getElementById("pages");
const filtersBox = document.getElementById("filters");

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
    const values = Object.keys(all[g.key] ?? {}).sort();
    if (!values.length) continue;
    const boxes = values
      .map((v) => {
        const checked = !state.filters[g.key] || state.filters[g.key].includes(v);
        const name = g.names?.[v] ?? v;
        return `<nys-checkbox name="${esc(g.key)}" value="${esc(v)}" label="${esc(name)}"${checked ? " checked" : ""}></nys-checkbox>`;
      })
      .join("");
    parts.push(`<nys-checkboxgroup label="${esc(g.label)}" data-group="${esc(g.key)}">${boxes}</nys-checkboxgroup>`);
  }
  filtersBox.innerHTML = `<h2 class="filters-h">Show results from</h2>${parts.join("")}`;
  filtersBox.hidden = false;
  filtersBuilt = true;
  filtersBox.addEventListener("nys-change", (e) => {
    if (!e.target.matches?.("nys-checkbox")) return;
    const s = readState();
    s.filters = {};
    for (const group of filtersBox.querySelectorAll("nys-checkboxgroup")) {
      const key = group.dataset.group;
      const boxes = [...group.querySelectorAll("nys-checkbox")];
      const on = boxes.filter((b) => b.checked).map((b) => b.value);
      if (on.length && on.length < boxes.length) s.filters[key] = on;
    }
    s.page = 1;
    writeState(s, true);
    run();
  });
}

function pagefindFilters(filters) {
  const out = {};
  for (const [k, vs] of Object.entries(filters)) out[k] = { any: vs };
  return out;
}

function hitHtml(d) {
  const book = d.meta?.book ?? "";
  const kind = d.meta?.kind === "Chapter" ? "Chapter" : "Section";
  const subs = (d.sub_results ?? []).filter((s) => s.anchor).slice(0, 3);
  return `<li class="hit">
<p class="where"><span class="badge">${esc(book)}</span> ${esc(kind)}</p>
<h2><a href="${esc(pageUrl(d.url))}">${esc(d.meta?.title ?? d.url)}</a></h2>
<p class="snip">${d.excerpt}</p>
${subs.length ? `<ul class="subs">${subs.map((s) => `<li><a href="${esc(pageUrl(s.url))}">${esc(s.title)}</a>: <span class="snip">${s.excerpt}</span></li>`).join("")}</ul>` : ""}
</li>`;
}

async function showPick(matches, anchor, q) {
  if (matches.length < 2) {
    pick.hidden = true;
    pick.innerHTML = "";
    return;
  }
  pick.innerHTML = `<h2>Pages numbered “${esc(q)}”</h2><ul class="contents">${matches
    .map((m) => `<li><a href="${esc(jumpTarget(m, anchor))}">${esc(`${m.c}. ${m.h}`)}</a></li>`)
    .join("")}</ul>`;
  pick.hidden = false;
}

let runId = 0;
export async function run() {
  const id = ++runId;
  const state = readState();
  if (input && input.value !== state.q) input.value = state.q;
  results.innerHTML = "";
  pager.hidden = true;
  if (!state.q) {
    pick.hidden = true;
    say("Type a section number, like § 259, or some words.");
    return;
  }
  let matches = [];
  let anchor = "";
  try {
    ({ matches, anchor } = lookup(await loadCitations(), state.q));
  } catch (e) {
    console.warn(e);
  }
  if (matches.length === 1) {
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
