import { money, moneyShort, sumCents, monthLabel, openCents, asOfDate, DUE_WINDOWS, dueWindow } from './chartMath';
export { money, moneyShort, sumCents, monthLabel, openCents, asOfDate, DUE_WINDOWS, dueWindow } from './chartMath';
export { useFullRecords as useFullBills } from './useFullRecords';
import type { EvaluationContext } from './modelContext';
import { evaluateCondition } from './jevClient';
import type { Outcome } from './rules';
import type { CompanyBills, Row } from './types';

export const spend = (nano: bigint) => {
  const micro = (nano + 500n) / 1000n;
  return `$${micro / 1_000_000n}.${(micro % 1_000_000n).toString().padStart(6, '0')}`;
};
export interface SemanticRun {
  outcomes: Record<string, Outcome>;
  done: number;
  total: number;
  costNano: bigint;
  startedAt: number;
  finishedAt: number | null;
  error: string | null;
  /** Gemini runs report tokens on GEMINI_API_KEY instead of a gateway dollar cost. */
  tokens?: number;
}

/** Runs one Jev criterion over `rows` with live progress. Judgments are cached in jevClient, so reruns are free. */
export function runSemantic(company: CompanyBills['company'], rows: Row[], criterion: string, onUpdate: (run: SemanticRun) => void, context?: EvaluationContext) {
  const run: SemanticRun = { outcomes: {}, done: 0, total: rows.length, costNano: 0n, startedAt: performance.now(), finishedAt: null, error: null };
  const emit = () => onUpdate({ ...run, outcomes: { ...run.outcomes } });
  emit();
  if (!rows.length) {
    run.finishedAt = performance.now();
    emit();
    return Promise.resolve();
  }
  return evaluateCondition({ company, rows }, criterion, (row, outcome, error) => {
    run.outcomes[row.id] = outcome;
    run.done++;
    if (error) run.error = error;
    emit();
  }, nano => { run.costNano += nano; emit(); }, context).then(() => {
    run.finishedAt = performance.now();
    emit();
  });
}

// ---------- Model choice for the chat: Jev on the AI Gateway key, Gemini on GEMINI_API_KEY ----------
export type ChatModel = 'jev' | 'gemini-3.8-flash' | 'gemini-3.5-flash' | 'gemini-3.5-flash-lite' | 'gemini-3.1-flash-lite' | 'gemini-2.5-flash';
export const CHAT_MODELS: { id: ChatModel; label: string; note: string; blurb: string }[] = [
  { id: 'jev', label: 'Jev', note: 'System One · AI Gateway key', blurb: 'Fast, one judgment per bill with confidence · AI Gateway key' },
  { id: 'gemini-3.8-flash', label: 'Gemini 3.8 Flash', note: 'Gemini key', blurb: 'Newest Gemini, slowest (about 30s per 100 bills) · Gemini key' },
  { id: 'gemini-3.5-flash', label: 'Gemini 3.5 Flash', note: 'Gemini key', blurb: 'Most accurate in our tests, slower · Gemini key' },
  { id: 'gemini-3.5-flash-lite', label: 'Gemini 3.5 Flash-Lite', note: 'Gemini key', blurb: 'Fast and light · Gemini key' },
  { id: 'gemini-3.1-flash-lite', label: 'Gemini 3.1 Flash-Lite', note: 'Gemini key', blurb: 'Fastest, lightest · Gemini key' },
  { id: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash', note: 'Gemini key', blurb: 'Older generation · Gemini key' },
];
export const modelLabel = (m: ChatModel) => CHAT_MODELS.find(x => x.id === m)?.label ?? m;

const geminiJudgments = new Map<string, 'true' | 'false' | 'uncertain'>();
/** Same as runSemantic, but Gemini judges up to 100 bills per call (paced on the server for free-tier limits). */
export async function runSemanticGemini(company: CompanyBills['company'], rows: Row[], criterion: string, model: ChatModel, onUpdate: (run: SemanticRun) => void) {
  const run: SemanticRun = { outcomes: {}, done: 0, total: rows.length, costNano: 0n, startedAt: performance.now(), finishedAt: null, error: null, tokens: 0 };
  const emit = () => onUpdate({ ...run, outcomes: { ...run.outcomes } });
  const key = (r: Row) => JSON.stringify([model, criterion, r.id, r.sourceVersion ?? '', r.description, r.memo]);
  for (const r of rows) { const hit = geminiJudgments.get(key(r)); if (hit) { run.outcomes[r.id] = hit; run.done++; } }
  emit();
  const missing = rows.filter(r => !geminiJudgments.has(key(r)));
  for (let i = 0; i < missing.length; i += 100) {
    const batch = missing.slice(i, i + 100);
    try {
      const res = await fetch(`/api/companies/${company.companyId}/llm-evaluate`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ model, criterion, ids: batch.map(r => r.id) }) });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
      run.tokens = (run.tokens ?? 0) + Number(body.tokens ?? 0);
      for (const r of body.results as { id: string; state: 'match' | 'no_match' | 'uncertain' }[]) {
        const outcome = ({ match: 'true', no_match: 'false', uncertain: 'uncertain' } as const)[r.state];
        const row = batch.find(b => b.id === r.id);
        if (row) geminiJudgments.set(key(row), outcome);
        run.outcomes[r.id] = outcome; run.done++;
      }
    } catch (e) {
      run.error = (e as Error).message;
      for (const r of batch) { run.outcomes[r.id] = 'error'; run.done++; }
    }
    emit();
  }
  run.finishedAt = performance.now();
  emit();
}

