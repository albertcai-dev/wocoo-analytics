const PERIODS = [
  { id: 'day', label: 'Day', days: 1 },
  { id: 'week', label: '7 days', days: 7 },
  { id: 'month', label: '30 days', days: 30 },
  { id: 'year', label: 'Year', days: 365 },
];

// A cold cache loads 90 days, which covers Day / 7 days / 30 days and the 30d and
// 90d chart windows — every view except Year and the 365d chart. Those two fetch
// the remaining tail on demand, once, and it stays cached afterwards. Loading the
// full year up front made every first visit wait on data most of it never showed.
const COLD_START_DAYS = 90;

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

function LoadState({ progress, missing, affectsCounts, onRetry }) {
  if (progress && progress.total > 0 && progress.loaded < progress.total) {
    return (
      <div style={{ padding: '8px 12px', marginBottom: 12, background: 'var(--bg-soft)', borderRadius: 6, fontSize: 13 }}>
        Loading {progress.loaded} of {progress.total} days…
      </div>
    );
  }
  // `missing` is already scoped by the caller to the days on screen. Warning about
  // a failed day that isn't in any visible window trains people to ignore the
  // banner — and then they ignore it when the numbers really are wrong.
  if (missing.size > 0) {
    const dates = [...missing].sort();
    const shown = dates.slice(0, 3).join(', ');
    const rest = dates.length - 3;
    return (
      <div style={{
        padding: '8px 12px', marginBottom: 12, borderRadius: 6, fontSize: 13,
        background: '#FDECEC', border: '1px solid #E9A7A7',
      }}>
        {dates.length} {dates.length === 1 ? 'day' : 'days'} failed to load
        {' '}({shown}{rest > 0 ? ` and ${rest} more` : ''}) — figures for those days are
        missing{affectsCounts
          ? ', so the counts below are incomplete and ranking is hidden'
          : ' from the chart; the counts below are unaffected'}.{' '}
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
    // localStorage, not session: the data is now explicitly user-refreshed and the
    // header states its age, so surviving a reload is the point rather than a risk.
    return createDayCache(createJiraClient(window.MagicTools), globalThis.localStorage);
  }, []);

  const periodDays = PERIODS.find((p) => p.id === period).days;
  // The widest window currently on screen, never below the cold-start floor.
  const requiredDays = Math.max(COLD_START_DAYS, periodDays, chartDays);

  // Only one load may be in flight. Starting a new one aborts the old, otherwise a
  // 365-day fetch keeps running after the view moves on — saturating the connection
  // and reporting "of 365" over a window that needs 7.
  const inFlight = useRef(null);

  const fillDates = useCallback(async (dates, force) => {
    if (!cache || dates.length === 0) return;
    if (inFlight.current) inFlight.current.aborted = true;
    const signal = { aborted: false };
    inFlight.current = signal;

    setError(null);
    try {
      await cache.ensureDays(dates, (p) => { if (!signal.aborted) setProgress(p); }, { force, signal });
    } catch (e) {
      if (!signal.aborted) setError(e?.message || String(e));
    }
    // A superseded load must not clear the newer one's progress or claim to be done.
    if (inFlight.current === signal) {
      inFlight.current = null;
      setProgress(null);
    }
    setRevision((n) => n + 1);
  }, [cache]);

  const fill = useCallback(
    (days, force) => fillDates(lastNDates(days, today), force),
    [fillDates, today],
  );

  /** Just the days that failed. Retry used to call refresh, which force-refetched the
   *  entire held range — 365 requests to recover two days. Failed days are absent from
   *  the cache, so an unforced fill picks up exactly them. */
  const retryMissing = useCallback(
    () => fillDates([...(cache?.getMissing() ?? [])].sort().reverse(), false),
    [cache, fillDates],
  );

  // Fills gaps only. Runs on a cold cache, and again when Year or the 365d chart
  // widens what's needed — that one is the deliberate on-demand wait. Returning to a
  // narrower view costs nothing, and the tail stays cached.
  useEffect(() => { fill(requiredDays, false); }, [requiredDays, fill]);

  /** Renew everything currently held, not just what's on screen — otherwise a refresh
   *  from the 30-day tab would leave a stale year sitting behind one timestamp. */
  const refresh = useCallback(() => {
    const held = [...(cache?.getDayMap().keys() ?? [])].sort();
    const heldSpan = held.length ? daysBetween(held[0], today) : 0;
    return fill(Math.max(requiredDays, heldSpan), true);
  }, [cache, fill, requiredDays, today]);

  const updatedAt = cache?.getUpdatedAt();

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
  // The banner covers everything on screen: the board's window plus the chart's,
  // which can be wider. Days that failed outside both are real but not currently
  // visible, so warning about them here would be a false alarm.
  const onScreen = new Set([...dates, ...lastNDates(chartDays, today)]);
  const visibleMissing = new Set([...missing].filter((d) => onScreen.has(d)));
  const loading = !!progress && progress.total > 0 && progress.loaded < progress.total;

  return (
    <div style={{ padding: 24, maxWidth: 1000, margin: '0 auto' }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16 }}>
        <div>
          <h1 style={{ fontSize: 22, marginBottom: 4 }}>WOCOO Analytics</h1>
          <p style={{ color: 'var(--fg-soft)', fontSize: 13, marginTop: 0 }}>
            Tickets completed by calendar day, excluding automated eligibility confirmations.
            {updatedAt && ` Updated ${new Date(updatedAt).toLocaleString('en-CA', {
              month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
            })}.`}
          </p>
        </div>
        <button
          onClick={refresh}
          disabled={loading}
          style={{
            padding: '8px 16px', borderRadius: 6, font: 'inherit', fontSize: 13, fontWeight: 600,
            whiteSpace: 'nowrap', flexShrink: 0,
            border: '1px solid var(--outline)',
            background: loading ? 'var(--bg-soft)' : 'var(--fg-strong)',
            color: loading ? 'var(--fg-soft)' : 'var(--bg-default)',
            cursor: loading ? 'not-allowed' : 'pointer',
          }}
        >
          {loading ? 'Refreshing…' : 'Refresh'}
        </button>
      </div>

      {error && (
        <div style={{ padding: '8px 12px', marginBottom: 12, background: '#FDECEC', borderRadius: 6, fontSize: 13 }}>
          {error}
        </div>
      )}

      {/* Never disabled: tabs only re-slice cached days, so they stay usable
          while a refresh is in flight. */}
      <PeriodTabs value={period} onChange={setPeriod} disabled={false} />
      <LoadState
        progress={progress}
        missing={visibleMissing}
        affectsCounts={incomplete}
        onRetry={retryMissing}
      />
      <SummaryTiles totals={totals} incomplete={incomplete} />

      <Leaderboard rows={rows} expanded={expanded} onToggle={setExpanded} suppressRank={incomplete} />
      <TrendChart dayMap={dayMap} today={today} days={chartDays} onDaysChange={setChartDays} />
      <WeekdayPattern dayMap={dayMap} today={today} days={chartDays} />

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

/** Cancelled share as a percentage, or an em dash when nothing was handled — a 0%
 *  on an empty row would read as a real result. */
function formatRate(counts) {
  const rate = cancelledRate(counts);
  return rate === null ? '—' : `${Math.round(rate * 100)}%`;
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
            <span style={{ display: 'block', width: `${(b.done / max) * 100}%`, height: '100%', background: key ? colourFor(key) : 'var(--fg-soft)', borderRadius: 3 }} />
          </span>
          <span style={{ width: 40, textAlign: 'right', fontWeight: 600 }}>{b.done}</span>
          <span style={{ width: 40, textAlign: 'right', color: 'var(--fg-soft)' }}>{b.cancelled || ''}</span>
        </div>
      ))}
    </div>
  );
}

