import { dueWindow, DUE_WINDOWS, monthLabel, openCents, asOfDate } from './chartMath';
import type { Row } from './types';

/**
 * A dashboard chart is a small spec, not an image: which bills, how to group them, what to measure
 * and how to draw it. Numbers always come from this code (integer cents), never from a model;
 * a model only decides which bills belong in a chart that answers a question.
 */
export type GroupBy = 'month' | 'vendor' | 'account' | 'due';
export type Measure = 'spend' | 'count' | 'open' | 'receivable' | 'bank_in' | 'bank_out';
export type ChartKind = 'bar' | 'line' | 'hbar';
export interface ChartSpec {
  id: string;
  title: string;
  groupBy: GroupBy;
  measure: Measure;
  kind: ChartKind;
  /** Only these bills (from a chat answer); omitted = every bill in the company. */
  ids?: string[];
  /** Where a chart came from, e.g. the chat question and model that picked the bills. */
  source?: { question: string; model: string; at: string };
  /** Starter charts can be edited and reset; chat charts can be removed. */
  starter?: boolean;
}
export interface Point { label: string; key: string; value: number; count: number }

export const GROUP_LABELS: Record<GroupBy, string> = { month: 'Month', vendor: 'Vendor', account: 'Account', due: 'Due date' };
export const MEASURE_LABELS: Record<Measure, string> = { spend: 'Vendor-bill amount', count: 'Transaction count', open: 'Vendor-bill open amount', receivable: 'Invoice open amount', bank_in: 'Bank deposits', bank_out: 'Bank withdrawals' };
export const KIND_LABELS: Record<ChartKind, string> = { bar: 'Bars', line: 'Line', hbar: 'Horizontal bars' };

export const STARTER_CHARTS: ChartSpec[] = [
  { id: 'starter-monthly', title: 'Monthly billed spend', groupBy: 'month', measure: 'spend', kind: 'bar', starter: true },
  { id: 'starter-vendors', title: 'Top vendors', groupBy: 'vendor', measure: 'spend', kind: 'hbar', starter: true },
  { id: 'starter-accounts', title: 'Spend by account', groupBy: 'account', measure: 'spend', kind: 'hbar', starter: true },
  { id: 'starter-payables', title: 'Open payables by due date', groupBy: 'due', measure: 'open', kind: 'bar', starter: true },
];

const TOP = 8;

/** Groups and sums bills for a chart. Months are chronological; vendors/accounts are largest first with the rest as "Other". */
export function aggregate(allRows: Row[], spec: Pick<ChartSpec, 'groupBy' | 'measure' | 'ids'>): Point[] {
  const ids = spec.ids ? new Set(spec.ids) : null;
  const rows = (ids ? allRows.filter(r => ids.has(r.id)) : allRows).filter(r => spec.measure === 'count'
    || (spec.measure === 'spend' || spec.measure === 'open') && (r.txnType ?? 'bill') === 'bill'
    || spec.measure === 'receivable' && r.txnType === 'invoice'
    || spec.measure === 'bank_in' && r.txnType === 'bank' && r.details?.direction === 'deposit'
    || spec.measure === 'bank_out' && r.txnType === 'bank' && r.details?.direction === 'withdrawal');
  const asOf = asOfDate(allRows);
  const value = (r: Row) => (spec.measure === 'count' ? 1 : ['open', 'receivable'].includes(spec.measure) ? openCents(r) : r.amountCents);
  const keyOf = (r: Row) => (spec.groupBy === 'month' ? r.date.slice(0, 7) : spec.groupBy === 'vendor' ? r.vendor : spec.groupBy === 'account' ? r.account || '(none)' : dueWindow(r.dueDate, asOf));
  const map = new Map<string, Point>();
  for (const r of rows) {
    if (['open', 'receivable'].includes(spec.measure) && openCents(r) <= 0) continue;
    const key = keyOf(r);
    const p = map.get(key) ?? { key, label: key, value: 0, count: 0 };
    p.value += value(r);
    p.count++;
    map.set(key, p);
  }
  let points = [...map.values()];
  if (spec.groupBy === 'month') return points.sort((a, b) => a.key.localeCompare(b.key)).map(p => ({ ...p, label: monthLabel(p.key) }));
  if (spec.groupBy === 'due') return DUE_WINDOWS.map(w => map.get(w.id) ?? { key: w.id, label: w.label, value: 0, count: 0 }).map(p => ({ ...p, label: DUE_WINDOWS.find(w => w.id === p.key)!.label }));
  points = points.sort((a, b) => b.value - a.value);
  if (points.length <= TOP) return points;
  const rest = points.slice(TOP - 1);
  return [...points.slice(0, TOP - 1), { key: '__other', label: `Other (${rest.length})`, value: rest.reduce((s, p) => s + p.value, 0), count: rest.reduce((s, p) => s + p.count, 0) }];
}

