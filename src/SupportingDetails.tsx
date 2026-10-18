import { useState } from 'react';
import type { Row } from './types';
import type { Rule, RuleIssue } from './rules';

/**
 * Adds evidence to a transaction and shows the way to a resolved issue: save details, recheck (automatic when the rule
 * has Keep checking on, otherwise manual), and the issue resolves when the rule finds No match.
 */
export function SupportingDetails({ row, save, busy, issues = [], rules = [], onRecheck }: {
  row: Row; save: (row: Row, title: string, text: string) => Promise<boolean>; busy: boolean;
  /** Open issues on this transaction and the saved rules that own them. */
  issues?: RuleIssue[]; rules?: Rule[]; onRecheck?: (rule: Rule) => Promise<unknown>;
}) {
  const [title, setTitle] = useState('');
  const [text, setText] = useState('');
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');
  const [rechecked, setRechecked] = useState<string[]>([]);
  const owners = [...new Map(issues.filter(issue => issue.status === 'open').map(issue => [issue.ruleId, rules.find(rule => rule.id === issue.ruleId)])).values()].filter((rule): rule is Rule => Boolean(rule));
  return <section className="supporting-details" aria-label="Add supporting details"><h3>Add supporting details</h3>
    {owners.length > 0 && <div className="resolution-route small">
      {owners.map(rule => <p key={rule.id}>{rule.name} · Keep checking {rule.enabled ? 'on' : 'off'}</p>)}
      <details className="copy-details"><summary>Recheck details</summary><p>Save details, then recheck. Keep checking rechecks changed records automatically. A No match resolves the issue if the rule has Clear resolved issues enabled.</p></details>
    </div>}
    <form onSubmit={async event => {
      event.preventDefault(); setSaved(false); setError(''); setRechecked([]);
      try { if (await save(row, title, text)) { setTitle(''); setText(''); setSaved(true); } }
      catch (error) { setError((error as Error).message); }
    }}>
      <label className="wizard-field">Title<input aria-label="Supporting details title" value={title} onChange={event => { setSaved(false); setTitle(event.target.value); }} maxLength={160} required placeholder="Receipt from October 1" /></label>
      <label className="wizard-field">Details<textarea aria-label="Supporting details text" value={text} onChange={event => { setSaved(false); setText(event.target.value); }} maxLength={8000} rows={4} required placeholder="Items purchased, approval or receipt details" /></label>
      <button type="submit" disabled={busy || !title.trim() || !text.trim()}>{busy ? 'Saving...' : 'Save supporting details'}</button>
      {saved && <p className="small" role="status">Details saved. {owners.some(rule => rule.enabled) ? 'Recheck scheduled.' : 'Run the rule again to recheck.'}</p>}
      {error && <p className="wizard-validation" role="alert">{error}</p>}
    </form>
    {saved && onRecheck && owners.length > 0 && <div className="recheck-actions">{owners.map(rule => <button key={rule.id} disabled={busy || rechecked.includes(rule.id)} onClick={async () => { await onRecheck(rule); setRechecked(done => [...done, rule.id]); }}>{rechecked.includes(rule.id) ? `Rechecked: ${rule.name}` : `Recheck now: ${rule.name}`}</button>)}</div>}
  </section>;
}
