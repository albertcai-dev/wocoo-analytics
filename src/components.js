const PERIODS = [
  { id: 'day', label: 'Day', days: 1 },
  { id: 'week', label: '7 days', days: 7 },
  { id: 'month', label: '30 days', days: 30 },
  { id: 'year', label: 'Year', days: 365 },
];

const INITIAL_DAYS = 30;

/** Today in the viewer's timezone, as YYYY-MM-DD. Matches how Jira reads bare
 *  date bounds, so the client and the query agree on what "today" means. */
function todayISO() {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function PeriodTabs({ value, onChange, disabled }) {
  return (
    <div style={{ display: 'flex', gap: 4, marginBottom: 16 }}>
      {PERIODS.map((p) => (
        <button
          key={p.id}
          onClick={() => onChange(p.id)}
          disabled={disabled}
          style={{
            padding: '6px 14px',
            border: `1px solid ${value === p.id ? 'var(--fg-strong)' : 'var(--outline)'}`,
            background: value === p.id ? 'var(--fg-strong)' : 'var(--bg-default)',
            color: value === p.id ? 'var(--bg-default)' : 'var(--fg-soft)',
            borderRadius: 6,
            cursor: disabled ? 'wait' : 'pointer',
            font: 'inherit',
            fontWeight: value === p.id ? 600 : 400,
          }}
        >
          {p.label}
        </button>
      ))}
    </div>
  );
}

function SummaryTiles({ totals, incomplete }) {
  const tile = (label, value, muted) => (
    <div style={{
      flex: 1, padding: '12px 16px', background: 'var(--bg-default)',
      border: '1px solid var(--outline)', borderRadius: 8,
    }}>
      <div style={{ fontSize: 12, color: 'var(--fg-soft)' }}>{label}</div>
      <div style={{ fontSize: 26, fontWeight: 700, color: muted ? 'var(--fg-soft)' : 'var(--fg-strong)' }}>
        {value}{incomplete ? '+' : ''}
      </div>
    </div>
  );
  return (
    <div style={{ display: 'flex', gap: 12, marginBottom: 16 }}>
      {tile('Completed', totals.done, false)}
      {tile('Cancelled / No Action', totals.cancelled, true)}
    </div>
  );
}

function LoadState({ progress, missing, onRetry }) {
  if (progress && progress.total > 0 && progress.loaded < progress.total) {
    return (
      <div style={{ padding: '8px 12px', marginBottom: 12, background: 'var(--bg-soft)', borderRadius: 6, fontSize: 13 }}>
        Loading {progress.loaded} of {progress.total} days…
      </div>
    );
  }
  if (missing.size > 0) {
    return (
      <div style={{
        padding: '8px 12px', marginBottom: 12, borderRadius: 6, fontSize: 13,
        background: '#FDECEC', border: '1px solid #E9A7A7',
      }}>
        {missing.size} {missing.size === 1 ? 'day' : 'days'} failed to load — counts below are
        incomplete and ranking is hidden.{' '}
        <button onClick={onRetry} style={{ font: 'inherit', textDecoration: 'underline', border: 0, background: 'none', cursor: 'pointer' }}>
          Retry
        </button>
      </div>
    );
  }
  return null;
}

function App() {
  const [period, setPeriod] = useState('month');
  const [chartDays, setChartDays] = useState(30);
  const [progress, setProgress] = useState(null);
  // The cache mutates a Map in place, which React can't observe. Bumping this
  // counter after each load is what triggers the re-read. It is deliberately NOT
  // used as a `key` — that would remount the subtree and wipe the chart's
  // legend-toggle state every time a load finished.
  const [, setRevision] = useState(0);
  const [error, setError] = useState(null);
  const [expanded, setExpanded] = useState(() => new Set());

  const today = useMemo(() => todayISO(), []);
  const cache = useMemo(() => {
    if (!window.MagicTools) return null;
    return createDayCache(createJiraClient(window.MagicTools));
  }, []);

  const load = useCallback(async (days) => {
    if (!cache) return;
    setError(null);
    try {
      await cache.ensureDays(lastNDates(days, today), setProgress);
    } catch (e) {
      setError(e?.message || String(e));
    }
    setRevision((n) => n + 1);
  }, [cache, today]);

  const periodDays = PERIODS.find((p) => p.id === period).days;

  // One effect covers the initial load too: on mount, periodDays is 30 and
  // chartDays is 30, so this requests exactly INITIAL_DAYS.
  useEffect(() => {
    load(Math.max(periodDays, chartDays, INITIAL_DAYS));
  }, [periodDays, chartDays, load]);

  if (!window.MagicTools) {
    return (
      <div style={{ padding: 24, maxWidth: 560 }}>
        <h1 style={{ fontSize: 20 }}>Can't reach Jira</h1>
        <p style={{ color: 'var(--fg-soft)' }}>
          The MCPLocker browser extension isn't available, so this page can't query Jira as you.
          Check your VPN, then connect at{' '}
          <a href="https://mcplocker.w10external.com">mcplocker.w10external.com</a>.
        </p>
      </div>
    );
  }

  const dayMap = cache.getDayMap();
  const missing = cache.getMissing();
  const dates = lastNDates(periodDays, today);
  const rows = rowsForDates(dayMap, dates);
  const totals = totalsFor(rows);
  const incomplete = dates.some((d) => missing.has(d));
  const loading = !!progress && progress.total > 0 && progress.loaded < progress.total;

  return (
    <div style={{ padding: 24, maxWidth: 1000, margin: '0 auto' }}>
      <h1 style={{ fontSize: 22, marginBottom: 4 }}>WOCOO Analytics</h1>
      <p style={{ color: 'var(--fg-soft)', fontSize: 13, marginTop: 0 }}>
        Tickets completed by calendar day, excluding automated eligibility confirmations.
      </p>

      {error && (
        <div style={{ padding: '8px 12px', marginBottom: 12, background: '#FDECEC', borderRadius: 6, fontSize: 13 }}>
          {error}
        </div>
      )}

      <PeriodTabs value={period} onChange={setPeriod} disabled={loading} />
      <LoadState
        progress={progress}
        missing={missing}
        onRetry={() => load(Math.max(periodDays, chartDays))}
      />
      <SummaryTiles totals={totals} incomplete={incomplete} />

      <Leaderboard rows={rows} expanded={expanded} onToggle={setExpanded} suppressRank={incomplete} />
      <TrendChart dayMap={dayMap} today={today} days={chartDays} onDaysChange={setChartDays} />

      <p style={{ color: 'var(--fg-inactive)', fontSize: 11, marginTop: 24 }}>
        A ticket reopened and closed again counts on its most recent close date, so historical
        days can change.
      </p>
    </div>
  );
}
