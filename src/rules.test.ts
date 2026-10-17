import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compose, EMPTY_STORE, emptyTransaction, evaluateTree, exampleRule, executeRule, leaves, parseCents, resetCompanyDemo, standardResult, transactionVersion, undoEntry, validateRule, type Outcome, type Rule } from './rules';
import type { Row } from './types';

const row = { id: 'company-018:bill-original', companyId: 'company-018', amountCents: 1050, vendor: 'Original vendor', account: 'Inventory', memo: 'Original memo' } as Row;
const snapshotFor = (rule: Rule, result: Outcome = 'true') => ({ result, conditions: { [leaves(rule.expression)[0].id]: result, [leaves(rule.expression)[1].id]: 'false' as Outcome } });

test('three-valued truth tables preserve uncertainty, including under nested NOT', () => {
  const values = ['true', 'false', 'uncertain'] as const;
  const all = [['true', 'false', 'uncertain'], ['false', 'false', 'false'], ['uncertain', 'false', 'uncertain']];
  const any = [['true', 'true', 'true'], ['true', 'false', 'uncertain'], ['true', 'uncertain', 'uncertain']];
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) {
    assert.equal(compose('all', [values[i], values[j]]), all[i][j]);
    assert.equal(compose('any', [values[i], values[j]]), any[i][j]);
  }
  assert.equal(compose('not', ['true']), 'false');
  assert.equal(compose('not', ['false']), 'true');
  assert.equal(compose('not', ['uncertain']), 'uncertain');
  const rule = exampleRule(row.companyId);
  const ids = [rule.expression, ...('children' in rule.expression ? rule.expression.children : [])];
  assert.equal(evaluateTree(rule.expression, { [ids[1].id]: 'true' }), 'pending');
});

test('execution failures and incomplete expressions never become false through NOT', () => {
  assert.equal(compose('not', ['error']), 'error');
  assert.equal(compose('not', ['pending']), 'pending');
  assert.equal(compose('all', []), 'error');
  assert.equal(compose('not', ['true', 'false']), 'error');
  const rule = exampleRule(row.companyId);
  for (const outcome of ['pending', 'error', 'uncertain', 'false'] as Outcome[]) {
    const result = executeRule(EMPTY_STORE, rule, row, 'v1', snapshotFor(rule, outcome), 'arrival');
    assert.equal(result.history.filter(h => h.action).length, 0);
    assert.deepEqual(result.transactions, {});
  }
  const unresolved = executeRule(EMPTY_STORE, rule, row, 'v1', { result: 'true', conditions: { child: 'error' } }, 'arrival');
  assert.equal(unresolved, EMPTY_STORE);
  assert.equal(executeRule(EMPTY_STORE, rule, row, 'v1', { result: 'true', conditions: {} }, 'arrival'), EMPTY_STORE);
});

test('validation rejects missing criteria, actions, malformed NOT and excessive nesting', () => {
  const rule = exampleRule(row.companyId);
  assert.deepEqual(validateRule(rule), []);
  assert.ok(validateRule({ ...rule, actions: [] }).length);
  assert.ok(validateRule({ ...rule, expression: { id: 'empty', type: 'all', children: [] } }).length);
  assert.ok(validateRule({ ...rule, expression: { id: 'blank', type: 'ai', text: '', label: '' } }).length);
  assert.ok(validateRule({ ...rule, expression: { id: 'not', type: 'not', children: [rule.expression, structuredClone(rule.expression)] } }).length);
  let expression = rule.expression;
  for (let i = 0; i < 4; i++) expression = { id: `deep-${i}`, type: 'all', children: [expression] };
  assert.ok(validateRule({ ...rule, expression }).some(e => e.includes('three')));
});

test('money is compared in integer cents and rejects imprecise input', () => {
  assert.equal(parseCents('10.50'), 1050);
  assert.equal(parseCents('-0.01'), -1);
  assert.equal(parseCents('0.001'), null);
  assert.equal(parseCents('Infinity'), null);
  assert.equal(standardResult({ id: 'amount', type: 'standard', field: 'amountCents', operator: 'eq', value: '10.50' }, row, false), 'true');
  assert.equal(standardResult({ id: 'review', type: 'standard', field: 'review', operator: 'eq', value: 'needs_review' }, row, false), 'true');
});

