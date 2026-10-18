import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createReviewApp, type AppOptions } from './app.ts';
import { ActionStore, emptyDashboard } from './actionStore.ts';
import { WorkspaceData } from './workspaceData.ts';
import { ActionEngine } from './actionEngine.ts';
import { RuleService } from './ruleService.ts';
import { deliverDraft } from './mailbox.ts';
import { listCompanies, loadCompanyBills } from './data.ts';
import { EMPTY_STORE, type Rule, type DraftResult } from '../src/rules.ts';
import type { Row } from '../src/types.ts';

const a = 'company-101', b = 'company-102';
const source = (company: string, count = 8) => ({
  company: { companyId: company, name: company, industry: 'Services', profile: '', billCount: count, synthetic: true },
  totalBills: count, sampled: false,
  rows: Array.from({ length: count }, (_, i): Row => ({
    id: `${company}:bill-${i + 1}`, companyId: company, billId: `bill-${i + 1}`, docNumber: `INV-${i + 1}`,
    date: '2026-10-01', dueDate: '2026-11-01', vendor: `Vendor ${i + 1}`, vendorId: `v${i + 1}`,
    description: 'Business purchase', itemNames: [], account: 'Maintenance', amountCents: 125000,
    expenseKind: 'operating', costCategory: 'service', memo: 'Source memo', project: null, supplyRole: null,
    lines: [], payments: [], vendorRecord: null, projectRecord: null, txnType: 'bill',
  })),
});
const makeRule = (companyId = a): Rule => ({
  id: `rule-${companyId}`, companyId, name: 'Review purchases', revision: 1, enabled: false,
  expression: { id: 'amount', type: 'standard', field: 'amountCents', operator: 'gt', value: '1' },
  actions: [
    { id: 'flag', type: 'flag', value: 'Check documents' },
    { id: 'assign', type: 'assign', value: 'Marcus Bell' },
    { id: 'task', type: 'task', value: 'Get receipt', owner: 'Grace Adeyemi', dueDays: 2 },
  ],
});
const judge = async (_company: string, _criterion: string, rows: Row[]) => Object.fromEntries(rows.map(row => [row.id, 'match' as const]));
const draft: DraftResult = { employeeId: 'emp-controller', subject: 'Receipt needed', body: 'Please attach a receipt.' };
const setup = (filename = ':memory:') => {
  const db = new ActionStore(filename);
  const data = new WorkspaceData(db, id => source(id), () => []);
  return { db, data, rules: new RuleService(db, data, judge, async () => draft), actions: new ActionEngine(db, data) };
};
async function http(options: Partial<AppOptions> = {}) {
  const db = new ActionStore(':memory:');
  const runtime = createReviewApp({ database: db, configured: () => true, draftConfigured: () => true,
    evaluate: async (_request, _signal, rows = []) => ({ results: rows.map(row => ({ id: row.id, state: 'uncertain' as const, pMatch: 0.5 })), costNanoUsd: '0' }),
    writer: async () => draft, ...options });
  const server = runtime.app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  const url = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  return { ...runtime, url, close: async () => {
    await runtime.stop(); server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve())); db.db.close();
  } };
}
const post = (url: string, body: unknown) => fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

