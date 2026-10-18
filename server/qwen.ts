import { adjustedProbability, readCalibration, type Calibration } from './calibration.ts';
import { runtimeModelConfig } from './modelConfig.ts';
import { randomUUID } from 'node:crypto';
import { withQwenSlot } from './qwenConcurrency.ts';
import { decisionMessages, LABELS, type Decision, type DecisionInput } from './modelContract.ts';
export function qwenDeploymentId(): string | undefined {
  const id = process.env.VERI_DEPLOYMENT_ID ?? runtimeModelConfig().deploymentId;
  return typeof id === 'string' && /^[a-zA-Z0-9_-]{1,200}$/.test(id) ? id : undefined;
}
export interface QwenRuntime { deploymentId?: string; calibration: Calibration | null }
export const qwenRuntime = (): QwenRuntime => { const deploymentId = qwenDeploymentId(); return { deploymentId, calibration: process.env.QWEN_RAW_SCORES === '1' ? null : readCalibration(deploymentId) }; };
export class QwenReadinessError extends Error { constructor() { super('Qwen is starting. Retry after Veri shows serving.'); this.name = 'QwenReadinessError'; } }
export class QwenRequestError extends Error {
  constructor(readonly kind: string, readonly requestId: string, readonly status = 502) {
    super(`Qwen: ${kind}. Reference: ${requestId}`); this.name = 'QwenRequestError';
  }
}
export function qwenFailureKind(error: unknown): string {
  const e = error as { name?: string; cause?: { code?: string } };
  if (e?.name === 'TimeoutError') return 'request timed out';
  if (e?.name === 'AbortError') return 'request cancelled';
  const code = e?.cause?.code;
  return code && /^[A-Z0-9_]{1,60}$/.test(code) ? `connection failed (${code})` : 'connection failed';
}
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
export async function evaluateQwen(input: DecisionInput, signal?: AbortSignal, runtime = qwenRuntime()): Promise<Decision> {
  return withQwenSlot(() => evaluateQwenRequest(input, signal, runtime), signal);
}
async function evaluateQwenRequest(input: DecisionInput, signal: AbortSignal | undefined, runtime: QwenRuntime): Promise<Decision> {
  if (!process.env.VERI_API_KEY || !runtime.deploymentId) throw new Error('Qwen is not configured');
  const url = `https://api.veri.studio/v1/deployments/${encodeURIComponent(runtime.deploymentId)}/chat/completions`;
  const requestId = randomUUID();
  const startedAt = Date.now();
  let httpStatus: number | undefined;
  console.info(JSON.stringify({ event: 'qwen.start', requestId, deployment: runtime.deploymentId, at: new Date().toISOString() }));
  try {
  let response: Response;
  try { response = await fetch(url, {
    method: 'POST', signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(55000)]) : AbortSignal.timeout(55000),
    headers: { authorization: `Bearer ${process.env.VERI_API_KEY}`, 'content-type': 'application/json' },
    body: JSON.stringify({ model: 'any', messages: decisionMessages(input), temperature: 0, max_tokens: 8, logprobs: true, top_logprobs: 20, chat_template_kwargs: { enable_thinking: false } }),
  });
  } catch (error) { throw new QwenRequestError(qwenFailureKind(error), requestId); }
  httpStatus = response.status;
  if (!response.ok) {
    const label = response.status === 503 ? 'service unavailable (HTTP 503)' : response.status === 429 ? 'rate limited (HTTP 429)' : `service returned HTTP ${response.status}`;
    throw new QwenRequestError(label, requestId, response.status === 503 ? 503 : 502);
  }
  let result: Decision;
  try { result = parseQwenResponse(await response.json()); }
  catch { throw new QwenRequestError('invalid model response', requestId); }
  console.info(JSON.stringify({ event: 'qwen.success', requestId, httpStatus, elapsedMs: Date.now() - startedAt }));
  const calibration = runtime.calibration;
  if (calibration && result.pMatch !== null) return { ...result, rawPMatch: result.pMatch, pMatch: adjustedProbability(result.pMatch, calibration.a, calibration.b), scoreKind: 'validation_calibrated' };
  return result;
  } catch (error) {
    console.error(JSON.stringify({ event: 'qwen.failure', requestId, httpStatus, elapsedMs: Date.now() - startedAt, error: error instanceof QwenRequestError ? error.kind : 'response processing failed', at: new Date().toISOString() }));
    throw error;
  }
}
