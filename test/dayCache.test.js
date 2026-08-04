import { describe, it, expect, vi } from 'vitest';
import { createDayCache } from '../src/dayCache.js';

const row = (assignee) => ({ assignee, workType: 'T', outcome: 'done' });

function fakeClient(impl) {
  const calls = [];
  return {
    calls,
    fetchDay: vi.fn(async (date) => {
      calls.push(date);
      return impl ? impl(date) : [row('Albert Cai')];
    }),
  };
}

function fakeStorage() {
  const store = new Map();
  return {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, v),
    removeItem: (k) => store.delete(k),
  };
}

describe('ensureDays', () => {
  it('fetches each requested day once', async () => {
    const client = fakeClient();
    const cache = createDayCache(client, fakeStorage());
    await cache.ensureDays(['2026-08-01', '2026-08-02']);
    expect(client.fetchDay).toHaveBeenCalledTimes(2);
    expect(cache.size()).toBe(2);
  });

  // The behaviour that replaces the old cumulative-merge guarantee: once the wide
  // window is loaded, narrower ones are free.
  it('issues no further fetches for a subset already held', async () => {
    const client = fakeClient();
    const cache = createDayCache(client, fakeStorage());
    await cache.ensureDays(['2026-08-01', '2026-08-02', '2026-08-03']);
    client.fetchDay.mockClear();
    await cache.ensureDays(['2026-08-02', '2026-08-03']);
    expect(client.fetchDay).not.toHaveBeenCalled();
  });

  it('fetches only the days it is missing when widening', async () => {
    const client = fakeClient();
    const cache = createDayCache(client, fakeStorage());
    await cache.ensureDays(['2026-08-02', '2026-08-03']);
    client.fetchDay.mockClear();
    await cache.ensureDays(['2026-08-01', '2026-08-02', '2026-08-03']);
    expect(client.fetchDay).toHaveBeenCalledTimes(1);
    expect(client.fetchDay).toHaveBeenCalledWith('2026-08-01');
  });

  it('does not duplicate rows when a day is requested twice', async () => {
    const client = fakeClient();
    const cache = createDayCache(client, fakeStorage());
    await cache.ensureDays(['2026-08-01']);
    await cache.ensureDays(['2026-08-01']);
    expect(cache.getDayMap().get('2026-08-01')).toHaveLength(1);
  });

  it('keeps good days and marks the failed one when one day rejects', async () => {
    const client = fakeClient((date) => {
      if (date === '2026-08-02') throw new Error('boom');
      return [row('Albert Cai')];
    });
    const cache = createDayCache(client, fakeStorage());
    await cache.ensureDays(['2026-08-01', '2026-08-02', '2026-08-03']);

    expect(cache.getMissing()).toEqual(new Set(['2026-08-02']));
    expect(cache.getDayMap().has('2026-08-01')).toBe(true);
    expect(cache.getDayMap().has('2026-08-03')).toBe(true);
    // Critical: a failed day must be absent, not an empty array. An empty array
    // aggregates to 0 and renders as a genuine quiet day.
    expect(cache.getDayMap().has('2026-08-02')).toBe(false);
  });

  it('retries a previously failed day on the next call', async () => {
    let fail = true;
    const client = fakeClient((date) => {
      if (date === '2026-08-02' && fail) throw new Error('boom');
      return [row('Albert Cai')];
    });
    const cache = createDayCache(client, fakeStorage());
    await cache.ensureDays(['2026-08-02']);
    fail = false;
    await cache.ensureDays(['2026-08-02']);
    expect(cache.getDayMap().has('2026-08-02')).toBe(true);
    expect(cache.getMissing().size).toBe(0);
  });

  it('reports progress as days settle', async () => {
    const client = fakeClient();
    const cache = createDayCache(client, fakeStorage());
    const seen = [];
    await cache.ensureDays(['2026-08-01', '2026-08-02'], (p) => seen.push(p));
    expect(seen[seen.length - 1]).toEqual({ loaded: 2, total: 2 });
  });

  it('reports total 0 and fetches nothing when everything is cached', async () => {
    const client = fakeClient();
    const cache = createDayCache(client, fakeStorage());
    await cache.ensureDays(['2026-08-01']);
    const seen = [];
    await cache.ensureDays(['2026-08-01'], (p) => seen.push(p));
    expect(seen).toEqual([{ loaded: 0, total: 0 }]);
  });
});

