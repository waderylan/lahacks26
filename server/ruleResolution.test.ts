import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { ActionStore } from './actionStore';
import { WorkspaceData } from './workspaceData';
import { ActionEngine, type Judge } from './actionEngine';
import { RuleService } from './ruleService';
import type { Row } from '../src/types';
import type { ReviewTask } from '../src/actionTypes';
import type { Rule } from '../src/rules';

const companyId = 'company-018', id = `${companyId}:bill-1`;
const rows: Row[] = Array.from({ length: 8 }, (_, index) => ({ id: `${companyId}:bill-${index + 1}`, companyId, billId: `bill-${index + 1}`, docNumber: `B-${index + 1}`,
  date: '2026-10-01', dueDate: '2026-11-01', vendor: 'Supplier', vendorId: 'vendor-1', description: 'Services', itemNames: [], account: 'Services', amountCents: 10000,
  expenseKind: 'operating', costCategory: 'service', memo: 'Original memo', project: null, supplyRole: null, lines: [], payments: [], vendorRecord: null, projectRecord: null }));
const judge: Judge = async (_company, _criterion, rows) => Object.fromEntries(rows.map(row => [row.id, row.evidence?.some(record => record.text === 'Verified') ? 'no_match' : row.evidence?.length ? 'uncertain' : 'match']));
function setup(filename = ':memory:', evaluate = judge) {
  const db = new ActionStore(filename);
  const data = new WorkspaceData(db, () => ({ company: { companyId, name: 'Test company', industry: 'Services', profile: '', billCount: 8 }, rows, totalBills: 8, sampled: false }), () => []);
  return { db, data, rules: new RuleService(db, data, evaluate), actions: new ActionEngine(db, data, evaluate) };
}
const makeRule = (): Rule => ({ id: crypto.randomUUID(), companyId, name: 'Check supporting details', revision: 1, enabled: false, autoResolve: true,
  expression: { id: 'check', type: 'ai', text: 'This charge lacks support.', label: '' }, actions: [
    { id: 'flag', type: 'flag', value: 'Needs documents' },
    { id: 'task', type: 'task', value: 'Check receipt', owner: 'Bookkeeper', dueDays: 2 },
    { id: 'uncertain', type: 'flag', value: 'Needs documents', when: 'uncertain' },
  ] });
const add = (system: ReturnType<typeof setup>, text: string) => system.rules.addEvidence(companyId, id, 'Review note', text, system.data.row(companyId, id).sourceVersion);

test('adding unrestricted Explore filters preserves ownership of an older rule issue', async t => {
  const system = setup(); t.after(() => system.db.db.close());
  const rule = makeRule(); system.rules.save(companyId, rule, null);
  await system.rules.run(companyId, rule.id, 1, [id]);
  system.rules.save(companyId, { ...rule, scope: { type: 'all', status: 'all', assignee: 'all' } }, 1);
  add(system, 'Verified');
  await system.rules.run(companyId, rule.id, 2, [id]);
  assert.equal(system.rules.snapshot(companyId).issues[0].status, 'resolved');
  assert.deepEqual(system.data.row(companyId, id).dashboard?.flags, []);
});

test('supporting details trigger resolution after restart; uncertainty and unrelated flags stay intact', async () => {
  const filename = path.join(os.tmpdir(), `rule-resolution-${crypto.randomUUID()}.sqlite`);
  let system = setup(filename);
  try {
    const rule = makeRule();
    const original = system.data.row(companyId, id);
    system.rules.updateMetadata(companyId, id, { owner: 'Accountant', flags: ['Manual hold'], tags: [], automatedCheck: false }, original.sourceVersion!);
    system.rules.save(companyId, rule, null, true);
    await system.rules.run(companyId, rule.id, 1, [id]);
    const [task] = system.db.list<ReviewTask>('task', companyId);
    assert.equal(task.status, 'open'); assert.equal(task.ruleId, rule.id);
    assert.deepEqual(system.data.row(companyId, id).dashboard?.taskIds, [task.id]);
    add(system, 'Need follow-up'); await system.rules.scan();
    assert.equal(system.rules.snapshot(companyId).issues[0].status, 'open');
    assert.equal(system.rules.snapshot(companyId).issues[0].lastResult, 'uncertain');
    assert.equal(system.db.get<ReviewTask>('task', task.id)?.status, 'open');
    system.db.db.close(); system = setup(filename);
    assert.equal(system.rules.snapshot(companyId).issues[0].status, 'open');
    add(system, 'Verified'); await system.rules.scan();
    assert.equal(system.db.get<ReviewTask>('task', task.id)?.status, 'done');
    assert.deepEqual(system.data.row(companyId, id).dashboard?.flags, ['Manual hold']);
    assert.equal(system.data.row(companyId, id).dashboard?.owner, 'Accountant');
    assert.equal(system.data.row(companyId, id).dashboard?.reviewed, false);
    assert.equal(system.rules.snapshot(companyId).issues[0].status, 'resolved');
    assert.equal(system.rules.snapshot(companyId).store.history.filter(entry => entry.resolution).length, 1);
    await system.rules.scan(); await system.rules.run(companyId, rule.id, 1, [id]);
    assert.equal(system.rules.snapshot(companyId).store.history.filter(entry => entry.resolution).length, 1);
    assert.equal(system.db.list('task', companyId).length, 1);
    assert.equal(system.db.original(companyId, id).evidence, undefined);
    assert.equal(system.data.row(companyId, id).evidence?.length, 2);
  } finally { system.db.db.close(); for (const suffix of ['', '-wal', '-shm']) fs.rmSync(filename + suffix, { force: true }); }
});

