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

const CATEGORICAL = ['var(--cat-01)', 'var(--cat-02)', 'var(--cat-03)',
                     'var(--cat-04)', 'var(--cat-05)', 'var(--cat-06)'];

/** Stable colour per row key, shared by the chart and the leaderboard.
 *  Roster order fixes the first five; Other takes the sixth; Unassigned falls to
 *  grey because the categorical set only has six entries. */
function colourFor(key) {
  if (key === 'Unassigned') return 'var(--cat-unassigned)';
  const index = key === 'Other' ? 5 : ROSTER.indexOf(key);
  return index >= 0 ? CATEGORICAL[index % CATEGORICAL.length] : 'var(--cat-unassigned)';
}

function WorkTypeBreakdown({ rows, assigneeKey: key }) {
  const breakdown = byWorkType(rows, key);
  if (breakdown.length === 0) {
    return <div style={{ padding: '8px 0 8px 28px', color: 'var(--fg-soft)', fontSize: 13 }}>No tickets.</div>;
  }
  const max = Math.max(...breakdown.map((b) => b.done), 1);
  return (
    <div style={{ padding: '4px 0 10px 28px', background: 'var(--bg-soft)' }}>
      {breakdown.map((b) => (
        <div key={b.workType} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '3px 12px 3px 0', fontSize: 13 }}>
          <span style={{ flex: 2 }}>{b.workType}</span>
          <span style={{ flex: 3, height: 6, background: 'var(--outline)', borderRadius: 3 }}>
            <span style={{ display: 'block', width: `${(b.done / max) * 100}%`, height: '100%', background: colourFor(key || 'Other'), borderRadius: 3 }} />
          </span>
          <span style={{ width: 40, textAlign: 'right', fontWeight: 600 }}>{b.done}</span>
          <span style={{ width: 40, textAlign: 'right', color: 'var(--fg-soft)' }}>{b.cancelled || ''}</span>
        </div>
      ))}
    </div>
  );
}

function Leaderboard({ rows, expanded, onToggle, suppressRank }) {
  const perAssignee = byAssignee(rows);
  const totals = totalsFor(rows);

  const toggle = (key) => {
    const next = new Set(expanded);
    if (next.has(key)) next.delete(key); else next.add(key);
    onToggle(next);
  };

  const headerCell = { padding: '6px 12px 6px 0', fontSize: 12, color: 'var(--fg-soft)', fontWeight: 600 };

  return (
    <div style={{ background: 'var(--bg-default)', border: '1px solid var(--outline)', borderRadius: 8, overflow: 'hidden', marginBottom: 20 }}>
      <div style={{ display: 'flex', padding: '0 12px', borderBottom: '1px solid var(--outline)' }}>
        <span style={{ ...headerCell, flex: 1 }}>{suppressRank ? 'Assignee' : 'Assignee (ranked)'}</span>
        <span style={{ ...headerCell, width: 70, textAlign: 'right' }}>Done</span>
        <span style={{ ...headerCell, width: 90, textAlign: 'right' }}>Cancelled</span>
      </div>

      {perAssignee.map((entry) => (
        <div key={entry.key}>
          <div
            onClick={() => toggle(entry.key)}
            style={{ display: 'flex', alignItems: 'center', padding: '8px 12px', cursor: 'pointer', borderBottom: '1px solid var(--outline)' }}
          >
            <span style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ width: 9, height: 9, borderRadius: 2, background: colourFor(entry.key), flexShrink: 0 }} />
              <span style={{ color: 'var(--fg-inactive)', width: 12 }}>{expanded.has(entry.key) ? '▾' : '▸'}</span>
              {entry.key}
            </span>
            <span style={{ width: 70, textAlign: 'right', fontWeight: 600 }}>{entry.done}</span>
            <span style={{ width: 90, textAlign: 'right', color: 'var(--fg-soft)' }}>{entry.cancelled}</span>
          </div>
          {expanded.has(entry.key) && <WorkTypeBreakdown rows={rows} assigneeKey={entry.key} />}
        </div>
      ))}

      <div>
        <div
          onClick={() => toggle('__total__')}
          style={{ display: 'flex', alignItems: 'center', padding: '8px 12px', cursor: 'pointer', fontWeight: 700, background: 'var(--bg-soft)' }}
        >
          <span style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ width: 9, flexShrink: 0 }} />
            <span style={{ color: 'var(--fg-inactive)', width: 12 }}>{expanded.has('__total__') ? '▾' : '▸'}</span>
            Total
          </span>
          <span style={{ width: 70, textAlign: 'right' }}>{totals.done}</span>
          <span style={{ width: 90, textAlign: 'right' }}>{totals.cancelled}</span>
        </div>
        {expanded.has('__total__') && <WorkTypeBreakdown rows={rows} assigneeKey={null} />}
      </div>
    </div>
  );
}
