import assert from 'node:assert/strict';
import { test } from 'node:test';
import { combineUnderstanding, parseQuestion, periodFromKey } from './insights.ts';

const LATEST = '2026-10-06';

test('total with topic and quarter', () => {
  const p = parseQuestion('How much did we spend on software subscriptions in Q2?', LATEST);
  assert.equal(p.intent, 'total');
  assert.equal(p.topic, 'software subscriptions');
  assert.equal(p.criterion, 'Bills for software subscriptions');
  assert.equal(p.period?.label, 'Q2');
  assert.ok(p.period!.test('2026-05-01'));
  assert.ok(!p.period!.test('2026-07-01'));
});

test('period only needs no Jev', () => {
  const p = parseQuestion('How much did we spend in March?', LATEST);
  assert.equal(p.criterion, null);
  assert.ok(p.period!.test('2026-03-15'));
  assert.ok(!p.period!.test('2026-04-15'));
});

test('intents', () => {
  assert.equal(parseQuestion('Which vendors do we buy electronics from?', LATEST).intent, 'vendors');
  assert.equal(parseQuestion('How many bills were for repairs in Q2?', LATEST).intent, 'count');
  assert.equal(parseQuestion('Utilities by month', LATEST).intent, 'months');
  assert.equal(parseQuestion('Show me bills where the memo mentions a delay', LATEST).intent, 'list');
});

test('topics', () => {
  assert.equal(parseQuestion('Which vendors do we buy electronics from?', LATEST).topic, 'electronics');
  assert.equal(parseQuestion('How many bills were for repairs in Q2?', LATEST).topic, 'repairs');
  assert.equal(parseQuestion('Utilities by month', LATEST).criterion, 'Bills for Utilities');
  assert.equal(parseQuestion('Show me bills where the memo mentions a delay', LATEST).criterion, 'bills where the memo mentions a delay');
});

test('relative period', () => {
  const p = parseQuestion('What did we spend on packaging in the last 30 days?', LATEST);
  assert.equal(p.topic, 'packaging');
  assert.ok(p.period!.test('2026-09-20'));
  assert.ok(!p.period!.test('2026-08-01'));
});

test('plural relative period', () => {
  const p = parseQuestion('What did we spend in the last 3 months?', LATEST);
  assert.equal(p.criterion, null);
  assert.ok(p.period!.test('2026-08-01'));
  assert.ok(!p.period!.test('2026-05-01'));
});

const jev = (intent: any, scope: any, period: string) => ({ intent, scope, period, confidence: { intent: 1, scope: 1, period: 1 }, costNanoUsd: '0', ms: 0 });

test('Jev reading: fuzzy period and whole question as criterion', () => {
  const q = 'what is our burn on contractors since spring?';
  const p = combineUnderstanding(q, parseQuestion(q, LATEST), jev('total', 'specific', 'last_180_days'), LATEST);
  assert.equal(p.intent, 'total');
  assert.ok(p.criterion!.includes(q));
  assert.ok(p.period!.test('2026-06-01'));
  assert.ok(!p.period!.test('2026-01-01'));
});

test('explicit period from text rules wins; everything scope skips per-bill judging', () => {
  const q = 'How much did we spend in March?';
  const p = combineUnderstanding(q, parseQuestion(q, LATEST), jev('total', 'everything', 'q2'), LATEST);
  assert.equal(p.criterion, null);
  assert.equal(p.period?.label, 'March');
});

test('period keys', () => {
  assert.ok(periodFromKey('q4', LATEST)!.test('2025-11-03'));
  assert.ok(periodFromKey('h1', LATEST)!.test('2026-06-30'));
  assert.ok(!periodFromKey('h1', LATEST)!.test('2026-07-01'));
  assert.equal(periodFromKey('none', LATEST), null);
});

test('explicit my-work wording wins over a different Jev reading', () => {
  const q = "What's on my plate?";
  assert.equal(combineUnderstanding(q, parseQuestion(q, LATEST), jev('list', 'everything', 'none'), LATEST).intent, 'my_work');
  const q2 = 'anything I should look at today';
  assert.equal(combineUnderstanding(q2, parseQuestion(q2, LATEST), jev('my_work', 'everything', 'none'), LATEST).intent, 'my_work');
});
