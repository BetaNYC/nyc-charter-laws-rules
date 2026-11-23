// The 404 page (issue #62): an address that ends in one of American Legal Publishing's record
// ids (/charter/0-0-0-1263, /NYCcharter/0-0-0-1263, /0-0-0-1263) goes to the page for that
// record, from redirects.json. Without JavaScript the page offers the contents and search.
const BOOK_ALIASES = { nyccharter: "charter", charter: "charter" };

export function redirectFor(pathname, redirects) {
  const parts = pathname.split("/").filter(Boolean);
  const id = parts[parts.length - 1];
  if (!id || !/^\d+-\d+-\d+-\d+$/.test(id)) return null;
  const named = parts.length > 1 ? BOOK_ALIASES[parts[parts.length - 2].toLowerCase()] : null;
  const books = named ? [named] : Object.keys(redirects);
  for (const b of books) {
    const to = redirects[b]?.[id];
    if (to) return to;
  }
  return null;
}

async function main() {
  try {
    const r = await fetch("/redirects.json");
    if (!r.ok) return;
    const to = redirectFor(location.pathname, await r.json());
    if (to) {
      const status = document.getElementById("redirect-status");
      if (status) status.textContent = `This text has moved. Going to ${to}.`;
      location.replace(to + location.hash);
    }
  } catch (e) {
    console.warn(e);
  }
}

if (typeof document !== "undefined") main();
