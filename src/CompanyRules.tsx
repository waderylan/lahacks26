import { providerLabel } from './modelContext';
import { useState, type ReactNode } from 'react';
import type { CompanyBills } from './types';
import type { RulesController } from './useRules';
import { actionLabel, actionOutcome, leaves, RESULT_LABELS, type Rule } from './rules';
import { conditionText } from './ConditionEditor';
import { scopeLabel } from './ruleScope';
import { RuleStarters } from './RuleStarters';
import './ruleWizard.css';
import './companyRules.css';

export function CompanyRules({ c, data, onEdit, onPreview, onExplore, onInspect, onDemoSample, children }: {
  c: RulesController; data: CompanyBills; onEdit: () => void; onPreview: (rule: Rule) => void; onExplore: (rule: Rule) => void;
  onInspect: (id: string) => void; onDemoSample: () => void; children?: ReactNode;
}) {
  const [runningId, setRunningId] = useState('');
  const [confirm, setConfirm] = useState<{ id: string; action: 'delete' | 'run' } | null>(null);
  const disabled = !c.ready || c.busy || Boolean(c.storageError);
  const edit = (rule: Rule) => { c.selectRule(rule.id); onEdit(); };
  const starterController: RulesController = { ...c,
    selectRule: id => { c.selectRule(id); onEdit(); },
    addPreset: async id => { const added = await c.addPreset(id); if (added) onEdit(); return added; },
    loadPreset: id => { c.loadPreset(id); onEdit(); },
  };
  return <main className="rule-wizard company-rules" aria-label="Company rules">
    <header className="wizard-page-heading"><div><h1>Rules</h1><p>Run actions on transactions, or keep checking new and updated records.</p></div>
      <button className="primary" disabled={disabled} onClick={() => { c.newRule(); onEdit(); }}>New rule</button>
    </header>
    <div className="rules-explanation"><p><b>Run now</b> opens a preview before applying actions. <b>Run all records</b> includes records outside the preview sample and asks you to confirm.</p><p><b>Keep checking</b> checks new or changed records every 10 seconds while the server runs. Current records form the baseline when switched on.</p><p>Saving a rule does not run it. Message drafts need the sender’s approval.</p></div>
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
              <small>{providerLabel(rule.provider)} · {scopeLabel(rule.scope)}</small>
              <details className="company-rule-definition"><summary>Conditions and actions</summary><p>{conditionText(rule.expression)}</p>{rule.actions.map(action => <p key={action.id}><b>{RESULT_LABELS[actionOutcome(action)]}:</b> {actionLabel(action)}</p>)}</details>
            </th>
            <td><button className="company-rule-switch" role="switch" aria-checked={rule.enabled} aria-label={`Keep checking: ${rule.name}`} disabled={disabled} onClick={() => { void c.toggleRule(rule, !rule.enabled); }}>
              <span className="company-rule-switch-track" aria-hidden="true" />{rule.enabled ? 'On' : 'Off'}
            </button></td>
            <td>{run ? <><span>{run.matches} match · {run.uncertain} uncertain · {run.nonmatches} no match</span>
              <small>{run.transactionCount} checked · {new Date(run.checkedAt).toLocaleString()}</small>
              <small>{run.evaluation ? providerLabel(run.evaluation.provider) + ' · ' + run.evaluation.model : 'Unknown evaluator (legacy run)'} · {run.source === 'run' ? 'Manual run' : run.source === 'arrival' ? 'Arriving records' : 'Changed records'}</small>
              {run.revision !== rule.revision && <small>Results from revision {run.revision}; run again for the current rule.</small>}
            </> : previous ? <><span>Previous activity</span><small>{new Date(previous.timestamp).toLocaleString()} · Run again to record match totals.</small></> : <span className="muted">No runs recorded</span>}</td>
            <td><div className="company-rule-actions">
              <button className="primary" disabled={disabled} onClick={() => onPreview(rule)}>Run now</button>
              <button disabled={disabled} onClick={() => edit(rule)}>Edit rule</button>
              <button disabled={disabled} onClick={() => onExplore(rule)}>View in Explore</button>
              <button disabled={disabled} onClick={() => setConfirm({ id: rule.id, action: 'run' })}>{runningId === rule.id ? 'Running…' : 'Run all records'}</button>
              <button className="company-rule-delete" disabled={disabled} onClick={() => setConfirm({ id: rule.id, action: 'delete' })}>Delete</button>
            </div>
            {confirm?.id === rule.id && <div className="company-rule-confirm" data-action={confirm.action} role="group" aria-label={`${confirm.action === 'delete' ? 'Delete' : 'Run all records for'} ${rule.name}`}>
              {confirm.action === 'delete' ? <><p>Delete this rule? Existing tasks, flags, messages and history will stay.</p><button disabled={disabled} onClick={async () => { if (await c.deleteRule(rule)) setConfirm(null); }}>Delete rule</button></>
                : <><p>Run this saved rule’s actions on all available company records within its record filters, including records outside the preview? Message drafts still need approval.</p><button disabled={disabled} onClick={async () => { setRunningId(rule.id); try { if (await c.runRule(rule)) setConfirm(null); } finally { setRunningId(''); } }}>Run rule on all records</button></>}
              <button disabled={c.busy} onClick={() => setConfirm(null)}>Cancel</button>
            </div>}</td>
          </tr>;
        })}
      </tbody></table></div>
      {!c.ready ? <p className="company-rules-empty" role="status">Loading saved rules…</p> : !c.store.rules.length && <p className="company-rules-empty">No saved rules for this company. Choose New rule, create one in Explore, or add an example below.</p>}
    </section>
    {c.dirty && c.draft && <div className="rules-draft"><span>Unsaved draft: {c.draft.name}</span><button onClick={onEdit}>Continue editing</button></div>}
    <RuleStarters c={starterController} data={data} onInspect={onInspect} onDemoSample={onDemoSample} />
    {children}
  </main>;
}
