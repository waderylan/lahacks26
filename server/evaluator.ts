import { evaluateBatch, jevConfigured, JEV_MODEL, type EvalRequest } from './jev.ts';
import { evaluateQwen, qwenConfigured, qwenDeploymentId, qwenRuntime } from './qwen.ts';
import type { Row } from '../src/types.ts';
import { evaluationEvidence } from '../src/jevEvidence.ts';
import { getRow } from './data.ts';
import { POLICY, type DecisionInput } from './modelContract.ts';
import { createHash } from 'node:crypto';
import { runtimeModelConfig } from './modelConfig.ts';
import type { EvaluationContext, Provider } from '../src/modelContext.ts';
export type { Provider } from '../src/modelContext.ts';
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
export function evaluationRuntime(provider: Provider) {
  const qwen = provider === 'qwen' ? qwenRuntime() : undefined;
  const model = provider === 'qwen' ? (process.env.VERI_MODEL_NAME ?? runtimeModelConfig().name ?? 'Qwen') + ':' + (qwen?.deploymentId ?? 'not-deployed') : JEV_MODEL;
  const policyVersion = provider === 'qwen' ? hash(POLICY) : 'visible-context-v2:choice-v1';
  const scoreVersion = provider === 'qwen' ? hash([process.env.QWEN_RAW_SCORES === '1', qwen?.calibration ?? null]) : 'jev-probability-v1';
  const context: EvaluationContext = { provider, model, policyVersion, scoreVersion, identity: hash([provider, model, policyVersion, scoreVersion]) };
  return { context, qwen };
}
export const evaluationContext = (provider: Provider) => evaluationRuntime(provider).context;
export function providerStatus(provider: Provider) {
  return provider === 'qwen'
    ? { configured: qwenConfigured(), model: evaluationContext(provider).model, via: 'Veri', provider, scores: 'Candidate scores; optional calibration on held-out synthetic validation data, not Jev probabilities', billing: 'GPU time; per-request dollar cost unavailable', context: evaluationContext(provider) }
    : { configured: jevConfigured(), model: JEV_MODEL, via: 'Vercel AI Gateway', provider, scores: 'Jev probabilities', billing: 'Gateway request cost', context: evaluationContext(provider) };
}
export function visibleInput(company: DecisionInput['company'], criterion: string, row: NonNullable<ReturnType<typeof getRow>>): DecisionInput {
  return { company, criterion, transaction: evaluationEvidence(row) };
}
export async function evaluateSelected(provider: Provider, req: EvalRequest, signal?: AbortSignal, visibleRows?: Row[], runtime = evaluationRuntime(provider)) {
  if (provider === 'jev') return { ...await evaluateBatch(req, signal, visibleRows), costKind: 'request' as const };
  const rows = req.ids.map(id => visibleRows?.find(row => row.id === id) ?? getRow(id));
  if (rows.some(row => !row)) throw new Error('Unknown transaction');
  const results: { id: string; state: 'match'|'no_match'|'uncertain'; pMatch: number|null; scoreKind?: 'candidate_score_uncalibrated'|'jev_probability'|'validation_calibrated' }[] = new Array(rows.length);
  let next = 0;
  // The app already runs up to three batches. Keep per-batch GPU concurrency bounded.
  await Promise.all(Array.from({ length: Math.min(3, rows.length) }, async () => {
    while (next < rows.length) {
      signal?.throwIfAborted(); const i = next++; const row = rows[i]!;
      results[i] = { id: row.id, ...await evaluateQwen(visibleInput(req.company, req.criterion, row), signal, runtime.qwen) };
    }
  }));
  return { results, costNanoUsd: '0', costKind: 'gpu_time_unavailable' as const };
}
