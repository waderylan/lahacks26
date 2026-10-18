import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import type { ActionPlan, ActionState, ReviewTask, ServerAutomation } from '../src/actionTypes.ts';
import type { Row } from '../src/types.ts';

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
  seed(company: string, rows: Row[]) {
    const insert = this.db.prepare('INSERT OR IGNORE INTO bills(company,id,original,body) VALUES(?,?,?,?)');
    this.atomic(() => { for (const row of rows) {
      if (row.companyId !== company || !row.id.startsWith(`${company}:`)) throw new Error('Cross-company import refused.');
      insert.run(company, row.id, JSON.stringify(row), JSON.stringify({ ...row, dashboard: emptyDashboard() }));
    } });
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
      automations: this.list<ServerAutomation>('automation', company),
    };
  }
}
let instance: ActionStore | undefined;
export const actionStore = () => instance ??= new ActionStore(process.env.WORKSPACE_DB || path.resolve('workspace/actions.sqlite'));