// ---------- Question parsing: deterministic, so the numbers never depend on a generative model ----------
export type Intent = 'total' | 'count' | 'vendors' | 'months' | 'list' | 'my_work' | 'upcoming';
export interface ParsedQuestion {
  intent: Intent;
  topic: string; // empty = every bill in the period
  criterion: string | null; // what Jev judges per bill
  period: { label: string; test: (date: string) => boolean } | null;
}

const MONTH_NAMES = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];

function parsePeriod(q: string, latest: string): { period: ParsedQuestion['period']; rest: string } {
  const lower = q.toLowerCase();
  const quarter = /\b(?:in |during |for )?(?:q([1-4])|(first|second|third|fourth) quarter)(?: of)?(?: (20\d\d))?\b/.exec(lower);
  if (quarter) {
    const n = quarter[1] ? Number(quarter[1]) : ['first', 'second', 'third', 'fourth'].indexOf(quarter[2]) + 1;
    const year = quarter[3];
    return {
      period: { label: `Q${n}${year ? ' ' + year : ''}`, test: d => Math.ceil(Number(d.slice(5, 7)) / 3) === n && (!year || d.startsWith(year)) },
      rest: q.slice(0, quarter.index) + q.slice(quarter.index + quarter[0].length),
    };
  }
  // "may" is usually the verb ("bills that may be duplicates"): only read it as the month with a lead-in or a year.
  const month = [...lower.matchAll(new RegExp(`\\b(in |during |for |since |of )?(${MONTH_NAMES.join('|')}|${MONTH_NAMES.map(m => m.slice(0, 3)).join('|')})\\b(?: (20\\d\\d))?`, 'g'))]
    .map(m => Object.assign([m[0], m[2], m[3]], { index: m.index! }))
    .find((m, _, __, prefixed = /^(in|during|for|since|of) /.test(m[0])) => m[1] !== 'may' || prefixed || Boolean(m[2]));
  if (month) {
    const m = MONTH_NAMES.findIndex(n => n.startsWith(month[1])) + 1;
    const mm = String(m).padStart(2, '0');
    const year = month[2];
    return {
      period: { label: `${MONTH_NAMES[m - 1][0].toUpperCase()}${MONTH_NAMES[m - 1].slice(1)}${year ? ' ' + year : ''}`, test: d => d.slice(5, 7) === mm && (!year || d.startsWith(year)) },
      rest: q.slice(0, month.index) + q.slice(month.index + month[0].length),
    };
  }
  const lastN = /\b(?:in |over |during )?(?:the )?(last|past) (\d+ )?(months?|quarters?|days?|weeks?)\b/.exec(lower);
  if (lastN) {
    const n = Number(lastN[2] ?? 1);
    const unitDays = lastN[3].startsWith('day') ? 1 : lastN[3].startsWith('week') ? 7 : lastN[3].startsWith('quarter') ? 91 : 30;
    const end = new Date(latest + 'T00:00:00Z');
    const start = new Date(end.getTime() - n * unitDays * 86400000).toISOString().slice(0, 10);
    return {
      period: { label: `${start} → ${latest}`, test: d => d > start && d <= latest },
      rest: q.slice(0, lastN.index) + q.slice(lastN.index + lastN[0].length),
    };
  }
  const year = /\b(?:in |during )?(20\d\d)\b/.exec(lower);
  if (year) return { period: { label: year[1], test: d => d.startsWith(year[1]) }, rest: q.slice(0, year.index) + q.slice(year.index + year[0].length) };
  return { period: null, rest: q.replace(/\b(this|last|the whole|the) year\b/i, '') };
}