test('production assembly exposes exactly four companies and all records without reading raw/evaluation data', async t => {
  const read = fs.readFileSync.bind(fs);
  t.mock.method(fs, 'readFileSync', (...args: Parameters<typeof fs.readFileSync>) => {
    assert.doesNotMatch(String(args[0]).replaceAll('\\', '/'), /data\/raw|synthetic\/eval|\/hidden\//);
    return read(...args as [any, any]);
  });
  const runtime = await http(); t.after(runtime.close);
  const companies = await (await fetch(runtime.url + '/api/companies')).json();
  assert.deepEqual(companies.map((company: { companyId: string }) => company.companyId), [a, b, 'company-103', 'company-104']);
  assert.deepEqual((await (await fetch(runtime.url + '/api/settings')).json()), { limit: -1 });
  for (const [index, company] of companies.entries()) {
    const base = `${runtime.url}/api/companies/${company.companyId}`;
    const full = await (await fetch(base + '/bills?limit=0&reserve=1')).json();
    assert.equal(full.rows.length, [346, 320, 310, 298][index]);
    assert.equal(full.totalBills, full.rows.length); assert.deepEqual(full.reservedRows, []);
    const sampled = await (await fetch(base + '/bills?limit=-1')).json();
    assert.equal(sampled.curatedSample, true); assert.match(sampled.disclosure, /not representative/);
    assert.ok(sampled.rows.length < full.rows.length);
    assert.deepEqual(sampled.referenceOptions, full.referenceOptions);
    const last = full.rows.at(-1);
    assert.equal((await (await fetch(base + '/bills/' + encodeURIComponent(last.id))).json()).id, last.id);
    const evaluation = await post(runtime.url + '/api/evaluate', { companyId: company.companyId, criterion: 'Needs receipt', ids: [last.id] });
    assert.equal(evaluation.status, 200); assert.equal((await evaluation.json()).results[0].state, 'uncertain');
    const rule = makeRule(company.companyId);
    assert.equal((await post(base + '/rules/commands', { type: 'save', rule, expectedRevision: null })).status, 200);
    const run = await (await post(base + '/rules/commands', { type: 'run-all', id: rule.id, revision: 1 })).json();
    assert.equal(run.runs[0].transactionCount, full.rows.length);
    assert.ok(run.store.history.some((entry: { transactionId: string }) => entry.transactionId === last.id));
  }
  for (const route of ['/bills', '/rules', '/workspace', '/mail?as=emp-ap', '/searches']) assert.equal((await fetch(runtime.url + '/api/companies/company-018' + route)).status, 404);
  assert.equal((await post(runtime.url + '/api/evaluate', { companyId: a, criterion: 'Review', ids: [`${b}:bill-1`] })).status, 400);
});

test('retired endpoints cannot create actions or bypass approval; saved views remain CRUD only', async t => {
  const runtime = await http(); t.after(runtime.close);
  const base = `${runtime.url}/api/companies/${a}`;
  for (const endpoint of ['/chat', '/llm-evaluate', '/automations', '/checks/duplicates/escalate', '/rules/import', '/searches/old/toggle', '/searches/old/check', '/searches/old/seen']) {
    assert.equal((await post(base + endpoint, {})).status, 404, endpoint);
  }
  assert.equal((await post(runtime.url + '/api/understand', {})).status, 404);
  const created = await (await post(base + '/searches', { name: 'Receipts', definition: {
    query: 'Receipt missing', type: 'all', status: 'all', assignee: 'all', tab: 'all', matchesOnly: false, sort: { key: 'date', dir: -1 },
  } })).json();
  assert.ok(created.search.id);
  assert.deepEqual(runtime.database.state(a), { tasks: [], runs: [], automations: [] });
  assert.deepEqual(runtime.database.list('mail', a), []);
  assert.equal((await post(base + '/rules/commands', { type: 'replay' })).status, 400);
});

test('selected human review supports expected versions and remains separate from task completion and automated checks', async t => {
  const runtime = await http({ companies: () => [source(a).company], load: id => source(id), accounts: () => [], sample: () => null });
  t.after(runtime.close);
  const base = `${runtime.url}/api/companies/${a}`, id = `${a}:bill-8`;
  const row = runtime.workspace.row(a, id);
  assert.equal((await post(base + '/actions/review', { ids: [id], reviewed: true, expectedVersions: { [id]: row.sourceVersion } })).status, 200);
  assert.equal(runtime.workspace.row(a, id).dashboard?.reviewed, true);
  assert.equal(runtime.workspace.row(a, id).dashboard?.automatedCheck, false);
  assert.equal((await post(base + '/actions/review', { ids: [id], reviewed: false, expectedVersions: { [id]: row.sourceVersion } })).status, 400);
  assert.equal(runtime.workspace.row(a, id).dashboard?.reviewed, true);
  assert.equal((await post(base + '/actions/review', { ids: [`${b}:bill-1`], reviewed: true })).status, 400);
});

test('disk reopen retains rule flags, assignment, task links, history and summary; repeat runs create nothing new', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'demo-durability-'));
  const filename = path.join(dir, 'actions.sqlite');
  let system = setup(filename);
  t.after(() => { system.db.db.close(); fs.rmSync(dir, { recursive: true, force: true }); });
  const rule = makeRule(); system.rules.save(a, rule, null);
  const id = `${a}:bill-8`;
  await system.rules.run(a, rule.id, 1, [id]);
  const first = system.rules.snapshot(a);
  const task = system.db.state(a).tasks[0];
  assert.equal(task.owner, 'emp-projects');
  system.db.db.close(); system = setup(filename);
  const row = system.data.row(a, id);
  assert.equal(row.dashboard?.owner, 'emp-controller');
  assert.deepEqual(row.dashboard?.flags, ['Check documents']);
  assert.deepEqual(row.dashboard?.taskIds, [task.id]);
  assert.deepEqual(system.rules.snapshot(a).store.history, first.store.history);
  assert.deepEqual(system.rules.snapshot(a).runs, first.runs);
  await system.rules.run(a, rule.id, 1, [id]);
  assert.equal(system.db.state(a).tasks.length, 1);
  assert.equal(system.rules.snapshot(a).store.history.length, 3);
  assert.match(system.rules.snapshot(a).automation[0], /Actions configured/);
  const taskOnly = { ...rule, id: 'task-only', actions: [rule.actions[2]] };
  system.rules.save(a, taskOnly, null);
  await system.rules.run(a, taskOnly.id, 1, [`${a}:bill-7`]);
  assert.equal(system.data.row(a, `${a}:bill-7`).dashboard?.owner, '');
});

