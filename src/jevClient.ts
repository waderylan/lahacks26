import type { EvaluationContext, Provider, ScoreKind } from './modelContext';
import type { CompanyBills, RecordResult, Row } from './types';
import type { Outcome } from './rules';
import { evaluationEvidence } from './jevEvidence';

const revisions: Record<Provider,string> = { jev:'pending-status',qwen:'pending-status' };
export function setModelRevision(version: string, provider: Provider = 'jev') { revisions[provider] = version; }
// Shared by semantic filtering, rule preview, and arrivals: at most three gateway batches.
let active = 0;
let lastGroup = '';
const waiting: { group: string; run: () => void }[] = [];
function pump() {
  while (active < 3 && waiting.length) {
    // Round-robin among criteria so one large condition cannot monopolize the queue.
    const different = waiting.findIndex(job => job.group !== lastGroup);
    const [job] = waiting.splice(different < 0 ? 0 : different, 1);
    lastGroup = job.group; active++; job.run();
  }
}
function bounded<T>(group: string, work: () => Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    waiting.push({ group, run: () => { void work().then(resolve, reject).finally(() => { active--; pump(); }); } });
    // Collect independent criteria before starting this wave of requests.
    queueMicrotask(pump);
  });
}
export async function requestEvaluation(companyId: string, criterion: string, ids: string[], signal?: AbortSignal, context?: EvaluationContext) {
  return bounded(`${companyId}:${criterion}`, async () => {
    signal?.throwIfAborted();
    const res = await fetch('/api/evaluate', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ companyId, criterion, ids, model: context?.provider ?? 'jev', ...(context && { expectedIdentity: context.identity }) }), signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(60000)]) : AbortSignal.timeout(60000) });
    const body = await res.json();
    if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
    if (!Array.isArray(body.results) || ids.some(id => !body.results.some((r: RecordResult) => r.id === id && ['match', 'no_match', 'uncertain'].includes(r.state)))) throw new Error('The selected model returned an incomplete result. Retry the failed condition.');
    return body as { results: RecordResult[]; costNanoUsd: string };
  });
}
export const evaluationIdentity = (context?: EvaluationContext) => context?.identity ?? 'jev:' + revisions.jev;
export const CACHE_VERSION = 'visible-context-v2:choice-v1';
export const judgmentKey = (row: Row, text: string, context?: EvaluationContext) => JSON.stringify([evaluationIdentity(context), CACHE_VERSION, row.companyId, row.id, text, evaluationEvidence(row)]);
const MAX_JUDGMENTS = 10_000;
const judgments = new Map<string, Promise<Outcome>>();
const probabilities = new Map<string, number>();
const scoreKinds = new Map<string, ScoreKind>();
export const scoreKindFor = (row: Row, text: string, context?: EvaluationContext) => scoreKinds.get(judgmentKey(row,text,context));
/** Optional match score for a completed judgment; scoreKindFor describes its meaning. */
export const pMatchFor = (row: Row, text: string, context?: EvaluationContext) => probabilities.get(judgmentKey(row, text, context));
function remember(key: string, promise: Promise<Outcome>) {
  judgments.set(key, promise);
  while (judgments.size > MAX_JUDGMENTS) { const oldest = judgments.keys().next().value!; judgments.delete(oldest); probabilities.delete(oldest); scoreKinds.delete(oldest); }
}
export function evaluateCondition(data: Pick<CompanyBills, 'company' | 'rows'>, text: string, onResult: (row: Row, outcome: Outcome, error?: string) => void, onCost?: (nanoUsd: bigint) => void, context?: EvaluationContext): Promise<void> {
  const missing = data.rows.filter(row => !judgments.has(judgmentKey(row, text, context)));
  for (let i = 0; i < missing.length; i += 20) {
    const batch = missing.slice(i, i + 20);
    const request = requestEvaluation(data.company.companyId, text, batch.map(r => r.id), undefined, context);
    if (onCost) request.then(r => onCost(BigInt(r.costNanoUsd)), () => {});
    for (const row of batch) {
      const key = judgmentKey(row, text, context);
      const promise = request.then(({ results }) => {
        const result = results.find(r => r.id === row.id)!;
        if (result.pMatch !== null) probabilities.set(key, result.pMatch);
        if (result.scoreKind) scoreKinds.set(key,result.scoreKind);
        return ({ match: 'true', no_match: 'false', uncertain: 'uncertain' } as const)[result.state];
      }).catch((error: Error) => { judgments.delete(key); throw error; });
      remember(key, promise);
    }
  }
  return Promise.all(data.rows.map(async row => {
    try { onResult(row, await judgments.get(judgmentKey(row, text, context))!); }
    catch (error) { onResult(row, 'error', (error as Error).message); }
  })).then(() => {});
}
