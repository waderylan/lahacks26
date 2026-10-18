import { useEffect, useState } from 'react';
import type { ActionPlan, ActionSelection, BillAction } from './actionTypes';
import { billActionLabel } from './actionTypes';
import type { WorkspaceController } from './useWorkspace';

const nextWeek = () => { const date = new Date(); date.setDate(date.getDate() + 7); return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`; };
export function ActionPanel({ controller: c, matches, selectedIds, ready, onInspect }: {
  controller: WorkspaceController; matches: ActionSelection; selectedIds: string[]; ready: boolean; onInspect: (id: string) => void;
}) {
  const [type, setType] = useState<BillAction['type']>('task');
  const [owner, setOwner] = useState('Bookkeeper');
  const [title, setTitle] = useState('Review this bill');
  const [dueDate, setDueDate] = useState(nextWeek);
  const [accountId, setAccountId] = useState('');
  const [text, setText] = useState('');
  const [scope, setScope] = useState<'matches' | 'selected'>(selectedIds.length ? 'selected' : 'matches');
  const [plan, setPlan] = useState<ActionPlan | null>(null);
  const [message, setMessage] = useState('');
  const [ok, setOk] = useState(true);
  const selection: ActionSelection = scope === 'selected' ? { ids: selectedIds, scope: 'selected' } : matches;
  const signature = JSON.stringify([type, owner, title, dueDate, accountId, text, scope, matches.criterion, matches.expression]);
  useEffect(() => { setPlan(null); setMessage(''); setOk(true); }, [signature]);
  useEffect(() => { setPlan(current => current?.status === 'preview' ? null : current); }, [selection.ids.join('|')]);
  useEffect(() => { setScope(selectedIds.length ? 'selected' : 'matches'); }, [selectedIds.join('|')]);
  const action = (): BillAction => type === 'task' ? { type, owner, title, dueDate } : type === 'category' ? { type, accountId } : type === 'memo' ? { type, text } : type === 'assign' ? { type, owner } : type === 'review' ? { type, reviewed: true } : { type, label: text };
  const eligible = selection.ids.length > 0 && (scope === 'selected' || ready);
  const fail = (error: unknown) => { setOk(false); setMessage((error as Error).message || 'The action failed. Try again.'); };
  const preview = async () => { try { setPlan(await c.preview(selection, action())); setMessage(''); setOk(true); } catch (error) { fail(error); } };
  const apply = async () => { if (!plan) return; try { const receipt = await c.apply(plan.id); setPlan(receipt); setOk(true); setMessage(`${receipt.items.filter(item => item.status === 'succeeded').length} bills updated. Changes are saved in SQLite.`); } catch (error) { fail(error); } };
  const count = plan?.items.filter(item => item.status === 'ready').length ?? 0;
  return <aside className="rule-panel dashboard-action-panel" aria-label="Take action">
    <div className="builder-header"><h2>Take action</h2><p className="small muted">Change bills or create assigned review tasks.</p></div>
    <div className="builder-scroll">
      <label className="dashboard-field">Apply to<select aria-label="Action scope" value={scope} onChange={event => setScope(event.target.value as typeof scope)}><option value="matches">Matches in this view ({matches.ids.length})</option><option value="selected">Selected bills ({selectedIds.length})</option></select></label>
      <label className="dashboard-field">Action<select aria-label="Dashboard action" value={type} onChange={event => { setType(event.target.value as typeof type); setText(''); }}>
        <option value="task">Create review tasks</option><option value="category">Change category</option><option value="assign">Assign bills</option><option value="memo">Update memo</option><option value="flag">Add flag</option><option value="tag">Add tag</option><option value="review">Mark reviewed</option>
      </select></label>
      {type === 'task' && <label className="dashboard-field">Task title<input aria-label="Task title" value={title} maxLength={200} onChange={event => setTitle(event.target.value)} /></label>}
      {(type === 'task' || type === 'assign') && <label className="dashboard-field">Assigned to<input aria-label="Action assignee" value={owner} placeholder="Person or team" maxLength={100} onChange={event => setOwner(event.target.value)} /></label>}
      {type === 'task' && <label className="dashboard-field">Due date<input aria-label="Task due date" type="date" value={dueDate} onChange={event => setDueDate(event.target.value)} /></label>}
      {type === 'category' && <label className="dashboard-field">Category<select aria-label="New category" value={accountId} onChange={event => setAccountId(event.target.value)}><option value="">Choose a category...</option>{c.accounts.map(account => <option key={account.id} value={account.id}>{account.name}</option>)}</select></label>}
      {(type === 'memo' || type === 'flag' || type === 'tag') && <label className="dashboard-field">{type === 'memo' ? 'New memo' : type === 'flag' ? 'Flag' : 'Tag'}<textarea aria-label="Action text" value={text} maxLength={type === 'memo' ? 4000 : 100} placeholder={type === 'memo' ? 'Write the new memo...' : 'e.g. Needs clarification'} onChange={event => setText(event.target.value)} /></label>}
      {!eligible && <p className="action-hint">{scope === 'selected' ? 'Select bills in the spreadsheet first.' : 'Search for bills first, then choose an action.'}</p>}
      <button className="primary dashboard-preview-button" disabled={!eligible || c.busy} onClick={() => void preview()}>{c.busy ? 'Working...' : 'Preview changes'}</button>
      {plan && <section className="action-preview" aria-label="Action preview"><h3>{plan.status === 'finished' ? 'Action receipt' : `${count} bills will change`}</h3>
        <div className="action-preview-items">{plan.items.map(item => <article key={item.billId}><button className="bill-inspect" onClick={() => onInspect(item.billId)}>{item.vendor}</button><span className={`action-item-status status-${item.status}`}>{({ ready: 'Ready', skipped: 'Skipped', succeeded: 'Saved', failed: 'Failed', undone: 'Undone' })[item.status]}</span><div className="before-value">{item.before || '(blank)'}</div><div className="after-value">{item.after}</div>{item.message && <p>{item.message}</p>}</article>)}</div>
        {plan.status === 'preview' && <button className="primary dashboard-apply-button" disabled={!count || c.busy} onClick={() => void apply()}>{type === 'task' ? `Create ${count} tasks` : `Apply ${count} changes`}</button>}
      </section>}
      {message && <p className={`action-confirmation${ok ? '' : ' error'}`} role={ok ? 'status' : 'alert'}>{message}</p>}
      {plan?.status === 'finished' && scope === 'matches' && ready && <details className="repeat-action"><summary>Repeat this action automatically</summary><p>Apply to new or changed matching bills while the server is running. Existing bills are not backfilled.</p><button disabled={c.busy} onClick={() => { void c.automate(matches, action()).then(() => { setOk(true); setMessage('Automation enabled. It continues when this browser closes, while the server runs.'); }).catch(fail); }}>Enable automation</button></details>}
    </div>
    <div className="builder-save"><span className="small muted">Saved on this server in SQLite.</span></div>
  </aside>;
}

export function TaskBoard({ c, onInspect }: { c: WorkspaceController; onInspect: (id: string) => void }) {
  const [status, setStatus] = useState('open');
  const [owner, setOwner] = useState('all');
  const tasks = c.tasks.filter(task => (status === 'all' || task.status === status) && (owner === 'all' || task.owner === owner));
  return <section className="dashboard-board" aria-label="Tasks and action history">
    <div className="dashboard-board-heading"><h2>Tasks & activity</h2><span className="small muted">Saved in SQLite</span></div>
    <div className="dashboard-filters"><label>Status<select aria-label="Task status filter" value={status} onChange={event => setStatus(event.target.value)}><option value="open">Open</option><option value="done">Done</option><option value="cancelled">Cancelled</option><option value="all">Any status</option></select></label><label>Assigned to<select aria-label="Task assignee filter" value={owner} onChange={event => setOwner(event.target.value)}><option value="all">Anyone</option>{c.owners.map(name => <option key={name} value={name}>{name}</option>)}</select></label></div>
    <div className="task-list">{tasks.length ? tasks.map(task => <article className="dashboard-task" key={task.id}><div><button className="bill-inspect" onClick={() => onInspect(task.billId)}>{task.title}</button><p>{task.vendor}</p><span>{task.owner} · Due {task.dueDate}</span></div><label className="task-status-label">Status<select aria-label={`Status for ${task.title}, ${task.vendor}`} value={task.status} disabled={c.busy} onChange={event => { void c.updateTask(task, event.target.value as typeof task.status).catch(() => {}); }}><option value="open">Open</option><option value="done">Done</option><option value="cancelled">Cancelled</option></select></label></article>) : <p className="dashboard-empty">No tasks in this view. Create review tasks from search matches or selected bills.</p>}</div>
    <h3>Action history</h3><div className="dashboard-history">{c.runs.length ? c.runs.map(run => <details key={run.id}><summary>{billActionLabel(run.action)} <span>{run.items.filter(item => item.status === 'succeeded').length} saved · {new Date(run.createdAt).toLocaleString()}</span></summary>{run.items.map(item => <article key={item.billId}><div><button className="bill-inspect" onClick={() => onInspect(item.billId)}>{item.vendor}</button><p>{item.before || '(blank)'} → {item.after}</p><span className={`action-item-status status-${item.status}`}>{item.status}</span>{item.message && <p className="small muted">{item.message}</p>}</div>{item.status === 'succeeded' && <button disabled={c.busy} onClick={() => { void c.undo(run.id, item.billId).catch(() => {}); }}>Undo</button>}</article>)}</details>) : <p className="dashboard-empty">Changes and their before/after values will appear here.</p>}</div>
    {c.automations.length > 0 && <><h3>Automatic actions</h3>{c.automations.map(rule => <article className="dashboard-task" key={rule.id}><div><b>{billActionLabel(rule.action)}</b><p>{rule.criterion}</p><span>{rule.error || (rule.enabled ? 'Running on this server' : 'Paused')}</span></div>{rule.enabled && <button disabled={c.busy} onClick={() => { void c.pause(rule.id).catch(() => {}); }}>Pause</button>}</article>)}</>}
  </section>;
}
