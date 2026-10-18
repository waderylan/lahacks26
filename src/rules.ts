import type { Row } from './types';
import { employeeById } from './employees';

export type Truth = 'true' | 'false' | 'uncertain';
export type Outcome = Truth | 'pending' | 'error';
export type Group = { id: string; type: 'all' | 'any' | 'not'; children: RuleNode[] };
export type AICondition = { id: string; type: 'ai'; text: string; label: string };
export type StandardCondition = { id: string; type: 'standard'; field: 'amountCents' | 'review' | 'vendor' | 'account'; operator: 'gt' | 'lt' | 'eq'; value: string };
export type RuleNode = Group | AICondition | StandardCondition;
export type ActionType = 'flag' | 'assign' | 'tag' | 'pass' | 'message';
/**
 * For `message`, `value` is the reviewer's short request, `recipient` is an employee ID or 'jev' (Jev picks),
 * and `sender` is the employee who approves the drafts and sends them.
 */
export type Action = { id: string; type: ActionType; value: string; recipient?: string; sender?: string };
/** Drafts and rules saved before senders existed are sent from AP, the default reviewer. */
export const DEFAULT_SENDER = 'emp-ap';
export interface Rule {
  id: string; companyId: string; name: string; revision: number; enabled: boolean;
  expression: RuleNode; actions: Action[];
}
export interface LocalTransaction { flags: string[]; tags: string[]; owner: string; automatedCheck: boolean }
export type MessageStatus = 'pending' | 'approved' | 'rejected';
export interface DraftMessage {
  id: string; companyId: string;
  /** Every bill this message covers; a run batches all its matches into one message (up to MAX_MESSAGE_ITEMS). */
  items: MessageItem[]; batchId: string;
  ruleId: string; ruleName: string; revision: number; actionId: string;
  to: string; subject: string; body: string; reason: string;
  status: MessageStatus; edited: boolean; createdAt: string; decidedAt?: string;
  /** Absent on drafts saved before generated messages; those are ready. */
  request?: string; routing?: 'jev' | 'manual'; senderId?: string; employeeId?: string | null; routingProbability?: number;
  generation?: 'pending' | 'ready' | 'error'; generationError?: string;
}
export interface MessageItem { transactionId: string; billId: string; context: MessageContext[] }
export const MAX_MESSAGE_ITEMS = 25;
/** One rule condition and its result for this bill: the filtering evidence handed to Jev and Gemini. */
export interface MessageContext { condition: string; kind: 'ai' | 'standard'; result: Truth }
export interface DraftResult { employeeId: string; routingProbability?: number; subject: string; body: string }
export type NoticeTone = 'good' | 'info' | 'warn';
export interface Notice {
  id: string; companyId: string; title: string; body?: string; tone: NoticeTone;
  time: string; read: boolean; toasted: boolean; transactionId?: string;
}
export interface Snapshot { result: Outcome; conditions: Record<string, Outcome>; expression?: RuleNode }
export interface HistoryEntry {
  id: string; key: string; ruleId: string; ruleName: string; revision: number;
  companyId: string; transactionId: string; transactionVersion: string; action: Action | null;
  timestamp: string; previous: unknown; resulting: unknown; snapshot: Snapshot;
  source: 'run' | 'arrival' | 'update'; undoneAt?: string;
}
export interface RuleStore {
  rules: Rule[]; transactions: Record<string, LocalTransaction>; history: HistoryEntry[];
  executions: string[]; arrivals: Record<string, string[]>; messages: DraftMessage[]; notices: Notice[];
}
export const EMPTY_STORE: RuleStore = { rules: [], transactions: {}, history: [], executions: [], arrivals: {}, messages: [], notices: [] };
export const DEFAULT_MESSAGE_ASK = 'Ask them to confirm what this bill actually covers and whether it is coded to the right account.';
export const emptyTransaction = (): LocalTransaction => ({ flags: [], tags: [], owner: '', automatedCheck: false });
export const uid = () => crypto.randomUUID();

