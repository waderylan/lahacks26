import { useEffect, useRef, type ReactNode } from 'react';
import type { NewSearchMatch, SavedSearch } from './savedSearchTypes';

const time = (value: string) => new Date(value).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', second: '2-digit' });
const money = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });
type Controls = { busy: boolean; onToggle: (search: SavedSearch) => void; onCheck: (search: SavedSearch) => void; onNew: (search: SavedSearch) => void };

export function SearchMonitorControls({ search, busy, onToggle, onCheck, onNew }: Controls & { search: SavedSearch }) {
  const t = search.tracking;
  return <div className="search-monitor-controls">
    <label className="search-auto-label">Automatic checks <button type="button" role="switch" aria-checked={search.enabled} aria-label={`Automatic checks for ${search.name}`} disabled={busy} className={search.enabled ? 'search-switch on' : 'search-switch'} onClick={() => onToggle(search)}>{search.enabled ? 'On' : 'Off'}</button></label>
    <span className="search-check-status" role="status">{t.status === 'checking' ? t.lastCheckedAt ? 'Checking new or changed records…' : 'Checking existing records…' : t.status === 'error' ? 'Check failed.' : t.lastCheckedAt ? <>Last checked <time dateTime={t.lastCheckedAt} title={t.lastCheckedAt}>{time(t.lastCheckedAt)}</time></> : 'Not checked yet.'}</span>
    {t.status === 'error' && t.lastCheckedAt && <span className="saved-search-note">Last successful check: {time(t.lastCheckedAt)}</span>}
    {t.lastCheckedAt && <span>{t.matches} matches · {t.uncertain} uncertain</span>}
    <button disabled={busy || t.status === 'checking'} onClick={() => onCheck(search)}>{t.status === 'error' ? 'Retry check' : 'Check now'}</button>
    {t.newMatches > 0 && <button className="search-new-button" onClick={() => onNew(search)}>View new ({t.newMatches})</button>}
    {t.error && <p className="saved-search-error">{t.error}{search.enabled && t.retryAt && <> Next retry: {time(t.retryAt)}.</>}</p>}
  </div>;
}

export function SavedSearchLibrary({ companyName, searches, busy, onToggle, onCheck, onNew, onOpen, onEdit, onClose, children }: Controls & {
  companyName: string; searches: SavedSearch[]; onOpen: (search: SavedSearch) => void; onEdit: (search: SavedSearch) => void; onClose: () => void; children?: ReactNode;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => { dialog.current?.showModal(); }, []);
  return <dialog ref={dialog} className="saved-search-library" aria-labelledby="saved-search-library-title" onCancel={event => { event.preventDefault(); onClose(); }}>
    <header><div><h2 id="saved-search-library-title">All saved searches</h2><p>{companyName}</p></div><button aria-label="Close saved searches" onClick={onClose}>Close</button></header>
    <p className="search-monitor-explanation"><b>On</b> checks all company records every 10 seconds while the server runs, including when you close this page. The first check counts existing matches. Records that start matching later appear as <b>New</b> until you mark them seen.</p>
    {children}
    <div className="saved-search-list">{searches.map(search => <article key={search.id} aria-label={search.name} data-search-id={search.id}>
      <div className="saved-search-list-heading"><div><h3>{search.name}</h3><p className="saved-search-query">{search.definition.query || 'Filters only'}</p>
        <p className="saved-search-note">{{ all: 'All types', bill: 'Vendor bills', invoice: 'Customer invoices', bank: 'Bank transactions' }[search.definition.type]} · {{ all: 'Any status', needs_review: 'Needs review', reviewed: 'Reviewed', flagged: 'Flagged' }[search.definition.status]} · {search.definition.assignee === 'all' ? 'Anyone' : search.definition.assignee === 'unassigned' ? 'Unassigned' : search.definition.assignee}</p>
      </div><div className="saved-search-list-actions"><button disabled={busy} onClick={() => onOpen(search)}>Open</button><button disabled={busy} className="ghost" onClick={() => onEdit(search)}>Edit</button></div></div>
      <SearchMonitorControls search={search} busy={busy} onToggle={onToggle} onCheck={onCheck} onNew={onNew} />
    </article>)}</div>
    {!searches.length && <p className="saved-search-note">No saved searches for this company. Save a query and filters to add one.</p>}
  </dialog>;
}

export function NewSearchMatches({ name, matches, changedSinceCheck, busy, onInspect, onSeen }: {
  name: string; matches: NewSearchMatch[]; changedSinceCheck: boolean; busy: boolean; onInspect: (id: string) => void; onSeen: () => void;
}) {
  return <section className="new-search-matches" aria-label="New matches">
    <h3>{matches.length} new matches · {name}</h3><p>These records started matching after the first check. Mark them seen to clear their New badge.</p>
    {changedSinceCheck && <p className="saved-search-error">Some records changed since the last check. Check again to refresh them.</p>}
    <div className="new-search-table-wrap"><table aria-label="New matching transactions"><thead><tr><th>Transaction</th><th>Date</th><th>Amount</th></tr></thead><tbody>{matches.map(({ row }) => <tr key={row.id} data-id={row.id}><td><button className="bill-inspect" onClick={() => onInspect(row.id)}>{row.vendor}</button><small>{row.txnType === 'invoice' ? 'Invoice' : row.txnType === 'bank' ? 'Bank' : 'Bill'} · {row.docNumber || row.billId}</small></td><td>{row.date}</td><td>{money.format(row.amountCents / 100)}</td></tr>)}</tbody></table></div>
    {!matches.length && <p>No new matches to view.</p>}
    {matches.length > 0 && <button disabled={busy} className="primary" onClick={onSeen}>Mark {matches.length} as seen</button>}
  </section>;
}
