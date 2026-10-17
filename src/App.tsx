import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { arrangeRows, sortByMatch } from './arrange';
import type { CompanyBills, CompanySummary, JevStatus, Row } from './types';
import { useSemanticEval } from './useSemanticEval';

const DEFAULT_COMPANY = 'company-018';
const REVIEW_KEY = 'tr.reviewed.v1';
const PREFS_KEY = 'tr.prefs.v1';

// Example prompts, grouped. The dropdown picks which group the chips show.
const PROMPT_SETS: Record<string, { label: string; prompts: string[] }> = {
  plain: {
    label: 'Everyday language',
    prompts: [
      'Anything electronic or tech-related',
      'Anything you could wear',
      'Bills for electricity, water, or other utilities',
      'Bills where the memo mentions a delay or something not arriving yet',
    ],
  },
  text: {
    label: 'Description and memo quality',
    prompts: [
      'Descriptions that are blank or just a placeholder',
      "Descriptions that don't say what was bought",
      'Memos that contradict the description',
    ],
  },
  overhead: {
    label: 'Goods vs overhead memos',
    prompts: [
      'Find bills for physical goods where the memo instead describes a standing overhead charge or monthly service charge.',
      'Find utility bills whose memo talks about a partial backorder or remaining goods to be delivered.',
      'Find premises, utility, interest, or income-tax bills whose memo sounds like receiving a shipment or recording a backorder.',
      'Find bills where the description says services are charged in proportion to trading but never identifies what service was supplied.',
    ],
  },
};
const ROW_LIMITS = [50, 100, 0]; // 0 = all bills
function loadPrefs(): { set: string; limit: number } {
  try {
    const p = JSON.parse(localStorage.getItem(PREFS_KEY) ?? '{}');
    return { set: p.set in PROMPT_SETS ? p.set : 'plain', limit: ROW_LIMITS.includes(p.limit) ? p.limit : 50 };
  } catch {
    return { set: 'plain', limit: 50 };
  }
}
const usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });
const money = (cents: number) => usd.format(cents / 100);
const pct = (p: number) => `${Math.round(p * 100)}%`;
// API spend in nano-dollars (bigint) -> "$0.000158"
const spend = (nano: bigint) => {
  const micro = (nano + 500n) / 1000n;
  return `$${micro / 1_000_000n}.${(micro % 1_000_000n).toString().padStart(6, '0')}`;
};

type Tab = 'all' | 'needs' | 'reviewed';
type SortKey = 'date' | 'vendor' | 'account' | 'amountCents' | 'match';
const DEFAULT_WIDTHS = { date: 92, vendor: 170, items: 160, description: 250, memo: 250, account: 130, amount: 100, review: 104, match: 170 };
type WidthKey = keyof typeof DEFAULT_WIDTHS;

function loadReviewed(): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(REVIEW_KEY) ?? '[]'));
  } catch {
    return new Set();
  }
}

