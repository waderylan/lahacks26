import type { Express, Request, Response } from 'express';
import { employeeById } from '../src/employees.ts';
import type { ActionStore } from './actionStore.ts';
import type { WorkspaceData } from './workspaceData.ts';
import { chooseEmployee } from './messages.ts';
import { jevConfigured } from './jev.ts';
import { understandQuestion } from './understand.ts';
import { CHAT_GEMINI_MODELS, geminiReady, isGeminiModel, judgeWithGemini, routeWithGemini, understandWithGemini } from './llm.ts';

/**
 * "Ask your books" chat: history per company and employee in SQLite, plus "let AI choose" routing.
 * The model is the user's pick: Jev runs on the AI Gateway key, Gemini models on GEMINI_API_KEY.
 */
export class ChatStore {
  constructor(readonly db: ActionStore, readonly data: WorkspaceData) {}

  history(companyId: string, as: string) {
    return this.db.list<{ id: string; as: string; createdAt: string }>('chat-turn', companyId).filter(t => t.as === as).sort((a, b) => a.createdAt.localeCompare(b.createdAt)).slice(-50);
  }
  save(companyId: string, turn: any) {
    if (!employeeById(turn?.as) || typeof turn.id !== 'string' || typeof turn.question !== 'string' || turn.question.length > 300) throw new Error('Invalid chat turn.');
    // Turn ids come from the client (it re-saves a turn as the answer arrives); never let one overwrite another company's or employee's turn.
    const existing = this.db.get<{ companyId: string; as: string }>('chat-turn', turn.id);
    if (existing && (existing.companyId !== companyId || existing.as !== turn.as)) throw new Error('Invalid chat turn.');
    this.db.put('chat-turn', turn.id, companyId, { ...turn, companyId, createdAt: turn.createdAt ?? new Date().toISOString() });
  }
  /** Dashboard charts are shared by everyone in the company; null until someone changes the starter set. */
  charts(companyId: string) { return this.db.get<{ charts: unknown[] }>('dashboard-charts', companyId)?.charts ?? null; }
  saveCharts(companyId: string, charts: unknown) {
    const ok = (c: any) => c && typeof c.id === 'string' && typeof c.title === 'string' && c.title.length <= 200
      && ['month', 'vendor', 'account', 'due'].includes(c.groupBy) && ['spend', 'count', 'open'].includes(c.measure) && ['bar', 'line', 'hbar'].includes(c.kind)
      && (c.ids === undefined || (Array.isArray(c.ids) && c.ids.length <= 5000 && c.ids.every((id: unknown) => typeof id === 'string' && id.startsWith(`${companyId}:`))));
    if (!Array.isArray(charts) || charts.length > 24 || !charts.every(ok)) throw new Error('Invalid dashboard charts.');
    this.db.put('dashboard-charts', companyId, companyId, { charts });
  }
  clear(companyId: string, as: string) {
    // Every turn, not just the 50 that history() returns.
    for (const turn of this.db.list<{ id: string; as: string }>('chat-turn', companyId).filter(t => t.as === as)) this.db.db.prepare('DELETE FROM documents WHERE kind=? AND id=?').run('chat-turn', turn.id);
  }

  /** Jev (or the chosen Gemini model) picks who should handle a set of bills, using the team's employee descriptions. */
  async route(companyId: string, ids: string[], request: string, model?: unknown) {
    const company = this.data.bills(companyId).company;
    const rows = ids.slice(0, 25).map(id => this.data.row(companyId, id));
    if (isGeminiModel(model)) return routeWithGemini({ name: company.name, industry: company.industry }, rows, request, model);
    const { employee, probability } = await chooseEmployee({ company: { name: company.name, industry: company.industry }, bills: rows.map(row => ({ row, context: [] })), request, recipient: 'jev' });
    return { employeeId: employee.id, probability };
  }
}

export function chatRoutes(app: Express, chat: ChatStore) {
  const route = (fn: (req: Request, res: Response) => unknown) => async (req: Request, res: Response) => {
    try { await fn(req, res); } catch (error) { res.status(400).json({ error: error instanceof Error ? error.message : 'Request failed.' }); }
  };
  const company = (req: Request) => { const id = String(req.params.id); chat.data.bills(id); return id; };
  const ready = (res: Response, model: unknown) => {
    if (isGeminiModel(model)) { if (!geminiReady()) { res.status(503).json({ error: 'GEMINI_API_KEY is not set' }); return false; } }
    else if (!jevConfigured()) { res.status(503).json({ error: 'Jev is not configured' }); return false; }
    return true;
  };
  app.get('/api/chat/models', (_req, res) => res.json({ jev: jevConfigured(), gemini: geminiReady(), geminiModels: CHAT_GEMINI_MODELS }));
  app.post('/api/understand', route(async (req, res) => {
    const question = req.body?.question, model = req.body?.model;
    if (typeof question !== 'string' || !question.trim() || question.length > 300) throw new Error('invalid question');
    if (!ready(res, model)) return;
    res.json(isGeminiModel(model) ? await understandWithGemini(question.trim(), model) : await understandQuestion(question.trim()));
  }));
  // Gemini's per-bill judging for the chat (Jev's goes through the team's /api/evaluate).
  app.post('/api/companies/:id/llm-evaluate', route(async (req, res) => {
    const { model, criterion, ids } = req.body ?? {};
    if (!isGeminiModel(model)) throw new Error('Choose a Gemini model.');
    if (typeof criterion !== 'string' || !criterion.trim() || criterion.length > 500 || !Array.isArray(ids) || !ids.length || ids.length > 100) throw new Error('Send a criterion and 1-100 bills.');
    if (!ready(res, model)) return;
    const id = company(req);
    const { company: c } = chat.data.bills(id);
    res.json(await judgeWithGemini({ name: c.name, industry: c.industry }, criterion.slice(0, 500), ids.map((b: unknown) => chat.data.row(id, String(b))), model));
  }));
  app.get('/api/companies/:id/dashboard', route((req, res) => res.json({ charts: chat.charts(company(req)) })));
  app.put('/api/companies/:id/dashboard', route((req, res) => { chat.saveCharts(company(req), req.body?.charts); res.json({ ok: true }); }));
  app.get('/api/companies/:id/chat', route((req, res) => res.json(chat.history(company(req), String(req.query.as ?? '')))));
  app.post('/api/companies/:id/chat', route((req, res) => { chat.save(company(req), req.body); res.json({ ok: true }); }));
  app.delete('/api/companies/:id/chat', route((req, res) => { chat.clear(company(req), String(req.query.as ?? '')); res.json({ ok: true }); }));
  app.post('/api/companies/:id/route', route(async (req, res) => {
    const ids = req.body?.ids, request = req.body?.request;
    if (!Array.isArray(ids) || !ids.length || typeof request !== 'string' || !request.trim() || request.length > 500) throw new Error('Choose bills and describe the request.');
    if (!ready(res, req.body?.model)) return;
    res.json(await chat.route(company(req), ids.map(String), request, req.body?.model));
  }));
}
