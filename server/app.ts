import { ChatStore, chatRoutes } from './chat.ts';
import { DashboardStore, dashboardRoutes } from './dashboard.ts';
import { providerStatus, type Provider } from './evaluator.ts';
import express from 'express';
import { listCompanies, demoSample, loadCompanyBills, companyAccounts } from './data.ts';
import { jevConfigured, JEV_MODEL } from './jev.ts';
import { ActionStore } from './actionStore.ts';
import { WorkspaceData } from './workspaceData.ts';
import { ActionEngine } from './actionEngine.ts';
import { SemanticService } from './semanticService.ts';
import { actionRoutes, sameOriginApi } from './actionRoutes.ts';
import { geminiConfigured, GEMINI_MODEL } from './messages.ts';
import { RuleService } from './ruleService.ts';
import { ruleRoutes } from './ruleRoutes.ts';
import { Mailbox, mailRoutes } from './mailbox.ts';
import { SavedSearchService, savedSearchRoutes } from './savedSearches.ts';

export interface AppOptions {
  chat?: ConstructorParameters<typeof ChatStore>[2];
  database: ActionStore;
  companies?: typeof listCompanies;
  load?: typeof loadCompanyBills;
  accounts?: typeof companyAccounts;
  sample?: typeof demoSample;
  evaluate?: ConstructorParameters<typeof SemanticService>[1];
  evaluateProvider?: ConstructorParameters<typeof SemanticService>[2];
  writer?: ConstructorParameters<typeof RuleService>[3];
  configured?: (provider?: Provider) => boolean;
  draftConfigured?: () => boolean;
  /** Disabled unless supplied; tests can inject short timers without duplicating routes. */
  timers?: { scanMs: number; draftMs: number };
}

/** Production HTTP assembly, also used by controlled and real-data workflow fixtures. */
export function createReviewApp(options: AppOptions) {
  const { database } = options;
  const companies = options.companies ?? listCompanies;
  const sample = options.sample ?? demoSample;
  const configured = options.configured ?? ((provider: Provider = 'jev') => providerStatus(provider).configured);
  const workspace = new WorkspaceData(database, options.load, options.accounts);
  const semantics = new SemanticService(workspace, options.evaluate, options.evaluateProvider);
  const actions = new ActionEngine(database, workspace);
  const rules = new RuleService(database, workspace, semantics.judge.bind(semantics), options.writer, id => companies().some(company => company.companyId === id));
  const searches = new SavedSearchService(database, id => companies().some(company => company.companyId === id));
  const app = express();
  app.use(express.json({ limit: '1mb' }));
  app.use('/api', sameOriginApi);
  app.use('/api/companies/:id', (req, res, next) => {
    if (!companies().some(company => company.companyId === req.params.id)) return res.status(404).json({ error: 'Company not found.' });
    next();
  });
  app.get('/api/status', (req, res) => {
    if (req.query.model !== undefined && !['jev', 'qwen'].includes(String(req.query.model))) return res.status(400).json({ error: 'Invalid provider.' });
    const provider = req.query.model === 'qwen' ? 'qwen' : 'jev';
    const providers = Object.fromEntries((['jev', 'qwen'] as const).map(key => [key, { ...providerStatus(key), configured: configured(key) }]));
    res.json({ jev: providers[provider], providers, gemini: { configured: (options.draftConfigured ?? geminiConfigured)(), model: GEMINI_MODEL } });
  });
  app.get('/api/companies', (_req, res) => res.json(companies()));
  app.get('/api/companies/:id/bills', (req, res) => {
    try {
      const full = workspace.bills(req.params.id);
      const available = workspace.availableRows(req.params.id);
      const curated = Number(req.query.limit) === -1 ? sample(req.params.id) : null;
      const limit = Number(req.query.limit);
      const rows = curated ? available.filter(row => curated.ids.has(row.billId))
        : Number.isInteger(limit) && limit > 0 && limit < available.length
          ? Array.from({ length: limit }, (_, i) => available[Math.floor(i * available.length / limit)]) : available;
      res.json({ ...full, rows, reservedRows: [], sampled: rows.length < available.length,
        ...(curated && { curatedSample: true, disclosure: `${full.disclosure ?? ''} ${curated.disclosure}`.trim() }),
        referenceOptions: { vendors: [...new Set(available.map(row => row.vendor))].sort(), accounts: [...new Set(available.map(row => row.account))].sort() },
      });
    } catch (error) { res.status(404).json({ error: (error as Error).message }); }
  });
  app.post('/api/evaluate', async (req, res) => {
    const { companyId, criterion, ids, model = 'jev' } = req.body ?? {};
    if (!['jev', 'qwen'].includes(model)) return res.status(400).json({ error: 'Invalid provider.' });
    if (typeof companyId !== 'string' || !companies().some(company => company.companyId === companyId)
      || typeof criterion !== 'string' || !criterion.trim() || criterion.length > 500
      || !Array.isArray(ids) || !ids.length || ids.length > 25 || !ids.every(id => typeof id === 'string' && id.startsWith(`${companyId}:`))) {
      return res.status(400).json({ error: 'Invalid evaluation request.' });
    }
    if (req.body.expectedIdentity !== undefined && req.body.expectedIdentity !== providerStatus(model).context.identity) return res.status(409).json({ error: 'Model configuration changed. Refresh model status and retry.' });
    if (!configured(model)) return res.status(503).json({ error: 'Selected provider is not configured.' });
    const ac = new AbortController();
    res.on('close', () => !res.writableEnded && ac.abort());
    try {
      const rows = workspace.availableRows(companyId);
      if (ids.some((id: string) => !rows.some(row => row.id === id))) return res.status(400).json({ error: 'Unknown or cross-company transaction ID.' });
      res.json(await semantics.evaluateRows(companyId, criterion, ids.map((id: string) => rows.find(row => row.id === id)!), ac.signal, model));
    } catch {
      if (!ac.signal.aborted) res.status(502).json({ error: 'Jev request failed.' });
    }
  });
  actionRoutes(app, actions);
  ruleRoutes(app, rules);
  mailRoutes(app, new Mailbox(database, workspace));
  savedSearchRoutes(app, searches);
  dashboardRoutes(app, new DashboardStore(database, workspace));
  chatRoutes(app, new ChatStore(database, workspace, options.chat));
  app.use('/api', (_req, res) => res.status(404).json({ error: 'API endpoint not found.' }));

  const pending = new Set<Promise<unknown>>();
  const run = (work: () => Promise<unknown>) => {
    const promise = work().catch(error => console.error('Background review:', (error as Error).message)).finally(() => pending.delete(promise));
    pending.add(promise);
  };
  const timers = options.timers ? [
    setInterval(() => run(() => rules.scan()), options.timers.scanMs),
    setInterval(() => run(() => rules.drainDrafts()), options.timers.draftMs),
  ] : [];
  timers.forEach(timer => timer.unref());
  return { app, database, workspace, semantics, actions, rules, searches,
    stop: async () => { timers.forEach(clearInterval); await Promise.allSettled([...pending]); },
  };
}
