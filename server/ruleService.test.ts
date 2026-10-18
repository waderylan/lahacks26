import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import express from 'express';
import { ActionStore } from './actionStore.ts';
import { WorkspaceData } from './workspaceData.ts';
import { ActionEngine } from './actionEngine.ts';
import { actionRoutes } from './actionRoutes.ts';
import { RuleService } from './ruleService.ts';
import { ruleRoutes } from './ruleRoutes.ts';
import { Mailbox } from './mailbox.ts';
import { EMPTY_STORE, exampleRule, type Rule, type DraftResult } from '../src/rules.ts';
import type { CompanyBills, Row } from '../src/types.ts';
import type { DraftRequest } from './messages.ts';

const companyId = 'company-018';
const row = (index: number, company = companyId): Row => ({ id: `${company}:bill-${index}`, companyId: company, billId: `bill-${index}`, docNumber: `B-${index}`, date: '2026-10-01', dueDate: '2026-11-01', vendor: `Vendor ${index}`, vendorId: `vendor-${index}`, description: 'Equipment purchase', itemNames: ['Tools'], account: 'Equipment', amountCents: 10050, expenseKind: 'product', costCategory: 'goods', memo: 'Original memo', project: null, supplyRole: null, lines: [], payments: [], vendorRecord: null, projectRecord: null });
const ids = [row(1).id, row(2).id];
const draft: DraftResult = { employeeId: 'emp-controller', subject: 'Check coding for 2 bills', body: 'Hi Marcus, please check these bills.', routingProbability: .9 };
const judge = async (_company: string, _text: string, rows: Row[]) => Object.fromEntries(rows.map(row => [row.id, 'match' as const]));
const makeRule = (company = companyId): Rule => ({ ...exampleRule(company), expression: { id: 'amount', type: 'standard', field: 'amountCents', operator: 'gt', value: '50' }, actions: [
  { id: 'assign', type: 'assign', value: 'Bookkeeper' }, { id: 'flag', type: 'flag', value: 'Needs review' },
  { id: 'message', type: 'message', value: 'Ask whether these should be recoded.', recipient: 'jev', sender: 'emp-ap' },
] });
function setup(filename = ':memory:', writer = async (_request: DraftRequest): Promise<DraftResult> => draft) {
  const db = new ActionStore(filename);
  const data = new WorkspaceData(db, id => ({ company: { companyId: id, name: id, industry: 'Test', profile: '', billCount: 8 }, totalBills: 8, sampled: false, rows: Array.from({ length: 8 }, (_, index) => row(index + 1, id)) } satisfies CompanyBills), () => []);
  const service = new RuleService(db, data, judge, writer);
  const actions = new ActionEngine(db, data, judge);
  return { db, data, service, actions };
}
async function eventually(check: () => boolean) {
  for (let tries = 0; tries < 500; tries++) { if (check()) return; await new Promise(resolve => setTimeout(resolve, 2)); }
  assert.fail('Expected worker to settle.');
}

test('outcome actions are rechecked server-side and uncertain drafts retain their trigger through approval', async t => {
  const { db, data } = setup(); t.after(() => db.db.close());
  let writtenOutcome: string | undefined;
  const service = new RuleService(db, data, async (_company, _text, rows) => Object.fromEntries(rows.map(row => [row.id, row.billId === 'bill-1' ? 'match' : row.billId === 'bill-2' ? 'uncertain' : 'no_match'])), async request => {
    writtenOutcome = request.outcome; return draft;
  });
  const rule: Rule = { ...makeRule(), expression: { id: 'check', type: 'ai', text: 'Needs review', label: '' }, actions: [
    { id: 'match', type: 'flag', value: 'Check charge' },
    { id: 'uncertain', type: 'message', value: 'Request receipt', recipient: 'jev', sender: 'emp-ap', when: 'uncertain' },
    { id: 'nonmatch', type: 'tag', value: 'No issue', when: 'false' },
  ] };
  service.save(companyId, rule, null);
  await service.run(companyId, rule.id, 1, [row(1).id, row(2).id, row(3).id]);
  await eventually(() => service.snapshot(companyId).store.messages[0]?.generation === 'ready');
  assert.deepEqual(data.row(companyId, row(1).id).dashboard?.flags, ['Check charge']);
  assert.deepEqual(data.row(companyId, row(2).id).dashboard?.flags, []);
  assert.deepEqual(data.row(companyId, row(3).id).dashboard?.tags, ['No issue']);
  assert.equal(writtenOutcome, 'uncertain');
  const message = service.snapshot(companyId).store.messages[0];
  assert.equal(message.outcome, 'uncertain');
  assert.equal(db.list('mail', companyId).length, 0);
  service.decide(companyId, message.id, 'approved', message.body, message.body, 'emp-ap');
  assert.equal(db.list('mail', companyId).length, 1);
  await service.run(companyId, rule.id, 1, [row(1).id, row(2).id, row(3).id]);
  assert.equal(service.snapshot(companyId).store.messages.length, 1);
});

