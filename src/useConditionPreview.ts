import { useEffect, useMemo, useState } from 'react';
import type { CompanyBills } from './types';
import { evaluateCondition, judgmentKey } from './jevClient';
import { leaves, standardResult, evaluateTree, type Outcome, type Snapshot, type RuleNode } from './rules';
export function useConditionPreview(data: CompanyBills | null, expression: RuleNode | null, previewEnabled = true) {
  const [retry, setRetry] = useState(0);
  const [judgments, setJudgments] = useState<Record<string, Outcome>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [timing, setTiming] = useState({ start: 0, end: 0 });
  const [now, setNow] = useState(performance.now());
  const validCompany = Boolean(data && expression);
  const conditions = validCompany ? leaves(expression!) : [];
  const aiTexts = JSON.stringify([...new Set(conditions.filter(node => node.type === 'ai' && node.text.trim()).map(node => node.type === 'ai' ? node.text : ''))].sort());
  const dataKey = useMemo(() => data ? JSON.stringify(data.rows.map(row => judgmentKey(row, ''))) : '', [data]);
  useEffect(() => {
    let live = true;
    const texts: string[] = JSON.parse(aiTexts);
    // A metadata-only refresh reuses the existing evidence key and cached answer.
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
    snapshots[row.id] = { conditions: results, result: evaluateTree(expression!, results) };
  }

  return { snapshots, counts, evaluated, previewErrors: [...previewErrors], retry: () => setRetry(value => value + 1), elapsed: timing.start ? Math.max(0, ((timing.end || now) - timing.start) / 1000) : 0 };
}
