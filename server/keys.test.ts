import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';

// The AI Gateway key (AI_GATEWAY_API_KEY) is for Jev only. Any other model must be called through the
// Gemini provider on GEMINI_API_KEY; a plain model-id string would route through the gateway.
const sources = ['server', 'scripts'].filter(d => fs.existsSync(d)).flatMap(dir => fs.readdirSync(dir).filter(f => f.endsWith('.ts') && !f.endsWith('.test.ts')).map(f => path.join(dir, f)));

test('gateway decision calls only ever use Jev', () => {
  for (const file of sources) {
    for (const m of fs.readFileSync(file, 'utf8').matchAll(/evaluate\(\{\s*model:\s*([^,\s}]+)/g)) assert.equal(m[1], 'JEV_MODEL', `${file} calls evaluate with ${m[1]}`);
  }
});

test('text generation always goes through the Gemini provider', () => {
  for (const file of sources) {
    for (const m of fs.readFileSync(file, 'utf8').matchAll(/generateText\(\{\s*model:\s*([^\n,]+)/g)) assert.match(m[1], /^(google|createGoogleGenerativeAI\()/, `${file} generateText model: ${m[1]}`);
  }
});