function Leaderboard({ rows, expanded, onToggle, suppressRank }) {
  // Only roster members get rows, but Total counts everything, so the rows
  // deliberately do not sum to it. The footnote below carries the difference —
  // without it the table would silently disagree with its own total.
  const { rostered: perAssignee, excluded } = partitionRoster(byAssignee(rows));
  const totals = totalsFor(rows);
  const hasExcluded = excluded.other.done + excluded.other.cancelled
    + excluded.unassigned.done + excluded.unassigned.cancelled > 0;

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
        <span style={{ ...headerCell, width: 64, textAlign: 'right' }}>Cancel&nbsp;%</span>
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
            <span style={{ width: 64, textAlign: 'right', color: 'var(--fg-soft)' }}>{formatRate(entry)}</span>
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
          <span style={{ width: 64, textAlign: 'right' }}>{formatRate(totals)}</span>
        </div>
        {expanded.has('__total__') && <WorkTypeBreakdown rows={rows} assigneeKey={null} />}
      </div>

      {hasExcluded && (
        <div style={{
          padding: '6px 12px', fontSize: 11, color: 'var(--fg-inactive)',
          borderTop: '1px solid var(--outline)',
        }}>
          Total includes {excluded.other.done} completed by people outside the team
          {excluded.unassigned.done > 0 && ` and ${excluded.unassigned.done} unassigned`}
          , not listed above.
        </div>
      )}
    </div>
  );
}

