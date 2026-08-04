// Date helpers over 'YYYY-MM-DD' strings.
//
// All arithmetic goes through Date.UTC. Parsing 'YYYY-MM-DD' with `new Date(str)`
// yields UTC midnight, but reading it back with getFullYear/getMonth/getDate
// applies the local offset — west of Greenwich that reports the previous day.
// Staying in UTC for both ends sidesteps it entirely.

function toUTC(date) {
  const [y, m, d] = date.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
}

function toISODate(ms) {
  const d = new Date(ms);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** The calendar day after `date`. */
export function nextDate(date) {
  return toISODate(toUTC(date) + DAY_MS);
}

/** The `n` calendar days ending at `today`, oldest first. */
export function lastNDates(n, today) {
  const end = toUTC(today);
  const out = [];
  for (let i = n - 1; i >= 0; i--) {
    out.push(toISODate(end - i * DAY_MS));
  }
  return out;
}

/** Inclusive day count from `from` to `to`, so a single day is 1. Used to work out
 *  how wide the cached range already is when deciding what a refresh must renew. */
export function daysBetween(from, to) {
  return Math.round((toUTC(to) - toUTC(from)) / DAY_MS) + 1;
}

export const WEEKDAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/** Weekday of a date string, Monday = 0. Monday-first because the working week is
 *  what the pattern is read against; getUTCDay puts Sunday at 0, hence the shift. */
export function weekdayIndex(date) {
  const [y, m, d] = date.split('-').map(Number);
  return (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7;
}