export function resetCompanyDemo(store: RuleStore, companyId: string): RuleStore {
  return {
    ...store,
    rules: store.rules.map(rule => rule.companyId === companyId ? { ...rule, enabled: false } : rule),
    transactions: Object.fromEntries(Object.entries(store.transactions).filter(([id]) => !id.startsWith(`${companyId}:`))),
    history: store.history.filter(entry => entry.companyId !== companyId),
    executions: store.executions.filter(key => !key.includes(`:${companyId}:`)),
    arrivals: { ...store.arrivals, [companyId]: [] },
    messages: (store.messages ?? []).filter(message => message.companyId !== companyId),
    notices: (store.notices ?? []).filter(notice => notice.companyId !== companyId),
  };
}

export function exampleRule(companyId: string): Rule {
  return { id: uid(), companyId, name: 'Memo needs clarification', revision: 1, enabled: false,
    expression: { id: uid(), type: 'all', children: [
      { id: uid(), type: 'ai', label: 'Standing overhead memo', text: 'The memo describes a standing overhead or monthly service charge.' },
      { id: uid(), type: 'not', children: [{ id: uid(), type: 'ai', label: 'Ongoing service or overhead', text: 'The line items describe an ongoing service or overhead charge rather than a purchase of physical goods.' }] },
    ] }, actions: [{ id: uid(), type: 'flag', value: 'Needs clarification' }, { id: uid(), type: 'assign', value: 'Bookkeeper' }] };
}
export const leaves = (node: RuleNode): (AICondition | StandardCondition)[] => 'children' in node ? node.children.flatMap(leaves) : [node];

// Semantic uncertainty is preserved under negation. Execution states never become booleans.
export function compose(type: Group['type'], values: Outcome[]): Outcome {
  if (!values.length || (type === 'not' && values.length !== 1)) return 'error';
  if (type === 'not') return values[0] === 'true' ? 'false' : values[0] === 'false' ? 'true' : values[0];
  if (type === 'all' && values.includes('false')) return 'false';
  if (type === 'any' && values.includes('true')) return 'true';
  if (values.includes('error')) return 'error';
  if (values.includes('pending')) return 'pending';
  if (values.includes('uncertain')) return 'uncertain';
  return type === 'all' ? 'true' : 'false';
}
export function evaluateTree(node: RuleNode, conditions: Record<string, Outcome>): Outcome {
  return 'children' in node ? compose(node.type, node.children.map(child => evaluateTree(child, conditions))) : conditions[node.id] ?? 'pending';
}
export function parseCents(value: string): number | null {
  const m = /^(-?)(\d+)(?:\.(\d{1,2}))?$/.exec(value.trim());
  if (!m) return null;
  const n = Number(m[2]) * 100 + Number((m[3] ?? '').padEnd(2, '0'));
  return Number.isSafeInteger(n) ? (m[1] ? -n : n) : null;
}
export function standardResult(node: StandardCondition, row: Row, reviewed: boolean): Truth {
  if (node.field === 'amountCents') {
    const n = parseCents(node.value);
    if (n === null) return 'uncertain';
    return (node.operator === 'gt' ? row.amountCents > n : node.operator === 'lt' ? row.amountCents < n : row.amountCents === n) ? 'true' : 'false';
  }
  const actual = node.field === 'review' ? (reviewed ? 'reviewed' : 'needs_review') : row[node.field];
  return actual === node.value ? 'true' : 'false';
}

