import { test } from 'node:test';
import assert from 'node:assert/strict';
import { firstJsonObject } from './messages.ts';

test('firstJsonObject recovers the object when a model adds text after the JSON', () => {
  assert.deepEqual(firstJsonObject(' {\n  "subject": "Bill {5250}",\n  "body": "Say \\"hi\\" }"\n}\n\nHere is your draft.'), { subject: 'Bill {5250}', body: 'Say "hi" }' });
  assert.deepEqual(firstJsonObject('```json\n{"a":{"b":1}}\n```\n{"c":2}'), { a: { b: 1 } });
  assert.equal(firstJsonObject('no json here'), undefined);
  assert.equal(firstJsonObject('{"unterminated": "x"'), undefined);
});
