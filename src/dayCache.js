// Day-keyed cache. Every board window is the union of its days, so holding days
// rather than dated tickets is what makes narrower windows free.

// v2: the payload gained a refresh timestamp, so v1 blobs are ignored rather
// than misread as untimestamped current data.
const STORAGE_KEY = 'wocoo-analytics/days/v2';

// The 276-days-lost incident was throttling, and retry with backoff below is the
// actual remedy. Concurrency was also cut 6 -> 3 at the time, which fixed nothing
// extra and doubled a 365-day refresh. Raised again to 12: retries absorb the
// throttling this risks, and request latency — not Jira's limit — is the bottleneck.
const DEFAULT_CONCURRENCY = 12;
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
  let updatedAt = null;

  restore();

  function restore() {
    try {
      const raw = storage?.getItem(STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      updatedAt = parsed.updatedAt ?? null;
      for (const [date, rows] of Object.entries(parsed.days || {})) {
        dayMap.set(date, rows);
      }
    } catch {
      // Corrupt or unreadable — start empty rather than taking the page down.
    }
  }

  function persist() {
    try {
      storage?.setItem(STORAGE_KEY, JSON.stringify({
        updatedAt,
        days: Object.fromEntries(dayMap),
      }));
    } catch {
      // Quota exceeded, or storage unavailable. In-memory only from here.
    }
  }

  /** `force` refetches days already held, overwriting each as it arrives. Refresh uses
   *  it instead of clearing first: a cleared cache would render the board as zeros for
   *  the whole refresh, and zeros look like a real answer. */
  async function ensureDays(dates, onProgress, { force = false, signal } = {}) {
    const todo = force ? [...dates] : dates.filter((d) => !dayMap.has(d));
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

    // Newest first: the board and chart both show recent days, so this makes the
    // numbers people care about appear within seconds instead of last.
    const queue = [...todo].sort().reverse();
    async function worker() {
      while (queue.length) {
        // Checked before each fetch, not just at the start: a year-long load has to
        // stop promptly when the view moves on, or it keeps saturating the connection
        // and reporting progress for a window nobody is looking at any more.
        if (signal?.aborted) return;
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
    updatedAt = new Date().toISOString();
    persist();
  }

  return {
    ensureDays,
    getUpdatedAt: () => updatedAt,
    getDayMap: () => dayMap,
    getMissing: () => new Set(missing),
    size: () => dayMap.size,
  };
}
