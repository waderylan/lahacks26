import { EMPLOYEES } from '../src/employees.ts';
import type { Rule } from '../src/rules.ts';

/** Normalize only exact known IDs/names. Unknown historical labels remain available for reassignment. */
export function normalizeOwner(value: string): string {
  const owner = value.trim();
  return EMPLOYEES.find(employee => employee.id === owner || employee.name.toLowerCase() === owner.toLowerCase())?.id ?? owner;
}

export function normalizeRuleOwners(rule: Rule): Rule {
  if (!rule || !Array.isArray(rule.actions)) return rule;
  return { ...rule, actions: rule.actions.map(action => {
    if (action.type === 'assign' && typeof action.value === 'string') return { ...action, value: normalizeOwner(action.value) };
    if (action.type === 'task' && typeof action.owner === 'string') return { ...action, owner: normalizeOwner(action.owner) };
    return action;
  }), ...(rule.scope && { scope: { ...rule.scope, assignee: normalizeOwner(rule.scope.assignee) } }) };
}