test('rules, messages, approvals, notification flags, bill metadata and arrivals survive database reopen', async () => {
  const filename = path.join(os.tmpdir(), `lahacks-rules-${crypto.randomUUID()}.sqlite`);
  const first = setup(filename), rule = makeRule();
  try {
    first.service.save(companyId, rule, null);
    await first.service.run(companyId, rule.id, 1, ids);
    await eventually(() => first.service.snapshot(companyId).store.messages[0]?.generation === 'ready');
    const message = first.service.snapshot(companyId).store.messages[0];
    first.service.decide(companyId, message.id, 'approved', 'Edited approved text', message.body, 'emp-ap');
    first.service.notices(companyId); first.service.notices(companyId, first.service.snapshot(companyId).store.notices[0].id);
    await first.service.replay(companyId);
    first.db.db.close();
    const second = setup(filename);
    try {
      const saved = second.service.snapshot(companyId).store;
      assert.equal(saved.rules[0].id, rule.id); assert.equal(saved.messages[0].status, 'approved');
      assert.equal(saved.messages[0].body, 'Edited approved text'); assert.ok(saved.notices.every(notice => notice.read));
      assert.ok(saved.notices[0].toasted); assert.equal(saved.arrivals[companyId].length, 1);
      assert.equal(second.data.row(companyId, ids[0]).dashboard?.owner, 'Bookkeeper');
      assert.equal(saved.history.length, 6);
    } finally { second.db.db.close(); }
  } finally { try { first.db.db.close(); } catch {} for (const suffix of ['', '-wal', '-shm']) fs.rmSync(filename + suffix, { force: true }); }
});

test('rule and dashboard writes share assignments and flags, prevent repeated drafts and protect later edits on undo', async t => {
  const { db, service, data, actions } = setup(); t.after(() => db.db.close());
  const rule = makeRule(); service.save(companyId, rule, null); await service.run(companyId, rule.id, 1, ids);
  await eventually(() => service.snapshot(companyId).store.messages[0]?.generation === 'ready');
  await service.run(companyId, rule.id, 1, ids);
  assert.equal(service.snapshot(companyId).store.messages.length, 1);
  assert.equal(service.snapshot(companyId).store.history.length, 6);
  const plan = await actions.preview(companyId, { ids: [ids[0]], scope: 'selected' }, { type: 'assign', owner: 'Another team' }); actions.apply(companyId, plan.id);
  assert.equal(service.snapshot(companyId).store.transactions[ids[0]].owner, 'Another team');
  const entry = service.snapshot(companyId).store.history.find(entry => entry.transactionId === ids[0] && entry.action?.type === 'assign')!;
  assert.throws(() => service.undo(companyId, entry.id), /conflict/);
  const flag = service.snapshot(companyId).store.history.find(entry => entry.transactionId === ids[0] && entry.action?.type === 'flag')!;
  service.undo(companyId, flag.id); assert.deepEqual(data.row(companyId, ids[0]).dashboard?.flags, []);
});

test('stale rule saves, metadata and duplicate message decisions cannot overwrite another session', async t => {
  const { db, service, data } = setup(); t.after(() => db.db.close());
  const rule = makeRule(); service.save(companyId, rule, null);
  service.save(companyId, { ...rule, name: 'Updated by session two' }, 1);
  assert.throws(() => service.save(companyId, { ...rule, name: 'Stale draft' }, 1), /another session/);
  await service.run(companyId, rule.id, 2, ids);
  await eventually(() => service.snapshot(companyId).store.messages[0]?.generation === 'ready');
  const message = service.snapshot(companyId).store.messages[0];
  service.decide(companyId, message.id, 'approved', 'New text', message.body, 'emp-ap');
  assert.throws(() => service.decide(companyId, message.id, 'rejected', undefined, undefined, 'emp-ap'), /no longer pending/);
  assert.throws(() => service.updateMetadata(companyId, ids[0], { owner: 'stale', flags: [], tags: [], automatedCheck: false }, '0'), /another session/);
  assert.equal(data.row(companyId, ids[0]).dashboard?.owner, 'Bookkeeper');
});

