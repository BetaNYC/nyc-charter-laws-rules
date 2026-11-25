// The picture description page (issue #87). Two modes, set by the page's meta tag:
//   local:  served by `npm run alt:review`; Save posts to the local server, which writes
//           data/alt-text/<book>.json.
//   static: built by `npm run alt:build-static` for GitHub Pages; "Suggest a better
//           description" opens a prefilled new GitHub issue instead.
// All text from the data is set with textContent or .value, never as HTML.

import { issueUrl } from "./issue-url.js";

const $ = (id) => document.getElementById(id);
const meta = (name) => document.querySelector(`meta[name="${name}"]`)?.content ?? "";
const MODE = meta("alt-review-mode") === "static" ? "static" : "local";
const TOKEN = meta("alt-review-token");
const BOOKS = { admin_code: "Administrative Code", rules: "Rules" };
const STATUS_NAMES = { none: "Not drafted", drafted: "Drafted, not reviewed", "needs-work": "Needs work", reviewed: "Reviewed" };

let items = [];
let shown = [];
let at = 0;
let dirty = false;
let warnedLeave = false;

const statusOf = (item) => item.entry?.status ?? "none";
// The index's heading often starts with the citation ("§ 81.49 Sodium Warning."): say it once.
const placeName = (u) => (!u.heading || u.heading.startsWith(u.citation) ? u.heading || u.citation : `${u.citation}: ${u.heading}`);
const keyOf = (item) => `${item.book}/${item.sha256}`;

function setStatus(text) {
  $("save-status").textContent = text;
}

function currentText(item) {
  const e = item.entry;
  if (!e) return { alt: "", long: "" };
  if (e.review && (e.review.alt || e.review.long)) return { alt: e.review.alt ?? "", long: e.review.long ?? "" };
  return { alt: e.draft?.alt ?? "", long: e.draft?.long ?? "" };
}

function progress() {
  const reviewed = items.filter((i) => statusOf(i) === "reviewed").length;
  const drafted = items.filter((i) => i.entry?.draft).length;
  const filter = shown.length === items.length ? "" : ` Showing ${shown.length} that match.`;
  $("progress").textContent = `${reviewed} of ${items.length} pictures reviewed; ${drafted} have an AI draft.${filter}`;
}

function applyFilters(keepKey) {
  const book = $("filter-book").value;
  const status = $("filter-status").value;
  shown = items.filter((i) => (!book || i.book === book) && (!status || statusOf(i) === status));
  const keep = keepKey ? shown.findIndex((i) => keyOf(i) === keepKey) : -1;
  at = keep >= 0 ? keep : 0;
  progress();
  render(false);
}

function el(tag, text, cls) {
  const n = document.createElement(tag);
  if (text != null) n.textContent = text;
  if (cls) n.className = cls;
  return n;
}

function render(moveFocus) {
  const item = shown[at];
  $("item").hidden = !item;
  $("empty").hidden = !!item;
  $("prev").disabled = at <= 0;
  $("next").disabled = at >= shown.length - 1;
  $("position").textContent = item ? `Picture ${at + 1} of ${shown.length}` : "";
  dirty = false;
  warnedLeave = false;
  setStatus("");
  if (!item) return;

  const first = item.uses[0] ?? {};
  $("item-heading").textContent = `${BOOKS[item.book]} ${placeName(first)}`.trim();
  const img = $("picture");
  img.src = item.image_url;
  img.alt = "The picture being described. Its current description is in the form below.";
  if (item.width && item.height) {
    img.width = item.width;
    img.height = item.height;
    // Small pictures (icons, glyphs) are shown larger so their detail can be checked.
    const scale = item.width < 200 ? Math.min(4, 320 / item.width) : 1;
    img.style.width = `${Math.round(item.width * scale)}px`;
  }
  const facts = [`File ${item.image_ids.join(", ")}`, item.width ? `${item.width} × ${item.height} px` : "", `used ${item.uses.length} time${item.uses.length === 1 ? "" : "s"}`, `status: ${STATUS_NAMES[statusOf(item)]}`];
  $("picture-facts").textContent = facts.filter(Boolean).join(" · ");

  const list = $("uses");
  list.replaceChildren();
  item.uses.forEach((u, n) => {
    const li = document.createElement("li");
    li.append(el("p", `${placeName(u)} (${u.inline ? "inside a sentence" : "on its own line"})`));
    li.append(el("p", "The paragraph, with the picture's place marked [this picture]:", "meta"));
    li.append(el("blockquote", u.paragraph));
    // A disclosure button rather than <details>: it has a role and a name of its own in every
    // browser, and each one's name says which use it opens.
    const region = document.createElement("div");
    region.id = `use-context-${n + 1}`;
    region.hidden = true;
    region.append(el("p", "Before:", "meta"), el("blockquote", u.before || "(none)"), el("p", "After:", "meta"), el("blockquote", u.after || "(none)"));
    const toggle = el("button", `Show the text around use ${n + 1}`, "disclosure");
    toggle.type = "button";
    toggle.setAttribute("aria-expanded", "false");
    toggle.setAttribute("aria-controls", region.id);
    toggle.addEventListener("click", () => {
      const open = region.hidden;
      region.hidden = !open;
      toggle.setAttribute("aria-expanded", String(open));
      toggle.textContent = `${open ? "Hide" : "Show"} the text around use ${n + 1}`;
    });
    li.append(toggle, region);
    list.append(li);
  });

  const e = item.entry;
  const draft = e?.draft;
  $("draft-alt").value = draft?.alt ?? "";
  $("draft-long").value = draft?.long ?? "";
  $("draft-meta").textContent = draft ? `Drafted by ${e.draft_model ?? "an AI model"} on ${(e.drafted_at ?? "").slice(0, 10)}.` : "No AI draft yet.";
  const unsure = $("draft-unsure");
  unsure.hidden = !draft?.unsure;
  unsure.textContent = draft?.unsure ? `The model was unsure about: ${draft.unsure}` : "";

  if (MODE === "local") {
    const rev = e?.review;
    $("review-alt").value = rev ? rev.alt ?? "" : draft?.alt ?? "";
    $("review-long").value = rev ? rev.long ?? "" : draft?.long ?? "";
    $("review-note").value = rev?.note ?? "";
    const status = e?.status && e.status !== "drafted" ? e.status : "reviewed";
    for (const r of document.querySelectorAll('input[name="status"]')) r.checked = r.value === status;
  } else {
    const cur = currentText(item);
    $("review-alt").value = cur.alt;
    $("review-long").value = cur.long;
    $("review-why").value = "";
    updateSuggestLink();
  }
  if (history.replaceState) history.replaceState(null, "", `#${keyOf(item)}`);
  if (moveFocus) $("item-heading").focus();
}

