// Scores the payment-risk check against the synthetic labels. Evaluation only: labels are read here and never sent to Jev.
// Usage: npx tsx --env-file=.env scripts/eval_payment_risk.ts [--others N]
import fs from 'node:fs';
import { loadCompanyBills } from '../server/data.ts';
import { assessPayments } from '../server/paymentRisk.ts';
import { paymentSignals, type RiskVerdict } from '../src/paymentRisk.ts';
import type { Row } from '../src/types.ts';

const others = Number(process.argv[process.argv.indexOf('--others') + 1]) || 10;
const { cases } = JSON.parse(fs.readFileSync('synthetic/eval/case_manifest.json', 'utf8')) as { cases: { company_id: string; transaction_id: string; family: string; variant: string; label: string; related_transaction_ids: string[] }[] };
const expected: Record<string, RiskVerdict> = { suspected_fraud: 'suspicious', legitimate: 'safe', uncertain: 'cannot_tell' };
const involved = new Set(cases.flatMap(c => [c.transaction_id, ...c.related_transaction_ids]));
const picks: { row: Row; expect: RiskVerdict; tag: string }[] = [];
for (const companyId of ['company-101', 'company-102', 'company-103', 'company-104']) {
  const { rows } = loadCompanyBills(companyId);
  for (const c of cases.filter(c => c.company_id === companyId && c.family.startsWith('F'))) picks.push({ row: rows.find(r => r.id === c.transaction_id)!, expect: expected[c.label], tag: c.variant });
  const plain = rows.filter(r => !involved.has(r.id));
  for (let i = 0; i < others; i++) picks.push({ row: plain[Math.floor(i * plain.length / others)], expect: 'safe', tag: 'no-case' });
}
const company = (row: Row) => { const c = loadCompanyBills(row.companyId).company; return { name: c.name, industry: c.industry }; };
const results = new Map<string, { verdict: RiskVerdict; pSuspicious: number }>();
const groups = Map.groupBy(picks, p => p.row.companyId);
const started = Date.now();
await Promise.all([...groups.values()].flatMap(group => Array.from({ length: Math.ceil(group.length / 20) }, (_, i) => group.slice(i * 20, i * 20 + 20)))
  .map(async batch => { for (const r of await assessPayments(company(batch[0].row), batch.map(p => p.row))) results.set(r.id, r); }));
const verdicts: RiskVerdict[] = ['suspicious', 'cannot_tell', 'safe'];
const matrix = Object.fromEntries(verdicts.map(e => [e, Object.fromEntries(verdicts.map(g => [g, 0]))]));
const misses: string[] = [];
for (const p of picks) {
  const got = results.get(p.row.id)!;
  matrix[p.expect][got.verdict]++;
  if (got.verdict !== p.expect) misses.push(`${p.row.id} [${p.tag}] expected ${p.expect}, got ${got.verdict} (${Math.round(got.pSuspicious * 100)}% suspicious) · ${paymentSignals(p.row).join('; ') || 'no signals'}`);
}
const correct = picks.filter(p => results.get(p.row.id)!.verdict === p.expect).length;
console.log(`${picks.length} transactions in ${((Date.now() - started) / 1000).toFixed(1)}s · accuracy ${correct}/${picks.length}`);
console.log('expected \\ got   ' + verdicts.map(v => v.padEnd(12)).join(''));
for (const e of verdicts) console.log(e.padEnd(16) + verdicts.map(g => String(matrix[e][g]).padEnd(12)).join(''));
const flagged = picks.filter(p => results.get(p.row.id)!.verdict === 'suspicious');
console.log(`suspicious precision ${flagged.filter(p => p.expect === 'suspicious').length}/${flagged.length} · recall ${matrix.suspicious.suspicious}/${picks.filter(p => p.expect === 'suspicious').length}`);
console.log('\nMisses:\n' + misses.join('\n'));
