import type { AICondition, RuleNode } from './rules';
import type { SearchDefinition } from './savedSearchTypes';

export function singleCondition(expression: RuleNode): AICondition | null {
  if (expression.type === 'ai') return expression;
  if ((expression.type === 'all' || expression.type === 'any') && expression.children.length === 1 && expression.children[0].type === 'ai') return expression.children[0];
  return null;
}

/** Compound or negated expressions must always retain their full editor. */
export const usesCombinedConditions = (view: SearchDefinition, expression: RuleNode): boolean => view.mode === 'combined' || !singleCondition(expression);

export function changeSimpleQuery(view: SearchDefinition, expression: RuleNode, text: string): SearchDefinition {
  const condition = singleCondition(expression);
  if (!condition) return view;
  return { ...view, mode: 'simple', query: text, ...(view.expression && {
    expression: expression.type === 'all' || expression.type === 'any' ? { ...expression, children: [{ ...condition, text }] } : { ...condition, text },
  }) };
}
