import type { CompanyBills, RecordResult, Row } from './types';
import type { Outcome } from './rules';

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
    const res = await fetch('/api/evaluate', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ companyId, criterion, ids }), signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(60000)]) : AbortSignal.timeout(60000) });
    const body = await res.json();
    if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
    if (!Array.isArray(body.results) || ids.some(id => !body.results.some((r: RecordResult) => r.id === id && ['match', 'no_match', 'uncertain'].includes(r.state)))) throw new Error('Jev returned an incomplete result. Retry the failed condition.');
    return body as { results: RecordResult[]; costNanoUsd: string };
  });
}
export const CACHE_VERSION = 'typesafe-ai/jev:visible-context-v1:choice-v1';
export const judgmentKey = (row: Row, text: string) => JSON.stringify([CACHE_VERSION, row.companyId, row.id, row.date, row.vendor, row.account, row.memo, row.amountCents, row.description, row.itemNames, text]);
const judgments = new Map<string, Promise<Outcome>>();
export function evaluateCondition(data: Pick<CompanyBills, 'company' | 'rows'>, text: string, onResult: (row: Row, outcome: Outcome, error?: string) => void): Promise<void> {
  const missing = data.rows.filter(row => !judgments.has(judgmentKey(row, text)));
  for (let i = 0; i < missing.length; i += 20) {
    const batch = missing.slice(i, i + 20);
    const request = requestEvaluation(data.company.companyId, text, batch.map(r => r.id));
    for (const row of batch) {
      const key = judgmentKey(row, text);
      const promise = request.then(({ results }) => {
        const result = results.find(r => r.id === row.id)!;
        return ({ match: 'true', no_match: 'false', uncertain: 'uncertain' } as const)[result.state];
      }).catch((error: Error) => { judgments.delete(key); throw error; });
      judgments.set(key, promise);
    }
  }
  return Promise.all(data.rows.map(async row => {
    try { onResult(row, await judgments.get(judgmentKey(row, text))!); }
    catch (error) { onResult(row, 'error', (error as Error).message); }
  })).then(() => {});
}
