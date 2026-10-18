import { useState } from 'react';
import { money } from './chartMath';
import type { ChartKind, Measure, Point } from './charts';

const usdShort = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', notation: 'compact', maximumFractionDigits: 1 });
export const formatValue = (measure: Measure, v: number, short = false) => (measure === 'count' ? `${v} ${v === 1 ? 'transaction' : 'transactions'}` : short ? usdShort.format(v / 100) : money(v));

/** One series, drawn as SVG. Hover (or focus) a mark to see its exact value. */
export function ChartView({ points, kind, measure, height = 200, width = 640 }: { points: Point[]; kind: ChartKind; measure: Measure; height?: number; width?: number }) {
  const [hover, setHover] = useState<number | null>(null);
  if (!points.length || points.every(p => p.value === 0)) return <p className="chart-empty muted">No matching transactions to chart.</p>;
  const max = Math.max(...points.map(p => p.value), 1);

  if (kind === 'hbar') {
    return (
      <ul className="chart-hbars" role="list">
        {points.map((p, i) => (
          <li key={p.key} className={hover === i ? 'on' : ''} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)} title={`${p.label}: ${formatValue(measure, p.value)} · ${p.count} transactions`}>
            <span className="ch-label">{p.label}</span>
            <span className="ch-track"><span className="ch-fill" style={{ width: `${(p.value / max) * 100}%` }} /></span>
            <span className="ch-val">{formatValue(measure, p.value, true)}</span>
          </li>
        ))}
      </ul>
    );
  }

  // width/height set the shape: the drawing scales to the card's width, so a wider shape stays flatter.
  const W = width, H = height, pad = { l: 8, r: 8, t: 12, b: 26 };
  const innerW = W - pad.l - pad.r, innerH = H - pad.t - pad.b;
  const step = innerW / points.length;
  const x = (i: number) => pad.l + step * i + step / 2;
  const y = (v: number) => pad.t + innerH - (v / max) * innerH;
  const every = Math.ceil(points.length / 12);
  return (
    <div className="chart-svg">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={points.map(p => `${p.label} ${formatValue(measure, p.value)}`).join(', ')}>
        <line x1={pad.l} x2={W - pad.r} y1={pad.t + innerH} y2={pad.t + innerH} className="ch-axis" />
        {kind === 'line' && <polyline className="ch-line" points={points.map((p, i) => `${x(i)},${y(p.value)}`).join(' ')} />}
        {points.map((p, i) => (
          <g key={p.key} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
            <rect x={pad.l + step * i} y={pad.t} width={step} height={innerH} fill="transparent" />
            {kind === 'bar'
              ? <rect className={`ch-bar ${hover === i ? 'on' : ''}`} x={x(i) - step * 0.36} width={step * 0.72} y={y(p.value)} height={Math.max(1, pad.t + innerH - y(p.value))} rx={2} />
              : <circle className={`ch-dot ${hover === i ? 'on' : ''}`} cx={x(i)} cy={y(p.value)} r={hover === i ? 5 : 3.5} />}
            {i % every === 0 && <text x={x(i)} y={H - 8} textAnchor="middle" className="ch-tick">{p.label.length > 10 ? p.label.slice(0, 9) + '…' : p.label}</text>}
          </g>
        ))}
      </svg>
      {hover !== null && <div className="ch-tip" style={{ left: `${(x(hover) / W) * 100}%` }}><b>{points[hover].label}</b> {formatValue(measure, points[hover].value)} · {points[hover].count} transactions</div>}
    </div>
  );
}
