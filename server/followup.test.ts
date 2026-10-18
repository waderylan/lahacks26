import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ActionStore } from './actionStore.ts';
import { WorkspaceData } from './workspaceData.ts';
import { RuleService } from './ruleService.ts';
import { SemanticService } from './semanticService.ts';
import { DashboardStore } from './dashboard.ts';
import { createReviewApp } from './app.ts';
import { loadCompanyBills } from './data.ts';
import { evaluationContext } from './evaluator.ts';
import { STARTER_CHARTS, CHART_LIMIT } from '../src/charts.ts';
import { prepareFrozenTraining } from '../scripts/prepare_semantic_training.ts';
import type { Provider } from '../src/modelContext.ts';
import type { Rule } from '../src/rules.ts';

const company = 'company-101';
const source = () => { const original = loadCompanyBills(company); return { ...original, rows: original.rows.slice(0, 8), datasetVersion: 'test-v1' }; };
const rule = (): Rule => ({ id: 'provider-test', companyId: company, name: 'Provider policy', provider: 'qwen', revision: 1, enabled: false,
  expression: { id: 'ai', type: 'ai', label: '', text: 'Needs review' }, actions: [
    { id: 'yes', type: 'flag', value: 'Qwen matched' }, { id: 'no', type: 'tag', value: 'Jev no match', when: 'false' },
  ] });

test('provider changes require a new saved revision; run/action provenance survives reopen and rule edits', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'policy-reopen-')), file = path.join(dir, 'workspace.sqlite');
  const providers: (Provider | undefined)[] = [];
  let db = new ActionStore(file);
  const setup = () => {
    const data = new WorkspaceData(db, source, () => []);
    const rules = new RuleService(db, data, async (_id, _text, rows, provider) => {
      providers.push(provider); return Object.fromEntries(rows.map(row => [row.id, provider === 'qwen' ? 'match' : 'no_match']));
    });
    return { data, rules };
  };
  t.after(() => { db.db.close(); fs.rmSync(dir, { recursive: true, force: true }); });
  let system = setup(); const policy = rule(), id = system.data.bills(company).rows.at(-1)!.id;
  system.rules.save(company, policy, null);
  await system.rules.run(company, policy.id, 1, [id]);
  await system.rules.run(company, policy.id, 1, [id]);
  assert.equal(system.rules.snapshot(company).store.history.length, 1);
  await assert.rejects(system.rules.run(company, policy.id, 1, [id], 'run', false, 'jev'), /Save a new rule revision/);
  assert.equal(system.rules.snapshot(company).runs[0].nonmatches, 0);
  system.rules.save(company, { ...policy, provider: 'jev' }, 1);
  await system.rules.run(company, policy.id, 2, [id]);
  assert.deepEqual(system.data.row(company, id).dashboard?.tags, ['Jev no match']);
  db.db.close(); db = new ActionStore(file); system = setup();
  const history = system.rules.snapshot(company).store.history;
  assert.equal(history.length, 2);
  assert.deepEqual(history.map(entry => entry.snapshot.evaluation?.provider).sort(), ['jev', 'qwen']);
  assert.ok(history.every(entry => entry.snapshot.evaluation?.model && entry.snapshot.evaluation.policyVersion && entry.snapshot.evaluation.scoreVersion));
  assert.equal(system.rules.snapshot(company).runs[0].evaluation?.provider, 'jev');
  system.rules.save(company, { ...policy, provider: 'qwen' }, 2);
  assert.equal(system.rules.snapshot(company).store.history.find(entry => entry.revision === 2)?.snapshot.evaluation?.provider, 'jev');
  assert.deepEqual(providers, ['qwen', 'qwen', 'jev']);
});

test('Qwen starter records its provider for background runs independently of page commands', async t => {
  const db = new ActionStore(':memory:'); t.after(() => db.db.close());
  const data = new WorkspaceData(db, source, () => []), providers: unknown[] = [];
  const rules = new RuleService(db, data, async (_id, _text, rows, provider) => {
    providers.push(provider); return Object.fromEntries(rows.map(row => [row.id, 'match']));
  }, async () => ({ employeeId: 'emp-controller', subject: 'Review', body: 'Please review.' }));
  const id = rules.addPreset(company, 'missing-documentation', 'emp-ap', 'qwen');
  const saved = rules.snapshot(company).store.rules[0]; assert.equal(saved.provider, 'qwen');
  assert.equal(saved.evaluation?.provider, 'qwen');
  rules.toggle(company, id, 1, true);
  const last = data.bills(company).rows.at(-1)!; db.write({ ...last, memo: 'New supporting information' }, last.sourceVersion!);
  await rules.scan(); await rules.drainDrafts();
  assert.ok(providers.length); assert.ok(providers.every(provider => provider === 'qwen'));
});

