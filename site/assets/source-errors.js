// The filters on "Errors in the publisher's text" (/source-errors/). The list is plain HTML and
// reads in full with JavaScript off; this shows the three filters (book, kind of error, status),
// hides the rows they leave out, says how many are shown (a polite live region), and keeps the
// choice in the address (?book=rules&kind=...&status=...), so a filtered list can be linked.
//
// The filters are native <select> elements with visible labels: a keyboard moves through them
// with Tab and the arrow keys, and a screen reader names each one. Pure parts are exported so
// the unit tests can run them in Node.

export const FILTER_KEYS = Object.freeze(["book", "kind", "status"]);

/** Does a row (its data-book, data-kind, data-status) match the chosen filters? "" means any. */
export function rowMatches(row, chosen) {
  return FILTER_KEYS.every((k) => !chosen[k] || row[k] === chosen[k]);
}

/** The live line: "12 errors.", "Showing 3 of 12 errors.", "No errors match these filters." */
export function countLine(shown, total) {
  const errors = (n) => `${n} ${n === 1 ? "error" : "errors"}`;
  if (shown === total) return `${errors(total)}.`;
  if (shown === 0) return `No errors match these filters. ${errors(total)} in all.`;
  return `Showing ${shown} of ${errors(total)}.`;
}

/** The filters from an address's query, keeping only values a select offers. */
export function chosenFromQuery(search, offered) {
  const q = new URLSearchParams(search);
  const out = {};
  for (const k of FILTER_KEYS) {
    const v = q.get(k) ?? "";
    out[k] = offered[k]?.includes(v) ? v : "";
  }
  return out;
}

function start() {
  const form = document.getElementById("se-filters");
  const list = document.getElementById("se-list");
  if (!form || !list) return;
  const status = document.getElementById("se-count");
  const whole = status.textContent; // the build's own line for the whole list
  const rows = [...list.querySelectorAll(":scope > li")];
  const selects = Object.fromEntries(FILTER_KEYS.map((k) => [k, form.querySelector(`select[name="${k}"]`)]));
  const offered = Object.fromEntries(FILTER_KEYS.map((k) => [k, [...(selects[k]?.options ?? [])].map((o) => o.value)]));

  const apply = ({ announce }) => {
    const chosen = Object.fromEntries(FILTER_KEYS.map((k) => [k, selects[k]?.value ?? ""]));
    let shown = 0;
    for (const li of rows) {
      const on = rowMatches(li.dataset, chosen);
      li.hidden = !on;
      if (on) shown++;
    }
    // The whole list gets the build's own line back ("12 errors, 12 not yet checked.").
    if (announce || shown !== rows.length) status.textContent = shown === rows.length ? whole : countLine(shown, rows.length);
    const u = new URL(location.href);
    for (const k of FILTER_KEYS) {
      if (chosen[k]) u.searchParams.set(k, chosen[k]);
      else u.searchParams.delete(k);
    }
    history.replaceState(null, "", u);
  };

  const chosen = chosenFromQuery(location.search, offered);
  for (const k of FILTER_KEYS) if (selects[k]) selects[k].value = chosen[k];
  form.hidden = false;
  form.addEventListener("change", () => apply({ announce: true }));
  form.addEventListener("submit", (e) => e.preventDefault());
  if (FILTER_KEYS.some((k) => chosen[k])) apply({ announce: false });
}

if (typeof document !== "undefined") start();
