import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ActionStore } from './actionStore.ts';
import { ChatStore } from './chat.ts';

test('chat history persists in SQLite per company and employee', () => {
  const chat = new ChatStore(new ActionStore(':memory:'), {} as any);
  chat.save('company-001', { id: 't1', as: 'emp-ap', question: 'q1', createdAt: '2026-01-01T00:00:00Z' });
  chat.save('company-001', { id: 't2', as: 'emp-it', question: 'q2', createdAt: '2026-01-02T00:00:00Z' });
  chat.save('company-002', { id: 't3', as: 'emp-ap', question: 'q3', createdAt: '2026-01-03T00:00:00Z' });
  assert.deepEqual(chat.history('company-001', 'emp-ap').map(t => t.id), ['t1']);
  assert.throws(() => chat.save('company-001', { id: 't4', as: 'nobody', question: 'x' }));
  chat.clear('company-001', 'emp-ap');
  assert.deepEqual(chat.history('company-001', 'emp-ap'), []);
  assert.equal(chat.history('company-001', 'emp-it').length, 1);
  assert.equal(chat.history('company-002', 'emp-ap').length, 1);
});
