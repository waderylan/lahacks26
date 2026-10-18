import { useEffect, useRef, useState } from 'react';
import type { CompanyBills, Row } from './types';
import type { RulesController } from './useRules';
import { actionLabel, actionOutcome, actionsForOutcome, RESULT_LABELS, DEFAULT_MESSAGE_ASK, leaves, uid, validateRule, type Action, type Group, type Outcome, type RuleNode, type StandardCondition, type Truth } from './rules';
import { EMPLOYEES, employeeById } from './employees';
import { ResultBadge, RuleHistory, RuleIssueList } from './RulesPanel';
import './ruleWizard.css';

const groupLabel = { all: 'AND', any: 'OR', not: 'NOT' };
const steps = ['Describe conditions', 'Choose actions', 'Review results'];
const actionNames = { flag: 'Flag transactions', assign: 'Assign transactions', task: 'Create a review task', message: 'Draft an internal message', tag: 'Add a tag', pass: 'Mark checked' };
const branches: { result: Truth; title: string; description: string }[] = [
  { result: 'true', title: 'When there is a match', description: 'The transaction meets your conditions.' },
  { result: 'uncertain', title: 'When there is not enough information', description: 'Jev cannot decide from the available records. Ask for details or assign someone to review.' },
  { result: 'false', title: 'When there is no match', description: 'The transaction does not meet your conditions. Leave this empty to take no action.' },
];
const usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });
const changeNode = (node: RuleNode, id: string, update: (node: RuleNode) => RuleNode): RuleNode => node.id === id ? update(node) : 'children' in node ? { ...node, children: node.children.map(child => changeNode(child, id, update)) } : node;
const removeNode = (node: RuleNode, id: string): RuleNode => 'children' in node ? { ...node, children: node.children.filter(child => child.id !== id).map(child => removeNode(child, id)) } : node;
const newCondition = (): RuleNode => ({ id: uid(), type: 'ai', text: '', label: '' });
const conditionText = (node: RuleNode): string => node.type === 'ai' ? node.text : node.type === 'standard' ? `${node.field === 'amountCents' ? 'Amount' : node.field === 'review' ? 'Review status' : node.field} ${node.operator === 'gt' ? '>' : node.operator === 'lt' ? '<' : '='} ${node.field === 'amountCents' ? '$' : ''}${node.value}` : node.type === 'not' ? `NOT (${node.children.map(conditionText).join(' ')})` : `(${node.children.map(conditionText).join(` ${groupLabel[node.type]} `)})`;
const directlyNegated = (node: RuleNode): string[] => 'children' in node ? node.type === 'not' && node.children[0] && !('children' in node.children[0]) ? [node.children[0].id] : node.children.flatMap(directlyNegated) : [];
const outcomeOf = (c: RulesController, row: Row): Outcome => c.snapshots[row.id]?.result ?? 'pending';

