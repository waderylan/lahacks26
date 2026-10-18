import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { evaluationEvidence } from './jevEvidence';
import type { CompanyBills, RecordResult } from './types';
import { requestEvaluation } from './jevClient';

const BATCH_SIZE = 20;
const CONCURRENCY = 3;

export interface EvalState {
  query: string;
  results: Record<string, RecordResult>;
  pending: Set<string>;
  failed: Set<string>;
  total: number;
  costNanoUsd: bigint;
  startedAt: number | null;
  finishedAt: number | null;
  error: string | null;
}

const IDLE: EvalState = {
  query: '',
  results: {},
  pending: new Set(),
  failed: new Set(),
  total: 0,
  costNanoUsd: 0n,
  startedAt: null,
  finishedAt: null,
  error: null,
};

/**
 * Evaluates `query` against every row (in the given display order) in small batches with
 * bounded concurrency. Any change of query/company aborts in-flight requests and drops
 * their results; a run only writes state while it is still the current one.
 * Runs restart only when the evidence Jev sees changes, not on review/flag/owner updates.
 */
export function useSemanticEval(data: CompanyBills | null, query: string, order: () => string[]) {
  const [state, setState] = useState<EvalState>(IDLE);
  const retryRef = useRef<() => void>(() => {});
  const dataRef = useRef(data); dataRef.current = data;
  const evidenceKey = useMemo(() => data ? JSON.stringify([data.company.companyId, data.rows.map(row => [row.id, evaluationEvidence(row)])]) : '', [data]);

  useEffect(() => {
    const data = dataRef.current;
    const q = query.trim();
    if (!data || !q) {
      setState(IDLE);
      retryRef.current = () => {};
      return;
    }
    let live = true;
    const ac = new AbortController();
    const companyId = data.company.companyId;
    const ids = order();
    let cur: EvalState = { ...IDLE, query: q, pending: new Set(ids), total: ids.length, startedAt: performance.now() };
    setState(cur);

    const commit = (fn: (s: EvalState) => EvalState) => {
      if (!live) return;
      let next = fn(cur);
      if (next.pending.size === 0 && next.finishedAt === null) next = { ...next, finishedAt: performance.now() };
      cur = next;
      setState(next);
    };

    const run = async (queue: string[]) => {
      const batches: string[][] = [];
      for (let i = 0; i < queue.length; i += BATCH_SIZE) batches.push(queue.slice(i, i + BATCH_SIZE));
      const worker = async () => {
        while (live && batches.length) {
          const batch = batches.shift()!;
          try {
            const { results, costNanoUsd } = await requestEvaluation(companyId, q, batch, ac.signal);
            commit((s) => {
              const pending = new Set(s.pending);
              const failed = new Set(s.failed);
              const merged = { ...s.results };
              for (const r of results) {
                merged[r.id] = r;
                pending.delete(r.id);
                failed.delete(r.id);
              }
              return { ...s, results: merged, pending, failed, costNanoUsd: s.costNanoUsd + BigInt(costNanoUsd) };
            });
          } catch (e) {
            if (!live) return;
            commit((s) => {
              const pending = new Set(s.pending);
              const failed = new Set(s.failed);
              for (const id of batch) {
                pending.delete(id);
                failed.add(id);
              }
              return { ...s, pending, failed, error: (e as Error).message };
            });
          }
        }
      };
      await Promise.all(Array.from({ length: CONCURRENCY }, worker));
    };

    retryRef.current = () => {
      if (!live || cur.failed.size === 0) return;
      const failedIds = [...cur.failed];
      commit((s) => ({ ...s, pending: new Set([...s.pending, ...failedIds]), failed: new Set(), finishedAt: null, error: null }));
      void run(failedIds);
    };

    void run(ids);
    return () => {
      live = false;
      ac.abort();
    };
    // `order` is read once per run on purpose: row order must not reshuffle mid-run.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [evidenceKey, query]);

  const retry = useCallback(() => retryRef.current(), []);
  return { evalState: state, retry };
}
