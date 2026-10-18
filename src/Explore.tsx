import { scoreLabel, type Provider } from './modelContext';
import { useEvaluationContext } from './useEvaluationContext';
import { useVoice } from './useVoice';
import { arrangeRows, sortByMatch } from './arrange';
import { changeSimpleQuery, singleCondition, usesCombinedConditions } from './exploreQuery';
import { useMemo, useState } from 'react';
import type { CompanyBills } from './types';
import { ConditionEditor, conditionText } from './ConditionEditor';
import { useConditionPreview } from './useConditionPreview';
import { useSavedViews } from './useSavedViews';
import type { SavedSearch, SearchDefinition } from './savedSearchTypes';
import { inScope, type RuleScope } from './ruleScope';
import { leaves, validateRule, type RuleNode } from './rules';
import { ResultBadge } from './RulesPanel';
import { ConditionScores } from './ConditionScores';
import { STARTER_DEMOS } from './ruleStarterDemos';
import { rulePresets } from './rules';
import { ownerLabel, ownerOptions } from './employees';
import { money } from './format';
import './explore.css';

export const emptyExplore = (): SearchDefinition => ({ query: '', type: 'all', status: 'all', assignee: 'all', tab: 'all', matchesOnly: false, sort: { key: 'match', dir: -1 } });
export const viewExpression = (view: SearchDefinition): RuleNode => view.expression ?? { id: '_view_root_', type: 'all', children: [{ id: '_view_condition_', type: 'ai', text: view.query, label: '' }] };
export const viewScope = (view: SearchDefinition): RuleScope => ({ type: view.type, status: view.status === 'all' && view.tab !== 'all' ? view.tab === 'reviewed' ? 'reviewed' : 'needs_review' : view.status, assignee: view.assignee });
const signature = (view: SearchDefinition) => JSON.stringify(view);

