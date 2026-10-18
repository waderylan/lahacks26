import { useCallback, useEffect, useRef, useState } from 'react';
import { EMPLOYEES, employeeById } from './employees';
import { formatCents } from './jevEvidence';
import { CHECKS, type CheckKind, type CheckResult, type CheckState } from './reviewChecks';

const EMPTY: CheckState = { results: {}, escalated: {} };
const TYPE = { bill: 'Bill', invoice: 'Invoice', bank: 'Bank' } as const;
const firstName = (id?: string) => employeeById(id)?.name.split(' ')[0] ?? 'someone';

/** Stored results of one Jev review check for one company, plus run and escalate. */
export function useReviewCheck(companyId: string, kind: CheckKind) {
  const [state, setState] = useState<CheckState>(EMPTY);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState('');
  // A slow reply for a company we've since left must not land in the current one.
  const current = useRef(companyId); current.current = companyId;
  const call = useCallback(async (path: string, body?: unknown) => {
    const response = await fetch(`/api/companies/${companyId}/checks/${kind}${path}`, body === undefined ? undefined : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const reply = await response.json();
    if (!response.ok) throw new Error(reply.error ?? 'Check failed.');
    if (current.current !== companyId) return false;
    setState(reply); setError(''); return true;
  }, [companyId, kind]);
  useEffect(() => { setState(EMPTY); setError(''); setRunning(false); if (companyId) void call('').catch(e => { if (current.current === companyId) setError((e as Error).message); }); }, [companyId, call]);
  const run = async (path: string, body: unknown, after?: () => void) => {
    const scope = companyId;
    setRunning(true);
    try { if (await call(path, body)) after?.(); }
    catch (e) { if (current.current === scope) setError((e as Error).message); }
    finally { if (current.current === scope) setRunning(false); }
  };
  return { ...state, kind, running, error,
    check: (ids: string[] | 'all') => run('/run', ids === 'all' ? { all: true } : { ids }),
    escalate: (as: string, to: string, ids: string[], after?: () => void) => run('/escalate', { as, to, ids }, after) };
}
export type ReviewCheckController = ReturnType<typeof useReviewCheck>;

export function ReviewCheckPanel({ c, loadedIds, totalCount, as, onInspect, onEscalated }: { c: ReviewCheckController; loadedIds: string[]; totalCount: number; as: string; onInspect: (id: string) => void; onEscalated: () => void }) {
  const info = CHECKS[c.kind];
  const [to, setTo] = useState(info.escalateTo);
  useEffect(() => setTo(CHECKS[c.kind].escalateTo), [c.kind]);
  const results = Object.values(c.results);
  const byFlag = (a: CheckResult, b: CheckResult) => b.pFlag - a.pFlag;
  const flagged = results.filter(r => r.verdict === 'flag').sort(byFlag);
  const unsure = results.filter(r => r.verdict === 'unsure').sort(byFlag);
  const unsureWithSigns = unsure.filter(r => r.signals.length), unsureQuiet = unsure.filter(r => !r.signals.length);
  const pending = flagged.filter(r => !c.escalated[r.id]);
  const lastChecked = results.reduce((latest, r) => r.checkedAt > latest ? r.checkedAt : latest, '');
  const Flagged = info.flagged[0].toUpperCase() + info.flagged.slice(1);
  const item = (r: CheckResult) => <li key={r.id}><button className="risk-item" onClick={() => onInspect(r.id)}>
    <span className="risk-item-top"><b>{r.summary.docNumber || r.summary.billId}</b>{r.summary.txnType && r.summary.txnType !== 'bill' && <span className="tag">{TYPE[r.summary.txnType]}</span>}<span>{r.summary.vendor}</span><span className="num">${formatCents(r.summary.amountCents)}</span><span className="muted">{r.summary.date}</span></span>
    <span className="risk-item-why">
      <span className={`result result-${r.verdict === 'flag' ? 'false' : 'uncertain'} risk-badge-${r.verdict}`}>Jev: {r.verdict === 'flag' ? info.flagged : info.unsure} · {Math.round(r.pFlag * 100)}% {info.flagged}</span>
      {r.original && <span className="risk-original">Repeats {r.original.docNumber || r.original.billId} · {r.original.date} · ${formatCents(r.original.amountCents)}</span>}
      {r.signals.map(s => <span key={s} className="risk-signal">{s}</span>)}
      {c.escalated[r.id] && <span className="tag ok">Sent to {firstName(c.escalated[r.id].to ?? info.escalateTo)} by {firstName(c.escalated[r.id].by)}</span>}
    </span>
  </button></li>;
  return <section className="dashboard-board payment-risk" aria-label={info.title}>
    <div className="dashboard-board-heading"><div><h2>{info.title}</h2><p className="small muted">{info.intro} Warning signs explain each result; they don't decide it.{info.needs && ` ${info.needs}`}</p></div></div>
    <div className="risk-controls">
      <button className="primary" disabled={c.running || !loadedIds.length} onClick={() => void c.check(loadedIds)}>{c.running ? 'Checking…' : `Check loaded transactions (${loadedIds.length})`}</button>
      <button disabled={c.running} onClick={() => void c.check('all')}>Check all {totalCount}</button>
      {results.length > 0 && <span className="small muted">{flagged.length} {info.flagged} · {unsure.length} {info.unsure} · {results.length - flagged.length - unsure.length} clear · {results.length} checked{lastChecked && `, last ${new Date(lastChecked).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`}</span>}
    </div>
    {c.error && <div className="rules-notice error" role="alert">{c.error}</div>}
    {!results.length ? <p className="dashboard-empty">No checks yet. Unchanged transactions are not re-checked, so running again is cheap.</p> : <>
      <h3>{Flagged} <b>{flagged.length}</b></h3>
      {flagged.length ? <>
        <ul className="risk-list">{flagged.map(item)}</ul>
        <div className="risk-escalate">
          <label className="small">Send to <select aria-label="Send flagged transactions to" value={to} onChange={event => setTo(event.target.value)}>{EMPLOYEES.map(e => <option key={e.id} value={e.id}>{e.name} — {e.title}</option>)}</select></label>
          <button className="primary" disabled={c.running || !pending.length} onClick={() => void c.escalate(as, to, pending.map(r => r.id), onEscalated)}>{pending.length ? `Flag ${pending.length} and send to ${firstName(to)}` : `All ${info.flagged} transactions were sent`}</button>
          <span className="small muted">Adds the flag “{info.flag}” and sends one summary from {employeeById(as)?.name ?? 'you'}. Nothing is emailed.</span>
        </div>
      </> : <p className="dashboard-empty">Nothing {info.flagged} in what was checked.</p>}
      {unsureWithSigns.length > 0 && <><h3>{info.unsure[0].toUpperCase() + info.unsure.slice(1)}, with warning signs <b>{unsureWithSigns.length}</b></h3><ul className="risk-list">{unsureWithSigns.map(item)}</ul></>}
      {unsureQuiet.length > 0 && <details className="risk-quiet"><summary>Jev unsure, no warning signs ({unsureQuiet.length})</summary><ul className="risk-list">{unsureQuiet.map(item)}</ul></details>}
    </>}
  </section>;
}
