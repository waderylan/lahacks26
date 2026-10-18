import crypto from 'node:crypto';
import type { ActionItem, ActionPlan, ActionSelection, BillAction, ReviewTask, ServerAutomation } from '../src/actionTypes.ts';
import type { Row } from '../src/types.ts';
import { evaluateTree, leaves, standardResult, validateRule, type Outcome } from '../src/rules.ts';
import type { ActionStore } from './actionStore.ts';
import { emptyDashboard } from './actionStore.ts';
import type { WorkspaceData } from './workspaceData.ts';

export type Judge = (companyId: string, criterion: string, rows: Row[], provider?: 'jev' | 'qwen') => Promise<Record<string, 'match' | 'no_match' | 'uncertain'>>;
const now = () => new Date().toISOString();
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
export function validateAction(input: unknown): BillAction {
  const action = input as BillAction;
  const text = (value: unknown, max: number) => typeof value === 'string' && Boolean(value.trim()) && value.length <= max;
  if (!action || typeof action !== 'object') throw new Error('Choose an action.');
  if (action.type === 'task' && text(action.title, 200) && text(action.owner, 100) && typeof action.dueDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(action.dueDate) && !Number.isNaN(Date.parse(`${action.dueDate}T12:00:00Z`)) && new Date(`${action.dueDate}T12:00:00Z`).toISOString().slice(0, 10) === action.dueDate) return { ...action, title: action.title.trim(), owner: action.owner.trim() };
  if (action.type === 'memo' && text(action.text, 4000)) return { ...action, text: action.text.trim() };
  if (action.type === 'category' && text(action.accountId, 200)) return action;
  if (action.type === 'assign' && text(action.owner, 100)) return { ...action, owner: action.owner.trim() };
  if ((action.type === 'flag' || action.type === 'tag') && text(action.label, 100)) return { ...action, label: action.label.trim() };
  if (action.type === 'review' && typeof action.reviewed === 'boolean') return action;
  throw new Error('Complete the action fields. Tasks need a title, owner, and valid due date.');
}
export class ActionEngine {
  private scanning = false;
  constructor(readonly store: ActionStore, readonly data: WorkspaceData, private judge: Judge) {}
  private async matches(companyId: string, rows: Row[], selection: ActionSelection): Promise<Record<string, Outcome>> {
    if (selection.scope === 'selected') return Object.fromEntries(rows.map(row => [row.id, 'true']));
    if (selection.expression) {
      const rule = { id: 'validation', companyId, name: 'Search', revision: 1, enabled: false, expression: selection.expression, actions: [{ id: 'validation-action', type: 'pass', value: '' }] };
      const errors = validateRule(rule); if (errors.length) throw new Error(errors[0]);
      const conditions: Record<string, Record<string, Outcome>> = Object.fromEntries(rows.map(row => [row.id, {}]));
      await Promise.all(leaves(selection.expression).map(async node => {
        if (node.type === 'standard') rows.forEach(row => { conditions[row.id][node.id] = standardResult(node, row, Boolean(row.dashboard?.reviewed)); });
        else { const results = await this.judge(companyId, node.text, rows); rows.forEach(row => {
          const result = results[row.id];
          if (result !== 'match' && result !== 'no_match' && result !== 'uncertain') throw new Error('Incomplete condition results. Retry the action.');
          conditions[row.id][node.id] = ({ match: 'true', no_match: 'false', uncertain: 'uncertain' } as const)[result];
        }); }
      }));
      return Object.fromEntries(rows.map(row => [row.id, evaluateTree(selection.expression!, conditions[row.id])]));
    }
    if (typeof selection.criterion !== 'string' || !selection.criterion.trim() || selection.criterion.length > 500) throw new Error('A completed search is required.');
    const outcomes = await this.judge(companyId, selection.criterion, rows);
    return Object.fromEntries(rows.map(row => {
      const result = outcomes[row.id];
      if (result !== 'match' && result !== 'no_match' && result !== 'uncertain') throw new Error('Incomplete search results. Retry the action.');
      return [row.id, ({ match: 'true', no_match: 'false', uncertain: 'uncertain' } as const)[result]];
    }));
  }
  private field(action: BillAction): 'account' | 'memo' | 'owner' | 'flags' | 'tags' | 'reviewed' | 'task' {
    return ({ category: 'account', memo: 'memo', assign: 'owner', flag: 'flags', tag: 'tags', review: 'reviewed', task: 'task' } as const)[action.type];
  }
  private value(row: Row, action: BillAction): unknown {
    const field = this.field(action);
    if (field === 'account' || field === 'memo') return row[field];
    if (field === 'task') return row.dashboard?.owner ?? '';
    return (row.dashboard ?? emptyDashboard())[field];
  }
  private result(companyId: string, row: Row, action: BillAction): unknown {
    if (action.type === 'category') {
      const account = this.data.accounts(companyId).find(account => account.id === action.accountId);
      if (!account) throw new Error('Choose a category from this company.'); return account.name;
    }
    if (action.type === 'memo') return action.text;
    if (action.type === 'assign' || action.type === 'task') return action.owner;
    if (action.type === 'review') return action.reviewed;
    return [...new Set([...(row.dashboard?.[action.type === 'flag' ? 'flags' : 'tags'] ?? []), action.label])];
  }
  async preview(companyId: string, selection: ActionSelection, input: unknown): Promise<ActionPlan> {
    if (!selection || !Array.isArray(selection.ids) || !selection.ids.length || selection.ids.length > 1000 || selection.ids.some(id => typeof id !== 'string') || !['matches', 'selected'].includes(selection.scope)) throw new Error('Choose 1-1000 bills from this company.');
    const action = validateAction(input);
    const rows = [...new Set(selection.ids)].map(id => this.data.row(companyId, id));
    const outcomes = await this.matches(companyId, rows, selection);
    const items: ActionItem[] = rows.map(row => {
      const previousValue = this.value(row, action), resultingValue = this.result(companyId, row, action);
      const item: ActionItem = { billId: row.id, vendor: row.vendor, version: row.sourceVersion!, previousValue, resultingValue,
        before: action.type === 'task' ? 'No review task' : typeof previousValue === 'string' ? previousValue : JSON.stringify(previousValue),
        after: action.type === 'task' ? `${action.title} → ${action.owner} (due ${action.dueDate})` : typeof resultingValue === 'string' ? resultingValue : JSON.stringify(resultingValue), status: 'ready' };
      if (outcomes[row.id] !== 'true') { item.status = 'skipped'; item.message = outcomes[row.id] === 'uncertain' ? 'Not enough evidence. No action will run.' : 'Does not match the current search.'; }
      else if (action.type !== 'task' && same(previousValue, resultingValue)) { item.status = 'skipped'; item.message = 'Already has this value.'; }
      return item;
    });
    const plan: ActionPlan = { id: crypto.randomUUID(), companyId, action, criterion: selection.criterion ?? (selection.expression ? 'Grouped rule' : 'Selected bills'), createdAt: now(), status: 'preview', items };
    this.store.put('plan', plan.id, companyId, plan); return plan;
  }
  plan(companyId: string, id: string): ActionPlan {
    const plan = this.store.get<ActionPlan>('plan', id);
    if (!plan || plan.companyId !== companyId) throw new Error('Action receipt not found for this company.'); return plan;
  }
  apply(companyId: string, id: string): ActionPlan {
    const plan = this.plan(companyId, id);
    if (plan.status === 'finished') return plan;
    if (Date.now() - Date.parse(plan.createdAt) > 15 * 60_000) throw new Error('Preview expired. Preview the latest bills.');
    // All writes, new tasks, and their receipt commit together. A repeated apply
    // reads the finished receipt instead of running the action again.
    return this.store.atomic(() => {
      const current = this.plan(companyId, id); if (current.status === 'finished') return current;
      for (const item of current.items.filter(item => item.status === 'ready')) {
        const row = this.store.row(companyId, item.billId)!;
        if (!row || row.sourceVersion !== item.version) { item.status = 'failed'; item.message = 'Bill changed after preview. Preview it again.'; continue; }
        const dashboard = { ...emptyDashboard(), ...row.dashboard };
        const action = current.action, field = this.field(action);
        if (action.type === 'task') {
          const duplicate = this.store.list<ReviewTask>('task', companyId).find(task => task.billId === row.id && task.status === 'open' && task.title === action.title && task.owner === action.owner && task.dueDate === action.dueDate);
          if (duplicate) { item.status = 'skipped'; item.message = 'An identical open task already exists.'; item.taskId = duplicate.id; continue; }
          const timestamp = now();
          const task: ReviewTask = { id: crypto.randomUUID(), companyId, billId: row.id, vendor: row.vendor, title: action.title, owner: action.owner, dueDate: action.dueDate, status: 'open', createdAt: timestamp, updatedAt: timestamp };
          this.store.put('task', task.id, companyId, task); item.taskId = task.id;
          dashboard.taskIds = [...dashboard.taskIds, task.id]; dashboard.owner = action.owner;
        } else if (field === 'account' || field === 'memo') {
          (row[field] as unknown) = item.resultingValue;
          const original = this.store.original(companyId, row.id);
          row.workspaceChanges = { ...row.workspaceChanges, [field]: original[field] };
        } else (dashboard as unknown as Record<string, unknown>)[field] = item.resultingValue;
        const updated = this.store.write({ ...row, dashboard }, item.version);
        item.afterVersion = updated.sourceVersion; item.status = 'succeeded'; item.message = action.type === 'task' ? 'Task created and assigned.' : 'Saved to SQLite.';
      }
      current.status = 'finished'; this.store.put('plan', id, companyId, current); return current;
    });
  }
  undo(companyId: string, planId: string, billId: string): ActionPlan {
    return this.store.atomic(() => {
      const plan = this.plan(companyId, planId), item = plan.items.find(item => item.billId === billId);
      if (!item || plan.status !== 'finished') throw new Error('Completed action not found.');
      if (item.status === 'undone') return plan;
      if (item.status !== 'succeeded') throw new Error('Only successful actions can be undone.');
      const row = this.store.row(companyId, billId);
      if (!row || row.sourceVersion !== item.afterVersion) throw new Error('Undo conflict: this bill changed after the action. Its current values were preserved.');
      const dashboard = { ...emptyDashboard(), ...row.dashboard }, field = this.field(plan.action);
      if (field === 'task') {
        const task = this.store.get<ReviewTask>('task', item.taskId!);
        if (!task || task.status !== 'open' || task.updatedAt !== task.createdAt) throw new Error('The task changed after creation. Its current status was preserved.');
        this.store.put('task', task.id, companyId, { ...task, status: 'cancelled', updatedAt: now() });
        dashboard.taskIds = dashboard.taskIds.filter(id => id !== task.id); dashboard.owner = item.previousValue as string;
      } else if (field === 'account' || field === 'memo') {
        (row[field] as unknown) = item.previousValue;
        if (row.workspaceChanges && row[field] === this.store.original(companyId, row.id)[field]) delete row.workspaceChanges[field];
      } else (dashboard as unknown as Record<string, unknown>)[field] = item.previousValue;
      this.store.write({ ...row, dashboard }, row.sourceVersion!);
      item.status = 'undone'; this.store.put('plan', planId, companyId, plan); return plan;
    });
  }
  updateTask(companyId: string, id: string, status: unknown, expected: unknown): ReviewTask {
    return this.store.atomic(() => {
      const task = this.store.get<ReviewTask>('task', id);
      if (!task || task.companyId !== companyId) throw new Error('Task not found for this company.');
      if (!['open', 'done', 'cancelled'].includes(String(status)) || task.updatedAt !== expected) throw new Error('The task changed. Refresh it before updating.');
      const next = { ...task, status: status as ReviewTask['status'], updatedAt: new Date(Math.max(Date.now(), Date.parse(task.updatedAt) + 1)).toISOString() };
      this.store.put('task', id, companyId, next); return next;
    });
  }
  async automate(companyId: string, selection: ActionSelection, action: unknown): Promise<ServerAutomation> {
    if (!selection || (!selection.criterion?.trim() && !selection.expression) || selection.scope !== 'matches') throw new Error('A natural-language search or rule is required.');
    const validated = validateAction(action), field = this.field(validated);
    const conflict = () => ['account', 'memo', 'owner', 'reviewed'].includes(field) && this.store.list<ServerAutomation>('automation', companyId).some(rule => rule.enabled && this.field(rule.action) === field);
    if (conflict()) throw new Error('Pause the current automatic action for this field before enabling another.');
    const data = this.data.bills(companyId);
    await this.matches(companyId, data.rows.slice(0, 1), selection);
    // Checked again after the await: a concurrent request may have enabled one for this field meanwhile.
    if (conflict()) throw new Error('Pause the current automatic action for this field before enabling another.');
    const rule: ServerAutomation = { id: crypto.randomUUID(), companyId, criterion: selection.criterion ?? 'Grouped rule', expression: selection.expression, action: validated, enabled: true, createdAt: now(), versions: Object.fromEntries(data.rows.map(row => [row.id, row.sourceVersion!])) };
    this.store.put('automation', rule.id, companyId, rule); return rule;
  }
  pauseAutomation(companyId: string, id: string) {
    const rule = this.store.get<ServerAutomation>('automation', id);
    if (!rule || rule.companyId !== companyId) throw new Error('Automation not found.');
    this.store.put('automation', id, companyId, { ...rule, enabled: false });
  }
  async scan() {
    if (this.scanning) return;
    this.scanning = true;
    try {
      for (const rule of this.store.list<ServerAutomation>('automation').filter(rule => rule.enabled)) {
        const stillEnabled = () => Boolean(this.store.get<ServerAutomation>('automation', rule.id)?.enabled);
        let error: string | undefined;
        try {
          const changed = this.data.bills(rule.companyId).rows.filter(row => rule.versions[row.id] !== row.sourceVersion);
          for (let index = 0; index < changed.length; index += 1000) {
            const plan = await this.preview(rule.companyId, { ids: changed.slice(index, index + 1000).map(row => row.id), criterion: rule.criterion, expression: rule.expression, scope: 'matches' }, rule.action);
            // Paused (or deleted) while Jev was judging: apply nothing. apply() is synchronous, so this check can't go stale.
            if (!stillEnabled()) break;
            const result = this.apply(rule.companyId, plan.id);
            if (result.items.some(item => item.status === 'failed')) throw new Error('An automated action failed. Check its receipt.');
            for (const item of result.items) rule.versions[item.billId] = item.afterVersion ?? item.version;
          }
        } catch (caught) { error = (caught as Error).message; }
        // Save only what the scan owns onto the latest stored copy, so a pause made during the scan sticks.
        const latest = this.store.get<ServerAutomation>('automation', rule.id);
        if (!latest) continue;
        this.store.put('automation', rule.id, rule.companyId, { ...latest, versions: rule.versions, lastChecked: now(), error, enabled: latest.enabled && !error });
      }
    } finally { this.scanning = false; }
  }
}
