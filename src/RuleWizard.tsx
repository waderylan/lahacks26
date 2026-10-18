import { scopeLabel } from './ruleScope';
import { ConditionEditor, conditionEquation, conditionText } from './ConditionEditor';
import { useEffect, useRef, useState } from 'react';
import type { CompanyBills, Row } from './types';
import type { RulesController } from './useRules';
import { actionLabel, actionOutcome, actionsForOutcome, RESULT_LABELS, DEFAULT_MESSAGE_ASK, leaves, uid, validateRule, ruleConditionKey, type Action, type Outcome, type RuleNode, type Truth } from './rules';
import { EMPLOYEES, ownerKey, ownerLabel, sameOwner } from './employees';
import { EmployeeSelect } from './EmployeeSelect';
import { ResultBadge, RuleIssueList } from './RulesPanel';
import './ruleWizard.css';

const steps = ['Conditions', 'Actions', 'Preview'];
const actionNames = { flag: 'Flag', assign: 'Assign transaction owner', task: 'Create task', message: 'Draft message', tag: 'Add tag', pass: 'Mark checked' };
const branches: { result: Truth; title: string }[] = [
  { result: 'true', title: 'Match' },
  { result: 'uncertain', title: 'Uncertain' },
  { result: 'false', title: 'No match' },
];
const usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });
const directlyNegated = (node: RuleNode): string[] => 'children' in node ? node.type === 'not' && node.children[0] && !('children' in node.children[0]) ? [node.children[0].id] : node.children.flatMap(directlyNegated) : [];
const outcomeOf = (c: RulesController, row: Row): Outcome => c.snapshots[row.id]?.result ?? 'pending';

