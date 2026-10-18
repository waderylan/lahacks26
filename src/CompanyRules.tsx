import { useState } from 'react';
import type { CompanyBills } from './types';
import type { RulesController } from './useRules';
import { actionLabel, actionOutcome, leaves, RESULT_LABELS, type Rule } from './rules';
import { conditionText } from './ConditionEditor';
import { scopeLabel } from './ruleScope';
import { RuleStarters } from './RuleStarters';
import './ruleWizard.css';
import './companyRules.css';

export function CompanyRules({ c, data, onEdit, onPreview, onExplore, onInspect, onDemoSample, onRestore, restoring }: {
  c: RulesController; data: CompanyBills; onEdit: () => void; onPreview: (rule: Rule) => void; onExplore: (rule: Rule) => void;
  onInspect: (id: string) => void; onDemoSample: () => void; onRestore: () => Promise<boolean>; restoring: boolean;
}) {
  const [runningId, setRunningId] = useState('');
  const [confirm, setConfirm] = useState<{ id: string; action: 'delete' | 'run' } | null>(null);
  const [confirmRestore, setConfirmRestore] = useState(false);
  const disabled = !c.ready || c.busy || Boolean(c.storageError);
  const edit = (rule: Rule) => { c.selectRule(rule.id); onEdit(); };
  const starterController: RulesController = { ...c,
    selectRule: id => { c.selectRule(id); onEdit(); },
    addPreset: async id => { const added = await c.addPreset(id); if (added) onEdit(); return added; },
  };
  return <main className="rule-wizard company-rules" aria-label="Company rules">
    <header className="wizard-page-heading"><div><h1>Rules</h1><p>Preview and run actions on transactions, or keep checking new and updated records.</p></div>
      <button className="primary" disabled={disabled} onClick={() => { c.newRule(); onEdit(); }}>New rule</button>
    </header>
    <div className="rules-explanation"><p><b>Preview & run</b> opens the results preview and runs nothing yet. There, Run now applies each rule’s configured actions to all {data.rows.length} preview records (of {data.totalBills} in this company) inside the rule’s record filters, including Not enough information results that have an action. Display filters in the preview do not narrow the run.</p><p><b>Run all records</b> applies the rule to all {data.totalBills} records in the company inside its record filters, after you confirm.</p><p><b>Keep checking</b> acts on new or changed records only, every 10 seconds while the server runs. Records already present when you switch it on are the baseline and are not acted on; use a run for those.</p><p>Saving a rule does not run it. Message drafts need the sender’s approval.</p></div>
    <section className="company-rules-list" aria-label="Saved rules in this company">
      <div className="company-rules-scroll"><table className="company-rules-table" aria-label="Company rules"><thead><tr>
        <th scope="col">Rule</th><th scope="col">Keep checking</th><th scope="col">Last check</th><th scope="col">Actions</th>
      </tr></thead><tbody>
        {c.store.rules.map(rule => {
          const run = c.runs.find(run => run.ruleId === rule.id);
          const previous = c.store.history.filter(entry => entry.ruleId === rule.id).sort((a, b) => b.timestamp.localeCompare(a.timestamp))[0];
          const open = c.issues.filter(issue => issue.ruleId === rule.id && issue.status === 'open').length;
          return <tr key={rule.id} data-rule-id={rule.id}>
            <th scope="row"><button className="company-rule-name" onClick={() => edit(rule)}>{rule.name}</button>
              <small>{leaves(rule.expression).length} conditions · {rule.actions.length} actions · {open} open issues · Revision {rule.revision}</small>
              <small>{scopeLabel(rule.scope)}</small>
              <details className="company-rule-definition"><summary>Conditions and actions</summary><p>{conditionText(rule.expression)}</p>{rule.actions.map(action => <p key={action.id}><b>{RESULT_LABELS[actionOutcome(action)]}:</b> {actionLabel(action)}</p>)}</details>
            </th>
            <td><button className="company-rule-switch" role="switch" aria-checked={rule.enabled} aria-label={`Keep checking: ${rule.name}`} disabled={disabled} onClick={() => { void c.toggleRule(rule, !rule.enabled); }}>
              <span className="company-rule-switch-track" aria-hidden="true" />{rule.enabled ? 'On' : 'Off'}
            </button></td>
            <td>{run ? <><span>{run.matches} match · {run.uncertain} uncertain · {run.nonmatches} no match</span>
              <small>{run.transactionCount} checked · {new Date(run.checkedAt).toLocaleString()}</small>
              <small>{run.source === 'run' ? 'Manual run' : run.source === 'arrival' ? 'Arriving records' : 'Changed records'}</small>
              {run.revision !== rule.revision && <small>Results from revision {run.revision}; run again for the current rule.</small>}
            </> : previous ? <><span>Previous activity</span><small>{new Date(previous.timestamp).toLocaleString()} · Run again to record match totals.</small></> : <span className="muted">No runs recorded</span>}</td>
            <td><div className="company-rule-actions">
              <button className="primary" disabled={disabled} title="Opens the results preview. Nothing runs until you confirm there." onClick={() => onPreview(rule)}>Preview & run</button>
              <button disabled={disabled} onClick={() => edit(rule)}>Edit rule</button>
              <button disabled={disabled} onClick={() => onExplore(rule)}>View in Explore</button>
              <button disabled={disabled} onClick={() => setConfirm({ id: rule.id, action: 'run' })}>{runningId === rule.id ? 'Running…' : 'Run all records'}</button>
              <button className="company-rule-delete" disabled={disabled} onClick={() => setConfirm({ id: rule.id, action: 'delete' })}>Delete</button>
            </div>
            {confirm?.id === rule.id && <div className="company-rule-confirm" data-action={confirm.action} role="group" aria-label={`${confirm.action === 'delete' ? 'Delete' : 'Run all records for'} ${rule.name}`}>
              {confirm.action === 'delete' ? <><p>Delete this rule? Existing tasks, flags, messages and history will stay.</p><button disabled={disabled} onClick={async () => { if (await c.deleteRule(rule)) setConfirm(null); }}>Delete rule</button></>
                : <><p>Run this saved rule’s actions on all {data.totalBills} company records inside its record filters, including records outside the preview? Message drafts still need approval.</p><button disabled={disabled} onClick={async () => { setRunningId(rule.id); try { if (await c.runRule(rule)) setConfirm(null); } finally { setRunningId(''); } }}>Run rule on all records</button></>}
              <button disabled={c.busy} onClick={() => setConfirm(null)}>Cancel</button>
            </div>}</td>
          </tr>;
        })}
      </tbody></table></div>
      {!c.ready ? <p className="company-rules-empty" role="status">Loading saved rules…</p> : !c.store.rules.length && <p className="company-rules-empty">No saved rules for this company. Add a starter below, choose New rule, or create one from Explore.</p>}
    </section>
    {c.dirty && c.draft && <div className="rules-draft"><span>Unsaved draft: {c.draft.name}</span><button onClick={onEdit}>Continue editing</button></div>}
    <RuleStarters c={starterController} data={data} onInspect={onInspect} onDemoSample={onDemoSample} />
    <section className="restore-demo" aria-label="Restore company"><div><h2>Restore this company</h2><p>Puts {data.company.name} back to its original records and clears its tasks, messages, activity, supporting details and rule results. Saved rules are kept with Keep checking off. Other companies are not affected.</p></div>
      {confirmRestore ? <div className="company-rule-confirm" role="group" aria-label="Confirm restore"><p>Restore {data.company.name}? This cannot be undone.</p><button disabled={disabled || restoring} onClick={async () => { if (await onRestore()) setConfirmRestore(false); }}>{restoring ? 'Restoring…' : 'Restore company'}</button><button disabled={restoring} onClick={() => setConfirmRestore(false)}>Cancel</button></div>
        : <button disabled={disabled} onClick={() => setConfirmRestore(true)}>Restore company…</button>}</section>
  </main>;
}
