import { useEffect, useMemo, useState } from 'react';
import type { CompanyBills } from './types';
import { evaluateCondition, judgmentKey, pMatchFor } from './jevClient';
import { leaves, standardResult, evaluateTree, type Outcome, type Snapshot, type RuleNode } from './rules';
export function useConditionPreview(data: CompanyBills | null, expression: RuleNode | null, previewEnabled = true, debounceMs = 400) {
  const [retry, setRetry] = useState(0);
  const [judgments, setJudgments] = useState<Record<string, Outcome>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [timing, setTiming] = useState({ start: 0, end: 0 });
  const [settledTexts, setSettledTexts] = useState('');
  const [now, setNow] = useState(performance.now());
  const validCompany = Boolean(data && expression);
  const conditions = validCompany ? leaves(expression!) : [];
  const aiTexts = JSON.stringify([...new Set(conditions.filter(node => node.type === 'ai' && node.text.trim()).map(node => node.type === 'ai' ? node.text : ''))].sort());
  const dataKey = useMemo(() => data ? JSON.stringify(data.rows.map(row => judgmentKey(row, ''))) : '', [data]);
  useEffect(() => {
    let live = true;
    setSettledTexts('');
    const texts: string[] = JSON.parse(aiTexts);
    // A metadata-only refresh reuses the existing evidence key and cached answer.
    if (!data || !texts.length || !previewEnabled) { setTiming({ start: 0, end: 0 }); return; }
    const timer = setTimeout(() => {
      setSettledTexts(aiTexts);
      const start = performance.now(); setTiming({ start, end: 0 });
      void Promise.all(texts.map(text => evaluateCondition(data, text, (row, outcome, error) => {
        if (!live) return;
        const key = judgmentKey(row, text);
        setJudgments(old => ({ ...old, [key]: outcome }));
        setErrors(old => { const next = { ...old }; if (error) next[key] = error; else delete next[key]; return next; });
      }))).then(() => live && setTiming({ start, end: performance.now() }));
    }, debounceMs);
    return () => { live = false; clearTimeout(timer); };
  }, [aiTexts, dataKey, retry, previewEnabled, debounceMs]);
  useEffect(() => { if (!timing.start || timing.end) return; const timer = setInterval(() => setNow(performance.now()), 100); return () => clearInterval(timer); }, [timing]);

  const snapshots: Record<string, Snapshot> = {}, counts: Record<string, Record<Outcome, number>> = {};
  const probabilities: Record<string, Record<string, number>> = {};
  const previewErrors = new Set<string>();
  conditions.forEach(node => { counts[node.id] = { true: 0, false: 0, uncertain: 0, pending: 0, error: 0 }; });
  let evaluated = 0;
  if (validCompany) for (const row of data!.rows) {
    const results: Record<string, Outcome> = {};
    probabilities[row.id] = {};
    for (const condition of conditions) {
      results[condition.id] = condition.type === 'standard' ? standardResult(condition, row, Boolean(row.dashboard?.reviewed)) : settledTexts === aiTexts ? judgments[judgmentKey(row, condition.text)] ?? 'pending' : 'pending';
      counts[condition.id][results[condition.id]]++;
      if (condition.type === 'ai' && !['pending', 'error'].includes(results[condition.id])) {
        const probability = pMatchFor(row, condition.text);
        if (probability !== undefined && Number.isFinite(probability) && probability >= 0 && probability <= 1) probabilities[row.id][condition.id] = probability;
      }
      if (condition.type === 'ai' && results[condition.id] === 'error') previewErrors.add(errors[judgmentKey(row, condition.text)] ?? 'Jev request failed');
    }
    if (Object.values(results).every(value => value !== 'pending' && value !== 'error')) evaluated++;
    snapshots[row.id] = { conditions: results, result: evaluateTree(expression!, results) };
  }

  return { snapshots, counts, probabilities, evaluated, previewErrors: [...previewErrors], retry: () => setRetry(value => value + 1), elapsed: timing.start ? Math.max(0, ((timing.end || now) - timing.start) / 1000) : 0 };
}
