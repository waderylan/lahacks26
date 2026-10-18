import { useEffect, useRef, useState } from 'react';
import { actionLabel, draftSender, messageBills, emptyTransaction, evaluateTree, type DraftMessage, type LocalTransaction, type Outcome, type RuleNode, type Snapshot } from './rules';
import type { RulesController } from './useRules';
import { employeeById } from './employees';
const labels = { all: 'AND', any: 'OR', not: 'NOT', ai: 'English condition', standard: 'Filter' };

export function ResultBadge({ value }: { value: Outcome }) { return <span className={`result result-${value}`}>{value === 'true' ? 'Match' : value === 'false' ? 'No match' : value === 'error' ? 'Failed' : value === 'pending' ? 'Checking' : 'Uncertain'}</span>; }

export function RuleHistory({ c, companyId, onOpen }: { c: RulesController; companyId: string; onOpen?: (transactionId: string) => void }) {
  const [tab, setTab] = useState<'history' | 'replay' | 'messages'>('history');
  const [open, setOpen] = useState(false);
  const history = c.store.history.filter(h => h.companyId === companyId);
  const messages = (c.store.messages ?? []).filter(m => m.companyId === companyId);
  const pending = messages.filter(m => m.status === 'pending').length;
  return <section className={`rule-history ${open ? 'expanded' : ''}`} aria-label="Action history"><div className="history-toolbar"><button aria-expanded={open} onClick={() => setOpen(!open)}>{open ? '▾' : '▸'} Activity <b>{history.length}</b></button><button className={tab === 'history' ? 'active' : 'ghost'} onClick={() => { setTab('history'); setOpen(true); }}>Action history</button><button className={tab === 'messages' ? 'active' : 'ghost'} onClick={() => { setTab('messages'); setOpen(true); }}>Messages{pending ? ` · ${pending}` : ''}</button><button className={tab === 'replay' ? 'active' : 'ghost'} onClick={() => { setTab('replay'); setOpen(true); }}>Replay log</button><span className="spacer" /><button disabled={c.busy || !c.remaining || Boolean(c.storageError)} onClick={() => { setTab('replay'); setOpen(true); void c.replay(); }}>{c.busy ? 'Evaluating replay…' : 'Replay next original bill'} <b>({c.remaining})</b></button><button className="ghost" disabled={c.busy || Boolean(c.storageError)} onClick={c.reset}>Reset demo action state</button></div>
    {open && <div className="history-body">{tab === 'messages' ? messages.length ? messages.map(m => <MessageCard key={m.id} message={m} actor={c.actor} onDecide={c.decideMessage} onRetry={c.retryDraft} onOpen={onOpen} />) : <p className="muted">No drafts yet. Add a Draft internal message action, save, and run the rule.</p> : tab === 'history' ? history.length ? history.map(h => <div className="history-entry" key={h.id}>
      <div><b>{h.transactionId.split(':').pop()}</b> · {h.action ? actionLabel(h.action) : `Rule result: ${h.snapshot.result}`}<span className="muted"> · {h.ruleName} r{h.revision} · {h.source} · {new Date(h.timestamp).toLocaleTimeString()}</span>
        <div className="small muted">{h.action && `${JSON.stringify(h.previous)} → ${JSON.stringify(h.resulting)} · `}Version {h.transactionVersion} · Rule result: {h.snapshot.result}</div>
        {h.snapshot.expression && <details className="history-evidence"><summary>View condition results</summary><RuleEvidence node={h.snapshot.expression} snapshot={h.snapshot} /></details>}
      </div>{h.action && <button disabled={Boolean(h.undoneAt) || c.busy} onClick={() => c.undo(h.id)}>{h.undoneAt ? 'Undone' : 'Undo'}</button>}
    </div>) : <p className="muted">No actions yet. Save a rule and run it on the current preview.</p> : <><p className="small muted">Replay of reserved, unmodified original bills. No live QuickBooks connection.</p>{c.automation.length ? c.automation.map((line, i) => <p key={i}>{line}</p>) : <p className="muted">Enable a saved rule, then replay an original bill.</p>}<button disabled={c.busy} onClick={c.retryAutomation}>Retry failed automation</button></>}</div>}
  </section>;
}

export function RuleEvidence({ node, snapshot }: { node: RuleNode; snapshot: Snapshot }) {
  return <div className="evidence-node"><div><ResultBadge value={evaluateTree(node, snapshot.conditions)} /> <b>{'children' in node ? labels[node.type] : node.type === 'ai' ? node.label || 'AI condition' : `${node.field === 'review' ? 'Review status' : node.field} ${node.operator} ${node.value}`}</b></div>{'children' in node ? node.children.map(n => <RuleEvidence key={n.id} node={n} snapshot={snapshot} />) : node.type === 'ai' && <p>{node.text}</p>}</div>;
}

