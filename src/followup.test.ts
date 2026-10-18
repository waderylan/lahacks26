import assert from 'node:assert/strict';
import { test } from 'node:test';
import { aggregate, STARTER_CHARTS, CHART_LIMIT, type ChartSpec } from './charts.ts';
import { dashboardTotals } from './chartMath.ts';
import { createDashboardClient } from './dashboardStore.ts';
import { evaluateCondition, pMatchFor, scoreKindFor, judgmentKey } from './jevClient.ts';
import type { EvaluationContext, Provider } from './modelContext.ts';
import type { Row } from './types.ts';

const row: Row = { id: 'company-101:bill-1', companyId: 'company-101', billId: 'bill-1', docNumber: 'B1', date: '2026-01-01', dueDate: '2026-01-15', vendor: 'Vendor', vendorId: 'v', description: 'Purchase', itemNames: [], account: 'Maintenance', amountCents: 10000, expenseKind: '', costCategory: '', memo: '', project: null, supplyRole: null, lines: [], payments: [], vendorRecord: null, projectRecord: null, txnType: 'bill' };
test('mixed transaction measures never count bank movements or invoices as vendor bills/payables', () => {
  const rows = [row, { ...row, id: 'company-101:invoice', txnType: 'invoice' as const, amountCents: 40000 },
    { ...row, id: 'company-101:deposit', txnType: 'bank' as const, amountCents: 80000, details: { direction: 'deposit' } },
    { ...row, id: 'company-101:withdrawal', txnType: 'bank' as const, amountCents: 30000, details: { direction: 'withdrawal' } },
    { ...row, id: 'company-101:paid', amountCents: 5000, payments: [{ id: 'p', date: '2026-02-01', amountCents: 5000, account: 'Bank' }] }];
  assert.deepEqual(dashboardTotals(rows), { records: 5, bills: 2, billSpend: 15000, payables: 10000, overdue: 10000, receivables: 40000, deposits: 80000, withdrawals: 30000, asOf: '2026-02-01' });
  for (const [measure, expected] of [['spend', 15000], ['open', 10000], ['receivable', 40000], ['bank_in', 80000], ['bank_out', 30000], ['count', 5]] as const) assert.equal(aggregate(rows, { groupBy: 'month', measure }).reduce((sum, point) => sum + point.value, 0), expected);
});

const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
function fakeCharts() {
  let charts = structuredClone(STARTER_CHARTS), revision = 0, failure: 'network' | number | null = null;
  const revisions: number[] = [];
  const request = async (_input: unknown, options?: RequestInit) => {
    if (options?.method === 'PUT') {
      if (failure === 'network') throw new Error('Network unavailable');
      if (failure) return response({ error: 'Save rejected' }, failure);
      const body = JSON.parse(String(options.body)); revisions.push(body.expectedRevision);
      if (body.expectedRevision !== revision) return response({ error: 'Charts changed in another session' }, 409);
      charts = body.charts; revision++;
    }
    return response({ charts, revision });
  };
  return { request: request as typeof fetch, fail: (next: typeof failure) => { failure = next; }, revisions };
}

test('400/500 and network chart failures keep acknowledged state and support explicit retry', async () => {
  for (const status of [400, 500, 'network'] as const) {
    const server = fakeCharts(), client = createDashboardClient(server.request), id = 'company-101';
    await client.refresh(id); server.fail(status);
    assert.equal(await client.mutate(id, charts => charts.slice(1)), false);
    assert.equal(client.get(id).charts.length, 4); assert.ok(client.get(id).error); assert.equal(client.get(id).busy, false);
    server.fail(null); await client.retry(id);
    assert.equal(client.get(id).charts.length, 3); assert.equal(client.get(id).error, '');
    await client.refresh(id); assert.equal(client.get(id).charts.length, 3);
  }
});

test('chart mutations serialize and stale sessions refresh on conflict without resurrecting cards', async () => {
  const server = fakeCharts(), a = createDashboardClient(server.request), b = createDashboardClient(server.request), id = 'company-101';
  await Promise.all([a.refresh(id), b.refresh(id)]);
  await a.mutate(id, charts => charts.slice(1));
  assert.equal(await b.mutate(id, charts => charts.filter(chart => chart.id !== 'starter-accounts')), false);
  assert.equal(b.get(id).charts.length, 3); assert.ok(b.get(id).error.includes('another session'));
  await b.retry(id); assert.equal(b.get(id).charts.length, 2);
  const first = b.mutate(id, charts => [...charts, { ...STARTER_CHARTS[0], id: 'extra' }]);
  const second = b.mutate(id, charts => charts.filter(chart => chart.id !== 'starter-payables'));
  assert.deepEqual(await Promise.all([first, second]), [true, true]);
  assert.equal(b.get(id).charts.length, 2); assert.equal(b.get(id).busy, false);
  await a.refresh(id); assert.deepEqual(a.get(id).charts, b.get(id).charts);
  assert.deepEqual(server.revisions, [0, 0, 1, 2, 3]);
});

test('the 25th chart is visibly rejected before any write', async () => {
  const server = fakeCharts(), client = createDashboardClient(server.request), id = 'company-101'; await client.refresh(id);
  assert.equal(await client.mutate(id, () => Array.from({ length: CHART_LIMIT + 1 }, (_, i) => ({ ...STARTER_CHARTS[0], id: String(i) }))), false);
  assert.match(client.get(id).error, /24 charts/); assert.equal(server.revisions.length, 0); assert.equal(client.get(id).charts.length, 4);
});

test('evaluation transport uses explicit contexts, separates caches and retains missing/raw/adjusted score semantics', async t => {
  const calls: string[] = [];
  t.mock.method(globalThis, 'fetch', async (_url: RequestInfo | URL, options?: RequestInit) => {
    const body = JSON.parse(options!.body as string); calls.push(body.model);
    return response({ results: [{ id: row.id, state: 'match', pMatch: body.expectedIdentity === 'missing' ? null : .75, scoreKind: body.expectedIdentity === 'adjusted' ? 'validation_calibrated' : 'candidate_score_uncalibrated' }], costNanoUsd: '0' });
  });
  const context = (provider: Provider, identity: string): EvaluationContext => ({ provider, identity, model: provider, policyVersion: 'test', scoreVersion: identity });
  const data = { company: { companyId: row.companyId, name: 'Test', industry: '', profile: '', billCount: 1 }, rows: [row] };
  let outcome = '';
  const missing = context('qwen', 'missing'), adjusted = context('qwen', 'adjusted'), raw = context('qwen', 'raw');
  await evaluateCondition(data, 'Independent dispatch', (_row, result) => { outcome = result; }, undefined, missing);
  assert.equal(outcome, 'true'); assert.equal(pMatchFor(row, 'Independent dispatch', missing), undefined);
  await evaluateCondition(data, 'Independent dispatch', () => {}, undefined, raw);
  assert.equal(scoreKindFor(row, 'Independent dispatch', raw), 'candidate_score_uncalibrated');
  await evaluateCondition(data, 'Independent dispatch', () => {}, undefined, adjusted);
  assert.equal(scoreKindFor(row, 'Independent dispatch', adjusted), 'validation_calibrated');
  await evaluateCondition(data, 'Independent dispatch', () => {}, undefined, context('jev', 'explicit-jev'));
  assert.deepEqual(calls, ['qwen', 'qwen', 'qwen', 'jev']);
  assert.notEqual(judgmentKey(row, 'Independent dispatch', raw), judgmentKey(row, 'Independent dispatch', adjusted));
});
