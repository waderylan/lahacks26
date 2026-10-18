import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import { ActionStore } from './actionStore.ts';
import { WorkspaceData } from './workspaceData.ts';
import { ActionEngine, validateAction } from './actionEngine.ts';
import { actionRoutes } from './actionRoutes.ts';
import type { CompanyBills, Row } from '../src/types.ts';
import type { ActionSelection } from '../src/actionTypes.ts';

const companyId = 'company-018';
const row = (index: number, company = companyId): Row => ({ id: `${company}:bill-${index}`, companyId: company, billId: `bill-${index}`, docNumber: `B-${index}`, date: '2026-10-01', dueDate: '2026-11-01', vendor: `Vendor ${index}`, vendorId: `vendor-${index}`, description: 'Equipment purchase', itemNames: ['Tools'], account: 'Equipment', amountCents: 10050, expenseKind: 'product', costCategory: 'goods', memo: 'Original memo', project: null, supplyRole: null, lines: [{ description: 'Original equipment' }], payments: [], vendorRecord: null, projectRecord: null });
const selection = (ids = [row(1).id]): ActionSelection => ({ ids, scope: 'selected' });
const reviewTask = { type: 'task' as const, title: 'Review receipt', owner: 'Rylan Wade', dueDate: '2026-11-01' };
function setup(filename = ':memory:') {
  const store = new ActionStore(filename);
  const originals = new Map<string, CompanyBills>();
  const data = new WorkspaceData(store, id => {
    if (!originals.has(id)) originals.set(id, { company: { companyId: id, name: id, industry: '', profile: '', billCount: 3 }, totalBills: 3, sampled: false, rows: [1, 2, 3].map(index => row(index, id)) });
    return originals.get(id)!;
  }, () => [{ id: 'equipment', name: 'Equipment' }, { id: 'office', name: 'Office expenses' }]);
  const engine = new ActionEngine(store, data, async (_company, criterion, rows) => Object.fromEntries(rows.map(row => [row.id, criterion === 'Only uncertain' || row.id.endsWith('-3') ? 'uncertain' : row.id.endsWith('-2') ? 'no_match' : 'match'])));
  return { store, data, engine, originals };
}

test('tasks and assignments persist after closing and reopening SQLite; apply is idempotent', async () => {
  const filename = path.join(os.tmpdir(), `lahacks-actions-${crypto.randomUUID()}.sqlite`);
  const first = setup(filename);
  try {
    const plan = await first.engine.preview(companyId, selection(), reviewTask);
    assert.equal(first.store.state(companyId).tasks.length, 0);
    const receipt = first.engine.apply(companyId, plan.id);
    assert.equal(receipt.items[0].status, 'succeeded');
    assert.equal(first.data.row(companyId, row(1).id).dashboard?.owner, 'Rylan Wade');
    first.engine.apply(companyId, plan.id);
    assert.equal(first.store.state(companyId).tasks.length, 1);
    first.store.db.close();
    const second = setup(filename);
    try {
      assert.equal(second.store.state(companyId).tasks[0].title, 'Review receipt');
      assert.equal(second.data.row(companyId, row(1).id).dashboard?.owner, 'Rylan Wade');
      assert.equal(second.store.state(companyId).runs[0].items[0].status, 'succeeded');
    } finally { second.store.db.close(); }
  } finally { try { first.store.db.close(); } catch {} for (const suffix of ['', '-wal', '-shm']) fs.rmSync(filename + suffix, { force: true }); }
});

test('category and memo edits affect the working bill, preserve source records, and undo', async t => {
  const { store, data, engine, originals } = setup(); t.after(() => store.db.close());
  const plan = await engine.preview(companyId, selection(), { type: 'category', accountId: 'office' });
  assert.equal(data.row(companyId, row(1).id).account, 'Equipment');
  engine.apply(companyId, plan.id);
  assert.equal(data.row(companyId, row(1).id).account, 'Office expenses');
  assert.equal(originals.get(companyId)!.rows[0].account, 'Equipment');
  assert.equal(store.original(companyId, row(1).id).account, 'Equipment');
  engine.undo(companyId, plan.id, row(1).id);
  assert.equal(data.row(companyId, row(1).id).account, 'Equipment');
  const memo = await engine.preview(companyId, selection(), { type: 'memo', text: 'Receipt verified' });
  engine.apply(companyId, memo.id);
  assert.equal(data.row(companyId, row(1).id).memo, 'Receipt verified');
  engine.undo(companyId, memo.id, row(1).id);
  assert.equal(data.row(companyId, row(1).id).memo, 'Original memo');
});

test('server rechecks search evidence and never acts on uncertain or nonmatching bills', async t => {
  const { store, engine } = setup(); t.after(() => store.db.close());
  const plan = await engine.preview(companyId, { ids: [1, 2, 3].map(index => row(index).id), criterion: 'Equipment', scope: 'matches' }, reviewTask);
  assert.deepEqual(plan.items.map(item => item.status), ['ready', 'skipped', 'skipped']);
  const receipt = engine.apply(companyId, plan.id);
  assert.deepEqual(receipt.items.map(item => item.status), ['succeeded', 'skipped', 'skipped']);
  assert.equal(store.state(companyId).tasks.length, 1);
});

test('grouped OR/AND/NOT uses persisted review status and preserves uncertainty', async t => {
  const { store, engine } = setup(); t.after(() => store.db.close());
  const plan = await engine.preview(companyId, { ids: [row(1).id, row(3).id], scope: 'matches', expression: { id: 'root', type: 'all', children: [{ id: 'status', type: 'standard', field: 'review', operator: 'eq', value: 'needs_review' }, { id: 'not', type: 'not', children: [{ id: 'ai', type: 'ai', text: 'Only uncertain', label: '' }] }] } }, reviewTask);
  assert.ok(plan.items.every(item => item.status === 'skipped'));
  assert.equal(store.state(companyId).tasks.length, 0);
});

