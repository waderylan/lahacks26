import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import express from 'express';
import { actionStore } from './actionStore.ts';
import { createReviewApp } from './app.ts';
import { allowedOrigins } from './actionRoutes.ts';
import { geminiConfigured } from './messages.ts';
import { HostedState } from './hostedState.ts';
import type { DraftMessage } from '../src/rules.ts';

/**
 * Vercel Function entry for the hosted demo. Keys stay in Vercel env vars; the GitHub Pages frontend sends every API
 * call through POST /api/_tunnel with the state version it last saw. Vercel spreads requests across instances, so an
 * instance that is behind loads the browser's copy of the state first (see hostedState.ts and src/apiBase.ts).
 */
process.env.WORKSPACE_DB ||= '/tmp/actions.sqlite';
const seed = path.resolve('seed/actions.sqlite');
if (!fs.existsSync(process.env.WORKSPACE_DB) && fs.existsSync(seed)) fs.copyFileSync(seed, process.env.WORKSPACE_DB);
// The function bundle is read-only; /tmp is the only writable directory.
const runtime = createReviewApp({ database: actionStore(), feedbackDirectory: '/tmp/model-feedback' });
const state = new HostedState(runtime.database);

// The tunnel replays each request against the real routes over loopback, on this same instance.
const inner = http.createServer(runtime.app);
await new Promise<void>(resolve => inner.listen(0, '127.0.0.1', resolve));
const innerUrl = `http://127.0.0.1:${(inner.address() as AddressInfo).port}`;

const app = express();
app.set('trust proxy', true);
app.use(express.json({ limit: '4mb' }));
app.use((req, res, next) => {
  const origin = req.get('origin'), allowed = Boolean(origin && allowedOrigins().includes(origin));
  if (allowed) res.set({ 'Access-Control-Allow-Origin': origin, Vary: 'Origin', 'Access-Control-Allow-Methods': 'GET,POST', 'Access-Control-Allow-Headers': 'content-type', 'Access-Control-Max-Age': '600' });
  if (req.method === 'OPTIONS') return res.sendStatus(allowed ? 204 : 403);
  if (origin && !allowed) return res.status(403).json({ error: 'Cross-origin requests are not allowed.' });
  next();
});

// Per-instance limit on changes and model calls so a public URL can't drain gateway credit quickly.
const WINDOW_MS = 60_000, MAX_CALLS = 300;
const hits = new Map<string, number[]>();
const limited = (ip: string) => {
  const now = Date.now(), recent = (hits.get(ip) ?? []).filter(at => now - at < WINDOW_MS);
  hits.set(ip, [...recent, now]);
  return recent.length >= MAX_CALLS;
};

// Model calls only read; everything else may queue rule scans or message drafts.
const READ_ONLY = /\/(evaluate|understand|llm-evaluate|route)$/;
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const pendingDrafts = () => geminiConfigured() && runtime.database.list<{ store: { messages: DraftMessage[] } }>('rule-state')
  .some(saved => saved.store.messages.some(message => message.status === 'pending' && message.generation === 'pending'
    && (runtime.database.get<{ nextAt: number }>('draft-job', message.id)?.nextAt ?? 0) <= Date.now()));
/** No timers on serverless: finish rule scans and due drafts before replying so the returned state includes them. */
async function settle(scan: boolean, budgetMs: number) {
  const deadline = Date.now() + budgetMs;
  if (scan) await runtime.rules.scan().catch(error => console.error('Rule scan:', (error as Error).message));
  while (Date.now() < deadline) {
    await runtime.rules.drainDrafts().catch(() => {});
    if (!pendingDrafts()) return;
    await sleep(500);
  }
}

interface Envelope { path: string; method: string; contentType?: string; body?: string; version: number; state?: string }
app.post('/api/_tunnel', async (req, res) => {
  const { path: target, method = 'GET', contentType, body, version = 0, state: encoded } = (req.body ?? {}) as Envelope;
  if (typeof target !== 'string' || !target.startsWith('/api/') || target.startsWith('/api/_tunnel')) return res.status(400).json({ error: 'Invalid tunnel path.' });
  if (method !== 'GET' && limited(req.ip ?? 'unknown')) return res.json({ status: 429, contentType: 'application/json', body: JSON.stringify({ error: 'Too many requests. Try again in a minute.' }) });
  if (version !== state.version) {
    if (version !== 0 && !encoded) return res.json({ stale: true });
    try { state.load(version, encoded); } catch { return res.status(400).json({ error: 'Invalid state.' }); }
  }
  const response = await fetch(innerUrl + target, { method, headers: contentType ? { 'content-type': contentType } : {}, body: method === 'GET' || method === 'HEAD' ? undefined : body });
  const text = await response.text();
  if (method !== 'GET' && !READ_ONLY.test(target.split('?')[0])) await settle(true, 45_000);
  // Polls pick up drafts that are due again (e.g. a rate-limit retry), since nothing else would run them.
  else if (method === 'GET' && pendingDrafts()) await settle(false, 25_000);
  const next = state.collect(version);
  res.json({ status: response.status, contentType: response.headers.get('content-type') ?? undefined, body: text, version: state.version, ...(next && { state: next }) });
});

// Direct calls (curl, status checks) still work, without state sync.
app.use(runtime.app);
export default app;
