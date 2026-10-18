import { useEffect, useSyncExternalStore } from 'react';
import { STARTER_CHARTS, validateCharts, type ChartSpec } from './charts';

type State = { charts: ChartSpec[]; revision: number; ready: boolean; busy: boolean; error: string; focus: ChartSpec | null };
type Edit = (charts: ChartSpec[]) => ChartSpec[];
/** Acknowledged shared state with a per-company mutation queue. Failures never pretend to be saved. */
export function createDashboardClient(request: typeof fetch) {
  const states = new Map<string, State>(), tails = new Map<string, Promise<boolean>>(), reads = new Map<string, number>();
  const failures = new Map<string, Edit>();
  const listeners = new Set<() => void>();
  const get = (id: string): State => { if (!states.has(id)) states.set(id, { charts: [], revision: 0, ready: false, busy: false, error: '', focus: null }); return states.get(id)!; };
  const patch = (id: string, update: Partial<State>) => { states.set(id, { ...get(id), ...update }); listeners.forEach(fn => fn()); };
  const refresh = async (id: string, duringSave = false) => {
    if (get(id).busy && !duringSave) return;
    const seq = (reads.get(id) ?? 0) + 1; reads.set(id, seq);
    try {
      const response = await request(`/api/companies/${id}/dashboard`), body = await response.json();
      if (!response.ok) throw new Error(body.error ?? `Could not load charts (HTTP ${response.status}).`);
      const charts = validateCharts(body.charts ?? STARTER_CHARTS, id);
      if (!Number.isSafeInteger(body.revision)) throw new Error('Invalid dashboard revision.');
      if (reads.get(id) === seq) patch(id, { charts, revision: body.revision, ready: true });
    } catch (error) { if (reads.get(id) === seq) patch(id, { error: (error as Error).message }); }
  };
  const mutate = (id: string, edit: Edit): Promise<boolean> => {
    const previous = tails.get(id) ?? Promise.resolve(true);
    patch(id, { busy: true, error: '' }); reads.set(id, (reads.get(id) ?? 0) + 1);
    const task = previous.then(async () => {
      try {
        if (!get(id).ready) { await refresh(id, true); if (!get(id).ready) throw new Error('Load charts before editing.'); }
        const state = get(id), charts = validateCharts(edit(state.charts), id);
        const response = await request(`/api/companies/${id}/dashboard`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ charts, expectedRevision: state.revision }) });
        const body = await response.json();
        if (!response.ok) { if (response.status === 409) await refresh(id, true); throw new Error(body.error ?? `Could not save charts (HTTP ${response.status}).`); }
        if (!Number.isSafeInteger(body.revision)) throw new Error('Invalid dashboard acknowledgement. Refresh charts.');
        patch(id, { charts: validateCharts(body.charts, id), revision: body.revision, ready: true, error: '' }); failures.delete(id); return true;
      } catch (error) { failures.set(id, edit); patch(id, { error: (error as Error).message }); return false; }
      finally { if (tails.get(id) === task) patch(id, { busy: false }); }
    });
    tails.set(id, task); return task;
  };
  return { get, refresh, mutate, subscribe: (fn: () => void) => { listeners.add(fn); return () => { listeners.delete(fn); }; },
    focus: (id: string, focus: ChartSpec | null) => patch(id, { focus }),
    retry: (id: string) => failures.has(id) ? mutate(id, failures.get(id)!) : refresh(id),
  };
}
const client = createDashboardClient((...args) => fetch(...args));
export function showOnDashboard(companyId: string, chart: ChartSpec) { client.focus(companyId, chart); }
export function useDashboard(companyId: string) {
  useEffect(() => {
    void client.refresh(companyId);
    const refresh = () => { void client.refresh(companyId); };
    window.addEventListener('focus', refresh); const timer = setInterval(refresh, 5000);
    return () => { window.removeEventListener('focus', refresh); clearInterval(timer); };
  }, [companyId]);
  const state = useSyncExternalStore(client.subscribe, () => client.get(companyId));
  return { ...state, refresh: () => client.refresh(companyId), retry: () => client.retry(companyId),
    setFocus: (chart: ChartSpec) => client.focus(companyId, chart), clearFocus: () => client.focus(companyId, null),
    add: (chart: ChartSpec) => client.mutate(companyId, current => [...current, chart]),
    replace: (id: string, chart: ChartSpec) => client.mutate(companyId, current => current.map(c => c.id === id ? { ...chart, id, starter: false } : c)),
    update: (id: string, update: Partial<ChartSpec>) => client.mutate(companyId, current => current.map(c => c.id === id ? { ...c, ...update, id } : c)),
    remove: (id: string) => client.mutate(companyId, current => current.filter(c => c.id !== id)),
    reset: () => client.mutate(companyId, () => structuredClone(STARTER_CHARTS)),
  };
}
