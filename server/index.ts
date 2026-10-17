import express from 'express';
import { createServer } from 'node:http';
import { createServer as createVite } from 'vite';
import { listCompanies, loadCompanyBills, loadCompanyBillsLimited } from './data.ts';
import { evaluateBatch, jevConfigured, JEV_MODEL } from './jev.ts';

const app = express();
app.use(express.json({ limit: '1mb' }));

app.get('/api/status', (_req, res) => {
  res.json({ jev: { configured: jevConfigured(), model: JEV_MODEL, via: 'Vercel AI Gateway' } });
});

app.get('/api/companies', (_req, res) => res.json(listCompanies()));

app.get('/api/companies/:id/bills', (req, res) => {
  try {
    const full = loadCompanyBills(req.params.id);
    if (req.query.reserve === '1' && !full.company.scenario) {
      const reservedRows = full.rows.slice(-5);
      const available = full.rows.slice(0, -5);
      const limit = Number(req.query.limit) || available.length;
      const rows = limit < available.length ? Array.from({ length: limit }, (_, i) => available[Math.floor(i * available.length / limit)]) : available;
      return res.json({ ...full, rows, reservedRows, sampled: rows.length < available.length, referenceOptions: { vendors: [...new Set(full.rows.map(r => r.vendor))].sort(), accounts: [...new Set(full.rows.map(r => r.account))].sort() } });
    }
    res.json(loadCompanyBillsLimited(req.params.id, Number(req.query.limit) || undefined));
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
    const { company, rows } = loadCompanyBills(String(companyId));
    if (ids.some((id: string) => !rows.some(row => row.id === id))) return res.status(400).json({ error: 'Unknown or cross-company transaction ID' });
    const { results, costNanoUsd } = await evaluateBatch(
      { company: { name: company.name.replace(/ — review scenarios$/, ''), industry: company.industry }, criterion: criterion.slice(0, 500), ids: ids.map(String) },
      ac.signal,
    );
    res.json({ results, costNanoUsd });
  } catch (e) {
    if (ac.signal.aborted) return;
    console.error('evaluate failed:', (e as Error).message);
    res.status(502).json({ error: 'Jev request failed' });
  }
});

const server = createServer(app);
const vite = await createVite({ server: { middlewareMode: true, hmr: { server } }, appType: 'spa' });
app.use(vite.middlewares);

const port = Number(process.env.PORT ?? 5173);
server.listen(port, () => console.log(`Transaction Review: http://localhost:${port}`));