function move(by) {
  const to = at + by;
  if (to < 0 || to >= shown.length) return;
  if (dirty && !warnedLeave) {
    warnedLeave = true;
    setStatus(MODE === "local" ? "You have unsaved changes. Save them, or press the button again to leave without saving." : "Your suggestion is not sent yet. Press the button again to leave it.");
    return;
  }
  at = to;
  render(true);
}

async function save(goNext) {
  const item = shown[at];
  if (!item) return;
  const status = document.querySelector('input[name="status"]:checked')?.value ?? "reviewed";
  const body = {
    book: item.book,
    sha256: item.sha256,
    status,
    base: item.entry?.updated_at ?? null,
    review: { alt: $("review-alt").value, long: $("review-long").value, note: $("review-note").value },
  };
  $("save").disabled = true;
  $("save-next").disabled = true;
  setStatus("Saving…");
  try {
    const res = await fetch("api/save", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Alt-Review-Token": TOKEN },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (res.status === 409) {
      item.entry = data.current;
      setStatus("Not saved: someone else changed this description since you opened it. Your text is still in the boxes; copy it, then move away and back to see the newer version.");
      return;
    }
    if (!res.ok) {
      setStatus(`Not saved: ${data.error ?? res.statusText}`);
      return;
    }
    item.entry = data.entry;
    dirty = false;
    progress();
    $("picture-facts").textContent = $("picture-facts").textContent.replace(/status: .*$/, `status: ${STATUS_NAMES[statusOf(item)]}`);
    if (goNext && at < shown.length - 1) {
      at++;
      render(true);
      setStatus("Saved the last picture.");
    } else setStatus(`Saved. Status: ${STATUS_NAMES[statusOf(item)]}.`);
  } catch (e) {
    setStatus(`Not saved: ${e.message}`);
  } finally {
    $("save").disabled = false;
    $("save-next").disabled = false;
  }
}

function updateSuggestLink() {
  const item = shown[at];
  if (!item) return;
  const first = item.uses[0] ?? {};
  const reviewed = item.entry?.review && (item.entry.review.alt || item.entry.review.long);
  const { url, cut } = issueUrl(
    {
      book: item.book,
      citation: first.citation,
      heading: first.heading,
      picture_ids: item.picture_ids,
      image_ids: item.image_ids,
      sha256: item.sha256,
      currentLabel: reviewed ? "reviewed by BetaNYC" : item.entry?.draft ? "AI draft, not reviewed" : "none yet",
      why: $("review-why").value,
    },
    currentText(item),
    { alt: $("review-alt").value, long: $("review-long").value },
  );
  $("suggest").href = url;
  const note = $("suggest-note");
  note.hidden = !cut;
  note.textContent = cut ? "Your text is too long for one link, so the issue will start with a shortened copy. Paste the rest into the issue before you submit it." : "";
}

async function load() {
  document.body.dataset.mode = MODE;
  if (MODE === "static") $("review-heading").textContent = "Your suggestion";
  try {
    const res = MODE === "local" ? await fetch("api/items", { headers: { "X-Alt-Review-Token": TOKEN } }) : await fetch("data.json");
    if (!res.ok) throw new Error(res.statusText);
    items = (await res.json()).items;
  } catch (e) {
    $("progress").textContent = `Could not load the pictures: ${e.message}`;
    return;
  }
  const wanted = decodeURIComponent(location.hash.slice(1));
  applyFilters(wanted || null);
}

$("filter-book").addEventListener("change", () => applyFilters(shown[at] && keyOf(shown[at])));
$("filter-status").addEventListener("change", () => applyFilters(shown[at] && keyOf(shown[at])));
$("prev").addEventListener("click", () => move(-1));
$("next").addEventListener("click", () => move(1));
$("review-form").addEventListener("submit", (ev) => {
  ev.preventDefault();
  if (MODE === "local") save(false);
});
$("save-next").addEventListener("click", () => save(true));
for (const id of ["review-alt", "review-long", "review-note", "review-why"]) {
  $(id).addEventListener("input", () => {
    dirty = true;
    warnedLeave = false;
    if (MODE === "static") updateSuggestLink();
  });
}
for (const r of document.querySelectorAll('input[name="status"]')) r.addEventListener("change", () => (dirty = true));
document.addEventListener("keydown", (ev) => {
  if (MODE === "local" && ev.key === "Enter" && (ev.ctrlKey || ev.metaKey) && ev.target instanceof HTMLTextAreaElement && !ev.target.readOnly) {
    ev.preventDefault();
    save(false);
  }
});
load();