test('calibration and raw mode version caches and freeze score configuration before the request', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'score-config-')), file = path.join(dir, 'calibration.json');
  const env = { VERI_API_KEY: process.env.VERI_API_KEY, VERI_DEPLOYMENT_ID: process.env.VERI_DEPLOYMENT_ID, QWEN_CALIBRATION_FILE: process.env.QWEN_CALIBRATION_FILE, QWEN_RAW_SCORES: process.env.QWEN_RAW_SCORES };
  Object.assign(process.env, { VERI_API_KEY: 'controlled-test-key', VERI_DEPLOYMENT_ID: 'abc', QWEN_CALIBRATION_FILE: file }); delete process.env.QWEN_RAW_SCORES;
  const db = new ActionStore(':memory:');
  t.after(() => { db.db.close(); for (const [key, value] of Object.entries(env)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } fs.rmSync(dir, { recursive: true, force: true }); });
  const calibration = (b: number) => fs.writeFileSync(file, JSON.stringify({ deploymentId: 'abc', a: 1, b, n: 100, validationHash: String(b), source: 'authored_validation_only' }));
  calibration(0); let calls = 0;
  t.mock.method(globalThis, 'fetch', async () => { calls++; return new Response(JSON.stringify({ choices: [{ message: { content: 'A' }, logprobs: { content: [{ token: 'A', top_logprobs: [{ token: 'A', logprob: Math.log(.2) }, { token: 'B', logprob: Math.log(.7) }, { token: 'C', logprob: Math.log(.1) }] }] } }] })); });
  const data = new WorkspaceData(db, source, () => []), semantic = new SemanticService(data), row = data.bills(company).rows[0];
  const first = await semantic.evaluateRows(company, 'Criterion', [row], undefined, 'qwen');
  await semantic.evaluateRows(company, 'Criterion', [row], undefined, 'qwen'); assert.equal(calls, 1);
  calibration(2);
  const second = await semantic.evaluateRows(company, 'Criterion', [row], undefined, 'qwen');
  assert.equal(calls, 2); assert.notEqual(first.evaluation.identity, second.evaluation.identity);
  assert.ok(second.results[0].pMatch! > first.results[0].pMatch!);
  assert.equal(second.results[0].scoreKind, 'validation_calibrated');
  process.env.QWEN_RAW_SCORES = '1';
  const raw = await semantic.evaluateRows(company, 'Criterion', [row], undefined, 'qwen');
  assert.equal(calls, 3); assert.equal(raw.results[0].scoreKind, 'candidate_score_uncalibrated');
  assert.ok(Math.abs(raw.results[0].pMatch! - .2) < 1e-10);
  assert.notEqual(raw.evaluation.identity, second.evaluation.identity);
});

test('chart revisions reject stale writers across disk connections; IDs, sources and limits are validated', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'charts-shared-')), file = path.join(dir, 'workspace.sqlite');
  const a = new ActionStore(file), b = new ActionStore(file);
  t.after(() => { a.db.close(); b.db.close(); fs.rmSync(dir, { recursive: true, force: true }); });
  const first = new DashboardStore(a, new WorkspaceData(a, source, () => [])), second = new DashboardStore(b, new WorkspaceData(b, source, () => []));
  const stale = second.read(company); first.save(company, STARTER_CHARTS.slice(1), 0);
  assert.throws(() => second.save(company, stale.charts, stale.revision), /another session/);
  assert.equal(second.read(company).charts.length, 3);
  const next = [...second.read(company).charts, { ...STARTER_CHARTS[0], id: 'new-card' }];
  second.save(company, next, 1); assert.equal(first.read(company).revision, 2);
  for (const charts of [[STARTER_CHARTS[0], STARTER_CHARTS[0]], [{ ...STARTER_CHARTS[0], id: '' }], [{ ...STARTER_CHARTS[0], source: {} }], [{ ...STARTER_CHARTS[0], ids: ['company-102:bill-1'] }], [{ ...STARTER_CHARTS[0], ids: ['company-101:missing'] }], Array.from({ length: CHART_LIMIT + 1 }, (_, i) => ({ ...STARTER_CHARTS[0], id: String(i) }))]) {
    assert.throws(() => first.save(company, charts, 2));
  }
  assert.equal(first.read(company).revision, 2);
});

