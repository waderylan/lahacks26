import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import { waitUntil } from '@vercel/functions';
import { actionStore } from './actionStore.ts';
import { createReviewApp } from './app.ts';
import { allowedOrigins } from './actionRoutes.ts';

/**
 * Vercel Function entry for the hosted demo. Keys stay in Vercel env vars; the GitHub Pages
 * frontend calls this API cross-origin. SQLite starts from seed/actions.sqlite (companies 101-104) in /tmp, so state is per-instance.
 */
process.env.WORKSPACE_DB ||= '/tmp/actions.sqlite';
const seed = path.resolve('seed/actions.sqlite');
if (!fs.existsSync(process.env.WORKSPACE_DB) && fs.existsSync(seed)) fs.copyFileSync(seed, process.env.WORKSPACE_DB);
const runtime = createReviewApp({ database: actionStore() });
const app = express();
app.set('trust proxy', true);

app.use((req, res, next) => {
  const origin = req.get('origin');
  if (origin && allowedOrigins().includes(origin)) {
    res.set({ 'Access-Control-Allow-Origin': origin, Vary: 'Origin', 'Access-Control-Allow-Methods': 'GET,POST,PUT,PATCH,DELETE', 'Access-Control-Allow-Headers': 'content-type', 'Access-Control-Max-Age': '600' });
  }
  if (req.method === 'OPTIONS') return res.sendStatus(origin && allowedOrigins().includes(origin) ? 204 : 403);
  next();
});

// Per-instance limit on changes and model calls so a public URL can't drain gateway credit quickly.
const WINDOW_MS = 60_000, MAX_WRITES = 60;
const hits = new Map<string, number[]>();
app.use((req, res, next) => {
  if (['GET', 'HEAD'].includes(req.method)) return next();
  const now = Date.now(), key = req.ip ?? 'unknown';
  const recent = (hits.get(key) ?? []).filter(at => now - at < WINDOW_MS);
  if (recent.length >= MAX_WRITES) return res.status(429).json({ error: 'Too many requests. Try again in a minute.' });
  hits.set(key, [...recent, now]);
  next();
});

// No long-lived timers on serverless: run rule scans and draft writing after requests instead.
let lastKick = 0;
app.use((_req, _res, next) => {
  if (Date.now() - lastKick > 5_000) {
    lastKick = Date.now();
    waitUntil(Promise.allSettled([runtime.rules.scan(), runtime.rules.drainDrafts()]));
  }
  next();
});

app.use(runtime.app);
export default app;
