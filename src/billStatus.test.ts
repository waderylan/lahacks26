import { test } from 'node:test';
import assert from 'node:assert/strict';
import { billEvents, billStatus } from './billStatus';
import type { ActionPlan } from './actionTypes';
import type { DraftMessage, HistoryEntry } from './rules';

const id = 'company-018:bill-1';
const entry = (type: 'flag' | 'assign', value: string, at: string, undoneAt?: string) => ({ transactionId: id, timestamp: at, undoneAt, action: { id: type, type, value } }) as HistoryEntry;
const message = (status: DraftMessage['status'], at: string, generation: DraftMessage['generation'] = 'ready') =>
  ({ status, generation, employeeId: 'emp-controller', senderId: 'emp-ap', createdAt: at, decidedAt: status === 'pending' ? undefined : at, items: [{ transactionId: id, billId: 'bill-1', context: [] }] }) as unknown as DraftMessage;

test('status shows the latest action taken on a bill, falling back to review state', () => {
  assert.deepEqual(billStatus(undefined, false), { label: 'Needs review', tone: 'need', events: [] });
  assert.equal(billStatus(undefined, true).label, 'Reviewed');
  const flagged = billEvents([entry('flag', 'Needs clarification', '2026-01-01T10:00:00Z')], [], []);
  assert.equal(billStatus(flagged.get(id), false).label, 'Flagged: Needs clarification');
  const drafting = billEvents([entry('flag', 'x', '2026-01-01T10:00:00Z')], [message('pending', '2026-01-01T11:00:00Z', 'pending')], []);
  assert.equal(billStatus(drafting.get(id), false).label, 'Drafting message…');
  assert.equal(billStatus(billEvents([], [message('pending', '2026-01-01T11:00:00Z')], []).get(id), false).label, 'Message to Marcus awaiting Priya');
  const sent = billEvents([entry('assign', 'Bookkeeper', '2026-01-01T10:00:00Z')], [message('approved', '2026-01-01T12:00:00Z')], []);
  assert.equal(billStatus(sent.get(id), false).label, 'Sent message to Marcus');
  assert.equal(sent.get(id)!.length, 2);
  assert.equal(billEvents([entry('flag', 'x', '2026-01-01T10:00:00Z', '2026-01-01T10:05:00Z')], [], []).get(id), undefined);
  const runs = [{ createdAt: '2026-01-01T13:00:00Z', action: { type: 'task', title: 'Check receipt', owner: 'Dev', dueDate: '' }, items: [{ billId: id, status: 'succeeded' }] }] as unknown as ActionPlan[];
  assert.equal(billStatus(billEvents([], [message('approved', '2026-01-01T12:00:00Z')], runs).get(id), true).label, 'Task for Dev: Check receipt');
});
