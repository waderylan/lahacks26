import type { CompanyBills } from './types';
import type { RulesController } from './useRules';
import { actionLabel, leaves, savedPreset } from './rules';
import { STARTER_DEMOS } from './ruleStarterDemos';
import './ruleStarters.css';

export function RuleStarters({ c, data, onInspect, onDemoSample }: {
  c: RulesController; data: CompanyBills; onInspect: (id: string) => void; onDemoSample: () => void;
}) {
  const presets = c.presets.filter(preset => preset.starter);
  const companyId = data.company.companyId;
  const example = data.company.synthetic ? STARTER_DEMOS[companyId] : undefined;
  const added = presets.filter(preset => savedPreset(c.store.rules, preset, companyId)).length;
  return <details className="rule-starters" open>
    <summary><h2>Rule starter packs</h2><span>{added} of {presets.length} added</span></summary>
    <div className="starter-intro"><p>Accounting checks you can add in one click, then edit for {data.company.name}.</p>
      {example && !data.curatedSample && <button onClick={onDemoSample}>Use demo sample</button>}
      {data.curatedSample && <span>Demo sample loaded</span>}
    </div>
    <div className="starter-list">
      {presets.map(preset => {
        const saved = savedPreset(c.store.rules, preset, companyId);
        const recommended = example?.presetId === preset.id;
        const draft = c.draft?.presetId === preset.id && !c.saved;
        const preview = preset.build(companyId, c.actor || 'emp-ap');
        return <article key={preset.id} className={`starter-row${recommended ? ' recommended' : ''}`} aria-label={`${preset.name} starter`}>
          <div className="starter-title"><h3>{preset.name}</h3>{recommended && <span>Try first for this company</span>}</div>
          <div className="starter-description"><p>{preset.description}</p>
            <details className="starter-details"><summary>Conditions & actions</summary>
              <p>Starting conditions (editable):</p>{leaves(preview.expression).map(condition => condition.type === 'ai' && <p key={condition.id}>{condition.text}</p>)}
              <p>On a match:</p>{preview.actions.filter(action => !action.when || action.when === 'true').map(action => <p key={action.id}>{actionLabel(action)}</p>)}
              <p>{preview.actions.some(action => action.when === 'uncertain') ? 'Not enough information: create a clarification task. No match: no new action.' : 'Not enough information or no match: no action.'}</p>
              {preview.autoResolve && <p>A later No match clears this rule’s earlier flags and closes its unchanged tasks.</p>}
            </details>
            {recommended && <div className="starter-example"><p>{example.note}</p><button className="ghost" onClick={() => onInspect(`${companyId}:${example.rowId}`)}>Inspect example</button></div>}
          </div>
          <div className="starter-controls"><span className={saved ? 'starter-added' : 'starter-available'}>{saved ? `Saved · Automatic ${saved.enabled ? 'on' : 'off'}` : draft ? 'Draft · not saved' : 'Ready to add'}</span>
            <button disabled={c.busy || Boolean(c.storageError)} onClick={() => {
              if (saved) c.selectRule(saved.id);
              else if (draft) void c.save(false);
              else void c.addPreset(preset.id);
            }}>{saved ? 'Open rule' : draft ? 'Save draft' : 'Add rule'}</button>
            {saved && saved.name !== preset.name && <small>Saved as {saved.name}</small>}
          </div>
        </article>;
      })}
    </div>
    {c.store.rules.length > 0 && <section className="starter-saved" aria-label="Saved rules in this company">
      <h3>Your saved rules ({c.store.rules.length})</h3>
      <div>{c.store.rules.map(rule => <button key={rule.id} aria-pressed={c.draft?.id === rule.id} onClick={() => c.selectRule(rule.id)}>{rule.name}<span>Automatic {rule.enabled ? 'on' : 'off'}</span></button>)}</div>
    </section>}
    <p className="starter-footnote">Adding a starter saves it with automatic runs off. Review the live results before Run once. Message drafts require approval.</p>
  </details>;
}
