import type { CompanyBills } from './types';
import type { RulesController } from './useRules';
import { actionLabel, leaves, savedPreset } from './rules';
import { STARTER_DEMOS } from './ruleStarterDemos';
import './ruleStarters.css';

/** The four starter packs are the visible review entry points. Each can be edited before it is saved or run. */
export function RuleStarters({ c, data, onInspect, onDemoSample }: {
  c: RulesController; data: CompanyBills; onInspect: (id: string) => void; onDemoSample: () => void;
}) {
  const presets = c.presets;
  const companyId = data.company.companyId;
  const example = STARTER_DEMOS[companyId];
  return <section className="rule-starters" aria-label="Rule starter packs">
    <header><h2>Rule starters</h2></header>
    <div className="starter-intro">
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
          <div className="starter-title"><h3>{preset.name}</h3>{recommended && <span>Suggested</span>}</div>
          <div className="starter-description"><p>{preset.description}</p>
            <details className="starter-details"><summary>Conditions & actions</summary>
              <p>Conditions</p>{leaves(preview.expression).map(condition => condition.type === 'ai' && <p key={condition.id}>{condition.text}</p>)}
              <p>Match</p>{preview.actions.filter(action => !action.when || action.when === 'true').map(action => <p key={action.id}>{actionLabel(action)}</p>)}
              <p>{preview.actions.some(action => action.when === 'uncertain') ? 'Uncertain: create a clarification task. No match: no new action.' : 'Uncertain or no match: no action.'}</p>
              {preview.autoResolve && <p>A later No match clears this rule’s earlier flags and closes its unchanged tasks.</p>}
            </details>
            {recommended && <div className="starter-example"><details><summary>Example details</summary><p>{example.note}</p></details><button className="ghost" onClick={() => onInspect(`${companyId}:${example.rowId}`)}>Inspect example</button></div>}
          </div>
          <div className="starter-controls"><span className={saved ? 'starter-added' : 'starter-available'}>{saved ? `Saved · Keep checking ${saved.enabled ? 'on' : 'off'}` : draft ? 'Draft · not saved' : 'Ready to add'}</span>
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
  </section>;
}