export function RuleWizard({ c, data, onInspect, onMessages }: { c: RulesController; data: CompanyBills; onInspect: (id: string) => void; onMessages: () => void }) {
  const [step, setStep] = useState(0);
  const [resultFilter, setResultFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [typeFilter, setTypeFilter] = useState('all');
  const [ownerFilter, setOwnerFilter] = useState('all');
  const [search, setSearch] = useState('');
  const heading = useRef<HTMLHeadingElement>(null);
  const previousId = useRef(c.draft?.id);
  const draft = c.draft;
  const records = data.company.synthetic ? 'transactions' : 'bills';
  useEffect(() => {
    if (previousId.current !== draft?.id) {
      previousId.current = draft?.id; setStep(0); setResultFilter('all'); setStatusFilter('all'); setTypeFilter('all'); setOwnerFilter('all'); setSearch('');
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
  const owners = [...new Set(data.rows.map(row => row.dashboard?.owner).filter((owner): owner is string => Boolean(owner)))].sort();
  const rows = data.rows.filter(row => (resultFilter === 'all' || outcomeOf(c, row) === resultFilter)
    && (typeFilter === 'all' || (row.txnType ?? 'bill') === typeFilter)
    && (statusFilter === 'all' || (statusFilter === 'reviewed' ? row.dashboard?.reviewed : statusFilter === 'flagged' ? row.dashboard?.flags.length : !row.dashboard?.reviewed))
    && (ownerFilter === 'all' || (ownerFilter === 'unassigned' ? !row.dashboard?.owner : `owner:${row.dashboard?.owner}` === ownerFilter))
    && (!search.trim() || [row.billId, row.docNumber, row.vendor, row.description, row.memo, ...row.itemNames].join(' ').toLowerCase().includes(search.trim().toLowerCase())));
  const needsCleanup = (row: Row) => Boolean(draft.autoResolve && outcomeOf(c, row) === 'false' && c.issues.some(issue => issue.ruleId === draft.id && issue.transactionId === row.id && issue.status === 'open' && issue.conditionKey === JSON.stringify(draft.expression)));
  const actionableIds = rows.filter(row => actionsForOutcome(draft, outcomeOf(c, row)).length || needsCleanup(row)).map(row => row.id);
  const go = (next: number) => { setStep(next); requestAnimationFrame(() => heading.current?.focus()); };
  const updateTree = (expression: RuleNode) => c.setDraft({ ...draft, expression });
  const update = (id: string, transform: (node: RuleNode) => RuleNode) => updateTree(changeNode(draft.expression, id, transform));
  const add = (id: string, type: 'ai' | 'group' | StandardCondition['field']) => {
    const node: RuleNode = type === 'ai' ? newCondition() : type === 'group' ? { id: uid(), type: 'any', children: [newCondition()] }
      : { id: uid(), type: 'standard', field: type, operator: type === 'amountCents' ? 'gt' : 'eq', value: type === 'amountCents' ? '500' : type === 'review' ? 'needs_review' : '' };
    update(id, parent => 'children' in parent ? { ...parent, children: [...parent.children, node] } : { id: uid(), type: 'all', children: [parent, node] });
  };
  const addControls = (node: RuleNode, depth: number) => <div className="wizard-add-controls">
    <button onClick={() => add(node.id, 'ai')}>Add condition</button>
    <button className="ghost" disabled={depth >= 3} title={depth >= 3 ? 'At most three group levels' : undefined} onClick={() => add(node.id, 'group')}>Add group</button>
    <details className="wizard-extra-filter"><summary>Add a filter</summary><div>{(['amountCents', 'review', 'vendor', 'account'] as const).map(field => <button key={field} onClick={() => add(node.id, field)}>{{ amountCents: 'Amount', review: 'Review status', vendor: data.company.synthetic ? 'Counterparty' : 'Vendor', account: 'Category' }[field]}</button>)}</div></details>
  </div>;
  const renderNode = (node: RuleNode, depth: number, parent?: Group): React.ReactNode => {
    if ('children' in node) return <section className={`wizard-condition-group ${parent ? 'nested' : ''}`} key={node.id} data-testid={`node-${node.type}`} aria-label={parent ? 'Nested condition group' : 'Conditions'}>
      <div className="wizard-group-heading"><select aria-label="Group logic" value={node.type} onChange={event => update(node.id, current => ({ ...current, type: event.target.value } as Group))}>
        <option value="all">AND</option><option value="any">OR</option><option value="not" disabled={node.children.length !== 1}>NOT</option>
      </select>{parent && <button className="ghost" onClick={() => updateTree(removeNode(draft.expression, node.id))} aria-label={`Remove ${groupLabel[node.type]} group`}>Remove group</button>}</div>
      {node.children.map((child, index) => <div key={child.id}>{index > 0 && <div className="wizard-connector">{groupLabel[node.type]}</div>}{renderNode(child, depth + 1, node)}</div>)}
      {!node.children.length && <p className="wizard-help">Add a condition to this group.</p>}
      {(node.type !== 'not' || !node.children.length) && addControls(node, depth)}
    </section>;
    const number = conditions.findIndex(condition => condition.id === node.id) + 1;
    const options = data.referenceOptions ?? { vendors: [...new Set(data.rows.map(row => row.vendor))].sort(), accounts: [...new Set(data.rows.map(row => row.account))].sort() };
    return <section className="wizard-condition" key={node.id} data-testid={`node-${node.type}`}>
      <div className="wizard-condition-heading"><label htmlFor={`condition-${node.id}`}>Condition {number}{parent?.type === 'not' && <span className="wizard-negation">NOT</span>}</label>{parent && <button className="ghost" aria-label={`Remove condition ${number}`} onClick={() => updateTree(removeNode(draft.expression, node.id))}>Remove</button>}</div>
      {node.type === 'ai' ? <textarea id={`condition-${node.id}`} aria-label={`Condition ${number}`} rows={3} maxLength={500} placeholder="Describe what should be true about this transaction…" value={node.text} onChange={event => update(node.id, current => ({ ...current, text: event.target.value } as RuleNode))} /> : <div className="wizard-standard-condition">
        <select id={`condition-${node.id}`} aria-label="Condition field" value={node.field} onChange={event => { const field = event.target.value as StandardCondition['field']; update(node.id, current => ({ ...current, field, operator: field === 'amountCents' ? 'gt' : 'eq', value: field === 'amountCents' ? '500' : field === 'review' ? 'needs_review' : '' } as StandardCondition)); }}>
          <option value="amountCents">Amount</option><option value="review">Review status</option><option value="vendor">{data.company.synthetic ? 'Counterparty' : 'Vendor'}</option><option value="account">Category</option>
        </select><select aria-label="Comparison" value={node.operator} onChange={event => update(node.id, current => ({ ...current, operator: event.target.value } as StandardCondition))}>
          {node.field === 'amountCents' ? <><option value="gt">Over</option><option value="lt">Under</option><option value="eq">Equals</option></> : <option value="eq">Is</option>}
        </select>{node.field === 'amountCents' ? <label className="wizard-money">$<input aria-label="Amount in dollars" inputMode="decimal" value={node.value} onChange={event => update(node.id, current => ({ ...current, value: event.target.value } as StandardCondition))} /></label>
          : <select aria-label="Condition value" value={node.value} onChange={event => update(node.id, current => ({ ...current, value: event.target.value } as StandardCondition))}><option value="">Choose…</option>{(node.field === 'review' ? [['needs_review', 'Needs review'], ['reviewed', 'Reviewed']] : (node.field === 'vendor' ? options.vendors : options.accounts).map(value => [value, value])).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>}
      </div>}
      {node.type === 'ai' && <details className="wizard-condition-label"><summary>Optional label</summary><input aria-label="Condition label" value={node.label} placeholder={`Condition ${number}`} onChange={event => update(node.id, current => ({ ...current, label: event.target.value } as RuleNode))} /></details>}
      {!parent && addControls(node, 1)}
    </section>;
  };
  const defaultAction = (type: Action['type']): Action => ({ id: uid(), type, value: type === 'message' ? DEFAULT_MESSAGE_ASK : type === 'flag' ? 'Needs clarification' : type === 'assign' ? employeeById(c.actor)?.name ?? 'Bookkeeper' : type === 'tag' ? 'Follow up' : type === 'task' ? 'Review supporting details' : '', ...(type === 'message' && { sender: c.actor, recipient: 'jev' }), ...(type === 'task' && { owner: employeeById(c.actor)?.name ?? 'Bookkeeper', dueDays: 2 }) });
  const updateAction = (id: string, patch: Partial<Action>) => c.setDraft({ ...draft, actions: draft.actions.map(action => action.id === id ? { ...action, ...patch } : action) });
  const actionSummary = (compact = false) => branches.map(branch => {
    const actions = actionsForOutcome(draft, branch.result);
    return <div className="wizard-branch-summary" key={branch.result}><b>{RESULT_LABELS[branch.result]}</b>{actions.length ? actions.map(action => <p key={action.id}>{compact ? `${actionNames[action.type]}${action.value && action.type !== 'message' ? `: ${action.value}` : ''}` : actionLabel(action)}</p>) : <p className="muted">{branch.result === 'false' && draft.autoResolve ? 'No additional action' : 'No action'}</p>}{branch.result === 'false' && draft.autoResolve && <p>After a recheck: clear this rule's earlier flags and close its tasks.</p>}</div>;
  });
  const saveDisabled = Boolean(c.validation.length || c.storageError || c.busy || !draft.name.trim());
  return <main className="rule-wizard" aria-label="Rule setup">
    <header className="wizard-page-heading"><div><h1>Build a rule in plain English</h1><p>Describe what to look for. Jev checks each {data.company.synthetic ? 'transaction' : 'bill'}.</p></div><div className="wizard-library"><label className="sr-only" htmlFor="saved-rule">Saved rules</label><select id="saved-rule" aria-label="Saved rules" value={c.saved?.id ?? ''} onChange={event => c.selectRule(event.target.value)}>{!c.saved && <option value="" disabled>{draft.name} ? unsaved</option>}{c.store.rules.map(rule => <option key={rule.id} value={rule.id}>{rule.name}{rule.enabled ? ' · automatic' : ''}</option>)}</select><button onClick={c.newRule}>New rule</button><label className="sr-only" htmlFor="rule-preset">Start from a preset</label><select id="rule-preset" aria-label="Start from a preset" value={c.presetId} onChange={event => event.target.value && c.loadPreset(event.target.value)}><option value="">Start from a preset…</option>{c.presets.map(preset => <option key={preset.id} value={preset.id} title={preset.description}>{preset.name}</option>)}</select></div></header>
    <div className="wizard-layout">
      <nav className="wizard-steps" aria-label="Rule setup steps">{steps.map((label, index) => <button key={label} aria-current={step === index ? 'step' : undefined} onClick={() => go(index)}><span aria-hidden="true">{index + 1}</span>{label}</button>)}</nav>
      <section className="wizard-main">
        <h2 ref={heading} tabIndex={-1}>{['What should Jev look for?', 'What should happen for each result?', 'Review the results and actions'][step]}</h2>
        <p className="wizard-intro">{['Write each condition in English. Jev judges them independently.', 'Choose actions for each result. You can also clear earlier flags and tasks after a recheck.', 'Check each result and what the rule will do before running.'][step]}</p>
        <div className="wizard-step-content">
          {step === 0 && <>{renderNode(draft.expression, 1)}{expressionErrors.length > 0 && <p className="wizard-validation" role="status">{expressionErrors.map(error => error.replace('AI conditions need criterion text.', 'Write something for each condition.').replace('Groups cannot be empty.', 'Add a condition or remove the empty group.')).join(' ')}</p>}</>}
          {step === 1 && <>
            {branches.map(branch => <fieldset className={`wizard-outcome outcome-${branch.result}`} key={branch.result} aria-label={branch.title}>
              <legend>{branch.title}</legend><p className="wizard-help">{branch.result === 'false' && draft.autoResolve ? 'Clear earlier flags and tasks as described below. Add any other actions here.' : branch.description}</p>
            {draft.actions.filter(action => actionOutcome(action) === branch.result).map((action, index) => <section className="wizard-action" key={action.id}><div className="wizard-action-heading"><label htmlFor={`action-${action.id}`}>Action {index + 1}</label><button className="ghost" aria-label={`Remove action ${index + 1}`} onClick={() => c.setDraft({ ...draft, actions: draft.actions.filter(item => item.id !== action.id) })}>Remove</button></div>
              <select id={`action-${action.id}`} aria-label="Action type" value={action.type} onChange={event => updateAction(action.id, { ...defaultAction(event.target.value as Action['type']), id: action.id, when: branch.result })}>{Object.entries(actionNames).filter(([value]) => branch.result !== 'uncertain' || value !== 'pass').map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
              {action.type === 'message' ? <div className="wizard-message-fields"><label className="wizard-field">What should the message ask?<textarea aria-label="Message request" rows={3} maxLength={500} value={action.value} onChange={event => updateAction(action.id, { value: event.target.value })} /></label><div className="wizard-pair"><label className="wizard-field">Send from<select aria-label="Message sender" value={action.sender ?? ''} onChange={event => updateAction(action.id, { sender: event.target.value })}><option value="">Choose sender…</option>{EMPLOYEES.map(person => <option key={person.id} value={person.id}>{person.name}</option>)}</select></label><label className="wizard-field">Send to<select aria-label="Message recipient" value={action.recipient ?? 'jev'} onChange={event => updateAction(action.id, { recipient: event.target.value })}><option value="jev">Let Jev choose</option>{EMPLOYEES.map(person => <option key={person.id} value={person.id}>{person.name}</option>)}</select></label></div><p className="wizard-help">The sender approves the draft before it reaches the recipient’s inbox.</p></div>
                : action.type === 'task' ? <div className="wizard-message-fields"><label className="wizard-field">Task title<input aria-label="Task title" value={action.value} maxLength={100} onChange={event => updateAction(action.id, { value: event.target.value })} /></label><div className="wizard-pair"><label className="wizard-field">Assigned to<input aria-label="Task owner" list="wizard-assignees" value={action.owner ?? ''} maxLength={100} onChange={event => updateAction(action.id, { owner: event.target.value })} /></label><label className="wizard-field">Due in days<input aria-label="Task due in days" type="number" min={0} max={365} value={action.dueDays ?? ''} onChange={event => updateAction(action.id, { dueDays: event.target.value === '' ? undefined : Number(event.target.value) })} /></label></div><p className="wizard-help">Creates one open task per transaction for this action. Rechecks keep the same open task.</p></div>
                : action.type !== 'pass' ? <label className="wizard-field wizard-action-value">{action.type === 'assign' ? 'Who is responsible?' : action.type === 'flag' ? 'Flag' : 'Tag'}<input aria-label="Action value" list={action.type === 'assign' ? 'wizard-assignees' : undefined} value={action.value} maxLength={100} onChange={event => updateAction(action.id, { value: event.target.value })} /></label>
                  : <p className="wizard-help">Marks an automated check. Human review stays separate.</p>}
            </section>)}
            {!actionsForOutcome(draft, branch.result).length && <p className="wizard-no-action">{branch.result === 'false' && draft.autoResolve ? 'No additional action for this result.' : 'No action for this result.'}</p>}
            <button aria-label={branch.result === 'true' ? 'Add action' : `Add action for ${branch.result === 'uncertain' ? 'uncertain results' : 'nonmatches'}`} onClick={() => c.setDraft({ ...draft, actions: [...draft.actions, { ...defaultAction('flag'), when: branch.result }] })}>Add action{branch.result === 'true' ? '' : branch.result === 'uncertain' ? ' for uncertain results' : ' for nonmatches'}</button>
            </fieldset>)}
            <section className="wizard-resolution" aria-label="After an issue is cleared"><h3>After an issue is cleared</h3>
              <label className="wizard-automatic"><input type="checkbox" aria-label="Clear resolved issues" checked={Boolean(draft.autoResolve)} onChange={event => c.setDraft({ ...draft, autoResolve: event.target.checked })} />Clear this rule's flags and close its tasks when there is no match</label>
              <p className="wizard-help">Use this for rules that identify a problem. A match or an uncertain result keeps the issue open. A later No match clears flags and completes tasks created by this rule.</p>
              <p className="wizard-help">With automatic runs on, updated records trigger another check. Otherwise, run the rule again. Flags added by people or other rules, edited tasks, and messages are kept.</p>
            </section>
            <datalist id="wizard-assignees">{EMPLOYEES.map(person => <option key={person.id} value={person.name} />)}</datalist>
            {actionErrors.length > 0 && <p className="wizard-validation" role="status">{actionErrors.join(' ')}</p>}
          </>}
          {step === 2 && <>
            <div className="wizard-results" aria-label="Match counts" aria-live="polite">
              {([['true', 'match'], ['uncertain', 'uncertain'], ['false', 'do not match']] as const).map(([result, label]) => <button className={`wizard-count count-${result}`} key={result} onClick={() => setResultFilter(result)} aria-pressed={resultFilter === result}><b>{counts[result]}</b>{label}</button>)}
              {counts.pending > 0 && <button className="wizard-count" onClick={() => setResultFilter('pending')}><b>{counts.pending}</b>checking</button>}
              {counts.error > 0 && <button className="wizard-count count-error" onClick={() => setResultFilter('error')}><b>{counts.error}</b>failed</button>}
            </div>
            <div className="wizard-preview-heading"><h3>Results and planned actions</h3><select aria-label="Preview rows" value={resultFilter} onChange={event => setResultFilter(event.target.value)}><option value="true">Matches only</option><option value="all">All results</option><option value="false">Nonmatches only</option><option value="uncertain">Uncertain only</option><option value="pending">Checking</option><option value="error">Failed</option></select></div>
            <div className="wizard-preview-filters">{data.company.synthetic && <label>Type<select aria-label="Transaction type filter" value={typeFilter} onChange={event => setTypeFilter(event.target.value)}><option value="all">All types</option><option value="bill">Vendor bills</option><option value="invoice">Customer invoices</option><option value="bank">Bank transactions</option></select></label>}<input aria-label="Search visible bills" placeholder="Find a transaction or counterparty…" value={search} onChange={event => setSearch(event.target.value)} /><label>Status<select aria-label="Bill status filter" value={statusFilter} onChange={event => setStatusFilter(event.target.value)}><option value="all">Any status</option><option value="needs_review">Needs review</option><option value="reviewed">Reviewed</option><option value="flagged">Flagged</option></select></label><label>Assigned to<select aria-label="Bill assignee filter" value={ownerFilter} onChange={event => setOwnerFilter(event.target.value)}><option value="all">Anyone</option><option value="unassigned">Unassigned</option>{owners.map(owner => <option key={owner} value={`owner:${owner}`}>{owner}</option>)}</select></label></div>
            <details className="wizard-condition-key"><summary>Read the conditions</summary>{conditions.map((condition, index) => <p key={condition.id}><b>Condition {index + 1}:</b> {conditionText(condition)}</p>)}</details>
            <p className="wizard-help">Condition columns show Jev’s answers before AND, OR, and NOT are applied.</p>
            <div className="wizard-table-wrap"><table className="wizard-table" aria-label="Rule results and planned actions"><thead><tr><th>{data.company.synthetic ? 'Transaction' : 'Bill'}</th>{conditions.map((condition, index) => <th key={condition.id} title={conditionText(condition)}>Condition {index + 1}{negated.has(condition.id) && <span className="wizard-negation">NOT</span>}</th>)}<th>Result</th><th>What will happen</th></tr></thead><tbody>{rows.map(row => <tr key={row.id} data-id={row.id} className={outcomeOf(c, row) === 'true' ? 'matches' : ''}><td><button className="wizard-vendor" onClick={() => onInspect(row.id)} aria-label={`Inspect ${row.vendor}, ${row.billId}`}>{row.vendor}</button>{row.txnType && row.txnType !== 'bill' && <em className="type-pill">{row.txnType === 'invoice' ? 'Invoice' : 'Bank'}</em>}<span>{row.docNumber || row.billId} · {usd.format(row.amountCents / 100)}</span><small>{row.dashboard?.owner || 'Unassigned'} · {row.dashboard?.reviewed ? 'Reviewed' : 'Needs review'}</small></td>{conditions.map(condition => <td key={condition.id}><ResultBadge value={c.snapshots[row.id]?.conditions[condition.id] ?? 'pending'} /></td>)}<td><ResultBadge value={outcomeOf(c, row)} /></td><td className="wizard-planned-actions">{needsCleanup(row) && <p>Clear this rule's earlier flags and close its tasks</p>}{['pending', 'error'].includes(outcomeOf(c, row)) ? 'No action until checked' : actionsForOutcome(draft, outcomeOf(c, row)).length ? actionsForOutcome(draft, outcomeOf(c, row)).map(action => <p key={action.id}>{actionLabel(action)}</p>) : needsCleanup(row) ? null : 'No action'}</td></tr>)}</tbody></table></div>
            {!rows.length && <p className="wizard-empty">{expressionErrors.length ? 'Complete your conditions in step 1.' : c.previewErrors.length ? 'Some checks failed. Retry them above.' : !evaluationComplete ? `Jev is checking the ${records}. Results appear as they finish.` : 'No bills in this view. Change a filter or your conditions.'}</p>}
            <p className="wizard-help">{rows.length} rows shown from {data.rows.length} loaded {records}{data.sampled ? ` (${data.totalBills} in this company)` : ''}. {actionableIds.length} have actions configured. Uncertain results only receive the actions you chose for missing information.</p>
            <div className="wizard-save"><label className="wizard-field">Rule name<input aria-label="Rule name" value={draft.name} maxLength={200} onChange={event => c.setDraft({ ...draft, name: event.target.value })} /></label><div className="wizard-action-summary"><h3>Actions by result</h3>{actionSummary()}{!draft.actions.length && <button onClick={() => go(1)}>Choose an action</button>}<p>{draft.autoResolve ? 'After a recheck finds no match: clear this rule’s earlier flags and close its tasks.' : 'Earlier flags and tasks stay in place after a recheck.'}</p></div>
              <RuleIssueList issues={c.issues.filter(issue => issue.ruleId === draft.id)} onInspect={onInspect} conditionKey={JSON.stringify(draft.expression)} />
              {c.validation.length > 0 && <p className="wizard-validation">{c.validation.join(' ')}</p>}
              {c.saved && draft.revision < c.saved.revision && <p className="wizard-validation">Another session saved a newer revision. <button onClick={() => c.selectRule(c.saved!.id)}>Reload saved rule</button></p>}
              {c.saved && <label className="wizard-automatic"><input type="checkbox" aria-label="Run automatically" checked={c.saved.enabled} disabled={c.busy || Boolean(c.storageError)} onChange={() => { void c.toggleEnabled(); }} />Run automatically on new or changed {records}</label>}
              {c.saved?.enabled && c.dirty && <p className="wizard-help">The saved revision runs until you save these changes.</p>}
              <details className="wizard-history"><summary>Action history & advanced options</summary><RuleHistory c={c} companyId={data.company.companyId} onOpen={onInspect} /></details>
            </div>
          </>}
        </div>
        <div className="wizard-bottom"><button disabled={step === 0} onClick={() => go(step - 1)}>Back</button><div>
          {step < 2 ? <button className="primary" disabled={step === 0 ? Boolean(expressionErrors.length) : Boolean(c.validation.length)} onClick={() => go(step + 1)}>{step === 0 ? 'Choose actions' : 'Review results'}</button>
            : c.dirty || !c.saved ? <button className="primary" disabled={saveDisabled} onClick={() => { void c.save(Boolean(c.saved?.enabled)); }}>Save rule</button>
              : <button className="primary" disabled={!c.complete || !actionableIds.length || c.busy || Boolean(c.storageError)} onClick={() => { void c.runOnce(actionableIds); }}>{c.busy ? 'Running…' : `Run once · ${actionableIds.length} ${actionableIds.length === 1 ? 'transaction' : 'transactions'}`}</button>}
          {step === 2 && c.saved && !c.dirty && <span className="wizard-help">Runs the configured actions for results in this view.</span>}
        </div></div>
      </section>
      <aside className="wizard-summary"><h3>Your rule</h3><section><b>{conditions.length} {conditions.length === 1 ? 'condition' : 'conditions'}</b><p>Jev checks each English condition against every {data.company.synthetic ? 'transaction' : 'bill'}.</p><details><summary>See grouping</summary><p className="wizard-formula">{conditionText(draft.expression)}</p></details></section><section><b>Actions by result</b>{actionSummary(true)}</section><section className="wizard-live-counts"><b>Live preview</b><div className="wizard-progress" aria-label="Evaluation progress" aria-live="polite"><span>{c.evaluated}/{data.rows.length} evaluated · {evaluationStatus}</span><progress max={data.rows.length || 1} value={c.evaluated} /></div><button onClick={() => { setResultFilter('true'); go(2); }}><strong>{counts.true}</strong>match</button><button onClick={() => { setResultFilter('uncertain'); go(2); }}><strong>{counts.uncertain}</strong>uncertain</button><button onClick={() => { setResultFilter('false'); go(2); }}><strong>{counts.false}</strong>do not match</button><button className="wizard-view-rows" onClick={() => go(2)}>View all results</button></section>
        {c.store.messages.some(message => message.status === 'pending') && <button className="wizard-message-link" onClick={onMessages}>View message approvals</button>}
      </aside>
    </div>
  </main>;
}
