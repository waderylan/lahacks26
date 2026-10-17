import { useEffect, useMemo, useRef, useState } from 'react';
import type { CompanyBills, Row } from './types';
import { evaluateCondition, judgmentKey } from './jevClient';
import { EMPTY_STORE, evaluateTree, exampleRule, executeRule, leaves, standardResult, transactionVersion, undoEntry, validateRule, type Outcome, type Rule, type RuleStore, type Snapshot } from './rules';

const STORE_KEY = 'tr.rules.v1';
export function readRuleStore(): RuleStore {
  const raw = localStorage.getItem(STORE_KEY);
  if (!raw) return structuredClone(EMPTY_STORE);
  const value = JSON.parse(raw);
  if (!Array.isArray(value.rules) || value.rules.some((r: Rule) => validateRule(r).length) || !value.transactions || !Array.isArray(value.history) || !Array.isArray(value.executions) || !value.arrivals) throw new Error('Saved rule storage is invalid. Export or clear tr.rules.v1 in browser storage before continuing.');
  return value;
}
const signature = (r: Rule) => JSON.stringify([r.name, r.expression, r.actions]);

export function useRules(data: CompanyBills | null, reviewed: Set<string>, onArrival: (row: Row) => void) {
  const [storageError, setStorageError] = useState('');
  const [store, setStore] = useState<RuleStore>(() => { try { return readRuleStore(); } catch (e) { setTimeout(() => setStorageError((e as Error).message)); return structuredClone(EMPTY_STORE); } });
  const storeRef = useRef(store); storeRef.current = store;
  const reviewedRef = useRef(reviewed); reviewedRef.current = reviewed;
  const [draft, setDraft] = useState<Rule | null>(null);
  const draftCompany = useRef('');
  const [message, setMessage] = useState('');
  const [automation, setAutomation] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const companyId = data?.company.companyId ?? '';
  const [retry, setRetry] = useState(0);
  const [judgments, setJudgments] = useState<Record<string, Outcome>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [timing, setTiming] = useState({ start: 0, end: 0 });
  const [now, setNow] = useState(performance.now());

  const commit = (fn: (current: RuleStore) => RuleStore) => {
    if (storageError) throw new Error(storageError);
    const next = fn(storeRef.current);
    try { localStorage.setItem(STORE_KEY, JSON.stringify(next)); }
    catch { setStorageError('Browser storage is full or unavailable. Changes could not be saved.'); throw new Error('Could not persist action state.'); }
    storeRef.current = next; setStore(next);
  };
  useEffect(() => {
    if (!companyId || draftCompany.current === companyId) return;
    draftCompany.current = companyId;
    setDraft(storeRef.current.rules.find(r => r.companyId === companyId) ?? exampleRule(companyId));
    setMessage('');
  }, [companyId]);

  const validCompany = Boolean(draft && draft.companyId === companyId && data);
  const conditions = validCompany ? leaves(draft!.expression) : [];
  const aiTexts = JSON.stringify([...new Set(conditions.filter(n => n.type === 'ai' && n.text.trim()).map(n => n.type === 'ai' ? n.text : ''))].sort());
  const dataKey = useMemo(() => data ? JSON.stringify(data.rows.map(r => [r.id, transactionVersion(r)])) : '', [data]);
  useEffect(() => {
    let current = true;
    const texts: string[] = JSON.parse(aiTexts);
    if (!data || !texts.length) { setTiming({ start: 0, end: 0 }); return; }
    const t = setTimeout(() => {
      const start = performance.now(); setTiming({ start, end: 0 });
      void Promise.all(texts.map(text => evaluateCondition(data, text, (row, outcome, error) => {
        if (!current) return;
        const key = judgmentKey(row, text);
        setJudgments(cur => ({ ...cur, [key]: outcome }));
        setErrors(cur => { const next = { ...cur }; if (error) next[key] = error; else delete next[key]; return next; });
      }))).then(() => current && setTiming({ start, end: performance.now() }));
    }, 400);
    return () => { current = false; clearTimeout(t); };
  }, [aiTexts, dataKey, retry]);
  useEffect(() => {
    if (!timing.start || timing.end) return;
    const t = setInterval(() => setNow(performance.now()), 100);
    return () => clearInterval(t);
  }, [timing]);

  const snapshots: Record<string, Snapshot> = {};
  const counts: Record<string, Record<Outcome, number>> = {};
  const previewErrors = new Set<string>();
  conditions.forEach(n => counts[n.id] = { true: 0, false: 0, uncertain: 0, pending: 0, error: 0 });
  let evaluated = 0;
  if (validCompany) for (const row of data!.rows) {
    const results: Record<string, Outcome> = {};
    for (const condition of conditions) {
      results[condition.id] = condition.type === 'standard' ? standardResult(condition, row, reviewed.has(row.id)) : judgments[judgmentKey(row, condition.text)] ?? 'pending';
      counts[condition.id][results[condition.id]]++;
      if (condition.type === 'ai' && results[condition.id] === 'error') previewErrors.add(errors[judgmentKey(row, condition.text)] ?? 'Jev request failed');
    }
    if (Object.values(results).every(v => v !== 'pending' && v !== 'error')) evaluated++;
    snapshots[row.id] = { conditions: results, result: evaluateTree(draft!.expression, results) };
  }
  const validation = draft ? validateRule(draft) : ['Loading rule…'];
  const complete = validCompany && evaluated === data!.rows.length && !validation.length;
  const matches = data?.rows.filter(r => snapshots[r.id]?.result === 'true') ?? [];
  const uncertain = Object.values(snapshots).filter(s => s.result === 'uncertain').length;
  const saved = store.rules.find(r => r.id === draft?.id);
  const dirty = Boolean(draft && (!saved || signature(draft) !== signature(saved)));

  const save = (activate = false) => {
    if (!draft || validation.length) return;
    const next = { ...structuredClone(draft), revision: saved ? saved.revision + (dirty ? 1 : 0) : 1, enabled: activate || Boolean(saved?.enabled) };
    commit(cur => ({ ...cur, rules: [...cur.rules.filter(r => r.id !== next.id), next] }));
    setDraft(next); setMessage(`Saved revision ${next.revision}${next.enabled ? ' and activated for future arrivals and updates' : ''}. Existing bills were not changed.`);
  };
  const toggleEnabled = () => {
    if (!saved) return;
    const next = { ...saved, enabled: !saved.enabled };
    commit(cur => ({ ...cur, rules: cur.rules.map(r => r.id === next.id ? next : r) }));
    setMessage(next.enabled ? 'Enabled for subsequent arrivals and updates. Use Run once for existing bills.' : 'Rule disabled.');
  };
  const runOnce = () => {
    if (!complete || !saved || dirty || !draft) return;
    // Freeze this exact revision, list, and evidence before the atomic local write.
    const frozen = structuredClone(matches.map(row => ({ row, version: transactionVersion(row, reviewed.has(row.id)), snapshot: snapshots[row.id] })));
    const rule = structuredClone(saved);
    commit(cur => frozen.reduce((next, item) => executeRule(next, rule, item.row, item.version, item.snapshot, 'run'), cur));
    setMessage(`Run once completed for ${frozen.length} definite matches · revision ${rule.revision}. Repeated runs do not duplicate actions.`);
  };

  const processEvent = async (row: Row, source: 'arrival' | 'update', isReviewed: boolean) => {
    const rules = storeRef.current.rules.filter(r => r.companyId === row.companyId && r.enabled).map(r => structuredClone(r));
    for (const rule of rules) {
      setAutomation(cur => [`${row.billId} · ${rule.name} r${rule.revision}: evaluating${source === 'arrival' ? ' replay' : ' update'}…`, ...cur].slice(0, 12));
      const results: Record<string, Outcome> = {};
      await Promise.all(leaves(rule.expression).map(async n => {
        if (n.type === 'standard') results[n.id] = standardResult(n, row, isReviewed);
        else await evaluateCondition({ company: { companyId: row.companyId } as CompanyBills['company'], rows: [row] }, n.text, (_row, outcome) => { results[n.id] = outcome; });
      }));
      const snapshot = { result: evaluateTree(rule.expression, results), conditions: results };
      if (reviewedRef.current.has(row.id) !== isReviewed) { setAutomation(cur => [`${row.billId}: review status changed while evaluating; stale result ignored.`, ...cur].slice(0, 12)); continue; }
      const active = storeRef.current.rules.find(r => r.id === rule.id && r.enabled && r.revision === rule.revision);
      if (!active) { setAutomation(cur => [`${row.billId}: active revision changed; no actions applied.`, ...cur].slice(0, 12)); continue; }
      const failed = Object.values(results).some(v => v === 'error' || v === 'pending');
      if (!failed) commit(cur => executeRule(cur, rule, row, transactionVersion(row, isReviewed), snapshot, source));
      setAutomation(cur => [`${row.billId} · ${rule.name}: ${failed ? 'Jev failed — no actions applied; retry available' : snapshot.result === 'true' ? 'true — actions applied' : `${snapshot.result} — no actions; previous actions preserved`}`, ...cur].slice(0, 12));
      if (failed) failedEvents.current.set(row.id, { row, source, isReviewed });
      else failedEvents.current.delete(row.id);
    }
  };
  const failedEvents = useRef(new Map<string, { row: Row; source: 'arrival' | 'update'; isReviewed: boolean }>());
  const jobs = useRef(0);
  const dispatch = async (row: Row, source: 'arrival' | 'update', isReviewed: boolean) => {
    jobs.current++; setBusy(true);
    try { await processEvent(row, source, isReviewed); }
    catch (e) { setMessage((e as Error).message); }
    finally { if (--jobs.current === 0) setBusy(false); }
  };
  const replay = async () => {
    const row = data?.reservedRows?.find(r => !(storeRef.current.arrivals[companyId] ?? []).includes(r.id));
    if (!row || busy) return;
    commit(cur => ({ ...cur, arrivals: { ...cur.arrivals, [companyId]: [...new Set([...(cur.arrivals[companyId] ?? []), row.id])] } }));
    onArrival(row);
    setMessage(`${row.billId} replayed from the unmodified original dataset. This is not a live QuickBooks connection.`);
    await dispatch(row, 'arrival', reviewed.has(row.id));
  };
  const undo = (id: string) => {
    const result = undoEntry(storeRef.current, id);
    if (result.error) setMessage(result.error);
    else { commit(() => result.store); setMessage('Action undone. Its execution key is retained to prevent duplicate actions.'); }
  };
  const reset = () => {
    commit(cur => ({ ...cur, transactions: Object.fromEntries(Object.entries(cur.transactions).filter(([id]) => !id.startsWith(`${companyId}:`))), history: cur.history.filter(h => h.companyId !== companyId), executions: cur.executions.filter(key => !cur.rules.some(r => r.companyId === companyId && key.startsWith(`${r.id}:`))) }));
    setMessage('Demo actions and history reset for this company. Saved rules, replayed bills, and human review were preserved.');
  };
  return { store, draft: validCompany ? draft : null, setDraft, saved, dirty, validation, snapshots, counts, complete, evaluated, matches, uncertain, elapsed: timing.start ? Math.max(0, ((timing.end || now) - timing.start) / 1000) : 0,
    previewErrors: [...previewErrors], retry: () => setRetry(n => n + 1), save, toggleEnabled, runOnce, replay, busy, automation, message, storageError, undo, reset,
    updateLocal: (id: string, value: import('./rules').LocalTransaction) => commit(cur => ({ ...cur, transactions: { ...cur.transactions, [id]: value } })),
    processUpdate: (row: Row, value: boolean) => void dispatch(row, 'update', value),
    retryAutomation: () => { for (const event of failedEvents.current.values()) void dispatch(event.row, event.source, event.isReviewed); },
    remaining: data?.reservedRows?.filter(r => !(store.arrivals[companyId] ?? []).includes(r.id)).length ?? 0,
    selectRule: (id: string) => { const rule = storeRef.current.rules.find(r => r.id === id); if (rule) setDraft(structuredClone(rule)); },
    loadExample: () => { setDraft(exampleRule(companyId)); setMessage('Editable suggested review policy. A match is not proof of an accounting error.'); },
    newRule: () => { const rule = exampleRule(companyId); setDraft({ ...rule, name: 'Untitled rule', expression: { id: rule.expression.id, type: 'all', children: [] }, actions: [] }); setMessage('Add your conditions under IF, then choose actions under THEN.'); },
  };
}
export type RulesController = ReturnType<typeof useRules>;
