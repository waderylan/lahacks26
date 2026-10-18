import { useMemo } from 'react';
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
      <p className="dash-tip">Ask the <b>Ask your books</b> bubble a question, then use <b>📊 Graph this</b> on the answer to add a chart here or change one of these to answer it.</p>
      {!dash.ready ? <div className="state">Loading charts…</div> : (
        <div className="dash-grid">
          {dash.charts.map(c => <ChartCard key={c.id} chart={c} data={data} onChange={patch => dash.update(c.id, patch)} onRemove={() => dash.remove(c.id)} />)}
          {!dash.charts.length && <div className="state">No charts. Use Reset charts, or add one from the chat.</div>}
        </div>
      )}
    </div>
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
