import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import type { ActionPlan, ActionState, ReviewTask } from '../src/actionTypes.ts';
import type { Row } from '../src/types.ts';
import { EMPTY_STORE, type RuleStore } from '../src/rules.ts';

export const emptyDashboard = (): NonNullable<Row['dashboard']> => ({ owner: '', flags: [], tags: [], reviewed: false, automatedCheck: false, taskIds: [] });
export class ActionStore {
  readonly db: DatabaseSync;
  constructor(filename: string) {
    if (filename !== ':memory:') fs.mkdirSync(path.dirname(filename), { recursive: true });
    this.db = new DatabaseSync(filename);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS bills (company TEXT NOT NULL, id TEXT NOT NULL, original TEXT NOT NULL, body TEXT NOT NULL, revision INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(company,id));
      CREATE TABLE IF NOT EXISTS documents (kind TEXT NOT NULL, id TEXT NOT NULL, company TEXT NOT NULL, body TEXT NOT NULL, PRIMARY KEY(kind,id));
      CREATE INDEX IF NOT EXISTS company_documents ON documents(company,kind);`);
  }
  /**
   * Copy a company's rows into the workspace once. A `version` (a hash of the source files, passed for generated
   * datasets) makes the copy self-healing: when the source changes, that company's cached rows are replaced so a
   * regenerated dataset never shows stale rows. Dashboard state on replaced rows resets.
   */
  seed(company: string, rows: Row[], version?: string) {
    const insert = this.db.prepare('INSERT OR IGNORE INTO bills(company,id,original,body,revision) VALUES(?,?,?,?,?)');
    this.atomic(() => {
      const dataset = this.get<{ version: string; revision?: number }>('dataset', company);
      let revision = 0;
      if (version && dataset?.version !== version) {
        const existing = this.db.prepare('SELECT MAX(revision) AS revision FROM bills WHERE company=?').get(company) as { revision: number | null };
        // A replacement must invalidate editors holding a revision from any earlier dataset, including after an empty replacement.
        revision = Math.max(existing.revision ?? -1, dataset?.revision ?? -1) + 1;
        this.clearCompanyReview(company);
        this.db.prepare('DELETE FROM bills WHERE company=?').run(company);
        this.put('dataset', company, company, { version, revision });
      }
      for (const row of rows) {
        if (row.companyId !== company || !row.id.startsWith(`${company}:`)) throw new Error('Cross-company import refused.');
        insert.run(company, row.id, JSON.stringify(row), JSON.stringify({ ...row, dashboard: emptyDashboard() }), revision);
      }
    });
  }
  /** Called inside the same transaction as row restore/replacement. Definitions and semantic caches survive. */
  private clearCompanyReview(company: string) {
    const saved = this.get<{ companyId: string; store: RuleStore }>('rule-state', company);
    // A whitelist prevents newly added activity documents from surviving a restore by accident.
    this.db.prepare("DELETE FROM documents WHERE company=? AND kind NOT IN ('dataset','semantic-judgment','saved-search','rule-state','deleted-rule')").run(company);
    if (saved) this.put('rule-state', company, company, {
      companyId: company,
      store: { ...structuredClone(EMPTY_STORE), rules: saved.store.rules.map(rule => ({ ...rule, enabled: false, revision: rule.revision + 1 })) },
      watches: {}, log: [],
    });
  }
  restore(company: string) {
    this.atomic(() => {
      this.clearCompanyReview(company);
      // Increment revisions so stale editors and previews cannot overwrite restored evidence.
      for (const row of this.rows(company)) {
        this.write({ ...this.original(company, row.id), dashboard: emptyDashboard() }, row.sourceVersion!);
      }
    });
  }
  row(company: string, id: string): Row | undefined {
    const saved = this.db.prepare('SELECT body,revision FROM bills WHERE company=? AND id=?').get(company, id) as { body: string; revision: number } | undefined;
    return saved ? { ...JSON.parse(saved.body), sourceVersion: String(saved.revision) } : undefined;
  }
  rows(company: string): Row[] {
    const saved = this.db.prepare('SELECT body,revision FROM bills WHERE company=? ORDER BY id').all(company) as { body: string; revision: number }[];
    return saved.map(row => ({ ...JSON.parse(row.body), sourceVersion: String(row.revision) })).sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
  }
  original(company: string, id: string): Row {
    const row = this.db.prepare('SELECT original FROM bills WHERE company=? AND id=?').get(company, id) as { original: string } | undefined;
    if (!row) throw new Error('Bill not found.'); return JSON.parse(row.original);
  }
  write(row: Row, expectedVersion: string): Row {
    const { sourceVersion: _, ...body } = row;
    const result = this.db.prepare('UPDATE bills SET body=?,revision=revision+1 WHERE company=? AND id=? AND revision=?').run(JSON.stringify(body), row.companyId, row.id, Number(expectedVersion));
    if (result.changes !== 1) throw new Error('The bill changed. Preview the latest version before applying.');
    return this.row(row.companyId, row.id)!;
  }
  get<T>(kind: string, id: string): T | undefined {
    const row = this.db.prepare('SELECT body FROM documents WHERE kind=? AND id=?').get(kind, id) as { body: string } | undefined;
    return row ? JSON.parse(row.body) : undefined;
  }
  put(kind: string, id: string, company: string, value: unknown) {
    this.db.prepare('INSERT INTO documents VALUES(?,?,?,?) ON CONFLICT(kind,id) DO UPDATE SET body=excluded.body,company=excluded.company').run(kind, id, company, JSON.stringify(value));
  }
  removeAll(kind: string, company: string) {
    this.db.prepare('DELETE FROM documents WHERE kind=? AND company=?').run(kind, company);
  }
  list<T>(kind: string, company?: string): T[] {
    const rows = (company ? this.db.prepare('SELECT body FROM documents WHERE kind=? AND company=?').all(kind, company) : this.db.prepare('SELECT body FROM documents WHERE kind=?').all(kind)) as { body: string }[];
    return rows.map(row => JSON.parse(row.body));
  }
  atomic<T>(fn: () => T): T {
    this.db.exec('BEGIN IMMEDIATE');
    try { const result = fn(); this.db.exec('COMMIT'); return result; }
    catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  state(company: string): ActionState {
    return {
      tasks: this.list<ReviewTask>('task', company).sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
      runs: this.list<ActionPlan>('plan', company).filter(plan => plan.status !== 'preview').sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
      automations: [], // Compatibility shape; the retired producer/scanner never resumes stored automations.
    };
  }
}
let instance: ActionStore | undefined;
export const actionStore = () => instance ??= new ActionStore(process.env.WORKSPACE_DB || path.resolve('workspace/actions.sqlite'));
