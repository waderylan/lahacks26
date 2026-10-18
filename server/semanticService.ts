import { POLICY, decisionMessages } from './modelContract.ts';
import type { Observation } from './modelFeedback.ts';
import crypto from 'node:crypto';
import { visibleInput, evaluateSelected, evaluationRuntime } from './evaluator.ts';
import type { EvaluationContext, Provider } from '../src/modelContext.ts';
import { evaluateBatch, type RecordResult } from './jev.ts';
import type { Row } from '../src/types.ts';
import type { WorkspaceData } from './workspaceData.ts';
import { evaluationEvidence } from '../src/jevEvidence.ts';

export class SemanticService {
  private cache = new Map<string, RecordResult>();
  private active = 0;
  private waiting: (() => void)[] = [];
  constructor(private data: WorkspaceData, private evaluate = evaluateBatch, private evaluateProvider = evaluateSelected) {}
  private key(companyId: string, criterion: string, row: Row, context: EvaluationContext) {
    // Match the business evidence sent to Jev. Task/owner changes do not consume
    // another model call, while edits to category or memo invalidate the result.
    return crypto.createHash('sha256').update(JSON.stringify([context.identity, companyId, criterion, row.id, evaluationEvidence(row)])).digest('hex');
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
  async evaluateRows(companyId: string, criterion: string, rows: Row[], signal?: AbortSignal, provider: Provider = 'jev', expected?: EvaluationContext): Promise<{ results: RecordResult[]; costNanoUsd: string; evaluation: EvaluationContext }> {
    const runtime = evaluationRuntime(provider), context = runtime.context;
    if (expected && expected.identity !== context.identity) throw new Error('Model configuration changed. Save the rule again before running.');
    const company = this.data.bills(companyId).company;
    // This call's answers are kept locally: the shared cache can evict entries while batches are awaited.
    const found = new Map<string, RecordResult>();
    for (const row of rows) {
      const key = this.key(companyId, criterion, row, context);
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
      const request = { company: { name: company.name, industry: company.industry }, criterion, ids: batch.map(row => row.id) };
      const response = provider === 'jev' ? await this.evaluate(request, batchSignal, batch) : await this.evaluateProvider(provider, request, batchSignal, batch, runtime);
      cost += BigInt(response.costNanoUsd);
      for (const row of batch) {
        const answer = response.results.find(result => result.id === row.id);
        if (!answer || !['match', 'no_match', 'uncertain'].includes(answer.state) || (answer.pMatch !== null && (!Number.isFinite(answer.pMatch) || answer.pMatch < 0 || answer.pMatch > 1))) throw new Error('Incomplete model result. Retry the search.');
        const result = { ...answer, ...(provider === 'jev' && { scoreKind: 'jev_probability' as const }), evaluation: context };
        const key = this.key(companyId, criterion, row, context);
        this.data.store.put('semantic-judgment', key, companyId, { ...result, checkedAt: new Date().toISOString() });
        this.cache.set(key, result); found.set(row.id, result);
      }
      while (this.cache.size > 10_000) this.cache.delete(this.cache.keys().next().value!);
    })));
    if(provider==='qwen')for(const row of rows){
      const result=found.get(row.id)!;
      const input=visibleInput({name:company.name,industry:company.industry},criterion,row);
      const id=crypto.createHash('sha256').update(JSON.stringify([this.key(companyId,criterion,row,context),result.state])).digest('hex');
      if(!this.data.store.get('model-observation',id)){
        const observation:Observation={id,companyId,rowId:row.id,vendor:row.vendor,criterion,deploymentId:runtime.qwen?.deploymentId??'',input,messages:decisionMessages(input),result:result.state,createdAt:new Date().toISOString()};
        this.data.store.put('model-observation',id,companyId,observation);
      }
    }
    return { results: rows.map(row => found.get(row.id)!), costNanoUsd: String(cost), evaluation: context };
  }
  async judge(companyId: string, criterion: string, rows: Row[], provider: Provider = 'jev', context?: EvaluationContext) {
    const { results } = await this.evaluateRows(companyId, criterion, rows, undefined, provider, context);
    return Object.fromEntries(results.map(result => [result.id, result.state]));
  }
}
