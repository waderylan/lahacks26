import { useEvaluationContext } from './useEvaluationContext';
import type { Provider } from './modelContext';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CompanyBills, Row } from './types';
import { useConditionPreview } from './useConditionPreview';
import { inScope } from './ruleScope';
import { EMPTY_STORE, exampleRule, syntheticExampleRules, rulePresets, savedPreset, uid, validateRule, type Rule, type RuleStore, type RuleIssue, type RuleRunSummary } from './rules';
import type { RowPatch } from './useWorkspace';

interface Reply { store: RuleStore; automation: string[]; rows: RowPatch[]; replayed?: Row; issues?: RuleIssue[]; runs?: RuleRunSummary[]; selectedRuleId?: string }
const signature = (rule: Rule) => JSON.stringify([rule.name, rule.expression, rule.actions, Boolean(rule.autoResolve), rule.scope, rule.provider ?? 'jev']);

/** `actor` is the signed-in employee; approved drafts are sent from them. */
export function useRules(data: CompanyBills | null, onArrival: (row: Row) => void, previewEnabled = true, onRows?: (rows: RowPatch[]) => void, onChange?: () => void, actor = '', companyId = data?.company.companyId ?? '', pageProvider: Provider = 'jev') {
  const current = useRef(companyId); current.current = companyId;
  const [store, setStore] = useState<RuleStore>(() => structuredClone(EMPTY_STORE));
  const storeRef = useRef(store); storeRef.current = store;
  const [ready, setReady] = useState(false);
  const [storageError, setStorageError] = useState('');
  const [draft, setDraft] = useState<Rule | null>(null);
  const [message, setMessage] = useState('');
  const [automation, setAutomation] = useState<string[]>([]);
  const [issues, setIssues] = useState<RuleIssue[]>([]);
  const [runs, setRuns] = useState<RuleRunSummary[]>([]);
  const [busy, setBusy] = useState(false);
  const pending = useRef(0);
  const commandError = useRef('');
  const callbacks = useRef({ onArrival, onRows, onChange }); callbacks.current = { onArrival, onRows, onChange };
  const requestSeq = useRef(0);
  const exampleIndex = useRef(0);
  const accept = useCallback((reply: Reply) => {
    setStore(old => JSON.stringify(old) === JSON.stringify(reply.store) ? old : reply.store);
    storeRef.current = reply.store;
    setAutomation(reply.automation); callbacks.current.onRows?.(reply.rows);
    setIssues(reply.issues ?? []); setRuns(reply.runs ?? []);
    if (reply.replayed) callbacks.current.onArrival(reply.replayed);
    setStorageError('');
  }, []);
  useEffect(() => {
    const scope = companyId;
    setReady(false); setStore(structuredClone(EMPTY_STORE)); setDraft(null); setIssues([]); setRuns([]); setStorageError(''); setMessage(''); setBusy(false);
    if (!scope) return;
    let disposed = false;
    const refresh = async (initial = false) => {
      const seq = ++requestSeq.current;
      try {

        const response = await fetch(`/api/companies/${scope}/rules`);
        const reply = await response.json();
        if (!response.ok) throw new Error(reply.error ?? 'Could not load saved rules.');
        if (disposed || current.current !== scope || seq !== requestSeq.current) return;
        accept(reply); setReady(true);
        setDraft(existing => existing?.companyId === scope ? existing : reply.store.rules[0] ?? { ...exampleRule(scope), provider: pageProvider });
      } catch (error) { if (!disposed && current.current === scope) setStorageError((error as Error).message); }
    };
    void refresh(true);
    const timer = setInterval(() => { if (!pending.current) void refresh(); }, 2000);
    return () => { disposed = true; clearInterval(timer); requestSeq.current++; };
  }, [companyId, accept]);
  useEffect(() => {
    for (const row of data?.reservedRows ?? []) if (store.arrivals[companyId]?.includes(row.id) && !data!.rows.some(existing => existing.id === row.id)) callbacks.current.onArrival(row);
  }, [store.arrivals, data, companyId]);
  const command = async (body: Record<string, unknown>, success?: string) => {
    const scope = companyId;
    if (!scope || !ready) return;
    pending.current++; setBusy(true); requestSeq.current++; commandError.current = '';
    try {
      const response = await fetch(`/api/companies/${scope}/rules/commands`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const reply = await response.json();
      if (!response.ok) throw new Error(reply.error ?? 'Could not save workspace changes.');
      if (current.current !== scope) return;
      accept(reply); window.dispatchEvent(new Event('workspace-changed')); if (success) setMessage(success); callbacks.current.onChange?.();
      return reply as Reply;
    } catch (error) { commandError.current = (error as Error).message; if (current.current === scope) setMessage(commandError.current); }
    finally { pending.current--; if (current.current === scope) setBusy(pending.current > 0); }
  };

  const validCompany = Boolean(ready && draft && draft.companyId === companyId && data?.company.companyId === companyId);
  const scopedData = useMemo(() => data ? { ...data, rows: data.rows.filter(row => inScope(row, draft?.scope)) } : null, [data, draft?.scope]);
  const evaluation = useEvaluationContext(draft?.provider ?? 'jev');
  const { snapshots, counts, evaluated, previewErrors, retry, elapsed } = useConditionPreview(scopedData, validCompany ? draft!.expression : null, previewEnabled && Boolean(evaluation.context), 400, evaluation.context);
  const validation = draft ? validateRule(draft) : ['Loading saved rules...'];
  const complete = validCompany && evaluated === scopedData!.rows.length && !validation.length;
  const matches = data?.rows.filter(row => snapshots[row.id]?.result === 'true') ?? [];
  const uncertain = Object.values(snapshots).filter(snapshot => snapshot.result === 'uncertain').length;
  const saved = store.rules.find(rule => rule.id === draft?.id);
  const dirty = Boolean(draft && (!saved || signature(draft) !== signature(saved) || Boolean(saved.evaluation && evaluation.context && saved.evaluation.identity !== evaluation.context.identity)));
  const save = async (activate = false) => {
    if (!draft || validation.length || busy) return;
    const reply = await command({ type: 'save', rule: draft, expectedRevision: saved ? draft.revision : null, activate }, 'Rule saved.');
    const next = reply?.store.rules.find(rule => rule.id === draft.id); if (next) setDraft(next);
  };
  return {
    store, issues, runs, ready, draft: validCompany ? draft : null, setDraft, saved, dirty, validation, snapshots, counts, complete, evaluated, matches, uncertain,
    elapsed, previewErrors: [...previewErrors, ...(evaluation.error ? [evaluation.error] : [])], retry: () => { evaluation.retry(); retry(); }, save,
    toggleEnabled: (rule = saved) => rule && command({ type: 'toggle', id: rule.id, revision: rule.revision, enabled: !rule.enabled }, rule.enabled ? 'Recurring checks off.' : 'Recurring checks on. Current records form the baseline; only new or changed records trigger actions.'),
    toggleRule: (rule: Rule, enabled: boolean) => command({ type: 'toggle', id: rule.id, revision: rule.revision, enabled }, `${rule.name}: automatic runs ${enabled ? 'on' : 'off'}.`),
    runRule: (rule: Rule) => command({ type: 'run-all', id: rule.id, revision: rule.revision }, `${rule.name}: run complete. Results are shown in the table.`),
    deleteRule: async (rule: Rule) => {
      const reply = await command({ type: 'delete', id: rule.id, revision: rule.revision }, `${rule.name} deleted. Existing tasks, flags, messages and history were kept.`);
      if (reply && draft?.id === rule.id) setDraft(reply.store.rules[0] ?? exampleRule(companyId));
      return Boolean(reply);
    },
    runOnce: (ids?: string[]) => complete && saved && !dirty && !busy && command({ type: 'run', id: saved.id, revision: saved.revision, ids: ids ?? data!.rows.map(row => row.id) }, 'Run complete. View action history for details.'),
    replay: () => command({ type: 'replay' }, 'Original bill replayed. Actions are saved in SQLite.'),
    busy, automation, message, storageError, actor,
    undo: (id: string) => command({ type: 'undo', id }, 'Action undone. Its execution key is retained.'),
    reset: () => command({ type: 'reset', full: true }, 'Company records restored. Saved rules are disabled.'),
    updateLocal: (id: string, value: import('./rules').LocalTransaction, expectedVersion?: string) => command({ type: 'metadata', id, value, expectedVersion: expectedVersion ?? data?.rows.find(row => row.id === id)?.sourceVersion }),
    addEvidence: async (row: Row, title: string, text: string) => {
      const reply = await command({ type: 'add-evidence', id: row.id, title, text, expectedVersion: row.sourceVersion }, 'Supporting details saved. Enabled rules will check the transaction again.');
      if (!reply) throw new Error(commandError.current || 'Could not save these details. Try again.');
      return true;
    },
    processUpdate: (_row: Row, _value: boolean) => {}, // Persisted bill updates are observed by the server worker.
    retryAutomation: () => command({ type: 'retry-automation' }),
    remaining: data?.reservedRows?.filter(row => !(store.arrivals[companyId] ?? []).includes(row.id)).length ?? 0,
    selectRule: (id: string) => { const rule = storeRef.current.rules.find(rule => rule.id === id); if (rule) { setDraft(structuredClone(rule)); setMessage(''); } },
    loadExample: () => {
      // Synthetic extension companies cycle through four draft review policies; others keep the single example.
      const examples = data?.company.synthetic ? syntheticExampleRules(companyId) : [exampleRule(companyId)];
      const next = examples[exampleIndex.current++ % examples.length];
      setDraft(next); setMessage('');
    },
    presets: rulePresets(Boolean(data?.company.synthetic)),
    addPreset: async (presetId: string) => {
      const reply = await command({ type: 'add-preset', presetId, model: pageProvider, sender: actor || 'emp-ap' }, 'Starter ready. Edit its conditions and actions, then review results. No actions were run.');
      const rule = reply?.store.rules.find(rule => rule.id === reply.selectedRuleId);
      if (rule) setDraft(structuredClone(rule));
      return Boolean(rule);
    },
    /** Reopen a saved starter, or begin a fresh unsaved draft for editing. */
    loadPreset: (id: string) => {
      const preset = rulePresets(Boolean(data?.company.synthetic)).find(preset => preset.id === id);
      if (!preset) return;
      const existing = savedPreset(storeRef.current.rules, preset, companyId);
      const rule = existing ?? { ...preset.build(companyId, actor || 'emp-ap'), provider: pageProvider };
      setDraft(structuredClone(rule)); setMessage('');
    },
    newRule: () => { const rule = exampleRule(companyId); setDraft({ ...rule, provider: pageProvider, name: 'Untitled rule', expression: { id: rule.expression.id, type: 'all', children: [{ id: uid(), type: 'ai', text: '', label: '' }] }, actions: [] }); setMessage(''); },
    decideMessage: (id: string, status: 'approved' | 'rejected', body?: string) => command({ type: 'decide', id, status, body, actor, expectedBody: storeRef.current.messages.find(message => message.id === id)?.body }, status === 'approved' ? 'Sent to their inbox. No email was delivered.' : 'Draft rejected.'),
    retryDraft: (id: string) => command({ type: 'retry-draft', id }),
    markNoticesRead: () => command({ type: 'read-notices' }),
    markNoticeToasted: (id: string) => command({ type: 'dismiss-notice', id }),
  };
}
export type RulesController = ReturnType<typeof useRules>;
