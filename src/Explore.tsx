import { useMemo, useState } from 'react';
import type { CompanyBills } from './types';
import { ConditionEditor, conditionText } from './ConditionEditor';
import { useConditionPreview } from './useConditionPreview';
import { useSavedViews } from './useSavedViews';
import type { SavedSearch, SearchDefinition } from './savedSearchTypes';
import { inScope, type RuleScope } from './ruleScope';
import { leaves, uid, validateRule, type RuleNode } from './rules';
import { ResultBadge } from './RulesPanel';
import './explore.css';

export const emptyExplore = (): SearchDefinition => ({ query: '', type: 'all', status: 'all', assignee: 'all', tab: 'all', matchesOnly: false, sort: { key: 'date', dir: 1 } });
export const viewExpression = (view: SearchDefinition): RuleNode => view.expression ?? { id: '_view_root_', type: 'all', children: [{ id: '_view_condition_', type: 'ai', text: view.query, label: '' }] };
export const viewScope = (view: SearchDefinition): RuleScope => ({ type: view.type, status: view.status === 'all' && view.tab !== 'all' ? view.tab === 'reviewed' ? 'reviewed' : 'needs_review' : view.status, assignee: view.assignee });
const money = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });
const signature = (view: SearchDefinition) => JSON.stringify(view);

