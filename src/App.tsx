import { Fragment, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { arrangeRows, sortByMatch } from './arrange';
import type { CompanyBills, CompanySummary, JevStatus, Row } from './types';
import { useSemanticEval } from './useSemanticEval';
import { readRuleStore, useRules } from './useRules';
import { LocalStateEditor, ResultBadge, RuleEvidence, RuleHistory, RulePreviewBar, RulesPanel } from './RulesPanel';
import { actionLabel, type LocalTransaction, type Outcome } from './rules';
import { useWorkspace, type RowPatch } from './useWorkspace';
import { ActionPanel, TaskBoard } from './ActionPanel';

const DEFAULT_COMPANY = 'company-018';
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

export default function App() {
  const [companies, setCompanies] = useState<CompanySummary[]>([]);
  const [jev, setJev] = useState<JevStatus | null>(null);
  const [companyId, setCompanyId] = useState(DEFAULT_COMPANY);
  const [workspace, setWorkspace] = useState<'transactions' | 'rules' | 'tasks'>(() => new URLSearchParams(location.search).get('workspace') === 'rules' ? 'rules' : 'transactions');
  const [takeAction, setTakeAction] = useState(false);
  const [statusFilter, setStatusFilter] = useState('all');
  const [assigneeFilter, setAssigneeFilter] = useState('all');
  const [drawerExtra, setDrawerExtra] = useState<Row | null>(null);
  const [previewFilter, setPreviewFilter] = useState('all');
  const [recordSearch, setRecordSearch] = useState('');
  const [data, setData] = useState<CompanyBills | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [input, setInput] = useState('');
  const [query, setQuery] = useState('');
  const [tab, setTab] = useState<Tab>('all');
  const [matchesOnly, setMatchesOnly] = useState(false);
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: 'match', dir: -1 }); // default: match % once a query runs, date order otherwise
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [reviewed, setReviewed] = useState<Set<string>>(() => new Set());
  const [drawerId, setDrawerId] = useState<string | null>(null);
  const [widths, setWidths] = useState(DEFAULT_WIDTHS);
  const [now, setNow] = useState(performance.now());
  const [prefs, setPrefs] = useState(loadPrefs);
  const updateRows = useCallback((patches: RowPatch[]) => {
    setData(current => {
      if (!current || current.company.companyId !== companyId) return current;
      const updates = new Map(patches.filter(row => row.companyId === companyId).map(row => [row.id, row]));
      let changed = false;
      const rows = current.rows.map(row => {
        const patch = updates.get(row.id);
        if (!patch || patch.sourceVersion === row.sourceVersion) return row;
        changed = true; return { ...row, ...patch };
      });
      return changed ? { ...current, rows } : current;
    });
    setDrawerExtra(current => { const patch = patches.find(row => row.id === current?.id); return current && patch ? { ...current, ...patch } : current; });
  }, [companyId]);
  const dashboard = useWorkspace(companyId, updateRows);
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
    setDrawerExtra(null); setStatusFilter('all'); setAssigneeFilter('all');
    fetch(`/api/companies/${companyId}/bills?limit=${prefs.limit}&reserve=1`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((d: CompanyBills) => {
        if (seq !== loadSeq.current) return;
        const arrived = readRuleStore().arrivals[companyId] ?? [];
        const rows = [...d.rows, ...(d.reservedRows ?? []).filter(r => arrived.includes(r.id) && !d.rows.some(x => x.id === r.id))];
        setData({ ...d, rows });
      })
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
  useEffect(() => {
    if (!data) return;
    setReviewed(current => new Set([...current].filter(id => !id.startsWith(`${data.company.companyId}:`)).concat(data.rows.filter(row => row.dashboard?.reviewed).map(row => row.id))));
  }, [data]);
  const rules = useRules(data?.company.companyId === companyId ? data : null, reviewed, row => setData(current => current?.company.companyId === row.companyId && !current.rows.some(r => r.id === row.id) ? { ...current, rows: [...current.rows, row] } : current), workspace === 'rules');
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
  const { evalState, retry } = useSemanticEval(workspace === 'transactions' ? data : null, query, useCallback(() => orderRef.current, []));
  const active = query.trim() !== '' && evalState.query === query.trim();
  const awaitingDebounce = input.trim() !== query.trim();

  const matchOf = (id: string) => (active ? evalState.results[id] : undefined);
  const isMatch = (id: string) => evalState.results[id]?.state === 'match';
  const filtered = matchesOnly && active ? tabRows.filter((r) => isMatch(r.id)) : tabRows;
  const shownBase =
    sort.key === 'match' && active ? sortByMatch(filtered, (id) => evalState.results[id], sort.dir) : filtered;
  // Matches rise to the top while a query is active; with no query the original order returns.
  const workspaceRows = workspace === 'rules' ? tabRows.filter(r => (previewFilter === 'all' || rules.snapshots[r.id]?.result === previewFilter) && (!recordSearch.trim() || [r.billId, r.vendor, r.description, r.memo, r.account, ...r.itemNames].join(' ').toLowerCase().includes(recordSearch.trim().toLowerCase()))) : arrangeRows(shownBase, isMatch, active);
  const visibleRows = workspaceRows.filter(row => (statusFilter === 'all' || (statusFilter === 'reviewed' ? reviewed.has(row.id) : statusFilter === 'flagged' ? Boolean(row.dashboard?.flags.length) : !reviewed.has(row.id))) && (assigneeFilter === 'all' || (assigneeFilter === 'unassigned' ? !row.dashboard?.owner : row.dashboard?.owner === assigneeFilter)));

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
      if (workspace === 'transactions' && !reduce && before !== undefined && before !== top && Math.abs(before - top) < 3000) {
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

  const setReviewStatus = (value: boolean) => {
    void dashboard.review([...selected], value).then(() => {
      rows.filter(row => selected.has(row.id)).forEach(row => rules.processUpdate(row, value));
      setSelected(new Set());
    }).catch(() => {});
  };
  const resetReview = () => {
    if (rows.length) void dashboard.review(rows.map(row => row.id), false).then(() => setSelected(new Set())).catch(() => {});
  };
  const selectMatches = () => {
    const ids = visibleRows.filter((r) => workspace === 'rules' ? rules.snapshots[r.id]?.result === 'true' : matchOf(r.id)?.state === 'match').map((r) => r.id);
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
  const drawerRow = rows.find((r) => r.id === drawerId) ?? (drawerExtra?.id === drawerId ? drawerExtra : null);
  const inspect = (id: string) => {
    if (rows.some(row => row.id === id)) { setDrawerId(id); return; }
    void fetch(`/api/companies/${companyId}/bills/${encodeURIComponent(id)}`).then(async response => {
      const row = await response.json(); if (!response.ok) throw new Error(row.error ?? 'Could not load bill.');
      if (row.companyId === companyId) { setDrawerExtra(row); setDrawerId(id); }
    }).catch(() => {});
  };
  const actionMatches = workspace === 'rules' ? { ids: visibleRows.filter(row => rules.snapshots[row.id]?.result === 'true').map(row => row.id), expression: rules.draft?.expression, scope: 'matches' as const } : { ids: visibleRows.filter(row => isMatch(row.id)).map(row => row.id), criterion: query, scope: 'matches' as const };
  const actionReady = workspace === 'rules' ? rules.complete : complete && !awaitingDebounce;
  const sidebarActions = workspace !== 'rules' || takeAction;

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

      <div className="workspace-nav"><nav aria-label="Workspace"><button className={workspace === 'transactions' ? 'on' : ''} onClick={() => { setWorkspace('transactions'); setTakeAction(false); }}>Transactions</button><button className={workspace === 'rules' ? 'on' : ''} onClick={() => { setWorkspace('rules'); setTakeAction(false); }}>Rules <span className="nav-caption">Build → Preview → Automate</span></button><button className={workspace === 'tasks' ? 'on' : ''} onClick={() => setWorkspace('tasks')}>Tasks & activity{dashboard.tasks.filter(task => task.status === 'open').length > 0 && <b className="task-nav-count">{dashboard.tasks.filter(task => task.status === 'open').length}</b>}</button></nav><span className="muted">SQLite workspace · Original dataset preserved</span></div>
      {dashboard.error && <div className="rules-notice error" role="alert">{dashboard.error}<button onClick={dashboard.clearError}>Dismiss</button></div>}

      {workspace === 'transactions' && <section className="semantic">
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
      </section>}

      {workspace === 'rules' && (rules.storageError || rules.message) && <div className={`rules-notice ${rules.storageError ? 'error' : ''}`} role="status">{rules.storageError || rules.message}</div>}
      {workspace === 'rules' && rules.previewErrors.length > 0 && <div className="rules-notice error">Jev evaluation failed: {rules.previewErrors.join('; ')}. No failed record is treated as false. <button onClick={rules.retry}>Retry failed conditions</button></div>}
      {workspace === 'rules' && data?.disclosure && <div className="rules-notice scenario">{data.disclosure}</div>}
      <div className="workspace-body with-builder">
      {sidebarActions ? <ActionPanel key={companyId} controller={dashboard} matches={actionMatches} selectedIds={[...selected]} ready={actionReady} onInspect={inspect} /> : workspace === 'rules' && data && <RulesPanel controller={rules} data={data} />}
      <div className="ledger-column">
      {workspace !== 'tasks' && <div className="dashboard-ledger-toolbar"><label>Status<select aria-label="Bill status filter" value={statusFilter} onChange={event => { setStatusFilter(event.target.value); setSelected(new Set()); }}><option value="all">Any status</option><option value="needs_review">Needs review</option><option value="reviewed">Reviewed</option><option value="flagged">Flagged</option></select></label><label>Assigned to<select aria-label="Bill assignee filter" value={assigneeFilter} onChange={event => { setAssigneeFilter(event.target.value); setSelected(new Set()); }}><option value="all">Anyone</option><option value="unassigned">Unassigned</option>{dashboard.owners.map(owner => <option key={owner} value={owner}>{owner}</option>)}</select></label><span className="spacer" /><span className="small muted">{visibleRows.length} bills shown</span>{workspace === 'rules' && <button onClick={() => setTakeAction(!takeAction)}>{takeAction ? 'Edit rule' : 'Take action'}</button>}</div>}
      {workspace === 'rules' && <RulePreviewBar c={rules} total={rows.length} onInspect={() => rules.matches[0] && setDrawerId(rules.matches[0].id)} />}
      {workspace === 'rules' && data && <div className="ledger-caption"><div><b>{data.company.name}</b><span>{rows.length} loaded · {data.totalBills} {data.company.scenario ? 'source company bills' : 'original bills'} · {rules.remaining} reserved for replay{data.sampled ? ' · Year-round sample' : ''}</span></div><div className="ledger-filters"><input aria-label="Search visible bills" placeholder="Search bills, vendors, memos…" value={recordSearch} onChange={e => setRecordSearch(e.target.value)} /><select aria-label="Preview rows" value={previewFilter} onChange={e => setPreviewFilter(e.target.value)}><option value="all">All results</option><option value="true">Definite matches</option><option value="false">False</option><option value="uncertain">Uncertain</option><option value="pending">Pending</option><option value="error">Errors</option></select></div></div>}

      {workspace === 'tasks' ? <TaskBoard c={dashboard} onInspect={inspect} /> : <main className="sheet-wrap">
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
                  <Th w={widths.review} onResize={(e) => startResize('review', e)}>Status</Th>
                  <Th w={widths.match} className={workspace === 'rules' ? 'rule-result-column' : ''} onClick={workspace === 'transactions' ? () => sortBy('match') : undefined} onResize={(e) => startResize('match', e)}>{workspace === 'rules' ? 'Rule result' : `Semantic match %${arrow('match')}`}</Th>
                  <th className="dashboard-assignment-column" style={{ minWidth: 230, width: 230 }}>Assigned to</th>
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
                    ruleOutcome={workspace === 'rules' ? rules.snapshots[r.id]?.result ?? 'pending' : undefined}
                    local={{ ...rules.store.transactions[r.id], flags: [...new Set([...(r.dashboard?.flags ?? []), ...(rules.store.transactions[r.id]?.flags ?? [])])], tags: [...new Set([...(r.dashboard?.tags ?? []), ...(rules.store.transactions[r.id]?.tags ?? [])])], owner: r.dashboard?.owner || rules.store.transactions[r.id]?.owner || '', automatedCheck: Boolean(r.dashboard?.automatedCheck || rules.store.transactions[r.id]?.automatedCheck) }}
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
                  : workspace === 'rules' && (previewFilter !== 'all' || recordSearch.trim()) ? 'No bills match this view. Change the result filter or search.' : tab === 'reviewed'
                    ? 'No reviewed transactions yet.'
                    : tab === 'needs'
                      ? 'Everything here has been reviewed.'
                      : 'This company has no vendor bills.'}
              </div>
            )}
          </div>
        )}
      </main>}
      {workspace === 'rules' && <RuleHistory c={rules} companyId={companyId} />}
      </div>
      </div>

      <footer className="actions">
        <div className="stat">
          <span>Matches</span>
          <b>{workspace === 'rules' ? rules.matches.length : active ? matchRows.length : '–'}</b>
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
        <button onClick={selectMatches} disabled={workspace === 'rules' ? rules.matches.length === 0 : !active || matchRows.length === 0}>Select current matches</button>
        <button className="primary" onClick={() => setReviewStatus(true)} disabled={selected.size === 0 || dashboard.busy}>Mark reviewed</button>
        <button onClick={() => setReviewStatus(false)} disabled={selected.size === 0 || dashboard.busy}>Mark needs review</button>
        <button className="ghost" onClick={() => setSelected(new Set())} disabled={selected.size === 0}>Clear selection</button>
        <button className="ghost" onClick={resetReview} disabled={dashboard.busy || !rows.length} title="Reset review for loaded bills in this company">Reset review state</button>
      </footer>

      {drawerRow && (
        <Drawer row={drawerRow} reviewed={drawerRow.dashboard?.reviewed ?? reviewed.has(drawerRow.id)} match={matchOf(drawerRow.id)} onClose={() => setDrawerId(null)} rules={rules} />
      )}
    </div>
  );
}

