import express from 'express';
import { createServer } from 'node:http';
import { createServer as createVite } from 'vite';
import { listCompanies } from './data.ts';
import { jevConfigured, JEV_MODEL } from './jev.ts';
import { actionStore } from './actionStore.ts';
import { WorkspaceData } from './workspaceData.ts';
import { ActionEngine } from './actionEngine.ts';
import { SemanticService } from './semanticService.ts';
import { actionRoutes } from './actionRoutes.ts';

const app = express();
app.use(express.json({ limit: '1mb' }));
const database = actionStore();
const workspace = new WorkspaceData(database);
const semantics = new SemanticService(workspace);
const actions = new ActionEngine(database, workspace, (companyId, criterion, rows) => semantics.judge(companyId, criterion, rows));

app.get('/api/status', (_req, res) => {
  res.json({ jev: { configured: jevConfigured(), model: JEV_MODEL, via: 'Vercel AI Gateway' } });
});

app.get('/api/companies', (_req, res) => res.json(listCompanies()));

app.post('/api/demo-reset/receipt', (req, res) => {
  const r = req.body;
  if (!/^company-\d{3}$/.test(r?.companyId) || typeof r?.token !== 'string') return res.sendStatus(400);
  console.log('Demo reset receipt:', JSON.stringify({ companyId: r.companyId, token: r.token, actions: r.actions, history: r.history, arrivals: r.arrivals, enabledRules: r.enabledRules, humanReviewed: r.humanReviewed }));
  res.sendStatus(204);
});

app.get('/api/companies/:id/bills', (req, res) => {
  try {
    const full = workspace.bills(req.params.id);
    if (req.query.reserve === '1' && !full.company.scenario) {
      const reservedRows = full.rows.slice(-5);
      const available = full.rows.slice(0, -5);
      const limit = Number(req.query.limit) || available.length;
      const rows = limit < available.length ? Array.from({ length: limit }, (_, i) => available[Math.floor(i * available.length / limit)]) : available;
      return res.json({ ...full, rows, reservedRows, sampled: rows.length < available.length, referenceOptions: { vendors: [...new Set(full.rows.map(r => r.vendor))].sort(), accounts: [...new Set(full.rows.map(r => r.account))].sort() } });
    }
    const limit = Number(req.query.limit) || full.rows.length;
    const rows = limit < full.rows.length ? Array.from({ length: limit }, (_, index) => full.rows[Math.floor(index * full.rows.length / limit)]) : full.rows;
    res.json({ ...full, rows, sampled: rows.length < full.rows.length });
  } catch (e) {
    res.status(404).json({ error: (e as Error).message });
  }
});

app.post('/api/evaluate', async (req, res) => {
  const { companyId, criterion, ids } = req.body ?? {};
  if (typeof criterion !== 'string' || !criterion.trim() || criterion.length > 500 || !Array.isArray(ids) || !ids.length || ids.length > 25 || !ids.every(id => typeof id === 'string' && id.startsWith(`${companyId}:`))) {
    return res.status(400).json({ error: 'invalid request' });
  }
  if (!jevConfigured()) return res.status(503).json({ error: 'Jev is not configured (AI_GATEWAY_API_KEY missing)' });
  const ac = new AbortController();
  res.on('close', () => !res.writableEnded && ac.abort());
  try {
    const { rows } = workspace.bills(String(companyId));
    if (ids.some((id: string) => !rows.some(row => row.id === id))) return res.status(400).json({ error: 'Unknown or cross-company transaction ID' });
    const { results, costNanoUsd } = await semantics.evaluateRows(String(companyId), criterion.slice(0, 500), ids.map((id: string) => rows.find(row => row.id === id)!), ac.signal);
    res.json({ results, costNanoUsd });
  } catch (e) {
    if (ac.signal.aborted) return;
    console.error('evaluate failed:', (e as Error).message);
    res.status(502).json({ error: 'Jev request failed' });
  }
});

actionRoutes(app, actions);
// Enabled dashboard actions keep running while this server is open, even after
// the browser closes. Their baseline prevents implicit historical backfills.
const automationTimer = setInterval(() => { void actions.scan().catch(error => console.error('Automation:', (error as Error).message)); }, 10_000);
automationTimer.unref();

const server = createServer(app);
const vite = await createVite({ server: { middlewareMode: true, hmr: { server } }, appType: 'spa' });
app.use(vite.middlewares);

const port = Number(process.env.PORT ?? 5173);
server.listen(port, () => console.log(`Transaction Review: http://localhost:${port}`));
