import crypto from 'node:crypto';
import { evaluateBatch, type RecordResult } from './jev.ts';
import type { Row } from '../src/types.ts';
import type { WorkspaceData } from './workspaceData.ts';
import { evaluationEvidence } from '../src/jevEvidence.ts';

export class SemanticService {
  private cache = new Map<string, RecordResult>();
  private active = 0;
  private waiting: (() => void)[] = [];
  constructor(private data: WorkspaceData, private evaluate = evaluateBatch) {}
  private key(companyId: string, criterion: string, row: Row) {
    // Match the business evidence sent to Jev. Task/owner changes do not consume
    // another model call, while edits to category or memo invalidate the result.
    return crypto.createHash('sha256').update(JSON.stringify(['typesafe-ai/jev:visible-context-v2:choice-v1', companyId, criterion, row.id, evaluationEvidence(row)])).digest('hex');
  }
  private pump() {
    while (this.active < 3 && this.waiting.length) {
      const next = this.waiting.shift()!;
      this.active++;
      next();
    }
  }
  private bounded<T>(work: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      this.waiting.push(() => { void work().then(resolve, reject).finally(() => { this.active--; this.pump(); }); });
      this.pump();
    });
  }
  async evaluateRows(companyId: string, criterion: string, rows: Row[], signal?: AbortSignal): Promise<{ results: RecordResult[]; costNanoUsd: string }> {
    const company = this.data.bills(companyId).company;
    // This call's answers are kept locally: the shared cache can evict entries while batches are awaited.
    const found = new Map<string, RecordResult>();
    for (const row of rows) {
      const key = this.key(companyId, criterion, row);
      const hit = this.cache.get(key) ?? this.data.store.get<RecordResult>('semantic-judgment', key);
      if (hit) { this.cache.set(key, hit); found.set(row.id, hit); }
    }
    const missing = rows.filter(row => !found.has(row.id));
    let cost = 0n;
    const batches = Array.from({ length: Math.ceil(missing.length / 20) }, (_, index) => missing.slice(index * 20, index * 20 + 20));
    await Promise.all(batches.map(batch => this.bounded(async () => {
      signal?.throwIfAborted();
      // Each batch gets its own timeout so one hung gateway call can't hold a slot (or the rule scanner) forever.
      const batchSignal = signal ? AbortSignal.any([signal, AbortSignal.timeout(90_000)]) : AbortSignal.timeout(90_000);
      const response = await this.evaluate({ company: { name: company.name.replace(/ \u2014 review scenarios$/, ''), industry: company.industry }, criterion, ids: batch.map(row => row.id) }, batchSignal, batch);
      cost += BigInt(response.costNanoUsd);
      for (const row of batch) {
        const result = response.results.find(result => result.id === row.id);
        if (!result || !['match', 'no_match', 'uncertain'].includes(result.state)) throw new Error('Incomplete model result. Retry the search.');
        const key = this.key(companyId, criterion, row);
        this.data.store.put('semantic-judgment', key, companyId, { ...result, checkedAt: new Date().toISOString() });
        this.cache.set(key, result); found.set(row.id, result);
      }
      while (this.cache.size > 10_000) this.cache.delete(this.cache.keys().next().value!);
    })));
    return { results: rows.map(row => found.get(row.id)!), costNanoUsd: String(cost) };
  }
  async judge(companyId: string, criterion: string, rows: Row[]) {
    const { results } = await this.evaluateRows(companyId, criterion, rows);
    return Object.fromEntries(results.map(result => [result.id, result.state]));
  }
}
