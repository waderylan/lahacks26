export type DecisionLabel = 'match' | 'no_match' | 'uncertain';
export interface FeedbackEntry {
  id: string; companyId: string; rowId: string; vendor: string; criterion: string;
  chosen: DecisionLabel; rejected: DecisionLabel; deploymentId: string;
  createdAt: string; actor: string; note: string; included: boolean; current?: boolean;
}
export interface FeedbackOperation {
  id: string; companyId: string; type: 'upload' | 'train'; status: 'running' | 'completed' | 'failed';
  stage: string; createdAt: string; updatedAt?: string; error?: string; feedbackHash: string; count: number;
  parentSnapshot?: string; baseModel?: string; baseRows?: number; totalRows?: number;
  preferencesSnapshot?: string; replaySnapshot?: string; datasetId?: string;
  jobId?: string; jobStatus?: string; outputName?: string;
}
export interface TrainingPlan { token: string; uploadId: string; examples: number; maxSteps: number; baseModel: string; estimateUsd: number; estimateMinutes: number; expiresAt: string }
export interface FeedbackState { entries: FeedbackEntry[]; operations: FeedbackOperation[]; configured: boolean; deploymentId: string | null; exportPath: string }
