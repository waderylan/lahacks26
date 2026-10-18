import assert from 'node:assert/strict';
import test from 'node:test';
import { ownerKey, ownerLabel, ownerOptions, resolveEmployee, sameOwner } from './employees';

test('IDs and legacy names resolve to the same employee; unknown labels are preserved', () => {
  assert.equal(resolveEmployee('Priya Natarajan')?.id, 'emp-ap');
  assert.ok(sameOwner('emp-ap', 'priya natarajan'));
  assert.equal(ownerLabel('emp-ap'), 'Priya Natarajan');
  assert.equal(ownerLabel('Bookkeeper'), 'Bookkeeper');
  assert.equal(ownerLabel(''), 'Unassigned');
  assert.ok(!sameOwner('Bookkeeper', 'emp-ap'));
  assert.ok(!sameOwner('', ''));
  assert.equal(ownerKey('Payment review'), 'Payment review');
});

test('owner options list employees first, then stored labels once', () => {
  const options = ownerOptions(['Bookkeeper', 'emp-ap', 'Priya Natarajan', 'Bookkeeper', '']);
  assert.equal(options.filter(o => o.value === 'emp-ap').length, 1);
  assert.deepEqual(options.slice(-1), [{ value: 'Bookkeeper', label: 'Bookkeeper' }]);
});