test('resolution is opt-in and a preexisting manual flag is never claimed for removal', async t => {
  const system = setup(); t.after(() => system.db.db.close());
  const rule = { ...makeRule(), autoResolve: false };
  const row = system.data.bills(companyId).rows[0];
  system.rules.updateMetadata(companyId, id, { owner: '', flags: ['Needs documents'], tags: [], automatedCheck: false }, row.sourceVersion!);
  system.rules.save(companyId, rule, null, true); await system.rules.run(companyId, rule.id, 1, [id]);
  add(system, 'Verified'); await system.rules.scan();
  assert.deepEqual(system.data.row(companyId, id).dashboard?.flags, ['Needs documents']);
  assert.equal(system.db.list<ReviewTask>('task', companyId)[0].status, 'open');
  system.rules.save(companyId, { ...rule, autoResolve: true }, 1);
  await system.rules.run(companyId, rule.id, 2, [id]);
  assert.deepEqual(system.data.row(companyId, id).dashboard?.flags, ['Needs documents']);
  assert.equal(system.db.list<ReviewTask>('task', companyId)[0].status, 'done');
  assert.match(system.rules.snapshot(companyId).store.history.find(entry => entry.resolution)!.resolution!.kept[0], /Kept flag/);
});

test('shared flags remain until every claiming rule has resolved its issue', async t => {
  const outcomes: Record<string, 'match' | 'no_match'> = { A: 'match', B: 'match' };
  const system = setup(':memory:', async (_company, criterion, rows) => Object.fromEntries(rows.map(row => [row.id, outcomes[criterion]])));
  t.after(() => system.db.db.close());
  const first = { ...makeRule(), expression: { id: 'a', type: 'ai' as const, text: 'A', label: '' }, actions: [{ id: 'flag-a', type: 'flag' as const, value: 'Shared flag' }] };
  const second = { ...makeRule(), expression: { id: 'b', type: 'ai' as const, text: 'B', label: '' }, actions: [{ id: 'flag-b', type: 'flag' as const, value: 'Shared flag' }] };
  for (const rule of [first, second]) { system.rules.save(companyId, rule, null, true); await system.rules.run(companyId, rule.id, 1, [id]); }
  outcomes.A = 'no_match'; add(system, 'A cleared'); await system.rules.scan();
  assert.deepEqual(system.data.row(companyId, id).dashboard?.flags, ['Shared flag']);
  outcomes.B = 'no_match'; add(system, 'B cleared'); await system.rules.scan();
  assert.deepEqual(system.data.row(companyId, id).dashboard?.flags, []);
  assert.equal(system.rules.snapshot(companyId).issues.filter(issue => issue.status === 'resolved').length, 2);
});

test('manual removal and readdition detach a flag; a task reopened by a reviewer is preserved', async t => {
  const system = setup(); t.after(() => system.db.db.close());
  const rule = makeRule(); system.rules.save(companyId, rule, null, true); await system.rules.run(companyId, rule.id, 1, [id]);
  const [task] = system.db.list<ReviewTask>('task', companyId);
  const done = system.actions.updateTask(companyId, task.id, 'done', task.updatedAt);
  system.actions.updateTask(companyId, task.id, 'open', done.updatedAt);
  for (const flags of [[], ['Needs documents']]) {
    const row = system.data.row(companyId, id);
    system.rules.updateMetadata(companyId, id, { owner: '', flags, tags: [], automatedCheck: false }, row.sourceVersion!);
  }
  add(system, 'Verified'); await system.rules.scan();
  assert.deepEqual(system.data.row(companyId, id).dashboard?.flags, ['Needs documents']);
  assert.equal(system.db.get<ReviewTask>('task', task.id)?.status, 'open');
  assert.match(system.rules.snapshot(companyId).store.history.find(entry => entry.resolution)!.resolution!.kept.join(' '), /changed by a reviewer/);
});

