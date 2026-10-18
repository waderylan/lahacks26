import {
  EMPTY_STORE, completeDraft, decideMessage, emptyTransaction, evaluateTree, executeRule, leaves,
  markNoticesRead, markNoticeToasted, migrateMessage, migrateRule, resetCompanyDemo, retryDraft,
  transactionVersion, undoEntry, uid, validateRule, draftSender, actionsForOutcome,
  type DraftMessage, type DraftResult, type LocalTransaction, type Outcome, type Rule, type RuleStore, type Snapshot, type RuleIssue, type HistoryEntry,
} from '../src/rules.ts';
import { standardResult } from '../src/rules.ts';
import type { Row } from '../src/types.ts';
import type { ActionStore } from './actionStore.ts';
import { emptyDashboard } from './actionStore.ts';
import type { WorkspaceData } from './workspaceData.ts';
import type { Judge } from './actionEngine.ts';
import { draftMessage, type DraftRequest } from './messages.ts';
import { deliverDraft } from './mailbox.ts';
import { employeeById } from '../src/employees.ts';
import type { ReviewTask } from '../src/actionTypes.ts';

interface SavedState { companyId: string; store: RuleStore; watches: Record<string, Record<string, string>>; log: string[] }
type Writer = (request: DraftRequest, signal?: AbortSignal) => Promise<DraftResult>;
const version = (row: Row) => {
  // Actions must not invalidate their own execution keys or trigger a message loop.
  const { dashboard, sourceVersion: _, workspaceChanges: __, ...evidence } = row;
  return transactionVersion(evidence as Row, Boolean(dashboard?.reviewed));
};
const metadata = (row: Row): LocalTransaction => {
  const d = row.dashboard ?? emptyDashboard();
  return { owner: d.owner, flags: d.flags, tags: d.tags, automatedCheck: d.automatedCheck };
};
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const itemKey = (message: DraftMessage) => JSON.stringify(message.items);

export class RuleService {
  private drafting = new Set<string>();
  private scanning = false;
  constructor(readonly db: ActionStore, readonly data: WorkspaceData, private judge: Judge, private writer: Writer = draftMessage) {}

  private read(companyId: string): SavedState {
    const saved = this.db.get<SavedState>('rule-state', companyId) ?? { companyId, store: structuredClone(EMPTY_STORE), watches: {}, log: [] };
    // One source for owner/flags/tags/pass: the same working bill used by dashboard actions.
    saved.store.rules = saved.store.rules.map(migrateRule);
    saved.store.transactions = Object.fromEntries(this.data.bills(companyId).rows.map(row => [row.id, metadata(row)] as const)
      .filter(([, value]) => value.owner || value.flags.length || value.tags.length || value.automatedCheck));
    return saved;
  }
  private persist(saved: SavedState, previous: RuleStore) {
    for (const id of new Set([...Object.keys(previous.transactions), ...Object.keys(saved.store.transactions)])) {
      const before = previous.transactions[id] ?? emptyTransaction(), after = saved.store.transactions[id] ?? emptyTransaction();
      if (same(before, after)) continue;
      const row = this.data.row(saved.companyId, id);
      this.db.write({ ...row, dashboard: { ...emptyDashboard(), ...row.dashboard, ...after } }, row.sourceVersion!);
    }
    const previousHistory = new Set(previous.history.map(entry => entry.id));
    for (const entry of saved.store.history.filter(entry => entry.action?.type === 'task' && !entry.undoneAt && !previousHistory.has(entry.id))) {
      const task = entry.resulting as ReviewTask;
      this.db.put('task', task.id, saved.companyId, task);
      const row = this.data.row(saved.companyId, entry.transactionId);
      this.db.write({ ...row, dashboard: { ...emptyDashboard(), ...row.dashboard, taskIds: [...new Set([...(row.dashboard?.taskIds ?? []), task.id])] } }, row.sourceVersion!);
    }
    for (const message of saved.store.messages) {
      const before = previous.messages.find(item => item.id === message.id);
      if (before && itemKey(before) === itemKey(message)) continue;
      const existing = this.db.get<Record<string, Row>>('message-evidence', message.id) ?? {};
      const evidence = Object.fromEntries(message.items.map(item => [item.transactionId, existing[item.transactionId] ?? this.data.row(saved.companyId, item.transactionId)]));
      this.db.put('message-evidence', message.id, saved.companyId, evidence);
    }
    this.db.put('rule-state', saved.companyId, saved.companyId, saved);
  }
  private change<T>(companyId: string, update: (saved: SavedState) => T): T {
    this.data.bills(companyId);
    return this.db.atomic(() => { const saved = this.read(companyId), before = structuredClone(saved.store); const result = update(saved); this.persist(saved, before); return result; });
  }
  snapshot(companyId: string) {
    const saved = this.read(companyId);
    const rows = this.data.bills(companyId).rows.map(({ id, companyId, dashboard, sourceVersion, account, memo, workspaceChanges, evidence }) => ({ id, companyId, dashboard, sourceVersion, account, memo, workspaceChanges, evidence }));
    return { store: saved.store, automation: saved.log, rows, issues: this.db.list<RuleIssue>('rule-issue', companyId) };
  }

