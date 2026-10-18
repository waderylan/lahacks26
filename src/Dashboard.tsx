import { useMemo, useState } from 'react';
import { aggregate, CHART_LIMIT, GROUP_LABELS, KIND_LABELS, MEASURE_LABELS, type ChartKind, type ChartSpec, type GroupBy, type Measure } from './charts';
import { ChartView, formatValue } from './ChartView';
import { useDashboard } from './dashboardStore';
import { dashboardTotals, money } from './chartMath';
import { modelLabel, type ChatModel } from './insights';
import { useFullRecords } from './useFullRecords';
import type { CompanyBills } from './types';

/** Dashboard tab: starter charts from the books, plus charts added or changed from the chat bubble. */
export function Dashboard({ companyId }: { companyId: string }) {
  const records = useFullRecords(companyId);
  if (records.error && !records.data) return <div className="state">Could not load bills ({records.error}). <button onClick={() => { void records.refresh(); }}>Retry</button></div>;
  if (!records.data) return <div className="state">Loading the full year of bills…</div>;
  if (!records.data.rows.length) return <div className="state">This company has no bills.</div>;
  return <DashboardBody data={records.data} reload={() => { void records.refresh(); }} reloading={records.busy} />;
}

function DashboardBody({ data, reload, reloading }: { data: CompanyBills; reload: () => void; reloading: boolean }) {
  const dash = useDashboard(data.company.companyId);
  const rows = data.rows;
  const kpi = useMemo(() => dashboardTotals(rows), [rows]);
  const dates = useMemo(() => rows.map(r => r.date).sort(), [rows]);
  const keep = async (target: string) => {
    if (!dash.focus) return;
    const chart = { ...dash.focus, id: crypto.randomUUID() };
    if (await (target === 'new' ? dash.add(chart) : dash.replace(target, chart))) dash.clearFocus();
  };
  return (
    <div className="dash">
      <div className="dash-head">
        <div>
          <h2>{data.company.name}</h2>
          <p className="muted">{data.company.industry} · {kpi.bills} bills, {dates[0]} → {dates[dates.length - 1]} · balances as of {kpi.asOf}</p>
        </div>
        <div className="dash-actions">
          <button className="ghost" disabled={reloading || dash.busy} onClick={() => { reload(); void dash.refresh(); }} title="Reload the latest bills and saved charts">Refresh dashboard</button>
          <button className="ghost" disabled={dash.busy} onClick={() => dash.setFocus({ id: crypto.randomUUID(), title: 'New chart', groupBy: 'month', measure: 'spend', kind: 'bar' })} title="Build a chart by hand">Add chart</button>
          <button className="ghost" disabled={dash.busy || !dash.ready} onClick={() => { void dash.reset(); }} title="Restore the four starter charts">Reset charts</button>
        </div>
      </div>
      <div className="dash-kpis">
        <div><span>Billed spend</span><b>{money(kpi.billSpend)}</b></div>
        <div><span>Bills</span><b>{kpi.bills}</b></div>
        <div><span>Open payables</span><b>{money(kpi.payables)}</b></div>
        <div><span>Overdue</span><b className={kpi.overdue ? 'warn' : ''}>{money(kpi.overdue)}</b></div>
      </div>
      {dash.error && <p className="err small" role="alert">{dash.error} <button className="linkish" disabled={dash.busy} onClick={() => { void dash.retry(); }}>Retry</button></p>}
      {dash.focus ? <FocusChart chart={dash.focus} data={data} charts={dash.charts} busy={dash.busy} onChange={patch => dash.setFocus({ ...dash.focus!, ...patch })} onRefresh={dash.clearFocus} onKeep={target => { void keep(target); }} /> : <>
      <p className="dash-tip">Ask the <b>Ask your books</b> bubble for a graph (for example “graph utilities by month” or “chart spend by vendor”) and it shows here on its own. <b>↻ Refresh</b> brings these charts back.</p>
      {!dash.ready ? <div className="state">Loading charts…</div> : (
        <div className="dash-grid">
          {dash.charts.map(c => <ChartCard key={c.id} chart={c} data={data} busy={dash.busy} onChange={patch => { void dash.update(c.id, patch); }} onRemove={() => { void dash.remove(c.id); }} />)}
          {!dash.charts.length && <div className="state">No charts. Use Reset charts, or add one from the chat.</div>}
        </div>
      )}
      </>}
    </div>
  );
}