test('restore clears company review state and evidence atomically, retains disabled rules and valid caches, isolates peers', async t => {
  const { db, data, rules, actions } = setup(); t.after(() => db.db.close());
  const rule = makeRule(); rules.save(a, rule, null, true);
  rules.save(b, makeRule(b), null, true);
  await rules.run(a, rule.id, 1, [`${a}:bill-8`]);
  await rules.run(b, makeRule(b).id, 1, [`${b}:bill-8`]);
  const row = data.row(a, `${a}:bill-8`);
  db.write({ ...row, memo: 'Manual memo', account: 'Manual account', workspaceChanges: { memo: row.memo }, evidence: [{ id: 'note', kind: 'reviewer_note', date: '2026-10-17', title: 'Note', text: 'Review details' }], dashboard: { ...row.dashboard!, reviewed: true } }, row.sourceVersion!);
  for (const kind of ['mail', 'draft-job', 'message-evidence', 'payment-risk', 'duplicate-check', 'automation', 'search-watch', 'saved-view-migration', 'chat', 'legacy-extra']) db.put(kind, `a-${kind}`, a, { old: true });
  db.put('semantic-judgment', 'valid', a, { verdict: 'uncertain' });
  db.put('saved-search', 'view', a, { name: 'Keep view' });
  const preview = await actions.preview(a, { ids: [row.id], scope: 'selected' }, { type: 'tag', label: 'Old preview' });
  const otherRows = db.rows(b), otherDocs = db.db.prepare('SELECT * FROM documents WHERE company=? ORDER BY kind,id').all(b);
  const stale = data.row(a, row.id);
  rules.reset(a, true);
  const restored = data.row(a, row.id);
  assert.deepEqual(restored.dashboard, emptyDashboard());
  assert.equal(restored.memo, row.memo); assert.equal(restored.account, row.account);
  assert.equal(restored.evidence, undefined); assert.equal(restored.workspaceChanges, undefined);
  assert.notEqual(restored.sourceVersion, stale.sourceVersion);
  assert.deepEqual(db.rows(b), otherRows);
  assert.deepEqual(db.db.prepare('SELECT * FROM documents WHERE company=? ORDER BY kind,id').all(b), otherDocs);
  const state = rules.snapshot(a);
  assert.equal(state.store.rules.length, 1); assert.equal(state.store.rules[0].enabled, false); assert.equal(state.store.rules[0].revision, 2);
  assert.deepEqual(state.store.history, []); assert.deepEqual(state.store.executions, []);
  assert.deepEqual(state.store.messages, []); assert.deepEqual(state.store.notices, []); assert.deepEqual(state.store.arrivals, {});
  assert.deepEqual(state.runs, []); assert.deepEqual(state.issues, []); assert.deepEqual(state.automation, []);
  assert.deepEqual(db.state(a), { tasks: [], runs: [], automations: [] });
  assert.deepEqual(db.get('semantic-judgment', 'valid'), { verdict: 'uncertain' });
  assert.deepEqual(db.get('saved-search', 'view'), { name: 'Keep view' });
  assert.deepEqual(db.get<any>('rule-state', a).watches, {});
  for (const kind of ['mail', 'draft-job', 'message-evidence', 'payment-risk', 'duplicate-check', 'automation', 'search-watch', 'chat', 'legacy-extra']) assert.deepEqual(db.list(kind, a), [], kind);
  assert.throws(() => actions.apply(a, preview.id), /not found/);
  assert.throws(() => rules.updateMetadata(a, row.id, { owner: 'old', flags: [], tags: [], automatedCheck: false }, stale.sourceVersion!), /changed/);
  await assert.rejects(rules.run(a, rule.id, 1, [row.id]), /changed/);
});

