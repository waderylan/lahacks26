import { useEffect, useRef, useState } from 'react';
import { draftSender, messageBills, emptyTransaction, evaluateTree, RESULT_LABELS, type DraftMessage, type LocalTransaction, type Outcome, type RuleNode, type Snapshot, type RuleIssue } from './rules';
import { employeeById } from './employees';
import { EmployeeSelect } from './EmployeeSelect';
const labels = { all: 'AND', any: 'OR', not: 'NOT', ai: 'English condition', standard: 'Filter' };

export function ResultBadge({ value }: { value: Outcome }) { return <span className={`result result-${value}`}>{value === 'true' ? 'Match' : value === 'false' ? 'No match' : value === 'error' ? 'Failed' : value === 'pending' ? 'Checking' : 'Uncertain'}</span>; }

/** `links` adds jumps from an issue to the tasks and approvals it created. */
export function RuleIssueList({ issues, onInspect, conditionKey, links }: { issues: RuleIssue[]; onInspect?: (id: string) => void; conditionKey?: string; links?: { approvals: (issue: RuleIssue) => number; onTasks: () => void; onApprovals: () => void } }) {
  if (!issues.length) return null;
  const sorted = [...issues].sort((a, b) => (b.resolvedAt ?? b.openedAt).localeCompare(a.resolvedAt ?? a.openedAt));
  return <section className="rule-follow-up" aria-label="Rule follow-up"><h3>Rule follow-up</h3>
    <p className="wizard-help">{issues.filter(issue => issue.status === 'open').length} open · {issues.filter(issue => issue.status === 'resolved').length} resolved</p>
    <ul>{sorted.slice(0, 20).map(issue => <li key={issue.id} data-issue-id={issue.id}><div>
      {onInspect ? <button className="ghost" onClick={() => onInspect(issue.transactionId)}>{issue.transactionId.split(':').pop()}</button> : <b>{issue.ruleName}</b>}
      <span className={`tag ${issue.status === 'resolved' ? 'ok' : 'warn'}`}>{issue.status === 'resolved' ? 'Resolved' : 'Open'}</span>
    </div><p>{issue.status === 'resolved' ? 'No match' : `Result: ${RESULT_LABELS[issue.lastResult]}`}</p>
      {conditionKey && issue.conditionKey !== conditionKey && issue.status === 'open' && <p>Open from earlier conditions</p>}
      {links && (issue.taskIds.length > 0 || links.approvals(issue) > 0) && <p className="issue-links">{issue.taskIds.length > 0 && <button className="ghost" onClick={links.onTasks}>{issue.taskIds.length} {issue.taskIds.length === 1 ? 'task' : 'tasks'}</button>}{links.approvals(issue) > 0 && <button className="ghost" onClick={links.onApprovals}>{links.approvals(issue)} {links.approvals(issue) === 1 ? 'approval' : 'approvals'}</button>}</p>}
    </li>)}</ul>{issues.length > 20 && <p className="wizard-help">Showing the 20 latest issues.</p>}
  </section>;
}

export function RuleEvidence({ node, snapshot }: { node: RuleNode; snapshot: Snapshot }) {
  return <div className="evidence-node"><div><ResultBadge value={evaluateTree(node, snapshot.conditions)} /> <b>{'children' in node ? labels[node.type] : node.type === 'ai' ? node.label || 'Condition' : `${node.field === 'review' ? 'Review status' : node.field} ${node.operator} ${node.value}`}</b></div>{'children' in node ? node.children.map(n => <RuleEvidence key={n.id} node={n} snapshot={snapshot} />) : node.type === 'ai' && <p>{node.text}</p>}</div>;
}

