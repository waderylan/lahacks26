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
import type { Row } from '../src/types.ts';
import type { SearchSource } from './searchMonitor.ts';

const a = 'company-101', b = 'company-102';
const definition: SearchDefinition = { query: 'Invoices with a changed payment destination. ', type: 'invoice', status: 'needs_review', assignee: 'Rylan Wade', tab: 'all', matchesOnly: true, sort: { key: 'amountCents', dir: -1 } };
const setup = (filename = ':memory:') => {
  const db = new ActionStore(filename), service = new SavedSearchService(db, id => [a, b].includes(id));
  return { db, service };
};

test('views preserve grouped conditions and legacy monitoring is paused with its definition retained', t => {
  const { db, service } = setup(); t.after(() => db.db.close());
  const expression = { id: 'root', type: 'all', children: [
    { id: 'amount', type: 'standard', field: 'amountCents', operator: 'gt', value: '500' },
    { id: 'not', type: 'not', children: [{ id: 'english', type: 'ai', label: '', text: 'The receipt supports the charge.' }] },
  ] };
  const view = service.create(a, { name: 'Receipt review', definition: { ...definition, mode: 'combined', expression, result: 'uncertain' } });
  assert.deepEqual(view.definition.expression, expression);
  assert.equal(service.get(a, view.id).definition.mode, 'combined');
  assert.equal(view.definition.result, 'uncertain');
  const enabled = service.toggle(a, view.id, view.revision, true);
  service.retireMonitoring();
  const retired = service.get(a, view.id);
  assert.equal(retired.enabled, false);
  assert.equal(retired.revision, enabled.revision + 1);
  assert.deepEqual(retired.definition, view.definition);
  assert.ok(db.get('saved-view-migration', view.id));
  service.retireMonitoring();
  assert.equal(service.get(a, view.id).revision, retired.revision);
  assert.throws(() => service.create(a, { name: 'Broken', definition: { ...definition, expression: { ...expression, children: [] } } }), /empty/);
  assert.throws(() => service.create(a, { name: 'Unknown mode', definition: { ...definition, mode: 'unknown' } }), /simple search/);
});

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

const watchDefinition: SearchDefinition = { ...definition, query: 'The record needs review.', type: 'all', status: 'all', assignee: 'all' };
const row = (n: number, memo = 'yes'): Row => ({ id: `${a}:record-${n}`, companyId: a, billId: `record-${n}`, docNumber: `R-${n}`, date: '2026-10-01', dueDate: '2026-11-01', vendor: `Counterparty ${n}`, vendorId: `party-${n}`, description: 'Business purchase', itemNames: [], account: 'Equipment', amountCents: 10000, expenseKind: 'product', costCategory: 'goods', memo, project: null, supplyRole: null, lines: [], payments: [], vendorRecord: null, projectRecord: null, dashboard: { owner: '', flags: [], tags: [], reviewed: false, automatedCheck: false, taskIds: [] } });
const answer: SearchSource['judge'] = async (_company, _criterion, rows) => Object.fromEntries(rows.map(row => [row.id, row.memo.startsWith('yes') ? 'match' : row.memo === 'unknown' ? 'uncertain' : 'no_match']));

test('baseline is not New; only new matches are counted, acknowledgments cannot hide later arrivals or repeat matches', async t => {
  const { db } = setup(); t.after(() => db.db.close());
  const rows = [row(1), row(2, 'no'), row(3, 'unknown')]; let calls = 0;
  const service = new SavedSearchService(db, id => [a, b].includes(id), { rows: id => structuredClone(rows.filter(row => row.companyId === id)), judge: async (...args) => { calls++; return answer(...args); } });
  const saved = service.create(a, { name: 'Watch', definition: watchDefinition });
  service.toggle(a, saved.id, saved.revision, true); await service.monitor.check(saved.id);
  assert.deepEqual(service.get(a, saved.id).tracking, { status: 'ready', lastCheckedAt: service.get(a, saved.id).tracking.lastCheckedAt, changedRecords: 3, matches: 1, uncertain: 1, newMatches: 0, error: null, retryAt: null });
  const baselineCalls = calls; await service.monitor.scan(); assert.equal(calls, baselineCalls, 'unchanged records must not be judged again');
  rows[0].memo = 'yes with more details'; rows[1].memo = 'yes'; rows.push(row(4));
  await service.monitor.scan();
  assert.equal(service.get(a, saved.id).tracking.newMatches, 2, 'changed matching rows are not new; new and previously nonmatching rows are');
  const viewed = service.newMatches(a, saved.id).matches;
  rows.push(row(5)); await service.monitor.scan();
  service.seen(a, saved.id, viewed.map(({ row, token }) => ({ id: row.id, token })));
  assert.equal(service.get(a, saved.id).tracking.newMatches, 1, 'an arrival after the viewed snapshot stays unread');
  rows[1].memo = 'no'; await service.monitor.scan(); rows[1].memo = 'yes'; await service.monitor.scan();
  service.seen(a, saved.id, viewed.map(({ row, token }) => ({ id: row.id, token })));
  assert.equal(service.get(a, saved.id).tracking.newMatches, 2, 'old acknowledgments cannot clear a later match transition');
  assert.throws(() => service.newMatches(b, saved.id), /not found/);
  assert.deepEqual(db.state(a), { tasks: [], runs: [], automations: [] }, 'search checks never execute actions');
});

