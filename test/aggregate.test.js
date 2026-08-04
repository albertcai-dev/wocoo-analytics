import { describe, it, expect } from 'vitest';
import {
  assigneeKey, outcomeOf, rowsForDates, totalsFor,
  byAssignee, byWorkType, dailySeries, partitionRoster, cancelledRate, byWeekday,
} from '../src/aggregate.js';

const row = (assignee, workType, outcome = 'done') => ({ assignee, workType, outcome });

describe('assigneeKey', () => {
  it('keeps roster members', () => {
    expect(assigneeKey('Esther Liao')).toBe('Esther Liao');
  });
  it('folds non-roster humans to Other', () => {
    expect(assigneeKey('Anh Tran')).toBe('Other');
  });
  it('maps null to Unassigned', () => {
    expect(assigneeKey(null)).toBe('Unassigned');
  });
  it('maps empty string to Unassigned', () => {
    expect(assigneeKey('')).toBe('Unassigned');
  });
  it('keeps Other and Unassigned distinct', () => {
    expect(assigneeKey('Anh Tran')).not.toBe(assigneeKey(null));
  });
});

describe('outcomeOf', () => {
  it('recognises the cancelled status, including its internal space', () => {
    expect(outcomeOf('Cancelled/ No Action')).toBe('cancelled');
  });
  it('treats Done as done', () => {
    expect(outcomeOf('Done')).toBe('done');
  });
  // Deliberate default: an unrecognised status counts as work completed rather
  // than silently vanishing from every total.
  it('falls back to done for an unrecognised status', () => {
    expect(outcomeOf('Shipped To Vendor')).toBe('done');
  });
  it('tolerates surrounding whitespace', () => {
    expect(outcomeOf('  Cancelled/ No Action  ')).toBe('cancelled');
  });
});

describe('rowsForDates', () => {
  const dayMap = new Map([
    ['2026-08-01', [row('Albert Cai', 'A')]],
    ['2026-08-02', [row('Esther Liao', 'B')]],
    ['2026-08-03', [row('Albert Cai', 'C')]],
  ]);

  it('collects only the requested dates', () => {
    expect(rowsForDates(dayMap, ['2026-08-02', '2026-08-03'])).toHaveLength(2);
  });

  it('ignores dates absent from the map', () => {
    expect(rowsForDates(dayMap, ['2026-07-30'])).toEqual([]);
  });
});

describe('totalsFor', () => {
  it('counts done and cancelled separately', () => {
    const rows = [
      row('Albert Cai', 'A', 'done'),
      row('Albert Cai', 'A', 'cancelled'),
      row('Esther Liao', 'B', 'done'),
    ];
    expect(totalsFor(rows)).toEqual({ done: 2, cancelled: 1 });
  });

  it('returns zeroes for no rows', () => {
    expect(totalsFor([])).toEqual({ done: 0, cancelled: 0 });
  });
});

describe('byAssignee', () => {
  const rows = [
    row('Albert Cai', 'A'), row('Albert Cai', 'B'),
    row('Esther Liao', 'A'), row('Esther Liao', 'B'), row('Esther Liao', 'C'),
    row('Anh Tran', 'A'),
    row(null, 'A'),
    row('Albert Cai', 'A', 'cancelled'),
  ];

  it('ranks by done count, highest first', () => {
    expect(byAssignee(rows).map((r) => r.key)).toEqual(
      ['Esther Liao', 'Albert Cai', 'Other', 'Unassigned'],
    );
  });

  it('counts cancelled without letting it affect rank', () => {
    const albert = byAssignee(rows).find((r) => r.key === 'Albert Cai');
    expect(albert).toEqual({ key: 'Albert Cai', done: 2, cancelled: 1 });
  });

  it('reconciles: row totals equal the overall total', () => {
    const perRow = byAssignee(rows).reduce(
      (acc, r) => ({ done: acc.done + r.done, cancelled: acc.cancelled + r.cancelled }),
      { done: 0, cancelled: 0 },
    );
    expect(perRow).toEqual(totalsFor(rows));
  });

  it('omits roster members with no rows in the window', () => {
    expect(byAssignee(rows).map((r) => r.key)).not.toContain('Luke Gazmin');
  });
});

describe('byWorkType', () => {
  const rows = [
    row('Albert Cai', 'Credit Card: Overpayment'),
    row('Albert Cai', 'Credit Card: Overpayment'),
    row('Albert Cai', 'Wires Posting'),
    row('Esther Liao', 'Wires Posting'),
  ];

  it('filters to one assignee', () => {
    expect(byWorkType(rows, 'Albert Cai')).toEqual([
      { workType: 'Credit Card: Overpayment', done: 2, cancelled: 0 },
      { workType: 'Wires Posting', done: 1, cancelled: 0 },
    ]);
  });

  it('covers every row when the key is null', () => {
    const total = byWorkType(rows, null).reduce((n, r) => n + r.done, 0);
    expect(total).toBe(4);
  });
});

