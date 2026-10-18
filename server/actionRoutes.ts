import type { Express, Request, Response, NextFunction } from 'express';
import type { ActionEngine } from './actionEngine.ts';

export function sameOriginApi(req: Request, res: Response, next: NextFunction) {
  if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && req.get('origin')) {
    try { if (new URL(req.get('origin')!).host !== req.get('host')) { res.status(403).json({ error: 'Cross-origin changes are not allowed.' }); return; } }
    catch { res.status(403).json({ error: 'Invalid request origin.' }); return; }
  }
  next();
}

export function actionRoutes(app: Express, engine: ActionEngine) {
  const company = (req: Request) => String(req.params.id);
  const reply = (req: Request, plan: ReturnType<ActionEngine['apply']>) => ({ plan, state: engine.store.state(company(req)), rows: plan.items.map(item => engine.store.row(company(req), item.billId)).filter(Boolean) });
  const route = (fn: (req: Request, res: Response) => unknown) => async (req: Request, res: Response, next: NextFunction) => {
    try { await fn(req, res); } catch (error) { next(error); }
  };
  app.use('/api', sameOriginApi);
  app.get('/api/companies/:id/workspace', route((req, res) => {
    const data = engine.data.bills(company(req));
    const rows = data.rows.map(({ id, companyId, account, memo, dashboard, sourceVersion, workspaceChanges, evidence }) => ({ id, companyId, account, memo, dashboard, sourceVersion, workspaceChanges, evidence }));
    const state = engine.store.state(company(req));
    const owners = [...new Set([...data.rows.map(row => row.dashboard?.owner ?? ''), ...state.tasks.map(task => task.owner)])].filter(Boolean).sort();
    res.json({ ...state, accounts: engine.data.accounts(company(req)), rows, owners });
  }));
  app.get('/api/companies/:id/bills/:billId', route((req, res) => res.json(engine.data.row(company(req), String(req.params.billId)))));
  app.post('/api/companies/:id/actions/preview', route(async (req, res) => res.json(await engine.preview(company(req), req.body.selection, req.body.action))));
  app.post('/api/companies/:id/actions/review', route(async (req, res) => {
    if (typeof req.body.reviewed !== 'boolean') throw new Error('Choose a valid review status.');
    const plan = await engine.preview(company(req), { ids: req.body.ids, scope: 'selected' }, { type: 'review', reviewed: req.body.reviewed });
    res.json(reply(req, engine.apply(company(req), plan.id)));
  }));
  app.post('/api/companies/:id/actions/:planId/apply', route((req, res) => res.json(reply(req, engine.apply(company(req), String(req.params.planId))))));
  app.post('/api/companies/:id/actions/:planId/undo', route((req, res) => res.json(reply(req, engine.undo(company(req), String(req.params.planId), req.body.billId)))));
  app.patch('/api/companies/:id/tasks/:taskId', route((req, res) => res.json(engine.updateTask(company(req), String(req.params.taskId), req.body.status, req.body.updatedAt))));
  app.post('/api/companies/:id/automations', route(async (req, res) => res.json(await engine.automate(company(req), req.body.selection, req.body.action))));
  app.post('/api/companies/:id/automations/:automationId/pause', route((req, res) => { engine.pauseAutomation(company(req), String(req.params.automationId)); res.json({ ok: true }); }));
  app.use('/api', (error: unknown, _req: Request, res: Response, _next: NextFunction) => {
    console.error('Workspace request:', error instanceof Error ? error.message : 'Unknown error');
    res.status(400).json({ error: error instanceof Error ? error.message : 'The workspace action failed. Try again.' });
  });
}
