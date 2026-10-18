import type { ActionPlan } from './actionTypes';
import { employeeById } from './employees';
import { draftSender, type DraftMessage, type HistoryEntry } from './rules';
import { CHECKS, type CheckKind, type CheckState } from './reviewChecks';

export type StatusTone = 'need' | 'rev' | 'ok' | 'info' | 'warn' | 'muted';
export interface BillEvent { label: string; tone: StatusTone; at: string }
export interface BillStatus { label: string; tone: StatusTone; events: BillEvent[] }

const firstName = (id?: string | null) => employeeById(id)?.name.split(' ')[0] ?? 'someone';

/** Every action taken on each bill, from rule history, rule messages and dashboard actions, newest first. */
export function billEvents(history: HistoryEntry[], messages: DraftMessage[], runs: ActionPlan[], checks: Partial<Record<CheckKind, CheckState>> = {}): Map<string, BillEvent[]> {
  const events = new Map<string, BillEvent[]>();
  const add = (id: string, event: BillEvent) => { const list = events.get(id) ?? []; list.push(event); events.set(id, list); };
  for (const entry of history) {
    const a = entry.action;
    if (!a || entry.undoneAt || a.type === 'message') continue;
    add(entry.transactionId, { at: entry.timestamp, ...(a.type === 'flag' ? { label: `Flagged: ${a.value}`, tone: 'warn' } : a.type === 'assign' ? { label: `Assigned to ${a.value}`, tone: 'info' }
      : a.type === 'tag' ? { label: `Tagged: ${a.value}`, tone: 'info' } : { label: 'Passed automated check', tone: 'ok' }) });
  }
  for (const m of messages) {
    const event: BillEvent = m.status === 'approved' ? { label: `Sent message to ${firstName(m.employeeId)}`, tone: 'ok', at: m.decidedAt ?? m.createdAt }
      : m.status === 'rejected' ? { label: `Message to ${firstName(m.employeeId)} rejected`, tone: 'muted', at: m.decidedAt ?? m.createdAt }
      : m.generation === 'error' ? { label: 'Message draft failed', tone: 'warn', at: m.createdAt }
      : m.generation === 'pending' ? { label: 'Drafting message…', tone: 'info', at: m.createdAt }
      : { label: `Message to ${firstName(m.employeeId)} awaiting ${firstName(draftSender(m))}`, tone: 'info', at: m.createdAt };
    for (const item of m.items) add(item.transactionId, event);
  }
  for (const plan of runs) for (const item of plan.items) {
    if (item.status !== 'succeeded') continue;
    const a = plan.action;
    add(item.billId, { at: plan.createdAt, ...(a.type === 'task' ? { label: `Task for ${a.owner}: ${a.title}`, tone: 'info' } : a.type === 'category' ? { label: `Recategorized to ${item.after}`, tone: 'info' }
      : a.type === 'memo' ? { label: 'Memo updated', tone: 'info' } : a.type === 'assign' ? { label: `Assigned to ${a.owner}`, tone: 'info' }
      : a.type === 'review' ? { label: a.reviewed ? 'Marked reviewed' : 'Marked needs review', tone: a.reviewed ? 'rev' : 'need' }
      : { label: `${a.type === 'flag' ? 'Flagged' : 'Tagged'}: ${a.label}`, tone: a.type === 'flag' ? 'warn' : 'info' }) });
  }
  for (const [kind, state] of Object.entries(checks) as [CheckKind, CheckState][]) {
    const info = CHECKS[kind];
    for (const r of Object.values(state.results)) {
      if (r.verdict === 'flag') add(r.id, { label: `${info.title}: ${info.flagged}${r.original ? ` of ${r.original.docNumber || r.original.billId}` : ''} (${Math.round(r.pFlag * 100)}%)`, tone: 'warn', at: r.checkedAt });
      else if (r.verdict === 'unsure' && r.signals.length) add(r.id, { label: `${info.title}: ${info.unsure}`, tone: 'info', at: r.checkedAt });
    }
    for (const [id, sent] of Object.entries(state.escalated)) add(id, { label: `${info.title} sent to ${firstName(sent.to ?? info.escalateTo)}`, tone: 'warn', at: sent.at });
  }
  for (const list of events.values()) list.sort((a, b) => b.at.localeCompare(a.at));
  return events;
}

/** The latest action, or the plain review state when nothing has been done to the bill. */
export function billStatus(events: BillEvent[] | undefined, reviewed: boolean): BillStatus {
  const latest = events?.[0];
  if (!latest) return { label: reviewed ? 'Reviewed' : 'Needs review', tone: reviewed ? 'rev' : 'need', events: [] };
  return { label: latest.label, tone: reviewed && latest.tone === 'need' ? 'rev' : latest.tone, events: events! };
}