function Th(props: { w: number; right?: boolean; className?: string; onClick?: () => void; onResize: (e: React.MouseEvent) => void; children: React.ReactNode }) {
  return (
    <th style={{ width: props.w, minWidth: props.w }} className={(props.right ? 'right ' : '') + (props.onClick ? 'sortable ' : '') + (props.className ?? '')} onClick={props.onClick}>
      {props.children}
      <span className="resizer" onMouseDown={props.onResize} onClick={(e) => e.stopPropagation()} />
    </th>
  );
}

function SheetRow(p: {
  row: Row; n: number; selected: boolean; reviewed: boolean; open: boolean; active: boolean;
  match?: { state: string; pMatch: number }; pending: boolean; failed: boolean;
  onToggle: () => void; onOpen: () => void;
  ruleOutcome?: Outcome; local?: LocalTransaction;
}) {
  const { row: r, match } = p;
  const cls = ['row', (p.ruleOutcome ? p.ruleOutcome === 'true' : match?.state === 'match') ? 'm-match' : (p.ruleOutcome ? p.ruleOutcome === 'uncertain' : match?.state === 'uncertain') ? 'm-unc' : '', p.selected ? 'is-sel' : '', p.open ? 'is-open' : ''].join(' ');
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
      <td title={r.workspaceChanges?.memo !== undefined ? `Original memo: ${r.workspaceChanges.memo}` : r.memo.trim() ? r.memo : '(blank)'} className={`pre ${r.workspaceChanges?.memo !== undefined ? 'workspace-edited' : ''}`}>{r.memo}</td>
      <td title={r.workspaceChanges?.account !== undefined ? `Original category: ${r.workspaceChanges.account}` : r.account} className={r.workspaceChanges?.account !== undefined ? 'workspace-edited' : ''}>{r.account}</td>
      <td className="right num">{money(r.amountCents)}</td>
      <td><span className={'tag ' + (p.reviewed ? 'rev' : 'need')}>{p.reviewed ? 'Reviewed' : 'Needs review'}</span></td>
      <td className={p.ruleOutcome ? 'rule-result-column' : undefined}>
        {p.ruleOutcome ? <ResultBadge value={p.ruleOutcome} /> : !p.active ? <span className="muted">—</span>
          : match ? (
            match.state === 'match' ? <span className="tag ok" title="Jev's probability that this matches">● Match {pct(match.pMatch)}</span>
            : match.state === 'uncertain' ? <span className="tag warn" title="Jev's probability that this matches">◐ Uncertain {pct(match.pMatch)}</span>
            : <span className="muted" title="Jev's probability that this matches">No match {pct(match.pMatch)}</span>
          ) : p.failed ? <span className="tag bad">Failed</span>
          : p.pending ? <span className="muted">Pending…</span> : <span className="muted">—</span>}
      </td>
      <td className="dashboard-assignment-column" title={[...(p.local?.flags ?? []), ...(p.local?.tags ?? []), p.local?.owner ?? ''].filter(Boolean).join(' · ')}><span className={p.local?.owner ? 'assigned-owner' : 'muted'}>{p.local?.owner || 'Unassigned'}</span> {p.local?.automatedCheck && <span className="tag ok">Automated pass</span>} {p.local?.flags.map(flag => <span className="tag warn" key={flag}>{flag}</span>)} {p.local?.tags.map(tag => <span className="tag" key={tag}>{tag}</span>)} {Boolean(r.dashboard?.taskIds.length) && <span className="tag">{r.dashboard!.taskIds.length} tasks</span>}</td>
    </tr>
  );
}

