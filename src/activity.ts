import type { ActionPlan, ReviewTask } from './actionTypes';
import { employeeById, ownerLabel } from './employees';
import { draftSender, type DraftMessage, type HistoryEntry } from './rules';

export type ActivityTone = 'need' | 'rev' | 'ok' | 'info' | 'warn' | 'muted';
/** Undo goes back through the source that made the change: a rule history entry or a dashboard action receipt. */
export type ActivityUndo = { kind: 'rule'; entryId: string } | { kind: 'receipt'; planId: string; billId: string };
export interface ActivityEvent {
  id: string; at: string; tone: ActivityTone; label: string; detail?: string;
  transactionIds: string[]; source: 'rule' | 'task' | 'message' | 'receipt';
  undo?: ActivityUndo;
}
export interface ActivitySources { companyId: string; history: HistoryEntry[]; messages: DraftMessage[]; runs: ActionPlan[]; tasks: ReviewTask[] }

const firstName = (id?: string | null) => employeeById(id)?.name.split(' ')[0] ?? 'someone';
const ruleLabel = (action: NonNullable<HistoryEntry['action']>): Pick<ActivityEvent, 'label' | 'tone'> => {
  switch (action.type) {
    case 'flag': return { label: `Flagged: ${action.value}`, tone: 'warn' };
    case 'assign': return { label: `Assigned to ${ownerLabel(action.value)}`, tone: 'info' };
    case 'tag': return { label: `Tagged: ${action.value}`, tone: 'info' };
    case 'task': return { label: `Task for ${ownerLabel(action.owner)}: ${action.value}`, tone: 'info' };
    case 'message': return { label: 'Message drafted for approval', tone: 'info' };
    default: return { label: 'Passed automated check', tone: 'ok' };
  }
};
const receiptLabel = (plan: ActionPlan, after: string): Pick<ActivityEvent, 'label' | 'tone'> => {
  const a = plan.action;
  switch (a.type) {
    case 'task': return { label: `Task for ${ownerLabel(a.owner)}: ${a.title}`, tone: 'info' };
    case 'category': return { label: `Recategorized to ${after}`, tone: 'info' };
    case 'memo': return { label: 'Memo updated', tone: 'info' };
    case 'assign': return { label: `Assigned to ${ownerLabel(a.owner)}`, tone: 'info' };
    case 'review': return { label: a.reviewed ? 'Marked reviewed' : 'Marked needs review', tone: a.reviewed ? 'rev' : 'need' };
    default: return { label: `${a.type === 'flag' ? 'Flagged' : 'Tagged'}: ${a.label}`, tone: a.type === 'flag' ? 'warn' : 'info' };
  }
};

/**
 * Everything that happened in one company, newest first: rule actions and resolutions, message drafts and decisions,
 * task completion, and dashboard receipts such as manual review. Stable event IDs make repeated polls and overlapping
 * sources deduplicate.
 */
export function activityFeed({ companyId, history, messages, runs, tasks }: ActivitySources): ActivityEvent[] {
  const events = new Map<string, ActivityEvent>();
  const add = (event: ActivityEvent) => { if (!events.has(event.id)) events.set(event.id, event); };
  for (const entry of history) {
    if (entry.companyId !== companyId) continue;
    if (entry.resolution) {
      const { flags, taskIds } = entry.resolution;
      add({ id: `rule:${entry.id}`, at: entry.timestamp, tone: 'ok', source: 'rule', transactionIds: [entry.transactionId], label: `Issue resolved: ${entry.ruleName}`,
        detail: `Cleared ${flags.length} ${flags.length === 1 ? 'flag' : 'flags'} and completed ${taskIds.length} ${taskIds.length === 1 ? 'task' : 'tasks'}.` });
      continue;
    }
    if (!entry.action) continue;
    const { label, tone } = ruleLabel(entry.action);
    add({ id: `rule:${entry.id}`, at: entry.timestamp, source: 'rule', transactionIds: [entry.transactionId], detail: `Rule: ${entry.ruleName}`,
      label: entry.undoneAt ? `${label} (undone)` : label, tone: entry.undoneAt ? 'muted' : tone, ...(!entry.undoneAt && { undo: { kind: 'rule', entryId: entry.id } as const }) });
  }
  for (const message of messages) {
    if (message.companyId !== companyId) continue;
    const ids = message.items.map(item => item.transactionId);
    const to = firstName(message.employeeId ?? undefined);
    if (message.status === 'approved') add({ id: `message:${message.id}:approved`, at: message.decidedAt ?? message.createdAt, tone: 'ok', source: 'message', transactionIds: ids, label: `Message sent to ${to}`, detail: `Approved by ${firstName(draftSender(message))}. ${message.subject}` });
    else if (message.status === 'rejected') add({ id: `message:${message.id}:rejected`, at: message.decidedAt ?? message.createdAt, tone: 'muted', source: 'message', transactionIds: ids, label: 'Message draft rejected', detail: message.subject || undefined });
    else if (message.generation === 'error') add({ id: `message:${message.id}:failed`, at: message.createdAt, tone: 'warn', source: 'message', transactionIds: ids, label: 'Message draft failed', detail: message.generationError });
  }
  for (const task of tasks) {
    if (task.companyId !== companyId || task.status === 'open') continue;
    add({ id: `task:${task.id}:${task.status}`, at: task.updatedAt, tone: task.status === 'done' ? 'ok' : 'muted', source: 'task', transactionIds: [task.billId],
      label: `Task ${task.status === 'done' ? 'done' : 'cancelled'}: ${task.title}`, detail: `Owner: ${ownerLabel(task.owner)}. This does not mark the transaction reviewed or resolve its issue.` });
  }
  for (const plan of runs) {
    if (plan.companyId !== companyId) continue;
    for (const item of plan.items) {
      if (item.status !== 'succeeded' && item.status !== 'undone') continue;
      const { label, tone } = receiptLabel(plan, item.after);
      const undone = item.status === 'undone';
      add({ id: `receipt:${plan.id}:${item.billId}`, at: plan.createdAt, source: 'receipt', transactionIds: [item.billId], label: undone ? `${label} (undone)` : label, tone: undone ? 'muted' : tone,
        ...(!undone && { undo: { kind: 'receipt', planId: plan.id, billId: item.billId } as const }) });
    }
  }
  return [...events.values()].sort((a, b) => b.at.localeCompare(a.at) || a.id.localeCompare(b.id));
}

/** The feed narrowed to one transaction. */
export const transactionTimeline = (feed: ActivityEvent[], transactionId: string) => feed.filter(event => event.transactionIds.includes(transactionId));
