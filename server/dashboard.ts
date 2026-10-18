import type { Express } from 'express';
import { STARTER_CHARTS, validateCharts, type ChartSpec } from '../src/charts.ts';
import type { WorkspaceData } from './workspaceData.ts';
import type { ActionStore } from './actionStore.ts';

export class DashboardStore {
  constructor(readonly db: ActionStore, readonly data: WorkspaceData) {}
  read(companyId: string): { charts: ChartSpec[]; revision: number } {
    this.data.bills(companyId);
    const saved = this.db.get<{ charts: ChartSpec[]; revision?: number }>('dashboard-charts', companyId);
    return { charts: saved?.charts ?? structuredClone(STARTER_CHARTS), revision: saved?.revision ?? 0 };
  }
  save(companyId: string, value: unknown, expectedRevision: unknown) {
    const rows = this.data.availableRows(companyId);
    const charts = validateCharts(value, companyId, new Set(rows.map(row => row.id)));
    return this.db.atomic(() => {
      const current = this.read(companyId);
      if (!Number.isSafeInteger(expectedRevision) || current.revision !== expectedRevision) throw new DashboardConflict();
      const next = { charts, revision: current.revision + 1 };
      this.db.put('dashboard-charts', companyId, companyId, next); return next;
    });
  }
}
class DashboardConflict extends Error { constructor() { super('Charts changed in another session. Latest charts loaded; retry your edit.'); } }
export function dashboardRoutes(app: Express, service: DashboardStore) {
  app.get('/api/companies/:id/dashboard', (req, res) => {
    try { res.json(service.read(String(req.params.id))); }
    catch (error) { res.status(400).json({ error: (error as Error).message }); }
  });
  app.put('/api/companies/:id/dashboard', (req, res) => {
    try { res.json(service.save(String(req.params.id), req.body?.charts, req.body?.expectedRevision)); }
    catch (error) { res.status(error instanceof DashboardConflict ? 409 : 400).json({ error: (error as Error).message }); }
  });
}