function Drawer({ row: r, reviewed, match, onClose, rules }: { row: Row; reviewed: boolean; match?: { state: string; pMatch: number }; onClose: () => void; rules: ReturnType<typeof useRules> }) {
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
        {rules.draft && rules.snapshots[r.id] && <><h3>Condition results · current draft</h3><RuleEvidence node={rules.draft.expression} snapshot={rules.snapshots[r.id]} /><h3>Actions {rules.snapshots[r.id].result === 'true' ? 'that would run' : '(rule must resolve true)'}</h3>{rules.draft.actions.map(a => <p key={a.id}>{actionLabel(a)}</p>)}</>}
        {r.dashboard && <><h3>Dashboard status · Saved in SQLite</h3><dl><dt>Status</dt><dd>{r.dashboard.reviewed ? 'Reviewed' : 'Needs review'}</dd><dt>Assigned to</dt><dd>{r.dashboard.owner || 'Unassigned'}</dd><dt>Flags</dt><dd>{r.dashboard.flags.join(', ') || 'None'}</dd><dt>Tags</dt><dd>{r.dashboard.tags.join(', ') || 'None'}</dd><dt>Tasks</dt><dd>{r.dashboard.taskIds.length}</dd></dl></>}
        <details className="legacy-metadata"><summary>Browser rule demo metadata</summary><LocalStateEditor value={rules.store.transactions[r.id]} update={value => rules.updateLocal(r.id, value)} /></details>
        {r.workspaceChanges && Object.keys(r.workspaceChanges).length > 0 && <><h3>Original source values</h3><dl>{r.workspaceChanges.account !== undefined && <><dt>Category</dt><dd>{r.workspaceChanges.account}</dd></>}{r.workspaceChanges.memo !== undefined && <><dt>Memo</dt><dd>{r.workspaceChanges.memo || '(blank)'}</dd></>}</dl></>}
        <h3>Bill</h3>
        <dl>
          <dt>Date</dt><dd>{r.date}</dd>
          <dt>Due</dt><dd>{r.dueDate}</dd>
          <dt>Total</dt><dd>{money(r.amountCents)}</dd>
          <dt>Kind</dt><dd>{r.expenseKind} / {r.costCategory}</dd>
          <dt>Account</dt><dd>{r.account}</dd>
          <dt>Project</dt><dd>{r.project ?? '—'}</dd>
          <dt>Memo</dt><dd>{r.memo || '—'}</dd>
          <dt>Description</dt><dd>{r.description || '(blank)'}</dd>
          <dt>Items</dt><dd>{r.itemNames.join(', ') || '(none)'}</dd>
          <dt>Review</dt><dd>{reviewed ? 'Reviewed' : 'Needs review'}</dd>
          <dt>Jev</dt><dd>{match ? `${match.state.replace('_', ' ')} (P(match) ${pct(match.pMatch)})` : '—'}</dd>
        </dl>
        <h3>Lines</h3>
        {r.lines.map((l, i) => (
          <dl key={i} className="line">
            {kv(l).map(([k, v]) => (<Fragment key={k}><dt>{k}</dt><dd>{String(v)}</dd></Fragment>))}
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
        <dl>{kv(r.vendorRecord).map(([k, v]) => (<Fragment key={k}><dt>{k}</dt><dd>{String(v)}</dd></Fragment>))}</dl>
        {r.projectRecord && (<><h3>Project</h3><dl>{kv(r.projectRecord).map(([k, v]) => (<Fragment key={k}><dt>{k}</dt><dd>{String(v)}</dd></Fragment>))}</dl></>)}
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
        onChange={(e) => { setOpen(true); setQ(e.target.value); }}
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
