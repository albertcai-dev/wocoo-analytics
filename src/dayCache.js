// Day-keyed cache. Every board window is the union of its days, so holding days
// rather than dated tickets is what makes narrower windows free.

const STORAGE_KEY = 'wocoo-analytics/days/v1';

// Lowered from 6 after the Year tab lost 276 of 365 days to what was almost
// certainly throttling: 365 requests went out six-at-a-time with no retry, and a
// throttled response was indistinguishable from a real failure.
const DEFAULT_CONCURRENCY = 3;
const DEFAULT_ATTEMPTS = 3;
const BASE_BACKOFF_MS = 400;

const defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export function createDayCache(client, storage = globalThis.sessionStorage, options = {}) {
  const {
    concurrency = DEFAULT_CONCURRENCY,
    attempts = DEFAULT_ATTEMPTS,
    sleep = defaultSleep,
  } = options;
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

    /** Exponential backoff with jitter. Jitter matters because all workers hit the
     *  same throttle at once; without it they'd retry in lockstep and collide again. */
    async function fetchWithRetry(date) {
      for (let attempt = 1; ; attempt++) {
        try {
          return await client.fetchDay(date);
        } catch (err) {
          if (attempt >= attempts) throw err;
          const backoff = BASE_BACKOFF_MS * 2 ** (attempt - 1);
          await sleep(backoff + Math.random() * BASE_BACKOFF_MS);
        }
      }
    }

    const queue = [...todo];
    async function worker() {
      while (queue.length) {
        const date = queue.shift();
        try {
          dayMap.set(date, await fetchWithRetry(date));
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
      Array.from({ length: Math.min(concurrency, total) }, worker),
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
