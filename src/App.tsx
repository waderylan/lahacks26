import { providerLabel, type Provider } from './modelContext';
import { Dashboard } from './Dashboard';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CompanyBills, CompanySummary, JevStatus, Row } from './types';
import { useRules } from './useRules';
import { EmployeeTabs, Inbox, type Folder } from './Inbox';
import { useMailbox } from './useMailbox';
import { employeeById } from './employees';
import { draftSender, uid, type Rule, type RuleNode } from './rules';
import { MessageCard, NotificationBell, Toasts } from './RulesPanel';
import { useWorkspace, type RowPatch } from './useWorkspace';
import { TaskBoard } from './TaskBoard';
import { Drawer } from './Drawer';
import { activityFeed, transactionTimeline, type ActivityEvent } from './activity';
import { Explore, emptyExplore } from './Explore';
import { RulesWorkspace } from './RulesWorkspace';
import { ALL_RECORDS, type RuleScope } from './ruleScope';
import type { SearchDefinition } from './savedSearchTypes';

const DEFAULT_COMPANY = 'company-101';

/** Preview records: -1 is the curated demo sample, 0 is every record in the company. */
const ROW_LIMITS = [-1, 0, 50, 100];
const param = (name: string) => new URLSearchParams(location.search).get(name);
const setParam = (name: string, value: string) => { const url = new URL(location.href); url.searchParams.set(name, value); history.replaceState(null, '', url); };
type Workspace = 'explore' | 'dashboard' | 'rules' | 'tasks' | 'messages';

