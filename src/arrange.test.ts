import assert from 'node:assert/strict';
import { test } from 'node:test';
import { arrangeRows } from './arrange.ts';

const base = ['a', 'b', 'c', 'd', 'e', 'f'].map((id) => ({ id }));
const ids = (rows: { id: string }[]) => rows.map((r) => r.id);

test('matches move to the top, both groups keep their original relative order', () => {
  const out = arrangeRows(base, (id) => id === 'c' || id === 'e', true);
  assert.deepEqual(ids(out), ['c', 'e', 'a', 'b', 'd', 'f']);
});

test('clearing the query returns the exact original order', () => {
  const moved = arrangeRows(base, (id) => id === 'f', true);
  assert.notDeepEqual(ids(moved), ids(base));
  assert.deepEqual(ids(arrangeRows(base, () => true, false)), ids(base));
});

test('changing the query re-arranges from the original order, not the previous arrangement', () => {
  const first = arrangeRows(base, (id) => id === 'f', true);
  assert.equal(first[0].id, 'f');
  const second = arrangeRows(base, (id) => id === 'b' || id === 'd', true);
  assert.deepEqual(ids(second), ['b', 'd', 'a', 'c', 'e', 'f']);
});

test('results arriving progressively only lift newly matched rows', () => {
  let matched = new Set<string>();
  const view = () => ids(arrangeRows(base, (id) => matched.has(id), true));
  assert.deepEqual(view(), ids(base)); // nothing evaluated yet
  matched = new Set(['d']);
  assert.deepEqual(view(), ['d', 'a', 'b', 'c', 'e', 'f']);
  matched = new Set(['d', 'b']);
  assert.deepEqual(view(), ['b', 'd', 'a', 'c', 'e', 'f']);
});

test('no matches or all matches leave the order untouched; input is never mutated', () => {
  const copy = ids(base);
  assert.deepEqual(ids(arrangeRows(base, () => false, true)), copy);
  assert.deepEqual(ids(arrangeRows(base, () => true, true)), copy);
  assert.deepEqual(ids(base), copy);
});

import { sortByMatch, type MatchResult } from './arrange.ts';

const res: Record<string, MatchResult> = {
  a: { state: 'no_match', pMatch: 0.02 },
  b: { state: 'match', pMatch: 0.8 },
  c: { state: 'uncertain', pMatch: 0.45 },
  d: { state: 'match', pMatch: 0.95 },
  e: { state: 'no_match', pMatch: 0.1 },
  // f: not evaluated yet
};

test('sort by match: highest P(match) first regardless of state, unevaluated last', () => {
  assert.deepEqual(ids(sortByMatch(base, (id) => res[id], -1)), ['d', 'b', 'c', 'e', 'a', 'f']);
});

test('reverse sort flips evaluated rows but unevaluated rows stay last', () => {
  assert.deepEqual(ids(sortByMatch(base, (id) => res[id], 1)), ['a', 'e', 'c', 'b', 'd', 'f']);
});

test('sort by match is stable for ties and with no results leaves the order unchanged', () => {
  assert.deepEqual(ids(sortByMatch(base, () => undefined, -1)), ids(base));
  const tie = { state: 'match', pMatch: 0.9 } as MatchResult;
  assert.deepEqual(ids(sortByMatch(base, () => tie, -1)), ids(base));
});