/** Validate persisted JSON as well as drafts. Limit groups to three levels. */
export function validateRule(input: unknown): string[] {
  const errors: string[] = []; const ids = new Set<string>(); const r = input as Rule;
  if (!r || typeof r !== 'object') return ['Invalid rule'];
  if (typeof r.id !== 'string' || !r.id || typeof r.companyId !== 'string' || !r.companyId) errors.push('Rule and company IDs are required.');
  if (typeof r.name !== 'string' || !r.name.trim()) errors.push('Name the rule.');
  if (!Number.isSafeInteger(r.revision) || r.revision < 1 || typeof r.enabled !== 'boolean') errors.push('Invalid revision or enabled state.');
  const checkId = (id: unknown) => { if (typeof id !== 'string' || !id || ids.has(id)) errors.push('Every block needs a unique ID.'); else ids.add(id); };
  const visit = (n: RuleNode, depth: number) => {
    if (!n || typeof n !== 'object') { errors.push('Missing condition.'); return; }
    checkId(n.id);
    if (['all', 'any', 'not'].includes(n.type)) {
      const g = n as Group;
      if (depth > 3) { errors.push('Use at most three group levels.'); return; }
      if (!Array.isArray(g.children) || !g.children.length) { errors.push('Groups cannot be empty.'); return; }
      if (g.type === 'not' && g.children.length !== 1) errors.push('NOT requires exactly one child.');
      g.children.forEach(c => visit(c, depth + 1));
    } else if (n.type === 'ai') {
      if (typeof n.text !== 'string' || !n.text.trim()) errors.push('AI conditions need criterion text.');
      else if (n.text.length > 500) errors.push('AI conditions must be 500 characters or fewer.');
    } else if (n.type === 'standard') {
      if (!['amountCents', 'review', 'vendor', 'account'].includes(n.field) || !['gt', 'lt', 'eq'].includes(n.operator) || typeof n.value !== 'string' || !n.value.trim()) errors.push('Complete each standard condition.');
      else if (n.field === 'amountCents' && parseCents(n.value) === null) errors.push('Enter an amount with at most two decimal places.');
      else if (n.field !== 'amountCents' && n.operator !== 'eq') errors.push('Only amounts support greater than or less than.');
      else if (n.field === 'review' && !['reviewed', 'needs_review'].includes(n.value)) errors.push('Choose a valid review status.');
    } else errors.push('Unknown condition type.');
  };
  visit(r.expression, 1);
  if (!Array.isArray(r.actions) || !r.actions.length) errors.push('Choose at least one action.');
  else r.actions.forEach(a => {
    checkId(a.id);
    if (!['flag', 'assign', 'tag', 'pass', 'message'].includes(a.type) || (a.type !== 'pass' && (typeof a.value !== 'string' || !a.value.trim()))) errors.push('Complete each action.');
    else if (a.type === 'message' && a.value.length > 500) errors.push('Message requests must be 500 characters or fewer.');
    else if (a.type === 'message' && a.recipient !== 'jev' && !employeeById(a.recipient)) errors.push('Choose a message recipient or let Jev choose.');
    else if (a.type === 'message' && !employeeById(a.sender)) errors.push('Choose who the message is sent from.');
  });
  return [...new Set(errors)];
}

/** Message actions saved before recipients or senders existed default to letting Jev choose, sent from AP. */
export const migrateRule = (rule: Rule): Rule => ({ ...rule, actions: rule.actions.map(a => a.type === 'message' ? { ...a, recipient: a.recipient || 'jev', sender: a.sender || DEFAULT_SENDER } : a) });

// Content version includes all loaded evidence. Review status adds a local update version for execution.
export function transactionVersion(row: Row, reviewed?: boolean): string {
  const text = JSON.stringify([row, reviewed]); let a = 2166136261, b = 5381;
  for (let i = 0; i < text.length; i++) { a = Math.imul(a ^ text.charCodeAt(i), 16777619); b = Math.imul(b, 33) ^ text.charCodeAt(i); }
  return `${(a >>> 0).toString(16)}${(b >>> 0).toString(16)}`;
}
export const actionField = (a: Action): keyof LocalTransaction | null => a.type === 'message' ? null : ({ flag: 'flags', tag: 'tags', assign: 'owner', pass: 'automatedCheck' } as const)[a.type];
export const recipientLabel = (recipient?: string) => recipient === 'jev' ? 'Jev chooses recipient' : employeeById(recipient)?.name ?? 'No recipient';
export const actionLabel = (a: Action) => a.type === 'pass' ? 'Mark passed automated check' : a.type === 'message' ? `Draft message (${employeeById(a.sender)?.name ?? 'No sender'} → ${recipientLabel(a.recipient)}): ${a.value}` : `${{ flag: 'Add flag', tag: 'Add tag', assign: 'Assign to' }[a.type]}: ${a.value}`;