export default function App() {
  const [companies, setCompanies] = useState<CompanySummary[]>([]);
  const [jev, setJev] = useState<JevStatus | null>(null);
  const [provider, setProvider] = useState<Provider>(() => param('model') === 'qwen' ? 'qwen' : 'jev');
  const changeProvider = (next: Provider) => { setParam('model', next); setProvider(next); };
  const [companyId, setCompanyState] = useState(() => param('company') ?? DEFAULT_COMPANY);
  const setCompanyId = (id: string) => { setParam('company', id); setCompanyState(id); };
  const [workspace, setWorkspaceState] = useState<Workspace>(() => {
    const selected = param('workspace');
    return selected === 'dashboard' || selected === 'rules' || selected === 'tasks' || selected === 'messages' ? selected : 'explore';
  });
  const setWorkspace = (next: Workspace) => { setParam('workspace', next); setWorkspaceState(next); };
  // Who you are: in the URL, so separate browser tabs can be signed in as different employees.
  const [as, setAsState] = useState(() => { const id = param('as'); return employeeById(id) ? id! : 'emp-ap'; });
  const setAs = (id: string) => { setParam('as', id); setAsState(id); };
  const [folder, setFolder] = useState<Folder>('inbox');
  const [definition, setDefinition] = useState<SearchDefinition>(emptyExplore);
  const [editor, setEditor] = useState<number | null>(null);
  const [exploreRule, setExploreRule] = useState<Rule | null>(null);
  useEffect(() => { setDefinition(emptyExplore()); setEditor(null); setExploreRule(null); }, [companyId]);
  const [drawerExtra, setDrawerExtra] = useState<Row | null>(null);
  const [data, setData] = useState<CompanyBills | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [prefsError, setPrefsError] = useState<string | null>(null);
  const [inspectError, setInspectError] = useState('');
  const [restoring, setRestoring] = useState(false);
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
  const dashboard = useWorkspace(companyId, updateRows, workspace === 'tasks' ? 3000 : 10_000);
  const rowLimit = prefs.limit;
  const updatePrefs = (p: Partial<typeof prefs>) => {
    void fetch('/api/settings', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(p) })
      .then(async response => { const body = await response.json(); if (!response.ok) throw new Error(body.error); setPrefs({ limit: body.limit }); setPrefsError(null); })
      .catch(error => setPrefsError(error.message));
  };

  useEffect(() => {
    fetch('/api/settings').then(async response => { if (!response.ok) throw new Error('Could not load display preferences.'); return response.json(); })
      .then(value => { setPrefs({ limit: value.limit }); setPrefsReady(true); setPrefsError(null); }).catch(error => { setPrefsError(error.message); setPrefsReady(true); });
    fetch('/api/companies').then((r) => r.json()).then((list: CompanySummary[]) => {
      setCompanies(list);
      // A company in the URL that is not offered falls back to the default.
      setCompanyState(id => list.some(company => company.companyId === id) ? id : list.some(company => company.companyId === DEFAULT_COMPANY) ? DEFAULT_COMPANY : list[0]?.companyId ?? id);
    }).catch(() => {});

  }, []);

  useEffect(() => { let live = true; setJev(null); fetch('/api/status?model=' + provider).then(r => r.json()).then(body => { if (live) setJev(body.jev); }).catch(() => {}); return () => { live = false; }; }, [provider]);

  // Load a company's records; never show another company's rows while loading.
  const loadSeq = useRef(0);
  const fetchBills = async () => {
    const response = await fetch(`/api/companies/${companyId}/bills?limit=${rowLimit}`);
    const body = await response.json();
    if (!response.ok) throw new Error(body.error ?? `HTTP ${response.status}`);
    return body as CompanyBills;
  };
  useEffect(() => {
    if (!prefsReady) return;
    const seq = ++loadSeq.current;
    setData(null);
    setLoadError(null);
    setDrawerId(null);
    setDrawerExtra(null);
    fetchBills().then(d => { if (seq === loadSeq.current) setData(d); })
      .catch((e: Error) => seq === loadSeq.current && setLoadError(e.message));
  }, [companyId, rowLimit, prefsReady]);

  const rows = data?.rows ?? [];
  const refreshAll = () => { void dashboard.refresh().catch(() => {}); void mailbox.refresh(); };
  const mailbox = useMailbox(companyId, as, workspace === 'messages' ? 2000 : 10_000);
  const rules = useRules(data?.company.companyId === companyId ? data : null, {
    previewEnabled: workspace === 'rules' && editor !== null, onRows: updateRows, onChange: refreshAll, actor: as, companyId,
    pollMs: workspace === 'explore' ? 10_000 : 2000, pageProvider: provider,
  });
  const companyDrafts = rules.store.messages.filter(message => message.companyId === companyId);
  // Only a draft's sender can act on it. Drafts from other senders stay visible, with who can approve them.
  const myDrafts = companyDrafts.filter(message => draftSender(message) === as);
  const otherDrafts = companyDrafts.filter(message => draftSender(message) !== as);
  const pendingApprovals = myDrafts.filter(message => message.status === 'pending').length;
  const company = data?.company ?? companies.find((c) => c.companyId === companyId);
  const drawerRow = rows.find((r) => r.id === drawerId) ?? (drawerExtra?.id === drawerId ? drawerExtra : null);
  const activity = useMemo(() => activityFeed({ companyId, history: rules.store.history, messages: rules.store.messages, runs: dashboard.runs, tasks: dashboard.tasks }),
    [companyId, rules.store.history, rules.store.messages, dashboard.runs, dashboard.tasks]);
  const inspect = (id: string) => {
    setInspectError('');
    if (rows.some(row => row.id === id)) { setDrawerId(id); return; }
    void fetch(`/api/companies/${companyId}/bills/${encodeURIComponent(id)}`).then(async response => {
      const row = await response.json(); if (!response.ok) throw new Error(row.error ?? 'Could not load transaction.');
      if (row.companyId === companyId) { setDrawerExtra(row); setDrawerId(id); }
    }).catch((error: Error) => setInspectError(error.message));
  };
  const refreshExplore = async () => {
    const seq = ++loadSeq.current;
    const body = await fetchBills();
    if (seq === loadSeq.current) setData(body);
  };
  const undoEvent = (event: ActivityEvent) => {
    if (event.undo?.kind === 'rule') void rules.undo(event.undo.entryId);
    else if (event.undo?.kind === 'receipt') void dashboard.undo(event.undo.planId, event.undo.billId).catch(() => {});
  };
  /** One complete company restore, then every part of the client re-reads its state. */
  const restoreCompany = async () => {
    setRestoring(true);
    try {
      const reply = await rules.restore();
      if (!reply) return false;
      setEditor(null); setExploreRule(null); setDefinition(emptyExplore()); setDrawerId(null); setDrawerExtra(null);
      await Promise.all([refreshExplore().catch((error: Error) => setLoadError(error.message)), dashboard.refresh().catch(() => {}), mailbox.refresh()]);
      return true;
    } finally { setRestoring(false); }
  };
  const createRule = (expression: RuleNode, scope: RuleScope) => {
    rules.setDraft({ id: uid(), companyId, name: 'Untitled rule', provider: exploreRule?.provider ?? provider, revision: 1, enabled: false, expression: structuredClone(expression), scope: { ...scope }, actions: [] });
    setEditor(1); setDrawerId(null); setWorkspace('rules');
  };
  const openRuleInExplore = (rule: Rule) => {
    setDefinition({ ...emptyExplore(), ...(rule.scope ?? ALL_RECORDS), expression: structuredClone(rule.expression) }); setExploreRule(structuredClone(rule)); setDrawerId(null); setWorkspace('explore');
  };
  const updateRule = (expression: RuleNode, scope: RuleScope) => { if (!exploreRule) return; rules.setDraft({ ...exploreRule, expression: structuredClone(expression), scope: { ...scope } }); setEditor(0); setDrawerId(null); setWorkspace('rules'); };
  const goTo = (target: 'tasks' | 'messages') => { if (target === 'messages') setFolder('approvals'); setWorkspace(target); };
  const openTasks = dashboard.tasks.filter(task => task.status === 'open').length;
  const notices = rules.store.notices.filter(notice => notice.companyId === companyId);
  const error = dashboard.error || prefsError || inspectError || loadError || rules.storageError;
  const approvalCard = (message: (typeof companyDrafts)[number]) => <MessageCard key={message.id} message={message} actor={as} onDecide={rules.decideMessage} onRetry={rules.retryDraft} onOpen={inspect} onSwitch={setAs} />;
  return (
    <div className="app" aria-busy={rules.busy || dashboard.busy}>
      <header className="toolbar">
        <h1>Transaction Review</h1>
        <CompanyPicker companies={companies} value={companyId} onChange={id => id !== companyId && setCompanyId(id)} />
        <div className="active-company">
          <strong>{company?.name ?? '…'}</strong>
          <span>{company?.industry}</span>
        </div>
        <div className="spacer" />
        <label className="rows-pick" title="Which records Explore and the rule preview load. Running a rule on all records ignores this.">
          Preview records
          <select value={rowLimit} onChange={(e) => updatePrefs({ limit: Number(e.target.value) })} aria-label="Rows to load">
            {ROW_LIMITS.map((n) => <option key={n} value={n}>{n === 0 ? 'All records' : n === -1 ? 'Curated demo sample' : n}</option>)}
          </select>
        </label>
        {data?.sampled && (
          <span className="pill sample" title={data.curatedSample ? 'A hand-picked set of records that shows each starter rule' : 'Records are sampled evenly across the year'}>
            Sample: {data.rows.length} of {data.totalBills} transactions
          </span>
        )}
        {(workspace === 'explore' || workspace === 'rules') && <label className="rows-pick">Explore / new rule model <select aria-label="Evaluation model" title="Saved rules use their recorded provider. Switching preserves the current search and unsaved rule." value={provider} onChange={event => changeProvider(event.target.value as Provider)}><option value="jev">Jev</option><option value="qwen">Qwen</option></select></label>}
        <JevBadge jev={jev} provider={provider} />
        <EmployeeTabs value={as} unread={mailbox.unread} onChange={setAs} />
        <NotificationBell notices={notices} onRead={rules.markNoticesRead} onOpen={inspect} />
      </header>

      <div className="workspace-nav"><nav aria-label="Workspace">{(['explore', 'rules', 'dashboard', 'tasks', 'messages'] as const).map(value => <button key={value} className={workspace === value ? 'on' : ''} aria-current={workspace === value ? 'page' : undefined} onClick={() => { setDrawerId(null); setWorkspace(value); }}>{{ explore: 'Explore', dashboard: 'Dashboard', rules: 'Rules', tasks: 'Tasks & activity', messages: 'Messages' }[value]}{value === 'tasks' && openTasks > 0 && <b className="task-nav-count">{openTasks}</b>}{value === 'messages' && pendingApprovals + (mailbox.unread[as] ?? 0) > 0 && <b className="task-nav-count">{pendingApprovals + (mailbox.unread[as] ?? 0)}</b>}</button>)}</nav><span className="muted">{{ explore: 'Find and inspect transactions', dashboard: 'Saved charts and company totals', rules: 'Preview, run and keep checking', tasks: 'Tasks and everything that happened', messages: 'Approvals and internal messages' }[workspace]}</span></div>
      {error && <div className="rules-notice error" role="alert">{error}</div>}
      {workspace === 'rules' && rules.message && <div className="rules-notice" role="status">{rules.message}</div>}
      {workspace === 'rules' && editor !== null && rules.previewErrors.length > 0 && <div className="rules-notice error" role="alert">Some records could not be checked. <button onClick={rules.retry}>Retry failed checks</button></div>}
      {data?.disclosure && <div className="rules-notice scenario">{data.disclosure}</div>}
      {!data ? <main className="wizard-loading" role="status">{loadError || 'Loading transactions…'}</main> : <>
        <div className="workspace-page" hidden={workspace !== 'explore'}><Explore key={companyId} data={data} active={workspace === 'explore'} provider={exploreRule?.provider ?? provider} definition={definition} onChange={setDefinition} onInspect={inspect} onCreateRule={createRule} onRefresh={refreshExplore} editingRule={exploreRule?.name} onUpdateRule={updateRule} onLeaveRule={() => setExploreRule(null)} onOpenRules={() => setWorkspace('rules')} /></div>
        {workspace === 'dashboard' && <div className="insight-body"><Dashboard companyId={companyId} /></div>}
        {workspace === 'rules' && <RulesWorkspace c={rules} data={data} editor={editor} onEditor={setEditor} onInspect={inspect} onMessages={() => goTo('messages')} onActivity={() => setWorkspace('tasks')} onExplore={openRuleInExplore} onDemoSample={() => updatePrefs({ limit: -1 })} onRestore={restoreCompany} restoring={restoring} />}
        {workspace === 'tasks' && <div className="workspace-body tasks-workspace"><TaskBoard c={dashboard} as={as} activity={activity} transactionOwner={id => rows.find(row => row.id === id)?.dashboard?.owner} onInspect={inspect} onUndo={undoEvent} busy={dashboard.busy || rules.busy} /></div>}
        {workspace === 'messages' && <div className="workspace-body"><div className="workspace-center"><Inbox mailbox={mailbox} as={as} pendingApprovals={pendingApprovals} folder={folder} onFolder={setFolder} onInspect={inspect} approvals={companyDrafts.length ? <>
          {myDrafts.length > 0 && <section aria-label="Waiting on you"><h3>Sent from {employeeById(as)?.name ?? 'you'}</h3>{myDrafts.map(approvalCard)}</section>}
          {otherDrafts.length > 0 && <section aria-label="Waiting on others"><h3>Sent from other employees</h3><p className="small muted">You cannot approve these as {employeeById(as)?.name ?? 'this employee'}. Switch to the sender to approve.</p>{otherDrafts.map(approvalCard)}</section>}
        </> : <p className="dashboard-empty">No drafts yet. Add a Draft internal message action to a rule and run it.</p>} /></div></div>}
      </>}
      {drawerRow && <Drawer row={drawerRow} rules={rules} readOnly={workspace === 'explore'} tasks={dashboard.tasks.filter(task => task.billId === drawerRow.id)} timeline={transactionTimeline(activity, drawerRow.id)} actor={as} busy={dashboard.busy || rules.busy}
        onClose={() => setDrawerId(null)} onUndo={undoEvent} onReview={reviewed => { void dashboard.review([drawerRow.id], reviewed, drawerRow.sourceVersion ? { [drawerRow.id]: drawerRow.sourceVersion } : undefined).catch(() => {}); }} onGoTo={goTo} onSwitch={setAs} />}
      <Toasts notices={notices} onDismiss={rules.markNoticeToasted} />
    </div>
  );
}

/** Shows "configured" rather than "connected": a credential is present, but no request has proven the connection. */
function JevBadge({ jev, provider }: { jev: JevStatus | null; provider: Provider }) {
  const name = providerLabel(provider);
  if (!jev) return <span className="pill">{name}: checking…</span>;
  if (!jev.configured) return <span className="pill bad">{name}: not configured</span>;
  return <span className="pill ok" title={`${jev.model} via ${jev.via}. A key is configured; the first successful check confirms the connection.`}>{name}: configured · {jev.via}</span>;
}

function CompanyPicker({ companies, value, onChange }: { companies: CompanySummary[]; value: string; onChange: (id: string) => void }) {
  return (
    <label className="picker">
      <span className="sr-only">Company</span>
      <select aria-label="Company" value={value} onChange={event => onChange(event.target.value)}>
        {!companies.some(company => company.companyId === value) && <option value={value}>{value}</option>}
        {companies.map(c => <option key={c.companyId} value={c.companyId}>{c.name} · {c.industry} · {c.billCount} transactions</option>)}
      </select>
    </label>
  );
}