test('stale previews fail without changing the bill; undo cannot overwrite later edits', async t => {
  const { store, engine, data } = setup(); t.after(() => store.db.close());
  const old = await engine.preview(companyId, selection(), { type: 'memo', text: 'Old proposed memo' });
  const current = await engine.preview(companyId, selection(), { type: 'memo', text: 'Current memo' });
  engine.apply(companyId, current.id);
  assert.equal(engine.apply(companyId, old.id).items[0].status, 'failed');
  const later = await engine.preview(companyId, selection(), { type: 'assign', owner: 'Accounts team' }); engine.apply(companyId, later.id);
  assert.throws(() => engine.undo(companyId, current.id, row(1).id), /conflict/);
  assert.equal(data.row(companyId, row(1).id).memo, 'Current memo');
  assert.equal(data.row(companyId, row(1).id).dashboard?.owner, 'Accounts team');
});

test('duplicate tasks are skipped and completed tasks are protected from undo', async t => {
  const { store, engine } = setup(); t.after(() => store.db.close());
  const first = await engine.preview(companyId, selection(), reviewTask); engine.apply(companyId, first.id);
  const second = await engine.preview(companyId, selection(), reviewTask);
  assert.equal(engine.apply(companyId, second.id).items[0].status, 'skipped');
  const task = store.state(companyId).tasks[0];
  engine.updateTask(companyId, task.id, 'done', task.updatedAt);
  assert.throws(() => engine.undo(companyId, first.id, row(1).id), /task changed/);
  assert.equal(store.state(companyId).tasks[0].status, 'done');
});

test('failed receipt writes roll back the task and assignment in the same transaction', async t => {
  const { store, engine, data } = setup(); t.after(() => store.db.close());
  const plan = await engine.preview(companyId, selection(), reviewTask);
  const original = store.put.bind(store);
  store.put = (kind, id, company, value) => { if (kind === 'plan' && (value as any).status === 'finished') throw new Error('Disk failure'); original(kind, id, company, value); };
  assert.throws(() => engine.apply(companyId, plan.id), /Disk failure/);
  assert.equal(store.state(companyId).tasks.length, 0);
  assert.equal(data.row(companyId, row(1).id).dashboard?.owner, '');
  assert.equal(engine.plan(companyId, plan.id).status, 'preview');
  store.put = original;
  assert.equal(engine.apply(companyId, plan.id).items[0].status, 'succeeded');
});

test('companies are isolated and malformed inputs cannot mutate records', async t => {
  const { store, engine } = setup(); t.after(() => store.db.close());
  await assert.rejects(engine.preview(companyId, selection([row(1, 'company-002').id]), reviewTask), /Cross-company/);
  await assert.rejects(engine.preview(companyId, selection(), { type: 'category', accountId: 'other-company-account' }), /Choose a category/);
  assert.throws(() => validateAction({ ...reviewTask, dueDate: '2026-02-31' }), /Complete/);
  const plan = await engine.preview(companyId, selection(), reviewTask); engine.apply(companyId, plan.id);
  assert.throws(() => engine.undo('company-002', plan.id, row(1).id), /not found/);
  assert.equal(store.state('company-002').tasks.length, 0);
});

test('enabled server automation establishes a baseline then acts on changed matching records once', async t => {
  const { store, engine, data } = setup(); t.after(() => store.db.close());
  const rule = await engine.automate(companyId, { ...selection(), criterion: 'Equipment', scope: 'matches' }, { type: 'flag', label: 'Check receipt' });
  await engine.scan(); assert.equal(store.state(companyId).runs.length, 0);
  const edit = await engine.preview(companyId, selection(), { type: 'memo', text: 'New equipment memo' }); engine.apply(companyId, edit.id);
  await engine.scan();
  assert.deepEqual(data.row(companyId, row(1).id).dashboard?.flags, ['Check receipt']);
  const count = store.state(companyId).runs.length;
  await engine.scan(); assert.equal(store.state(companyId).runs.length, count);
  engine.pauseAutomation(companyId, rule.id);
  assert.equal(store.state(companyId).automations[0].enabled, false);
});

test('HTTP action routes expose durable task status, owners and receipts and reject cross-origin writes', async t => {
  const { store, engine } = setup();
  const app = express(); app.use(express.json()); actionRoutes(app, engine);
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  t.after(async () => { await new Promise<void>(resolve => server.close(() => resolve())); store.db.close(); });
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}/api/companies/${companyId}`;
  const post = (url: string, body: unknown, origin?: string) => fetch(base + url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(origin ? { Origin: origin } : {}) }, body: JSON.stringify(body) });
  assert.equal((await post('/actions/preview', { selection: selection(), action: reviewTask }, 'https://unrelated.example')).status, 403);
  const preview = await (await post('/actions/preview', { selection: selection(), action: reviewTask })).json() as any;
  assert.equal((await post(`/actions/${preview.id}/apply`, {})).status, 200);
  const workspace = await (await fetch(base + '/workspace')).json() as any;
  assert.equal(workspace.tasks.length, 1);
  assert.deepEqual(workspace.owners, ['Rylan Wade']);
  assert.equal(workspace.rows.find((row: Row) => row.id.endsWith('bill-1')).dashboard.owner, 'Rylan Wade');
});