export const describeCondition = (n: AICondition | StandardCondition) => n.type === 'ai' ? n.label ? `${n.label}: ${n.text}` : n.text
  : `${{ amountCents: 'Amount', review: 'Review status', vendor: 'Vendor', account: 'Account' }[n.field]} ${{ gt: 'greater than', lt: 'less than', eq: 'equals' }[n.operator]} ${n.field === 'amountCents' ? `$${n.value}` : n.value}`;

const messageItem = (row: Row, rule: Rule, snapshot: Snapshot): MessageItem => ({ transactionId: row.id, billId: row.billId,
  context: leaves(rule.expression).map(n => ({ condition: describeCondition(n), kind: n.type, result: snapshot.conditions[n.id] as Truth })) });
/** The employee who approves and sends this draft; only they see it in Approvals. */
export const draftSender = (m: DraftMessage) => m.senderId ?? DEFAULT_SENDER;
export const messageBills = (m: DraftMessage) => m.items.length === 1 ? m.items[0].billId : `${m.items.length} bills`;
/** Back to un-generated: the recipient (if Jev routes) and text are produced again for the current items. */
const resetGeneration = (m: DraftMessage): DraftMessage => ({ ...m, subject: '', body: '', generation: 'pending', generationError: undefined,
  ...(m.routing === 'jev' ? { employeeId: null, to: 'Choosing recipient…', routingProbability: undefined } : {}) });
/** Older drafts covered a single bill. */
export function migrateMessage(m: DraftMessage & { transactionId?: string; billId?: string; context?: MessageContext[] }): DraftMessage {
  if (Array.isArray(m.items)) return m;
  const { transactionId, billId, context, ...rest } = m;
  return { ...rest, batchId: m.id, items: [{ transactionId: transactionId ?? '', billId: billId ?? '', context: context ?? [] }] };
}

/** Pending draft: Jev (if asked) picks the recipient and Gemini writes subject/body later, via completeDraft. */
export function createDraft(row: Row, rule: Rule, action: Action, snapshot: Snapshot, batchId: string = uid()): DraftMessage {
  const routing = action.recipient === 'jev' ? 'jev' : 'manual';
  const employee = routing === 'manual' ? employeeById(action.recipient) : undefined;
  return {
    id: uid(), companyId: row.companyId, items: [messageItem(row, rule, snapshot)], batchId,
    ruleId: rule.id, ruleName: rule.name, revision: rule.revision, actionId: action.id,
    to: employee?.name ?? 'Choosing recipient…', subject: '', body: '',
    reason: `Drafted by rule “${rule.name}” r${rule.revision}. Nothing has been sent.`,
    status: 'pending', edited: false, createdAt: new Date().toISOString(),
    request: action.value.trim() || DEFAULT_MESSAGE_ASK, routing, employeeId: employee?.id ?? null, senderId: action.sender ?? DEFAULT_SENDER,
    generation: 'pending',
  };
}