test('pending messages resume after server restart and use frozen bill evidence', async () => {
  const filename = path.join(os.tmpdir(), `lahacks-pending-${crypto.randomUUID()}.sqlite`);
  let release!: (result: DraftResult) => void;
  const first = setup(filename, () => new Promise(resolve => { release = resolve; })), rule = makeRule();
  try {
    first.service.save(companyId, rule, null); await first.service.run(companyId, rule.id, 1, ids);
    const plan = await first.actions.preview(companyId, { ids: [ids[0]], scope: 'selected' }, { type: 'memo', text: 'Changed after the run' }); first.actions.apply(companyId, plan.id);
    let received: DraftRequest | undefined;
    const second = setup(filename, async request => { received = request; return draft; });
    try {
      await second.service.drainDrafts();
      assert.equal(second.service.snapshot(companyId).store.messages[0].generation, 'ready');
      assert.equal(received!.bills[0].row.memo, 'Original memo');
      assert.equal(received!.bills.length, 2);
      release({ ...draft, body: 'Late original worker result' });
      await new Promise(resolve => setImmediate(resolve));
      assert.equal(second.service.snapshot(companyId).store.messages[0].body, draft.body);
    } finally { second.db.db.close(); }
  } finally { first.db.db.close(); for (const suffix of ['', '-wal', '-shm']) fs.rmSync(filename + suffix, { force: true }); }
});

test('undoing a bill during generation discards stale text and regenerates the remaining bills', async t => {
  let release!: (result: DraftResult) => void, calls = 0;
  const { db, service } = setup(':memory:', async () => { if (++calls === 1) return new Promise(resolve => { release = resolve; }); return draft; });
  t.after(() => db.db.close()); const rule = makeRule(); service.save(companyId, rule, null); await service.run(companyId, rule.id, 1, ids);
  const entry = service.snapshot(companyId).store.history.find(entry => entry.transactionId === ids[0] && entry.action?.type === 'message')!;
  service.undo(companyId, entry.id); release({ ...draft, body: 'STALE' });
  await eventually(() => !db.get<any>('rule-state', companyId).store.messages[0].body);
  await new Promise(resolve => setImmediate(resolve)); await service.drainDrafts();
  const message = service.snapshot(companyId).store.messages[0]; assert.equal(message.items.length, 1); assert.equal(message.body, draft.body);
});

test('atomic rollback preserves both bills and rule history if persistence fails', async t => {
  const { db, service, data } = setup(); t.after(() => db.db.close());
  const rule = { ...makeRule(), actions: [{ id: 'assign', type: 'assign' as const, value: 'Bookkeeper' }] }; service.save(companyId, rule, null);
  const put = db.put.bind(db); db.put = (kind, ...args) => { if (kind === 'rule-state') throw new Error('disk full'); return put(kind, ...args); };
  await assert.rejects(service.run(companyId, rule.id, 1, ids), /disk full/); db.put = put;
  assert.equal(data.row(companyId, ids[0]).dashboard?.owner, ''); assert.equal(service.snapshot(companyId).store.history.length, 0);
});

test('server automations act after a persisted update without a browser, without backfill or self-trigger loops', async t => {
  const { db, service, data, actions } = setup(); t.after(() => db.db.close());
  const rule = makeRule(); service.save(companyId, rule, null); service.toggle(companyId, rule.id, 1, true); await service.scan();
  assert.equal(service.snapshot(companyId).store.history.length, 0);
  const plan = await actions.preview(companyId, { ids: [ids[0]], scope: 'selected' }, { type: 'review', reviewed: true }); actions.apply(companyId, plan.id);
  await service.scan(); await eventually(() => service.snapshot(companyId).store.messages[0]?.generation === 'ready');
  await service.scan(); assert.equal(service.snapshot(companyId).store.messages.length, 1);
  assert.equal(data.row(companyId, ids[0]).dashboard?.owner, 'Bookkeeper');
});

test('legacy browser import preserves newer dashboard edits and never overwrites shared rules', t => {
  const { db, service, data } = setup(); t.after(() => db.db.close()); const rule = makeRule();
  const row1 = data.row(companyId, ids[0]); db.write({ ...row1, dashboard: { ...row1.dashboard!, owner: 'Current SQL owner' } }, row1.sourceVersion!);
  const legacy = { ...structuredClone(EMPTY_STORE), rules: [rule], transactions: { [ids[0]]: { owner: 'Old browser', flags: [], tags: [], automatedCheck: false } } };
  assert.equal(service.importLegacy(companyId, legacy, [ids[1]]), true);
  assert.equal(service.snapshot(companyId).store.rules.length, 1); assert.equal(data.row(companyId, ids[0]).dashboard?.owner, 'Current SQL owner');
  assert.equal(data.row(companyId, ids[1]).dashboard?.reviewed, true);
  assert.equal(service.importLegacy(companyId, { ...legacy, rules: [] }, []), false); assert.equal(service.snapshot(companyId).store.rules.length, 1);
});