test('dataset replacement rolls back rows, version and dependent state together on invalid input', t => {
  const { db, data, rules } = setup(); t.after(() => db.db.close());
  const rows = source(a).rows;
  db.seed(a, rows, 'v1'); rules.save(a, makeRule(), null, true);
  db.put('task', 'keep-on-failure', a, { old: true });
  db.seed(b, source(b).rows, 'v1');
  const beforeRows = db.rows(a), before = db.db.prepare('SELECT * FROM documents ORDER BY kind,id').all();
  assert.throws(() => db.seed(a, [rows[0], source(b).rows[0]], 'v2'), /Cross-company/);
  assert.deepEqual(db.rows(a), beforeRows); assert.deepEqual(db.db.prepare('SELECT * FROM documents ORDER BY kind,id').all(), before);
  db.seed(a, [{ ...rows[0], memo: 'Replacement evidence' }], 'v2');
  assert.equal(data.bills(a).rows.length, 1);
  assert.equal(data.row(a, rows[0].id).memo, 'Replacement evidence');
  assert.equal(db.get<any>('dataset', a).version, 'v2'); assert.deepEqual(db.list('task', a), []);
  assert.throws(() => db.write({ ...rows[0], memo: 'Stale editor' }, beforeRows[0].sourceVersion!), /changed/);
  assert.equal(rules.snapshot(a).store.rules[0].enabled, false);
  assert.equal(db.rows(b).length, 8);
});

test('replacing with an empty dataset cannot revive stale revisions when records return', t => {
  const { db } = setup(); t.after(() => db.db.close());
  const rows = source(a).rows;
  db.seed(a, rows, 'v1'); const old = db.row(a, rows[0].id)!;
  db.seed(a, [], 'empty'); db.seed(a, rows, 'v2');
  assert.notEqual(db.row(a, old.id)?.sourceVersion, old.sourceVersion);
  assert.throws(() => db.write(old, old.sourceVersion!), /changed/);
});

test('restore failure rolls back every row and document', t => {
  const { db, data, rules } = setup(); t.after(() => db.db.close());
  rules.save(a, makeRule(), null, true);
  const row = data.row(a, `${a}:bill-1`); db.write({ ...row, memo: 'Preserve edit' }, row.sourceVersion!);
  db.put('task', 'keep', a, { old: true });
  const rows = db.rows(a), documents = db.db.prepare('SELECT * FROM documents ORDER BY kind,id').all();
  const write = db.write.bind(db); let writes = 0;
  db.write = (...args) => { if (++writes === 2) throw new Error('disk full'); return write(...args); };
  assert.throws(() => rules.reset(a, true), /disk full/);
  db.write = write;
  assert.deepEqual(db.rows(a), rows); assert.deepEqual(db.db.prepare('SELECT * FROM documents ORDER BY kind,id').all(), documents);
});

test('restore during evaluation rejects the late run and discards late generated drafts', async t => {
  const { db, data } = setup(); t.after(() => db.db.close());
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const rules = new RuleService(db, data, async (...args) => { await gate; return judge(args[0], args[1], args[2]); }, async () => { await gate; return draft; });
  const rule = { ...makeRule(), expression: { id: 'ai', type: 'ai' as const, label: '', text: 'Needs review' } };
  rules.save(a, rule, null);
  const run = rules.runAll(a, rule.id, 1); rules.reset(a, true); release();
  await assert.rejects(run, /changed during evaluation/);
  assert.deepEqual(rules.snapshot(a).store.history, []);
  let finish!: (value: DraftResult) => void;
  const drafts = new RuleService(db, data, judge, () => new Promise(resolve => { finish = resolve; }));
  const messaging = { ...makeRule(), id: 'message', actions: [{ id: 'message', type: 'message' as const, value: 'Ask for receipt', recipient: 'jev', sender: 'emp-ap' }] };
  drafts.save(a, messaging, null); await drafts.run(a, messaging.id, 1, [`${a}:bill-1`]);
  drafts.reset(a, true); finish(draft); await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(drafts.snapshot(a).store.messages, []); assert.deepEqual(db.list('draft-job', a), []);
  assert.deepEqual(db.list('message-evidence', a), []); assert.deepEqual(db.list('mail', a), []);
});

