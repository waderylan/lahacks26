import {
  EMPTY_STORE, completeDraft, decideMessage, emptyTransaction, evaluateTree, executeRule, leaves,
  markNoticesRead, markNoticeToasted, migrateMessage, migrateRule, resetCompanyDemo, retryDraft,
  transactionVersion, undoEntry, uid, validateRule,
  type DraftMessage, type DraftResult, type LocalTransaction, type Outcome, type Rule, type RuleStore, type Snapshot,
} from '../src/rules.ts';
import { standardResult } from '../src/rules.ts';
import type { Row } from '../src/types.ts';
import type { ActionStore } from './actionStore.ts';
import { emptyDashboard } from './actionStore.ts';
import type { WorkspaceData } from './workspaceData.ts';
import type { Judge } from './actionEngine.ts';
import { draftMessage, type DraftRequest } from './messages.ts';

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
    const rows = this.data.bills(companyId).rows.map(({ id, companyId, dashboard, sourceVersion, account, memo, workspaceChanges }) => ({ id, companyId, dashboard, sourceVersion, account, memo, workspaceChanges }));
    return { store: saved.store, automation: saved.log, rows };
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
        saved.store = executeRule(saved.store, rule, row, version(row), snapshots[row.id], source, batchId);
        if (source !== 'run') (saved.watches[id] ??= {})[row.id] = version(row);
      }
      saved.log = [`${source === 'run' ? 'Run once' : source === 'arrival' ? 'Replay' : 'Updated bills'}: ${rows.filter(row => snapshots[row.id].result === 'true').length}/${rows.length} matched; actions saved in SQLite.`, ...saved.log].slice(0, 20);
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
    this.change(companyId, saved => { const result = undoEntry(saved.store, id); if (result.error) throw new Error(result.error); saved.store = result.store; });
    void this.drainDrafts();
  }
  updateMetadata(companyId: string, id: string, input: LocalTransaction, expectedVersion: string) {
    if (!input || typeof input.owner !== 'string' || input.owner.length > 100 || typeof input.automatedCheck !== 'boolean' ||
      ![input.flags, input.tags].every(values => Array.isArray(values) && values.length <= 100 && values.every(value => typeof value === 'string' && value.length <= 100))) throw new Error('Invalid bill metadata.');
    this.change(companyId, saved => {
      if (this.data.row(companyId, id).sourceVersion !== expectedVersion) throw new Error('Bill changed in another session. Reload before editing.');
      saved.store.transactions[id] = { owner: input.owner, flags: [...new Set(input.flags)], tags: [...new Set(input.tags)], automatedCheck: input.automatedCheck };
    });
  }
  decide(companyId: string, id: string, status: 'approved' | 'rejected', body?: string, expectedBody?: string) {
    if (!['approved', 'rejected'].includes(status) || (body !== undefined && (typeof body !== 'string' || !body.trim() || body.length > 8000))) throw new Error('Choose a valid message decision and body.');
    this.change(companyId, saved => {
      const message = saved.store.messages.find(message => message.id === id);
      if (!message || (expectedBody !== undefined && message.body !== expectedBody)) throw new Error('Message changed in another session. Refresh before approving.');
      const result = decideMessage(saved.store, id, status, body); if (result.error) throw new Error(result.error); saved.store = result.store;
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
        request: message.request ?? '', recipient: message.routing === 'jev' ? 'jev' : message.employeeId ?? '',
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