  private trackIssue(saved: SavedState, rule: Rule, row: Row, snapshot: Snapshot, before: RuleStore, cycle: string) {
    if (snapshot.result !== 'true' && snapshot.result !== 'uncertain') return;
    const all = this.db.list<RuleIssue>('rule-issue', saved.companyId);
    const conditionKey = JSON.stringify(rule.expression);
    let issue = all.find(issue => issue.ruleId === rule.id && issue.transactionId === row.id && issue.conditionKey === conditionKey && issue.status === 'open');
    const previousKeys = new Set(before.executions);
    const ran = saved.store.executions.filter(key => !previousKeys.has(key));
    const actions = actionsForOutcome(rule, snapshot.result).filter(action => ran.some(key => key.endsWith(`:${action.id}`)));
    if (!issue && !actions.some(action => action.type === 'flag' || action.type === 'task')) return;
    issue ??= { id: uid(), companyId: saved.companyId, ruleId: rule.id, ruleName: rule.name, transactionId: row.id, conditionKey, cycle,
      openedAt: new Date().toISOString(), status: 'open', lastResult: snapshot.result, flags: [], taskIds: [] };
    issue.lastResult = snapshot.result;
    issue.ruleName = rule.name;
    for (const action of actions) {
      if (action.type === 'flag' && !issue.flags.some(flag => flag.label === action.value.trim())) {
        const label = action.value.trim();
        const otherClaim = all.some(other => other.status === 'open' && other.transactionId === row.id && other.flags.some(flag => flag.label === label && flag.removable));
        issue.flags.push({ label, removable: !row.dashboard?.flags.includes(label) || otherClaim });
      }
      if (action.type === 'task') {
        const tasks = [...this.db.list<ReviewTask>('task', saved.companyId), ...saved.store.history.filter(entry => entry.action?.type === 'task' && !entry.undoneAt).map(entry => entry.resulting as ReviewTask)];
        issue.taskIds = [...new Set([...issue.taskIds, ...tasks.filter(task => task.ruleId === rule.id && task.ruleActionId === action.id && task.billId === row.id && task.status === 'open').map(task => task.id)])];
      }
    }
    this.db.put('rule-issue', issue.id, saved.companyId, issue);
  }

