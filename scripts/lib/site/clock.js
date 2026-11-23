// The site's one clock (epic #68 rule: every date and "current through" comes from one
// America/New_York clock). Every date the site prints goes through here. Nothing here reads
// the system clock: the build passes in its own `now` once, so tests can fix it.

const TZ = "America/New_York";

function parts(date, opts) {
  const out = {};
  for (const p of new Intl.DateTimeFormat("en-US", { timeZone: TZ, ...opts }).formatToParts(date)) out[p.type] = p.value;
  return out;
}

function asDate(value) {
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) throw new Error(`not a date: ${value}`);
  return d;
}

/** "2026-11-22": the calendar day in New York. */
export function newYorkDay(value) {
  const p = parts(asDate(value), { year: "numeric", month: "2-digit", day: "2-digit" });
  return `${p.year}-${p.month}-${p.day}`;
}

/** "November 22, 2026": the calendar day in New York, written out. */
export function newYorkLongDate(value) {
  const p = parts(asDate(value), { year: "numeric", month: "long", day: "numeric" });
  return `${p.month} ${p.day}, ${p.year}`;
}

/** "2026-11-22T22:30:05-05:00": the moment, in New York time with its UTC offset. */
export function newYorkIso(value) {
  const d = asDate(value);
  const p = parts(d, {
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
  });
  const local = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
  const offsetMin = Math.round((local - Math.floor(d.getTime() / 1000) * 1000) / 60000);
  const sign = offsetMin < 0 ? "-" : "+";
  const abs = Math.abs(offsetMin);
  const oh = String(Math.floor(abs / 60)).padStart(2, "0");
  const om = String(abs % 60).padStart(2, "0");
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}${sign}${oh}:${om}`;
}