/** The one chart answering the latest chat graph question; Refresh returns to the dashboard charts. */
function FocusChart({ chart, data, charts, busy, onChange, onRefresh, onKeep }: { chart: ChartSpec; data: CompanyBills; charts: ChartSpec[]; busy: boolean; onChange: (patch: Partial<ChartSpec>) => void; onRefresh: () => void; onKeep: (target: string) => void }) {
  const [target, setTarget] = useState('new');
  const points = useMemo(() => aggregate(data.rows, chart), [data.rows, chart]);
  const total = points.reduce((s, p) => s + p.value, 0);
  const full = target === 'new' && charts.length >= CHART_LIMIT;
  return (
    <>
    <div className="focus-bar">
      <button className="primary" onClick={onRefresh} title="Go back to the dashboard charts">↻ Refresh</button>
      <span className="muted small">{chart.source ? 'Showing only the chart for your chat question.' : 'Building a new chart.'} Refresh brings back the dashboard charts.</span>
    </div>
    <section className="card chart-card focus-chart from-chat">
      <div className="chart-head">
        <div>
          <span className="focus-label">{chart.source ? 'Answer from the chat' : 'New chart'}</span>
          {chart.source ? <h3>{chart.title}</h3> : <label className="chart-field">Chart title<input value={chart.title} maxLength={120} onChange={e => onChange({ title: e.target.value })} /></label>}
          <p className="muted small">{chart.source && <>“{chart.source.question}” · bills picked by {modelLabel(chart.source.model as ChatModel)} · </>}{points.reduce((s, p) => s + p.count, 0)} {chart.measure === 'count' ? 'transactions' : 'bills'} · <b>{formatValue(chart.measure, total)}</b></p>
          {!chart.source && <label className="chart-field">Only these bills (optional)<input aria-label="Chart record IDs" placeholder="All bills; or comma-separated bill IDs" value={chart.ids?.join(', ') ?? ''} onChange={e => onChange({ ids: e.target.value.trim() ? e.target.value.split(',').map(id => id.trim()).filter(Boolean) : undefined })} /></label>}
        </div>
      </div>
      <ChartView points={points} kind={chart.kind} measure={chart.measure} width={1000} height={300} />
      <div className="chart-controls">
        <ChartControls chart={chart} busy={busy} onChange={onChange} />
        <span className="spacer" />
        <label>Keep it<select value={target} onChange={e => setTarget(e.target.value)}><option value="new">as a new dashboard chart</option>{charts.map(c => <option key={c.id} value={c.id}>instead of “{c.title}”</option>)}</select></label>
        <button disabled={busy || full} onClick={() => onKeep(target)}>Keep on dashboard</button>
        {full && <span className="muted small">The dashboard holds {CHART_LIMIT} charts; replace or remove one first.</span>}
      </div>
    </section>
    </>
  );
}

function ChartCard({ chart, data, busy, onChange, onRemove }: { chart: ChartSpec; data: CompanyBills; busy: boolean; onChange: (patch: Partial<ChartSpec>) => void; onRemove: () => void }) {
  const points = useMemo(() => aggregate(data.rows, chart), [data.rows, chart]);
  const total = points.reduce((s, p) => s + p.value, 0);
  // Count what the chart actually includes (e.g. spend charts skip invoices and bank lines).
  const billCount = points.reduce((s, p) => s + p.count, 0);
  return (
    <section className={`card chart-card ${chart.source ? 'from-chat' : ''}`}>
      <div className="chart-head">
        <div>
          <h3>{chart.title}</h3>
          <p className="muted small">
            {chart.source ? <>From chat · “{chart.source.question}” · bills picked by {modelLabel(chart.source.model as ChatModel)} · {billCount} {chart.measure === 'count' ? 'transactions' : 'bills'}</> : <>{billCount} {chart.measure === 'count' ? 'transactions' : 'bills'}</>}
            {' · '}<b>{formatValue(chart.measure, total)}</b>
          </p>
        </div>
        <button className="icon-btn" disabled={busy} title={chart.starter ? 'Remove this chart (Reset charts brings it back)' : 'Remove this chart'} onClick={onRemove} aria-label={`Remove ${chart.title}`}>✕</button>
      </div>
      <ChartView points={points} kind={chart.kind} measure={chart.measure} />
      <div className="chart-controls"><ChartControls chart={chart} busy={busy} onChange={onChange} /></div>
    </section>
  );
}

/** Group by / measure / chart type; vendor and account groupings switch to horizontal bars, as before. */
function ChartControls({ chart, busy, onChange }: { chart: ChartSpec; busy: boolean; onChange: (patch: Partial<ChartSpec>) => void }) {
  return <>
    <label>Group by<select value={chart.groupBy} disabled={busy} onChange={e => onChange({ groupBy: e.target.value as GroupBy, kind: e.target.value === 'vendor' || e.target.value === 'account' ? 'hbar' : chart.kind === 'hbar' ? 'bar' : chart.kind })}>{Object.entries(GROUP_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
    <label>Measure<select value={chart.measure} disabled={busy} onChange={e => onChange({ measure: e.target.value as Measure })}>{Object.entries(MEASURE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
    <label>Chart<select value={chart.kind} disabled={busy} onChange={e => onChange({ kind: e.target.value as ChartKind })}>{Object.entries(KIND_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
  </>;
}
