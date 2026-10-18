import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CompanyBills, Row } from './types';
import { evaluateCondition, judgmentKey } from './jevClient';
import { EMPTY_STORE, evaluateTree, exampleRule, syntheticExampleRules, leaves, standardResult, validateRule, type Outcome, type Rule, type RuleStore, type Snapshot } from './rules';
import type { RowPatch } from './useWorkspace';
import { importBrowserWorkspace } from './workspaceMigration';

interface Reply { store: RuleStore; automation: string[]; rows: RowPatch[]; replayed?: Row }
const signature = (rule: Rule) => JSON.stringify([rule.name, rule.expression, rule.actions]);

/** `actor` is the signed-in employee; approved drafts are sent from them. */
export function useRules(data: CompanyBills | null, reviewed: Set<string>, onArrival: (row: Row) => void, previewEnabled = true, onRows?: (rows: RowPatch[]) => void, onChange?: () => void, actor = '') {
  const companyId = data?.company.companyId ?? '';
  const current = useRef(companyId); current.current = companyId;
  const [store, setStore] = useState<RuleStore>(() => structuredClone(EMPTY_STORE));
  const storeRef = useRef(store); storeRef.current = store;
  const [ready, setReady] = useState(false);
  const [storageError, setStorageError] = useState('');
  const [draft, setDraft] = useState<Rule | null>(null);
  const [message, setMessage] = useState('');
  const [automation, setAutomation] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const pending = useRef(0);
  const callbacks = useRef({ onArrival, onRows, onChange }); callbacks.current = { onArrival, onRows, onChange };
  const requestSeq = useRef(0);
  const exampleIndex = useRef(0);
  const accept = useCallback((reply: Reply) => {
    setStore(old => JSON.stringify(old) === JSON.stringify(reply.store) ? old : reply.store);
    storeRef.current = reply.store;
    setAutomation(reply.automation); callbacks.current.onRows?.(reply.rows);
    if (reply.replayed) callbacks.current.onArrival(reply.replayed);
    setStorageError('');
  }, []);
  useEffect(() => {
    const scope = companyId;
    setReady(false); setStore(structuredClone(EMPTY_STORE)); setDraft(null); setStorageError(''); setMessage(''); setBusy(false);
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
    pending.current++; setBusy(true); requestSeq.current++;
    try {
      const response = await fetch(`/api/companies/${scope}/rules/commands`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const reply = await response.json();
      if (!response.ok) throw new Error(reply.error ?? 'Could not save workspace changes.');
      if (current.current !== scope) return;
      accept(reply); if (success) setMessage(success); callbacks.current.onChange?.();
      return reply as Reply;
    } catch (error) { if (current.current === scope) setMessage((error as Error).message); }
    finally { pending.current--; if (current.current === scope) setBusy(pending.current > 0); }
  };

  const [retry, setRetry] = useState(0);
  const [judgments, setJudgments] = useState<Record<string, Outcome>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [timing, setTiming] = useState({ start: 0, end: 0 });
  const [now, setNow] = useState(performance.now());
  const validCompany = Boolean(ready && draft && draft.companyId === companyId && data);
  const conditions = validCompany ? leaves(draft!.expression) : [];
  const aiTexts = JSON.stringify([...new Set(conditions.filter(node => node.type === 'ai' && node.text.trim()).map(node => node.type === 'ai' ? node.text : ''))].sort());
  const dataKey = useMemo(() => data ? JSON.stringify(data.rows.map(row => [row.id, row.account, row.memo, row.description, row.itemNames, row.amountCents])) : '', [data]);
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
      results[condition.id] = condition.type === 'standard' ? standardResult(condition, row, reviewed.has(row.id)) : judgments[judgmentKey(row, condition.text)] ?? 'pending';
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
    const reply = await command({ type: 'save', rule: draft, expectedRevision: saved ? draft.revision : null, activate }, 'Rule saved in SQLite.');
    const next = reply?.store.rules.find(rule => rule.id === draft.id); if (next) setDraft(next);
  };
  return {
    store, draft: validCompany ? draft : null, setDraft, saved, dirty, validation, snapshots, counts, complete, evaluated, matches, uncertain,
    elapsed: timing.start ? Math.max(0, ((timing.end || now) - timing.start) / 1000) : 0,
    previewErrors: [...previewErrors], retry: () => setRetry(value => value + 1), save,
    toggleEnabled: () => saved && command({ type: 'toggle', id: saved.id, revision: saved.revision, enabled: !saved.enabled }, saved.enabled ? 'Rule disabled.' : 'Enabled on the server for subsequent arrivals and updates.'),
    runOnce: () => complete && saved && !dirty && !busy && command({ type: 'run', id: saved.id, revision: saved.revision, ids: data!.rows.map(row => row.id) }, 'Run once completed. Actions and messages are saved in SQLite.'),
    replay: () => command({ type: 'replay' }, 'Original bill replayed. Actions are saved in SQLite.'),
    busy, automation, message, storageError, actor,
    undo: (id: string) => command({ type: 'undo', id }, 'Action undone. Its execution key is retained.'),
    reset: () => command({ type: 'reset' }, 'Actions, messages, and notifications reset. Saved rules, arrivals, tasks, and review status were preserved.'),
    updateLocal: (id: string, value: import('./rules').LocalTransaction, expectedVersion?: string) => command({ type: 'metadata', id, value, expectedVersion: expectedVersion ?? data?.rows.find(row => row.id === id)?.sourceVersion }),
    processUpdate: (_row: Row, _value: boolean) => {}, // Persisted bill updates are observed by the server worker.
    retryAutomation: () => command({ type: 'retry-automation' }),
    remaining: data?.reservedRows?.filter(row => !(store.arrivals[companyId] ?? []).includes(row.id)).length ?? 0,
    selectRule: (id: string) => { const rule = storeRef.current.rules.find(rule => rule.id === id); if (rule) { setDraft(structuredClone(rule)); setMessage(''); } },
    loadExample: () => {
      // Synthetic extension companies cycle through four draft review policies; others keep the single example.
      const examples = data?.company.synthetic ? syntheticExampleRules(companyId) : [exampleRule(companyId)];
      const next = examples[exampleIndex.current++ % examples.length];
      setDraft(next); setMessage(`Editable suggested review policy: ${next.name}. A match is not proof of an accounting error.`);
    },
    newRule: () => { const rule = exampleRule(companyId); setDraft({ ...rule, name: 'Untitled rule', expression: { id: rule.expression.id, type: 'all', children: [] }, actions: [] }); setMessage('Add conditions under IF, then actions under THEN.'); },
    decideMessage: (id: string, status: 'approved' | 'rejected', body?: string) => command({ type: 'decide', id, status, body, actor, expectedBody: storeRef.current.messages.find(message => message.id === id)?.body }, status === 'approved' ? 'Sent to their inbox. No email was delivered.' : 'Draft rejected.'),
    retryDraft: (id: string) => command({ type: 'retry-draft', id }),
    markNoticesRead: () => command({ type: 'read-notices' }),
    markNoticeToasted: (id: string) => command({ type: 'dismiss-notice', id }),
  };
}
export type RulesController = ReturnType<typeof useRules>;