export function RuleWizard({ c, data, onInspect, onMessages, onActivity, onExplore, onClose, onStepChange, initialStep = 0 }: { c: RulesController; data: CompanyBills; onInspect: (id: string) => void; onMessages: () => void; onActivity: () => void; onExplore: () => void; onClose: () => void; initialStep?: number; onStepChange: (step: number) => void }) {
  const [step, setStep] = useState(initialStep);
  const [resultFilter, setResultFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [typeFilter, setTypeFilter] = useState('all');
  const [ownerFilter, setOwnerFilter] = useState('all');
  const [search, setSearch] = useState('');
  const heading = useRef<HTMLHeadingElement>(null);
  const previousId = useRef(c.draft?.id);
  const draft = c.draft;
  useEffect(() => {
    if (previousId.current !== draft?.id) {
      previousId.current = draft?.id; setStep(initialStep); setResultFilter('all'); setStatusFilter('all'); setTypeFilter('all'); setOwnerFilter('all'); setSearch('');
    }
  }, [draft?.id]);
  if (!draft) return <main className="wizard-loading" role="status">Loading saved rules…</main>;
  const conditions = leaves(draft.expression);
  const negated = new Set(directlyNegated(draft.expression));
  const expressionErrors = validateRule({ ...draft, name: 'Condition preview', actions: [{ id: '_wizard_validation_', type: 'pass', value: '' }] });
  const actionErrors = c.validation.filter(error => !expressionErrors.includes(error));
  const evaluationComplete = c.evaluated === data.rows.length && !expressionErrors.length;
  const evaluationStatus = expressionErrors.length ? 'Complete your conditions' : c.previewErrors.length ? 'Some checks failed' : evaluationComplete ? 'Complete' : 'Checking';
  const counts = Object.fromEntries((['true', 'false', 'uncertain', 'pending', 'error'] as Outcome[]).map(result => [result, data.rows.filter(row => outcomeOf(c, row) === result).length])) as Record<Outcome, number>;
  const owners = [...new Set(data.rows.map(row => ownerKey(row.dashboard?.owner)).filter(Boolean))].sort((a, b) => ownerLabel(a).localeCompare(ownerLabel(b)));
  const rows = data.rows.filter(row => (resultFilter === 'all' || outcomeOf(c, row) === resultFilter)
    && (typeFilter === 'all' || (row.txnType ?? 'bill') === typeFilter)
    && (statusFilter === 'all' || (statusFilter === 'reviewed' ? row.dashboard?.reviewed : statusFilter === 'flagged' ? row.dashboard?.flags.length : !row.dashboard?.reviewed))
    && (ownerFilter === 'all' || (ownerFilter === 'unassigned' ? !row.dashboard?.owner : sameOwner(row.dashboard?.owner, ownerFilter)))
    && (!search.trim() || [row.billId, row.docNumber, row.vendor, row.description, row.memo, ...row.itemNames].join(' ').toLowerCase().includes(search.trim().toLowerCase())));
  const needsCleanup = (row: Row) => Boolean(draft.autoResolve && outcomeOf(c, row) === 'false' && c.issues.some(issue => issue.ruleId === draft.id && issue.transactionId === row.id && issue.status === 'open' && issue.conditionKey === ruleConditionKey(draft)));
  // Run covers every evaluated preview record with a configured action, whatever the display filters show.
  const actionableIds = data.rows.filter(row => actionsForOutcome(draft, outcomeOf(c, row)).length || needsCleanup(row)).map(row => row.id);
  const go = (next: number) => { setStep(next); onStepChange(next); requestAnimationFrame(() => heading.current?.focus()); };
  const defaultAction = (type: Action['type']): Action => ({ id: uid(), type, value: type === 'message' ? DEFAULT_MESSAGE_ASK : type === 'flag' ? 'Needs clarification' : type === 'assign' ? c.actor || EMPLOYEES[0].id : type === 'tag' ? 'Follow up' : type === 'task' ? 'Review supporting details' : '', ...(type === 'message' && { sender: c.actor, recipient: 'jev' }), ...(type === 'task' && { owner: c.actor || EMPLOYEES[0].id, dueDays: 2 }) });
  const updateAction = (id: string, patch: Partial<Action>) => c.setDraft({ ...draft, actions: draft.actions.map(action => action.id === id ? { ...action, ...patch } : action) });
  const actionSummary = () => branches.map(branch => {
    const actions = actionsForOutcome(draft, branch.result);
    return <div className="wizard-branch-summary" key={branch.result}><b>{RESULT_LABELS[branch.result]}</b>{actions.length ? actions.map(action => <p key={action.id}>{actionLabel(action)}</p>) : <p className="muted">No action</p>}{branch.result === 'false' && draft.autoResolve && <p>Clear this rule's flags and close its unchanged tasks.</p>}</div>;
  });
  const saveDisabled = Boolean(c.validation.length || c.storageError || c.busy || !draft.name.trim());
  return <main className="rule-wizard" aria-label="Rule setup">
    <header className="wizard-page-heading"><div><h1>Rule setup</h1></div><div className="wizard-library"><button onClick={onClose}>All rules</button><button onClick={onActivity}>Activity</button></div></header>
    <p className="rule-scope-note">{scopeLabel(draft.scope)} <button onClick={onExplore}>Edit filters</button></p><div className="wizard-layout">
      <nav className="wizard-steps" aria-label="Rule setup steps">{steps.map((label, index) => <button key={label} aria-current={step === index ? 'step' : undefined} onClick={() => go(index)}><span aria-hidden="true">{index + 1}</span>{label}</button>)}</nav>
      <section className="wizard-main">
        <h2 ref={heading} tabIndex={-1}>{steps[step]}</h2>
        <div className="wizard-step-content">
          {step === 0 && <><ConditionEditor expression={draft.expression} onChange={expression => c.setDraft({ ...draft, expression })} data={data} />{expressionErrors.length > 0 && <p className="wizard-validation" role="status">{expressionErrors.map(error => error.replace('Groups cannot be empty.', 'Add a condition or remove the empty group.')).join(' ')}</p>}</>}
          {step === 1 && <>
            {branches.map(branch => <fieldset className={`wizard-outcome outcome-${branch.result}`} key={branch.result} aria-label={branch.title}>
              <legend>{branch.title}</legend>
            {draft.actions.filter(action => actionOutcome(action) === branch.result).map((action, index) => <section className="wizard-action" key={action.id}><div className="wizard-action-heading"><label htmlFor={`action-${action.id}`}>Action {index + 1}</label><button className="ghost" aria-label={`Remove action ${index + 1}`} onClick={() => c.setDraft({ ...draft, actions: draft.actions.filter(item => item.id !== action.id) })}>Remove</button></div>
              <select id={`action-${action.id}`} aria-label="Action type" value={action.type} onChange={event => updateAction(action.id, { ...defaultAction(event.target.value as Action['type']), id: action.id, when: branch.result })}>{Object.entries(actionNames).filter(([value]) => branch.result !== 'uncertain' || value !== 'pass').map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
              {action.type === 'message' ? <div className="wizard-message-fields"><label className="wizard-field">Message request<textarea aria-label="Message request" rows={3} maxLength={500} value={action.value} onChange={event => updateAction(action.id, { value: event.target.value })} /></label><div className="wizard-pair"><label className="wizard-field">Send from<select aria-label="Message sender" value={action.sender ?? ''} onChange={event => updateAction(action.id, { sender: event.target.value })}><option value="">Choose sender…</option>{EMPLOYEES.map(person => <option key={person.id} value={person.id}>{person.name}</option>)}</select></label><label className="wizard-field">Send to<select aria-label="Message recipient" value={action.recipient ?? 'jev'} onChange={event => updateAction(action.id, { recipient: event.target.value })}><option value="jev">Let Jev choose</option>{EMPLOYEES.map(person => <option key={person.id} value={person.id}>{person.name}</option>)}</select></label></div><p className="wizard-help">Requires sender approval.</p></div>
                : action.type === 'task' ? <div className="wizard-message-fields"><label className="wizard-field">Task title<input aria-label="Task title" value={action.value} maxLength={100} onChange={event => updateAction(action.id, { value: event.target.value })} /></label><div className="wizard-pair"><label className="wizard-field">Task owner<EmployeeSelect label="Task owner" value={action.owner ?? ''} onChange={owner => updateAction(action.id, { owner })} /></label><label className="wizard-field">Due in days<input aria-label="Task due in days" type="number" min={0} max={365} value={action.dueDays ?? ''} onChange={event => updateAction(action.id, { dueDays: event.target.value === '' ? undefined : Number(event.target.value) })} /></label></div><p className="wizard-help">One task per transaction. Rechecks reuse open tasks.</p></div>
                : action.type !== 'pass' ? <label className="wizard-field wizard-action-value">{action.type === 'assign' ? 'Transaction owner' : action.type === 'flag' ? 'Flag' : 'Tag'}{action.type === 'assign' ? <EmployeeSelect label="Action value" value={action.value} onChange={value => updateAction(action.id, { value })} /> : <input aria-label="Action value" value={action.value} maxLength={100} onChange={event => updateAction(action.id, { value: event.target.value })} />}</label>
                  : <p className="wizard-help">Automated check only.</p>}
            </section>)}
            <button aria-label={branch.result === 'true' ? 'Add action' : `Add action for ${branch.result === 'uncertain' ? 'uncertain results' : 'nonmatches'}`} onClick={() => c.setDraft({ ...draft, actions: [...draft.actions, { ...defaultAction('flag'), when: branch.result }] })}>Add action</button>
            </fieldset>)}
            <section className="wizard-resolution" aria-label="After an issue is cleared"><h3>After an issue is cleared</h3>
              <label className="wizard-automatic"><input type="checkbox" aria-label="Clear resolved issues" checked={Boolean(draft.autoResolve)} onChange={event => c.setDraft({ ...draft, autoResolve: event.target.checked })} />Clear this rule's flags and close its tasks when there is no match</label>
              <details className="wizard-help"><summary>Details</summary><p>Rechecks leave Match and Uncertain issues open. No match clears this rule’s flags and closes its unchanged tasks. Other flags, edited tasks and messages stay.</p></details>
            </section>
            {actionErrors.length > 0 && <p className="wizard-validation" role="status">{actionErrors.join(' ')}</p>}
          </>}
          {step === 2 && <>
            <div className="wizard-results" aria-label="Match counts" aria-live="polite">
              {([['true', 'matches'], ['uncertain', 'uncertain'], ['false', 'no match']] as const).map(([result, label]) => <button className={`wizard-count count-${result}`} key={result} onClick={() => setResultFilter(result)} aria-pressed={resultFilter === result}><b>{counts[result]}</b>{result === 'true' && counts.true === 1 ? 'match' : label}</button>)}
              {counts.pending > 0 && <button className="wizard-count" onClick={() => setResultFilter('pending')}><b>{counts.pending}</b>checking</button>}
              {counts.error > 0 && <button className="wizard-count count-error" onClick={() => setResultFilter('error')}><b>{counts.error}</b>failed</button>}
            </div>
            <div className="wizard-preview-heading"><h3>Results and planned actions</h3><select aria-label="Preview rows" value={resultFilter} onChange={event => setResultFilter(event.target.value)}><option value="true">Matches only</option><option value="all">All results</option><option value="false">No match only</option><option value="uncertain">Uncertain only</option><option value="pending">Checking</option><option value="error">Failed</option></select></div>
            <div className="wizard-preview-filters"><label>Type<select aria-label="Transaction type filter" value={typeFilter} onChange={event => setTypeFilter(event.target.value)}><option value="all">All types</option><option value="bill">Vendor bills</option><option value="invoice">Customer invoices</option><option value="bank">Bank transactions</option></select></label><input aria-label="Search visible bills" placeholder="Transaction or counterparty" value={search} onChange={event => setSearch(event.target.value)} /><label>Status<select aria-label="Bill status filter" value={statusFilter} onChange={event => setStatusFilter(event.target.value)}><option value="all">Any status</option><option value="needs_review">Needs review</option><option value="reviewed">Reviewed</option><option value="flagged">Flagged</option></select></label><label>Transaction owner<select aria-label="Bill assignee filter" value={ownerFilter} onChange={event => setOwnerFilter(event.target.value)}><option value="all">Anyone</option><option value="unassigned">Unassigned</option>{owners.map(owner => <option key={owner} value={owner}>{ownerLabel(owner)}</option>)}</select></label></div>
            <details className="wizard-condition-key"><summary>Conditions</summary>{conditions.map((condition, index) => <p key={condition.id}><b>Condition {index + 1}:</b> {conditionText(condition)}</p>)}</details>
            <div className="wizard-table-wrap"><table className="wizard-table" aria-label="Rule results and planned actions"><thead><tr><th>Transaction</th>{conditions.map((condition, index) => <th key={condition.id} title={conditionText(condition)}>Condition {index + 1}{negated.has(condition.id) && <span className="wizard-negation">NOT</span>}</th>)}<th>Result</th><th>Planned actions</th></tr></thead><tbody>{rows.map(row => <tr key={row.id} data-id={row.id} className={outcomeOf(c, row) === 'true' ? 'matches' : ''}><td><button className="wizard-vendor" onClick={() => onInspect(row.id)} aria-label={`Inspect ${row.vendor}, ${row.billId}`}>{row.vendor}</button>{row.txnType && row.txnType !== 'bill' && <em className="type-pill">{row.txnType === 'invoice' ? 'Invoice' : 'Bank'}</em>}<span>{row.docNumber || row.billId} · {usd.format(row.amountCents / 100)}</span><small>{ownerLabel(row.dashboard?.owner)} · {row.dashboard?.reviewed ? 'Reviewed' : 'Needs review'}</small></td>{conditions.map(condition => <td key={condition.id}><ResultBadge value={c.snapshots[row.id]?.conditions[condition.id] ?? 'pending'} /></td>)}<td><ResultBadge value={outcomeOf(c, row)} /></td><td className="wizard-planned-actions">{needsCleanup(row) && <p>Clear this rule's earlier flags and close its tasks</p>}{['pending', 'error'].includes(outcomeOf(c, row)) ? 'No action until checked' : actionsForOutcome(draft, outcomeOf(c, row)).length ? actionsForOutcome(draft, outcomeOf(c, row)).map(action => <p key={action.id}>{actionLabel(action)}</p>) : needsCleanup(row) ? null : 'No action'}</td></tr>)}</tbody></table></div>
            {!rows.length && <p className="wizard-empty">{expressionErrors.length ? 'Complete the conditions.' : c.previewErrors.length ? 'Checks failed. Retry above.' : !evaluationComplete ? 'Checking transactions…' : 'No transactions. Change the filters or conditions.'}</p>}
            <p className="wizard-help">Showing {rows.length} of {data.rows.length}{data.sampled ? ` · ${data.totalBills} company transactions` : ''}</p>
            <details className="wizard-help"><summary>Run scope</summary><p>Run applies actions to {actionableIds.length} preview transactions across all results, regardless of display filters. Use Run all records on the Rules page to check the full company.</p></details>
            <div className="wizard-save"><label className="wizard-field">Rule name<input aria-label="Rule name" value={draft.name} maxLength={200} onChange={event => c.setDraft({ ...draft, name: event.target.value })} /></label><details className="wizard-action-summary"><summary>Actions by result</summary>{actionSummary()}</details>
              <RuleIssueList issues={c.issues.filter(issue => issue.ruleId === draft.id)} onInspect={onInspect} conditionKey={ruleConditionKey(draft)} links={{ approvals: issue => c.store.messages.filter(message => message.ruleId === issue.ruleId && message.items.some(item => item.transactionId === issue.transactionId)).length, onTasks: onActivity, onApprovals: onMessages }} />
              {c.validation.length > 0 && <p className="wizard-validation">{c.validation.join(' ')}</p>}
              {c.saved && draft.revision < c.saved.revision && <p className="wizard-validation">A newer version was saved. <button onClick={() => c.selectRule(c.saved!.id)}>Reload saved rule</button></p>}
              {c.saved && <label className="wizard-automatic"><input type="checkbox" aria-label="Keep checking" checked={c.saved.enabled} disabled={c.busy || Boolean(c.storageError)} onChange={() => { void c.toggleEnabled(); }} />Keep checking</label>}
              {c.saved?.enabled && c.dirty && <p className="wizard-help">Keep checking uses the saved version.</p>}
            </div>
          </>}
        </div>
        <div className="wizard-bottom"><button disabled={step === 0} onClick={() => go(step - 1)}>Back</button><div>
          {step < 2 ? <button className="primary" disabled={step === 0 ? Boolean(expressionErrors.length) : Boolean(c.validation.length)} onClick={() => go(step + 1)}>{step === 0 ? 'Actions' : 'Preview'}</button>
            : <>{(c.dirty || !c.saved) && <button disabled={saveDisabled} onClick={() => { void c.save(Boolean(c.saved?.enabled)); }}>Save rule</button>}
              <button className="primary" disabled={c.dirty || !c.saved || !c.complete || !actionableIds.length || c.busy || Boolean(c.storageError)} onClick={() => { void c.runOnce(actionableIds); }}>{c.busy ? 'Running…' : `Run on ${actionableIds.length} ${actionableIds.length === 1 ? 'transaction' : 'transactions'}`}</button></>}
          {step === 2 && c.dirty && <span className="wizard-help">Save changes to run.</span>}
        </div></div>
      </section>
      <aside className="wizard-summary"><h3>Your rule</h3><section className="wizard-provider"><label>Model<select aria-label="Rule evaluation provider" value={draft.provider ?? 'jev'} onChange={event => c.setDraft({ ...draft, provider: event.target.value as 'jev' | 'qwen' })}><option value="jev">Jev</option><option value="qwen">Qwen</option></select></label></section><section><b>Equation</b><p className="wizard-formula" title={conditionText(draft.expression)}>{conditionEquation(draft.expression)}</p></section><section className="wizard-live-counts"><b>Preview</b><div className="wizard-progress" aria-label="Evaluation progress" aria-live="polite"><span>{c.evaluated}/{data.rows.length} checked · {evaluationStatus}</span><progress max={data.rows.length || 1} value={c.evaluated} /></div><button onClick={() => { setResultFilter('true'); go(2); }}><strong>{counts.true}</strong>{counts.true === 1 ? 'match' : 'matches'}</button><button onClick={() => { setResultFilter('uncertain'); go(2); }}><strong>{counts.uncertain}</strong>uncertain</button><button onClick={() => { setResultFilter('false'); go(2); }}><strong>{counts.false}</strong>no match</button><button className="wizard-view-rows" onClick={() => go(2)}>View results</button></section>
        {c.store.messages.some(message => message.status === 'pending') && <button className="wizard-message-link" onClick={onMessages}>View message approvals</button>}
      </aside>
    </div>
  </main>;
}
