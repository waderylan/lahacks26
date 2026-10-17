import express from 'express';
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
    res.json(loadCompanyBillsLimited(req.params.id, Number(req.query.limit) || undefined));
  } catch (e) {
    res.status(404).json({ error: (e as Error).message });
  }
});

app.post('/api/evaluate', async (req, res) => {
  const { companyId, criterion, ids } = req.body ?? {};
  if (typeof criterion !== 'string' || !criterion.trim() || !Array.isArray(ids) || ids.length > 25) {
    return res.status(400).json({ error: 'invalid request' });
  }
  if (!jevConfigured()) return res.status(503).json({ error: 'Jev is not configured (AI_GATEWAY_API_KEY missing)' });
  const ac = new AbortController();
  res.on('close', () => !res.writableEnded && ac.abort());
  try {
    const { company } = loadCompanyBills(String(companyId));
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

const vite = await createVite({ server: { middlewareMode: true }, appType: 'spa' });
app.use(vite.middlewares);

const port = Number(process.env.PORT ?? 5173);
app.listen(port, () => console.log(`Transaction Review: http://localhost:${port}`));
