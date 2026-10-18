import { useEffect, useSyncExternalStore } from 'react';
import { STARTER_CHARTS, type ChartSpec } from './charts';

/**
 * Each company's dashboard charts, shared by the Dashboard tab and the chat bubble and saved in
 * SQLite on the server. Starts with the starter charts until someone changes it.
 */
const charts = new Map<string, ChartSpec[]>();
const loading = new Set<string>();
const listeners = new Set<() => void>();
const notify = () => listeners.forEach(l => l());
const EMPTY: ChartSpec[] = [];
/** A chart answering a chat question, shown on its own until Refresh. Not saved: it lasts for this page visit only. */
const focus = new Map<string, ChartSpec | null>();
export function showOnDashboard(companyId: string, chart: ChartSpec) { focus.set(companyId, chart); notify(); }

function load(companyId: string) {
  if (charts.has(companyId) || loading.has(companyId)) return;
  loading.add(companyId);
  fetch(`/api/companies/${companyId}/dashboard`).then(r => r.json()).then(body => {
    charts.set(companyId, Array.isArray(body.charts) ? body.charts : STARTER_CHARTS);
  }).catch(() => charts.set(companyId, STARTER_CHARTS)).finally(() => { loading.delete(companyId); notify(); });
}

function save(companyId: string, next: ChartSpec[]) {
  charts.set(companyId, next);
  notify();
  void fetch(`/api/companies/${companyId}/dashboard`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ charts: next }) }).catch(() => {});
}

export function useDashboard(companyId: string) {
  useEffect(() => load(companyId), [companyId]);
  const list = useSyncExternalStore(cb => { listeners.add(cb); return () => listeners.delete(cb); }, () => charts.get(companyId) ?? EMPTY);
  const focused = useSyncExternalStore(cb => { listeners.add(cb); return () => listeners.delete(cb); }, () => focus.get(companyId) ?? null);
  const current = () => charts.get(companyId) ?? STARTER_CHARTS;
  return {
    charts: list,
    ready: charts.has(companyId),
    focus: focused,
    setFocus: (chart: ChartSpec) => showOnDashboard(companyId, chart),
    clearFocus: () => { focus.set(companyId, null); notify(); },
    // New charts go after the existing ones, so the starter charts stay first.
    add: (chart: ChartSpec) => save(companyId, [...current(), chart]),
    replace: (id: string, chart: ChartSpec) => save(companyId, current().map(c => (c.id === id ? { ...chart, id, starter: false } : c))),
    update: (id: string, patch: Partial<ChartSpec>) => save(companyId, current().map(c => (c.id === id ? { ...c, ...patch } : c))),
    remove: (id: string) => save(companyId, current().filter(c => c.id !== id)),
    reset: () => save(companyId, STARTER_CHARTS),
  };
}
