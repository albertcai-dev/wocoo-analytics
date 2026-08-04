import { describe, it, expect } from 'vitest';
import { lastNDates, nextDate, daysBetween } from '../src/dates.js';

describe('nextDate', () => {
  it('advances one day', () => {
    expect(nextDate('2026-08-03')).toBe('2026-08-04');
  });

  it('crosses a month boundary', () => {
    expect(nextDate('2026-07-31')).toBe('2026-08-01');
  });

  it('crosses a year boundary', () => {
    expect(nextDate('2026-12-31')).toBe('2027-01-01');
  });

  it('handles a leap day', () => {
    expect(nextDate('2028-02-28')).toBe('2028-02-29');
  });

  // Toronto is UTC-4 in March. Naive local-time parsing would land on the wrong
  // day here; UTC arithmetic must not.
  it('is unaffected by a DST transition', () => {
    expect(nextDate('2026-03-08')).toBe('2026-03-09');
  });
});

describe('lastNDates', () => {
  it('returns exactly n dates', () => {
    expect(lastNDates(7, '2026-08-03')).toHaveLength(7);
  });

  it('ends on today and starts n-1 days earlier', () => {
    const result = lastNDates(7, '2026-08-03');
    expect(result[6]).toBe('2026-08-03');
    expect(result[0]).toBe('2026-07-28');
  });

  it('returns just today for n=1', () => {
    expect(lastNDates(1, '2026-08-03')).toEqual(['2026-08-03']);
  });

  it('is sorted oldest first', () => {
    const result = lastNDates(30, '2026-08-03');
    expect([...result].sort()).toEqual(result);
  });
});

describe('daysBetween', () => {
  it('counts a single day span as 1', () => {
    expect(daysBetween('2026-08-03', '2026-08-03')).toBe(1);
  });

  it('counts an inclusive span', () => {
    expect(daysBetween('2026-07-28', '2026-08-03')).toBe(7);
  });

  it('spans a year', () => {
    expect(daysBetween('2025-08-04', '2026-08-03')).toBe(365);
  });

  // Same UTC-arithmetic reason as nextDate: local getters would drift a day.
  it('is unaffected by a DST transition', () => {
    expect(daysBetween('2026-03-07', '2026-03-09')).toBe(3);
  });
});
