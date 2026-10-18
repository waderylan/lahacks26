import { providerLabel, type Provider } from './modelContext';
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CompanyBills, CompanySummary, JevStatus, Row } from './types';
import { useRules } from './useRules';
import { EmployeeTabs, Inbox } from './Inbox';
import { useMailbox } from './useMailbox';
import { employeeById } from './employees';
import { draftSender } from './rules';
import { LocalStateEditor, MessageCard, NotificationBell, RuleEvidence, RuleIssueList, Toasts } from './RulesPanel';
import { actionLabel, actionsForOutcome } from './rules';
import { SupportingDetails } from './SupportingDetails';
import { useWorkspace, type RowPatch } from './useWorkspace';
import { TaskBoard } from './TaskBoard';
import { Explore, emptyExplore } from './Explore';
import { RulesWorkspace } from './RulesWorkspace';
import { Dashboard } from './Dashboard';
import { ALL_RECORDS, type RuleScope } from './ruleScope';
import { uid, type Rule, type RuleNode } from './rules';
import type { SearchDefinition } from './savedSearchTypes';

const DEFAULT_COMPANY = 'company-101';

const ROW_LIMITS = [50, 100, 0, -1]; // 0 = all bills, -1 = curated demo sample (synthetic extensions only)
const usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });
const money = (cents: number) => usd.format(cents / 100);
const pct = (p: number) => `${Math.round(p * 100)}%`;
export default function App() {
  const [companies, setCompanies] = useState<CompanySummary[]>([]);
  const [jev, setJev] = useState<JevStatus | null>(null);
  const [provider, setProvider] = useState<Provider>(() => new URLSearchParams(location.search).get('model') === 'qwen' ? 'qwen' : 'jev');
  const [companyId, setCompanyState] = useState(() => { const id = new URLSearchParams(location.search).get('company'); return /^company-10[1-4]$/.test(id ?? '') ? id! : DEFAULT_COMPANY; });
  const setCompanyId = (id: string) => { const url = new URL(location.href); url.searchParams.set('company',id); history.replaceState(null,'',url); setCompanyState(id); };
  const changeProvider = (next: Provider) => { const url = new URL(location.href); url.searchParams.set('model', next); url.searchParams.set('company',companyId); history.replaceState(null,'',url); setProvider(next); };
  const [customOnly, setCustomOnly] = useState(() => { try { return localStorage.getItem('tr.customOnly') === '1'; } catch { return false; } });
  const toggleCustom = (on: boolean) => {
    setCustomOnly(on);
    try { localStorage.setItem('tr.customOnly', on ? '1' : '0'); } catch { /* preference is optional */ }
    // Checking the toggle moves to a custom company if the current one is not.
    const first = companies.find((c) => c.synthetic);
    if (on && first && !companies.find((c) => c.companyId === companyId)?.synthetic) setCompanyId(first.companyId);
  };
  const [workspace, setWorkspaceState] = useState<'explore' | 'dashboard' | 'rules' | 'tasks' | 'messages'>(() => {
    const selected = new URLSearchParams(location.search).get('workspace');
    return selected === 'dashboard' || selected === 'rules' || selected === 'tasks' || selected === 'messages' ? selected : 'explore';
  });
  const setWorkspace = (next: typeof workspace) => { const url = new URL(location.href); url.searchParams.set('workspace', next); history.replaceState(null, '', url); setWorkspaceState(next); };
  // Who you are: in the URL, so separate browser tabs can be signed in as different employees.
  const [as, setAsState] = useState(() => { const id = new URLSearchParams(location.search).get('as'); return employeeById(id) ? id! : 'emp-ap'; });
  const setAs = (id: string) => { const url = new URL(location.href); url.searchParams.set('as', id); history.replaceState(null, '', url); setAsState(id); };
  const mailbox = useMailbox(companyId, as);
  const [definition, setDefinition] = useState<SearchDefinition>(emptyExplore);
  const [editor, setEditor] = useState<number | null>(null);
  const [exploreRule, setExploreRule] = useState<Rule | null>(null);
  useEffect(() => { setDefinition(emptyExplore()); setEditor(null); setExploreRule(null); }, [companyId]);
  const [drawerExtra, setDrawerExtra] = useState<Row | null>(null);
  const [data, setData] = useState<CompanyBills | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [prefsError, setPrefsError] = useState<string | null>(null);
  const [inspectError, setInspectError] = useState('');

  const [drawerId, setDrawerId] = useState<string | null>(null);
  const [prefs, setPrefs] = useState({ limit: -1 });
  const [prefsReady, setPrefsReady] = useState(false);
  const updateRows = useCallback((patches: RowPatch[]) => {
    setData(current => {
      if (!current || current.company.companyId !== companyId) return current;
      const updates = new Map(patches.filter(row => row.companyId === companyId).map(row => [row.id, row]));
      let changed = false;
      const rows = current.rows.map(row => {
        const patch = updates.get(row.id);
        if (!patch || Number(patch.sourceVersion) <= Number(row.sourceVersion)) return row;
        changed = true; return { ...row, ...patch };
      });
      return changed ? { ...current, rows } : current;
    });
    setDrawerExtra(current => { const patch = patches.find(row => row.id === current?.id); return current && patch && Number(patch.sourceVersion) > Number(current.sourceVersion) ? { ...current, ...patch } : current; });
  }, [companyId]);
  const dashboard = useWorkspace(companyId, updateRows);
  // The curated sample exists only for synthetic extension companies.
  const isSynthetic = companies.find((c) => c.companyId === companyId)?.synthetic === true;
  const rowLimit = prefs.limit === -1 && !isSynthetic ? 50 : prefs.limit;
  // With Custom data on (including when remembered from a previous visit) the selected company must be one of the custom ones.
  useEffect(() => {
    if (!customOnly || !companies.length || companies.find((c) => c.companyId === companyId)?.synthetic) return;
    const first = companies.find((c) => c.synthetic);
    if (first) setCompanyId(first.companyId);
  }, [customOnly, companies, companyId]);
  const updatePrefs = (p: Partial<typeof prefs>) => {
    void fetch('/api/settings', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(p) })
      .then(async response => { const body = await response.json(); if (!response.ok) throw new Error(body.error); setPrefs(body); setPrefsError(null); })
      .catch(error => setPrefsError(error.message));
  };

  useEffect(() => {
    fetch('/api/settings').then(async response => { if (!response.ok) throw new Error('Could not load display preferences.'); return response.json(); })
      .then(value => { setPrefs(value); setPrefsReady(true); setPrefsError(null); }).catch(error => { setPrefsError(error.message); setPrefsReady(true); });
    fetch('/api/companies').then((r) => r.json()).then(setCompanies).catch(() => {});

  }, []);

  useEffect(() => { let live = true; setJev(null); fetch('/api/status?model=' + provider).then(r => r.json()).then(body => { if (live) setJev(body.jev); }); return () => { live = false; }; }, [provider]);

  // Load a company's records; never show another company's rows while loading.
  const loadSeq = useRef(0);
  useEffect(() => {
    if (!prefsReady) return;
    const seq = ++loadSeq.current;
    setData(null);
    setLoadError(null);
    setDrawerId(null);
    setDrawerExtra(null);
    fetch(`/api/companies/${companyId}/bills?limit=${rowLimit}&reserve=1`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((d: CompanyBills) => {
        if (seq !== loadSeq.current) return;
        setData(d);
      })
      .catch((e: Error) => seq === loadSeq.current && setLoadError(e.message));
  }, [companyId, rowLimit, prefsReady]);

  const rows = data?.rows ?? [];
  const rules = useRules(data?.company.companyId === companyId ? data : null, row => setData(current => current?.company.companyId === row.companyId && !current.rows.some(r => r.id === row.id) ? { ...current, rows: [...current.rows, row] } : current), workspace === 'rules' && editor !== null, updateRows, () => { void dashboard.refresh().catch(() => {}); void mailbox.refresh(); }, as, companyId, provider);
  // Drafts are only actionable by their sender, so each employee sees just their own.
  const myDrafts = rules.store.messages.filter(message => draftSender(message) === as);
  const pendingApprovals = myDrafts.filter(message => message.status === 'pending').length;
  const company = data?.company ?? companies.find((c) => c.companyId === companyId);
  const drawerRow = rows.find((r) => r.id === drawerId) ?? (drawerExtra?.id === drawerId ? drawerExtra : null);
  const inspect = (id: string) => {
    setInspectError('');
    if (rows.some(row => row.id === id)) { setDrawerId(id); return; }
    void fetch(`/api/companies/${companyId}/bills/${encodeURIComponent(id)}`).then(async response => {
      const row = await response.json(); if (!response.ok) throw new Error(row.error ?? 'Could not load bill.');
      if (row.companyId === companyId) { setDrawerExtra(row); setDrawerId(id); }
    }).catch((error: Error) => setInspectError(error.message));
  };
  const refreshExplore = async () => {
    const seq = ++loadSeq.current;
    const response = await fetch(`/api/companies/${companyId}/bills?limit=${rowLimit}&reserve=1`);
    const body = await response.json(); if (!response.ok) throw new Error(body.error ?? 'Could not load transactions.');
    if (seq === loadSeq.current) setData(body);
  };
  const createRule = (expression: RuleNode, scope: RuleScope) => {
    rules.setDraft({ id: uid(), companyId, name: 'Untitled rule', provider, revision: 1, enabled: false, expression: structuredClone(expression), scope: { ...scope }, actions: [] });
    setEditor(1); setDrawerId(null); setWorkspace('rules');
  };
  const openRuleInExplore = (rule: Rule) => {
    setDefinition({ ...emptyExplore(), ...(rule.scope ?? ALL_RECORDS), expression: structuredClone(rule.expression) }); setExploreRule(structuredClone(rule)); setDrawerId(null); setWorkspace('explore');
  };
  const updateRule = (expression: RuleNode, scope: RuleScope) => { if (!exploreRule) return; rules.setDraft({ ...exploreRule, expression: structuredClone(expression), scope: { ...scope } }); setEditor(0); setDrawerId(null); setWorkspace('rules'); };
  return (
    <div className="app" aria-busy={rules.busy || dashboard.busy}>
      <header className="toolbar">
        <h1>Transaction Review</h1>
        <CompanyPicker companies={customOnly ? companies.filter((c) => c.synthetic) : companies} value={companyId} onChange={(id) => id !== companyId && setCompanyId(id)} />
        <label className="custom-toggle" title="Show only the four synthetic extension companies">
          <input type="checkbox" checked={customOnly} onChange={(e) => toggleCustom(e.target.checked)} aria-label="Custom data only" />
          <span className="switch" aria-hidden="true" />
          Custom data
        </label>
        <div className="active-company">
          <strong>{company?.name ?? '…'}</strong>
          <span>{company?.industry}</span>
        </div>
        <div className="spacer" />
        <label className="rows-pick" title="Fewer rows means faster and cheaper queries">
          Preview records
          <select value={rowLimit} onChange={(e) => updatePrefs({ limit: Number(e.target.value) })} aria-label="Rows to load">
            {ROW_LIMITS.filter((n) => n !== -1 || isSynthetic).map((n) => (
              <option key={n} value={n}>{n === 0 ? 'All records' : n === -1 ? 'Curated demo sample' : n}</option>
            ))}
          </select>
        </label>
        {data?.sampled && (
          <span className="pill sample" title="Bills are sampled evenly across the year">
            Sample: {data.rows.length} of {data.totalBills} {isSynthetic ? 'transactions' : 'bills'}
          </span>
        )}
        {(workspace === 'explore' || workspace === 'rules') && <>
          <label className="rows-pick">Explore / new rule model <select aria-label="Evaluation model" title="Saved rules use their recorded provider. Switching preserves the current search and unsaved rule." value={provider} onChange={event => changeProvider(event.target.value as Provider)}><option value="jev">Jev</option><option value="qwen">Qwen ? Veri</option></select></label>
          <JevBadge jev={jev} failed={false} provider={provider} />
        </>}
        <EmployeeTabs value={as} unread={mailbox.unread} onChange={setAs} />
        <NotificationBell notices={rules.store.notices.filter(notice => notice.companyId === companyId)} onRead={rules.markNoticesRead} onOpen={inspect} />
      </header>

      <div className="workspace-nav"><nav aria-label="Workspace">{(['explore', 'dashboard', 'rules', 'tasks', 'messages'] as const).map(value => <button key={value} className={workspace === value ? 'on' : ''} aria-current={workspace === value ? 'page' : undefined} onClick={() => { setDrawerId(null); setWorkspace(value); }}>{{ explore: 'Explore', dashboard: 'Dashboard', rules: 'Rules', tasks: 'Tasks & activity', messages: 'Messages' }[value]}{value === 'tasks' && dashboard.tasks.filter(task => task.status === 'open').length > 0 && <b className="task-nav-count">{dashboard.tasks.filter(task => task.status === 'open').length}</b>}{value === 'messages' && pendingApprovals + (mailbox.unread[as] ?? 0) > 0 && <b className="task-nav-count">{pendingApprovals + (mailbox.unread[as] ?? 0)}</b>}</button>)}</nav><span className="muted">{workspace === 'explore' ? 'View transactions' : workspace === 'rules' ? 'Run actions and recurring checks' : 'Saved in your workspace'}</span></div>
      {(dashboard.error || prefsError || inspectError || loadError || rules.storageError) && <div className="rules-notice error" role="alert">{dashboard.error || prefsError || inspectError || loadError || rules.storageError}</div>}
      {workspace === 'rules' && rules.message && <div className="rules-notice" role="status">{rules.message}</div>}
      {workspace === 'rules' && editor !== null && rules.previewErrors.length > 0 && <div className="rules-notice error" role="alert">Some records could not be checked. <button onClick={rules.retry}>Retry failed checks</button></div>}
      {data?.disclosure && <div className="rules-notice scenario">{data.disclosure}</div>}
      {!data ? <main className="wizard-loading" role="status">{loadError || 'Loading transactions?'}</main> : <>
        <div className="workspace-page" hidden={workspace !== 'explore'}><Explore key={companyId} data={data} active={workspace === 'explore'} definition={definition} onChange={setDefinition} provider={exploreRule?.provider ?? provider} onInspect={inspect} onCreateRule={createRule} onRefresh={refreshExplore} editingRule={exploreRule?.name} onUpdateRule={updateRule} onLeaveRule={() => setExploreRule(null)} /></div>
        {workspace === 'dashboard' && <div className="insight-body"><Dashboard companyId={companyId} /></div>}
        {workspace === 'rules' && <RulesWorkspace c={rules} data={data} editor={editor} onEditor={setEditor} onInspect={inspect} onMessages={() => setWorkspace('messages')} onExplore={openRuleInExplore} onDemoSample={() => updatePrefs({ limit: -1 })} paymentRisk={null} />}
        {workspace === 'tasks' && <div className="workspace-body"><div className="workspace-center"><TaskBoard c={dashboard} onInspect={inspect} /></div></div>}
        {workspace === 'messages' && <div className="workspace-body"><div className="workspace-center"><Inbox mailbox={mailbox} as={as} pendingApprovals={pendingApprovals} onInspect={inspect} approvals={myDrafts.length ? myDrafts.map(message => <MessageCard key={message.id} message={message} actor={as} onDecide={rules.decideMessage} onRetry={rules.retryDraft} onOpen={inspect} />) : <p className="dashboard-empty">No drafts to approve. Rule message actions sent from you will appear here.</p>} /></div></div>}
      </>}
      {drawerRow && <Drawer row={drawerRow} reviewed={Boolean(drawerRow.dashboard?.reviewed)} onClose={() => setDrawerId(null)} rules={rules} readOnly={workspace === 'explore'} />}
      <Toasts notices={rules.store.notices.filter(notice => notice.companyId === companyId)} onDismiss={rules.markNoticeToasted} />
    </div>
  );
}
function Drawer({ row: r, reviewed, match, onClose, rules, readOnly }: { row: Row; reviewed: boolean; match?: { state: string; pMatch: number }; onClose: () => void; rules: ReturnType<typeof useRules>; readOnly: boolean }) {
  const kv = (o: Record<string, unknown> | null) =>
    o ? Object.entries(o).filter(([, v]) => v !== null && typeof v !== 'object') : [];
  return (
    <aside className="drawer" aria-label="Transaction detail">
      <div className="drawer-head">
        <div>
          <b>{r.vendor}</b>
          <div className="muted">{r.txnType === 'invoice' ? 'Customer invoice' : r.txnType === 'bank' ? 'Bank transaction' : r.txnType === 'bill' ? 'Vendor bill' : null}{r.txnType ? ' · ' : ''}{r.docNumber} · {r.billId}</div>
        </div>
        <button className="ghost" onClick={onClose} aria-label="Close detail">✕</button>
      </div>
      <div className="drawer-body">
        {!readOnly && rules.draft && rules.snapshots[r.id] && <><h3>Condition results · current draft</h3><RuleEvidence node={rules.draft.expression} snapshot={rules.snapshots[r.id]} /><h3>Actions for this result</h3>{actionsForOutcome(rules.draft, rules.snapshots[r.id].result).map(a => <p key={a.id}>{actionLabel(a)}</p>)}{!actionsForOutcome(rules.draft, rules.snapshots[r.id].result).length && <p className="muted">No actions configured for this result.</p>}</>}
        <RuleIssueList issues={rules.issues.filter(issue => issue.transactionId === r.id)} />
        {!readOnly && <SupportingDetails key={r.id} row={r} save={rules.addEvidence} busy={rules.busy} />}
        {r.dashboard && <><h3>Dashboard status · Saved in SQLite</h3><dl><dt>Status</dt><dd>{r.dashboard.reviewed ? 'Reviewed' : 'Needs review'}</dd><dt>Assigned to</dt><dd>{r.dashboard.owner || 'Unassigned'}</dd><dt>Flags</dt><dd>{r.dashboard.flags.join(', ') || 'None'}</dd><dt>Tags</dt><dd>{r.dashboard.tags.join(', ') || 'None'}</dd><dt>Tasks</dt><dd>{r.dashboard.taskIds.length}</dd></dl></>}
        {!readOnly && <details className="legacy-metadata"><summary>Edit assignment, flags & tags</summary><LocalStateEditor value={rules.store.transactions[r.id]} update={value => { void rules.updateLocal(r.id, value, r.sourceVersion); }} /></details>}
        {!readOnly && rules.store.messages.filter(message => message.items.some(item => item.transactionId === r.id)).map(message => <MessageCard key={message.id} message={message} actor={rules.actor} onDecide={rules.decideMessage} onRetry={rules.retryDraft} />)}
        {r.workspaceChanges && Object.keys(r.workspaceChanges).length > 0 && <><h3>Original source values</h3><dl>{r.workspaceChanges.account !== undefined && <><dt>Category</dt><dd>{r.workspaceChanges.account}</dd></>}{r.workspaceChanges.memo !== undefined && <><dt>Memo</dt><dd>{r.workspaceChanges.memo || '(blank)'}</dd></>}</dl></>}
        <h3>{r.txnType === 'invoice' ? 'Customer invoice' : r.txnType === 'bank' ? 'Bank transaction' : 'Bill'}</h3>
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
        {r.details && (<><h3>Details</h3><dl>{Object.entries(r.details).filter(([, v]) => v !== '').map(([k, v]) => (<Fragment key={k}><dt>{k.replace(/_/g, ' ')}</dt><dd>{String(v)}</dd></Fragment>))}</dl></>)}
        {r.evidence && (<><h3>Related records</h3>{r.evidence.length === 0 ? <p className="muted">No supporting records on file for this transaction.</p> : r.evidence.map((e) => (
          <dl key={e.id} className="line"><dt>{e.kind.replace(/_/g, ' ')}</dt><dd><b>{e.title}</b> · {e.date}<br />{e.text}</dd></dl>
        ))}</>)}
        {r.related && r.related.length > 0 && (<><h3>Nearby transactions from this counterparty</h3>{r.related.map((x) => (
          <dl key={x.id} className="line"><dt>{x.docNumber}</dt><dd>{x.date} · {money(x.amountCents)} · billed as {x.vendor}<br />{x.description || '(blank)'}{x.memo ? ` — ${x.memo}` : ''}</dd></dl>
        ))}</>)}
        <h3>{r.txnType === 'invoice' ? 'Customer payments' : 'Payments'}</h3>
        {r.payments.length === 0 ? <p className="muted">No payment applied.</p> : r.payments.map((p) => (
          <dl key={p.id} className="line"><dt>{p.id}</dt><dd>{p.date} · {money(p.amountCents)} from {p.account}</dd></dl>
        ))}
        <h3>{r.txnType === 'invoice' ? 'Customer' : r.txnType === 'bank' ? 'Counterparty' : 'Vendor'}</h3>
        <dl>{kv(r.vendorRecord).map(([k, v]) => (<Fragment key={k}><dt>{k}</dt><dd>{String(v)}</dd></Fragment>))}</dl>
        {r.projectRecord && (<><h3>Project</h3><dl>{kv(r.projectRecord).map(([k, v]) => (<Fragment key={k}><dt>{k}</dt><dd>{String(v)}</dd></Fragment>))}</dl></>)}
        <p className="muted small">Payments are shown as context only and are not counted as separate spend.</p>
      </div>
    </aside>
  );
}

function JevBadge({ jev, failed, provider }: { jev: JevStatus | null; failed: boolean; provider: Provider }) {
  const name = providerLabel(provider);
  if (!jev) return <span className="pill">{name}: checking…</span>;
  if (!jev.configured) return <span className="pill bad">{name}: not configured</span>;
  return (
    <span className={'pill ' + (failed ? 'bad' : 'ok')} title={`${jev.model} via ${jev.via}`}>
      {name}: {failed ? 'errors' : 'configured'} · {jev.via}
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
              <b>{c.name}{c.scenario && <em className="demo-tag">Modified demo scenario</em>}{c.synthetic && <em className="demo-tag">Synthetic extension</em>}</b>
              <span>{c.industry} · {c.billCount} {c.synthetic ? 'transactions' : 'bills'}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