/** Sensible chart for a chat answer: its own grouping when it has one, otherwise by month. */
export function chartForAnswer(intent: string): Pick<ChartSpec, 'groupBy' | 'measure' | 'kind'> {
  if (intent === 'vendors') return { groupBy: 'vendor', measure: 'spend', kind: 'hbar' };
  if (intent === 'count') return { groupBy: 'month', measure: 'count', kind: 'bar' };
  if (intent === 'upcoming') return { groupBy: 'due', measure: 'open', kind: 'bar' };
  return { groupBy: 'month', measure: 'spend', kind: 'bar' };
}

/**
 * Whether a chat question asks for a graph, and how to group and measure it from its wording
 * ("chart spend by vendor", "graph how many bills per month"). Falls back to the answer's own shape.
 */
export function graphRequest(question: string, intent: string): { wanted: boolean; spec: Pick<ChartSpec, 'groupBy' | 'measure' | 'kind'> } {
  const q = question.toLowerCase();
  const wanted = /\b(graph|chart|plot|visuali[sz]e|visual|trend|over time|breakdown)\b/.test(q);
  const spec = { ...chartForAnswer(intent) };
  if (/\b(by|per|each|across) (vendor|supplier|payee)s?\b|\bwhich vendors?\b|\btop vendors?\b/.test(q)) spec.groupBy = 'vendor';
  else if (/\b(by|per|each|across) (account|category|categories)\b/.test(q)) spec.groupBy = 'account';
  else if (/\b(by|per|each) (month|week)\b|\bmonthly\b|\bover time\b|\btrend\b/.test(q)) spec.groupBy = 'month';
  else if (/\b(due|overdue|upcoming|unpaid|owe)\b/.test(q)) spec.groupBy = 'due';
  if (/\bhow many\b|\bnumber of\b|\bcount\b/.test(q)) spec.measure = 'count';
  else if (/\b(unpaid|owe|open balance|outstanding)\b/.test(q) || spec.groupBy === 'due') spec.measure = 'open';
  else if (spec.measure === 'open') spec.measure = 'spend'; // open balance only fits due-date charts
  if (/\bline\b|\btrend\b|\bover time\b/.test(q) && spec.groupBy === 'month') spec.kind = 'line';
  else spec.kind = spec.groupBy === 'vendor' || spec.groupBy === 'account' ? 'hbar' : spec.kind === 'hbar' ? 'bar' : spec.kind;
  return { wanted, spec };
}

/** Chart title from a chat question: drops a leading "graph"/"chart"/"plot me…" and starts with a capital letter. */
export function chartTitle(question: string): string {
  const t = question.trim().replace(/[?.!]+$/, '')
    .replace(/^(please\s+)?(can you\s+)?(graph|chart|plot|visuali[sz]e|show|draw|make)(\s+me)?(\s+(a|an|the))?(\s+(graph|chart|plot|visual))?(\s+of)?\s+/i, '')
    .trim();
  const title = t || question.trim();
  return (title.charAt(0).toUpperCase() + title.slice(1)).slice(0, 120);
}

export const CHART_LIMIT = 24;
export function validateCharts(value: unknown, companyId: string, validIds?: Set<string>): ChartSpec[] {
 if (!Array.isArray(value) || value.length > CHART_LIMIT) throw new Error('A dashboard supports up to ' + CHART_LIMIT + ' charts.');
 const seen = new Set<string>();
 return value.map((c: any) => {
  if (!c || typeof c.id !== 'string' || !c.id.trim() || c.id.length > 100 || seen.has(c.id)
   || typeof c.title !== 'string' || !c.title.trim() || c.title.length > 120
   || !Object.hasOwn(GROUP_LABELS,c.groupBy) || !Object.hasOwn(MEASURE_LABELS,c.measure) || !Object.hasOwn(KIND_LABELS,c.kind)
   || c.starter !== undefined && typeof c.starter !== 'boolean') throw new Error('Invalid chart specification or duplicate chart ID.');
  seen.add(c.id);
  if (c.ids !== undefined && (!Array.isArray(c.ids) || c.ids.length > 5000 || new Set(c.ids).size !== c.ids.length || !c.ids.every((id: unknown) => typeof id === 'string' && id.startsWith(companyId + ':') && (!validIds || validIds.has(id))))) throw new Error('Chart records must belong to this company.');
  if (c.source !== undefined && (!c.source || typeof c.source !== 'object' || typeof c.source.question !== 'string' || !c.source.question.trim() || c.source.question.length > 500
    || typeof c.source.model !== 'string' || !c.source.model.trim() || c.source.model.length > 200 || typeof c.source.at !== 'string' || !Number.isFinite(Date.parse(c.source.at)))) throw new Error('Invalid chart source.');
  return { id:c.id,title:c.title.trim(),groupBy:c.groupBy,measure:c.measure,kind:c.kind,
   ...(c.ids !== undefined && {ids:[...c.ids]}), ...(c.starter !== undefined && {starter:c.starter}),
   ...(c.source && {source:{question:c.source.question,model:c.source.model,at:c.source.at}}) };
 });
}