export function LocalStateEditor({ value, update }: { value?: LocalTransaction; update: (value: LocalTransaction) => void }) {
  const tx = value ?? emptyTransaction();
  const list = (value: string) => [...new Set(value.split(',').map(s => s.trim()).filter(Boolean))];
  const same = (a: string[], b: string[]) => JSON.stringify(a) === JSON.stringify(b);
  return <div className="local-editor"><label>Transaction owner<EmployeeSelect label="Bill assignment" value={tx.owner} emptyLabel="Unassigned" onChange={owner => { if (owner !== tx.owner) update({ ...tx, owner }); }} /></label><label>Flags (comma separated)<input key={`flags-${JSON.stringify(tx.flags)}`} aria-label="Bill flags" defaultValue={tx.flags.join(', ')} onBlur={e => { const flags = list(e.target.value); if (!same(flags, tx.flags)) update({ ...tx, flags }); }} /></label><label>Tags (comma separated)<input key={`tags-${JSON.stringify(tx.tags)}`} aria-label="Bill tags" defaultValue={tx.tags.join(', ')} onBlur={e => { const tags = list(e.target.value); if (!same(tags, tx.tags)) update({ ...tx, tags }); }} /></label><label className="check"><input type="checkbox" checked={tx.automatedCheck} onChange={e => update({ ...tx, automatedCheck: e.target.checked })} /> Passed automated check</label></div>;
}

const MESSAGE_STATUS = { pending: 'Pending approval', approved: 'Approved · sent to internal inbox', rejected: 'Rejected' };

/** `actor` is the signed-in employee; only the draft's sender can approve, edit or reject it. */
export function MessageCard({ message, actor, onDecide, onRetry, onOpen, onSwitch }: { message: DraftMessage; actor?: string; onDecide: (id: string, status: 'approved' | 'rejected', body?: string) => void; onRetry?: (id: string) => void; onOpen?: (transactionId: string) => void; onSwitch?: (employeeId: string) => void }) {
  const sender = draftSender(message), senderName = employeeById(sender)?.name ?? 'the sender';
  const canDecide = !actor || actor === sender;
  const waiting = <p className="muted">Awaiting {senderName}{onSwitch && sender && <> <button className="ghost" onClick={() => onSwitch(sender)}>View as {senderName}</button></>}</p>;
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
        <div className="message-meta"><span>Message</span><span className="message-status">{generation === 'error' ? 'Draft failed' : message.routing === 'jev' && !message.employeeId ? 'Choosing recipient…' : 'Writing draft…'}</span></div>
        <h3>{messageBills(message)} · {message.ruleName}</h3>
        <p className="muted">Request: {message.request}</p>
        {message.outcome && <p className="muted">Rule result: {RESULT_LABELS[message.outcome]}</p>}
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
        <p className="muted">From {senderName} · To {message.to}</p>
        <details className="copy-details"><summary>Details</summary><p>{message.ruleName} · Revision {message.revision}</p>
        {message.routing === 'jev' && employee && <p title={employee.description}>Recipient: {employee.name} · Jev{Number.isFinite(message.routingProbability) && ` · ${Math.round(message.routingProbability! * 100)}% confidence`}</p>}
        {message.request && <p className="muted">Request: {message.request}</p>}
        {message.outcome && <p className="muted">Rule result: {RESULT_LABELS[message.outcome]}</p>}
        </details>
        <MessageEvidence message={message} onOpen={onOpen} />
      </div>
    </div>
    {!editing && <button className="ghost" onClick={() => setOpen(o => !o)}>{open ? 'Hide draft' : 'View draft'}</button>}
    {editing ? <textarea aria-label="Edit draft message" value={draft} onChange={e => setDraft(e.target.value)} rows={Math.min(12, draft.split('\n').length + 2)} /> : open && <pre className="message-body">{message.body}</pre>}
    {!done && (!canDecide ? waiting : <div className="message-actions">
      <button className="primary" onClick={() => { onDecide(message.id, 'approved', editing ? draft : undefined); setEditing(false); }}>Approve</button>
      <button onClick={() => { setEditing(e => !e); setOpen(true); }}>{editing ? 'Cancel edit' : 'Edit'}</button>
      <button className="ghost" onClick={() => onDecide(message.id, 'rejected')}>Reject</button>
    </div>)}
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
    {conditions.size > 0 && <details className="copy-details"><summary>Condition results</summary><p className="message-context">{[...conditions].flatMap(([condition, tallies]) => tallies.map(t => <span key={condition + t.result} className={`result result-${t.result}`} title={condition}>{short(condition)}: {RESULT_LABELS[t.result as keyof typeof RESULT_LABELS] ?? t.result}{message.items.length > 1 && ` · ${t.count}/${message.items.length}`}</span>))}</p></details>}
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