test('production dashboard/evaluation APIs enforce revision, explicit provider and score identity', async t => {
  const db = new ActionStore(':memory:');
  const providers: string[] = [];
  const runtime = createReviewApp({ database: db, companies: () => [source().company], load: source, accounts: () => [], configured: () => true,
    evaluate: async (_req, _signal, rows = []) => { providers.push('jev'); return { results: rows.map(row => ({ id: row.id, state: 'no_match', pMatch: .1 } as const)), costNanoUsd: '0' }; },
    evaluateProvider: async (provider, _req, _signal, rows = []) => { providers.push(provider); return { results: rows.map(row => ({ id: row.id, state: 'match', pMatch: null } as const)), costKind: 'gpu_time_unavailable', costNanoUsd: '0' }; },
  });
  const server = runtime.app.listen(0, '127.0.0.1'); await new Promise<void>(resolve => server.once('listening', resolve));
  t.after(async () => { await runtime.stop(); server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); db.db.close(); });
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const call = (url: string, method: string, body: unknown) => fetch(base + url, { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const id = source().rows[0].id;
  for (const model of ['qwen', 'jev']) {
    const response = await call('/api/evaluate', 'POST', { companyId: company, ids: [id], criterion: 'Criterion', model, expectedIdentity: evaluationContext(model as Provider).identity });
    assert.equal(response.status, 200); const body = await response.json(); assert.equal(body.evaluation.provider, model);
  }
  assert.deepEqual(providers, ['qwen', 'jev']);
  assert.equal((await call('/api/evaluate', 'POST', { companyId: company, ids: [id], criterion: 'Criterion', model: 'invalid' })).status, 400);
  assert.equal((await call('/api/evaluate', 'POST', { companyId: company, ids: [id], criterion: 'Criterion', model: 'qwen', expectedIdentity: 'old-calibration' })).status, 409);
  const url = `/api/companies/${company}/dashboard`;
  assert.equal((await call(url, 'PUT', { charts: [], expectedRevision: 0 })).status, 200);
  assert.equal((await call(url, 'PUT', { charts: STARTER_CHARTS, expectedRevision: 0 })).status, 409);
  assert.equal((await fetch(base + '/api/companies/company-018/dashboard')).status, 404);
  assert.equal((await fetch(base + '/api/companies/' + company + '/chat')).status, 404);
});

test('frozen preparation reproduces 70/15/15 identities and explicitly assembles 800 or 1000 examples without overwrites', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'training-reproduce-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const frozen = JSON.parse(fs.readFileSync('training/semantic-review/splits.json', 'utf8'));
  for (const includeTeacher of [false, true]) {
    const out = path.join(dir, includeTeacher ? 'teacher-v1' : 'overlay-v1'), manifest = prepareFrozenTraining(out, includeTeacher);
    assert.deepEqual(manifest.splits, frozen); assert.deepEqual(Object.values(manifest.splits).map(ids => ids.length), [70, 15, 15]);
    assert.equal(manifest.examples.training, includeTeacher ? 1000 : 800);
    assert.equal(fs.readFileSync(path.join(out, 'train.jsonl'), 'utf8').trim().split('\n').length, manifest.examples.training);
    if (includeTeacher) assert.equal(fs.readFileSync(path.join(out, 'train.jsonl'), 'utf8'), fs.readFileSync('training/semantic-review/train.jsonl', 'utf8').replaceAll('\r\n', '\n'));
    assert.ok(manifest.sourcePopulation.every(id => !/^company-10[1-4]$/.test(id)));
    assert.throws(() => prepareFrozenTraining(out, includeTeacher), /never overwritten/);
  }
  assert.throws(() => prepareFrozenTraining('training/semantic-review/new-version'), /outside the frozen/);
});