/** `sentFor` is the transaction IDs the request covered; a result for a since-changed set of bills is dropped. */
export function completeDraft(store: RuleStore, id: string, result: DraftResult | { error: string }, sentFor?: string[]): RuleStore {
  const current = (store.messages ?? []).find(message => message.id === id);
  // Undone or already completed while the request was in flight.
  if (!current || current.generation !== 'pending' || current.status !== 'pending') return store;
  if (sentFor && sentFor.join() !== current.items.map(i => i.transactionId).join()) return store;
  if ('error' in result) {
    return { ...store, messages: store.messages.map(m => m.id === id ? { ...m, generation: 'error', generationError: result.error } : m),
      notices: [notice(current.companyId, 'Could not draft message', `${messageBills(current)} · ${result.error}`, 'warn', current.items[0]?.transactionId), ...(store.notices ?? [])] };
  }
  const employee = employeeById(result.employeeId);
  if (!employee || (current.routing === 'manual' && employee.id !== current.employeeId)) return completeDraft(store, id, { error: 'Draft came back for an unknown recipient.' });
  const updated: DraftMessage = { ...current, to: employee.name, employeeId: employee.id, routingProbability: result.routingProbability, subject: result.subject, body: result.body, generation: 'ready', generationError: undefined };
  return { ...store, messages: store.messages.map(m => m.id === id ? updated : m),
    notices: [notice(current.companyId, `Draft message to ${employee.name}`, `${messageBills(current)} · ${current.ruleName}${current.routing === 'jev' ? ' · recipient chosen by Jev' : ''} · ready for approval`, 'info', current.items[0]?.transactionId), ...(store.notices ?? [])] };
}
export const retryDraft = (store: RuleStore, id: string): RuleStore =>
  ({ ...store, messages: (store.messages ?? []).map(m => m.id === id && m.generation === 'error' && m.status === 'pending' ? { ...m, generation: 'pending', generationError: undefined } : m) });

function notice(companyId: string, title: string, body: string | undefined, tone: NoticeTone, transactionId?: string): Notice {
  return { id: uid(), companyId, title, body, tone, time: new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }), read: false, toasted: false, transactionId };
}

export function decideMessage(store: RuleStore, id: string, status: Exclude<MessageStatus, 'pending'>, body?: string): { store: RuleStore; error?: string } {
  const current = (store.messages ?? []).find(message => message.id === id);
  if (!current || current.status !== 'pending') return { store, error: 'This draft is no longer pending.' };
  if (status === 'approved' && (current.generation ?? 'ready') !== 'ready') return { store, error: 'This draft is still being written.' };
  const nextBody = body ?? current.body;
  const edited = current.edited || nextBody !== current.body;
  const messages = (store.messages ?? []).map(message => message.id === id ? { ...message, status, body: nextBody, edited, decidedAt: new Date().toISOString() } : message);
  const title = status === 'approved' ? `Sent to ${current.to}` : `Rejected draft to ${current.to}`;
  const noticeBody = status === 'approved' ? `${messageBills(current)} · delivered to their inbox here — no email was delivered.` : `${messageBills(current)} · this draft will not be sent.`;
  return { store: { ...store, messages, notices: [notice(current.companyId, title, noticeBody, status === 'approved' ? 'good' : 'warn', current.items[0]?.transactionId), ...(store.notices ?? [])] } };
}

export function markNoticesRead(store: RuleStore, companyId?: string): RuleStore {
  return { ...store, notices: (store.notices ?? []).map(item => !companyId || item.companyId === companyId ? { ...item, read: true } : item) };
}
export function markNoticeToasted(store: RuleStore, id: string): RuleStore {
  return { ...store, notices: (store.notices ?? []).map(item => item.id === id ? { ...item, toasted: true } : item) };
}

