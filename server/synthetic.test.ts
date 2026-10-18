import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { listCompanies, loadCompanyBills, demoSample, formatCents } from './data.ts';
import { ActionStore } from './actionStore.ts';
import { WorkspaceData } from './workspaceData.ts';
import { supportingContext } from './jev.ts';

const FORBIDDEN = /fraud|suspicious|scenario|inject|answer key|expected|ground.?truth|documentation_issue|legitimate|uncertain/i;
const ids = ['company-101', 'company-102', 'company-103', 'company-104'];

test('synthetic companies are listed and labeled, originals are untouched', () => {
  const companies = listCompanies();
  for (const id of ids) assert.equal(companies.find(c => c.companyId === id)?.synthetic, true);
  assert.equal(companies.filter(c => c.synthetic).length, 4);
  assert.equal(companies.filter(c => !c.synthetic && !c.scenario).length, 100);
  const original = loadCompanyBills('company-018');
  assert.ok(original.rows.every(r => r.evidence === undefined && r.related === undefined));
  assert.deepEqual(supportingContext(original.rows[0]), {});
});

test('model payloads for synthetic rows carry records but no labels or case ids', () => {
  const cases = JSON.parse(fs.readFileSync('synthetic/eval/case_manifest.json', 'utf8')).cases as { case_id: string; variant: string }[];
  for (const id of ids) {
    const { rows, disclosure } = loadCompanyBills(id);
    assert.ok(rows.length >= 250 && disclosure);
    for (const type of ['bill', 'invoice', 'bank']) assert.ok(rows.some(r => r.txnType === type), `${id} has no ${type} rows`);
    assert.ok(rows.some(r => (r.evidence?.length ?? 0) > 0) && rows.some(r => (r.related?.length ?? 0) > 0));
    for (const row of rows) {
      const payload = JSON.stringify({ id: row.billId, description: row.description, memo: row.memo, ...supportingContext(row) });
      assert.ok(!cases.some(c => payload.includes(c.case_id) || payload.includes(c.variant)), `case marker in ${row.id}`);
      assert.ok(!FORBIDDEN.test(payload), `label-like word in ${row.id}: ${payload.match(FORBIDDEN)?.[0]}`);
    }
    const sample = demoSample(id)!;
    assert.ok(sample.ids.size > 40 && /not representative/.test(sample.disclosure));
  }
});

test('formatCents writes dollar strings from integer cents', () => {
  assert.equal(formatCents(1050), '10.50');
  assert.equal(formatCents(0), '0.00');
  assert.equal(formatCents(-1), '-0.01');
  assert.equal(formatCents(100), '1.00');
});

test('a changed dataset version replaces that company\'s cached rows and nothing else', async () => {
  const store = new ActionStore(':memory:');
  const a = loadCompanyBills('company-101').rows.slice(0, 3);
  const b = loadCompanyBills('company-102').rows.slice(0, 2);
  store.seed('company-101', a, 'v1'); store.seed('company-102', b, 'v1');
  store.seed('company-101', a, 'v1');
  assert.equal(store.rows('company-101').length, 3);
  store.seed('company-101', a.slice(0, 1), 'v2');
  assert.equal(store.rows('company-101').length, 1, 'new version replaces the stale rows');
  assert.equal(store.rows('company-102').length, 2, 'other companies keep their rows');
  store.seed('company-018', loadCompanyBills('company-018').rows.slice(0, 2));
  assert.equal(store.rows('company-018').length, 2, 'unversioned companies are seeded once as before');
  store.db.close();
});

test('WorkspaceData reseeds and clears accounts when the dataset version changes', () => {
  const store = new ActionStore(':memory:');
  const first = loadCompanyBills('company-101').rows.slice(0, 3);
  const next = first.slice(0, 1);
  let version = 'v1';
  let rows = first;
  const data = new WorkspaceData(store, id => ({
    company: { companyId: id, name: id, industry: '', profile: '', billCount: rows.length, synthetic: true },
    totalBills: rows.length, sampled: false, rows, datasetVersion: version,
  }), () => version === 'v1' ? [{ id: 'old', name: 'Old account' }] : [{ id: 'new', name: 'New account' }]);
  try {
    assert.equal(data.bills('company-101').rows.length, 3);
    assert.equal(data.accounts('company-101')[0].name, 'Old account');
    version = 'v2'; rows = next;
    assert.equal(data.bills('company-101').rows.length, 1);
    assert.equal(data.accounts('company-101')[0].name, 'New account');
  } finally { store.db.close(); }
});
