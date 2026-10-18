import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { listCompanies, loadCompanyBills, demoSample } from './data.ts';
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
    assert.ok(rows.length >= 150 && rows.length <= 250 && disclosure);
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
