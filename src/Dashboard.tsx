import { useMemo, useState } from 'react';
import { aggregate, GROUP_LABELS, KIND_LABELS, MEASURE_LABELS, type ChartKind, type ChartSpec, type GroupBy, type Measure } from './charts';
import { ChartView, formatValue } from './ChartView';
import { useDashboard } from './dashboardStore';
import { asOfDate, modelLabel, money, openCents, sumCents, useFullBills, type ChatModel } from './insights';
import type { CompanyBills } from './types';

/** Dashboard tab: starter charts from the books, plus charts added or changed from the chat bubble. */
export function Dashboard({ companyId }: { companyId: string }) {
  const { data, error } = useFullBills(companyId);
  if (error) return <div className="state">Could not load bills ({error}).</div>;
  if (!data) return <div className="state">Loading the full year of bills…</div>;
  if (!data.rows.length) return <div className="state">This company has no bills.</div>;
  return <DashboardBody data={data} />;
}

function DashboardBody({ data }: { data: CompanyBills }) {
  const dash = useDashboard(data.company.companyId);
  const rows = data.rows;
  const kpi = useMemo(() => {
    const asOf = asOfDate(rows);
    const open = rows.filter(r => openCents(r) > 0);
    return { total: sumCents(rows), asOf, open: open.reduce((s, r) => s + openCents(r), 0), overdue: open.filter(r => r.dueDate < asOf).reduce((s, r) => s + openCents(r), 0), first: rows[0].date, last: rows[rows.length - 1].date };
  }, [rows]);
  return (
    <div className="dash">
      <div className="dash-head">
        <div>
          <h2>{data.company.name}</h2>
          <p className="muted">{data.company.industry} · {rows.length} bills, {kpi.first} → {kpi.last} · balances as of {kpi.asOf}</p>
        </div>
        <button className="ghost" onClick={dash.reset} title="Restore the four starter charts">Reset charts</button>
      </div>
      <div className="dash-kpis">
        <div><span>Billed spend</span><b>{money(kpi.total)}</b></div>
        <div><span>Bills</span><b>{rows.length}</b></div>
        <div><span>Open payables</span><b>{money(kpi.open)}</b></div>
        <div><span>Overdue</span><b className={kpi.overdue ? 'warn' : ''}>{money(kpi.overdue)}</b></div>
      </div>
      {dash.focus ? <FocusChart chart={dash.focus} data={data} charts={dash.charts} onChange={patch => dash.setFocus({ ...dash.focus!, ...patch })} onRefresh={dash.clearFocus} onKeep={target => { const c = { ...dash.focus!, id: crypto.randomUUID() }; if (target === 'new') dash.add(c); else dash.replace(target, c); dash.clearFocus(); }} /> : <>
      <p className="dash-tip">Ask the <b>Ask your books</b> bubble for a graph (for example “graph utilities by month” or “chart spend by vendor”) and it shows here on its own. <b>↻ Refresh</b> brings these charts back.</p>
      {!dash.ready ? <div className="state">Loading charts…</div> : (
        <div className="dash-grid">
          {dash.charts.map(c => <ChartCard key={c.id} chart={c} data={data} onChange={patch => dash.update(c.id, patch)} onRemove={() => dash.remove(c.id)} />)}
          {!dash.charts.length && <div className="state">No charts. Use Reset charts, or add one from the chat.</div>}
        </div>
      )}
      </>}
    </div>
  );
}

