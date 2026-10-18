import type { RuleNode } from './rules';
export interface AccountOption { id: string; name: string }
export type BillAction =
  | { type: 'task'; title: string; owner: string; dueDate: string }
  | { type: 'category'; accountId: string }
  | { type: 'memo'; text: string }
  | { type: 'assign'; owner: string }
  | { type: 'flag' | 'tag'; label: string }
  | { type: 'review'; reviewed: boolean };
export interface ReviewTask {
  id: string; companyId: string; billId: string; vendor: string; title: string;
  owner: string; dueDate: string; status: 'open' | 'done' | 'cancelled'; createdAt: string; updatedAt: string;
  ruleId?: string; ruleActionId?: string; ruleRevision?: number;
}
export interface ActionItem {
  billId: string; vendor: string; version: string; before: string; after: string;
  status: 'ready' | 'skipped' | 'succeeded' | 'failed' | 'undone'; message?: string; taskId?: string;
  afterVersion?: string; previousValue?: unknown; resultingValue?: unknown;
}
export interface ActionPlan {
  id: string; companyId: string; action: BillAction; criterion: string;
  createdAt: string; status: 'preview' | 'finished'; items: ActionItem[];
}
export interface ServerAutomation {
  id: string; companyId: string; criterion: string; expression?: RuleNode; action: BillAction;
  enabled: boolean; createdAt: string; lastChecked?: string; error?: string; versions: Record<string, string>;
}
export interface ActionState { tasks: ReviewTask[]; runs: ActionPlan[]; automations: ServerAutomation[] }
export interface ActionSelection { ids: string[]; criterion?: string; expression?: RuleNode; scope: 'matches' | 'selected' }
export const billActionLabel = (action: BillAction): string => ({ task: 'Create review tasks', category: 'Change category', memo: 'Update memo', assign: 'Assign bills', flag: 'Add flag', tag: 'Add tag', review: 'Update review status' })[action.type];
