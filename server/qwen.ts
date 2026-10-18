import { adjustedProbability, readCalibration } from './calibration.ts';
import fs from 'node:fs';
import path from 'node:path';
import { decisionMessages, LABELS, type Decision, type DecisionInput } from './modelContract.ts';
export function qwenDeploymentId(): string | undefined {
  if (process.env.VERI_DEPLOYMENT_ID) return process.env.VERI_DEPLOYMENT_ID;
  const file = path.resolve('training/semantic-review/qwen-deployment.json');
  try { const id = JSON.parse(fs.readFileSync(file, 'utf8')).id; return typeof id === 'string' && /^[a-f0-9]+$/.test(id) ? id : undefined; } catch { return undefined; }
}
export class QwenReadinessError extends Error { constructor() { super('Qwen is starting. Retry after Veri shows serving.'); this.name = 'QwenReadinessError'; } }
export const qwenConfigured = () => Boolean(process.env.VERI_API_KEY && qwenDeploymentId());
export function parseQwenResponse(body: any): Decision {
  const choice = body.choices?.[0];
  const content = String(choice?.message?.content ?? '').replace(/^<think>[\s\S]*?<\/think>\s*/, '').trim();
  if (!(Object.hasOwn(LABELS, content))) throw new Error('Qwen returned an invalid decision; no action was applied');
  // No self-reported confidence. Scores are available only if all three token logprobs exist.
  const entries = choice.logprobs?.content;
  const first = Array.isArray(entries) ? entries.find((t: any) => String(t.token).trim() === content) : undefined;
  const probs = new Map<string, number>();
  for (const t of first?.top_logprobs ?? []) {
    const key = String(t.token).trim();
    if (Object.hasOwn(LABELS, key) && Number.isFinite(t.logprob)) probs.set(key, (probs.get(key) ?? 0) + Math.exp(t.logprob));
  }
  const total = ['A', 'B', 'C'].reduce((sum, k) => sum + (probs.get(k) ?? 0), 0);
  const valid = probs.size === 3 && total > 0;
  return { state: LABELS[content as keyof typeof LABELS], pMatch: valid ? probs.get('A')! / total : null, ...(valid ? { scoreKind: 'candidate_score_uncalibrated' as const } : {}) };
}
export async function evaluateQwen(input: DecisionInput, signal?: AbortSignal): Promise<Decision> {
  if (!qwenConfigured()) throw new Error('Qwen is not configured');
  const url = `https://api.veri.studio/v1/deployments/${encodeURIComponent(qwenDeploymentId()!)}/chat/completions`;
  const response = await fetch(url, {
    method: 'POST', signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(55000)]) : AbortSignal.timeout(55000),
    headers: { authorization: `Bearer ${process.env.VERI_API_KEY}`, 'content-type': 'application/json' },
    body: JSON.stringify({ model: 'any', messages: decisionMessages(input), temperature: 0, max_tokens: 8, logprobs: true, top_logprobs: 20, chat_template_kwargs: { enable_thinking: false } }),
  });
  if (!response.ok) {
    if (response.status === 503) throw new QwenReadinessError();
    throw new Error(`Qwen service HTTP ${response.status}`);
  }
  const result = parseQwenResponse(await response.json());
  const calibration = process.env.QWEN_RAW_SCORES === '1' ? null : readCalibration(qwenDeploymentId());
  if (calibration && result.pMatch !== null) return { ...result, rawPMatch: result.pMatch, pMatch: adjustedProbability(result.pMatch, calibration.a, calibration.b), scoreKind: 'validation_calibrated' };
  return result;
}