describe('sessionStorage mirror', () => {
  it('restores a previous session without fetching', async () => {
    const storage = fakeStorage();
    const first = createDayCache(fakeClient(), storage);
    await first.ensureDays(['2026-08-01']);

    const client = fakeClient();
    const second = createDayCache(client, storage);
    await second.ensureDays(['2026-08-01']);
    expect(client.fetchDay).not.toHaveBeenCalled();
    expect(second.getDayMap().get('2026-08-01')).toHaveLength(1);
  });

  it('still works when storage throws a quota error', async () => {
    const storage = {
      getItem: () => null,
      setItem: () => { throw new Error('QuotaExceededError'); },
      removeItem: () => {},
    };
    const cache = createDayCache(fakeClient(), storage);
    await expect(cache.ensureDays(['2026-08-01'])).resolves.toBeUndefined();
    expect(cache.size()).toBe(1);
  });

  it('ignores corrupt stored data rather than throwing', async () => {
    const storage = fakeStorage();
    storage.setItem('wocoo-analytics/days/v1', 'not json');
    const cache = createDayCache(fakeClient(), storage);
    await cache.ensureDays(['2026-08-01']);
    expect(cache.size()).toBe(1);
  });
});

describe('retry and backoff', () => {
  const noSleep = () => Promise.resolve();

  it('retries a day that fails once, then keeps the result', async () => {
    let calls = 0;
    const client = {
      fetchDay: vi.fn(async () => {
        calls++;
        if (calls === 1) throw new Error('429');
        return [row('Albert Cai')];
      }),
    };
    const cache = createDayCache(client, fakeStorage(), { sleep: noSleep });
    await cache.ensureDays(['2026-08-01']);

    expect(client.fetchDay).toHaveBeenCalledTimes(2);
    expect(cache.getDayMap().has('2026-08-01')).toBe(true);
    expect(cache.getMissing().size).toBe(0);
  });

  it('gives up after the configured attempts and marks the day missing', async () => {
    const client = { fetchDay: vi.fn(async () => { throw new Error('429'); }) };
    const cache = createDayCache(client, fakeStorage(), { attempts: 3, sleep: noSleep });
    await cache.ensureDays(['2026-08-01']);

    expect(client.fetchDay).toHaveBeenCalledTimes(3);
    expect(cache.getMissing()).toEqual(new Set(['2026-08-01']));
    // Still absent rather than zero, even after exhausting retries.
    expect(cache.getDayMap().has('2026-08-01')).toBe(false);
  });

  it('backs off for longer between each attempt', async () => {
    const delays = [];
    const client = { fetchDay: vi.fn(async () => { throw new Error('429'); }) };
    const cache = createDayCache(client, fakeStorage(), {
      attempts: 3,
      sleep: (ms) => { delays.push(ms); return Promise.resolve(); },
    });
    await cache.ensureDays(['2026-08-01']);

    expect(delays).toHaveLength(2);          // one sleep between each pair of attempts
    expect(delays[1]).toBeGreaterThan(delays[0]);
  });

  it('does not retry a day that succeeded first time', async () => {
    const client = { fetchDay: vi.fn(async () => [row('Albert Cai')]) };
    const cache = createDayCache(client, fakeStorage(), { sleep: noSleep });
    await cache.ensureDays(['2026-08-01']);
    expect(client.fetchDay).toHaveBeenCalledTimes(1);
  });

  it('never runs more requests at once than the concurrency limit', async () => {
    let inFlight = 0;
    let peak = 0;
    const client = {
      fetchDay: vi.fn(async () => {
        inFlight++;
        peak = Math.max(peak, inFlight);
        await Promise.resolve();
        inFlight--;
        return [row('Albert Cai')];
      }),
    };
    const cache = createDayCache(client, fakeStorage(), { concurrency: 3, sleep: noSleep });
    await cache.ensureDays(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']);
    expect(peak).toBeLessThanOrEqual(3);
  });
});
