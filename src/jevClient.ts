import type { CompanyBills, RecordResult, Row } from './types';
import type { Outcome } from './rules';
import { evaluationEvidence } from './jevEvidence';

let modelRevision = 'pending-status';
export function setModelRevision(version: string) { if (version !== modelRevision) { modelRevision = version; judgments.clear(); probabilities.clear(); } }
export const selectedProvider = () => typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('model') === 'qwen' ? 'qwen' : 'jev';

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
export async function requestEvaluation(companyId: string, criterion: string, ids: string[], signal?: AbortSignal) {
  return bounded(`${companyId}:${criterion}`, async () => {
    signal?.throwIfAborted();
    const res = await fetch('/api/evaluate', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ companyId, criterion, ids, model: selectedProvider() }), signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(60000)]) : AbortSignal.timeout(60000) });
    const body = await res.json();
    if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
    if (!Array.isArray(body.results) || ids.some(id => !body.results.some((r: RecordResult) => r.id === id && ['match', 'no_match', 'uncertain'].includes(r.state)))) throw new Error('The selected model returned an incomplete result. Retry the failed condition.');
    return body as { results: RecordResult[]; costNanoUsd: string };
  });
}
export const evaluationIdentity = () => `${selectedProvider()}:${modelRevision}`;
export const CACHE_VERSION = 'visible-context-v2:choice-v1';
export const judgmentKey = (row: Row, text: string) => JSON.stringify([evaluationIdentity(), CACHE_VERSION, row.companyId, row.id, text, evaluationEvidence(row)]);
const MAX_JUDGMENTS = 10_000;
const judgments = new Map<string, Promise<Outcome>>();
const probabilities = new Map<string, number>();
/** Jev's P(match) for a finished judgment; the chat uses it to show near misses when nothing matches. */
export const pMatchFor = (row: Row, text: string) => probabilities.get(judgmentKey(row, text));
function remember(key: string, promise: Promise<Outcome>) {
  judgments.set(key, promise);
  while (judgments.size > MAX_JUDGMENTS) { const oldest = judgments.keys().next().value!; judgments.delete(oldest); probabilities.delete(oldest); }
}
export function evaluateCondition(data: Pick<CompanyBills, 'company' | 'rows'>, text: string, onResult: (row: Row, outcome: Outcome, error?: string) => void, onCost?: (nanoUsd: bigint) => void): Promise<void> {
  const missing = data.rows.filter(row => !judgments.has(judgmentKey(row, text)));
  for (let i = 0; i < missing.length; i += 20) {
    const batch = missing.slice(i, i + 20);
    const request = requestEvaluation(data.company.companyId, text, batch.map(r => r.id));
    if (onCost) request.then(r => onCost(BigInt(r.costNanoUsd)), () => {});
    for (const row of batch) {
      const key = judgmentKey(row, text);
      const promise = request.then(({ results }) => {
        const result = results.find(r => r.id === row.id)!;
        if (result.pMatch !== null) probabilities.set(key, result.pMatch);
        return ({ match: 'true', no_match: 'false', uncertain: 'uncertain' } as const)[result.state];
      }).catch((error: Error) => { judgments.delete(key); throw error; });
      remember(key, promise);
    }
  }
  return Promise.all(data.rows.map(async row => {
    try { onResult(row, await judgments.get(judgmentKey(row, text))!); }
    catch (error) { onResult(row, 'error', (error as Error).message); }
  })).then(() => {});
}
