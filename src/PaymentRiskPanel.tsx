import { useCallback, useEffect, useState } from 'react';
import { employeeById } from './employees';
import { formatCents } from './jevEvidence';
import type { RiskResult, RiskState } from './paymentRisk';

const EMPTY: RiskState = { results: {}, escalated: {} };
const TYPE = { bill: 'Bill', invoice: 'Invoice', bank: 'Bank' } as const;

/** Stored payment-risk results for one company, plus check and escalate. */
export function usePaymentRisk(companyId: string) {
  const [state, setState] = useState<RiskState>(EMPTY);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState('');
  const call = useCallback(async (path: string, body?: unknown) => {
    const response = await fetch(`/api/companies/${companyId}/payment-risk${path}`, body === undefined ? undefined : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const reply = await response.json();
    if (!response.ok) throw new Error(reply.error ?? 'Payment check failed.');
    setState(reply); setError('');
  }, [companyId]);
  useEffect(() => { setState(EMPTY); setError(''); if (companyId) void call('').catch(e => setError((e as Error).message)); }, [companyId, call]);
  const run = async (body: unknown, after?: () => void) => {
    setRunning(true);
    try { await call(body && typeof body === 'object' && 'as' in body ? '/escalate' : '/check', body); after?.(); }
    catch (e) { setError((e as Error).message); }
    finally { setRunning(false); }
  };
  return { ...state, running, error,
    check: (ids: string[] | 'all') => run(ids === 'all' ? { all: true } : { ids }),
    escalate: (as: string, ids: string[], after?: () => void) => run({ as, ids }, after) };
}
export type PaymentRiskController = ReturnType<typeof usePaymentRisk>;

export function PaymentRiskPanel({ c, loadedIds, totalCount, as, onInspect, onEscalated }: { c: PaymentRiskController; loadedIds: string[]; totalCount: number; as: string; onInspect: (id: string) => void; onEscalated: () => void }) {
  const results = Object.values(c.results);
  const bySuspicion = (a: RiskResult, b: RiskResult) => b.pSuspicious - a.pSuspicious;
  const suspicious = results.filter(r => r.verdict === 'suspicious').sort(bySuspicion);
  const unclear = results.filter(r => r.verdict === 'cannot_tell').sort(bySuspicion);
  const unclearWithSigns = unclear.filter(r => r.signals.length), unclearQuiet = unclear.filter(r => !r.signals.length);
  const pending = suspicious.filter(r => !c.escalated[r.id]);
  const lastChecked = results.reduce((latest, r) => r.checkedAt > latest ? r.checkedAt : latest, '');
  const sender = employeeById(as)?.name ?? 'you';
  const item = (r: RiskResult) => <li key={r.id}><button className="risk-item" onClick={() => onInspect(r.id)}>
    <span className="risk-item-top"><b>{r.summary.docNumber || r.summary.billId}</b>{r.summary.txnType && r.summary.txnType !== 'bill' && <span className="tag">{TYPE[r.summary.txnType]}</span>}<span>{r.summary.vendor}</span><span className="num">${formatCents(r.summary.amountCents)}</span><span className="muted">{r.summary.date}</span></span>
    <span className="risk-item-why">
      <span className={`result result-${r.verdict === 'suspicious' ? 'false' : 'uncertain'} risk-badge-${r.verdict}`}>Jev: {r.verdict === 'suspicious' ? 'suspicious' : "can't tell"} · {Math.round(r.pSuspicious * 100)}% suspicious</span>
      {r.signals.map(s => <span key={s} className="risk-signal">{s}</span>)}
      {c.escalated[r.id] && <span className="tag ok">Sent to Robert by {employeeById(c.escalated[r.id].by)?.name.split(' ')[0]}</span>}
    </span>
  </button></li>;
  return <section className="dashboard-board payment-risk" aria-label="Payment risk">
    <div className="dashboard-board-heading"><div><h2>Payment risk</h2><p className="small muted">Jev checks whether money is being sent to a bank account the business hasn't verified, using the vendor's details on file, the payment's destination and any change requests or evidence. Warning signs explain each result; they don't decide it.</p></div></div>
    <div className="risk-controls">
      <button className="primary" disabled={c.running || !loadedIds.length} onClick={() => void c.check(loadedIds)}>{c.running ? 'Checking…' : `Check loaded transactions (${loadedIds.length})`}</button>
      <button disabled={c.running} onClick={() => void c.check('all')}>Check all {totalCount}</button>
      {results.length > 0 && <span className="small muted">{suspicious.length} suspicious · {unclear.length} can't tell · {results.length - suspicious.length - unclear.length} safe · {results.length} checked{lastChecked && `, last ${new Date(lastChecked).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`}</span>}
    </div>
    {c.error && <div className="rules-notice error" role="alert">{c.error}</div>}
    {!results.length ? <p className="dashboard-empty">No checks yet. Unchanged transactions are not re-checked, so running again is cheap.</p> : <>
      <h3>Suspicious <b>{suspicious.length}</b></h3>
      {suspicious.length ? <>
        <ul className="risk-list">{suspicious.map(item)}</ul>
        <div className="risk-escalate">
          <button className="primary" disabled={c.running || !pending.length} onClick={() => void c.escalate(as, pending.map(r => r.id), onEscalated)}>{pending.length ? `Flag ${pending.length} and send to Robert Lindqvist (CFO)` : 'All suspicious transactions were sent'}</button>
          <span className="small muted">Adds the flag “Possible payment diversion” and sends one summary from {sender}. Nothing is emailed.</span>
        </div>
      </> : <p className="dashboard-empty">Nothing suspicious in what was checked.</p>}
      {unclearWithSigns.length > 0 && <><h3>Can't tell, with warning signs <b>{unclearWithSigns.length}</b></h3><ul className="risk-list">{unclearWithSigns.map(item)}</ul></>}
      {unclearQuiet.length > 0 && <details className="risk-quiet"><summary>Jev unsure, no warning signs ({unclearQuiet.length})</summary><ul className="risk-list">{unclearQuiet.map(item)}</ul></details>}
    </>}
  </section>;
}
