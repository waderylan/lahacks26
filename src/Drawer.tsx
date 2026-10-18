import { Fragment } from 'react';
import type { Row } from './types';
import type { ReviewTask } from './actionTypes';
import type { ActivityEvent } from './activity';
import { ActivityList } from './ActivityList';
import { actionLabel, actionsForOutcome, type DraftMessage } from './rules';
import { ownerLabel } from './employees';
import { money } from './format';
import { LocalStateEditor, MessageCard, RuleEvidence, RuleIssueList } from './RulesPanel';
import { SupportingDetails } from './SupportingDetails';
import type { RulesController } from './useRules';

const kv = (o: Record<string, unknown> | null) => o ? Object.entries(o).filter(([, v]) => v !== null && typeof v !== 'object') : [];
const TYPE_NAMES = { bill: 'Vendor bill', invoice: 'Customer invoice', bank: 'Bank transaction' } as const;

/**
 * Transaction detail. Evidence and follow-up come first; the raw record is collapsed at the bottom.
 * `readOnly` (Explore) inspects only: review, supporting details and edits happen from Tasks, Rules or Messages.
 */
export function Drawer({ row: r, rules, readOnly, tasks, timeline, actor, busy, onClose, onUndo, onReview, onGoTo, onSwitch }: {
  row: Row; rules: RulesController; readOnly: boolean; tasks: ReviewTask[]; timeline: ActivityEvent[]; actor: string; busy: boolean;
  onClose: () => void; onUndo: (event: ActivityEvent) => void; onReview: (reviewed: boolean) => void;
  onGoTo: (target: 'tasks' | 'messages') => void; onSwitch: (employeeId: string) => void;
}) {
  const reviewed = Boolean(r.dashboard?.reviewed);
  const issues = rules.issues.filter(issue => issue.transactionId === r.id);
  const drafts: DraftMessage[] = rules.store.messages.filter(message => message.items.some(item => item.transactionId === r.id));
  const type = r.txnType ? TYPE_NAMES[r.txnType] : null;
  const openTasks = tasks.filter(task => task.status === 'open');
  const snapshot = rules.snapshots[r.id];
  return (
    <aside className="drawer" aria-label="Transaction detail">
      <div className="drawer-head">
        <div>
          <b>{r.vendor}</b>
          <div className="muted">{type}{type ? ' · ' : ''}{r.docNumber} · {r.billId}</div>
        </div>
        <button className="ghost" onClick={onClose} aria-label="Close detail">✕</button>
      </div>
      <div className="drawer-body">
        <h3>Status</h3>
        <dl>
          <dt>Human review</dt><dd>{reviewed ? 'Reviewed' : 'Needs review'}</dd>
          <dt>Transaction owner</dt><dd>{ownerLabel(r.dashboard?.owner)}</dd>
          <dt>Flags</dt><dd>{r.dashboard?.flags.join(', ') || 'None'}</dd>
          <dt>Tags</dt><dd>{r.dashboard?.tags.join(', ') || 'None'}</dd>
          <dt>Open tasks</dt><dd>{openTasks.length}{tasks.length > 0 && <> <button className="ghost" onClick={() => onGoTo('tasks')}>View in Tasks & activity</button></>}</dd>
        </dl>
        {readOnly
          ? <section className="review-handoff" aria-label="Review this transaction"><button className="primary" onClick={() => onGoTo('tasks')}>Review in Tasks & activity</button></section>
          : <section className="human-review" aria-label="Human review"><h3>Human review</h3>
            <button disabled={busy} onClick={() => onReview(!reviewed)}>{reviewed ? 'Mark needs review' : 'Mark reviewed'}</button></section>}
        {!readOnly && rules.draft && snapshot && <><h3>Condition results · current draft</h3><RuleEvidence node={rules.draft.expression} snapshot={snapshot} /><h3>Actions for this result</h3>{actionsForOutcome(rules.draft, snapshot.result).map(a => <p key={a.id}>{actionLabel(a)}</p>)}{!actionsForOutcome(rules.draft, snapshot.result).length && <p className="muted">No action</p>}</>}
        <RuleIssueList issues={issues} links={{ approvals: issue => drafts.filter(message => message.ruleId === issue.ruleId).length, onTasks: () => onGoTo('tasks'), onApprovals: () => onGoTo('messages') }} />
        {!readOnly && <SupportingDetails key={r.id} row={r} save={rules.addEvidence} busy={rules.busy} issues={issues} rules={rules.store.rules} onRecheck={rule => rules.recheck(rule, [r.id])} />}
        {tasks.length > 0 && <section aria-label="Tasks for this transaction"><h3>Tasks</h3>{tasks.map(task => <dl key={task.id} className="line"><dt>{task.status}</dt><dd><b>{task.title}</b><br />Task owner: {ownerLabel(task.owner)} · Due {task.dueDate}</dd></dl>)}</section>}
        {drafts.length > 0 && <section aria-label="Approvals for this transaction"><h3>Message approvals</h3>{drafts.map(message => <MessageCard key={message.id} message={message} actor={actor} onDecide={rules.decideMessage} onRetry={rules.retryDraft} onSwitch={onSwitch} />)}<button className="ghost" onClick={() => onGoTo('messages')}>Open Messages</button></section>}
        <h3>Activity</h3>
        <ActivityList events={timeline} onUndo={onUndo} busy={busy} limit={20} empty="No activity yet." />
        {!readOnly && <details className="legacy-metadata"><summary>Edit owner, flags & tags</summary><LocalStateEditor value={rules.store.transactions[r.id]} update={value => { void rules.updateLocal(r.id, value, r.sourceVersion); }} /></details>}
        {r.evidence && (<><h3>Supporting records</h3>{r.evidence.length === 0 ? <p className="muted">No supporting records.</p> : r.evidence.map((e) => (
          <dl key={e.id} className="line"><dt>{e.kind.replace(/_/g, ' ')}</dt><dd><b>{e.title}</b> · {e.date}<br />{e.text}</dd></dl>
        ))}</>)}
        {r.related && r.related.length > 0 && (<><h3>Related transactions</h3>{r.related.map((x) => (
          <dl key={x.id} className="line"><dt>{x.docNumber}</dt><dd>{x.date} · {money(x.amountCents)} · billed as {x.vendor}<br />{x.description || '(blank)'}{x.memo ? ` · ${x.memo}` : ''}</dd></dl>
        ))}</>)}
        {r.workspaceChanges && Object.keys(r.workspaceChanges).length > 0 && <><h3>Original source values</h3><dl>{r.workspaceChanges.account !== undefined && <><dt>Category</dt><dd>{r.workspaceChanges.account}</dd></>}{r.workspaceChanges.memo !== undefined && <><dt>Memo</dt><dd>{r.workspaceChanges.memo || '(blank)'}</dd></>}</dl></>}
        <details className="record-details"><summary>Details</summary>
          <dl>
            <dt>Date</dt><dd>{r.date}</dd>
            <dt>Due</dt><dd>{r.dueDate}</dd>
            <dt>Total</dt><dd>{money(r.amountCents)}</dd>
            <dt>Kind</dt><dd>{r.expenseKind} / {r.costCategory}</dd>
            <dt>Account</dt><dd>{r.account}</dd>
            <dt>Project</dt><dd>{r.project ?? '—'}</dd>
            <dt>Memo</dt><dd>{r.memo || '—'}</dd>
            <dt>Description</dt><dd>{r.description || '(blank)'}</dd>
            <dt>Items</dt><dd>{r.itemNames.join(', ') || '(none)'}</dd>
          </dl>
          {r.lines.length > 0 && <h3>Lines</h3>}
          {r.lines.map((l, i) => (
            <dl key={i} className="line">
              {kv(l).map(([k, v]) => (<Fragment key={k}><dt>{k}</dt><dd>{String(v)}</dd></Fragment>))}
            </dl>
          ))}
          {r.details && <><h3>Details</h3><dl>{Object.entries(r.details).filter(([, v]) => v !== '').map(([k, v]) => (<Fragment key={k}><dt>{k.replace(/_/g, ' ')}</dt><dd>{String(v)}</dd></Fragment>))}</dl></>}
          <h3>{r.txnType === 'invoice' ? 'Customer payments' : 'Payments'}</h3>
          {r.payments.length === 0 ? <p className="muted">No payment applied.</p> : r.payments.map((p) => (
            <dl key={p.id} className="line"><dt>{p.id}</dt><dd>{p.date} · {money(p.amountCents)} from {p.account}</dd></dl>
          ))}
          <h3>{r.txnType === 'invoice' ? 'Customer' : r.txnType === 'bank' ? 'Counterparty' : 'Vendor'}</h3>
          <dl>{kv(r.vendorRecord).map(([k, v]) => (<Fragment key={k}><dt>{k}</dt><dd>{String(v)}</dd></Fragment>))}</dl>
          {r.projectRecord && (<><h3>Project</h3><dl>{kv(r.projectRecord).map(([k, v]) => (<Fragment key={k}><dt>{k}</dt><dd>{String(v)}</dd></Fragment>))}</dl></>)}
          <p className="muted small">Payments excluded from spend totals.</p>
        </details>
      </div>
    </aside>
  );
}
