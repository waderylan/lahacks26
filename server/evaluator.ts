import { evaluateBatch, supportingContext, jevConfigured, JEV_MODEL, type EvalRequest } from './jev.ts';
import { evaluateQwen, qwenConfigured, qwenDeploymentId } from './qwen.ts';
import type { Row } from '../src/types.ts';
import { getRow } from './data.ts';
import { centsText, type DecisionInput } from './modelContract.ts';
export type Provider = 'jev' | 'qwen';
export function providerStatus(provider: Provider) {
  return provider === 'qwen'
    ? { configured: qwenConfigured(), model: `${process.env.VERI_MODEL_NAME ?? 'Qwen3-0.6B'}:${qwenDeploymentId() ?? 'not-deployed'}`, via: 'Veri', provider, scores: 'Candidate scores; optional calibration on held-out synthetic validation data, not Jev probabilities', billing: 'GPU time; per-request dollar cost unavailable' }
    : { configured: jevConfigured(), model: JEV_MODEL, via: 'Vercel AI Gateway', provider, scores: 'Jev probabilities', billing: 'Gateway request cost' };
}
export function visibleInput(company: DecisionInput['company'], criterion: string, row: NonNullable<ReturnType<typeof getRow>>): DecisionInput {
  return { company, criterion, transaction: { date: row.date, vendor: row.vendor, account: row.account, expense_kind: row.expenseKind, amount: centsText(row.amountCents), item_names: row.itemNames, description: row.description, memo: row.memo, ...supportingContext(row) } };
}
export async function evaluateSelected(provider: Provider, req: EvalRequest, signal?: AbortSignal, visibleRows?: Row[]) {
  if (provider === 'jev') return { ...await evaluateBatch(req, signal, visibleRows), costKind: 'request' as const };
  const rows = req.ids.map(id => visibleRows?.find(row => row.id === id) ?? getRow(id));
  if (rows.some(row => !row)) throw new Error('Unknown transaction');
  const results: { id: string; state: 'match'|'no_match'|'uncertain'; pMatch: number|null; scoreKind?: 'candidate_score_uncalibrated'|'jev_probability'|'validation_calibrated' }[] = new Array(rows.length);
  let next = 0;
  // The app already runs up to three batches. Keep per-batch GPU concurrency bounded.
  await Promise.all(Array.from({ length: Math.min(3, rows.length) }, async () => {
    while (next < rows.length) {
      signal?.throwIfAborted(); const i = next++; const row = rows[i]!;
      results[i] = { id: row.id, ...await evaluateQwen(visibleInput(req.company, req.criterion, row), signal) };
    }
  }));
  return { results, costNanoUsd: '0', costKind: 'gpu_time_unavailable' as const };
}