/** Pure atomic state transition; its idempotency keys survive undo and page reloads. */
/** Pass the same `batchId` for every row of one run so its message actions share one draft per action. */
export function executeRule(store: RuleStore, rule: Rule, row: Row, version: string, snapshot: Snapshot, source: HistoryEntry['source'], batchId: string = uid()): RuleStore {
  if (validateRule(rule).length || row.companyId !== rule.companyId) return store;
  if (leaves(rule.expression).some(n => !['true', 'false', 'uncertain'].includes(snapshot.conditions[n.id])) || evaluateTree(rule.expression, snapshot.conditions) !== snapshot.result) return store;
  const prefix = `${rule.id}:${rule.revision}:${row.id}:${version}`;
  const executionKey = `${prefix}:evaluation:${source}`;
  if (store.executions.includes(executionKey)) return store;
  if (snapshot.result === 'pending' || snapshot.result === 'error' || Object.values(snapshot.conditions).some(v => v === 'pending' || v === 'error')) return store;
  let next: RuleStore = { ...store, transactions: { ...store.transactions }, history: [...store.history], executions: [...store.executions, executionKey], messages: [...(store.messages ?? [])], notices: [...(store.notices ?? [])] };
  const record = (key: string, action: Action | null, previous: unknown, resulting: unknown) => next.history.unshift({ id: uid(), key, ruleId: rule.id, ruleName: rule.name, revision: rule.revision, companyId: row.companyId, transactionId: row.id, transactionVersion: version, action: action ? structuredClone(action) : null, timestamp: new Date().toISOString(), previous, resulting, snapshot: { ...structuredClone(snapshot), expression: structuredClone(rule.expression) }, source });
  if (snapshot.result !== 'true') { if (source !== 'run') record(executionKey, null, null, snapshot.result); return next; }
  for (const action of rule.actions) {
    const key = `${prefix}:${action.id}`;
    if (next.executions.includes(key)) continue;
    next.executions.push(key);
    if (action.type === 'message') {
      const open = next.messages.find(m => m.batchId === batchId && m.ruleId === rule.id && m.revision === rule.revision && m.actionId === action.id
        && m.status === 'pending' && m.generation === 'pending' && m.items.length < MAX_MESSAGE_ITEMS);
      const draft = open ? { ...open, items: [...open.items, messageItem(row, rule, snapshot)] } : createDraft(row, rule, action, snapshot, batchId);
      next.messages = open ? next.messages.map(m => m.id === open.id ? draft : m) : [draft, ...next.messages];
      record(key, action, null, { id: draft.id, status: draft.status, recipient: action.recipient });
      continue;
    }
    const tx = { ...(next.transactions[row.id] ?? emptyTransaction()) }; const field = actionField(action)!;
    const previous = tx[field]; let resulting: unknown;
    if (field === 'flags' || field === 'tags') resulting = [...new Set([...(previous as string[]), action.value.trim()])];
    else resulting = field === 'owner' ? action.value.trim() : true;
    if (JSON.stringify(previous) === JSON.stringify(resulting)) continue;
    (tx as unknown as Record<string, unknown>)[field] = resulting;
    next.transactions[row.id] = tx;
    record(key, action, previous, resulting);
  }
  return next;
}
export function undoEntry(store: RuleStore, id: string): { store: RuleStore; error?: string } {
  const entry = store.history.find(h => h.id === id);
  if (!entry || !entry.action || entry.undoneAt) return { store, error: 'This entry cannot be undone.' };
  const history = store.history.map(h => h.id === id ? { ...h, undoneAt: new Date().toISOString() } : h);
  if (entry.action.type === 'message') {
    const resulting = entry.resulting as { id?: string } | null;
    const message = (store.messages ?? []).find(item => item.id === resulting?.id);
    if (!message || message.status !== 'pending') return { store, error: 'Undo conflict: this draft was already decided. The current value was preserved.' };
    // Drop this bill from the shared draft; the rest is re-drafted without it.
    const items = message.items.filter(item => item.transactionId !== entry.transactionId);
    const messages = items.length ? store.messages.map(m => m.id === message.id ? resetGeneration({ ...m, items }) : m) : store.messages.filter(m => m.id !== message.id);
    return { store: { ...store, messages, history } };
  }
  const field = actionField(entry.action)!; const tx = store.transactions[entry.transactionId] ?? emptyTransaction();
  if (JSON.stringify(tx[field]) !== JSON.stringify(entry.resulting)) return { store, error: 'Undo conflict: this value changed after the action. The current value was preserved.' };
  return { store: { ...store, transactions: { ...store.transactions, [entry.transactionId]: { ...tx, [field]: entry.previous } }, history } };
}
