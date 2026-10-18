import { useMemo, useState } from 'react';
import { aggregate, CHART_LIMIT, GROUP_LABELS, KIND_LABELS, MEASURE_LABELS, type ChartKind, type ChartSpec, type GroupBy, type Measure } from './charts';
import { ChartView, formatValue } from './ChartView';
import { useDashboard } from './dashboardStore';
import { dashboardTotals, money } from './chartMath';
import { useFullRecords } from './useFullRecords';
import type { CompanyBills } from './types';

export function Dashboard({ companyId }: { companyId: string }) {
  const records = useFullRecords(companyId), dash = useDashboard(companyId);
  const [target, setTarget] = useState('new');
  const data = records.data;
  const kpi = useMemo(() => dashboardTotals(data?.rows ?? []), [data]);
  const refresh = () => { void records.refresh(); void dash.refresh(); };
  const keep = async () => {
    if (!dash.focus) return;
    const chart = { ...dash.focus, id: crypto.randomUUID() };
    if (await (target === 'new' ? dash.add(chart) : dash.replace(target, chart))) dash.clearFocus();
  };
  return <main className="dash" aria-label="Dashboard">
    <div className="dash-head"><div><h2>{data?.company.name ?? 'Dashboard'}</h2><p className="muted">{kpi.records} transactions · snapshot as of {kpi.asOf || 'loading'}</p></div>
      <button onClick={refresh} disabled={records.busy || dash.busy}>Refresh</button>
      <button onClick={() => { void dash.reset(); }} disabled={dash.busy || !dash.ready}>Reset charts</button>
      <button onClick={() => { setTarget('new'); dash.setFocus({ id: crypto.randomUUID(), title: 'New chart', groupBy: 'month', measure: 'spend', kind: 'bar' }); }} disabled={!data}>Add chart</button>
    </div>
    {(dash.error || records.error) && <div role="alert">{dash.error || records.error} <button disabled={dash.busy} onClick={() => { void dash.retry(); if (records.error) void records.refresh(); }}>Retry</button></div>}
    {dash.busy && <p role="status">Saving charts…</p>}
    <details className="copy-details"><summary>Details</summary><p>Vendor-bill totals exclude invoices and bank movements. Open amounts subtract linked payments only. These review records are not balanced financial statements; posting and reconciliation may be incomplete.</p></details>
    {data && <><div className="dash-kpis">
      <div><span>Vendor bills total</span><b>{money(kpi.billSpend)}</b></div><div><span>Vendor bills</span><b>{kpi.bills}</b></div>
      <div><span>Unpaid vendor bills</span><b>{money(kpi.payables)}</b></div><div><span>Overdue vendor bills</span><b>{money(kpi.overdue)}</b></div>
      <div><span>Unpaid invoices</span><b>{money(kpi.receivables)}</b></div><div><span>Bank deposits</span><b>{money(kpi.deposits)}</b></div><div><span>Bank withdrawals</span><b>{money(kpi.withdrawals)}</b></div>
    </div>
    {dash.focus ? <><button onClick={dash.clearFocus}>Back to charts</button>
      <ChartCard chart={dash.focus} data={data} busy={dash.busy} focused onChange={patch => dash.setFocus({ ...dash.focus!, ...patch })}>
        <label>Save to<select value={target} onChange={event => setTarget(event.target.value)}><option value="new">New chart</option>{dash.charts.map(chart => <option key={chart.id} value={chart.id}>Replace “{chart.title}”</option>)}</select></label>
        <button disabled={dash.busy || target === 'new' && dash.charts.length >= CHART_LIMIT} onClick={() => { void keep(); }}>Save chart</button>
        {target === 'new' && dash.charts.length >= CHART_LIMIT && <p role="status">Dashboard limit: {CHART_LIMIT} charts. Replace or remove a chart first.</p>}
      </ChartCard></> : !dash.ready ? <p role="status">Loading charts…</p> : <div className="dash-grid">
        {dash.charts.map(chart => <ChartCard key={chart.id} chart={chart} data={data} busy={dash.busy} onChange={patch => { void dash.update(chart.id, patch); }} onRemove={() => { void dash.remove(chart.id); }} />)}
        {!dash.charts.length && <p>No saved charts. Add a chart or reset the starters.</p>}
      </div>}
    </>}
    {!data && <p role="status">Loading company transactions…</p>}
  </main>;
}

/** Shared aggregation, rendering and controls for saved cards and the transient chart editor. */
function ChartCard({ chart, data, onChange, onRemove, busy, focused, children }: { chart: ChartSpec; data: CompanyBills; onChange: (patch: Partial<ChartSpec>) => void; onRemove?: () => void; busy: boolean; focused?: boolean; children?: import('react').ReactNode }) {
  const points = useMemo(() => aggregate(data.rows, chart), [data.rows, chart]);
  return <section className="card chart-card" aria-label={chart.title}>
    <div className="chart-head"><div>{focused ? <label>Chart title<input value={chart.title} maxLength={120} onChange={event => onChange({ title: event.target.value })} /></label> : <h3>{chart.title}</h3>}
      <p>{MEASURE_LABELS[chart.measure]} · <b>{formatValue(chart.measure, points.reduce((sum, point) => sum + point.value, 0))}</b></p>
      {focused && <label>Record IDs (optional)<input aria-label="Chart record IDs" placeholder="All applicable company records" value={chart.ids?.join(', ') ?? ''} onChange={event => onChange({ ids: event.target.value.trim() ? event.target.value.split(',').map(id => id.trim()).filter(Boolean) : undefined })} /></label>}
      {chart.source && <details className="copy-details"><summary>Details</summary><p>Question: {chart.source.question}<br />Model: {chart.source.model}<br />Created: {new Date(chart.source.at).toLocaleString()}</p></details>}
    </div>{onRemove && <button aria-label={`Remove ${chart.title}`} disabled={busy} onClick={onRemove}>Remove</button>}</div>
    <ChartView points={points} kind={chart.kind} measure={chart.measure} width={focused ? 1000 : 640} height={focused ? 300 : 200} />
    <div className="chart-controls">
      <label>Group by<select aria-label="Group by" value={chart.groupBy} disabled={busy} onChange={event => onChange({ groupBy: event.target.value as GroupBy })}>{Object.entries(GROUP_LABELS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
      <label>Measure<select aria-label="Measure" value={chart.measure} disabled={busy} onChange={event => onChange({ measure: event.target.value as Measure })}>{Object.entries(MEASURE_LABELS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
      <label>Chart<select aria-label="Chart" value={chart.kind} disabled={busy} onChange={event => onChange({ kind: event.target.value as ChartKind })}>{Object.entries(KIND_LABELS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
      {children}
    </div>
  </section>;
}
