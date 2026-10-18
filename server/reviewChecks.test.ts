import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ActionStore } from './actionStore.ts';
import { WorkspaceData } from './workspaceData.ts';
import { Mailbox } from './mailbox.ts';
import { RuleService } from './ruleService.ts';
import { ReviewCheck, type CheckDefinition, type Judgment } from './reviewChecks.ts';
import { paymentRiskCheck } from './paymentRisk.ts';
import { assessDuplicates, duplicatesCheck } from './duplicates.ts';
import { paymentSignals } from '../src/paymentRisk.ts';
import { duplicateSignals, earlierCandidates, similarDocNumbers } from '../src/duplicates.ts';
import { CHECKS } from '../src/reviewChecks.ts';
import type { CompanyBills, Row } from '../src/types.ts';

const companyId = 'company-101';
const row = (index: number, extra: Partial<Row> = {}): Row => ({ id: `${companyId}:bill-${index}`, companyId, billId: `bill-${index}`, docNumber: `INV-${index}`, date: '2026-09-06', dueDate: '2026-10-06',
  vendor: 'Halvorsen Wholesale', vendorId: 'v1', description: 'Earbuds, pack of twenty.', itemNames: ['Earbuds'], account: 'Inventory Asset', amountCents: 728156, expenseKind: 'product', costCategory: '',
  memo: '', project: null, supplyRole: null, lines: [], payments: [], vendorRecord: { payee_account_ending: '3341', payee_details_last_changed: '2025-10-06' }, projectRecord: null, ...extra });
function setup(rows: Row[]) {
  const db = new ActionStore(':memory:');
  const data = new WorkspaceData(db, id => ({ company: { companyId: id, name: 'Parcelmint', industry: 'Retail', profile: '', billCount: rows.length }, totalBills: rows.length, sampled: false, rows }) satisfies CompanyBills, () => []);
  return { db, data };
}
/** The payment-risk definition with Jev replaced by a fixed answer. */
const withJudge = (def: CheckDefinition, judge: (row: Row) => Omit<Judgment, 'id'>, onCall?: () => void): CheckDefinition =>
  ({ ...def, assess: async (_company, rows) => { onCall?.(); return rows.map(r => ({ id: r.id, ...judge(r) })); } });

test('payment signals explain account mismatches, recent payee changes and pressure language', () => {
  assert.deepEqual(paymentSignals(row(1)), []);
  assert.deepEqual(paymentSignals(row(2, { memo: 'NOTICE: our bank has changed. Please remit all future payments to the account ending 7731. We cannot take confirmation calls this week, so please process today.' })),
    ['Account 7731 differs from 3341 on file', 'Asks to change where payment goes', 'Urgency or secrecy language']);
  assert.deepEqual(paymentSignals(row(3, { vendorRecord: { payee_account_ending: '3341', payee_details_last_changed: '2026-09-06' } })), ['Payee details changed the same day']);
  assert.deepEqual(paymentSignals(row(4, { txnType: 'bank', details: { direction: 'withdrawal', counterparty_account_ending: '7731' } })), ['Account 7731 differs from 3341 on file']);
  assert.deepEqual(paymentSignals(row(5, { txnType: 'bank', details: { direction: 'deposit', counterparty_account_ending: '6261' } })), []);
  assert.deepEqual(paymentSignals(row(6, { txnType: 'invoice', vendorRecord: null, details: { remit_to_account_ending: '1359' }, memo: 'Please send payment to our new account ending 6620.' })),
    ['Account 6620 differs from 1359 on file', 'Asks to change where payment goes']);
});