export function Explore({ data, active, definition, onChange, onInspect, onCreateRule, onRefresh, editingRule, onUpdateRule, onLeaveRule, onOpenRules, provider = 'jev' }: {
  provider?: Provider;
  data: CompanyBills; active: boolean; definition: SearchDefinition; onChange: (view: SearchDefinition) => void;
  onInspect: (id: string) => void; onCreateRule: (expression: RuleNode, scope: RuleScope) => void;
  onRefresh: () => Promise<void>; editingRule?: string; onUpdateRule: (expression: RuleNode, scope: RuleScope) => void; onLeaveRule: () => void; onOpenRules: () => void;
}) {
  const views = useSavedViews(data.company.companyId, active);
  const [opened, setOpened] = useState<SavedSearch | undefined>();
  const [name, setName] = useState('');
  const [naming, setNaming] = useState(false);
  const [notice, setNotice] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [text, setText] = useState('');
  const [confidenceId, setConfidenceId] = useState('');
  const expression = useMemo(() => viewExpression(definition), [definition.expression, definition.query]);
  const conditions = leaves(expression);
  const simple = singleCondition(expression);
  const combined = usesCombinedConditions(definition, expression);
  const english = conditions.filter(node => node.type === 'ai');
  const confidenceCondition = english.find(node => node.id === confidenceId) ?? english[0];
  const confidenceNumber = confidenceCondition ? conditions.findIndex(node => node.id === confidenceCondition.id) + 1 : 0;
  const blank = Boolean(simple && !simple.text.trim());
  const errors = blank ? [] : validateRule({ id: '_preview_', companyId: data.company.companyId, name: 'Preview', revision: 1, enabled: false, expression, actions: [{ id: '_preview_action_', type: 'pass', value: '' }] });
  const scope = viewScope(definition);
  const scoped = useMemo(() => ({ ...data, rows: data.rows.filter(row => inScope(row, viewScope(definition))) }), [data, definition.type, definition.status, definition.assignee, definition.tab]);
  const evaluation = useEvaluationContext(provider);
  const preview = useConditionPreview(scoped, blank || errors.length ? null : expression, active && Boolean(evaluation.context), 1000, evaluation.context);
  const voiceText = (value: string) => { if (active && !combined) onChange(changeSimpleQuery(definition, expression, value.slice(0, 500))); };
  const voice = useVoice(voiceText, voiceText);
  const filtered = scoped.rows.filter(row => (!definition.matchesOnly || blank || preview.snapshots[row.id]?.result === 'true')
    && (blank || !definition.result || definition.result === 'all' || preview.snapshots[row.id]?.result === definition.result)
    && (!text.trim() || [row.vendor, row.billId, row.description, row.memo, row.account].join(' ').toLowerCase().includes(text.trim().toLowerCase())));
  const baseRows = [...filtered].sort((a, b) => {
    const key = definition.sort.key === 'match' ? 'date' : definition.sort.key;
    const av = a[key], bv = b[key];
    return (av < bv ? -1 : av > bv ? 1 : a.id.localeCompare(b.id)) * (definition.sort.key === 'match' ? 1 : definition.sort.dir);
  });
  const probability = (id: string) => confidenceCondition ? preview.probabilities[id]?.[confidenceCondition.id] : undefined;
  const sorted = definition.sort.key === 'match' && !blank ? sortByMatch(baseRows, id => {
    const value = probability(id);
    return value === undefined ? undefined : { state: 'match', pMatch: value };
  }, definition.sort.dir) : baseRows;
  const rows = arrangeRows(sorted, id => preview.snapshots[id]?.result === 'true', !blank);
  const matchCount = scoped.rows.filter(row => preview.snapshots[row.id]?.result === 'true').length;
  const uncertainCount = scoped.rows.filter(row => preview.snapshots[row.id]?.result === 'uncertain').length;
  const owners = ownerOptions([...data.rows.map(row => row.dashboard?.owner), ...(definition.assignee !== 'all' && definition.assignee !== 'unassigned' ? [definition.assignee] : [])]);
  const typeCounts = { bill: 0, invoice: 0, bank: 0 };
  for (const row of data.rows) typeCounts[row.txnType ?? 'bill']++;
  const demo = STARTER_DEMOS[data.company.companyId];
  const demoPreset = demo && rulePresets(true).find(preset => preset.id === demo.presetId);
  const update = (patch: Partial<SearchDefinition>) => onChange({ ...definition, ...patch });
  const open = (view: SavedSearch) => { onLeaveRule(); setOpened(view); setConfidenceId(''); setName(view.name); onChange(structuredClone(view.definition)); setText(''); setNotice(`Opened “${view.name}”. Results use current records.`); };
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
    <header className="workspace-heading"><div><h1>Explore</h1><p>Find and inspect transactions. Save a view to return to it, or create a rule to take action.</p></div><button onClick={() => { onLeaveRule(); onChange(emptyExplore()); setOpened(undefined); setConfidenceId(''); setName('');  setText(''); setNotice(''); }}>New view</button></header>
    {demo && demoPreset && <section className="explore-suggestion" aria-label="Suggested starting point"><p><b>Suggested for {data.company.name}:</b> the {demoPreset.name} starter. {demo.note}</p><div><button onClick={() => onInspect(`${data.company.companyId}:${demo.rowId}`)}>Inspect example</button><button onClick={onOpenRules}>Open starter in Rules</button></div></section>}
    <div className="explore-layout">
      <aside className="saved-views" aria-label="Saved views"><h2>Saved views <span>{views.searches.length}</span></h2><p>Saved conditions and filters. Open a view to check current records.</p>
        {!views.ready && !views.error && <p role="status">Loading views…</p>}{views.error && <p role="alert">{views.error}</p>}
        {views.ready && !views.searches.length && <p>No saved views yet.</p>}
        {views.searches.map(view => <div className={`saved-view ${opened?.id === view.id ? 'current' : ''}`} key={view.id}><button onClick={() => open(view)}>{view.name}</button><small>{view.definition.expression ? `${leaves(view.definition.expression).length} conditions` : view.definition.query ? '1 condition' : 'Filters only'} · {view.definition.type === 'all' ? 'All types' : view.definition.type}</small>{opened?.id === view.id && <button className="ghost" disabled={views.busy} onClick={async () => { try { await views.remove(view); setOpened(undefined); setNotice('Saved view deleted.'); } catch (error) { setNotice((error as Error).message); } }}>Delete saved view</button>}</div>)}
        <p className="view-rule-hint">Need recurring checks or assignments? Create a rule.</p>
      </aside>
      <section className="explore-content">
        <div className="view-title"><h2>{opened?.name ?? 'Unsaved view'}{opened && signature(opened.definition) !== signature(definition) && <small>Unsaved changes</small>}</h2><div className="view-buttons"><button disabled={views.busy || Boolean(errors.length)} onClick={() => { setName(opened?.name ?? ''); setNaming(true); }}>Save view</button><button className="primary" disabled={blank || Boolean(errors.length)} onClick={() => onCreateRule(structuredClone(expression), scope)}>Create rule</button></div></div>
        {opened && <section className="explore-view-parameters" aria-label="Current view parameters"><h3>Showing results for</h3><p className="view-search-parameter">{blank ? 'All transactions in these filters' : simple?.text ?? conditionText(expression)}</p><dl>
          <div><dt>Type</dt><dd>{{ all: 'All types', bill: 'Vendor bills', invoice: 'Customer invoices', bank: 'Bank transactions' }[scope.type]}</dd></div>
          <div><dt>Status</dt><dd>{{ all: 'Any status', needs_review: 'Needs review', reviewed: 'Reviewed', flagged: 'Flagged' }[scope.status]}</dd></div>
          <div><dt>Assigned to</dt><dd>{scope.assignee === 'all' ? 'Anyone' : scope.assignee === 'unassigned' ? 'Unassigned' : ownerLabel(scope.assignee)}</dd></div>
          <div><dt>Results</dt><dd>{blank ? 'All results (no search)' : definition.matchesOnly || definition.result === 'true' ? 'Matches' : definition.result === 'uncertain' ? 'Not enough information' : definition.result === 'false' ? 'No match' : 'All results'}</dd></div>
          <div><dt>Sort</dt><dd>{definition.sort.key === 'match' ? definition.sort.dir === -1 ? 'Highest confidence first' : 'Lowest confidence first' : `${{ date: 'Date', vendor: 'Counterparty', account: 'Category', amountCents: 'Amount' }[definition.sort.key]} · ${definition.sort.dir === 1 ? 'ascending' : 'descending'}`}</dd></div>
          <div><dt>Preview</dt><dd>{data.rows.length} loaded{data.sampled ? ` of ${data.totalBills}` : ''}</dd></div>
          {combined && confidenceCondition && <div><dt>Sort scores for</dt><dd>Condition {confidenceNumber}{confidenceCondition.label ? `: ${confidenceCondition.label}` : ''}</dd></div>}
          {text.trim() && <div><dt>Text filter</dt><dd>{text}</dd></div>}
        </dl></section>}
        {naming && <form className="view-save" onSubmit={event => { event.preventDefault(); void save(opened); }}><label>View name<input aria-label="View name" value={name} maxLength={80} required onChange={event => setName(event.target.value)} autoFocus /></label><button className="primary" disabled={views.busy}> {opened ? 'Update view' : 'Save new view'}</button>{opened && <button type="button" disabled={views.busy} onClick={() => { void save(); }}>Save as new view</button>}<button type="button" onClick={() => setNaming(false)}>Cancel</button></form>}
        {notice && <p className="explore-notice" role="status">{notice}</p>}
        {editingRule && <div className="explore-rule-source"><span>Trying conditions from “{editingRule}”. The saved rule stays as it is until you save changes in Rules.</span><button disabled={blank || Boolean(errors.length)} onClick={() => onUpdateRule(structuredClone(expression), scope)}>Use these conditions in rule</button></div>}
        {!combined && <section className="explore-search" aria-label="Live transaction search"><label htmlFor="explore-query">Search transactions</label><div className="explore-search-bar"><input id="explore-query" aria-label="Search transactions" autoComplete="off" maxLength={500} value={simple?.text ?? ''} placeholder="Purchases for tools or equipment" onChange={event => onChange(changeSimpleQuery(definition, expression, event.target.value))} />{voice.supported && <button type="button" className={`mic${voice.listening ? ' listening' : ''}`} aria-label={voice.listening ? 'Stop listening' : 'Search by voice'} aria-pressed={voice.listening} title="Dictate a transaction search" onClick={voice.listening ? voice.stop : voice.start}>{voice.listening ? 'Stop' : 'Mic'}</button>}{!blank && <button className="ghost" onClick={() => onChange(changeSimpleQuery(definition, expression, ''))}>Clear search</button>}</div><div className="explore-search-help"><span>Checks start after a one-second pause in typing. Matches are highlighted and move to the top.</span><button onClick={() => update({ mode: 'combined', expression: structuredClone(expression), query: '' })}>Combine conditions</button></div></section>}
        <div className="explore-type-counts" aria-label="Transactions by type"><button className={definition.type === 'all' ? 'on' : ''} onClick={() => update({ type: 'all' })}>All <b>{data.rows.length}</b></button>{([['bill', 'Vendor bills'], ['invoice', 'Customer invoices'], ['bank', 'Bank transactions']] as const).map(([type, label]) => <button key={type} className={definition.type === type ? 'on' : ''} onClick={() => update({ type })}>{label} <b>{typeCounts[type]}</b></button>)}</div>
        <div className="explore-filters"><label>Type<select aria-label="Explore type" value={definition.type} onChange={event => update({ type: event.target.value as SearchDefinition['type'] })}><option value="all">All types</option><option value="bill">Vendor bills</option><option value="invoice">Customer invoices</option><option value="bank">Bank transactions</option></select></label><label>Status<select aria-label="Explore status" value={scope.status} onChange={event => update({ status: event.target.value as SearchDefinition['status'], tab: 'all' })}><option value="all">Any status</option><option value="needs_review">Needs review</option><option value="reviewed">Reviewed</option><option value="flagged">Flagged</option></select></label><label>Transaction owner<select aria-label="Explore assignee" value={definition.assignee} onChange={event => update({ assignee: event.target.value })}><option value="all">Anyone</option><option value="unassigned">Unassigned</option>{owners.map(owner => <option key={owner.value} value={owner.value}>{owner.label}</option>)}</select></label></div>
        {combined && <section className="explore-conditions" aria-label="Combined conditions"><div className="explore-combined-heading"><h3>Combine conditions</h3><button disabled={!simple} title={!simple ? 'Keep one English condition to return to simple search.' : undefined} onClick={() => update({ mode: 'simple' })}>Use simple search</button></div><div className="condition-editor"><ConditionEditor expression={expression} data={data} onChange={value => update({ expression: value, query: '' })} /></div><p className="muted">AND requires every condition. OR requires one. NOT reverses a result; missing information stays uncertain.</p>{blank && <p className="muted">Leave conditions empty to browse. Add a condition before creating a rule.</p>}{Boolean(errors.length) && <p role="status" className="wizard-validation">{errors.join(' ')}</p>}</section>}
        <div className="explore-results-heading"><div><h2>Results</h2><p aria-label="Explore check progress">{blank ? `${scoped.rows.length} transactions in scope` : `${preview.evaluated}/${scoped.rows.length} checked${preview.evaluated === scoped.rows.length && !errors.length ? ' · Complete' : ''}${!blank && !errors.length ? ` · ${matchCount} matches · ${uncertainCount} uncertain` : ''}`}</p></div><button disabled={refreshing} onClick={() => { void refresh(); }}>{refreshing ? 'Refreshing…' : 'Refresh records'}</button></div>
        <p className="cache-explanation">Jev results are saved. Reopening a view reuses results for unchanged evidence; updated records are checked again.</p>
        {voice.error && <p role="alert">{voice.error} <button onClick={voice.clearError}>Dismiss</button></p>}
        {evaluation.error && <p role="alert">{evaluation.error} <button onClick={evaluation.retry}>Retry model status</button></p>}
        {preview.previewErrors.length > 0 && <p role="alert">Some records could not be checked. {preview.previewErrors.join(' ')} <button onClick={preview.retry}>Retry failed checks</button></p>}
        <p className="cache-explanation">Create rule copies conditions and record filters. Result display and sorting only affect this view.</p><div className="explore-result-filters"><label>Results<select aria-label="Explore result" disabled={blank} value={blank ? 'all' : definition.matchesOnly ? 'true' : definition.result ?? 'all'} onChange={event => { update({ matchesOnly: event.target.value === 'true', result: event.target.value as SearchDefinition['result'] }); }}><option value="all">All results</option><option value="true">Matches</option><option value="uncertain">Not enough information</option><option value="false">No match</option></select></label><label>Text filter (no Jev)<input aria-label="Find in results" value={text} onChange={event => setText(event.target.value)} placeholder="Name, memo, or transaction ID" /></label><label>Sort<select aria-label="Explore sort" value={definition.sort.key} onChange={event => update({ sort: { key: event.target.value as SearchDefinition['sort']['key'], dir: event.target.value === 'match' ? -1 : 1 } })}><option value="match" disabled={!english.length}>{combined ? `Condition ${confidenceNumber} score` : 'Match confidence'}</option><option value="date">Date</option><option value="vendor">Counterparty</option><option value="account">Category</option><option value="amountCents">Amount</option></select></label><button aria-label="Reverse sort" onClick={() => update({ sort: { ...definition.sort, dir: definition.sort.dir === 1 ? -1 : 1 } })}>{definition.sort.key === 'match' ? definition.sort.dir === -1 ? 'Highest first' : 'Lowest first' : definition.sort.dir === 1 ? 'Ascending' : 'Descending'}</button></div>
        {combined && confidenceCondition && <div className="explore-confidence-choice"><label>Sort by condition<select aria-label="Confidence condition" value={confidenceCondition.id} onChange={event => setConfidenceId(event.target.value)}>{english.map(node => <option key={node.id} value={node.id}>Condition {conditions.findIndex(condition => condition.id === node.id) + 1}{node.label ? ': ' + node.label : ''}</option>)}</select></label><p>Each score belongs to one condition before AND, OR, and NOT. The combined result determines highlighting; no overall probability is calculated. Sorting uses the selected condition within the result groups.</p></div>}
        <div className="explore-table-wrap"><table className="explore-table" aria-label="Explore results"><thead><tr><th>Date</th><th>Transaction</th><th>Description and memo</th><th>Category</th><th>Amount</th><th>{combined ? 'Combined result' : 'Result'}</th><th aria-sort={!combined && definition.sort.key === 'match' ? definition.sort.dir === -1 ? 'descending' : 'ascending' : 'none'}>{combined ? 'Condition checks' : <button className="explore-confidence-sort" onClick={() => update({ sort: { key: 'match', dir: definition.sort.key === 'match' && definition.sort.dir === -1 ? 1 : -1 } })} disabled={!confidenceCondition}>Match confidence</button>}</th><th>Assigned to / flags</th></tr></thead><tbody>{rows.map(row => <tr key={row.id} data-id={row.id} className={!blank && preview.snapshots[row.id]?.result === 'true' ? 'm-match' : !blank && preview.snapshots[row.id]?.result === 'uncertain' ? 'm-unc' : ''}><td>{row.date}</td><td><button onClick={() => onInspect(row.id)}>{row.vendor}</button><small>{row.txnType ?? 'bill'} · {row.docNumber || row.billId}</small></td><td><p>{row.description || '(No description)'}</p><small>{row.memo}</small></td><td>{row.account}</td><td className="num">{money(row.amountCents)}</td><td>{blank ? <span className="muted">No conditions</span> : <details><summary><ResultBadge value={preview.snapshots[row.id]?.result ?? 'pending'} /></summary>{leaves(expression).map(node => <p className="explore-leaf-result" key={node.id}><span>{conditionText(node)}</span><span><ResultBadge value={preview.snapshots[row.id]?.conditions[node.id] ?? 'pending'} />{preview.probabilities[row.id]?.[node.id] !== undefined && <span className="explore-condition-probability"> {Math.round(preview.probabilities[row.id][node.id] * 100)}% {scoreLabel(preview.scoreKinds[row.id]?.[node.id])}</span>}</span></p>)}</details>}</td><td className={combined ? 'explore-condition-scores' : 'explore-confidence num'}>{combined ? <ConditionScores conditions={conditions} snapshot={preview.snapshots[row.id]} probabilities={preview.probabilities[row.id]} scoreKinds={preview.scoreKinds[row.id]} /> : <>{!blank && probability(row.id) !== undefined ? <span title={scoreLabel(preview.scoreKinds[row.id]?.[confidenceCondition?.id ?? '']) + (combined ? ' for the selected condition before grouping.' : '')}>{Math.round(probability(row.id)! * 100)}% <small>{scoreLabel(preview.scoreKinds[row.id]?.[confidenceCondition?.id ?? ''])}</small></span> : <span className="muted">{!blank && confidenceCondition ? preview.snapshots[row.id]?.conditions[confidenceCondition.id] === 'error' ? 'Unavailable' : ['true','false','uncertain'].includes(preview.snapshots[row.id]?.conditions[confidenceCondition.id] ?? '') ? 'Score unavailable' : 'Checking' : '-'}</span>}</>}</td><td><span>{ownerLabel(row.dashboard?.owner)}</span>{row.dashboard?.flags.map(flag => <small key={flag} className="tag warn">{flag}</small>)}</td></tr>)}</tbody></table></div>
        {!rows.length && <p className="explore-empty">No transactions in this view. Change the conditions or filters.</p>}
        <p className="explore-footnote">{rows.length} shown · {data.rows.length} loaded{data.sampled ? ` of ${data.totalBills} company transactions. Choose All records above to widen the preview.` : ''}. Viewing and saving never run actions.</p>
      </section>
    </div>
  </main>;
}