/** The one chart answering the latest chat graph question; Refresh returns to the dashboard charts. */
function FocusChart({ chart, data, charts, onChange, onRefresh, onKeep }: { chart: ChartSpec; data: CompanyBills; charts: ChartSpec[]; onChange: (patch: Partial<ChartSpec>) => void; onRefresh: () => void; onKeep: (target: string) => void }) {
  const [target, setTarget] = useState('new');
  const points = useMemo(() => aggregate(data.rows, chart), [data.rows, chart]);
  const total = points.reduce((s, p) => s + p.value, 0);
  return (
    <>
    <div className="focus-bar">
      <button className="primary" onClick={onRefresh} title="Go back to the dashboard charts">↻ Refresh</button>
      <span className="muted small">Showing only the chart for your chat question. Refresh brings back the dashboard charts.</span>
    </div>
    <section className="card chart-card focus-chart from-chat">
      <div className="chart-head">
        <div>
          <span className="focus-label">Answer from the chat</span>
          <h3>{chart.title}</h3>
          <p className="muted small">{chart.source && <>“{chart.source.question}” · bills picked by {modelLabel(chart.source.model as ChatModel)} · </>}{chart.ids ? chart.ids.length : data.rows.length} bills · <b>{formatValue(chart.measure, total)}</b></p>
        </div>
      </div>
      <ChartView points={points} kind={chart.kind} measure={chart.measure} width={1000} height={300} />
      <div className="chart-controls">
        <label>Group by<select value={chart.groupBy} onChange={e => onChange({ groupBy: e.target.value as GroupBy, kind: e.target.value === 'vendor' || e.target.value === 'account' ? 'hbar' : chart.kind === 'hbar' ? 'bar' : chart.kind })}>{Object.entries(GROUP_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
        <label>Measure<select value={chart.measure} onChange={e => onChange({ measure: e.target.value as Measure })}>{Object.entries(MEASURE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
        <label>Chart<select value={chart.kind} onChange={e => onChange({ kind: e.target.value as ChartKind })}>{Object.entries(KIND_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
        <span className="spacer" />
        <label>Keep it<select value={target} onChange={e => setTarget(e.target.value)}><option value="new">as a new dashboard chart</option>{charts.map(c => <option key={c.id} value={c.id}>instead of “{c.title}”</option>)}</select></label>
        <button onClick={() => onKeep(target)}>Keep on dashboard</button>
      </div>
    </section>
    </>
  );
}

function ChartCard({ chart, data, onChange, onRemove }: { chart: ChartSpec; data: CompanyBills; onChange: (patch: Partial<ChartSpec>) => void; onRemove: () => void }) {
  const points = useMemo(() => aggregate(data.rows, chart), [data.rows, chart]);
  const total = points.reduce((s, p) => s + p.value, 0);
  const billCount = chart.ids ? chart.ids.length : data.rows.length;
  return (
    <section className={`card chart-card ${chart.source ? 'from-chat' : ''}`}>
      <div className="chart-head">
        <div>
          <h3>{chart.title}</h3>
          <p className="muted small">
            {chart.source ? <>From chat · “{chart.source.question}” · bills picked by {modelLabel(chart.source.model as ChatModel)} · {billCount} bills</> : <>All {billCount} bills</>}
            {' · '}<b>{formatValue(chart.measure, total)}</b>
          </p>
        </div>
        <button className="icon-btn" title={chart.starter ? 'Remove this chart (Reset charts brings it back)' : 'Remove this chart'} onClick={onRemove} aria-label={`Remove ${chart.title}`}>✕</button>
      </div>
      <ChartView points={points} kind={chart.kind} measure={chart.measure} />
      <div className="chart-controls">
        <label>Group by<select value={chart.groupBy} onChange={e => onChange({ groupBy: e.target.value as GroupBy, kind: e.target.value === 'vendor' || e.target.value === 'account' ? 'hbar' : chart.kind === 'hbar' ? 'bar' : chart.kind })}>{Object.entries(GROUP_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
        <label>Measure<select value={chart.measure} onChange={e => onChange({ measure: e.target.value as Measure })}>{Object.entries(MEASURE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
        <label>Chart<select value={chart.kind} onChange={e => onChange({ kind: e.target.value as ChartKind })}>{Object.entries(KIND_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
      </div>
    </section>
  );
}
