import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CompanyBills, Row } from './types';
import { useConditionPreview } from './useConditionPreview';
import { usePolling } from './usePolling';
import { inScope } from './ruleScope';
import { EMPTY_STORE, exampleRule, rulePresets, uid, validateRule, type Rule, type RuleStore, type RuleIssue, type RuleRunSummary } from './rules';
import type { RowPatch } from './useWorkspace';

interface Reply { store: RuleStore; rows: RowPatch[]; issues?: RuleIssue[]; runs?: RuleRunSummary[]; selectedRuleId?: string }
const signature = (rule: Rule) => JSON.stringify([rule.name, rule.expression, rule.actions, Boolean(rule.autoResolve), rule.scope]);
const STARTERS = rulePresets(true).filter(preset => preset.starter);

export interface RulesOptions {
  /** Evaluate the draft against the loaded records (only while the rule editor is open). */
  previewEnabled?: boolean;
  onRows?: (rows: RowPatch[]) => void;
  /** Called after any successful command so tasks, receipts and mail refresh. */
  onChange?: () => void;
  /** The signed-in employee; approved drafts are sent from them. */
  actor?: string;
  companyId?: string;
  /** How often saved rules are re-read while the tab is visible; 0 pauses polling. */
  pollMs?: number;
}

export function useRules(data: CompanyBills | null, { previewEnabled = true, onRows, onChange, actor = '', companyId = data?.company.companyId ?? '', pollMs = 2000 }: RulesOptions = {}) {
  const current = useRef(companyId); current.current = companyId;
  const [store, setStore] = useState<RuleStore>(() => structuredClone(EMPTY_STORE));
  const storeRef = useRef(store); storeRef.current = store;
  const [ready, setReady] = useState(false);
  const [storageError, setStorageError] = useState('');
  const [draft, setDraft] = useState<Rule | null>(null);
  const [message, setMessage] = useState('');
  const [issues, setIssues] = useState<RuleIssue[]>([]);
  const [runs, setRuns] = useState<RuleRunSummary[]>([]);
  const [busy, setBusy] = useState(false);
  const pending = useRef(0);
  const commandError = useRef('');
  const callbacks = useRef({ onRows, onChange }); callbacks.current = { onRows, onChange };
  const requestSeq = useRef(0);
  const accept = useCallback((reply: Reply) => {
    setStore(old => JSON.stringify(old) === JSON.stringify(reply.store) ? old : reply.store);
    storeRef.current = reply.store;
    callbacks.current.onRows?.(reply.rows ?? []);
    setIssues(reply.issues ?? []); setRuns(reply.runs ?? []);
    setStorageError('');
  }, []);
  const load = useCallback(async (scope: string) => {
    const seq = ++requestSeq.current;
    try {
      const response = await fetch(`/api/companies/${scope}/rules`);
      const reply = await response.json();
      if (!response.ok) throw new Error(reply.error ?? 'Could not load saved rules.');
      if (current.current !== scope || seq !== requestSeq.current) return;
      accept(reply); setReady(true);
      setDraft(existing => existing?.companyId === scope ? existing : reply.store.rules[0] ?? exampleRule(scope));
    } catch (error) { if (current.current === scope) setStorageError((error as Error).message); }
  }, [accept]);
  useEffect(() => {
    setReady(false); setStore(structuredClone(EMPTY_STORE)); setDraft(null); setIssues([]); setRuns([]); setStorageError(''); setMessage(''); setBusy(false);
    if (!companyId) return;
    void load(companyId);
    return () => { requestSeq.current++; };
  }, [companyId, load]);
  usePolling(() => { if (companyId && !pending.current) void load(companyId); }, pollMs);
  const command = async (body: Record<string, unknown>, success?: string) => {
    const scope = companyId;
    if (!scope || !ready) return;
    pending.current++; setBusy(true); requestSeq.current++; commandError.current = '';
    try {
      const response = await fetch(`/api/companies/${scope}/rules/commands`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const reply = await response.json();
      if (!response.ok) throw new Error(reply.error ?? 'Could not save workspace changes.');
      if (current.current !== scope) return;
      accept(reply); if (success) setMessage(success); callbacks.current.onChange?.();
      return reply as Reply;
    } catch (error) { commandError.current = (error as Error).message; if (current.current === scope) setMessage(commandError.current); }
    finally { pending.current--; if (current.current === scope) setBusy(pending.current > 0); }
  };

  const validCompany = Boolean(ready && draft && draft.companyId === companyId && data?.company.companyId === companyId);
  const scopedData = useMemo(() => data ? { ...data, rows: data.rows.filter(row => inScope(row, draft?.scope)) } : null, [data, draft?.scope]);
  const { snapshots, counts, evaluated, previewErrors, retry, elapsed } = useConditionPreview(scopedData, validCompany ? draft!.expression : null, previewEnabled);
  const validation = draft ? validateRule(draft) : ['Loading saved rules...'];
  const complete = validCompany && evaluated === scopedData!.rows.length && !validation.length;
  const matches = data?.rows.filter(row => snapshots[row.id]?.result === 'true') ?? [];
  const uncertain = Object.values(snapshots).filter(snapshot => snapshot.result === 'uncertain').length;
  const saved = store.rules.find(rule => rule.id === draft?.id);
  const dirty = Boolean(draft && (!saved || signature(draft) !== signature(saved)));
  const save = async (activate = false) => {
    if (!draft || validation.length || busy) return;
    const reply = await command({ type: 'save', rule: draft, expectedRevision: saved ? draft.revision : null, activate }, 'Rule saved.');
    const next = reply?.store.rules.find(rule => rule.id === draft.id); if (next) setDraft(next);
  };
  return {
    store, issues, runs, ready, draft: validCompany ? draft : null, setDraft, saved, dirty, validation, snapshots, counts, complete, evaluated, matches, uncertain,
    elapsed, previewErrors, retry, save,
    toggleEnabled: (rule = saved) => rule && command({ type: 'toggle', id: rule.id, revision: rule.revision, enabled: !rule.enabled }, rule.enabled ? 'Keep checking is off.' : 'Keep checking is on. Current records are the baseline; only new or changed records trigger actions.'),
    toggleRule: (rule: Rule, enabled: boolean) => command({ type: 'toggle', id: rule.id, revision: rule.revision, enabled }, `${rule.name}: Keep checking is ${enabled ? 'on' : 'off'}.`),
    /** Full-company run: every company record inside the saved rule's record filters, not just the loaded preview. */
    runRule: (rule: Rule) => command({ type: 'run-all', id: rule.id, revision: rule.revision }, `${rule.name}: run complete. See Tasks & activity for what changed.`),
    deleteRule: async (rule: Rule) => {
      const reply = await command({ type: 'delete', id: rule.id, revision: rule.revision }, `${rule.name} deleted. Existing tasks, flags, messages and history were kept.`);
      if (reply && draft?.id === rule.id) setDraft(reply.store.rules[0] ?? exampleRule(companyId));
      return Boolean(reply);
    },
    /** Runs the saved rule on exactly these records. The wizard passes every evaluated preview record that has a configured action. */
    runOnce: (ids: string[]) => complete && saved && !dirty && !busy && command({ type: 'run', id: saved.id, revision: saved.revision, ids }, 'Run complete. See Tasks & activity for what changed.'),
    /** Re-evaluates one record against a saved rule, for example after supporting details were added. */
    recheck: (rule: Rule, ids: string[]) => command({ type: 'run', id: rule.id, revision: rule.revision, ids }, `${rule.name}: rechecked.`),
    busy, message, storageError, actor,
    undo: (id: string) => command({ type: 'undo', id }, 'Action undone.'),
    /** Complete company restore: source records, activity, tasks, mail and rule results. Saved rules stay, switched off. */
    restore: () => command({ type: 'reset', full: true }, 'Company restored. Saved rules are kept with Keep checking off.'),
    updateLocal: (id: string, value: import('./rules').LocalTransaction, expectedVersion?: string) => command({ type: 'metadata', id, value, expectedVersion: expectedVersion ?? data?.rows.find(row => row.id === id)?.sourceVersion }),
    addEvidence: async (row: Row, title: string, text: string) => {
      const reply = await command({ type: 'add-evidence', id: row.id, title, text, expectedVersion: row.sourceVersion }, 'Supporting details saved.');
      if (!reply) throw new Error(commandError.current || 'Could not save these details. Try again.');
      return true;
    },
    selectRule: (id: string) => { const rule = storeRef.current.rules.find(rule => rule.id === id); if (rule) { setDraft(structuredClone(rule)); setMessage(''); } },
    presets: STARTERS,
    addPreset: async (presetId: string) => {
      const reply = await command({ type: 'add-preset', presetId, sender: actor || 'emp-ap' }, 'Starter ready. Edit its conditions and actions, then review results. No actions were run.');
      const rule = reply?.store.rules.find(rule => rule.id === reply.selectedRuleId);
      if (rule) setDraft(structuredClone(rule));
      return Boolean(rule);
    },
    newRule: () => { const rule = exampleRule(companyId); setDraft({ ...rule, name: 'Untitled rule', expression: { id: rule.expression.id, type: 'all', children: [{ id: uid(), type: 'ai', text: '', label: '' }] }, actions: [] }); setMessage(''); },
    decideMessage: (id: string, status: 'approved' | 'rejected', body?: string) => command({ type: 'decide', id, status, body, actor, expectedBody: storeRef.current.messages.find(message => message.id === id)?.body }, status === 'approved' ? 'Sent to their inbox. No email was delivered.' : 'Draft rejected.'),
    retryDraft: (id: string) => command({ type: 'retry-draft', id }),
    markNoticesRead: () => command({ type: 'read-notices' }),
    markNoticeToasted: (id: string) => command({ type: 'dismiss-notice', id }),
  };
}
export type RulesController = ReturnType<typeof useRules>;
