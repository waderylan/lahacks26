import type { Row } from './types';

export type Truth = 'true' | 'false' | 'uncertain';
export type Outcome = Truth | 'pending' | 'error';
export type Group = { id: string; type: 'all' | 'any' | 'not'; children: RuleNode[] };
export type AICondition = { id: string; type: 'ai'; text: string; label: string };
export type StandardCondition = { id: string; type: 'standard'; field: 'amountCents' | 'review' | 'vendor' | 'account'; operator: 'gt' | 'lt' | 'eq'; value: string };
export type RuleNode = Group | AICondition | StandardCondition;
export type Action = { id: string; type: 'flag' | 'assign' | 'tag' | 'pass'; value: string };
export interface Rule {
  id: string; companyId: string; name: string; revision: number; enabled: boolean;
  expression: RuleNode; actions: Action[];
}
export interface LocalTransaction { flags: string[]; tags: string[]; owner: string; automatedCheck: boolean }
export interface Snapshot { result: Outcome; conditions: Record<string, Outcome>; expression?: RuleNode }
export interface HistoryEntry {
  id: string; key: string; ruleId: string; ruleName: string; revision: number;
  companyId: string; transactionId: string; transactionVersion: string; action: Action | null;
  timestamp: string; previous: unknown; resulting: unknown; snapshot: Snapshot;
  source: 'run' | 'arrival' | 'update'; undoneAt?: string;
}
export interface RuleStore { rules: Rule[]; transactions: Record<string, LocalTransaction>; history: HistoryEntry[]; executions: string[]; arrivals: Record<string, string[]> }
export const EMPTY_STORE: RuleStore = { rules: [], transactions: {}, history: [], executions: [], arrivals: {} };
export const emptyTransaction = (): LocalTransaction => ({ flags: [], tags: [], owner: '', automatedCheck: false });
export const uid = () => crypto.randomUUID();

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
  else r.actions.forEach(a => { checkId(a.id); if (!['flag', 'assign', 'tag', 'pass'].includes(a.type) || (a.type !== 'pass' && (typeof a.value !== 'string' || !a.value.trim()))) errors.push('Complete each action.'); });
  return [...new Set(errors)];
}

// Content version includes all loaded evidence. Review status adds a local update version for execution.
export function transactionVersion(row: Row, reviewed?: boolean): string {
  const text = JSON.stringify([row, reviewed]); let a = 2166136261, b = 5381;
  for (let i = 0; i < text.length; i++) { a = Math.imul(a ^ text.charCodeAt(i), 16777619); b = Math.imul(b, 33) ^ text.charCodeAt(i); }
  return `${(a >>> 0).toString(16)}${(b >>> 0).toString(16)}`;
}
export const actionField = (a: Action): keyof LocalTransaction => ({ flag: 'flags', tag: 'tags', assign: 'owner', pass: 'automatedCheck' } as const)[a.type];
export const actionLabel = (a: Action) => a.type === 'pass' ? 'Mark passed automated check' : `${{ flag: 'Add flag', tag: 'Add tag', assign: 'Assign to' }[a.type]}: ${a.value}`;

/** Pure atomic state transition; its idempotency keys survive undo and page reloads. */
export function executeRule(store: RuleStore, rule: Rule, row: Row, version: string, snapshot: Snapshot, source: HistoryEntry['source']): RuleStore {
  if (validateRule(rule).length || row.companyId !== rule.companyId) return store;
  if (leaves(rule.expression).some(n => !['true', 'false', 'uncertain'].includes(snapshot.conditions[n.id])) || evaluateTree(rule.expression, snapshot.conditions) !== snapshot.result) return store;
  const prefix = `${rule.id}:${rule.revision}:${row.id}:${version}`;
  const executionKey = `${prefix}:evaluation:${source}`;
  if (store.executions.includes(executionKey)) return store;
  if (snapshot.result === 'pending' || snapshot.result === 'error' || Object.values(snapshot.conditions).some(v => v === 'pending' || v === 'error')) return store;
  let next: RuleStore = { ...store, transactions: { ...store.transactions }, history: [...store.history], executions: [...store.executions, executionKey] };
  const record = (key: string, action: Action | null, previous: unknown, resulting: unknown) => next.history.unshift({ id: uid(), key, ruleId: rule.id, ruleName: rule.name, revision: rule.revision, companyId: row.companyId, transactionId: row.id, transactionVersion: version, action: action ? structuredClone(action) : null, timestamp: new Date().toISOString(), previous, resulting, snapshot: { ...structuredClone(snapshot), expression: structuredClone(rule.expression) }, source });
  if (snapshot.result !== 'true') { if (source !== 'run') record(executionKey, null, null, snapshot.result); return next; }
  for (const action of rule.actions) {
    const key = `${prefix}:${action.id}`;
    if (next.executions.includes(key)) continue;
    const tx = { ...(next.transactions[row.id] ?? emptyTransaction()) }; const field = actionField(action);
    const previous = tx[field]; let resulting: unknown;
    if (field === 'flags' || field === 'tags') resulting = [...new Set([...(previous as string[]), action.value.trim()])];
    else resulting = field === 'owner' ? action.value.trim() : true;
    next.executions.push(key);
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
  const field = actionField(entry.action); const tx = store.transactions[entry.transactionId] ?? emptyTransaction();
  if (JSON.stringify(tx[field]) !== JSON.stringify(entry.resulting)) return { store, error: 'Undo conflict: this value changed after the action. The current value was preserved.' };
  return { store: { ...store, transactions: { ...store.transactions, [entry.transactionId]: { ...tx, [field]: entry.previous } }, history: store.history.map(h => h.id === id ? { ...h, undoneAt: new Date().toISOString() } : h) } };
}
