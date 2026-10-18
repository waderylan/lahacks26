import assert from 'node:assert/strict';
import test from 'node:test';
import { activityFeed, transactionTimeline } from './activity';
import type { ActionPlan, ReviewTask } from './actionTypes';
import type { DraftMessage, HistoryEntry } from './rules';

const snapshot = { result: 'true' as const, conditions: {} };
const entry = (patch: Partial<HistoryEntry>): HistoryEntry => ({ id: 'h1', key: 'k', ruleId: 'r', ruleName: 'Duplicate check', revision: 1, companyId: 'company-101', transactionId: 'company-101:bill-1', transactionVersion: 'v', action: null, timestamp: '2026-10-02T10:00:00Z', previous: null, resulting: null, snapshot, source: 'run', ...patch });
const message = (patch: Partial<DraftMessage>): DraftMessage => ({ id: 'm1', companyId: 'company-101', items: [{ transactionId: 'company-101:bill-1', billId: 'bill-1', context: [] }], batchId: 'b', ruleId: 'r', ruleName: 'Duplicate check', revision: 1, actionId: 'a', to: 'Marcus Bell', subject: 'Check', body: 'Hi', reason: '', status: 'pending', edited: false, createdAt: '2026-10-02T10:01:00Z', employeeId: 'emp-controller', senderId: 'emp-ap', ...patch });
const plan = (patch: Partial<ActionPlan> = {}): ActionPlan => ({ id: 'p1', companyId: 'company-101', action: { type: 'review', reviewed: true }, criterion: '', createdAt: '2026-10-02T09:00:00Z', status: 'finished', items: [{ billId: 'company-101:bill-1', vendor: 'V', version: 'v', before: 'Needs review', after: 'Reviewed', status: 'succeeded' }], ...patch });
const task = (patch: Partial<ReviewTask> = {}): ReviewTask => ({ id: 't1', companyId: 'company-101', billId: 'company-101:bill-1', vendor: 'V', title: 'Check', owner: 'emp-ap', dueDate: '2026-10-05', status: 'done', createdAt: '2026-10-02T10:00:00Z', updatedAt: '2026-10-03T10:00:00Z', ...patch });

test('one feed combines rule actions, resolutions, messages, task completion and manual review', () => {
  const feed = activityFeed({ companyId: 'company-101', tasks: [task()], runs: [plan()],
    messages: [message({ status: 'approved', decidedAt: '2026-10-02T11:00:00Z' })],
    history: [entry({ action: { id: 'a', type: 'flag', value: 'Possible duplicate' } }), entry({ id: 'h2', timestamp: '2026-10-02T12:00:00Z', resolution: { issueId: 'i', flags: ['x'], taskIds: [], kept: [] } })] });
  assert.deepEqual(feed.map(event => event.label), ['Task done: Check', 'Issue resolved: Duplicate check', 'Message sent to Marcus', 'Flagged: Possible duplicate', 'Marked reviewed']);
});

test('events deduplicate by stable id and ignore other companies', () => {
  const same = entry({ action: { id: 'a', type: 'tag', value: 'Follow up' } });
  const feed = activityFeed({ companyId: 'company-101', history: [same, same, entry({ id: 'other', companyId: 'company-102', action: { id: 'a', type: 'tag', value: 'X' } })], messages: [], runs: [plan(), plan()], tasks: [] });
  assert.equal(feed.length, 2);
});

test('action activity identifies the evaluator saved with the action', () => {
  const evaluation = { provider: 'qwen' as const, model: 'recorded-model', identity: 'old-identity', policyVersion: 'p1', scoreVersion: 'raw-v1' };
  const feed = activityFeed({ companyId: 'company-101', messages: [], runs: [], tasks: [], history: [
    entry({ action: { id: 'a', type: 'flag', value: 'Review' }, snapshot: { ...snapshot, evaluation } }),
  ] });
  assert.match(feed[0].detail!, /Revision 1 · Qwen · recorded-model/);
});

test('timeline narrows to one transaction and undo follows the source', () => {
  const feed = activityFeed({ companyId: 'company-101', tasks: [], messages: [], runs: [plan()],
    history: [entry({ action: { id: 'a', type: 'assign', value: 'emp-ap' } }), entry({ id: 'h3', transactionId: 'company-101:bill-2', action: { id: 'a', type: 'flag', value: 'F' }, undoneAt: '2026-10-02T11:00:00Z' })] });
  const timeline = transactionTimeline(feed, 'company-101:bill-1');
  assert.deepEqual(timeline.map(event => event.undo?.kind).sort(), ['receipt', 'rule']);
  assert.equal(timeline.find(event => event.undo?.kind === 'rule')?.label, 'Assigned to Priya Natarajan');
  const undone = feed.find(event => event.id === 'rule:h3')!;
  assert.equal(undone.undo, undefined); assert.equal(undone.tone, 'muted');
});