test('background workers ignore retained original-company state without loading it', async t => {
  const runtime = await http(); t.after(runtime.close);
  runtime.database.put('rule-state', 'company-018', 'company-018', {
    companyId: 'company-018', store: { ...structuredClone(EMPTY_STORE), rules: [{ ...makeRule('company-018'), enabled: true }], messages: [{ id: 'old', status: 'pending', generation: 'pending' }] }, watches: {}, log: [],
  });
  await runtime.rules.scan(); await runtime.rules.drainDrafts();
  assert.deepEqual(runtime.database.rows('company-018'), []);
});

test('delivery helper refuses a generated draft before its sender approves', t => {
  const { db } = setup(); t.after(() => db.db.close());
  assert.throws(() => deliverDraft(db, { companyId: a, status: 'pending', generation: 'ready', sender: 'emp-ap', employeeId: 'emp-controller' } as any, 'emp-ap'), /approved/);
  assert.deepEqual(db.list('mail', a), []);
});

test('restore during a recurring scan suppresses its late writes and error log', async t => {
  const { db, data } = setup(); t.after(() => db.db.close());
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const rules = new RuleService(db, data, async (...args) => { await gate; return judge(args[0], args[1], args[2]); });
  const rule = { ...makeRule(), expression: { id: 'ai', type: 'ai' as const, label: '', text: 'Needs review' } };
  rules.save(a, rule, null, true);
  const row = data.row(a, `${a}:bill-8`); db.write({ ...row, memo: 'Changed evidence' }, row.sourceVersion!);
  const scan = rules.scan(); rules.reset(a, true); release(); await scan;
  assert.deepEqual(rules.snapshot(a).automation, []);
  assert.deepEqual(rules.snapshot(a).store.history, []);
  assert.deepEqual(db.state(a).tasks, []);
});

test('draft retries preserve frozen evidence and still require the sender approval exactly once', async t => {
  const { db, data, actions } = setup(); t.after(() => db.db.close());
  let attempts = 0;
  const received: string[] = [];
  const rules = new RuleService(db, data, judge, async request => {
    received.push(request.bills[0].row.memo);
    if (++attempts === 1) throw new Error('Rate limit');
    return draft;
  });
  const rule = { ...makeRule(), actions: [{ id: 'message', type: 'message' as const, value: 'Ask for receipt', recipient: 'jev', sender: 'emp-ap' }] };
  rules.save(a, rule, null); await rules.run(a, rule.id, 1, [`${a}:bill-1`]);
  await new Promise(resolve => setImmediate(resolve));
  const message = rules.snapshot(a).store.messages[0];
  const job = db.get<{ attempts: number; nextAt: number }>('draft-job', message.id)!;
  assert.equal(job.attempts, 1); assert.ok(job.nextAt > Date.now());
  const plan = await actions.preview(a, { ids: [`${a}:bill-1`], scope: 'selected' }, { type: 'memo', text: 'Edited after draft' });
  actions.apply(a, plan.id);
  db.put('draft-job', message.id, a, { ...job, nextAt: 0 }); await rules.drainDrafts();
  assert.deepEqual(received, ['Source memo', 'Source memo']);
  const ready = rules.snapshot(a).store.messages[0]; assert.equal(ready.generation, 'ready');
  assert.deepEqual(db.list('mail', a), []);
  assert.throws(() => rules.decide(a, ready.id, 'approved', undefined, ready.body, 'emp-controller'), /Only/);
  assert.throws(() => rules.decide(a, ready.id, 'approved', undefined, 'Stale body', 'emp-ap'), /changed/);
  rules.decide(a, ready.id, 'approved', undefined, ready.body, 'emp-ap');
  assert.throws(() => rules.decide(a, ready.id, 'approved', undefined, ready.body, 'emp-ap'), /no longer pending/);
  assert.equal(db.list('mail', a).length, 1);
});
