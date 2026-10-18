import crypto from 'node:crypto';
import type { Express, Request, Response } from 'express';
import { evaluationEvidence, formatCents } from '../src/jevEvidence.ts';
import { employeeById } from '../src/employees.ts';
import { CHECKS, type CheckKind, type CheckResult, type CheckState, type CheckVerdict } from '../src/reviewChecks.ts';
import type { Row } from '../src/types.ts';
import { emptyDashboard, type ActionStore } from './actionStore.ts';
import { jevConfigured } from './jev.ts';
import { postMail } from './mailbox.ts';
import type { WorkspaceData } from './workspaceData.ts';

export interface Judgment { id: string; verdict: CheckVerdict; probability: number; pFlag: number; original?: CheckResult['original'] }
export type Company = { name: string; industry: string };
/** What makes one review check different from another; the engine does caching, batching, storage and escalation. */
export interface CheckDefinition {
  kind: CheckKind;
  /** One Jev call for a batch. `all` is every transaction in the company, for checks that compare across transactions. */
  assess: (company: Company, rows: Row[], all: Row[], signal?: AbortSignal) => Promise<Judgment[]>;
  signals: (row: Row, judgment: Judgment, all: Row[]) => string[];
  /** Extra input the verdict depends on beyond the row's own evidence, so a result is re-checked when it changes. */
  context?: (row: Row, all: Row[]) => unknown;
  escalation: { subject: (count: number) => string; ask: string; line: (row: Row, result: CheckResult) => string };
}
type Stored = CheckState & { versions: Record<string, string> };
/** SQLite document kind holding each check's per-company state. */
export const CHECK_DOCS: Record<CheckKind, string> = { 'payment-risk': 'payment-risk', duplicates: 'duplicate-check' };

/** Demo reset: the escalation mail and flags are gone, so forget every check's escalations too (Jev's results stay cached). */
export function forgetEscalations(db: ActionStore, companyId: string) {
  for (const doc of Object.values(CHECK_DOCS)) {
    const saved = db.get<Stored>(doc, companyId);
    if (saved && Object.keys(saved.escalated ?? {}).length) db.put(doc, companyId, companyId, { ...saved, escalated: {} });
  }
}

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

  /** Flags each flagged transaction and sends `to` one summary from `as`. Already-escalated rows are skipped. */
  escalate(companyId: string, as: string, ids: string[], to: string = CHECKS[this.def.kind].escalateTo): CheckState {
    if (!employeeById(as)) throw new Error('Choose which employee is escalating.');
    if (!employeeById(to)) throw new Error('Choose who to send this to.');
    const info = CHECKS[this.def.kind];
    return this.db.atomic(() => {
      const saved = this.read(companyId);
      const rows = [...new Set(ids)].filter(id => saved.results[id]?.verdict === 'flag' && !saved.escalated[id])
        .sort((a, b) => saved.results[b].pFlag - saved.results[a].pFlag).map(id => this.data.row(companyId, id));
      if (!rows.length) throw new Error('Nothing new to escalate. Run the check, or these were already sent.');
      const at = new Date().toISOString();
      for (const row of rows) {
        const dashboard = { ...emptyDashboard(), ...row.dashboard };
        if (!dashboard.flags.includes(info.flag)) this.db.write({ ...row, dashboard: { ...dashboard, flags: [...dashboard.flags, info.flag] } }, row.sourceVersion!);
        saved.escalated[row.id] = { at, by: as, to };
      }
      const { escalation } = this.def, n = rows.length;
      postMail(this.db, {
        companyId, from: as, to, source: 'risk',
        subject: escalation.subject(n),
        body: `Hi ${employeeById(to)!.name.split(' ')[0]},\n\nJev's ${info.title.toLowerCase()} check flagged ${n === 1 ? 'this transaction' : `these ${n} transactions`}. ${escalation.ask}\n\n${rows.map(row => escalation.line(row, saved.results[row.id])).join('\n')}\n\nThese are automated warning signs, not a finding of fraud.\n\n${employeeById(as)!.name}`,
        items: rows.map(row => ({ transactionId: row.id, billId: row.billId })),
      });
      this.db.put(CHECK_DOCS[this.def.kind], companyId, companyId, saved);
      return { results: saved.results, escalated: saved.escalated };
    });
  }

}

/** Shared by every check's escalation message. */
export const escalationLine = (row: Row, result: CheckResult, finding: string) =>
  `- ${row.docNumber || row.billId} · ${row.vendor} · $${formatCents(row.amountCents)} · ${row.date} · Jev ${Math.round(result.pFlag * 100)}% ${finding}${result.signals.length ? ` · ${result.signals.join('; ')}` : ''}`;

export function reviewCheckRoutes(app: Express, checks: Record<CheckKind, ReviewCheck>) {
  const fail = (res: Response, error: unknown, status = 400) => res.status(status).json({ error: error instanceof Error ? error.message : 'Check failed.' });
  const check = (req: Request) => { const found = checks[String(req.params.kind) as CheckKind]; if (!found) throw new Error('Unknown check.'); return found; };
  app.get('/api/companies/:id/checks/:kind', (req: Request, res: Response) => { try { res.json(check(req).state(String(req.params.id))); } catch (error) { fail(res, error); } });
  app.post('/api/companies/:id/checks/:kind/run', async (req: Request, res: Response) => {
    if (!jevConfigured()) return res.status(503).json({ error: 'Jev is not configured (AI_GATEWAY_API_KEY missing)' });
    const ac = new AbortController(); res.on('close', () => !res.writableEnded && ac.abort());
    try { res.json(await check(req).check(String(req.params.id), req.body?.all === true ? 'all' : req.body?.ids, ac.signal)); }
    catch (error) { if (ac.signal.aborted) return; console.error('review check failed:', (error as Error).message); fail(res, error, /Choose|not found|Cross-company|Unknown check/.test((error as Error).message) ? 400 : 502); }
  });
  app.post('/api/companies/:id/checks/:kind/escalate', (req: Request, res: Response) => {
    try { res.json(check(req).escalate(String(req.params.id), String(req.body?.as ?? ''), Array.isArray(req.body?.ids) ? req.body.ids : [], req.body?.to === undefined ? undefined : String(req.body.to))); } catch (error) { fail(res, error); }
  });
}