describe('dailySeries', () => {
  const dayMap = new Map([
    ['2026-08-01', [row('Albert Cai', 'A'), row('Esther Liao', 'A')]],
    ['2026-08-02', [row('Albert Cai', 'A', 'cancelled')]],
    ['2026-08-03', [row('Albert Cai', 'A')]],
  ]);
  const dates = ['2026-08-01', '2026-08-02', '2026-08-03'];

  it('emits one value per date per series', () => {
    const { series } = dailySeries(dayMap, dates);
    const albert = series.find((s) => s.key === 'Albert Cai');
    expect(albert.values).toEqual([1, 0, 1]);
  });

  it('counts only done in the series', () => {
    const { series } = dailySeries(dayMap, dates);
    expect(series.find((s) => s.key === 'Albert Cai').values[1]).toBe(0);
  });

  it('sums the total line across series', () => {
    expect(dailySeries(dayMap, dates).total).toEqual([2, 0, 1]);
  });

  // The critical one: a day we failed to fetch must not look like a quiet day.
  it('yields null, not zero, for a date missing from the map', () => {
    const { series, total } = dailySeries(dayMap, [...dates, '2026-08-04']);
    expect(series.find((s) => s.key === 'Albert Cai').values[3]).toBeNull();
    expect(total[3]).toBeNull();
  });
});

describe('partitionRoster', () => {
  const rows = [
    row('Albert Cai', 'A'), row('Esther Liao', 'A'),
    row('Anh Tran', 'A'), row('Anh Tran', 'B', 'cancelled'),
    row(null, 'A'),
  ];

  it('keeps only roster members in the ranked list', () => {
    const { rostered } = partitionRoster(byAssignee(rows));
    expect(rostered.map((r) => r.key)).toEqual(['Albert Cai', 'Esther Liao']);
  });

  it('sums everyone else into an excluded figure', () => {
    const { excluded } = partitionRoster(byAssignee(rows));
    expect(excluded.other).toEqual({ done: 1, cancelled: 1 });
    expect(excluded.unassigned).toEqual({ done: 1, cancelled: 0 });
  });

  // The reconciliation guarantee: roster rows plus the excluded figures must
  // still equal the headline total, which is why the footnote exists at all.
  it('roster rows plus excluded reconcile with the overall total', () => {
    const { rostered, excluded } = partitionRoster(byAssignee(rows));
    const sum = rostered.reduce(
      (acc, r) => ({ done: acc.done + r.done, cancelled: acc.cancelled + r.cancelled }),
      { done: 0, cancelled: 0 },
    );
    expect({
      done: sum.done + excluded.other.done + excluded.unassigned.done,
      cancelled: sum.cancelled + excluded.other.cancelled + excluded.unassigned.cancelled,
    }).toEqual(totalsFor(rows));
  });

  it('reports zero excluded when everyone is on the roster', () => {
    const { excluded } = partitionRoster(byAssignee([row('Albert Cai', 'A')]));
    expect(excluded.other).toEqual({ done: 0, cancelled: 0 });
    expect(excluded.unassigned).toEqual({ done: 0, cancelled: 0 });
  });
});

describe('cancelledRate', () => {
  it('is the share of handled tickets that were cancelled', () => {
    expect(cancelledRate({ done: 3, cancelled: 1 })).toBeCloseTo(0.25);
  });
  it('is 0 when nothing was cancelled', () => {
    expect(cancelledRate({ done: 5, cancelled: 0 })).toBe(0);
  });
  it('is 1 when everything was cancelled', () => {
    expect(cancelledRate({ done: 0, cancelled: 4 })).toBe(1);
  });
  // Guards the display: 0/0 must not render as NaN%.
  it('is null when there is nothing to rate', () => {
    expect(cancelledRate({ done: 0, cancelled: 0 })).toBeNull();
  });
});

describe('byWeekday', () => {
  // Mon 2026-08-03, Tue 04, ... Sun 09, then Mon 10 again.
  const dayMap = new Map([
    ['2026-08-03', [row('Albert Cai', 'A'), row('Esther Liao', 'A')]],   // Mon: 2
    ['2026-08-04', [row('Albert Cai', 'A')]],                            // Tue: 1
    ['2026-08-08', []],                                                  // Sat: 0
    ['2026-08-10', [row('Albert Cai', 'A'), row('Albert Cai', 'B'),
                    row('Esther Liao', 'C'), row('JC Ulat', 'D')]],      // Mon: 4
  ]);
  const dates = ['2026-08-03', '2026-08-04', '2026-08-08', '2026-08-10'];

  it('returns one entry per weekday, Monday first', () => {
    const result = byWeekday(dayMap, dates);
    expect(result).toHaveLength(7);
    expect(result[0].label).toBe('Mon');
    expect(result[6].label).toBe('Sun');
  });

  // The whole point: a 30-day window holds 4 or 5 of each weekday, so totals would
  // rank weekdays by how often they happened to appear rather than how busy they are.
  it('averages across the sampled days rather than totalling', () => {
    const mon = byWeekday(dayMap, dates)[0];
    expect(mon.days).toBe(2);
    expect(mon.total).toBe(6);
    expect(mon.mean).toBe(3);
  });

  it('counts a loaded-but-empty day as a zero, not as absent', () => {
    const sat = byWeekday(dayMap, dates)[5];
    expect(sat.days).toBe(1);
    expect(sat.mean).toBe(0);
  });

  // A day that failed to load is unknown, so it must not drag the average down.
  it('excludes days missing from the map entirely', () => {
    const result = byWeekday(dayMap, [...dates, '2026-08-11']);   // Tue, never fetched
    expect(result[1].days).toBe(1);
    expect(result[1].mean).toBe(1);
  });

  it('reports mean null for a weekday with no sampled days', () => {
    expect(byWeekday(dayMap, ['2026-08-03'])[2].mean).toBeNull();
  });

  it('ignores cancelled tickets', () => {
    const map = new Map([['2026-08-03', [row('Albert Cai', 'A', 'cancelled')]]]);
    expect(byWeekday(map, ['2026-08-03'])[0].mean).toBe(0);
  });
});
