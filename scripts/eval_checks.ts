// Scores a Jev review check against the synthetic labels. Evaluation only: labels are read here and never sent to Jev.
// Usage: npx tsx --env-file=.env scripts/eval_checks.ts --check payment-risk|duplicates [--others N]
import fs from 'node:fs';
import { loadCompanyBills } from '../server/data.ts';
import { assessPayments } from '../server/paymentRisk.ts';
import { assessDuplicates } from '../server/duplicates.ts';
import type { Judgment } from '../server/reviewChecks.ts';
import type { CheckVerdict } from '../src/reviewChecks.ts';
import type { Row } from '../src/types.ts';

const arg = (name: string) => process.argv[process.argv.indexOf(name) + 1];
const kind = arg('--check') === 'duplicates' ? 'duplicates' : 'payment-risk';
const others = Number(arg('--others')) || 10;
const family = kind === 'duplicates' ? 'C' : 'F';
type Case = { company_id: string; transaction_id: string; family: string; variant: string; label: string; related_transaction_ids: string[] };
const { cases } = JSON.parse(fs.readFileSync('synthetic/eval/case_manifest.json', 'utf8')) as { cases: Case[] };
const expected: Record<string, CheckVerdict> = { suspected_fraud: 'flag', legitimate: 'clear', uncertain: 'unsure' };
const involved = new Set(cases.flatMap(c => [c.transaction_id, ...c.related_transaction_ids]));

type Pick = { row: Row; expect: CheckVerdict; group: 'case' | 'original' | 'ordinary'; tag: string; originals?: string[] };
const picks = new Map<string, Pick>();
const all = new Map<string, Row[]>();
for (const companyId of ['company-101', 'company-102', 'company-103', 'company-104']) {
  const { rows } = loadCompanyBills(companyId); all.set(companyId, rows);
  const find = (id: string) => rows.find(r => r.id === id)!;
  for (const c of cases.filter(c => c.company_id === companyId && c.family.startsWith(family))) {
    picks.set(c.transaction_id, { row: find(c.transaction_id), expect: expected[c.label], group: 'case', tag: c.variant, originals: c.related_transaction_ids });
    // Duplicates: the earlier, original charge of each pair must come back clear.
    if (kind === 'duplicates') for (const id of c.related_transaction_ids) if (!picks.has(id)) picks.set(id, { row: find(id), expect: 'clear', group: 'original', tag: `${c.variant}:original` });
  }
  const plain = rows.filter(r => !involved.has(r.id));
  for (let i = 0; i < others; i++) { const r = plain[Math.floor(i * plain.length / others)]; picks.set(r.id, { row: r, expect: 'clear', group: 'ordinary', tag: 'no-case' }); }
}
const results = new Map<string, Judgment>();
const started = Date.now();
const byCompany = Map.groupBy([...picks.values()], p => p.row.companyId);
await Promise.all([...byCompany].flatMap(([companyId, group]) => Array.from({ length: Math.ceil(group.length / 20) }, (_, i) => group.slice(i * 20, i * 20 + 20)).map(async batch => {
  const c = loadCompanyBills(companyId).company, company = { name: c.name, industry: c.industry }, rows = batch.map(p => p.row);
  for (const r of kind === 'duplicates' ? await assessDuplicates(company, rows, all.get(companyId)!) : await assessPayments(company, rows)) results.set(r.id, r);
})));
const V: CheckVerdict[] = ['flag', 'unsure', 'clear'];
const table = (title: string, group: Pick['group']) => {
  const list = [...picks.values()].filter(p => p.group === group); if (!list.length) return;
  const m = Object.fromEntries(V.map(e => [e, Object.fromEntries(V.map(g => [g, 0]))]));
  for (const p of list) m[p.expect][results.get(p.row.id)!.verdict]++;
  console.log(`\n${title} (${list.length})\nexpected \\ got   ${V.map(v => v.padEnd(8)).join('')}`);
  for (const e of V) if (V.some(g => m[e][g])) console.log(e.padEnd(16) + V.map(g => String(m[e][g]).padEnd(8)).join(''));
};
console.log(`${kind}: ${picks.size} transactions in ${((Date.now() - started) / 1000).toFixed(1)}s`);
table('Labeled cases', 'case'); table('Originals of each pair (should be clear)', 'original'); table('Ordinary transactions (should be clear)', 'ordinary');
if (kind === 'duplicates') {
  const named = [...picks.values()].filter(p => p.group === 'case' && p.expect === 'flag' && results.get(p.row.id)!.original);
  const right = named.filter(p => p.originals!.includes(`${p.row.companyId}:${results.get(p.row.id)!.original!.billId}`));
  console.log(`\nCorrect original named for ${right.length}/${named.length} flagged fraud duplicates`);
}
console.log('\nMisses:');
for (const p of picks.values()) { const r = results.get(p.row.id)!; if (r.verdict !== p.expect) console.log(`  ${p.row.id} [${p.tag}] expected ${p.expect}, got ${r.verdict} (${Math.round(r.pFlag * 100)}%)`); }
