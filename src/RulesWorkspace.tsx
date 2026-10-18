import { conditionText } from './ConditionEditor';
import type { CompanyBills } from './types';
import type { RulesController } from './useRules';
import type { Rule } from './rules';
import { actionLabel, leaves } from './rules';
import { inScope, scopeLabel } from './ruleScope';
import { RuleWizard } from './RuleWizard';

export function RulesWorkspace({ c, data, editor, onEditor, onInspect, onMessages, onExplore }: {
  c: RulesController; data: CompanyBills; editor: number | null; onEditor: (step: number | null) => void;
  onInspect: (id: string) => void; onMessages: () => void; onExplore: (rule: Rule) => void;
}) {
  if (editor !== null) return <RuleWizard c={c} data={{ ...data, rows: data.rows.filter(row => inScope(row, c.draft?.scope)) }} initialStep={editor} onStepChange={onEditor} onClose={() => onEditor(null)} onInspect={onInspect} onMessages={onMessages} onExplore={() => c.draft && onExplore(c.draft)} />;
  return <main className="rules-library" aria-label="All rules"><header className="workspace-heading"><div><h1>Rules</h1><p>Run actions on transactions, or keep checking new and updated records.</p></div><button className="primary" disabled={!c.draft || c.busy} onClick={() => { c.newRule(); onEditor(0); }}>New rule</button></header>
    <div className="rules-explanation"><p><b>Run now</b> — preview existing records, then run the actions you chose.</p><p><b>Keep checking</b> — check new or changed records every 10 seconds while the server runs. Current records form the baseline when switched on.</p><p>Saving a rule does not run it. Message drafts always need the sender’s approval.</p></div>
    {!c.store.rules.length && <div className="rules-empty"><h2>No saved rules yet</h2><p>Try conditions in Explore, then choose Create rule. Or start here and add conditions and actions.</p></div>}
    <div className="rule-list">{c.store.rules.map(rule => {
      const entries = c.store.history.filter(entry => entry.ruleId === rule.id && (entry.action || entry.resolution));
      const latest = entries.reduce((last, entry) => entry.timestamp > last ? entry.timestamp : last, '');
      const open = c.issues.filter(issue => issue.ruleId === rule.id && issue.status === 'open').length;
      return <article className="rule-list-item" key={rule.id} aria-label={rule.name}><div className="rule-list-heading"><div><h2>{rule.name}</h2><p>{scopeLabel(rule.scope)}</p></div><label className="rule-toggle"><input type="checkbox" aria-label={`Keep checking: ${rule.name}`} checked={rule.enabled} disabled={c.busy || Boolean(c.storageError)} onChange={() => { void c.toggleEnabled(rule); }} /><span>Keep checking <b>{rule.enabled ? 'On' : 'Off'}</b></span></label></div><p className="rule-list-summary">{leaves(rule.expression).length} conditions · {open} open issues · {latest ? `Last action ${new Date(latest).toLocaleString()}` : 'No actions run yet'}</p><details><summary>Conditions and actions</summary><p>{conditionText(rule.expression)}</p>{rule.actions.map(action => <p key={action.id}>{actionLabel(action)}</p>)}</details><div className="rule-list-buttons"><button onClick={() => { c.selectRule(rule.id); onEditor(0); }}>Edit rule</button><button className="primary" onClick={() => { c.selectRule(rule.id); onEditor(2); }}>Run now</button><button className="ghost" onClick={() => onExplore(rule)}>View in Explore</button></div></article>;
    })}</div>
    {c.dirty && c.draft && <div className="rules-draft"><span>Unsaved draft: {c.draft.name}</span><button onClick={() => onEditor(0)}>Continue editing</button></div>}
  </main>;
}
