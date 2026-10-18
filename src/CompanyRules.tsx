import { useState } from 'react';
import type { CompanyBills } from './types';
import type { RulesController } from './useRules';
import { leaves, type Rule } from './rules';
import { RuleStarters } from './RuleStarters';
import './ruleWizard.css';
import './companyRules.css';

export function CompanyRules({ c, data, onEdit, onInspect, onDemoSample }: {
  c: RulesController; data: CompanyBills; onEdit: () => void; onInspect: (id: string) => void; onDemoSample: () => void;
}) {
  const [runningId, setRunningId] = useState('');
  const [deletingId, setDeletingId] = useState('');
  const disabled = !c.ready || c.busy || Boolean(c.storageError);
  const edit = (rule: Rule) => { c.selectRule(rule.id); onEdit(); };
  const starterController: RulesController = { ...c,
    selectRule: id => { c.selectRule(id); onEdit(); },
    addPreset: async id => { const added = await c.addPreset(id); if (added) onEdit(); return added; },
    loadPreset: id => { c.loadPreset(id); onEdit(); },
  };
  return <main className="rule-wizard company-rules" aria-label="Company rules">
    <header className="wizard-page-heading"><div><h1>Rules for {data.company.name}</h1><p>Manage your company’s saved rules.</p></div>
      <button className="primary" disabled={disabled} onClick={() => { c.newRule(); onEdit(); }}>New rule</button>
    </header>
    <section className="company-rules-list" aria-label="Saved rules in this company">
      <p className="company-rules-help">On checks new or changed transactions automatically. Run checks all available company transactions and applies the rule’s actions, even when automatic runs are off.</p>
      <div className="company-rules-scroll"><table className="company-rules-table" aria-label="Company rules"><thead><tr>
        <th scope="col">Rule</th><th scope="col">Automatic</th><th scope="col">Last run</th><th scope="col">Actions</th>
      </tr></thead><tbody>
        {c.store.rules.map(rule => {
          const run = c.runs.find(run => run.ruleId === rule.id);
          const previous = c.store.history.filter(entry => entry.ruleId === rule.id).sort((a, b) => b.timestamp.localeCompare(a.timestamp))[0];
          return <tr key={rule.id} data-rule-id={rule.id}>
            <th scope="row"><button className="company-rule-name" onClick={() => edit(rule)}>{rule.name}</button>
              <small>{leaves(rule.expression).length} {leaves(rule.expression).length === 1 ? 'condition' : 'conditions'} · {rule.actions.length} {rule.actions.length === 1 ? 'action' : 'actions'} · Revision {rule.revision}</small>
            </th>
            <td><button className="company-rule-switch" role="switch" aria-checked={rule.enabled} aria-label={`Automatic runs for ${rule.name}`} disabled={disabled} onClick={() => { void c.toggleRule(rule, !rule.enabled); }}>
              <span className="company-rule-switch-track" aria-hidden="true" />{rule.enabled ? 'On' : 'Off'}
            </button></td>
            <td>{run ? <><span>{run.matches} match · {run.uncertain} uncertain · {run.nonmatches} no match</span>
              <small>{run.transactionCount} checked · {new Date(run.checkedAt).toLocaleString()}</small>
              {run.revision !== rule.revision && <small>Results from revision {run.revision}; run again for the current rule.</small>}
            </> : previous ? <><span>Previous activity</span><small>{new Date(previous.timestamp).toLocaleString()} · Run again to record match totals.</small></> : <span className="muted">No runs recorded</span>}</td>
            <td><div className="company-rule-actions">
              <button disabled={disabled} onClick={async () => { setRunningId(rule.id); try { await c.runRule(rule); } finally { setRunningId(''); } }}>{runningId === rule.id ? 'Running…' : 'Run'}</button>
              <button disabled={disabled} onClick={() => edit(rule)}>Edit</button>
              <button className="company-rule-delete" disabled={disabled} onClick={() => setDeletingId(rule.id)}>Delete</button>
            </div>
            {deletingId === rule.id && <div className="company-rule-confirm" role="group" aria-label={`Delete ${rule.name}`}>
              <p>Delete this rule? Existing tasks, flags, messages and history will stay.</p>
              <button disabled={disabled} onClick={async () => { if (await c.deleteRule(rule)) setDeletingId(''); }}>Delete rule</button>
              <button disabled={c.busy} onClick={() => setDeletingId('')}>Cancel</button>
            </div>}</td>
          </tr>;
        })}
      </tbody></table></div>
      {!c.ready ? <p className="company-rules-empty" role="status">Loading saved rules…</p> : !c.store.rules.length && <p className="company-rules-empty">No saved rules for this company. Choose New rule or add an example below.</p>}
    </section>
    <RuleStarters c={starterController} data={data} onInspect={onInspect} onDemoSample={onDemoSample} />
  </main>;
}
