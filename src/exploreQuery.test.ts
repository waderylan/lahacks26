import assert from 'node:assert/strict';
import test from 'node:test';
import { changeSimpleQuery, singleCondition, usesCombinedConditions } from './exploreQuery';
import type { RuleNode } from './rules';
import type { SearchDefinition } from './savedSearchTypes';

const condition: RuleNode = { id: 'saved-condition', type: 'ai', text: 'Tools', label: 'Equipment' };
const definition: SearchDefinition = { query: '', type: 'invoice', status: 'needs_review', assignee: 'Bookkeeper', tab: 'all', matchesOnly: false, sort: { key: 'match', dir: -1 } };

test('simple editing preserves saved condition IDs, labels, scope, and sort through rule conversion', () => {
  for (const type of ['all', 'any'] as const) {
    const expression: RuleNode = { id: 'saved-group', type, children: [condition] };
    const saved: SearchDefinition = { ...definition, expression };
    const edited = changeSimpleQuery(saved, expression, 'Equipment purchases');
    assert.deepEqual(edited.expression, { ...expression, children: [{ ...condition, text: 'Equipment purchases' }] });
    assert.equal(edited.type, 'invoice'); assert.equal(edited.assignee, 'Bookkeeper');
    assert.deepEqual(edited.sort, saved.sort);
    assert.equal(usesCombinedConditions(edited, edited.expression!), false);
    assert.equal(usesCombinedConditions({ ...edited, mode: 'combined' }, edited.expression!), true);
    assert.equal((condition as { text: string }).text, 'Tools');
  }
});

test('nested and negated searches never flatten or silently discard conditions', () => {
  for (const expression of [
    { id: 'not', type: 'not', children: [condition] },
    { id: 'both', type: 'all', children: [condition, { ...condition, id: 'other', text: 'Receipt' }] },
  ] as RuleNode[]) {
    const view: SearchDefinition = { ...definition, mode: 'simple', expression };
    assert.equal(singleCondition(expression), null);
    assert.equal(usesCombinedConditions(view, expression), true);
    assert.equal(changeSimpleQuery(view, expression, 'Replacement'), view);
  }
});