  private resolveIssues(saved: SavedState, rule: Rule, row: Row, snapshot: Snapshot, source: HistoryEntry['source']) {
    if (!rule.autoResolve || snapshot.result !== 'false') return;
    const all = this.db.list<RuleIssue>('rule-issue', saved.companyId);
    const candidates = all.filter(issue => issue.ruleId === rule.id && issue.transactionId === row.id && issue.conditionKey === JSON.stringify(rule.expression) && issue.status === 'open');
    for (const issue of candidates) {
      const flags: string[] = [], taskIds: string[] = [], kept: string[] = [];
      const transaction = { ...(saved.store.transactions[row.id] ?? emptyTransaction()) };
      for (const flag of issue.flags) {
        if (!transaction.flags.includes(flag.label)) continue;
        const claimedElsewhere = all.some(other => other.id !== issue.id && other.status === 'open' && other.transactionId === row.id && other.flags.some(claim => claim.label === flag.label));
        if (!flag.removable || claimedElsewhere) { kept.push(`Kept flag: ${flag.label}`); continue; }
        transaction.flags = transaction.flags.filter(label => label !== flag.label); flags.push(flag.label);
      }
      for (const id of issue.taskIds) {
        const task = this.db.get<ReviewTask>('task', id);
        if (!task || task.companyId !== saved.companyId || task.ruleId !== rule.id || task.billId !== row.id || task.status !== 'open') continue;
        if (task.updatedAt !== task.createdAt) { kept.push(`Kept task changed by a reviewer: ${task.title}`); continue; }
        this.db.put('task', task.id, saved.companyId, { ...task, status: 'done', updatedAt: new Date().toISOString() }); taskIds.push(task.id);
      }
      saved.store = { ...saved.store, transactions: { ...saved.store.transactions, [row.id]: transaction }, history: [{
        id: uid(), key: `${issue.id}:resolved`, ruleId: rule.id, ruleName: rule.name, revision: rule.revision, companyId: saved.companyId,
        transactionId: row.id, transactionVersion: version(row), action: null, timestamp: new Date().toISOString(), source,
        previous: issue.lastResult, resulting: 'false', snapshot: { ...structuredClone(snapshot), expression: structuredClone(rule.expression) },
        resolution: { issueId: issue.id, flags, taskIds, kept },
      }, ...saved.store.history] };
      issue.status = 'resolved'; issue.lastResult = 'false'; issue.resolvedAt = new Date().toISOString();
      this.db.put('rule-issue', issue.id, saved.companyId, issue);
    }
  }
  save(companyId: string, input: Rule, expectedRevision: number | null, activate = false) {
    const errors = validateRule(input);
    if (errors.length || input.companyId !== companyId || typeof input.name !== 'string' || !input.name.trim() || input.name.length > 200 || typeof activate !== 'boolean' ||
      input.actions.some(action => action.type !== 'message' && typeof action.value === 'string' && action.value.length > 100)) throw new Error(errors[0] ?? 'Invalid rule for this company.');
    this.change(companyId, saved => {
      const old = saved.store.rules.find(rule => rule.id === input.id);
      if ((old?.revision ?? null) !== expectedRevision) throw new Error('Rule changed in another session. Reload the saved rule before saving.');
      const enabled = activate || Boolean(old?.enabled);
      const next = { ...structuredClone(input), enabled, revision: old ? old.revision + 1 : 1 };
      saved.store.rules = [...saved.store.rules.filter(rule => rule.id !== next.id), next];
      if (enabled) saved.watches[next.id] = Object.fromEntries(this.data.bills(companyId).rows.map(row => [row.id, version(row)]));
    });
  }
  toggle(companyId: string, id: string, revision: number, enabled: boolean) {
    if (typeof enabled !== 'boolean') throw new Error('Choose whether the rule is enabled.');
    this.change(companyId, saved => {
      const rule = saved.store.rules.find(rule => rule.id === id);
      if (!rule || rule.revision !== revision) throw new Error('Saved rule changed. Refresh before enabling it.');
      rule.enabled = enabled;
      if (enabled) saved.watches[id] = Object.fromEntries(this.data.bills(companyId).rows.map(row => [row.id, version(row)]));
    });
  }
  private async evaluate(companyId: string, rule: Rule, rows: Row[]): Promise<Record<string, Snapshot>> {
    const results: Record<string, Record<string, Outcome>> = Object.fromEntries(rows.map(row => [row.id, {}]));
    await Promise.all(leaves(rule.expression).map(async node => {
      if (node.type === 'standard') rows.forEach(row => { results[row.id][node.id] = standardResult(node, row, Boolean(row.dashboard?.reviewed)); });
      else { const judgments = await this.judge(companyId, node.text, rows); rows.forEach(row => {
        const result = judgments[row.id];
        if (!['match', 'no_match', 'uncertain'].includes(result)) throw new Error('Incomplete condition results. Retry the rule.');
        results[row.id][node.id] = ({ match: 'true', no_match: 'false', uncertain: 'uncertain' } as const)[result];
      }); }
    }));
    return Object.fromEntries(rows.map(row => [row.id, { conditions: results[row.id], result: evaluateTree(rule.expression, results[row.id]) }]));
  }
  async run(companyId: string, id: string, revision: number, ids: string[], source: 'run' | 'arrival' | 'update' = 'run') {
    if (!Array.isArray(ids) || !ids.length || ids.length > 1000) throw new Error('Choose 1-1000 bills for this run.');
    const rule = this.read(companyId).store.rules.find(rule => rule.id === id);
    if (!rule || rule.revision !== revision || (source !== 'run' && !rule.enabled)) throw new Error('Saved rule changed. Refresh before running.');
    const rows = [...new Set(ids)].map(id => this.data.row(companyId, id));
    const snapshots = await this.evaluate(companyId, rule, rows);
    this.change(companyId, saved => {
      const current = saved.store.rules.find(item => item.id === id);
      if (!current || !same(current, rule) || (source !== 'run' && !current.enabled)) throw new Error('Rule changed during evaluation. No actions applied.');
      if (rows.some(row => this.data.row(companyId, row.id).sourceVersion !== row.sourceVersion)) throw new Error('Bills changed during evaluation. Retry against the latest values.');
      const batchId = uid();
      for (const row of rows) {
        const snapshot = snapshots[row.id];
        const issues = this.db.list<RuleIssue>('rule-issue', companyId).filter(issue => issue.ruleId === rule.id && issue.transactionId === row.id && issue.conditionKey === JSON.stringify(rule.expression));
        const open = issues.find(issue => issue.status === 'open');
        const cycle = open?.cycle ?? issues.filter(issue => issue.status === 'resolved').sort((a, b) => b.resolvedAt!.localeCompare(a.resolvedAt!))[0]?.id ?? '';
        this.resolveIssues(saved, rule, row, snapshot, source);
        const before = saved.store;
        const executionVersion = version(row) + (snapshot.result !== 'false' && cycle ? `:cycle:${cycle}` : '');
        saved.store = executeRule(saved.store, rule, row, executionVersion, snapshot, source, batchId, this.db.list<ReviewTask>('task', companyId));
        this.trackIssue(saved, rule, row, snapshot, before, cycle);
        if (source !== 'run') (saved.watches[id] ??= {})[row.id] = version(row);
      }
      const counts = ['true', 'uncertain', 'false'].map(result => rows.filter(row => snapshots[row.id].result === result).length);
      const actedOn = rows.filter(row => actionsForOutcome(rule, snapshots[row.id].result).length).length;
      saved.log = [`${source === 'run' ? 'Run once' : source === 'arrival' ? 'Replay' : 'Updated transactions'}: ${counts[0]} match, ${counts[1]} not enough information, ${counts[2]} no match. Actions configured for ${actedOn} transactions.`, ...saved.log].slice(0, 20);
    });
    void this.drainDrafts();
  }
  async replay(companyId: string) {
    const full = this.data.bills(companyId), reserved = full.company.scenario ? [] : full.rows.slice(-5);
    const state = this.read(companyId), row = reserved.find(row => !(state.store.arrivals[companyId] ?? []).includes(row.id));
    if (!row) throw new Error('No reserved bills remain.');
    this.change(companyId, saved => { saved.store.arrivals[companyId] = [...new Set([...(saved.store.arrivals[companyId] ?? []), row.id])]; });
    for (const rule of state.store.rules.filter(rule => rule.enabled)) await this.run(companyId, rule.id, rule.revision, [row.id], 'arrival');
    return row;
  }
  undo(companyId: string, id: string) {
    this.change(companyId, saved => {
      const entry = saved.store.history.find(entry => entry.id === id);
      if (entry?.action?.type === 'task') {
        const task = this.db.get<ReviewTask>('task', (entry.resulting as ReviewTask).id);
        if (!task || task.companyId !== companyId || task.status !== 'open' || task.updatedAt !== task.createdAt) throw new Error('Undo conflict: this task changed after creation.');
        this.db.put('task', task.id, companyId, { ...task, status: 'cancelled', updatedAt: new Date().toISOString() });
        const row = this.data.row(companyId, entry.transactionId);
        this.db.write({ ...row, dashboard: { ...emptyDashboard(), ...row.dashboard, taskIds: (row.dashboard?.taskIds ?? []).filter(id => id !== task.id) } }, row.sourceVersion!);
      }
      const result = undoEntry(saved.store, id); if (result.error) throw new Error(result.error); saved.store = result.store;
      if (entry?.action?.type === 'flag') for (const issue of this.db.list<RuleIssue>('rule-issue', companyId).filter(issue => issue.transactionId === entry.transactionId && issue.ruleId === entry.ruleId && issue.status === 'open')) {
        issue.flags = issue.flags.filter(flag => flag.label !== entry.action!.value); this.db.put('rule-issue', issue.id, companyId, issue);
      }
    });
    void this.drainDrafts();
  }
  updateMetadata(companyId: string, id: string, input: LocalTransaction, expectedVersion: string) {
    if (!input || typeof input.owner !== 'string' || input.owner.length > 100 || typeof input.automatedCheck !== 'boolean' ||
      ![input.flags, input.tags].every(values => Array.isArray(values) && values.length <= 100 && values.every(value => typeof value === 'string' && value.length <= 100))) throw new Error('Invalid bill metadata.');
    this.change(companyId, saved => {
      if (this.data.row(companyId, id).sourceVersion !== expectedVersion) throw new Error('Bill changed in another session. Reload before editing.');
      saved.store.transactions[id] = { owner: input.owner, flags: [...new Set(input.flags)], tags: [...new Set(input.tags)], automatedCheck: input.automatedCheck };
      for (const issue of this.db.list<RuleIssue>('rule-issue', companyId).filter(issue => issue.transactionId === id && issue.status === 'open')) {
        issue.flags = issue.flags.filter(flag => input.flags.includes(flag.label)); this.db.put('rule-issue', issue.id, companyId, issue);
      }
    });
  }
  addEvidence(companyId: string, id: string, title: unknown, text: unknown, expectedVersion: unknown) {
    if (typeof title !== 'string' || !title.trim() || title.length > 160 || typeof text !== 'string' || !text.trim() || text.length > 8000) throw new Error('Add a title and supporting details (up to 8,000 characters).');
    this.data.bills(companyId);
    this.db.atomic(() => {
      const row = this.data.row(companyId, id);
      if (row.sourceVersion !== expectedVersion) throw new Error('This transaction changed. Check the latest details before saving.');
      const evidence = { id: uid(), kind: 'reviewer_note', date: new Date().toISOString(), title: title.trim(), text: text.trim() };
      this.db.write({ ...row, evidence: [...(row.evidence ?? []), evidence] }, row.sourceVersion!);
    });
  }
  /** Approving delivers the draft to its recipient's inbox, sent from `actor` (the employee who approved it). */
  decide(companyId: string, id: string, status: 'approved' | 'rejected', body?: string, expectedBody?: string, actor?: string) {
    if (!['approved', 'rejected'].includes(status) || (body !== undefined && (typeof body !== 'string' || !body.trim() || body.length > 8000))) throw new Error('Choose a valid message decision and body.');
    if (!employeeById(actor)) throw new Error('Choose which employee is sending this message.');
    this.change(companyId, saved => {
      const message = saved.store.messages.find(message => message.id === id);
      if (!message || (expectedBody !== undefined && message.body !== expectedBody)) throw new Error('Message changed in another session. Refresh before approving.');
      if (draftSender(message) !== actor) throw new Error(`Only ${employeeById(draftSender(message))?.name ?? 'the sender'} can approve or reject this draft.`);
      const result = decideMessage(saved.store, id, status, body); if (result.error) throw new Error(result.error); saved.store = result.store;
      if (status === 'approved') deliverDraft(this.db, saved.store.messages.find(message => message.id === id)!, actor!);
    });
  }
  retry(companyId: string, id: string) {
    this.change(companyId, saved => { if (!saved.store.messages.some(message => message.id === id)) throw new Error('Message not found.'); saved.store = retryDraft(saved.store, id); this.db.put('draft-job', id, companyId, { attempts: 0, nextAt: 0 }); });
    void this.drainDrafts();
  }
  notices(companyId: string, id?: string) {
    this.change(companyId, saved => { saved.store = id ? markNoticeToasted(saved.store, id) : markNoticesRead(saved.store, companyId); });
  }
  reset(companyId: string, full = false) {
    this.change(companyId, saved => {
      saved.store = full ? resetCompanyDemo(saved.store, companyId) : { ...saved.store, transactions: {}, history: [], executions: [], messages: [], notices: [] };
      if (full) { saved.watches = {}; for (const row of this.data.bills(companyId).rows.filter(row => row.dashboard?.reviewed)) this.db.write({ ...row, dashboard: { ...row.dashboard!, reviewed: false } }, row.sourceVersion!); }
      saved.log = [];
      this.db.removeAll('mail', companyId);
      this.db.removeAll('rule-issue', companyId);
    });
  }
  importLegacy(companyId: string, legacy: RuleStore, reviewed: string[] = []) {
    this.data.bills(companyId);
    if (this.db.get('rule-state', companyId)) return false; // Never overwrite shared state from a later browser.
    const rules = (legacy.rules ?? []).filter(rule => rule.companyId === companyId).map(migrateRule);
    if (rules.some(rule => validateRule(rule).length)) throw new Error('Legacy rules are invalid; browser data was preserved.');
    const messages = (legacy.messages ?? []).filter(message => message.companyId === companyId).map(migrateMessage);
    for (const message of messages) for (const item of message.items) this.data.row(companyId, item.transactionId);
    this.change(companyId, saved => {
      saved.store = { rules, transactions: { ...saved.store.transactions }, messages, notices: (legacy.notices ?? []).filter(notice => notice.companyId === companyId),
        history: (legacy.history ?? []).filter(entry => entry.companyId === companyId), executions: (legacy.executions ?? []).filter(key => rules.some(rule => key.startsWith(`${rule.id}:`))),
        arrivals: { [companyId]: (legacy.arrivals?.[companyId] ?? []).filter(id => this.db.row(companyId, id)) } };
      for (const row of this.data.bills(companyId).rows) {
        if (row.sourceVersion !== '0') continue; // Dashboard edits take priority over an old browser copy.
        if (legacy.transactions?.[row.id]) saved.store.transactions[row.id] = legacy.transactions[row.id];
        if (reviewed.includes(row.id)) this.db.write({ ...row, dashboard: { ...row.dashboard!, reviewed: true } }, row.sourceVersion!);
      }
      for (const rule of rules.filter(rule => rule.enabled)) saved.watches[rule.id] = Object.fromEntries(this.data.bills(companyId).rows.map(row => [row.id, version(row)]));
    });
    return true;
  }
  async scan() {
    if (this.scanning) return; this.scanning = true;
    try {
      for (const stored of this.db.list<SavedState>('rule-state')) {
        const { companyId } = stored;
        for (const rule of stored.store.rules.filter(rule => rule.enabled)) {
          const current = this.read(companyId), watched = current.watches[rule.id];
          const reserved = this.data.bills(companyId).rows.slice(-5).map(row => row.id);
          const rows = this.data.bills(companyId).rows.filter(row => !reserved.includes(row.id) || current.store.arrivals[companyId]?.includes(row.id));
          if (!watched) { this.change(companyId, saved => { saved.watches[rule.id] = Object.fromEntries(rows.map(row => [row.id, version(row)])); }); continue; }
          const changed = rows.filter(row => watched[row.id] !== version(row));
          if (!changed.length) continue;
          try { await this.run(companyId, rule.id, rule.revision, changed.map(row => row.id), 'update'); }
          catch (error) { this.change(companyId, saved => { saved.log = [`${rule.name}: ${(error as Error).message}`, ...saved.log].slice(0, 20); }); }
        }
      }
    } finally { this.scanning = false; }
  }
  async drainDrafts() {
    const work: Promise<void>[] = [];
    for (const saved of this.db.list<SavedState>('rule-state')) for (const message of saved.store.messages) {
      if (this.drafting.size >= 3 || this.drafting.has(message.id) || message.status !== 'pending' || message.generation !== 'pending') continue;
      const job = this.db.get<{ attempts: number; nextAt: number }>('draft-job', message.id) ?? { attempts: 0, nextAt: 0 };
      if (job.nextAt > Date.now()) continue;
      this.drafting.add(message.id);
      work.push(this.generate(saved.companyId, message, job.attempts).finally(() => this.drafting.delete(message.id)));
    }
    await Promise.allSettled(work);
  }
  private async generate(companyId: string, message: DraftMessage, attempts: number) {
    const ids = message.items.map(item => item.transactionId);
    try {
      const company = this.data.bills(companyId).company;
      const evidence = this.db.get<Record<string, Row>>('message-evidence', message.id) ?? {};
      const result = await this.writer({ company: { name: company.name.replace(/ \u2014 review scenarios$/, ''), industry: company.industry },
        request: message.request ?? '', recipient: message.routing === 'jev' ? 'jev' : message.employeeId ?? '', outcome: message.outcome ?? 'true',
        bills: message.items.map(item => ({ row: evidence[item.transactionId] ?? this.data.row(companyId, item.transactionId), context: item.context })) }, AbortSignal.timeout(90_000));
      this.change(companyId, saved => { if (saved.store.messages.some(current => current.id === message.id && itemKey(current) === itemKey(message))) saved.store = completeDraft(saved.store, message.id, result, ids); });
    } catch (error) {
      this.change(companyId, saved => {
        const current = saved.store.messages.find(current => current.id === message.id);
        if (!current || itemKey(current) !== itemKey(message) || current.status !== 'pending' || current.generation !== 'pending') return;
        const reason = (error as Error).message;
        if (/quota|rate.?limit|high demand|overloaded/i.test(reason) && attempts < 3) this.db.put('draft-job', message.id, companyId, { attempts: attempts + 1, nextAt: Date.now() + 15000 * (attempts + 1) });
        else saved.store = completeDraft(saved.store, message.id, { error: reason }, ids);
      });
    }
  }
}