export default function App() {
  const [companies, setCompanies] = useState<CompanySummary[]>([]);
  const [jev, setJev] = useState<JevStatus | null>(null);
  const [companyId, setCompanyId] = useState(DEFAULT_COMPANY);
  const [data, setData] = useState<CompanyBills | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [input, setInput] = useState('');
  const [query, setQuery] = useState('');
  const [tab, setTab] = useState<Tab>('all');
  const [matchesOnly, setMatchesOnly] = useState(false);
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: 'match', dir: -1 }); // default: match % once a query runs, date order otherwise
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [reviewed, setReviewed] = useState<Set<string>>(loadReviewed);
  const [drawerId, setDrawerId] = useState<string | null>(null);
  const [widths, setWidths] = useState(DEFAULT_WIDTHS);
  const [now, setNow] = useState(performance.now());
  const [prefs, setPrefs] = useState(loadPrefs);
  const updatePrefs = (p: Partial<typeof prefs>) =>
    setPrefs((cur) => {
      const next = { ...cur, ...p };
      try {
        localStorage.setItem(PREFS_KEY, JSON.stringify(next));
      } catch {}
      return next;
    });

  useEffect(() => {
    fetch('/api/companies').then((r) => r.json()).then(setCompanies).catch(() => {});
    fetch('/api/status').then((r) => r.json()).then((s) => setJev(s.jev)).catch(() => {});
  }, []);

  // Load a company's records; never show another company's rows while loading.
  const loadSeq = useRef(0);
  useEffect(() => {
    const seq = ++loadSeq.current;
    setData(null);
    setLoadError(null);
    setSelected(new Set());
    setDrawerId(null);
    fetch(`/api/companies/${companyId}/bills?limit=${prefs.limit}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((d: CompanyBills) => seq === loadSeq.current && setData(d))
      .catch((e: Error) => seq === loadSeq.current && setLoadError(e.message));
  }, [companyId, prefs.limit]);

  // Debounce the criterion (~300 ms); empty input clears immediately.
  useEffect(() => {
    if (!input.trim()) return setQuery('');
    const t = setTimeout(() => setQuery(input), 300);
    return () => clearTimeout(t);
  }, [input]);

  // Changing the semantic query clears manual selection.
  useEffect(() => setSelected(new Set()), [query]);

  const rows = data?.rows ?? [];
  const counts = useMemo(() => {
    const rev = rows.filter((r) => reviewed.has(r.id)).length;
    return { all: rows.length, needs: rows.length - rev, reviewed: rev };
  }, [rows, reviewed]);

  const sortedRows = useMemo(() => {
    const k = sort.key === 'match' ? 'date' : sort.key; // semantic sort is applied once results exist
    return [...rows].sort((a, b) => {
      const av = a[k], bv = b[k];
      const c = av < bv ? -1 : av > bv ? 1 : a.id < b.id ? -1 : 1;
      return c * (sort.key === 'match' ? 1 : sort.dir);
    });
  }, [rows, sort]);

  const tabRows = useMemo(
    () => sortedRows.filter((r) => (tab === 'all' ? true : tab === 'reviewed' ? reviewed.has(r.id) : !reviewed.has(r.id))),
    [sortedRows, tab, reviewed],
  );

  // Visible rows are evaluated first.
  const orderRef = useRef<string[]>([]);
  orderRef.current = [...tabRows.map((r) => r.id), ...sortedRows.filter((r) => !tabRows.includes(r)).map((r) => r.id)];
  const { evalState, retry } = useSemanticEval(data, query, useCallback(() => orderRef.current, []));
  const active = query.trim() !== '' && evalState.query === query.trim();
  const awaitingDebounce = input.trim() !== query.trim();

  const matchOf = (id: string) => (active ? evalState.results[id] : undefined);
  const isMatch = (id: string) => evalState.results[id]?.state === 'match';
  const filtered = matchesOnly && active ? tabRows.filter((r) => isMatch(r.id)) : tabRows;
  const shownBase =
    sort.key === 'match' && active ? sortByMatch(filtered, (id) => evalState.results[id], sort.dir) : filtered;
  // Matches rise to the top while a query is active; with no query the original order returns.
  const visibleRows = arrangeRows(shownBase, isMatch, active);

  // Animate rows to their new positions (FLIP) so the reordering is visible.
  const bodyRef = useRef<HTMLTableSectionElement>(null);
  const prevTops = useRef(new Map<string, number>());
  useLayoutEffect(() => {
    const body = bodyRef.current;
    if (!body) return;
    const next = new Map<string, number>();
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    for (const el of Array.from(body.children) as HTMLElement[]) {
      const id = el.dataset.id!;
      const top = el.offsetTop;
      next.set(id, top);
      const before = prevTops.current.get(id);
      if (!reduce && before !== undefined && before !== top && Math.abs(before - top) < 3000) {
        el.animate([{ transform: `translateY(${before - top}px)` }, { transform: 'none' }], { duration: 260, easing: 'ease-out' });
      }
    }
    prevTops.current = next;
  });

  // Live elapsed clock only while a run is in flight.
  const running = active && evalState.finishedAt === null;
  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => setNow(performance.now()), 100);
    return () => clearInterval(t);
  }, [running]);
  const elapsed = active && evalState.startedAt !== null ? ((evalState.finishedAt ?? now) - evalState.startedAt) / 1000 : 0;
  const evaluated = Object.keys(evalState.results).length;

  const matchRows = active ? rows.filter((r) => matchOf(r.id)?.state === 'match') : [];
  const matchCents = matchRows.reduce((s, r) => s + r.amountCents, 0);
  const selRows = rows.filter((r) => selected.has(r.id));
  const selCents = selRows.reduce((s, r) => s + r.amountCents, 0);
  const complete = active && evalState.pending.size === 0 && evalState.failed.size === 0;

  const persistReviewed = (next: Set<string>) => {
    setReviewed(next);
    try {
      localStorage.setItem(REVIEW_KEY, JSON.stringify([...next]));
    } catch {}
  };
  const setReviewStatus = (value: boolean) => {
    const next = new Set(reviewed);
    selected.forEach((id) => (value ? next.add(id) : next.delete(id)));
    persistReviewed(next);
    setSelected(new Set());
  };
  const resetReview = () => {
    persistReviewed(new Set());
    setSelected(new Set());
  };
  const selectMatches = () => {
    const ids = visibleRows.filter((r) => matchOf(r.id)?.state === 'match').map((r) => r.id);
    setSelected(new Set(ids));
  };
  const toggle = (id: string) =>
    setSelected((s) => {
      const n = new Set(s);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });
  const allVisibleSelected = visibleRows.length > 0 && visibleRows.every((r) => selected.has(r.id));
  const toggleAll = () =>
    setSelected((s) => {
      const n = new Set(s);
      visibleRows.forEach((r) => (allVisibleSelected ? n.delete(r.id) : n.add(r.id)));
      return n;
    });

  const sortBy = (key: SortKey) =>
    setSort((s) => (s.key === key ? { key, dir: (s.dir * -1) as 1 | -1 } : { key, dir: key === 'match' ? -1 : 1 }));
  const arrow = (key: SortKey) =>
    key === 'date' && sort.key === 'match' && !active ? ' ▲' : sort.key === key ? (key === 'match' ? (sort.dir === -1 ? ' ▼ high→low' : ' ▲ low→high') : sort.dir === 1 ? ' ▲' : ' ▼') : '';

  const startResize = (key: WidthKey, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    const startW = widths[key];
    const move = (ev: MouseEvent) => setWidths((w) => ({ ...w, [key]: Math.max(70, startW + ev.clientX - startX) }));
    const up = () => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  };

  const company = data?.company ?? companies.find((c) => c.companyId === companyId);
  const drawerRow = rows.find((r) => r.id === drawerId) ?? null;

  return (
    <div className="app">
      <header className="toolbar">
        <h1>Transaction Review</h1>
        <CompanyPicker companies={companies} value={companyId} onChange={(id) => id !== companyId && setCompanyId(id)} />
        <div className="active-company">
          <strong>{company?.name ?? '…'}</strong>
          <span>{company?.industry}</span>
        </div>
        <nav className="tabs" role="tablist">
          {(['all', 'needs', 'reviewed'] as Tab[]).map((t) => (
            <button key={t} role="tab" aria-selected={tab === t} className={tab === t ? 'on' : ''} onClick={() => setTab(t)}>
              {{ all: 'All', needs: 'Needs review', reviewed: 'Reviewed' }[t]} <b>{data ? counts[t] : '–'}</b>
            </button>
          ))}
        </nav>
        <div className="spacer" />
        <label className="rows-pick" title="Fewer rows means faster and cheaper queries">
          Rows
          <select value={prefs.limit} onChange={(e) => updatePrefs({ limit: Number(e.target.value) })} aria-label="Rows to load">
            {ROW_LIMITS.map((n) => (
              <option key={n} value={n}>{n === 0 ? 'All' : n}</option>
            ))}
          </select>
        </label>
        {data?.sampled && (
          <span className="pill sample" title="Bills are sampled evenly across the year">
            Sample: {data.rows.length} of {data.totalBills} bills
          </span>
        )}
        <JevBadge jev={jev} failed={active && evalState.failed.size > 0} />
      </header>

      <section className="semantic">
        <label htmlFor="criterion">Select transactions by meaning</label>
        <div className="semantic-row">
          <input
            id="criterion"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Purchases related to tools or equipment…"
            autoComplete="off"
          />
          {input && (
            <button className="ghost" onClick={() => setInput('')}>
              Clear
            </button>
          )}
          <label className="check">
            <input type="checkbox" checked={matchesOnly} onChange={(e) => setMatchesOnly(e.target.checked)} /> Show matches only
          </label>
          <div className="progress" aria-live="polite">
            {!input.trim() ? (
              <span className="muted">Type a criterion to highlight matching rows</span>
            ) : awaitingDebounce || !active ? (
              <span className="muted">Waiting for input to settle…</span>
            ) : (
              <>
                <b>
                  {evaluated}/{evalState.total}
                </b>{' '}
                evaluated · {elapsed.toFixed(1)}s{running ? ' …' : ''} · API cost <b title="Vercel AI Gateway charge for this query">{spend(evalState.costNanoUsd)}</b>
                {evalState.failed.size > 0 && <span className="err"> · {evalState.failed.size} failed</span>}
              </>
            )}
          </div>
        </div>
        <div className="chips">
          <label className="chip-set">
            Examples
            <select value={prefs.set} onChange={(e) => updatePrefs({ set: e.target.value })} aria-label="Example prompt set">
              {Object.entries(PROMPT_SETS).map(([k, v]) => (
                <option key={k} value={k}>{v.label}</option>
              ))}
            </select>
          </label>
          {PROMPT_SETS[prefs.set].prompts.map((p) => (
            <button key={p} className="chip" onClick={() => setInput(p)}>
              {p}
            </button>
          ))}
        </div>
        {data?.disclosure && <div className="banner scenario"><b>Synthetic review scenarios — descriptions and memos modified.</b> {data.disclosure.replace('Synthetic review scenarios — descriptions and memos modified. ', '')}</div>}
        {active && evalState.failed.size > 0 && (
          <div className="banner error">
            Jev request failed for {evalState.failed.size} records ({evalState.error}). The spreadsheet is unaffected.{' '}
            <button onClick={retry}>Retry failed</button>
          </div>
        )}
        {jev && !jev.configured && (
          <div className="banner error">Jev is not configured: set AI_GATEWAY_API_KEY on the server. Matching is unavailable.</div>
        )}
      </section>

      <main className="sheet-wrap">
        {loadError ? (
          <div className="state">Could not load records ({loadError}). <button onClick={() => setCompanyId(companyId + '')}>Retry</button></div>
        ) : !data ? (
          <div className="state">Loading {companies.find((c) => c.companyId === companyId)?.name ?? 'company'} records…</div>
        ) : (
          <div className="sheet-scroll">
            <table className="sheet" style={{ width: 78 + Object.values(widths).reduce((a, b) => a + b, 0) }}>
              <thead>
                <tr>
                  <th className="gutter sticky-l0">#</th>
                  <th className="sel sticky-l1">
                    <input type="checkbox" aria-label="Select all visible" checked={allVisibleSelected} onChange={toggleAll} />
                  </th>
                  <Th w={widths.date} onClick={() => sortBy('date')} onResize={(e) => startResize('date', e)}>Date{arrow('date')}</Th>
                  <Th w={widths.vendor} onClick={() => sortBy('vendor')} onResize={(e) => startResize('vendor', e)}>Vendor{arrow('vendor')}</Th>
                  <Th w={widths.items} onResize={(e) => startResize('items', e)}>Items</Th>
                  <Th w={widths.description} onResize={(e) => startResize('description', e)}>Description</Th>
                  <Th w={widths.memo} onResize={(e) => startResize('memo', e)}>Memo</Th>
                  <Th w={widths.account} onClick={() => sortBy('account')} onResize={(e) => startResize('account', e)}>Account{arrow('account')}</Th>
                  <Th w={widths.amount} right onClick={() => sortBy('amountCents')} onResize={(e) => startResize('amount', e)}>Amount{arrow('amountCents')}</Th>
                  <Th w={widths.review} onResize={(e) => startResize('review', e)}>Review</Th>
                  <Th w={widths.match} onClick={() => sortBy('match')} onResize={(e) => startResize('match', e)}>Semantic match %{arrow('match')}</Th>
                </tr>
              </thead>
              <tbody ref={bodyRef}>
                {visibleRows.map((r, i) => (
                  <SheetRow
                    key={r.id}
                    row={r}
                    n={i + 1}
                    selected={selected.has(r.id)}
                    reviewed={reviewed.has(r.id)}
                    open={drawerId === r.id}
                    active={active}
                    match={matchOf(r.id)}
                    pending={active && evalState.pending.has(r.id)}
                    failed={active && evalState.failed.has(r.id)}
                    onToggle={() => toggle(r.id)}
                    onOpen={() => setDrawerId(r.id)}
                  />
                ))}
              </tbody>
            </table>
            {visibleRows.length === 0 && (
              <div className="state empty">
                {matchesOnly && active
                  ? evalState.pending.size
                    ? 'No matches yet — still evaluating.'
                    : 'No rows match this criterion.'
                  : tab === 'reviewed'
                    ? 'No reviewed transactions yet.'
                    : tab === 'needs'
                      ? 'Everything here has been reviewed.'
                      : 'This company has no vendor bills.'}
              </div>
            )}
          </div>
        )}
      </main>

      <footer className="actions">
        <div className="stat">
          <span>Matches</span>
          <b>{active ? matchRows.length : '–'}</b>
          <span className="sub">
            {active ? `${money(matchCents)}${complete ? '' : ' (partial)'}` : ''}
          </span>
        </div>
        <div className="stat">
          <span>Selected</span>
          <b>{selected.size}</b>
          <span className="sub">{money(selCents)}</span>
        </div>
        <div className="spacer" />
        <button onClick={selectMatches} disabled={!active || matchRows.length === 0}>Select current matches</button>
        <button className="primary" onClick={() => setReviewStatus(true)} disabled={selected.size === 0}>Mark reviewed</button>
        <button onClick={() => setReviewStatus(false)} disabled={selected.size === 0}>Mark needs review</button>
        <button className="ghost" onClick={() => setSelected(new Set())} disabled={selected.size === 0}>Clear selection</button>
        <button className="ghost" onClick={resetReview} title="Reset all review state (all companies)">Reset review state</button>
      </footer>

      {drawerRow && (
        <Drawer row={drawerRow} reviewed={reviewed.has(drawerRow.id)} match={matchOf(drawerRow.id)} onClose={() => setDrawerId(null)} />
      )}
    </div>
  );
}

function Th(props: { w: number; right?: boolean; onClick?: () => void; onResize: (e: React.MouseEvent) => void; children: React.ReactNode }) {
  return (
    <th style={{ width: props.w, minWidth: props.w }} className={(props.right ? 'right ' : '') + (props.onClick ? 'sortable' : '')} onClick={props.onClick}>
      {props.children}
      <span className="resizer" onMouseDown={props.onResize} onClick={(e) => e.stopPropagation()} />
    </th>
  );
}

function SheetRow(p: {
  row: Row; n: number; selected: boolean; reviewed: boolean; open: boolean; active: boolean;
  match?: { state: string; pMatch: number }; pending: boolean; failed: boolean;
  onToggle: () => void; onOpen: () => void;
}) {
  const { row: r, match } = p;
  const cls = ['row', match?.state === 'match' ? 'm-match' : match?.state === 'uncertain' ? 'm-unc' : '', p.selected ? 'is-sel' : '', p.open ? 'is-open' : ''].join(' ');
  return (
    <tr className={cls} data-id={r.id} onClick={p.onOpen}>
      <td className="gutter sticky-l0">{p.n}</td>
      <td className="sel sticky-l1" onClick={(e) => e.stopPropagation()}>
        <input type="checkbox" aria-label={`Select row ${p.n}`} checked={p.selected} onChange={p.onToggle} />
      </td>
      <td>{r.date}</td>
      <td title={r.vendor}>{r.vendor}</td>
      <td title={r.itemNames.join(', ')}>{r.itemNames.join(', ')}</td>
      <td title={r.description.trim() ? r.description : '(blank)'} className="pre">{r.description}</td>
      <td title={r.memo.trim() ? r.memo : '(blank)'} className="pre">{r.memo}</td>
      <td title={r.account}>{r.account}</td>
      <td className="right num">{money(r.amountCents)}</td>
      <td><span className={'tag ' + (p.reviewed ? 'rev' : 'need')}>{p.reviewed ? 'Reviewed' : 'Needs review'}</span></td>
      <td>
        {!p.active ? <span className="muted">—</span>
          : match ? (
            match.state === 'match' ? <span className="tag ok" title="Jev's probability that this matches">● Match {pct(match.pMatch)}</span>
            : match.state === 'uncertain' ? <span className="tag warn" title="Jev's probability that this matches">◐ Uncertain {pct(match.pMatch)}</span>
            : <span className="muted" title="Jev's probability that this matches">No match {pct(match.pMatch)}</span>
          ) : p.failed ? <span className="tag bad">Failed</span>
          : p.pending ? <span className="muted">Pending…</span> : <span className="muted">—</span>}
      </td>
    </tr>
  );
}

function Drawer({ row: r, reviewed, match, onClose }: { row: Row; reviewed: boolean; match?: { state: string; pMatch: number }; onClose: () => void }) {
  const kv = (o: Record<string, unknown> | null) =>
    o ? Object.entries(o).filter(([, v]) => v !== null && typeof v !== 'object') : [];
  return (
    <aside className="drawer" aria-label="Transaction detail">
      <div className="drawer-head">
        <div>
          <b>{r.vendor}</b>
          <div className="muted">{r.docNumber} · {r.billId}</div>
        </div>
        <button className="ghost" onClick={onClose} aria-label="Close detail">✕</button>
      </div>
      <div className="drawer-body">
        <h3>Bill</h3>
        <dl>
          <dt>Date</dt><dd>{r.date}</dd>
          <dt>Due</dt><dd>{r.dueDate}</dd>
          <dt>Total</dt><dd>{money(r.amountCents)}</dd>
          <dt>Kind</dt><dd>{r.expenseKind} / {r.costCategory}</dd>
          <dt>Account</dt><dd>{r.account}</dd>
          <dt>Project</dt><dd>{r.project ?? '—'}</dd>
          <dt>Memo</dt><dd>{r.memo || '—'}</dd>
          <dt>Review</dt><dd>{reviewed ? 'Reviewed' : 'Needs review'}</dd>
          <dt>Jev</dt><dd>{match ? `${match.state.replace('_', ' ')} (P(match) ${pct(match.pMatch)})` : '—'}</dd>
        </dl>
        <h3>Lines</h3>
        {r.lines.map((l, i) => (
          <dl key={i} className="line">
            {kv(l).map(([k, v]) => (<><dt key={k}>{k}</dt><dd>{String(v)}</dd></>))}
          </dl>
        ))}
        {r.provenance && (
          <>
            <h3>Original record (provenance only)</h3>
            <dl>
              <dt>Description</dt><dd>{r.provenance.description || '—'}</dd>
              <dt>Memo</dt><dd>{r.provenance.memo || '—'}</dd>
            </dl>
            <p className="muted small">Shown for disclosure only; never sent to Jev.</p>
          </>
        )}
        <h3>Payments</h3>
        {r.payments.length === 0 ? <p className="muted">No payment applied.</p> : r.payments.map((p) => (
          <dl key={p.id} className="line"><dt>{p.id}</dt><dd>{p.date} · {money(p.amountCents)} from {p.account}</dd></dl>
        ))}
        <h3>Vendor</h3>
        <dl>{kv(r.vendorRecord).map(([k, v]) => (<><dt key={k}>{k}</dt><dd>{String(v)}</dd></>))}</dl>
        {r.projectRecord && (<><h3>Project</h3><dl>{kv(r.projectRecord).map(([k, v]) => (<><dt key={k}>{k}</dt><dd>{String(v)}</dd></>))}</dl></>)}
        <p className="muted small">Payments are shown as context only and are not counted as separate spend.</p>
      </div>
    </aside>
  );
}

function JevBadge({ jev, failed }: { jev: JevStatus | null; failed: boolean }) {
  if (!jev) return <span className="pill">Jev: checking…</span>;
  if (!jev.configured) return <span className="pill bad">Jev: not configured</span>;
  return (
    <span className={'pill ' + (failed ? 'bad' : 'ok')} title={`${jev.model} via ${jev.via}`}>
      Jev: {failed ? 'errors' : 'connected'} · {jev.via}
    </span>
  );
}

function CompanyPicker({ companies, value, onChange }: { companies: CompanySummary[]; value: string; onChange: (id: string) => void }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const ref = useRef<HTMLDivElement>(null);
  const current = companies.find((c) => c.companyId === value);
  const list = useMemo(() => {
    const s = q.trim().toLowerCase();
    return companies.filter((c) => !s || c.name.toLowerCase().includes(s) || c.industry.toLowerCase().includes(s));
  }, [companies, q]);
  useEffect(() => {
    const h = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, []);
  const pick = (id: string) => {
    onChange(id);
    setOpen(false);
    setQ('');
  };
  return (
    <div className="picker" ref={ref}>
      <input
        aria-label="Company"
        placeholder="Search companies by name or industry"
        value={open ? q : current?.name ?? ''}
        onFocus={() => { setOpen(true); setQ(''); }}
        onChange={(e) => setQ(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter' && list[0]) pick(list[0].companyId); if (e.key === 'Escape') setOpen(false); }}
      />
      {open && (
        <ul className="picker-list" role="listbox">
          {list.length === 0 && <li className="muted none">No companies match.</li>}
          {list.map((c) => (
            <li key={c.companyId} role="option" aria-selected={c.companyId === value} onMouseDown={() => pick(c.companyId)}>
              <b>{c.name}{c.scenario && <em className="demo-tag">Modified demo scenario</em>}</b>
              <span>{c.industry} · {c.billCount} bills</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
