import assert from 'node:assert/strict';
import test from 'node:test';
import { ActionStore } from './actionStore.ts';
import { WorkspaceData } from './workspaceData.ts';
import { SemanticService } from './semanticService.ts';
import { loadCompanyBills } from './data.ts';
import { judgmentKey } from '../src/jevClient.ts';
import { evaluationEvidence } from '../src/jevEvidence.ts';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

test('saved judgments survive SQLite reopen and are shared between Explore and rule checks', async () => {
  const filename = path.join(os.tmpdir(), `jev-cache-${randomUUID()}.sqlite`);
  const original = loadCompanyBills('company-018');
  let db = new ActionStore(filename);
  let calls = 0;
  const evaluate = async (_request: unknown, _signal: unknown, rows: import('../src/types.ts').Row[] = []) => {
    calls++;
    return { results: rows.map(row => ({ id: row.id, state: 'uncertain' as const, pMatch: .5 })), costNanoUsd: '100' };
  };
  try {
    let data = new WorkspaceData(db, () => original, () => []);
    const row = data.bills('company-018').rows[0];
    assert.equal((await new SemanticService(data, evaluate).evaluateRows(row.companyId, 'Missing documentation', [row])).costNanoUsd, '100');
    db.db.close();
    db = new ActionStore(filename);
    data = new WorkspaceData(db, () => original, () => []);
    const service = new SemanticService(data, evaluate);
    assert.deepEqual(await service.judge(row.companyId, 'Missing documentation', [row]), { [row.id]: 'uncertain' });
    assert.equal(calls, 1, 'restarted rule checks reuse the saved Explore answer');
    assert.equal((await service.evaluateRows(row.companyId, 'Missing documentation', [row])).costNanoUsd, '0');
    await service.evaluateRows(row.companyId, 'Different condition', [row]);
    assert.equal(calls, 2);
  } finally { db.db.close(); for (const suffix of ['', '-wal', '-shm']) fs.rmSync(filename + suffix, { force: true }); }
});

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

test('new reviewer details replace a cached uncertain judgment and reach the model context', async t => {
  const db = new ActionStore(':memory:'); t.after(() => db.db.close());
  const original = loadCompanyBills('company-018');
  const data = new WorkspaceData(db, () => original, () => []);
  const row = data.bills('company-018').rows[0];
  let calls = 0;
  const semantic = new SemanticService(data, async (_request, _signal, rows = []) => {
    calls++;
    return { results: rows.map(row => ({ id: row.id, state: row.evidence?.length ? 'no_match' as const : 'uncertain' as const, pMatch: .1 })), costNanoUsd: '0' };
  });
  assert.equal((await semantic.evaluateRows(row.companyId, 'This charge lacks support.', [row])).results[0].state, 'uncertain');
  const updated = { ...row, evidence: [{ id: 'review-note', kind: 'reviewer_note', title: 'Receipt verified', date: '2026-10-17', text: 'The receipt supports the charge.' }] };
  assert.equal((await semantic.evaluateRows(row.companyId, 'This charge lacks support.', [updated])).results[0].state, 'no_match');
  assert.equal(calls, 2);
  assert.notEqual(judgmentKey(row, 'criterion'), judgmentKey(updated, 'criterion'));
  assert.deepEqual(evaluationEvidence(updated).evidence, [{ kind: 'reviewer_note', title: 'Receipt verified', date: '2026-10-17', text: 'The receipt supports the charge.' }]);
});