test('checks are cached by evidence, and escalation flags rows and messages the chosen person once', async t => {
  const rows = [row(1), row(2, { memo: 'Remit to the account ending 7731 today.' }), row(3)];
  const { db, data } = setup(rows); t.after(() => db.db.close());
  let calls = 0;
  const risk = new ReviewCheck(db, data, withJudge(paymentRiskCheck, r => r.id.endsWith('-2') ? { verdict: 'flag', probability: .94, pFlag: .94 } : r.id.endsWith('-3') ? { verdict: 'unsure', probability: .6, pFlag: .2 } : { verdict: 'clear', probability: .9, pFlag: .05 }, () => calls++));
  const mailbox = new Mailbox(db, data);
  const state = await risk.check(companyId, 'all');
  assert.equal(calls, 1); assert.equal(Object.keys(state.results).length, 3);
  assert.equal(state.results[rows[1].id].verdict, 'flag');
  assert.deepEqual(state.results[rows[1].id].signals, ['Account 7731 differs from 3341 on file']);
  assert.equal(state.results[rows[1].id].summary.amountCents, 728156);
  await risk.check(companyId, rows.map(r => r.id)); assert.equal(calls, 1, 'unchanged evidence is not re-checked');
  await assert.rejects(risk.check(companyId, []), /1-1000/);
  assert.throws(() => risk.escalate(companyId, 'emp-nobody', [rows[1].id]), /which employee/);
  assert.throws(() => risk.escalate(companyId, 'emp-ap', [rows[1].id], 'emp-nobody'), /who to send/);
  assert.throws(() => risk.escalate(companyId, 'emp-ap', [rows[0].id, rows[2].id]), /Nothing new/);
  const escalated = risk.escalate(companyId, 'emp-ap', rows.map(r => r.id));
  assert.deepEqual(Object.keys(escalated.escalated), [rows[1].id]); assert.equal(escalated.escalated[rows[1].id].to, 'emp-cfo');
  assert.deepEqual(data.row(companyId, rows[1].id).dashboard?.flags, [CHECKS['payment-risk'].flag]);
  assert.deepEqual(data.row(companyId, rows[0].id).dashboard?.flags, []);
  const mail = mailbox.view(companyId, 'emp-cfo').inbox;
  assert.equal(mail.length, 1); assert.equal(mail[0].from, 'emp-ap'); assert.equal(mail[0].source, 'risk');
  assert.match(mail[0].body, /^Hi Robert,/);
  assert.match(mail[0].body, /INV-2 · Halvorsen Wholesale · \$7281\.56 · 2026-09-06 · Jev 94% suspicious · Account 7731 differs from 3341 on file/);
  assert.throws(() => risk.escalate(companyId, 'emp-ap', [rows[1].id]), /Nothing new/);
  db.write({ ...data.row(companyId, rows[2].id), memo: 'Edited memo' }, data.row(companyId, rows[2].id).sourceVersion!);
  await risk.check(companyId, 'all'); assert.equal(calls, 2, 'an edited transaction is re-checked');
});

test('"check all" is not limited to 1000 transactions', async t => {
  const many = Array.from({ length: 1205 }, (_, i) => row(i + 1));
  const { db, data } = setup(many); t.after(() => db.db.close());
  const risk = new ReviewCheck(db, data, withJudge(paymentRiskCheck, () => ({ verdict: 'clear', probability: .9, pFlag: .01 })));
  assert.equal(Object.keys((await risk.check(companyId, 'all')).results).length, 1205);
  await assert.rejects(risk.check(companyId, many.map(r => r.id)), /1-1000/);
});

test('results stored by the first payment-risk release are read with the new verdicts', t => {
  const { db, data } = setup([row(1)]); t.after(() => db.db.close());
  db.put('payment-risk', companyId, companyId, { results: { [row(1).id]: { id: row(1).id, verdict: 'suspicious', probability: .9, pSuspicious: .9, signals: [], checkedAt: '2026-10-01T00:00:00Z', summary: {} } }, escalated: {}, versions: {} });
  const result = new ReviewCheck(db, data, paymentRiskCheck).state(companyId).results[row(1).id];
  assert.equal(result.verdict, 'flag'); assert.equal(result.pFlag, .9);
});

