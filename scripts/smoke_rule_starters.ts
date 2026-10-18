/** Live, read-only model checks using the same HTTP path and public records as the UI. */
import fs from 'node:fs';
import { rulePresets, leaves, evaluateTree, actionsForOutcome, type Outcome } from '../src/rules.ts';
import { STARTER_DEMOS } from '../src/ruleStarterDemos.ts';
import type { CompanyBills } from '../src/types.ts';

const url = process.env.RULES_TEST_URL ?? 'http://localhost:5192';
const report: unknown[] = [];
const failures: string[] = [];
let cost = 0n;
async function json(path: string, body?: unknown) {
  const response = await fetch(`${url}${path}`, body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : undefined);
  if (!response.ok) throw new Error(`${response.status} from ${path}`);
  return response.json();
}
for (const [companyId, demo] of Object.entries(STARTER_DEMOS)) {
  const data: CompanyBills = await json(`/api/companies/${companyId}/bills?limit=-1&reserve=1`);
  for (const preset of rulePresets(true).filter(preset => preset.starter)) {
    const rule = preset.build(companyId, 'emp-ap');
    const judgments: Record<string, Record<string, Outcome>> = Object.fromEntries(data.rows.map(row => [row.id, {}]));
    for (const condition of leaves(rule.expression)) {
      if (condition.type !== 'ai') throw new Error('Smoke check expects English conditions.');
      const batches = Array.from({ length: Math.ceil(data.rows.length / 20) }, (_, index) => data.rows.slice(index * 20, index * 20 + 20));
      for (let index = 0; index < batches.length; index += 3) {
        await Promise.all(batches.slice(index, index + 3).map(async batch => {
          const reply = await json('/api/evaluate', { companyId, criterion: condition.text, ids: batch.map(row => row.id) });
          cost += BigInt(reply.costNanoUsd);
          for (const result of reply.results) judgments[result.id][condition.id] = ({ match: 'true', no_match: 'false', uncertain: 'uncertain' } as Record<string, Outcome>)[result.state];
        }));
      }
    }
    const outcomes = Object.fromEntries(data.rows.map(row => [row.id, evaluateTree(rule.expression, judgments[row.id])]));
    const counts = { match: 0, uncertain: 0, noMatch: 0 };
    for (const value of Object.values(outcomes)) {
      if (value === 'true') counts.match++;
      else if (value === 'uncertain') counts.uncertain++;
      else if (value === 'false') counts.noMatch++;
      else throw new Error(`Incomplete result: ${companyId}/${preset.id}`);
    }
    const recommended = demo.presetId === preset.id ? outcomes[`${companyId}:${demo.rowId}`] : undefined;
    const entry = { companyId, company: data.company.name, preset: preset.id, loaded: data.rows.length, counts, recommended, outcomes };
    report.push(entry);
    console.log(JSON.stringify({ ...entry, outcomes: undefined }));
    if (!counts.match) failures.push(`No demo matches for ${companyId}/${preset.id}`);
    if (recommended === undefined && demo.presetId === preset.id) failures.push(`Recommended record is outside the demo sample: ${companyId}/${demo.rowId}`);
    if (recommended !== undefined && !actionsForOutcome(rule, recommended).length) failures.push(`Recommended record has no review action: ${companyId}/${demo.rowId}`);
  }
}
fs.mkdirSync('artifacts', { recursive: true });
fs.writeFileSync('artifacts/rule-starters-live.json', JSON.stringify({ url, checkedAt: new Date().toISOString(), costNanoUsd: String(cost), report, failures }, null, 2));
console.log(`Live checks complete; costNanoUsd=${cost}. Results: artifacts/rule-starters-live.json`);
if (failures.length) throw new Error(failures.join('\n'));
