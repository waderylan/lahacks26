import express from 'express';
import { createServer } from 'node:http';
import { createServer as createVite } from 'vite';
import { listCompanies, loadCompanyBills, loadCompanyBillsLimited } from './data.ts';
import { evaluateBatch, jevConfigured, JEV_MODEL } from './jev.ts';
import { draftMessage, geminiConfigured, GEMINI_MODEL } from './messages.ts';
import { employeeById } from '../src/employees.ts';

const app = express();
app.use(express.json({ limit: '1mb' }));

app.get('/api/status', (_req, res) => {
  res.json({ jev: { configured: jevConfigured(), model: JEV_MODEL, via: 'Vercel AI Gateway' }, gemini: { configured: geminiConfigured(), model: GEMINI_MODEL } });
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

app.post('/api/messages/draft', async (req, res) => {
  const { companyId, request, recipient, items } = req.body ?? {};
  const validItems = Array.isArray(items) && items.length >= 1 && items.length <= 25 && items.every((item: any) =>
    typeof item?.transactionId === 'string' && item.transactionId.startsWith(`${companyId}:`) && Array.isArray(item.context) && item.context.length <= 20
    && item.context.every((c: any) => typeof c?.condition === 'string' && c.condition.length <= 600 && ['ai', 'standard'].includes(c.kind) && ['true', 'false', 'uncertain'].includes(c.result)));
  if (!validItems || typeof request !== 'string' || !request.trim() || request.length > 500 || typeof recipient !== 'string' || (recipient !== 'jev' && !employeeById(recipient))) {
    return res.status(400).json({ error: 'invalid request' });
  }
  if (!geminiConfigured()) return res.status(503).json({ error: 'Gemini is not configured (GEMINI_API_KEY missing)' });
  if (recipient === 'jev' && !jevConfigured()) return res.status(503).json({ error: 'Jev is not configured (AI_GATEWAY_API_KEY missing)' });
  const ac = new AbortController();
  res.on('close', () => !res.writableEnded && ac.abort());
  try {
    const { company, rows } = loadCompanyBills(String(companyId));
    const bills = items.map((item: any) => ({ row: rows.find(r => r.id === item.transactionId)!, context: item.context }));
    if (bills.some((b: { row?: unknown }) => !b.row)) return res.status(400).json({ error: 'Unknown or cross-company transaction ID' });
    const result = await draftMessage({ company: { name: company.name.replace(/ — review scenarios$/, ''), industry: company.industry }, bills, request: request.trim(), recipient }, ac.signal);
    res.json(result);
  } catch (e) {
    if (ac.signal.aborted) return;
    const reason = (e as Error).message;
    console.error('message draft failed:', reason);
    // Rate limits and overload are temporary: 429 tells the client to wait and retry on its own.
    if (/quota|rate.?limit|high demand|overloaded/i.test(reason)) return res.status(429).json({ error: 'Gemini is busy or rate-limited. Retrying shortly.' });
    res.status(502).json({ error: 'Message drafting failed' });
  }
});

const server = createServer(app);
const vite = await createVite({ server: { middlewareMode: true, hmr: { server } }, appType: 'spa' });
app.use(vite.middlewares);

const port = Number(process.env.PORT ?? 5173);
server.listen(port, () => console.log(`Transaction Review: http://localhost:${port}`));
