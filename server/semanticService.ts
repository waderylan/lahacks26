import crypto from 'node:crypto';
import type { RecordResult } from './jev.ts';
import { evaluateSelected, type Provider } from './evaluator.ts';
import type { Row } from '../src/types.ts';
import type { WorkspaceData } from './workspaceData.ts';

export class SemanticService {
  private cache = new Map<string, RecordResult>();
  private active = 0;
  private waiting: (() => void)[] = [];
  constructor(private data: WorkspaceData, private evaluate = (req: Parameters<typeof evaluateSelected>[1], signal?: AbortSignal, rows?: Row[]) => evaluateSelected('jev', req, signal, rows)) {}
  private key(companyId: string, criterion: string, row: Row, provider: Provider = 'jev') {
    // Match the business evidence sent to Jev. Task/owner changes do not consume
    // another model call, while edits to category or memo invalidate the result.
    return crypto.createHash('sha256').update(JSON.stringify([provider, companyId, criterion, row.id, row.date, row.vendor, row.account, row.amountCents, row.expenseKind, row.itemNames, row.description, row.memo, row.docNumber, row.evidence ?? null, row.related ?? null, row.vendorRecord?.payee_account_ending ?? null, row.projectRecord?.status ?? null])).digest('hex');
  }
  private async bounded<T>(work: () => Promise<T>): Promise<T> {
    if (this.active >= 3) await new Promise<void>(resolve => this.waiting.push(resolve));
    else this.active++;
    try { return await work(); }
    finally { const next = this.waiting.shift(); if (next) next(); else this.active--; }
  }
  async evaluateRows(companyId: string, criterion: string, rows: Row[], signal?: AbortSignal, provider: Provider = 'jev'): Promise<{ results: RecordResult[]; costNanoUsd: string }> {
    const company = this.data.bills(companyId).company;
    const missing = rows.filter(row => !this.cache.has(this.key(companyId, criterion, row, provider)));
    let cost = 0n;
    const batches = Array.from({ length: Math.ceil(missing.length / 20) }, (_, index) => missing.slice(index * 20, index * 20 + 20));
    await Promise.all(batches.map(batch => this.bounded(async () => {
      signal?.throwIfAborted();
      const evaluate = provider === 'jev' ? this.evaluate : (req: Parameters<typeof evaluateSelected>[1], signal?: AbortSignal, rows?: Row[]) => evaluateSelected(provider, req, signal, rows);
      const response = await evaluate({ company: { name: company.name.replace(/ \u2014 review scenarios$/, ''), industry: company.industry }, criterion, ids: batch.map(row => row.id) }, signal, batch);
      cost += BigInt(response.costNanoUsd);
      for (const row of batch) {
        const result = response.results.find(result => result.id === row.id);
        if (!result || !['match', 'no_match', 'uncertain'].includes(result.state)) throw new Error('Incomplete model result. Retry the search.');
        this.cache.set(this.key(companyId, criterion, row, provider), result);
      }
      while (this.cache.size > 10_000) this.cache.delete(this.cache.keys().next().value!);
    })));
    return { results: rows.map(row => this.cache.get(this.key(companyId, criterion, row, provider))!), costNanoUsd: String(cost) };
  }
  async judge(companyId: string, criterion: string, rows: Row[], provider: Provider = 'jev') {
    const { results } = await this.evaluateRows(companyId, criterion, rows, undefined, provider);
    return Object.fromEntries(results.map(result => [result.id, result.state]));
  }
}
