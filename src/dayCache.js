// Day-keyed cache. Every board window is the union of its days, so holding days
// rather than dated tickets is what makes narrower windows free.

const STORAGE_KEY = 'wocoo-analytics/days/v1';
const CONCURRENCY = 6;   // polite to Jira; the year window is 365 days

export function createDayCache(client, storage = globalThis.sessionStorage) {
  const dayMap = new Map();
  const missing = new Set();

  restore();

  function restore() {
    try {
      const raw = storage?.getItem(STORAGE_KEY);
      if (!raw) return;
      for (const [date, rows] of Object.entries(JSON.parse(raw))) {
        dayMap.set(date, rows);
      }
    } catch {
      // Corrupt or unreadable — start empty rather than taking the page down.
    }
  }

  function persist() {
    try {
      storage?.setItem(STORAGE_KEY, JSON.stringify(Object.fromEntries(dayMap)));
    } catch {
      // Quota exceeded, or storage unavailable. In-memory only from here.
    }
  }

  async function ensureDays(dates, onProgress) {
    const todo = dates.filter((d) => !dayMap.has(d));
    const total = todo.length;
    let loaded = 0;

    if (total === 0) {
      onProgress?.({ loaded: 0, total: 0 });
      return;
    }

    const queue = [...todo];
    async function worker() {
      while (queue.length) {
        const date = queue.shift();
        try {
          dayMap.set(date, await client.fetchDay(date));
          missing.delete(date);
        } catch {
          // Leave the day ABSENT, not empty. An empty array aggregates to 0 and
          // renders as a genuine quiet day, which is the failure this design
          // most wants to avoid.
          missing.add(date);
        }
        loaded++;
        onProgress?.({ loaded, total });
      }
    }

    await Promise.all(
      Array.from({ length: Math.min(CONCURRENCY, total) }, worker),
    );
    persist();
  }

  return {
    ensureDays,
    getDayMap: () => dayMap,
    getMissing: () => new Set(missing),
    size: () => dayMap.size,
  };
}