export function parseQuestion(question: string, latestDate: string): ParsedQuestion {
  const { period, rest } = parsePeriod(question.trim(), latestDate);
  const lower = question.toLowerCase();
  const intent: Intent =
    /\b(my plate|my tasks?|assigned to me|on my desk|my (inbox|messages|approvals|bills|work)|what should i (do|work on)|for me to (do|review))\b/.test(lower) ? 'my_work'
      : /\b(due|upcoming|coming up|owe|outstanding|unpaid|need to pay|pay next|payables?)\b/.test(lower) ? 'upcoming'
      : /\b(by|per|each|every) month\b|\bmonthly\b|\btrend\b|\bover time\b/.test(lower) ? 'months'
      : /\bwhich vendors?\b|\bwho\b|\btop vendors?\b|\bby vendor\b|\bvendors? (do|did)\b/.test(lower) ? 'vendors'
      : /\bhow many\b|\bcount\b|\bnumber of\b/.test(lower) ? 'count'
      : /^(list|show|find|which bills|what bills|give me)\b/.test(lower) ? 'list'
      : 'total';
  let topic = rest
    .replace(/[?.!]+$/g, '')
    // "graph/chart/plot … " asks for a picture, it isn't part of the topic
    .replace(/^\s*((please|can you)\s+)?(graph|chart|plot|visuali[sz]e|draw|show)(\s+me)?(\s+(a|an|the))?(\s+(graph|chart|plot)\s+of)?\b/i, '')
    .replace(/^\s*(how much|how many|what('s| is| was)?( the)?( total)?|which vendors?|who|show( me)?|list|find|give me|total|count|number of|top vendors)\b/i, '')
    .replace(/^\s*(did|do|does|have|has|was|were|is|are)\b/i, '')
    .replace(/^\s*(we|i|the company|our company|us)\b/i, '')
    .replace(/^\s*(spend|spent|spending|pay|paid|buy|bought|owe|bill(ed)?|get billed|sell us|charge us)\b/i, '')
    .replace(/^\s*(on|for|in|to)\b/i, '')
    .replace(/\b(by|per|each) month\b|\bmonthly\b|\bover time\b|\bby vendor\b|\b(in )?total\b/gi, '')
    .replace(/^\s*(bills?|transactions?|purchases?)( that)?( were| was| are| is)? (for|on)\b/i, '')
    .replace(/\b(from|to|for|with|on)\s*$/i, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (/^(spend|spending|bills?|transactions?|expenses?|purchases?|everything|anything|all)$/i.test(topic) || topic.length < 2) topic = '';
  const criterion = !topic ? null : /^(bills?|transactions?|purchases?|anything|expenses?|payments?)\b/i.test(topic) ? topic : `Bills for ${topic}`;
  if (intent === 'my_work' || intent === 'upcoming') return { intent, topic: '', criterion: null, period: null };
  return { intent, topic, criterion, period };
}

export function groupTotals(rows: Row[], key: (r: Row) => string) {
  const map = new Map<string, { cents: number; count: number }>();
  for (const r of rows) {
    const k = key(r);
    const g = map.get(k) ?? { cents: 0, count: 0 };
    g.cents += r.amountCents;
    g.count++;
    map.set(k, g);
  }
  return [...map.entries()].map(([label, g]) => ({ label, ...g }));
}

// ---------- Company-aware prompts: only suggest topics this company's bills actually mention ----------
const TOPICS: { question: string; bucket: string; hint: RegExp }[] = [
  { question: 'How much did we pay subcontractors?', bucket: 'Subcontracted labor', hint: /subcontract/ },
  { question: 'How much did we spend on utilities?', bucket: 'Utilities and energy', hint: /utilit|electric|water|gas\b/ },
  { question: 'How much went to rent and premises?', bucket: 'Rent, premises and facilities', hint: /premises|rent|lease/ },
  { question: 'Which vendors sell us hardware or materials?', bucket: 'Hardware and building materials', hint: /hardware|material|lumber|timber|hinge|cabinet/ },
  { question: 'How much did we spend on electronics?', bucket: 'Anything electronic or tech-related', hint: /usb|bluetooth|electronic|charger|cable|earbud/ },
  { question: 'Food and ingredients by month', bucket: 'Food and ingredients', hint: /food|ingredient|flour|coffee|produce|dairy|meat/ },
  { question: 'Marketing and advertising by month', bucket: 'Marketing and advertising', hint: /advertis|marketing/ },
  { question: 'How many bills were for permits or licenses?', bucket: 'Permits, licenses and taxes', hint: /permit|licen/ },
  { question: 'How much did we pay in interest?', bucket: 'Interest and financing', hint: /interest|loan/ },
  { question: 'How much did we spend on equipment?', bucket: 'Equipment', hint: /equipment|machine|tool/ },
  { question: 'How much did we spend on software or subscriptions?', bucket: 'Software, subscriptions or online services', hint: /software|subscription|saas|hosting/ },
];

function relevantTopics(rows: Row[]) {
  const text = rows.map(r => `${r.account} ${r.description} ${r.itemNames.join(' ')}`).join(' ').toLowerCase();
  return TOPICS.filter(t => t.hint.test(text));
}

export function suggestQuestions(rows: Row[]) {
  return [...relevantTopics(rows).slice(0, 3).map(t => t.question), "What's on my plate?", 'What bills are due soon?', 'Show me bills where the memo mentions a delay'];
}


// ---------- Jev's reading of the whole question (server/understand.ts) ----------
export interface Understanding {
  intent: Intent;
  scope: 'specific' | 'everything';
  period: string;
  confidence: { intent: number; scope: number; period: number };
  costNanoUsd: string;
  ms: number;
  /** Set when a Gemini model read the question (no probabilities, tokens instead of cost). */
  engine?: string;
  tokens?: number;
}

const MONTH_KEYS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const PERIOD_LABELS: Record<string, string> = { q1: 'Q1', q2: 'Q2', q3: 'Q3', q4: 'Q4', h1: 'the first half (Jan–Jun)', h2: 'the second half (Jul–Dec)', last_30_days: 'the last 30 days', last_90_days: 'the last 3 months', last_180_days: 'the last 6 months' };

/** Turns Jev's period choice into an exact date test; dates themselves are always filtered in code. */
export function periodFromKey(key: string, latest: string): ParsedQuestion['period'] {
  const month = (d: string) => Number(d.slice(5, 7));
  if (/^q[1-4]$/.test(key)) { const n = Number(key[1]); return { label: PERIOD_LABELS[key], test: d => Math.ceil(month(d) / 3) === n }; }
  if (key === 'h1' || key === 'h2') return { label: PERIOD_LABELS[key], test: d => (month(d) <= 6) === (key === 'h1') };
  const m = MONTH_KEYS.indexOf(key);
  if (m >= 0) return { label: MONTH_NAMES[m][0].toUpperCase() + MONTH_NAMES[m].slice(1), test: d => month(d) === m + 1 };
  const days = { last_30_days: 30, last_90_days: 91, last_180_days: 182 }[key];
  if (days) {
    const start = new Date(new Date(latest + 'T00:00:00Z').getTime() - days * 86400000).toISOString().slice(0, 10);
    return { label: PERIOD_LABELS[key], test: d => d > start && d <= latest };
  }
  return null;
}

/**
 * Jev decides the answer type, whether the question narrows spending, and fuzzy periods; an explicit
 * period the text rules recognise wins because it is exact. A narrowed question is judged per bill
 * with the user's own words, not a rewritten topic.
 */
export function combineUnderstanding(question: string, rules: ParsedQuestion, jev: Understanding, latest: string): ParsedQuestion {
  const period = rules.period ?? periodFromKey(jev.period, latest);
  // Explicit "my work" / "due" phrasing recognised by the text rules wins; Jev covers looser wording.
  if (rules.intent === 'my_work' || rules.intent === 'upcoming') return rules;
  if (jev.intent === 'my_work' || jev.intent === 'upcoming') return { intent: jev.intent, topic: '', criterion: null, period: null };
  const specific = jev.scope === 'specific';
  return {
    intent: jev.intent,
    topic: specific ? rules.topic || 'your question' : '',
    criterion: specific ? `Bills that are relevant to this question. Ignore any time period in it; dates are filtered separately. Question: "${question}"` : null,
    period,
  };
}

// ---------- Payables: open balances by due date (no AI) ----------
export function upcomingPayables(rows: Row[]) {
  const asOf = asOfDate(rows);
  const open = rows.filter(r => (r.txnType ?? 'bill') === 'bill' && openCents(r) > 0).sort((a, b) => a.dueDate.localeCompare(b.dueDate));
  const windows = DUE_WINDOWS.map(w => {
    const bills = open.filter(r => dueWindow(r.dueDate, asOf) === w.id);
    return { ...w, bills, cents: bills.reduce((s, r) => s + openCents(r), 0) };
  });
  return { asOf, open, windows, total: open.reduce((s, r) => s + openCents(r), 0) };
}
