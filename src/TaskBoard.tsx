import './tasks.css';
import { useState } from 'react';
import type { ReviewTask } from './actionTypes';
import { ActivityList } from './ActivityList';
import type { ActivityEvent } from './activity';
import { ownerKey, ownerLabel, ownerOptions, sameOwner } from './employees';
import type { WorkspaceController } from './useWorkspace';

/** Tasks and the single activity feed for the company. `as` is the signed-in employee, used by the My tasks shortcut. */
export function TaskBoard({ c, as, activity, transactionOwner, onInspect, onUndo, busy }: {
  c: WorkspaceController; as: string; activity: ActivityEvent[]; transactionOwner: (transactionId: string) => string | undefined;
  onInspect: (id: string) => void; onUndo: (event: ActivityEvent) => void; busy: boolean;
}) {
  const [status, setStatus] = useState('open');
  const [owner, setOwner] = useState('all');
  const tasks = c.tasks.filter((task: ReviewTask) => (status === 'all' || task.status === status) && (owner === 'all' || sameOwner(task.owner, owner)));
  const mine = owner !== 'all' && ownerKey(owner) === ownerKey(as);
  const owners = ownerOptions(c.owners);
  return <section className="dashboard-board tasks-board" aria-label="Tasks and activity">
    <div className="dashboard-board-heading"><div><h2>Tasks & activity</h2><p className="tasks-intro">Review assignments, update their status, and track recent changes.</p></div><span className="small muted">Everything that happened in this company</span></div>
    <div className="dashboard-filters"><label>Status<select aria-label="Task status filter" value={status} onChange={event => setStatus(event.target.value)}><option value="open">Open</option><option value="done">Done</option><option value="cancelled">Cancelled</option><option value="all">Any status</option></select></label>
      <label>Task owner<select aria-label="Task assignee filter" value={owner} onChange={event => setOwner(event.target.value)}><option value="all">Anyone</option>{owners.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
      <button className={mine ? 'on' : ''} aria-pressed={mine} onClick={() => setOwner(mine ? 'all' : as)}>My tasks</button></div>
    <p className="small muted">The task owner does the work. The transaction owner is set separately. Marking a task Done does not mark the transaction reviewed or resolve its rule issue.</p>
    <p className="tasks-count" role="status">{tasks.length} shown · {c.tasks.length} total</p>
    <div className="task-list">{tasks.length ? tasks.map(task => {
      const holder = transactionOwner(task.billId);
      return <article className="dashboard-task" key={task.id}><div><button className="bill-inspect" onClick={() => onInspect(task.billId)}>{task.title}</button><p>{task.vendor}</p>
        <span>Task owner: {ownerLabel(task.owner)} · Due {task.dueDate}</span>
        {holder !== undefined && <span> · Transaction owner: {ownerLabel(holder)}</span>}</div>
        <label className="task-status-label">Status<select aria-label={`Status for ${task.title}, ${task.vendor}`} value={task.status} disabled={c.busy} onChange={event => { void c.updateTask(task, event.target.value as typeof task.status).catch(() => {}); }}><option value="open">Open</option><option value="done">Done</option><option value="cancelled">Cancelled</option></select></label></article>;
    }) : <p className="dashboard-empty">No tasks in this view. {mine ? 'Choose Anyone to see everyone’s tasks. ' : ''}Add a task action to a rule, then run it.</p>}</div>
    <h3>Activity</h3>
    <ActivityList events={activity} onInspect={onInspect} onUndo={onUndo} busy={busy} empty="Rule actions, assignments, tasks, messages and reviews will appear here." />
  </section>;
}
