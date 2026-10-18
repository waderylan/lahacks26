import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CompanyBills, Row } from './types';
import { evaluateCondition, judgmentKey } from './jevClient';
import { EMPTY_STORE, evaluateTree, exampleRule, rulePresets, savedPreset, leaves, standardResult, uid, validateRule, type Outcome, type Rule, type RuleStore, type Snapshot, type RuleIssue, type RuleRunSummary } from './rules';
import type { RowPatch } from './useWorkspace';
import { importBrowserWorkspace } from './workspaceMigration';

interface Reply { store: RuleStore; automation: string[]; rows: RowPatch[]; replayed?: Row; issues?: RuleIssue[]; runs?: RuleRunSummary[]; selectedRuleId?: string }
const signature = (rule: Rule) => JSON.stringify([rule.name, rule.expression, rule.actions, Boolean(rule.autoResolve)]);

/** `actor` is the signed-in employee; approved drafts are sent from them. */
export function useRules(data: CompanyBills | null, onArrival: (row: Row) => void, previewEnabled = true, onRows?: (rows: RowPatch[]) => void, onChange?: () => void, actor = '', companyId = data?.company.companyId ?? '') {
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
  const accept = useCallback((reply: Reply) => {
    setStore(old => JSON.stringify(old) === JSON.stringify(reply.store) ? old : reply.store);
    storeRef.current = reply.store;
    setAutomation(reply.automation); callbacks.current.onRows?.(reply.rows);
    setIssues(reply.issues ?? []);
    setRuns(reply.runs ?? []);
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
        if (initial) await importBrowserWorkspace(scope);
        const response = await fetch(`/api/companies/${scope}/rules`);
        const reply = await response.json();
        if (!response.ok) throw new Error(reply.error ?? 'Could not load saved rules.');
        if (disposed || current.current !== scope || seq !== requestSeq.current) return;
        accept(reply); setReady(true);
        setDraft(existing => existing?.companyId === scope ? existing : reply.store.rules[0] ?? exampleRule(scope));
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
      accept(reply); if (success) setMessage(success); callbacks.current.onChange?.();
      return reply as Reply;
    } catch (error) { commandError.current = (error as Error).message; if (current.current === scope) setMessage(commandError.current); }
    finally { pending.current--; if (current.current === scope) setBusy(pending.current > 0); }
  };

  const [retry, setRetry] = useState(0);
  const [judgments, setJudgments] = useState<Record<string, Outcome>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [timing, setTiming] = useState({ start: 0, end: 0 });
  const [now, setNow] = useState(performance.now());
  const validCompany = Boolean(ready && draft && draft.companyId === companyId && data?.company.companyId === companyId);
  const conditions = validCompany ? leaves(draft!.expression) : [];
  const aiTexts = JSON.stringify([...new Set(conditions.filter(node => node.type === 'ai' && node.text.trim()).map(node => node.type === 'ai' ? node.text : ''))].sort());
  const dataKey = useMemo(() => data ? JSON.stringify(data.rows.map(row => judgmentKey(row, ''))) : '', [data]);
  useEffect(() => {
    let live = true;
    const texts: string[] = JSON.parse(aiTexts);
    if (!data || !texts.length || !previewEnabled) { setTiming({ start: 0, end: 0 }); return; }
    const timer = setTimeout(() => {
      const start = performance.now(); setTiming({ start, end: 0 });
      void Promise.all(texts.map(text => evaluateCondition(data, text, (row, outcome, error) => {
        if (!live) return;
        const key = judgmentKey(row, text);
        setJudgments(old => ({ ...old, [key]: outcome }));
        setErrors(old => { const next = { ...old }; if (error) next[key] = error; else delete next[key]; return next; });
      }))).then(() => live && setTiming({ start, end: performance.now() }));
    }, 400);
    return () => { live = false; clearTimeout(timer); };
  }, [aiTexts, dataKey, retry, previewEnabled]);
  useEffect(() => { if (!timing.start || timing.end) return; const timer = setInterval(() => setNow(performance.now()), 100); return () => clearInterval(timer); }, [timing]);

  const snapshots: Record<string, Snapshot> = {}, counts: Record<string, Record<Outcome, number>> = {};
  const previewErrors = new Set<string>();
  conditions.forEach(node => { counts[node.id] = { true: 0, false: 0, uncertain: 0, pending: 0, error: 0 }; });
  let evaluated = 0;
  if (validCompany) for (const row of data!.rows) {
    const results: Record<string, Outcome> = {};
    for (const condition of conditions) {
      results[condition.id] = condition.type === 'standard' ? standardResult(condition, row, Boolean(row.dashboard?.reviewed)) : judgments[judgmentKey(row, condition.text)] ?? 'pending';
      counts[condition.id][results[condition.id]]++;
      if (condition.type === 'ai' && results[condition.id] === 'error') previewErrors.add(errors[judgmentKey(row, condition.text)] ?? 'Jev request failed');
    }
    if (Object.values(results).every(value => value !== 'pending' && value !== 'error')) evaluated++;
    snapshots[row.id] = { conditions: results, result: evaluateTree(draft!.expression, results) };
  }
  const validation = draft ? validateRule(draft) : ['Loading saved rules...'];
  const complete = validCompany && evaluated === data!.rows.length && !validation.length;
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
    elapsed: timing.start ? Math.max(0, ((timing.end || now) - timing.start) / 1000) : 0,
    previewErrors: [...previewErrors], retry: () => setRetry(value => value + 1), save,
    toggleEnabled: () => saved && command({ type: 'toggle', id: saved.id, revision: saved.revision, enabled: !saved.enabled }, saved.enabled ? 'Automatic runs disabled.' : 'Runs automatically on new or changed bills.'),
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
    reset: () => command({ type: 'reset' }, 'Actions, messages, and notifications reset. Saved rules, arrivals, tasks, and review status were preserved.'),
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
    presets: rulePresets(Boolean(data?.company.synthetic)),
    addPreset: async (presetId: string) => {
      const reply = await command({ type: 'add-preset', presetId, sender: actor || 'emp-ap' }, 'Starter ready. Edit its conditions and actions, then review results. No actions were run.');
      const rule = reply?.store.rules.find(rule => rule.id === reply.selectedRuleId);
      if (rule) setDraft(structuredClone(rule));
      return Boolean(rule);
    },
    /** Reopen a saved starter, or begin a fresh unsaved draft for editing. */
    loadPreset: (id: string) => {
      const preset = rulePresets(Boolean(data?.company.synthetic)).find(preset => preset.id === id);
      if (!preset) return;
      const existing = savedPreset(storeRef.current.rules, preset, companyId);
      const rule = existing ?? preset.build(companyId, actor || 'emp-ap');
      setDraft(structuredClone(rule)); setMessage('');
    },
    newRule: () => { const rule = exampleRule(companyId); setDraft({ ...rule, name: 'Untitled rule', expression: { id: rule.expression.id, type: 'all', children: [{ id: uid(), type: 'ai', text: '', label: '' }] }, actions: [] }); setMessage(''); },
    decideMessage: (id: string, status: 'approved' | 'rejected', body?: string) => command({ type: 'decide', id, status, body, actor, expectedBody: storeRef.current.messages.find(message => message.id === id)?.body }, status === 'approved' ? 'Sent to their inbox. No email was delivered.' : 'Draft rejected.'),
    retryDraft: (id: string) => command({ type: 'retry-draft', id }),
    markNoticesRead: () => command({ type: 'read-notices' }),
    markNoticeToasted: (id: string) => command({ type: 'dismiss-notice', id }),
  };
}
export type RulesController = ReturnType<typeof useRules>;
