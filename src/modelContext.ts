export type Provider = 'jev' | 'qwen';
export type ScoreKind = 'jev_probability' | 'candidate_score_uncalibrated' | 'validation_calibrated';
/** Frozen evaluator identity at preview/run boundaries; no credentials or training records. */
export interface EvaluationContext {
  provider: Provider;
  model: string;
  policyVersion: string;
  scoreVersion: string;
  identity: string;
}
export const providerLabel = (provider: Provider = 'jev') => provider === 'qwen' ? 'Qwen' : 'Jev';
export const scoreLabel = (kind?: ScoreKind) => kind === 'validation_calibrated' ? 'Validation-adjusted score'
  : kind === 'candidate_score_uncalibrated' ? 'Raw candidate score' : kind === 'jev_probability' ? 'Jev match probability' : 'Score';