test('edited conditions cannot clear issues opened by an earlier policy', async t => {
  const system = setup(); t.after(() => system.db.db.close());
  const rule = makeRule(); system.rules.save(companyId, rule, null, true); await system.rules.run(companyId, rule.id, 1, [id]);
  system.rules.save(companyId, { ...rule, expression: { id: 'different', type: 'ai', text: 'A different policy.', label: '' } }, 1);
  add(system, 'Verified'); await system.rules.scan();
  assert.equal(system.rules.snapshot(companyId).issues[0].status, 'open');
  assert.deepEqual(system.data.row(companyId, id).dashboard?.flags, ['Needs documents']);
  assert.equal(system.db.list<ReviewTask>('task', companyId)[0].status, 'open');
});

test('tasks are deduplicated across evidence changes and undo protects completed tasks', async t => {
  const system = setup(':memory:', async (_company, _criterion, rows) => Object.fromEntries(rows.map(row => [row.id, 'match'])));
  t.after(() => system.db.db.close());
  const rule = makeRule(); system.rules.save(companyId, rule, null, true); await system.rules.run(companyId, rule.id, 1, [id]);
  add(system, 'Still checking'); await system.rules.scan();
  assert.equal(system.db.list('task', companyId).length, 1);
  const receipt = system.rules.snapshot(companyId).store.history.find(entry => entry.action?.type === 'task')!;
  system.rules.undo(companyId, receipt.id);
  assert.equal(system.db.list<ReviewTask>('task', companyId)[0].status, 'cancelled');
  assert.deepEqual(system.data.row(companyId, id).dashboard?.taskIds, []);
  assert.throws(() => system.rules.undo(companyId, receipt.id), /conflict/);
});

test('supporting details reject stale, cross-company, and blank input without changing originals', t => {
  const system = setup(); t.after(() => system.db.db.close());
  const version = system.data.bills(companyId).rows[0].sourceVersion;
  add(system, 'Need follow-up');
  assert.throws(() => system.rules.addEvidence(companyId, id, 'Title', 'Other details', version), /changed/);
  assert.throws(() => system.rules.addEvidence(companyId, 'company-005:bill-1', 'Title', 'Details', '0'), /Cross-company/);
  assert.throws(() => system.rules.addEvidence(companyId, id, ' ', 'Details', system.data.row(companyId, id).sourceVersion), /title/);
  assert.equal(system.data.row(companyId, id).evidence?.length, 1);
  assert.equal(system.db.original(companyId, id).evidence, undefined);
});

test('failed persistence rolls back issue tracking, new tasks, and flags together', async t => {
  const system = setup(); t.after(() => system.db.db.close());
  const rule = makeRule(); system.rules.save(companyId, rule, null);
  const put = system.db.put.bind(system.db);
  system.db.put = (kind, ...args) => { if (kind === 'rule-state') throw new Error('Write failed'); return put(kind, ...args); };
  await assert.rejects(system.rules.run(companyId, rule.id, 1, [id]), /Write failed/);
  assert.equal(system.db.list('rule-issue', companyId).length, 0);
  assert.equal(system.db.list('task', companyId).length, 0);
  assert.deepEqual(system.data.row(companyId, id).dashboard?.flags, []);
});

test('an identical problem can reopen after resolution without repeating actions on a stable issue', async t => {
  const system = setup(':memory:', async (_company, _criterion, rows) => Object.fromEntries(rows.map(row => [row.id, row.memo === 'Cleared' ? 'no_match' : 'match'])));
  t.after(() => system.db.db.close());
  const rule = makeRule(); system.rules.save(companyId, rule, null, true); await system.rules.run(companyId, rule.id, 1, [id]);
  for (const memo of ['Cleared', 'Original memo']) {
    const row = system.data.row(companyId, id); system.db.write({ ...row, memo }, row.sourceVersion!); await system.rules.scan();
  }
  assert.deepEqual(system.data.row(companyId, id).dashboard?.flags, ['Needs documents']);
  assert.equal(system.db.list<ReviewTask>('task', companyId).filter(task => task.status === 'open').length, 1);
  assert.equal(system.rules.snapshot(companyId).issues.filter(issue => issue.status === 'open').length, 1);
  assert.equal(system.rules.snapshot(companyId).issues.filter(issue => issue.status === 'resolved').length, 1);
  await system.rules.run(companyId, rule.id, 1, [id]);
  assert.equal(system.db.list('task', companyId).length, 2);
});

test('failed and incomplete model judgments cannot resolve an open issue', async t => {
  let fail = false;
  const system = setup(':memory:', async (_company, _criterion, rows) => fail ? {} : Object.fromEntries(rows.map(row => [row.id, 'match'])));
  t.after(() => system.db.db.close());
  const rule = makeRule(); system.rules.save(companyId, rule, null); await system.rules.run(companyId, rule.id, 1, [id]);
  fail = true; add(system, 'More information');
  await assert.rejects(system.rules.run(companyId, rule.id, 1, [id]), /Incomplete/);
  assert.equal(system.rules.snapshot(companyId).issues[0].status, 'open');
  assert.deepEqual(system.data.row(companyId, id).dashboard?.flags, ['Needs documents']);
  assert.equal(system.db.list<ReviewTask>('task', companyId)[0].status, 'open');
});
