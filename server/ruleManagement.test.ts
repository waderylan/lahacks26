import assert from 'node:assert/strict';
import test from 'node:test';
import { ActionStore } from './actionStore.ts';
import { WorkspaceData } from './workspaceData.ts';
import { RuleService } from './ruleService.ts';
import { uid, type Rule } from '../src/rules.ts';
import type { Row } from '../src/types.ts';

function setup(count = 10) {
  const db = new ActionStore(':memory:');
  const data = new WorkspaceData(db, companyId => ({
    company: { companyId, name: companyId, industry: '', profile: '', billCount: count }, totalBills: count, sampled: false,
    rows: Array.from({ length: count }, (_, index): Row => ({
      id: `${companyId}:bill-${index}`, companyId, billId: `bill-${index}`, docNumber: `INV-${index}`,
      date: '2026-10-01', dueDate: '2026-11-01', vendor: 'Supplier', vendorId: 'supplier', description: 'Maintenance',
      itemNames: [], account: 'Maintenance', amountCents: 10000, expenseKind: '', costCategory: '', memo: '',
      project: null, supplyRole: null, lines: [], payments: [], vendorRecord: null, projectRecord: null,
    })),
  }), () => []);
  const judge = async (_company: string, _text: string, rows: Row[]) => Object.fromEntries(rows.map(row => [row.id, row.billId === 'bill-0' ? 'match' as const : row.billId === 'bill-1' ? 'uncertain' as const : 'no_match' as const]));
  const service = new RuleService(db, data, judge);
  const rule = (companyId: string): Rule => ({ id: uid(), companyId, name: 'Check supporting records', revision: 1, enabled: false,
    expression: { id: uid(), type: 'ai', label: 'Documentation', text: 'This charge lacks supporting documentation.' },
    actions: [{ id: uid(), type: 'flag', value: 'Needs records' }, { id: uid(), type: 'task', value: 'Review documentation', owner: 'Bookkeeper', dueDays: 2, when: 'uncertain' }],
  });
  return { db, data, service, judge, rule };
}

test('manual company runs work while off, exclude unreplayed records, retain counts, and remain idempotent', async t => {
  const { db, data, service, judge, rule } = setup(); t.after(() => db.db.close());
  const saved = rule('company-101'); service.save(saved.companyId, saved, null);
  await service.runAll(saved.companyId, saved.id, 1);
  let state = service.snapshot(saved.companyId);
  assert.equal(state.store.rules[0].enabled, false);
  assert.equal(state.runs[0].transactionCount, 5);
  assert.equal(state.runs[0].matches, 1); assert.equal(state.runs[0].uncertain, 1); assert.equal(state.runs[0].nonmatches, 3);
  const history = state.store.history.length;
  await service.runAll(saved.companyId, saved.id, 1);
  assert.equal(service.snapshot(saved.companyId).store.history.length, history);
  service.toggle(saved.companyId, saved.id, 1, true);
  const reopened = new RuleService(db, data, judge);
  assert.equal(reopened.snapshot(saved.companyId).store.rules[0].enabled, true);
  assert.equal(reopened.snapshot(saved.companyId).runs[0].transactionCount, 5);
  service.toggle(saved.companyId, saved.id, 1, false);
  await service.replay(saved.companyId);
  await reopened.runAll(saved.companyId, saved.id, 1);
  assert.equal(reopened.snapshot(saved.companyId).runs[0].transactionCount, 6);
});

test('deleting is scoped and revision checked, stops automation, and preserves prior review work', async t => {
  const { db, data, service, rule } = setup(); t.after(() => db.db.close());
  const a = rule('company-101'), b = rule('company-102');
  service.save(a.companyId, a, null); service.save(b.companyId, b, null);
  await service.runAll(a.companyId, a.id, 1);
  service.toggle(a.companyId, a.id, 1, true);
  assert.throws(() => service.delete(b.companyId, a.id, 1), /changed/);
  assert.throws(() => service.delete(a.companyId, a.id, 2), /changed/);
  const before = service.snapshot(a.companyId).store.history;
  const tasks = db.list('task', a.companyId);
  service.delete(a.companyId, a.id, 1);
  await service.scan();
  assert.deepEqual(service.snapshot(a.companyId).store.rules, []);
  assert.deepEqual(service.snapshot(a.companyId).runs, []);
  assert.deepEqual(service.snapshot(a.companyId).store.history, before);
  assert.deepEqual(db.list('task', a.companyId), tasks);
  assert.deepEqual(data.row(a.companyId, `${a.companyId}:bill-0`).dashboard?.flags, ['Needs records']);
  assert.equal(service.snapshot(b.companyId).store.rules[0].id, b.id);
  assert.throws(() => service.save(a.companyId, a, null), /was deleted/);
  await assert.rejects(service.runAll(a.companyId, a.id, 1), /changed/);
});

test('deleting during evaluation prevents the in-flight run from applying actions', async t => {
  const { db, data, rule } = setup(); t.after(() => db.db.close());
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const service = new RuleService(db, data, async (_company, _text, rows) => { await gate; return Object.fromEntries(rows.map(row => [row.id, 'match' as const])); });
  const saved = rule('company-101'); service.save(saved.companyId, saved, null);
  const running = service.runAll(saved.companyId, saved.id, 1);
  service.delete(saved.companyId, saved.id, 1); release();
  await assert.rejects(running, /changed during evaluation/);
  assert.deepEqual(service.snapshot(saved.companyId).store.history, []);
  assert.ok(data.bills(saved.companyId).rows.every(row => !row.dashboard?.flags.length));
});

test('whole-company runs include more than 1000 available rows while selected runs retain their limit', async t => {
  const { db, service, rule } = setup(1007); t.after(() => db.db.close());
  const saved = rule('company-101'); service.save(saved.companyId, saved, null);
  await service.runAll(saved.companyId, saved.id, 1);
  assert.equal(service.snapshot(saved.companyId).runs[0].transactionCount, 1002);
  await assert.rejects(service.run(saved.companyId, saved.id, 1, Array.from({ length: 1001 }, (_, index) => `company-101:bill-${index}`)), /1-1000/);
});

test('whole-company runs preserve Explore record filters and exclude other records from no-match actions', async t => {
  const { db, data, service, rule } = setup(); t.after(() => db.db.close());
  const saved: Rule = { ...rule('company-101'), scope: { type: 'invoice', status: 'all', assignee: 'all' },
    expression: { id: 'amount', type: 'standard', field: 'amountCents', operator: 'gt', value: '1000' },
    actions: [{ id: 'tag', type: 'tag', value: 'Invoice checked', when: 'false' }] };
  const invoice = data.row(saved.companyId, `${saved.companyId}:bill-0`);
  db.write({ ...invoice, txnType: 'invoice' }, invoice.sourceVersion!);
  service.save(saved.companyId, saved, null);
  await service.runAll(saved.companyId, saved.id, 1);
  assert.equal(service.snapshot(saved.companyId).runs[0].transactionCount, 1);
  assert.equal(service.snapshot(saved.companyId).runs[0].nonmatches, 1);
  assert.deepEqual(data.row(saved.companyId, invoice.id).dashboard?.tags, ['Invoice checked']);
  assert.ok(data.bills(saved.companyId).rows.filter(row => row.id !== invoice.id).every(row => !row.dashboard?.tags.length));
});
