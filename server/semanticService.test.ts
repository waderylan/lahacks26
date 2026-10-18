import assert from 'node:assert/strict';
import test from 'node:test';
import { ActionStore } from './actionStore.ts';
import { WorkspaceData } from './workspaceData.ts';
import { SemanticService } from './semanticService.ts';
import { loadCompanyBills } from './data.ts';
import { judgmentKey } from '../src/jevClient.ts';

test('bank and invoice detail changes invalidate judgments; assignments reuse existing evidence', async t => {
  const db = new ActionStore(':memory:'); t.after(() => db.db.close());
  const original = loadCompanyBills('company-101');
  const data = new WorkspaceData(db, () => original, () => []);
  let calls = 0;
  const semantic = new SemanticService(data, async (_request, _signal, rows = []) => {
    calls++;
    return { results: rows.map(row => ({ id: row.id, state: row.details?.counterparty_account_ending === '9999' || row.details?.remit_to_account_ending === '9999' ? 'match' as const : 'no_match' as const, pMatch: .9 })), costNanoUsd: '0' };
  });
  for (const type of ['bank', 'invoice']) {
    const row = structuredClone(original.rows.find(row => row.txnType === type)!);
    const field = type === 'bank' ? 'counterparty_account_ending' : 'remit_to_account_ending';
    row.details = { ...row.details, [field]: '1111' };
    const initial = await semantic.evaluateRows(row.companyId, 'Payment destination ends in 9999.', [row]);
    assert.equal(initial.results[0].state, 'no_match');
    const assigned = { ...row, sourceVersion: '2', dashboard: { owner: 'Review team', flags: [], tags: [], reviewed: false, automatedCheck: false, taskIds: [] } };
    const before = calls;
    await semantic.evaluateRows(row.companyId, 'Payment destination ends in 9999.', [assigned]);
    assert.equal(calls, before, 'an assignment must not trigger another model call');
    assert.equal(judgmentKey(row, 'criterion'), judgmentKey(assigned, 'criterion'));
    const changed = { ...assigned, details: { ...row.details, [field]: '9999' } };
    const refreshed = await semantic.evaluateRows(row.companyId, 'Payment destination ends in 9999.', [changed]);
    assert.equal(refreshed.results[0].state, 'match', `${type} destination changes must not reuse the old answer`);
    assert.equal(calls, before + 1);
    assert.notEqual(judgmentKey(row, 'criterion'), judgmentKey(changed, 'criterion'));
  }
});