export function Explore({ data, active, definition, onChange, onInspect, onCreateRule, onRefresh, editingRule, onUpdateRule, onLeaveRule }: {
  data: CompanyBills; active: boolean; definition: SearchDefinition; onChange: (view: SearchDefinition) => void;
  onInspect: (id: string) => void; onCreateRule: (expression: RuleNode, scope: RuleScope) => void;
  onRefresh: () => Promise<void>; editingRule?: string; onUpdateRule: (expression: RuleNode, scope: RuleScope) => void; onLeaveRule: () => void;
}) {
  const views = useSavedViews(data.company.companyId);
  const [opened, setOpened] = useState<SavedSearch | undefined>();
  const [name, setName] = useState('');
  const [naming, setNaming] = useState(false);
  const [notice, setNotice] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [text, setText] = useState('');
  const expression = useMemo(() => viewExpression(definition), [definition.expression, definition.query]);
  const conditions = leaves(expression);
  const blank = conditions.length === 1 && conditions[0].type === 'ai' && !conditions[0].text.trim();
  const errors = blank ? [] : validateRule({ id: '_preview_', companyId: data.company.companyId, name: 'Preview', revision: 1, enabled: false, expression, actions: [{ id: '_preview_action_', type: 'pass', value: '' }] });
  const scope = viewScope(definition);
  const scoped = useMemo(() => ({ ...data, rows: data.rows.filter(row => inScope(row, viewScope(definition))) }), [data, definition.type, definition.status, definition.assignee, definition.tab]);
  const preview = useConditionPreview(scoped, blank || errors.length ? null : expression, active);
  const filtered = scoped.rows.filter(row => (!definition.matchesOnly || blank || preview.snapshots[row.id]?.result === 'true')
    && (!definition.result || definition.result === 'all' || preview.snapshots[row.id]?.result === definition.result)
    && (!text.trim() || [row.vendor, row.billId, row.description, row.memo, row.account].join(' ').toLowerCase().includes(text.trim().toLowerCase())));
  const rows = [...filtered].sort((a, b) => {
    if (definition.sort.key === 'match' && !blank) { const rank = (id: string) => ({ true: 0, uncertain: 1, false: 2, pending: 3, error: 4 })[preview.snapshots[id]?.result ?? 'pending']; const difference = rank(a.id) - rank(b.id); if (difference) return difference * definition.sort.dir; }
    const key = definition.sort.key === 'match' ? 'date' : definition.sort.key;
    const av = a[key], bv = b[key];
    return (av < bv ? -1 : av > bv ? 1 : a.id.localeCompare(b.id)) * definition.sort.dir;
  });
  const owners = [...new Set([...data.rows.map(row => row.dashboard?.owner ?? ''), ...(definition.assignee !== 'all' && definition.assignee !== 'unassigned' ? [definition.assignee] : [])].filter(Boolean))].sort();
  const update = (patch: Partial<SearchDefinition>) => onChange({ ...definition, ...patch });
  const open = (view: SavedSearch) => { onLeaveRule(); setOpened(view); setName(view.name); onChange(structuredClone(view.definition)); setText(''); setNotice(`Opened “${view.name}”. Results use current records.`); };
  const save = async (previous?: SavedSearch) => {
    try {
      const value = blank ? { ...definition, query: '', expression: undefined } : definition;
      const result = await views.save(name, value, previous);
      if (result?.search) { setOpened(result.search); setNaming(false); setNotice('View saved. It does not run actions or recurring checks.'); }
    } catch (error) { setNotice((error as Error).message); }
  };
  const refresh = async () => { setRefreshing(true); try { await onRefresh(); preview.retry(); setNotice('Records refreshed. Unchanged evidence reuses saved Jev results.'); } catch (error) { setNotice((error as Error).message); } finally { setRefreshing(false); } };
  if (!active) return null;
  return <main className="explore-workspace" aria-label="Explore transactions">
    <header className="workspace-heading"><div><h1>Explore</h1><p>Find and inspect transactions. Save a view to return to it, or create a rule to take action.</p></div><button onClick={() => { onLeaveRule(); onChange(emptyExplore()); setOpened(undefined); setName('');  setText(''); setNotice(''); }}>New view</button></header>
    <div className="explore-layout">
      <aside className="saved-views" aria-label="Saved views"><h2>Saved views <span>{views.searches.length}</span></h2><p>Saved conditions and filters. Open a view to check current records.</p>
        {!views.ready && !views.error && <p role="status">Loading views…</p>}{views.error && <p role="alert">{views.error}</p>}
        {views.ready && !views.searches.length && <p>No saved views yet.</p>}
        {views.searches.map(view => <div className={`saved-view ${opened?.id === view.id ? 'current' : ''}`} key={view.id}><button onClick={() => open(view)}>{view.name}</button><small>{view.definition.expression ? `${leaves(view.definition.expression).length} conditions` : view.definition.query ? '1 condition' : 'Filters only'} · {view.definition.type === 'all' ? 'All types' : view.definition.type}</small>{view.monitoringRetired && <small>Recurring search paused. Create a rule to keep checking.</small>}{opened?.id === view.id && <button className="ghost" disabled={views.busy} onClick={async () => { try { await views.remove(view); setOpened(undefined); setNotice('Saved view deleted.'); } catch (error) { setNotice((error as Error).message); } }}>Delete saved view</button>}</div>)}
        <p className="view-rule-hint">Need recurring checks or assignments? Create a rule.</p>
      </aside>
      <section className="explore-content">
        <div className="view-title"><h2>{opened?.name ?? 'Unsaved view'}{opened && signature(opened.definition) !== signature(definition) && <small>Unsaved changes</small>}</h2><div className="view-buttons"><button disabled={views.busy || Boolean(errors.length)} onClick={() => { setName(opened?.name ?? ''); setNaming(true); }}>Save view</button><button className="primary" disabled={blank || Boolean(errors.length)} onClick={() => onCreateRule(structuredClone(expression), scope)}>Create rule</button></div></div>
        {naming && <form className="view-save" onSubmit={event => { event.preventDefault(); void save(opened); }}><label>View name<input aria-label="View name" value={name} maxLength={80} required onChange={event => setName(event.target.value)} autoFocus /></label><button className="primary" disabled={views.busy}> {opened ? 'Update view' : 'Save new view'}</button>{opened && <button type="button" disabled={views.busy} onClick={() => { void save(); }}>Save as new view</button>}<button type="button" onClick={() => setNaming(false)}>Cancel</button></form>}
        {notice && <p className="explore-notice" role="status">{notice}</p>}
        {editingRule && <div className="explore-rule-source"><span>Trying conditions from “{editingRule}”. The saved rule stays as it is until you save changes in Rules.</span><button disabled={blank || Boolean(errors.length)} onClick={() => onUpdateRule(structuredClone(expression), scope)}>Use these conditions in rule</button></div>}
        <div className="explore-filters"><label>Type<select aria-label="Explore type" value={definition.type} onChange={event => update({ type: event.target.value as SearchDefinition['type'] })}><option value="all">All types</option><option value="bill">Vendor bills</option><option value="invoice">Customer invoices</option><option value="bank">Bank transactions</option></select></label><label>Status<select aria-label="Explore status" value={scope.status} onChange={event => update({ status: event.target.value as SearchDefinition['status'], tab: 'all' })}><option value="all">Any status</option><option value="needs_review">Needs review</option><option value="reviewed">Reviewed</option><option value="flagged">Flagged</option></select></label><label>Assigned to<select aria-label="Explore assignee" value={definition.assignee} onChange={event => update({ assignee: event.target.value })}><option value="all">Anyone</option><option value="unassigned">Unassigned</option>{owners.map(owner => <option key={owner}>{owner}</option>)}</select></label></div>
        <details className="explore-conditions" open><summary>Conditions <span>Combine with AND, OR, or NOT</span></summary><div className="condition-editor"><ConditionEditor expression={expression} data={data} onChange={value => update({ expression: value, query: '' })} /></div><p className="muted">AND requires every condition. OR requires one. NOT reverses a result; missing information stays uncertain.</p>{blank && <p className="muted">Leave conditions empty to browse. Add a condition before creating a rule.</p>}{Boolean(errors.length) && <p role="status" className="wizard-validation">{errors.join(' ')}</p>}</details>
        <div className="explore-results-heading"><div><h2>Results</h2><p aria-label="Explore check progress">{blank ? `${scoped.rows.length} transactions in scope` : `${preview.evaluated}/${scoped.rows.length} checked${preview.evaluated === scoped.rows.length && !errors.length ? ' · Complete' : ''}`}</p></div><button disabled={refreshing} onClick={() => { void refresh(); }}>{refreshing ? 'Refreshing…' : 'Refresh records'}</button></div>
        <p className="cache-explanation">Jev results are saved. Reopening a view reuses results for unchanged evidence; updated records are checked again.</p>
        {preview.previewErrors.length > 0 && <p role="alert">Some records could not be checked. {preview.previewErrors.join(' ')} <button onClick={preview.retry}>Retry failed checks</button></p>}
        <p className="cache-explanation">Create rule copies conditions and record filters. Result display and sorting only affect this view.</p><div className="explore-result-filters"><label>Results<select aria-label="Explore result" value={definition.matchesOnly ? 'true' : definition.result ?? 'all'} onChange={event => { update({ matchesOnly: event.target.value === 'true', result: event.target.value as SearchDefinition['result'] }); }}><option value="all">All results</option><option value="true">Matches</option><option value="uncertain">Not enough information</option><option value="false">No match</option></select></label><label>Find in results<input aria-label="Find in results" value={text} onChange={event => setText(event.target.value)} placeholder="Name, memo, or transaction ID" /></label><label>Sort<select aria-label="Explore sort" value={definition.sort.key} onChange={event => update({ sort: { key: event.target.value as SearchDefinition['sort']['key'], dir: 1 } })}><option value="match">Result</option><option value="date">Date</option><option value="vendor">Counterparty</option><option value="account">Category</option><option value="amountCents">Amount</option></select></label><button aria-label="Reverse sort" onClick={() => update({ sort: { ...definition.sort, dir: definition.sort.dir === 1 ? -1 : 1 } })}>{definition.sort.dir === 1 ? 'Ascending ↑' : 'Descending ↓'}</button></div>
        <div className="explore-table-wrap"><table className="explore-table" aria-label="Explore results"><thead><tr><th>Date</th><th>Transaction</th><th>Description and memo</th><th>Category</th><th>Amount</th><th>Result</th><th>Assigned to / flags</th></tr></thead><tbody>{rows.map(row => <tr key={row.id} data-id={row.id}><td>{row.date}</td><td><button onClick={() => onInspect(row.id)}>{row.vendor}</button><small>{row.txnType ?? 'bill'} · {row.docNumber || row.billId}</small></td><td><p>{row.description || '(No description)'}</p><small>{row.memo}</small></td><td>{row.account}</td><td className="num">{money.format(row.amountCents / 100)}</td><td>{blank ? <span className="muted">No conditions</span> : <details><summary><ResultBadge value={preview.snapshots[row.id]?.result ?? 'pending'} /></summary>{leaves(expression).map(node => <p className="explore-leaf-result" key={node.id}><span>{conditionText(node)}</span><ResultBadge value={preview.snapshots[row.id]?.conditions[node.id] ?? 'pending'} /></p>)}</details>}</td><td><span>{row.dashboard?.owner || 'Unassigned'}</span>{row.dashboard?.flags.map(flag => <small key={flag} className="tag warn">{flag}</small>)}</td></tr>)}</tbody></table></div>
        {!rows.length && <p className="explore-empty">No transactions in this view. Change the conditions or filters.</p>}
        <p className="explore-footnote">{rows.length} shown · {data.rows.length} loaded{data.sampled ? ` of ${data.totalBills} company transactions. Choose All records above to widen the preview.` : ''}. Viewing and saving never run actions.</p>
      </section>
    </div>
  </main>;
}
