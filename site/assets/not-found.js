// The 404 page (issue #62): an address that ends in one of American Legal Publishing's record
// ids goes to the page for that record, from redirects.json: /charter/0-0-0-1263,
// /NYCcharter/0-0-0-1263, /0-0-0-1263, and an old path with the id on the end, such as
// /charter/sections/530-0-0-0-6575 after § 530 stops being shared. A bare id that is in both the
// Charter and the Administrative Code goes to neither: the page lists both. Without JavaScript
// the page offers the contents and search.
//
// The Rules (issue #65): /NYCrules/0-0-0-21089 and /rules/0-0-0-21089 go to that record's page, as
// the other books' ids do. A Rules section number is only a page under its title
// (/rules/titles/15/sections/1-01); /rules/sections/1-01, a number in several titles, is a page to
// pick one, and /rules/sections/3-01 for a number in one title only goes to its page, from
// /rules/numbers.json (rulesNumberFor).
const BOOK_ALIASES = { nyccharter: "charter", charter: "charter", nycadmin: "admin-code", "admin-code": "admin-code", nycrules: "rules", rules: "rules" };

/** The books' names on the 404 page, when an id is in more than one. */
export const BOOK_NAMES = { charter: "the Charter", "admin-code": "the Administrative Code", rules: "the Rules" };

/** The page for /rules/sections/<number> when that number is in one title only, from numbers.json; else null. */
export function rulesNumberFor(pathname, numbers) {
  const m = /^\/rules\/sections\/([^/]+?)\/?$/.exec(pathname);
  if (!m) return null;
  let n;
  try {
    n = decodeURIComponent(m[1]).toLowerCase();
  } catch {
    return null; // "/rules/sections/50%": not percent-encoding, so no number
  }
  return Object.prototype.hasOwnProperty.call(numbers ?? {}, n) ? numbers[n] : null;
}

/**
 * Every page an address could mean: [{ book, to }]. An address that names a book (/charter/…,
 * /NYCadmin/…) looks only in that book; a bare id (/0-0-0-1263) looks in every book, and can be
 * in more than one (68 ids are in both the Charter and the Administrative Code).
 */
export function redirectChoices(pathname, redirects) {
  const parts = pathname.split("/").filter(Boolean);
  const m = /(\d+-\d+-\d+-\d+)$/.exec(parts[parts.length - 1] ?? "");
  if (!m) return [];
  const id = m[1];
  const named = parts.slice(0, -1).map((p) => BOOK_ALIASES[p.toLowerCase()]).find(Boolean);
  const books = named ? [named] : Object.keys(redirects);
  return books.filter((b) => redirects[b]?.[id]).map((b) => ({ book: b, to: redirects[b][id] }));
}

/** Where to go: the one page the address means, or null when it means none or more than one. */
export function redirectFor(pathname, redirects) {
  const choices = redirectChoices(pathname, redirects);
  return choices.length === 1 ? choices[0].to : null;
}

async function main() {
  try {
    if (/^\/rules\/sections\/[^/]+\/?$/.test(location.pathname)) {
      const n = await fetch("/rules/numbers.json");
      const to = n.ok ? rulesNumberFor(location.pathname, await n.json()) : null;
      if (to) {
        const status = document.getElementById("redirect-status");
        if (status) status.textContent = `Going to ${to}.`;
        location.replace(to + location.hash);
        return;
      }
    }
    const r = await fetch("/redirects.json");
    if (!r.ok) return;
    const choices = redirectChoices(location.pathname, await r.json());
    const status = document.getElementById("redirect-status");
    if (choices.length === 1) {
      const to = choices[0].to;
      if (status) status.textContent = `This text has moved. Going to ${to}.`;
      location.replace(to + location.hash);
    } else if (choices.length > 1 && status) {
      // The id is in more than one book: let the reader pick, rather than guess.
      status.textContent = "This American Legal Publishing id is in more than one book. Pick one:";
      const list = document.createElement("ul");
      for (const c of choices) {
        const li = document.createElement("li");
        const a = document.createElement("a");
        a.href = c.to + location.hash;
        a.textContent = `${c.to} in ${BOOK_NAMES[c.book] ?? c.book}`;
        li.append(a);
        list.append(li);
      }
      status.after(list);
    }
  } catch (e) {
    console.warn(e);
  }
}

if (typeof document !== "undefined") main();
