import { useCallback, useEffect, useState } from 'react';
import type { EvaluationContext, Provider } from './modelContext';

export function useEvaluationContext(provider: Provider) {
  const [attempt, setAttempt] = useState(0);
  const [context, setContext] = useState<EvaluationContext>();
  const [error, setError] = useState('');
  const refresh = useCallback(async () => {
    const response = await fetch('/api/status?model=' + provider), body = await response.json();
    if (!response.ok || !body.jev?.context) throw new Error(body.error ?? 'Could not load evaluator identity.');
    return body.jev.context as EvaluationContext;
  }, [provider]);
  useEffect(() => {
    let live = true;
    const update = () => { void refresh().then(next => { if (live) { setContext(old => old?.identity === next.identity ? old : next); setError(''); } }).catch(error => { if (live) setError(error.message); }); };
    update(); window.addEventListener('focus', update); const timer = setInterval(update, 15000);
    return () => { live = false; clearInterval(timer); window.removeEventListener('focus', update); };
  }, [refresh, attempt]);
  return { context: context?.provider === provider ? context : undefined, error, retry: () => setAttempt(value => value + 1) };
}
