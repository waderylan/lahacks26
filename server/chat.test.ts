import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ActionStore } from './actionStore.ts';
import { ChatStore } from './chat.ts';
import { createReviewApp } from './app.ts';
import type { Row } from '../src/types.ts';

test('chat history persists in SQLite per company and employee', () => {
  const chat = new ChatStore(new ActionStore(':memory:'), {} as any);
  chat.save('company-001', { id: 't1', as: 'emp-ap', question: 'q1', createdAt: '2026-01-01T00:00:00Z' });
  chat.save('company-001', { id: 't2', as: 'emp-it', question: 'q2', createdAt: '2026-01-02T00:00:00Z' });
  chat.save('company-002', { id: 't3', as: 'emp-ap', question: 'q3', createdAt: '2026-01-03T00:00:00Z' });
  assert.deepEqual(chat.history('company-001', 'emp-ap').map(t => t.id), ['t1']);
  assert.throws(() => chat.save('company-001', { id: 't4', as: 'nobody', question: 'x' }));
  chat.clear('company-001', 'emp-ap');
  assert.deepEqual(chat.history('company-001', 'emp-ap'), []);
  assert.equal(chat.history('company-001', 'emp-it').length, 1);
  assert.equal(chat.history('company-002', 'emp-ap').length, 1);
});

test('restored chat uses production company guards, isolated history, and the revision-safe dashboard', async t => {
  const database = new ActionStore(':memory:');
  const source = (companyId: string) => ({ company: { companyId, name: companyId, industry: 'Services', profile: '', billCount: 1 }, totalBills: 1, sampled: false,
    rows: [{ id: `${companyId}:bill-1`, companyId, billId: 'bill-1', docNumber: 'INV-1', date: '2026-01-01', dueDate: '2026-02-01', vendor: 'Supplier', vendorId: 'vendor', description: 'Maintenance', itemNames: [], account: 'Maintenance', amountCents: 10000, expenseKind: '', costCategory: '', memo: '', project: null, supplyRole: null, lines: [], payments: [], vendorRecord: null, projectRecord: null } as Row] });
  const runtime = createReviewApp({ database, companies: () => ['company-101', 'company-102'].map(id => source(id).company), load: source, accounts: () => [], sample: () => null,
    chat: { configured: () => true, understand: async () => ({ intent: 'count', scope: 'everything', period: 'none', confidence: { intent: 1, scope: 1, period: 1 }, costNanoUsd: '0', ms: 1 }),
      route: async () => ({ employeeId: 'emp-ap', probability: .99 }) } });
  const server = runtime.app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  t.after(async () => { await runtime.stop(); server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); database.db.close(); });
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const post = (path: string, data: unknown, method = 'POST') => fetch(base + path, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
  const chat = '/api/companies/company-101/chat';
  assert.equal((await (await fetch(base + '/api/chat/models')).json()).jev, true);
  assert.equal((await (await post('/api/understand', { question: 'How many bills?', model: 'jev' })).json()).intent, 'count');
  assert.equal((await post('/api/understand', { question: 'How many bills?', model: 'invalid' })).status, 400);
  const turn = { id: 'turn', as: 'emp-ap', question: 'How many bills?' };
  assert.equal((await post(chat, turn)).status, 200);
  assert.equal((await (await fetch(base + chat + '?as=emp-ap')).json()).length, 1);
  assert.deepEqual(await (await fetch(base + chat + '?as=emp-cfo')).json(), []);
  assert.equal((await post(chat, { ...turn, as: 'emp-cfo' })).status, 400);
  assert.equal((await post('/api/companies/company-102/chat', turn)).status, 400);
  assert.equal((await fetch(base + '/api/companies/company-018/chat')).status, 404);
  assert.equal((await post('/api/companies/company-101/route', { ids: ['company-102:bill-1'], request: 'Review', model: 'jev' })).status, 400);
  const dashboard = '/api/companies/company-101/dashboard';
  assert.equal((await post(dashboard, { charts: [], expectedRevision: 0 }, 'PUT')).status, 200);
  assert.equal((await post(dashboard, { charts: [] }, 'PUT')).status, 409);
  assert.equal((await post(dashboard, { charts: [], expectedRevision: 0 }, 'PUT')).status, 409);
  assert.equal((await fetch(base + chat + '?as=emp-ap', { method: 'DELETE' })).status, 200);
  assert.deepEqual(await (await fetch(base + chat + '?as=emp-ap')).json(), []);
});
