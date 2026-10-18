import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import express from 'express';
import { ActionStore } from './actionStore.ts';
import { sameOriginApi } from './actionRoutes.ts';
import { SavedSearchService, savedSearchRoutes } from './savedSearches.ts';
import type { SearchDefinition } from '../src/savedSearchTypes.ts';

const a = 'company-101', b = 'company-102';
const definition: SearchDefinition = { query: 'Invoices with a changed payment destination. ', type: 'invoice', status: 'needs_review', assignee: 'Rylan Wade', tab: 'all', matchesOnly: true, sort: { key: 'amountCents', dir: -1 } };
const setup = (filename = ':memory:') => {
  const db = new ActionStore(filename), service = new SavedSearchService(db, id => [a, b].includes(id));
  return { db, service };
};

test('named searches persist through reopen, can be renamed and edited, and deletion preserves other company data', t => {
  const filename = path.join(os.tmpdir(), `lahacks-searches-${randomUUID()}.sqlite`);
  let current = setup(filename);
  t.after(() => { current.db.db.close(); for (const suffix of ['', '-wal', '-shm']) fs.rmSync(filename + suffix, { force: true }); });
  const first = current.service.create(a, { name: ' Payment review ', definition });
  const other = current.service.create(b, { name: 'Payment review', definition });
  current.db.put('task', 'existing-task', a, { title: 'Preserve this task' });
  current.db.db.close(); current = setup(filename);
  assert.deepEqual(current.service.list(a), [first]);
  assert.equal(first.name, 'Payment review'); assert.equal(first.definition.query, definition.query);
  const edited = current.service.update(a, first.id, { name: 'Unassigned invoices', definition: { ...definition, assignee: 'unassigned' }, revision: first.revision });
  assert.equal(edited.revision, 2); assert.equal(edited.createdAt, first.createdAt); assert.equal(edited.definition.assignee, 'unassigned');
  current.db.db.close(); current = setup(filename);
  assert.equal(current.service.list(a)[0].name, 'Unassigned invoices');
  current.service.remove(a, first.id, edited.revision);
  assert.deepEqual(current.service.list(a), []); assert.deepEqual(current.service.list(b), [other]);
  assert.deepEqual(current.db.get('task', 'existing-task'), { title: 'Preserve this task' });
  assert.deepEqual(current.db.state(a), { tasks: [{ title: 'Preserve this task' }], runs: [], automations: [] });
});

test('duplicate names, stale edits, stale deletes, invalid filters, and cross-company writes are rejected', t => {
  const { db, service } = setup(); t.after(() => db.db.close());
  const saved = service.create(a, { name: 'Invoices', definition });
  assert.throws(() => service.create(a, { name: ' invoices ', definition }), /already exists/);
  const next = service.update(a, saved.id, { name: 'Invoices renamed', definition, revision: 1 });
  assert.throws(() => service.update(a, saved.id, { name: 'Stale edit', definition, revision: 1 }), /another session/);
  assert.throws(() => service.remove(a, saved.id, 1), /another session/);
  assert.throws(() => service.update(b, saved.id, { name: 'Cross company', definition, revision: 2 }), /not found/);
  assert.throws(() => service.remove(b, saved.id, 2), /not found/);
  for (const patch of [{ type: ['all'] }, { type: 'refund' }, { status: false }, { assignee: '' }, { matchesOnly: 'true' }, { sort: { key: 'date', dir: '1' } }, { query: 'x'.repeat(501) }]) {
    assert.throws(() => service.create(a, { name: 'Invalid', definition: { ...definition, ...patch } }));
  }
  assert.deepEqual(service.list(a), [next]); assert.deepEqual(service.list(b), []);
});

test('HTTP searches support company-scoped CRUD and reject foreign-origin changes', async t => {
  const { db, service } = setup(); t.after(() => db.db.close());
  const app = express(); app.use(express.json()); app.use('/api', sameOriginApi); savedSearchRoutes(app, service);
  const server = app.listen(0); t.after(() => new Promise<void>(resolve => server.close(() => resolve())));
  await new Promise<void>(resolve => server.once('listening', resolve));
  const address = server.address(); assert.ok(address && typeof address !== 'string');
  const base = `http://127.0.0.1:${address.port}/api/companies`;
  const call = (url: string, method: string, body: unknown, headers = {}) => fetch(url, { method, headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });
  const url = `${base}/${a}/searches`;
  assert.equal((await call(url, 'POST', { name: 'Foreign', definition }, { Origin: 'https://example.org' })).status, 403);
  assert.equal((await call(url, 'POST', { name: '', definition })).status, 400);
  assert.equal((await fetch(`${base}/company-missing/searches`)).status, 404);
  const response = await call(url, 'POST', { name: 'Saved via API', definition }); assert.equal(response.status, 201);
  const { search } = await response.json();
  assert.equal((await (await fetch(url)).json()).searches.length, 1);
  assert.deepEqual((await (await fetch(`${base}/${b}/searches`)).json()).searches, []);
  assert.equal((await call(`${base}/${b}/searches/${search.id}`, 'DELETE', { revision: 1 })).status, 404);
  assert.equal((await call(`${url}/${search.id}`, 'PATCH', { name: 'Edited via API', definition, revision: 1 })).status, 200);
  assert.equal((await call(`${url}/${search.id}`, 'DELETE', { revision: 1 })).status, 409);
  assert.equal((await call(`${url}/${search.id}`, 'DELETE', { revision: 2 })).status, 200);
  assert.deepEqual((await (await fetch(url)).json()).searches, []);
});