/**
 * Mean completed per weekday over the chart's window.
 *
 * Mean rather than total: a window holds four of some weekdays and five of others, so
 * totals would rank weekdays by how often they appeared. Days that never loaded are
 * excluded rather than counted as zero, and the sample size is shown per bar so a
 * weekday backed by two days is not read with the same confidence as one backed by 50.
 */
function WeekdayPattern({ dayMap, today, days }) {
  const buckets = byWeekday(dayMap, lastNDates(days, today));
  const max = Math.max(1, ...buckets.map((b) => b.mean ?? 0));

  return (
    <div style={{
      background: 'var(--bg-default)', border: '1px solid var(--outline)',
      borderRadius: 8, padding: 16, marginTop: 20,
    }}>
      <strong style={{ fontSize: 14 }}>Average completed by weekday</strong>
      <div style={{ color: 'var(--fg-soft)', fontSize: 12, marginTop: 2, marginBottom: 12 }}>
        Mean per day over the last {days} days, so weekdays are comparable regardless of
        how many of each the window happens to contain.
      </div>
      {/* No fixed height: the tallest column is bar + value label + two labels, which
          overflowed a capped row and collided with the subtitle above. Bars keep their
          computed pixel heights, so the proportions are unchanged. */}
      <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', paddingTop: 4 }}>
        {buckets.map((b) => (
          <div key={b.label} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
            <span style={{ fontSize: 12, fontWeight: 600 }}>
              {b.mean === null ? '—' : b.mean.toFixed(1)}
            </span>
            <div
              title={`${b.label}: ${b.total} completed across ${b.days} ${b.days === 1 ? 'day' : 'days'}`}
              style={{
                width: '100%',
                height: `${((b.mean ?? 0) / max) * 78}px`,
                minHeight: b.mean === null ? 0 : 2,
                background: 'var(--cat-01)',
                borderRadius: '3px 3px 0 0',
              }}
            />
            <span style={{ fontSize: 11, color: 'var(--fg-soft)' }}>{b.label}</span>
            <span style={{ fontSize: 10, color: 'var(--fg-inactive)' }}>
              {b.days === 0 ? 'no data' : `n=${b.days}`}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

const CHART_WINDOWS = [30, 90, 365];

/** Inline SVG line chart.
 *
 *  Mark specs follow the dataviz skill: 2px lines, recessive grid and axes, text
 *  in ink tokens rather than series colour, a legend always present (7 series is
 *  past the 4-series direct-label threshold), and a crosshair + tooltip, which
 *  the skill ships by default on line charts.
 *
 *  A null value breaks the line rather than dropping to zero, so a day that
 *  failed to fetch reads as a gap. */
function TrendChart({ dayMap, today, days, onDaysChange }) {
  const [hidden, setHidden] = useState(() => new Set());
  const [hoverIndex, setHoverIndex] = useState(null);

  const dates = lastNDates(days, today);
  const { series, total } = dailySeries(dayMap, dates);

  const W = 940, H = 220, PAD_L = 38, PAD_R = 10, PAD_B = 22, PAD_T = 10;
  const maxY = Math.max(1, ...total.filter((v) => v !== null));
  const step = (W - PAD_L - PAD_R) / Math.max(1, dates.length - 1);
  const x = (i) => PAD_L + i * step;
  const y = (v) => PAD_T + (H - PAD_T - PAD_B) * (1 - v / maxY);

  // Days that never loaded are drawn as 0 so every line stays continuous, but the
  // columns are shaded below — a 0 meaning "not fetched" must stay distinguishable
  // from a 0 meaning "nobody closed anything", which is a real and common value.
  // One path of vertical segments, rather than an element per day.
  const bandWidth = Math.max(3, step);
  const noDataPath = dates
    .map((_, i) => (total[i] === null ? `M${x(i)},${PAD_T} L${x(i)},${y(0)}` : ''))
    .filter(Boolean)
    .join(' ');

  /** One continuous line. Null days plot at 0 rather than breaking the path. */
  const pathFor = (values) => {
    const points = values.map((v, i) => `${x(i)},${y(v ?? 0)}`);
    return points.length === 1 ? `M${points[0]} L${points[0]}` : `M${points.join(' L')}`;
  };

  const toggle = (key) => {
    const next = new Set(hidden);
    if (next.has(key)) next.delete(key); else next.add(key);
    setHidden(next);
  };

  const onMove = (event) => {
    const box = event.currentTarget.getBoundingClientRect();
    const px = ((event.clientX - box.left) / box.width) * W;
    const step = (W - PAD_L - PAD_R) / Math.max(1, dates.length - 1);
    const i = Math.round((px - PAD_L) / step);
    setHoverIndex(i >= 0 && i < dates.length ? i : null);
  };

  // Roster only, matching the leaderboard. The Total line still covers everyone,
  // so it can sit above the sum of the visible series — same reconciliation gap
  // the table's footnote explains.
  const rosterSeries = series.filter((s) => ROSTER.includes(s.key));
  const visible = rosterSeries.filter((s) => !hidden.has(s.key));
  const legend = [
    { key: '__total__', label: 'Total (everyone)', colour: 'var(--fg-strong)' },
    ...rosterSeries.map((s) => ({ key: s.key, label: s.key, colour: colourFor(s.key) })),
  ];

  return (
    <div style={{ background: 'var(--bg-default)', border: '1px solid var(--outline)', borderRadius: 8, padding: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <strong style={{ fontSize: 14 }}>Completed per day</strong>
        <div style={{ display: 'flex', gap: 4 }}>
          {CHART_WINDOWS.map((w) => (
            <button
              key={w}
              onClick={() => onDaysChange(w)}
              style={{
                padding: '3px 10px', fontSize: 12, borderRadius: 5, cursor: 'pointer', font: 'inherit',
                border: `1px solid ${days === w ? 'var(--fg-strong)' : 'var(--outline)'}`,
                background: days === w ? 'var(--fg-strong)' : 'var(--bg-default)',
                color: days === w ? 'var(--bg-default)' : 'var(--fg-soft)',
              }}
            >
              {w}d
            </button>
          ))}
        </div>
      </div>

      <div style={{ position: 'relative' }}>
        <svg
          viewBox={`0 0 ${W} ${H}`}
          style={{ width: '100%', height: 'auto', display: 'block' }}
          onMouseMove={onMove}
          onMouseLeave={() => setHoverIndex(null)}
        >
          {/* Recessive grid: baseline, midline, ceiling. */}
          {[0, maxY / 2, maxY].map((v) => (
            <line
              key={v}
              x1={PAD_L} y1={y(v)} x2={W - PAD_R} y2={y(v)}
              stroke="var(--outline)"
              strokeDasharray={v === 0 ? undefined : '2 4'}
            />
          ))}
          {[0, maxY].map((v) => (
            <text key={v} x={4} y={y(v) + 4} fontSize="10" fill="var(--fg-inactive)">
              {Math.round(v)}
            </text>
          ))}

          {/* Shade the columns we never loaded, so their zeros read as absence of data
              rather than absence of work. */}
          <path d={noDataPath} stroke="var(--fg-inactive)" strokeWidth={bandWidth} opacity="0.12" />

          {hoverIndex !== null && (
            <line
              x1={x(hoverIndex)} y1={PAD_T} x2={x(hoverIndex)} y2={y(0)}
              stroke="var(--fg-inactive)" strokeWidth="1"
            />
          )}

          {!hidden.has('__total__') && (
            <path d={pathFor(total)} fill="none" stroke="var(--fg-strong)" strokeWidth="2"
                  strokeLinejoin="round" strokeLinecap="round" />
          )}
          {visible.map((s) => (
            <path key={s.key} d={pathFor(s.values)} fill="none" stroke={colourFor(s.key)}
                  strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
          ))}

          <text x={PAD_L} y={H - 6} fontSize="10" fill="var(--fg-inactive)">{dates[0]}</text>
          <text x={W - PAD_R} y={H - 6} fontSize="10" fill="var(--fg-inactive)" textAnchor="end">
            {dates[dates.length - 1]}
          </text>
        </svg>

        {hoverIndex !== null && (
          <div style={{
            position: 'absolute', top: 0,
            left: `${(x(hoverIndex) / W) * 100}%`,
            transform: hoverIndex > dates.length / 2 ? 'translateX(-100%)' : 'none',
            marginLeft: hoverIndex > dates.length / 2 ? -8 : 8,
            background: 'var(--bg-default)', border: '1px solid var(--outline)',
            borderRadius: 6, padding: '6px 10px', fontSize: 12, pointerEvents: 'none',
            boxShadow: '0 2px 8px rgba(0,0,0,0.08)', whiteSpace: 'nowrap', zIndex: 1,
          }}>
            <div style={{ fontWeight: 600, marginBottom: 3 }}>{dates[hoverIndex]}</div>
            {total[hoverIndex] === null ? (
              <div style={{ color: 'var(--fg-soft)' }}>not loaded</div>
            ) : (
              <React.Fragment>
                {!hidden.has('__total__') && (
                  <div style={{ display: 'flex', gap: 8, justifyContent: 'space-between' }}>
                    <span>Total</span><strong>{total[hoverIndex]}</strong>
                  </div>
                )}
                {visible.map((s) => (
                  <div key={s.key} style={{ display: 'flex', gap: 10, justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                      <span style={{ width: 8, height: 8, borderRadius: 2, background: colourFor(s.key) }} />
                      {s.key}
                    </span>
                    <span>{s.values[hoverIndex]}</span>
                  </div>
                ))}
              </React.Fragment>
            )}
          </div>
        )}
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginTop: 8 }}>
        {legend.map((item) => (
          <button
            key={item.key}
            onClick={() => toggle(item.key)}
            style={{
              display: 'flex', alignItems: 'center', gap: 6, border: 0, background: 'none',
              cursor: 'pointer', font: 'inherit', fontSize: 12, padding: 0,
              color: 'var(--fg-soft)',
              opacity: hidden.has(item.key) ? 0.35 : 1,
            }}
          >
            <span style={{ width: 14, height: 3, background: item.colour, borderRadius: 2 }} />
            {item.label}
          </button>
        ))}
      </div>
    </div>
  );
}
