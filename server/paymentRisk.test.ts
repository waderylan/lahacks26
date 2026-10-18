import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ActionStore } from './actionStore.ts';
import { WorkspaceData } from './workspaceData.ts';
import { Mailbox } from './mailbox.ts';
import { PaymentRisk, type Assessor } from './paymentRisk.ts';
import { paymentSignals, RISK_FLAG } from '../src/paymentRisk.ts';
import type { CompanyBills, Row } from '../src/types.ts';

const companyId = 'company-101';
const row = (index: number, extra: Partial<Row> = {}): Row => ({ id: `${companyId}:bill-${index}`, companyId, billId: `bill-${index}`, docNumber: `INV-${index}`, date: '2026-09-06', dueDate: '2026-10-06',
  vendor: 'Halvorsen Wholesale', vendorId: 'v1', description: 'Earbuds, pack of twenty.', itemNames: ['Earbuds'], account: 'Inventory Asset', amountCents: 728156, expenseKind: 'product', costCategory: '',
  memo: '', project: null, supplyRole: null, lines: [], payments: [], vendorRecord: { payee_account_ending: '3341', payee_details_last_changed: '2025-10-06' }, projectRecord: null, ...extra });

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

test('checks are cached by evidence, and escalation flags suspicious rows and messages the CFO once', async t => {
  const db = new ActionStore(':memory:'); t.after(() => db.db.close());
  const rows = [row(1), row(2, { memo: 'Remit to the account ending 7731 today.' }), row(3)];
  const data = new WorkspaceData(db, id => ({ company: { companyId: id, name: 'Parcelmint', industry: 'Retail', profile: '', billCount: 3 }, totalBills: 3, sampled: false, rows }) satisfies CompanyBills, () => []);
  let calls = 0;
  const assess: Assessor = async (_company, batch) => { calls++; return batch.map(r => ({ id: r.id, verdict: r.id.endsWith('-2') ? 'suspicious' : r.id.endsWith('-3') ? 'cannot_tell' : 'safe', probability: .9, pSuspicious: r.id.endsWith('-2') ? .94 : .05 })); };
  const risk = new PaymentRisk(db, data, assess), mailbox = new Mailbox(db, data);
  const state = await risk.check(companyId, 'all');
  assert.equal(calls, 1); assert.equal(Object.keys(state.results).length, 3);
  assert.equal(state.results[rows[1].id].verdict, 'suspicious');
  assert.deepEqual(state.results[rows[1].id].signals, ['Account 7731 differs from 3341 on file']);
  assert.equal(state.results[rows[1].id].summary.amountCents, 728156);
  await risk.check(companyId, rows.map(r => r.id)); assert.equal(calls, 1, 'unchanged evidence is not re-checked');
  await assert.rejects(risk.check(companyId, []), /1-1000/);
  assert.throws(() => risk.escalate(companyId, 'emp-nobody', [rows[1].id]), /which employee/);
  assert.throws(() => risk.escalate(companyId, 'emp-ap', [rows[0].id, rows[2].id]), /Nothing new/);
  const escalated = risk.escalate(companyId, 'emp-ap', rows.map(r => r.id));
  assert.deepEqual(Object.keys(escalated.escalated), [rows[1].id]);
  assert.deepEqual(data.row(companyId, rows[1].id).dashboard?.flags, [RISK_FLAG]);
  assert.deepEqual(data.row(companyId, rows[0].id).dashboard?.flags, []);
  const mail = mailbox.view(companyId, 'emp-cfo').inbox;
  assert.equal(mail.length, 1); assert.equal(mail[0].from, 'emp-ap'); assert.equal(mail[0].source, 'risk');
  assert.match(mail[0].body, /INV-2 · Halvorsen Wholesale · \$7281\.56 · 2026-09-06 · Jev 94% suspicious · Account 7731 differs from 3341 on file/);
  assert.deepEqual(mail[0].items.map(i => i.transactionId), [rows[1].id]);
  assert.throws(() => risk.escalate(companyId, 'emp-ap', [rows[1].id]), /Nothing new/);
  db.write({ ...data.row(companyId, rows[2].id), memo: 'Edited memo' }, data.row(companyId, rows[2].id).sourceVersion!);
  await risk.check(companyId, 'all'); assert.equal(calls, 2, 'an edited transaction is re-checked');
});
