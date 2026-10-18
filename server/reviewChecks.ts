import crypto from 'node:crypto';
import { evaluationEvidence } from '../src/jevEvidence.ts';
import { type CheckKind, type CheckResult, type CheckState, type CheckVerdict } from '../src/reviewChecks.ts';
import type { Row } from '../src/types.ts';
import { type ActionStore } from './actionStore.ts';
import type { WorkspaceData } from './workspaceData.ts';

export interface Judgment { id: string; verdict: CheckVerdict; probability: number; pFlag: number; original?: CheckResult['original'] }
export type Company = { name: string; industry: string };
/** What makes one review check different from another; the engine does caching, batching, storage. */
export interface CheckDefinition {
  kind: CheckKind;
  /** One Jev call for a batch. `all` is every transaction in the company, for checks that compare across transactions. */
  assess: (company: Company, rows: Row[], all: Row[], signal?: AbortSignal) => Promise<Judgment[]>;
  signals: (row: Row, judgment: Judgment, all: Row[]) => string[];
  /** Extra input the verdict depends on beyond the row's own evidence, so a result is re-checked when it changes. */
  context?: (row: Row, all: Row[]) => unknown;
}
type Stored = CheckState & { versions: Record<string, string> };
/** SQLite document kind holding each check's per-company state. */
export const CHECK_DOCS: Record<CheckKind, string> = { 'payment-risk': 'payment-risk', duplicates: 'duplicate-check' };

/** Results stored by the first payment-risk release used its own verdict names. */
function migrate(result: CheckResult & { pSuspicious?: number; verdict: string }): CheckResult {
  if (result.verdict === 'flag' || result.verdict === 'unsure' || result.verdict === 'clear') return result;
  const { pSuspicious, ...rest } = result;
  return { ...rest, verdict: result.verdict === 'suspicious' ? 'flag' : result.verdict === 'cannot_tell' ? 'unsure' : 'clear', pFlag: pSuspicious ?? 0 };
}

/** Company-scoped results of one Jev review check in SQLite, keyed by the evidence Jev saw so unchanged rows are not re-checked. */
export class ReviewCheck {
  private active = 0;
  private waiting: (() => void)[] = [];
  constructor(readonly db: ActionStore, readonly data: WorkspaceData, readonly def: CheckDefinition) {}
  private read(companyId: string): Stored {
    const saved = this.db.get<Stored>(CHECK_DOCS[this.def.kind], companyId) ?? { results: {}, escalated: {}, versions: {} };
    return { ...saved, results: Object.fromEntries(Object.entries(saved.results).map(([id, result]) => [id, migrate(result)])) };
  }
  state(companyId: string): CheckState { this.data.bills(companyId); const { results, escalated } = this.read(companyId); return { results, escalated }; }
  private key(row: Row, all: Row[]) { return crypto.createHash('sha256').update(JSON.stringify([evaluationEvidence(row), this.def.context?.(row, all) ?? null])).digest('hex'); }

  private bounded<T>(work: () => Promise<T>) {
    return new Promise<T>((resolve, reject) => {
      this.waiting.push(() => { void work().then(resolve, reject).finally(() => { this.active--; this.pump(); }); });
      this.pump();
    });
  }
  private pump() { while (this.active < 3 && this.waiting.length) { this.active++; this.waiting.shift()!(); } }

  /** `ids: 'all'` checks every transaction in the company, including ones not loaded in the browser. */
  async check(companyId: string, ids: string[] | 'all', signal?: AbortSignal): Promise<CheckState> {
    const bills = this.data.bills(companyId), all = bills.rows;
    // 'all' may exceed the 1000-id limit for explicit lists; each batch is saved as it finishes, so a long run keeps its progress.
    if (ids === 'all') { ids = all.map(row => row.id); if (!ids.length) throw new Error('This company has no transactions to check.'); }
    else if (!Array.isArray(ids) || !ids.length || ids.length > 1000) throw new Error('Choose 1-1000 transactions to check.');
    const rows = [...new Set(ids)].map(id => this.data.row(companyId, id));
    const known = this.read(companyId);
    const todo = rows.filter(row => known.versions[row.id] !== this.key(row, all));
    const batches = Array.from({ length: Math.ceil(todo.length / 20) }, (_, i) => todo.slice(i * 20, i * 20 + 20));
    await Promise.all(batches.map(batch => this.bounded(async () => {
      signal?.throwIfAborted();
      const answers = await this.def.assess({ name: bills.company.name, industry: bills.company.industry }, batch, all, signal);
      const checkedAt = new Date().toISOString();
      this.db.atomic(() => {
        const saved = this.read(companyId);
        for (const row of batch) {
          const answer = answers.find(a => a.id === row.id);
          if (!answer) throw new Error('Incomplete Jev result. Retry the check.');
          saved.results[row.id] = { ...answer, signals: this.def.signals(row, answer, all), checkedAt,
            summary: { billId: row.billId, docNumber: row.docNumber, vendor: row.vendor, date: row.date, amountCents: row.amountCents, txnType: row.txnType } };
          saved.versions[row.id] = this.key(row, all);
        }
        this.db.put(CHECK_DOCS[this.def.kind], companyId, companyId, saved);
      });
    })));
    return this.state(companyId);
  }

}
