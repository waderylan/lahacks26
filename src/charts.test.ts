import assert from 'node:assert/strict';
import { test } from 'node:test';
import { aggregate, chartForAnswer } from './charts.ts';
import type { Row } from './types.ts';

const row = (id: string, fields: Partial<Row>): Row => ({
  id: `company-001:${id}`, companyId: 'company-001', billId: id, docNumber: id, date: '2026-01-01', dueDate: '2026-01-31', vendor: 'Acme', vendorId: 'v1',
  description: '', itemNames: [], account: 'Supplies', amountCents: 1000, expenseKind: 'product', costCategory: '', memo: '', project: null, supplyRole: null,
  lines: [], payments: [], vendorRecord: null, projectRecord: null, ...fields,
});

const rows = [
  row('a', { date: '2026-03-02', amountCents: 500, vendor: 'B' }),
  row('b', { date: '2026-01-15', amountCents: 250, vendor: 'A' }),
  row('c', { date: '2026-01-20', amountCents: 125, vendor: 'A', payments: [{ id: 'p', date: '2026-01-25', amountCents: 125, account: 'Bank' }] }),
];

test('months are chronological and summed in integer cents', () => {
  assert.deepEqual(aggregate(rows, { groupBy: 'month', measure: 'spend' }).map(p => [p.key, p.value, p.count]), [['2026-01', 375, 2], ['2026-03', 500, 1]]);
});

test('ids restrict a chart to the bills a chat answer picked', () => {
  assert.deepEqual(aggregate(rows, { groupBy: 'vendor', measure: 'count', ids: ['company-001:b', 'company-001:c'] }).map(p => [p.label, p.value]), [['A', 2]]);
});

test('open balance skips paid bills', () => {
  const pts = aggregate(rows, { groupBy: 'vendor', measure: 'open' });
  assert.deepEqual(pts.map(p => [p.label, p.value]), [['B', 500], ['A', 250]]);
});

test('vendors beyond the top 8 fold into Other', () => {
  const many = Array.from({ length: 12 }, (_, i) => row(`v${i}`, { vendor: `V${i}`, amountCents: 100 * (i + 1) }));
  const pts = aggregate(many, { groupBy: 'vendor', measure: 'spend' });
  assert.equal(pts.length, 8);
  assert.equal(pts[7].label, 'Other (5)');
  assert.equal(pts.reduce((s, p) => s + p.value, 0), many.reduce((s, r) => s + r.amountCents, 0));
});

test('chat answers get a matching chart shape', () => {
  assert.equal(chartForAnswer('vendors').groupBy, 'vendor');
  assert.equal(chartForAnswer('count').measure, 'count');
  assert.equal(chartForAnswer('upcoming').groupBy, 'due');
});

test('graph questions are detected and shaped by their wording', async () => {
  const { graphRequest } = await import('./charts.ts');
  assert.equal(graphRequest('How much did we spend on utilities?', 'total').wanted, false);
  assert.deepEqual(graphRequest('graph utilities by month', 'total'), { wanted: true, spec: { groupBy: 'month', measure: 'spend', kind: 'bar' } });
  assert.deepEqual(graphRequest('chart electronics spend by vendor', 'total').spec, { groupBy: 'vendor', measure: 'spend', kind: 'hbar' });
  assert.deepEqual(graphRequest('plot how many repair bills per month', 'count').spec, { groupBy: 'month', measure: 'count', kind: 'bar' });
  assert.deepEqual(graphRequest('show the trend of rent over time', 'total').spec, { groupBy: 'month', measure: 'spend', kind: 'line' });
  assert.deepEqual(graphRequest('visualize what we owe by due date', 'upcoming').spec, { groupBy: 'due', measure: 'open', kind: 'bar' });
});

test('chart titles start with a capital and drop the "graph" command', async () => {
  const { chartTitle } = await import('./charts.ts');
  assert.equal(chartTitle('graph utilities by month'), 'Utilities by month');
  assert.equal(chartTitle('chart electronics spend by vendor?'), 'Electronics spend by vendor');
  assert.equal(chartTitle('show me a graph of rent over time'), 'Rent over time');
  assert.equal(chartTitle('can you plot how many repair bills per month'), 'How many repair bills per month');
  assert.equal(chartTitle('utilities by month'), 'Utilities by month');
  assert.equal(chartTitle('graph'), 'Graph');
});