test('actions are idempotent across repeated runs, arrivals, and persisted reloads', () => {
  const rule = exampleRule(row.companyId);
  rule.actions.push({ id: 'tag', type: 'tag', value: 'Audit' }, { id: 'pass', type: 'pass', value: '' });
  const snapshot = snapshotFor(rule);
  const first = executeRule(structuredClone(EMPTY_STORE), rule, row, 'v1', snapshot, 'run');
  assert.equal(first.history.length, 4);
  const reloaded = JSON.parse(JSON.stringify(first));
  const repeated = executeRule(reloaded, rule, row, 'v1', snapshot, 'run');
  const arrival = executeRule(repeated, rule, row, 'v1', snapshot, 'arrival');
  assert.equal(arrival.history.length, 4);
  assert.deepEqual(arrival.transactions[row.id].tags, ['Audit']);
  assert.equal(arrival.transactions[row.id].automatedCheck, true);
  assert.equal('reviewed' in arrival.transactions[row.id], false);
  assert.equal(executeRule(first, { ...rule, companyId: 'company-005' }, row, 'v1', snapshot, 'run'), first);
});

test('undo restores prior values, retains execution keys, and refuses conflicting edits', () => {
  const rule = exampleRule(row.companyId);
  const snapshot = snapshotFor(rule);
  const first = executeRule(structuredClone(EMPTY_STORE), rule, row, 'v1', snapshot, 'run');
  const ownerEntry = first.history.find(h => h.action?.type === 'assign')!;
  const conflict = { ...first, transactions: { [row.id]: { ...first.transactions[row.id], owner: 'Rylan Wade' } } };
  assert.match(undoEntry(conflict, ownerEntry.id).error!, /conflict/);
  assert.equal(undoEntry(conflict, ownerEntry.id).store.transactions[row.id].owner, 'Rylan Wade');
  const undone = undoEntry(first, ownerEntry.id);
  assert.equal(undone.error, undefined);
  assert.equal(undone.store.transactions[row.id].owner, '');
  assert.ok(undone.store.history.find(h => h.id === ownerEntry.id)?.undoneAt);
  assert.equal(executeRule(undone.store, rule, row, 'v1', snapshot, 'run').transactions[row.id].owner, '');
});

test('updated nonmatches record the outcome without reversing earlier actions', () => {
  const rule = exampleRule(row.companyId);
  const snapshot = snapshotFor(rule);
  const first = executeRule(structuredClone(EMPTY_STORE), rule, row, 'v1', snapshot, 'arrival');
  const updated = executeRule(first, rule, row, 'v2', snapshotFor(rule, 'false'), 'update');
  assert.equal(updated.history[0].action, null);
  assert.equal(updated.history[0].snapshot.result, 'false');
  assert.equal(updated.transactions[row.id].owner, 'Bookkeeper');
  assert.notEqual(transactionVersion(row), transactionVersion({ ...row, memo: 'Updated original memo' }));
  assert.notEqual(transactionVersion(row, false), transactionVersion(row, true));
  assert.deepEqual(emptyTransaction(), { flags: [], tags: [], owner: '', automatedCheck: false });
});

test('clean demo reset clears only the selected company and preserves disabled rule definitions', () => {
  const rule = { ...exampleRule(row.companyId), enabled: true };
  const otherRow = { ...row, id: 'company-005:bill-original', companyId: 'company-005' };
  const otherRule = { ...exampleRule(otherRow.companyId), enabled: true };
  let store = { ...structuredClone(EMPTY_STORE), rules: [rule, otherRule], arrivals: { [row.companyId]: [row.id], [otherRow.companyId]: [otherRow.id] } };
  store = executeRule(store, rule, row, 'v1', snapshotFor(rule), 'arrival');
  store = executeRule(store, otherRule, otherRow, 'v1', snapshotFor(otherRule), 'arrival');
  const reset = resetCompanyDemo(store, row.companyId);
  assert.equal(reset.transactions[row.id], undefined);
  assert.deepEqual(reset.arrivals[row.companyId], []);
  assert.ok(reset.history.every(h => h.companyId === otherRow.companyId));
  assert.ok(reset.executions.every(key => !key.includes(`:${row.companyId}:`)));
  assert.deepEqual(reset.rules[0], { ...rule, enabled: false });
  assert.deepEqual(reset.rules[1], otherRule);
  assert.deepEqual(reset.transactions[otherRow.id], store.transactions[otherRow.id]);
  assert.deepEqual(reset.arrivals[otherRow.companyId], [otherRow.id]);
  assert.equal(store.rules[0].enabled, true);
});
