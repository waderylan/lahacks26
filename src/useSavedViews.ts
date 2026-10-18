import { useCallback, useEffect, useRef, useState } from 'react';
import type { SavedSearch, SearchDefinition } from './savedSearchTypes';
import { usePolling } from './usePolling';

/** Saved views for one company. Polling and focus refresh run only while `active` (the Explore tab is showing). */
export function useSavedViews(companyId: string, active = true) {
  const [searches, setSearches] = useState<SavedSearch[]>([]);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const mounted = useRef(false), pending = useRef(false), sequence = useRef(0);
  const refresh = useCallback(async () => {
    const request = ++sequence.current;
    try {
      const response = await fetch(`/api/companies/${companyId}/searches`), body = await response.json();
      if (!response.ok) throw new Error(body.error ?? 'Could not load saved views.');
      if (!mounted.current || request !== sequence.current) return;
      setSearches(body.searches); setReady(true); setError(''); return body.searches as SavedSearch[];
    } catch (error) { if (mounted.current && request === sequence.current) setError((error as Error).message); }
  }, [companyId]);
  useEffect(() => {
    mounted.current = true; void refresh();
    return () => { mounted.current = false; sequence.current++; };
  }, [refresh]);
  usePolling(() => { if (!pending.current) void refresh(); }, active ? 2000 : 0);
  const mutate = async (method: string, id: string, body: unknown, suffix = '') => {
    if (pending.current) return;
    pending.current = true; setBusy(true); sequence.current++;
    try {
      const response = await fetch(`/api/companies/${companyId}/searches${id ? '/' + encodeURIComponent(id) : ''}${suffix}`, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const result = await response.json();
      if (!mounted.current) return;
      if (!response.ok) { if (response.status === 409 || response.status === 404) await refresh(); throw new Error(result.error ?? 'Could not save the view.'); }
      sequence.current++; setSearches(result.searches); setError(''); return result as { search?: SavedSearch; searches: SavedSearch[] };
    } finally { pending.current = false; if (mounted.current) setBusy(false); }
  };
  return { searches, ready, busy, error, refresh,
    save: (name: string, definition: SearchDefinition, previous?: SavedSearch) => mutate(previous ? 'PATCH' : 'POST', previous?.id ?? '', { name, definition, ...(previous && { revision: previous.revision }) }),
    remove: (search: SavedSearch) => mutate('DELETE', search.id, { revision: search.revision }),
  };
}
