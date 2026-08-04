// Pure aggregation over a day-keyed map of rows. No I/O, no date arithmetic —
// the day is the map key, so there is nothing here to get wrong about timezones.

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
