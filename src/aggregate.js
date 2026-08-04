// Pure aggregation over a day-keyed map of rows. No I/O, and no date arithmetic of its
// own — the day is the map key, so there is nothing here to get wrong about timezones.
//
// Depends on dates.js only for weekday naming; build.js already orders dates before
// aggregate, so the two share scope in the bundle.
import { WEEKDAY_LABELS, weekdayIndex } from './dates.js';

export const ROSTER = ['Albert Cai', 'Esther Liao', 'Ishan Jain', 'Luke Gazmin', 'JC Ulat'];

const UNASSIGNED = 'Unassigned';
const OTHER = 'Other';
const CANCELLED_STATUS = 'Cancelled/ No Action';

/** Roster members keep their name; everyone else folds to Other; nobody is Unassigned.
 *  Other and Unassigned stay distinct so it's visible whether work is going to
 *  untracked people or to nobody. */
export function assigneeKey(name) {
  const trimmed = (name || '').trim();
  if (!trimmed) return UNASSIGNED;
  return ROSTER.includes(trimmed) ? trimmed : OTHER;
}

/** Anything that isn't explicitly cancelled counts as done. Deliberate: an
 *  unrecognised status should inflate nothing but also vanish from nothing. */
export function outcomeOf(statusName) {
  return (statusName || '').trim() === CANCELLED_STATUS ? 'cancelled' : 'done';
}

export function rowsForDates(dayMap, dates) {
  const out = [];
  for (const date of dates) {
    const rows = dayMap.get(date);
    if (rows) out.push(...rows);
  }
  return out;
}

export function totalsFor(rows) {
  let done = 0;
  let cancelled = 0;
  for (const r of rows) {
    if (r.outcome === 'cancelled') cancelled++;
    else done++;
  }
  return { done, cancelled };
}

function rankByDone(entries) {
  return entries
    .sort((a, b) => b.done - a.done || a.__label.localeCompare(b.__label))
    .map(({ __label, ...rest }) => rest);
}

export function byAssignee(rows) {
  const acc = new Map();
  for (const r of rows) {
    const key = assigneeKey(r.assignee);
    if (!acc.has(key)) acc.set(key, { key, done: 0, cancelled: 0, __label: key });
    const entry = acc.get(key);
    if (r.outcome === 'cancelled') entry.cancelled++;
    else entry.done++;
  }
  return rankByDone([...acc.values()]);
}

export function byWorkType(rows, key) {
  const acc = new Map();
  for (const r of rows) {
    if (key !== null && assigneeKey(r.assignee) !== key) continue;
    const workType = r.workType || 'Unknown';
    if (!acc.has(workType)) {
      acc.set(workType, { workType, done: 0, cancelled: 0, __label: workType });
    }
    const entry = acc.get(workType);
    if (r.outcome === 'cancelled') entry.cancelled++;
    else entry.done++;
  }
  return rankByDone([...acc.values()]);
}

/** Split a ranked byAssignee list into roster rows and everyone else.
 *
 *  The board shows only the roster, but the headline total still counts every
 *  ticket — so the excluded figures have to be reported somewhere or the rows
 *  visibly fail to add up. That footnote is what keeps the arithmetic honest. */
export function partitionRoster(entries) {
  const zero = () => ({ done: 0, cancelled: 0 });
  const excluded = { other: zero(), unassigned: zero() };
  const rostered = [];

  for (const entry of entries) {
    if (ROSTER.includes(entry.key)) {
      rostered.push(entry);
      continue;
    }
    const bucket = entry.key === UNASSIGNED ? excluded.unassigned : excluded.other;
    bucket.done += entry.done;
    bucket.cancelled += entry.cancelled;
  }

  return { rostered, excluded };
}

/** One line per assignee plus a total line. A date absent from the map is null,
 *  never 0 — a day we failed to fetch must not render as a quiet day. */
export function dailySeries(dayMap, dates) {
  const keys = new Set();
  for (const date of dates) {
    for (const r of dayMap.get(date) || []) keys.add(assigneeKey(r.assignee));
  }

  const series = [...keys].sort().map((key) => ({
    key,
    values: dates.map((date) => {
      const rows = dayMap.get(date);
      if (!rows) return null;
      return rows.filter(
        (r) => assigneeKey(r.assignee) === key && r.outcome !== 'cancelled',
      ).length;
    }),
  }));

  const total = dates.map((date) => {
    const rows = dayMap.get(date);
    if (!rows) return null;
    return rows.filter((r) => r.outcome !== 'cancelled').length;
  });

  return { dates, series, total };
}

/** Share of handled tickets that ended cancelled, or null when nothing was handled.
 *  Null rather than 0 so the display can show "—" instead of a meaningless 0%. */
export function cancelledRate({ done, cancelled }) {
  const handled = done + cancelled;
  return handled === 0 ? null : cancelled / handled;
}

/**
 * Completed-per-weekday, Monday first.
 *
 * Reports the mean, not the total: a 30-day window contains four of some weekdays and
 * five of others, so totals would rank weekdays by how often they appeared rather than
 * by how busy they are. Days absent from the map never loaded, so they are excluded
 * from both numerator and denominator — counting them as zero would invent a lull.
 */
export function byWeekday(dayMap, dates) {
  const buckets = WEEKDAY_LABELS.map((label) => ({ label, total: 0, days: 0, mean: null }));

  for (const date of dates) {
    const rows = dayMap.get(date);
    if (!rows) continue;
    const bucket = buckets[weekdayIndex(date)];
    bucket.days += 1;
    bucket.total += rows.filter((r) => r.outcome !== 'cancelled').length;
  }

  for (const bucket of buckets) {
    if (bucket.days > 0) bucket.mean = bucket.total / bucket.days;
  }
  return buckets;
}
