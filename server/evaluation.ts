import fs from 'node:fs';
import path from 'node:path';
import type { Express } from 'express';

/**
 * Evaluation tab data: the saved scores from scripts/benchmark_semantic_models.ts and
 * scripts/benchmark_semantic_workload.ts (training/semantic-review). Metrics only: no case labels
 * or predictions leave the server, and nothing here calls a model.
 */
const DIR = path.resolve('training/semantic-review');
const MODELS: { id: string; name: string; kind: string; key: string }[] = [
  { id: 'jev', name: 'Jev', kind: 'System One judge (typesafe-ai/jev)', key: 'AI Gateway key' },
  { id: 'gemini-lite', name: 'Gemini 3.5 Flash-Lite', kind: 'General-purpose LLM, batch prompt', key: 'Gemini key' },
  { id: 'qwen17', name: 'Qwen3-1.7B fine-tuned', kind: 'Small model trained by the team', key: 'Veri GPU' },
  { id: 'qwen', name: 'Qwen3-0.6B fine-tuned', kind: 'Small model trained by the team', key: 'Veri GPU' },
  { id: 'heuristic', name: 'Keyword rules', kind: 'Classical rules, no model', key: 'None' },
];

const read = (file: string) => {
  const p = path.join(DIR, file);
  try { return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : null; } catch { return null; }
};

export function evaluationSummary() {
  return {
    cases: 370,
    note: 'Same 370 authored-reference cases for every model: 150 existing demo cases and 220 held-out synthetic overlays. Same visible bill fields and instructions. Missing or invalid answers count as wrong.',
    models: MODELS.map(m => {
      const q = read(`${m.id}-benchmark.json`);
      const w = read(`${m.id}-workload-all.json`);
      return {
        ...m,
        ran: !!q,
        accuracy: q?.accuracy ?? null, macroF1: q?.macroF1 ?? null, errors: q?.errors ?? null, falseMatches: q?.falseMatches ?? null,
        uncertainRecall: q?.uncertainRecall ?? null, matchBrier: q?.matchBrier ?? null, scoreCoverage: q?.scoreCoverage ?? null,
        batchP50Ms: q?.batchP50Ms ?? null, costNanoUsd: q?.requestCostNanoUsd ?? null, tokens: q?.geminiTokens ?? null,
        byOrigin: q?.byOrigin ?? null, byFamily: q?.byFamily ?? null,
        fullCompany: w ? { bills: w.results?.length ?? null, ms: w.totalMs ?? null, costNanoUsd: w.requestCostNanoUsd ?? null } : null,
      };
    }),
  };
}

export function evaluationRoutes(app: Express) {
  app.get('/api/evaluation', (_req, res) => res.json(evaluationSummary()));
}