export function LocalStateEditor({ value, update }: { value?: LocalTransaction; update: (value: LocalTransaction) => void }) {
  const tx = value ?? emptyTransaction();
  return <div className="local-editor"><label>Assigned to<input key={`owner-${tx.owner}`} aria-label="Bill assignment" defaultValue={tx.owner} onBlur={event => { if (event.target.value !== tx.owner) update({ ...tx, owner: event.target.value }); }} /></label><label>Flags (comma separated)<input key={`flags-${JSON.stringify(tx.flags)}`} aria-label="Bill flags" defaultValue={tx.flags.join(', ')} onBlur={e => update({ ...tx, flags: [...new Set(e.target.value.split(',').map(s => s.trim()).filter(Boolean))] })} /></label><label>Tags (comma separated)<input key={`tags-${JSON.stringify(tx.tags)}`} aria-label="Bill tags" defaultValue={tx.tags.join(', ')} onBlur={e => update({ ...tx, tags: [...new Set(e.target.value.split(',').map(s => s.trim()).filter(Boolean))] })} /></label><label className="check"><input type="checkbox" checked={tx.automatedCheck} onChange={e => update({ ...tx, automatedCheck: e.target.checked })} /> Passed automated check</label><p className="small muted">Saved in SQLite. Automated check does not mark a bill human reviewed.</p></div>;
}

const MESSAGE_STATUS = { pending: 'Pending approval', approved: 'Sent to inbox · not emailed', rejected: 'Rejected · not sent' };

/** `actor` is the signed-in employee; only the draft's sender can approve, edit or reject it. */
export function MessageCard({ message, actor, onDecide, onRetry, onOpen }: { message: DraftMessage; actor?: string; onDecide: (id: string, status: 'approved' | 'rejected', body?: string) => void; onRetry?: (id: string) => void; onOpen?: (transactionId: string) => void }) {
  const sender = draftSender(message), senderName = employeeById(sender)?.name ?? 'the sender';
  const canDecide = !actor || actor === sender;
  const waiting = <p className="muted">Awaiting {senderName}'s approval</p>;
  const [editing, setEditing] = useState(false);
  const [open, setOpen] = useState(message.status === 'pending');
  const [draft, setDraft] = useState(message.body);
  useEffect(() => { if (!editing) setDraft(message.body); }, [message.body, editing]);
  const done = message.status !== 'pending';
  const generation = message.generation ?? 'ready';
  const employee = employeeById(message.employeeId);
  if (generation !== 'ready' && !done) return <article className={`message-card status-${generation === 'error' ? 'rejected' : 'pending'}`} aria-label={`Draft message for ${messageBills(message)}`}>
    <div className="message-card-head">
      <span className="message-icon" aria-hidden>✉</span>
      <div>
        <div className="message-meta"><span>Message</span><span className="message-status">{generation === 'error' ? 'Draft failed' : message.routing === 'jev' && !message.employeeId ? 'Jev is choosing a recipient…' : 'Gemini is writing…'}</span></div>
        <h3>{messageBills(message)} · {message.ruleName} r{message.revision}</h3>
        <p className="muted">Request: {message.request}</p>
        {generation === 'error' && <p className="muted">{message.generationError}</p>}
      </div>
    </div>
    <div className="message-actions">
      {generation === 'error' && onRetry && <button className="primary" onClick={() => onRetry(message.id)}>Retry</button>}
      {canDecide && <button className="ghost" onClick={() => onDecide(message.id, 'rejected')}>Discard</button>}
    </div>
  </article>;
  return <article className={`message-card status-${message.status}`} aria-label={`Draft message to ${message.to}`}>
    <div className="message-card-head">
      <span className="message-icon" aria-hidden>✉</span>
      <div>
        <div className="message-meta"><span>Message</span><span className={`message-status status-${message.status}`}>{MESSAGE_STATUS[message.status]}</span>{message.edited && <span className="muted">· edited</span>}</div>
        <h3>{message.subject}</h3>
        <p className="muted">From {senderName} · To {message.to}{employee && ` · ${employee.title}`} · {messageBills(message)} · {message.ruleName} r{message.revision}</p>
        {message.routing === 'jev' && employee && <p className="muted" title={employee.description}>Recipient chosen by Jev{Number.isFinite(message.routingProbability) && ` · ${Math.round(message.routingProbability! * 100)}% confidence`}</p>}
        {message.request && <p className="muted">Request: {message.request}</p>}
        <MessageEvidence message={message} onOpen={onOpen} />
        <p className="muted">{message.reason}</p>
      </div>
    </div>
    {!editing && <button className="ghost" onClick={() => setOpen(o => !o)}>{open ? 'Hide draft' : 'View draft'}</button>}
    {editing ? <textarea aria-label="Edit draft message" value={draft} onChange={e => setDraft(e.target.value)} rows={Math.min(12, draft.split('\n').length + 2)} /> : open && <pre className="message-body">{message.body}</pre>}
    {done ? <p className={`message-result status-${message.status}`}>{MESSAGE_STATUS[message.status]}</p> : !canDecide ? waiting : <div className="message-actions">
      <button className="primary" onClick={() => { onDecide(message.id, 'approved', editing ? draft : undefined); setEditing(false); }}>Approve</button>
      <button onClick={() => { setEditing(e => !e); setOpen(true); }}>{editing ? 'Cancel edit' : 'Edit'}</button>
      <button className="ghost" onClick={() => onDecide(message.id, 'rejected')}>Reject</button>
    </div>}
  </article>;
}