test('HTTP commands share state across clients, isolate companies, persist preferences, and reject foreign origins', async t => {
  const { db, service, actions } = setup(); const app = express(); app.use(express.json()); actionRoutes(app, actions); ruleRoutes(app, service);
  const server = app.listen(0); await new Promise<void>(resolve => server.on('listening', resolve));
  const address = server.address() as { port: number }, base = `http://127.0.0.1:${address.port}`;
  t.after(() => { server.closeAllConnections(); server.close(); db.db.close(); });
  const command = (id: string, body: unknown, origin?: string) => fetch(`${base}/api/companies/${id}/rules/commands`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(origin && { Origin: origin }) }, body: JSON.stringify(body) });
  const rule = makeRule(); assert.equal((await command(companyId, { type: 'save', rule, expectedRevision: null })).status, 200);
  assert.equal((await (await fetch(`${base}/api/companies/${companyId}/rules`)).json()).store.rules.length, 1);
  assert.equal((await command('company-005', { type: 'run', id: rule.id, revision: 1, ids })).status, 400);
  assert.equal((await command(companyId, { type: 'reset' }, 'https://unrelated.example')).status, 403);
  const settings = await fetch(`${base}/api/settings`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ limit: 100 }) });
  assert.equal(settings.status, 200); assert.equal((await (await fetch(`${base}/api/settings`)).json()).limit, 100);
  assert.equal((await command(companyId, { type: 'run', id: rule.id, revision: 1, ids: ['company-005:bill-1'] })).status, 400);
  const other = service.snapshot('company-005'); assert.equal(other.store.messages.length, 0);
});

test('mail: X sends Y, Y sees it in their inbox; replies thread; only the recipient marks read; approvals deliver from the approver', async t => {
  const { db, data, service } = setup(); t.after(() => db.db.close());
  const mailbox = new Mailbox(db, data);
  mailbox.send(companyId, { from: 'emp-ap', to: 'emp-controller', subject: 'Coding question', body: 'Is this COGS?' });
  let marcus = mailbox.view(companyId, 'emp-controller');
  assert.equal(marcus.inbox.length, 1); assert.equal(marcus.inbox[0].from, 'emp-ap'); assert.equal(marcus.unread['emp-controller'], 1);
  assert.equal(mailbox.view(companyId, 'emp-ap').sent.length, 1); assert.equal(mailbox.view(companyId, 'emp-ap').inbox.length, 0);
  assert.equal(mailbox.view(companyId, 'emp-it').inbox.length, 0);
  const first = marcus.inbox[0];
  assert.throws(() => mailbox.markRead(companyId, first.id, 'emp-ap'), /recipient/);
  mailbox.markRead(companyId, first.id, 'emp-controller');
  assert.equal(mailbox.view(companyId, 'emp-controller').unread['emp-controller'], 0);
  const reply = mailbox.send(companyId, { from: 'emp-controller', to: 'emp-ap', subject: 'Re: Coding question', body: 'Yes.', replyTo: first.id });
  assert.equal(reply.threadId, first.threadId); assert.equal(mailbox.view(companyId, 'emp-ap').inbox[0].id, reply.id);
  assert.throws(() => mailbox.send(companyId, { from: 'emp-it', to: 'emp-ap', subject: 'Re', body: 'x', replyTo: first.id }), /reply/);
  assert.throws(() => mailbox.send(companyId, { from: 'emp-ap', to: 'emp-nobody', subject: 's', body: 'b' }), /recipient/);
  assert.throws(() => mailbox.send(companyId, { from: 'emp-ap', to: 'emp-it', subject: ' ', body: 'b' }), /subject/);
  assert.equal(mailbox.view('company-005', 'emp-controller').inbox.length, 0);

  const rule = makeRule(); service.save(companyId, rule, null); await service.run(companyId, rule.id, 1, ids);
  await eventually(() => service.snapshot(companyId).store.messages[0]?.generation === 'ready');
  const draftMessage = service.snapshot(companyId).store.messages[0];
  assert.throws(() => service.decide(companyId, draftMessage.id, 'approved', undefined, draftMessage.body), /which employee/);
  assert.throws(() => service.decide(companyId, draftMessage.id, 'approved', undefined, draftMessage.body, 'emp-procurement'), /Only Priya Natarajan/);
  assert.throws(() => service.decide(companyId, draftMessage.id, 'rejected', undefined, undefined, 'emp-controller'), /Only Priya Natarajan/);
  service.decide(companyId, draftMessage.id, 'approved', undefined, draftMessage.body, 'emp-ap');
  const delivered = mailbox.view(companyId, 'emp-controller').inbox.find(mail => mail.source === 'rule')!;
  assert.equal(delivered.from, 'emp-ap'); assert.equal(delivered.subject, draft.subject); assert.equal(delivered.draftId, draftMessage.id);
  assert.deepEqual(delivered.items.map(item => item.transactionId), ids);
  assert.equal(mailbox.view(companyId, 'emp-ap').sent.find(mail => mail.source === 'rule')!.id, delivered.id);
  service.reset(companyId);
  assert.equal(mailbox.view(companyId, 'emp-controller').inbox.length, 0);
});
