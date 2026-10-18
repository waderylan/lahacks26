import { conditionText } from './ConditionEditor';
import { ResultBadge } from './RulesPanel';
import { scoreLabel, type ScoreKind } from './modelContext';
import type { RuleNode, Snapshot } from './rules';

/** Leaf scores stay separate: Jev does not return a probability for the combined expression. */
export function ConditionScores({ conditions, snapshot, probabilities = {}, scoreKinds = {} }: {
  conditions: RuleNode[];
  snapshot?: Snapshot;
  probabilities?: Record<string, number>;
  scoreKinds?: Record<string, ScoreKind | undefined>;
}) {
  return <>{conditions.map((condition, index) => {
    const result = snapshot?.conditions[condition.id] ?? 'pending';
    const probability = probabilities[condition.id];
    return <div key={condition.id} className="explore-condition-score" role="group" aria-label={`Condition ${index + 1} score`}>
      <span title={conditionText(condition)}>Condition {index + 1}</span>
      <ResultBadge value={result} />
      {condition.type === 'ai' && <small>{probability !== undefined
        ? `${Math.round(probability * 100)}% ${scoreLabel(scoreKinds[condition.id])}`
        : result === 'error' ? 'Unavailable' : result === 'pending' ? 'Checking' : 'Score unavailable'}</small>}
    </div>;
  })}</>;
}