/** Condition results summed across the message's bills, plus a link to each bill. */
function MessageEvidence({ message, onOpen }: { message: DraftMessage; onOpen?: (transactionId: string) => void }) {
  const conditions = new Map<string, { result: string; count: number }[]>();
  for (const item of message.items) for (const c of item.context) {
    const tallies = conditions.get(c.condition) ?? [];
    const tally = tallies.find(t => t.result === c.result);
    if (tally) tally.count++; else tallies.push({ result: c.result, count: 1 });
    conditions.set(c.condition, tallies);
  }
  const short = (text: string) => text.length > 48 ? `${text.slice(0, 47)}…` : text;
  return <>
    {conditions.size > 0 && <p className="message-context">{[...conditions].flatMap(([condition, tallies]) => tallies.map(t => <span key={condition + t.result} className={`result result-${t.result}`} title={condition}>{short(condition)}: {t.result}{message.items.length > 1 && ` · ${t.count}/${message.items.length}`}</span>))}</p>}
    <p className="message-bills">{message.items.map(item => onOpen ? <button key={item.transactionId} className="ghost" onClick={() => onOpen(item.transactionId)}>{item.billId}</button> : <span key={item.transactionId} className="muted">{item.billId}</span>)}</p>
  </>;
}

export function NotificationBell({ notices, onRead, onOpen }: { notices: import('./rules').Notice[]; onRead: () => void; onOpen?: (transactionId: string) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const unread = notices.filter(n => !n.read).length;
  useEffect(() => {
    const close = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);
  return <div className="notice-bell" ref={ref}>
    <button aria-label={`Notifications${unread ? `, ${unread} unread` : ''}`} aria-expanded={open} onClick={() => { setOpen(o => !o); if (!open) onRead(); }}>
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" /><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" /></svg>
      {unread > 0 && <span className="notice-count">{unread}</span>}
    </button>
    {open && <div className="notice-menu" role="dialog" aria-label="Notifications">
      <p>Notifications</p>
      {notices.length ? <ul>{notices.map(n => <li key={n.id}><span className={`notice-dot tone-${n.tone}`} aria-hidden /><span><b>{n.title}</b>{n.body && <span className="muted">{n.body}</span>}<span className="muted">{n.time}</span>{n.transactionId && onOpen && <button className="ghost" onClick={() => { onOpen(n.transactionId!); setOpen(false); }}>Open bill</button>}</span></li>)}</ul> : <p className="muted">No notifications yet.</p>}
    </div>}
  </div>;
}

export function Toasts({ notices, onDismiss }: { notices: import('./rules').Notice[]; onDismiss: (id: string) => void }) {
  const pending = notices.filter(n => !n.toasted).slice(0, 3);
  const ids = pending.map(n => n.id).join(',');
  const dismissRef = useRef(onDismiss);
  dismissRef.current = onDismiss;
  useEffect(() => {
    if (!ids) return;
    const timers = ids.split(',').map(id => setTimeout(() => dismissRef.current(id), 12000));
    return () => timers.forEach(clearTimeout);
  }, [ids]);
  if (!pending.length) return null;
  return <div className="notice-toasts" aria-live="polite">{pending.map(n => <div key={n.id} className={`notice-toast tone-${n.tone}`}>
    <span className="notice-dot" aria-hidden />
    <div><b>{n.title}</b>{n.body && <p>{n.body}</p>}</div>
    <button className="ghost" aria-label="Dismiss" onClick={() => onDismiss(n.id)}>✕</button>
  </div>)}</div>;
}