test('a demo reset forgets every check\'s escalations along with their mail', async t => {
  const rows = [row(1, { memo: 'Remit to the account ending 7731.' }), row(2, { date: '2026-09-10' })];
  const { db, data } = setup(rows); t.after(() => db.db.close());
  const risk = new ReviewCheck(db, data, withJudge(paymentRiskCheck, () => ({ verdict: 'flag', probability: .9, pFlag: .9 })));
  const dupes = new ReviewCheck(db, data, withJudge(duplicatesCheck, () => ({ verdict: 'flag', probability: .8, pFlag: .8 })));
  await risk.check(companyId, 'all'); risk.escalate(companyId, 'emp-ap', [rows[0].id]);
  await dupes.check(companyId, 'all'); dupes.escalate(companyId, 'emp-controller', [rows[1].id]);
  assert.equal(new Mailbox(db, data).view(companyId, 'emp-ap').inbox[0].from, 'emp-controller', 'duplicates go to AP by default');
  new RuleService(db, data, async () => ({})).reset(companyId);
  assert.deepEqual(risk.state(companyId).escalated, {}); assert.deepEqual(dupes.state(companyId).escalated, {});
  assert.equal(Object.keys(dupes.state(companyId).results).length, 2, 'Jev results are kept');
});

test('duplicate candidates are earlier same-vendor transactions of the same type, nearest first, from the whole company', () => {
  const rows = [
    row(1, { date: '2026-09-01', vendorId: 'v1' }), row(2, { date: '2026-09-03', vendorId: 'v1' }), row(3, { date: '2026-09-05', vendorId: 'v2' }),
    row(4, { date: '2026-09-06', vendorId: 'v1', txnType: 'bank' }), row(5, { date: '2026-09-08', vendorId: 'v1' }), row(6, { date: '2026-12-30', vendorId: 'v1' }),
  ];
  assert.deepEqual(earlierCandidates(rows[4], rows).map(c => c.billId), ['bill-2', 'bill-1']);
  assert.deepEqual(earlierCandidates(rows[0], rows), [], 'the first charge has nothing to repeat');
  assert.deepEqual(earlierCandidates(rows[5], rows), [], 'outside the 60-day window');
});

test('duplicate signals compare with the named original and say when no records back them up', () => {
  assert.equal(similarDocNumbers('INV-3478', 'INV-3487'), true);
  assert.equal(similarDocNumbers('INV-3478', 'INV-3479'), true);
  assert.equal(similarDocNumbers('INV-3478', 'INV-9921'), false);
  assert.equal(similarDocNumbers('INV-3478', 'INV-3478'), false);
  const original = row(1, { date: '2026-09-01', docNumber: 'INV-3478', vendor: 'Halvorsen Wholesale' });
  const repeat = row(2, { date: '2026-09-06', docNumber: 'INV-3487', vendor: 'Halvorsen Wholesale Inc.' });
  assert.deepEqual(duplicateSignals(repeat, earlierCandidates(repeat, [original, repeat]), 'bill-1'),
    ['Same amount as INV-3478, 5 days earlier', 'Document number INV-3487 looks like INV-3478', 'Billed under another name: "Halvorsen Wholesale"', 'No supporting records on this transaction']);
  assert.deepEqual(duplicateSignals(repeat, []), []);
});

test('a transaction with no earlier candidates is clear without asking Jev', async () => {
  const only = row(1);
  assert.deepEqual(await assessDuplicates({ name: 'x', industry: 'y' }, [only], [only]), [{ id: only.id, verdict: 'clear', probability: 1, pFlag: 0 }]);
});

test('a duplicate result is re-checked when one of its earlier candidates changes', async t => {
  const rows = [row(1, { date: '2026-09-01' }), row(2, { date: '2026-09-05' })];
  const { db, data } = setup(rows); t.after(() => db.db.close());
  let calls = 0;
  const dupes = new ReviewCheck(db, data, withJudge(duplicatesCheck, () => ({ verdict: 'clear', probability: .9, pFlag: .1 }), () => calls++));
  await dupes.check(companyId, [rows[1].id]); assert.equal(calls, 1);
  await dupes.check(companyId, [rows[1].id]); assert.equal(calls, 1);
  db.write({ ...data.row(companyId, rows[0].id), memo: 'Corrected description' }, data.row(companyId, rows[0].id).sourceVersion!);
  await dupes.check(companyId, [rows[1].id]); assert.equal(calls, 2);
});