test('Off stops automatic work, re-enabling catches up, and edited criteria establish a fresh baseline', async t => {
  const { db } = setup(); t.after(() => db.db.close()); const rows = [row(1)];
  const service = new SavedSearchService(db, id => [a, b].includes(id), { rows: () => structuredClone(rows), judge: answer });
  let saved = service.create(a, { name: 'Watch', definition: watchDefinition });
  saved = service.toggle(a, saved.id, saved.revision, true); await service.monitor.check(saved.id);
  saved = service.toggle(a, saved.id, saved.revision, false);
  rows.push(row(2)); await service.monitor.scan(); assert.equal(service.get(a, saved.id).tracking.matches, 1);
  saved = service.toggle(a, saved.id, saved.revision, true); await service.monitor.check(saved.id);
  assert.equal(service.get(a, saved.id).tracking.newMatches, 1);
  saved = service.update(a, saved.id, { name: 'Renamed', definition: watchDefinition, revision: saved.revision });
  assert.equal(saved.tracking.newMatches, 1, 'rename preserves new matches');
  saved = service.update(a, saved.id, { name: 'Renamed', definition: { ...watchDefinition, status: 'reviewed' }, revision: saved.revision });
  assert.equal(saved.tracking.status, 'never'); await service.monitor.scan();
  assert.equal(service.get(a, saved.id).tracking.newMatches, 0); assert.equal(service.get(a, saved.id).tracking.matches, 0);
  rows[0].dashboard!.reviewed = true; await service.monitor.scan(); assert.equal(service.get(a, saved.id).tracking.newMatches, 1);
});

test('monitor state and new matches persist after database reopen, including checks without a browser', async t => {
  const filename = path.join(os.tmpdir(), `lahacks-search-watch-${randomUUID()}.sqlite`);
  const rows = [row(1)], source = { rows: () => structuredClone(rows), judge: answer };
  let db = new ActionStore(filename), service = new SavedSearchService(db, id => id === a, source);
  t.after(() => { db.db.close(); for (const suffix of ['', '-wal', '-shm']) fs.rmSync(filename + suffix, { force: true }); });
  const saved = service.create(a, { name: 'Watch', definition: watchDefinition }); service.toggle(a, saved.id, saved.revision, true); await service.monitor.check(saved.id);
  db.db.close(); db = new ActionStore(filename); service = new SavedSearchService(db, id => id === a, source);
  rows.push(row(2)); await service.monitor.scan();
  assert.equal(service.get(a, saved.id).tracking.newMatches, 1);
  db.db.close(); db = new ActionStore(filename); service = new SavedSearchService(db, id => id === a, source);
  assert.equal(service.get(a, saved.id).enabled, true); assert.equal(service.get(a, saved.id).tracking.newMatches, 1);
  assert.equal(service.newMatches(a, saved.id).matches[0].row.id, row(2).id);
});

test('turning Off, editing, or deleting during a check prevents late results from being committed', async t => {
  for (const action of ['off', 'edit', 'delete']) await t.test(action, async t => {
    const { db } = setup(); t.after(() => db.db.close()); let resolve!: () => void;
    const wait = new Promise<void>(done => { resolve = done; });
    const service = new SavedSearchService(db, id => id === a, { rows: () => [row(1)], judge: async (...args) => { await wait; return answer(...args); } });
    let saved = service.create(a, { name: 'Watch', definition: watchDefinition });
    saved = service.toggle(a, saved.id, saved.revision, true); const running = service.monitor.check(saved.id);
    if (action === 'off') service.toggle(a, saved.id, saved.revision, false);
    if (action === 'edit') service.update(a, saved.id, { name: 'Changed', definition: { ...watchDefinition, query: 'Different question.' }, revision: saved.revision });
    if (action === 'delete') service.remove(a, saved.id, saved.revision);
    else assert.equal(service.get(a, saved.id).tracking.status, 'never', 'an invalidated check must stop showing as active immediately');
    resolve(); await running;
    if (action === 'delete') { assert.deepEqual(service.list(a), []); assert.equal(db.list('search-watch', a).length, 0); }
    else assert.equal(service.get(a, saved.id).tracking.lastCheckedAt, null);
  });
});

test('failed checks preserve previous results, show failure, and retry without treating uncertainty as a match', async t => {
  const { db } = setup(); t.after(() => db.db.close()); const rows = [row(1), row(2, 'no')]; let fail = false;
  const service = new SavedSearchService(db, id => id === a, { rows: () => structuredClone(rows), judge: async (...args) => fail ? {} : answer(...args) });
  const saved = service.create(a, { name: 'Watch', definition: watchDefinition }); service.toggle(a, saved.id, saved.revision, true); await service.monitor.check(saved.id);
  const time = service.get(a, saved.id).tracking.lastCheckedAt;
  fail = true; rows[1].memo = 'unknown'; await service.monitor.scan();
  assert.equal(service.get(a, saved.id).tracking.status, 'error'); assert.equal(service.get(a, saved.id).tracking.lastCheckedAt, time); assert.equal(service.get(a, saved.id).tracking.matches, 1);
  assert.ok(service.get(a, saved.id).tracking.retryAt);
  fail = false; await service.monitor.check(saved.id);
  assert.equal(service.get(a, saved.id).tracking.uncertain, 1); assert.equal(service.get(a, saved.id).tracking.newMatches, 0);
  rows[1].memo = 'yes'; await service.monitor.scan(); assert.equal(service.get(a, saved.id).tracking.newMatches, 1);
  rows[1].memo = 'no'; assert.equal(service.newMatches(a, saved.id).matches.length, 0); assert.equal(service.newMatches(a, saved.id).changedSinceCheck, true);
});
