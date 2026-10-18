import { useEffect, useRef } from 'react';

/** Calls `tick` every `ms` while the tab is visible and again when it returns to view. An `ms` of 0 pauses polling. */
export function usePolling(tick: () => void, ms: number) {
  const latest = useRef(tick); latest.current = tick;
  useEffect(() => {
    if (!ms) return;
    const run = () => { if (!document.hidden) latest.current(); };
    const timer = setInterval(run, ms);
    document.addEventListener('visibilitychange', run);
    return () => { clearInterval(timer); document.removeEventListener('visibilitychange', run); };
  }, [ms]);
}
