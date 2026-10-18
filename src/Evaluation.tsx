import { useEffect, useState } from 'react';

/** Evaluation tab: the team's benchmark scores (training/semantic-review) for every model on the same 370 labelled cases. Read-only. */
interface ModelScore {
  id: string; name: string; kind: string; key: string; ran: boolean;
  accuracy: number | null; macroF1: number | null; errors: number | null; falseMatches: number | null; uncertainRecall: number | null;
  matchBrier: number | null; scoreCoverage: number | null; batchP50Ms: number | null; costNanoUsd: string | null; tokens: number | null;
  byOrigin: Record<string, { n: number; accuracy: number }> | null;
  fullCompany: { bills: number | null; ms: number | null; costNanoUsd: string | null } | null;
}
interface Summary { cases: number; note: string; models: ModelScore[] }

const pct = (n: number | null) => (n == null ? '—' : `${(n * 100).toFixed(1)}%`);
const dollars = (nano: string | null) => (nano == null ? null : `$${(Number(BigInt(nano)) / 1e9).toFixed(4)}`);
const secs = (ms: number | null) => (ms == null ? '—' : ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(1)} s`);
const ORIGINS: Record<string, string> = { existing_authored_demo_holdout: 'Demo cases (150)', authored_overlay: 'Held-out synthetic (220)', synthetic_test_overlay: 'Held-out synthetic (220)' };

export function Evaluation() {
  const [data, setData] = useState<Summary | null>(null);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setError('');
    fetch('/api/evaluation', { signal: controller.signal }).then(async response => {
      if (!response.ok) throw new Error(response.status === 404 ? 'Restart the app server to load evaluation results.' : `Could not load evaluation results (${response.status}).`);
      const summary = await response.json();
      if (!Array.isArray(summary?.models)) throw new Error('Evaluation results could not be read.');
      return summary as Summary;
    }).then(setData, error => { if (!controller.signal.aborted) setError((error as Error).message); });
    return () => controller.abort();
  }, [attempt]);
  if (error) return <div className="state" role="alert">{error} <button onClick={() => setAttempt(value => value + 1)}>Retry</button></div>;
  if (!data) return <div className="state">Loading evaluation results…</div>;

  const ran = data.models.filter(m => m.ran).sort((a, b) => (b.accuracy ?? 0) - (a.accuracy ?? 0));
  const notRun = data.models.filter(m => !m.ran);
  const best = ran[0];
  const jev = ran.find(m => m.id === 'jev');
  const jevRank = jev ? ran.indexOf(jev) + 1 : null;
  const origins = [...new Set(ran.flatMap(m => Object.keys(m.byOrigin ?? {})))];

  return (
    <div className="dash">
      <div className="dash-head">
        <div>
          <h2>How Jev compares</h2>
          <p className="muted">{data.note}</p>
        </div>
      </div>

      {best && jev && (
        <section className="eval-takeaways">
          <div><span>Most accurate</span><b>{best.name}</b><small>{pct(best.accuracy)} exact accuracy</small></div>
          <div><span>Jev</span><b>{pct(jev.accuracy)}</b><small>{jevRank === 1 ? 'Most accurate of all models tested' : `#${jevRank} of ${ran.length} on accuracy`} · {jev.falseMatches} false matches</small></div>
          {jev.fullCompany && <div><span>Jev on a whole company</span><b>{jev.fullCompany.bills} bills in {secs(jev.fullCompany.ms)}</b><small>{dollars(jev.fullCompany.costNanoUsd) ?? 'cost unavailable'} · one judgment per bill, with a confidence score</small></div>}
          {jev.matchBrier != null && <div><span>Jev confidence quality</span><b>{jev.matchBrier.toFixed(3)}</b><small>Brier score on P(match), lower is better{ran.filter(m => m.matchBrier != null && m.id !== 'jev').length ? '' : '; other models give no probabilities'}</small></div>}
        </section>
      )}

      <section className="card">
        <h3>Same {data.cases} labelled cases, every model</h3>
        <table className="score">
          <thead><tr><th>Model</th><th>Accuracy</th><th>Macro F1</th><th>False matches</th><th>Invalid answers</th><th>Unclear cases caught</th><th>Typical batch time</th><th>Cost for {data.cases} cases</th></tr></thead>
          <tbody>
            {ran.map(m => (
              <tr key={m.id} className={m.id === 'jev' ? 'is-jev' : ''}>
                <td><b>{m.name}</b><div className="muted small">{m.kind} · {m.key}</div></td>
                <td className="num"><span className="meter"><span className="meter-track"><span style={{ width: `${(m.accuracy ?? 0) * 100}%` }} /></span>{pct(m.accuracy)}</span></td>
                <td className="num">{pct(m.macroF1)}</td>
                <td className="num">{m.falseMatches ?? '—'}</td>
                <td className="num">{m.errors ?? '—'}</td>
                <td className="num">{pct(m.uncertainRecall)}</td>
                <td className="num">{secs(m.batchP50Ms)}</td>
                <td className="num">{m.id === 'heuristic' ? '$0' : dollars(m.costNanoUsd) ?? (m.tokens != null ? `${m.tokens.toLocaleString()} tokens` : m.key === 'Veri GPU' ? 'GPU hours' : '—')}</td>
              </tr>
            ))}
            {notRun.map(m => <tr key={m.id} className="muted"><td><b>{m.name}</b><div className="small">{m.kind}</div></td><td colSpan={7}>Not run yet: <code>npm run benchmark:semantic -- {m.id}</code></td></tr>)}
          </tbody>
        </table>
        <p className="muted small">Batch times are product-workload timings for groups of up to 20 cases (Gemini: model response time only, not free-tier rate-limit waits), not equal-token engine benchmarks. Costs use different billing: Jev per request on the AI Gateway, Gemini per token on the Gemini key, Qwen per GPU hour.</p>
      </section>

      {origins.length > 0 && (
        <section className="card">
          <h3>Accuracy by case set</h3>
          <table className="score">
            <thead><tr><th>Model</th>{origins.map(o => <th key={o}>{ORIGINS[o] ?? o}</th>)}</tr></thead>
            <tbody>{ran.map(m => <tr key={m.id} className={m.id === 'jev' ? 'is-jev' : ''}><td><b>{m.name}</b></td>{origins.map(o => <td key={o} className="num">{pct(m.byOrigin?.[o]?.accuracy ?? null)}</td>)}</tr>)}</tbody>
          </table>
        </section>
      )}

      <section className="card">
        <h3>How to read this</h3>
        <ul className="notes">
          <li><b>Accuracy</b> is exact agreement with the authored label (match, no match or uncertain). <b>False matches</b> flag a bill that shouldn’t be flagged, the costly mistake in review.</li>
          <li><b>Jev</b> answers every bill independently with a probability, so the app can check whole companies in seconds and show confidence. <b>Gemini</b> reads a batch of bills in one prompt and returns labels only.</li>
          <li><b>Qwen</b> models were fine-tuned by the team on 1,000 examples; see <code>training/semantic-review/COMPARISON.md</code> for training details and limits.</li>
          <li>Labels were authored for this hackathon and not validated by an accountant. Re-run any model with <code>npm run benchmark:semantic -- &lt;model&gt;</code>; this page only reads saved results.</li>
        </ul>
      </section>
    </div>
  );
}
