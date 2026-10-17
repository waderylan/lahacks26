import { useEffect, useRef, useState } from 'react';
import type { CompanyBills } from './types';
import { actionLabel, DEFAULT_MESSAGE_ASK, emptyTransaction, evaluateTree, uid, type Action, type DraftMessage, type Group, type LocalTransaction, type Outcome, type RuleNode, type Snapshot } from './rules';
import type { RulesController } from './useRules';

const labels = { all: 'ALL', any: 'ANY', not: 'NOT', ai: 'AI condition', standard: 'Standard condition' };
const makeNode = (type: RuleNode['type']): RuleNode => type === 'ai' ? { id: uid(), type, text: '', label: '' } : type === 'standard' ? { id: uid(), type, field: 'amountCents', operator: 'gt', value: '100' } : { id: uid(), type, children: [] };
const updateNode = (root: RuleNode, id: string, fn: (n: RuleNode) => RuleNode): RuleNode => root.id === id ? fn(root) : 'children' in root ? { ...root, children: root.children.map(c => updateNode(c, id, fn)) } : root;
const removeNode = (root: RuleNode, id: string): RuleNode => 'children' in root ? { ...root, children: root.children.filter(c => c.id !== id).map(c => removeNode(c, id)) } : root;
const findNode = (root: RuleNode, id: string): RuleNode | undefined => root.id === id ? root : 'children' in root ? root.children.map(c => findNode(c, id)).find(Boolean) : undefined;
const depthOf = (root: RuleNode): number => 'children' in root ? 1 + Math.max(0, ...root.children.map(depthOf)) : 0;
const groups = (root: RuleNode): Group[] => 'children' in root ? [root, ...root.children.flatMap(groups)] : [];

export function ResultBadge({ value }: { value: Outcome }) { return <span className={`result result-${value}`}>{value === 'true' ? 'True' : value === 'false' ? 'False' : value === 'error' ? 'Error' : value === 'pending' ? 'Pending' : 'Uncertain'}</span>; }

export function RulesPanel({ controller: c, data }: { controller: RulesController; data: CompanyBills }) {
  const [treeError, setTreeError] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);
  const draft = c.draft;
  useEffect(() => { scrollRef.current?.scrollTo({ top: 0 }); }, [draft?.id]);
  if (!draft) return <aside className="rule-panel state">Loading rule…</aside>;
  const setTree = (tree: RuleNode) => {
    if (depthOf(tree) > 3) { setTreeError('Use at most three group levels.'); return; }
    setTreeError(''); c.setDraft({ ...draft, expression: tree });
  };
  const add = (parentId: string, type: RuleNode['type'], position?: number) => setTree(updateNode(draft.expression, parentId, n => {
    if (!('children' in n) || (n.type === 'not' && n.children.length)) return n;
    const children = [...n.children]; children.splice(position ?? children.length, 0, makeNode(type)); return { ...n, children };
  }));
  const move = (id: string, targetId: string, position?: number) => {
    const node = findNode(draft.expression, id);
    if (!node || node.id === draft.expression.id || findNode(node, targetId)) return;
    const target = findNode(draft.expression, targetId);
    if (!target || !('children' in target) || (target.type === 'not' && target.children.length && !target.children.some(c => c.id === id))) { setTreeError('NOT accepts exactly one child.'); return; }
    const from = target.children.findIndex(c => c.id === id);
    const destination = position === undefined ? undefined : position - (from >= 0 && from < position ? 1 : 0);
    setTree(updateNode(removeNode(draft.expression, id), targetId, n => {
      if (!('children' in n)) return n;
      const children = [...n.children]; children.splice(destination ?? children.length, 0, node); return { ...n, children };
    }));
  };
  const reorder = (parent: Group, index: number, delta: number) => {
    const children = [...parent.children]; const to = index + delta;
    if (to < 0 || to >= children.length) return;
    [children[index], children[to]] = [children[to], children[index]];
    setTree(updateNode(draft.expression, parent.id, n => ({ ...n, children } as Group)));
  };
  const options = data.referenceOptions ?? { vendors: [...new Set(data.rows.map(r => r.vendor))].sort(), accounts: [...new Set(data.rows.map(r => r.account))].sort() };
  const dropTarget = (parent: Group, position: number) => <div className="rule-dropzone" aria-label={`Drop block at position ${position + 1} in ${labels[parent.type]}`} onDragOver={e => { e.preventDefault(); e.stopPropagation(); e.currentTarget.classList.add('drag-over'); }} onDragLeave={e => e.currentTarget.classList.remove('drag-over')} onDrop={e => {
    e.preventDefault(); e.stopPropagation(); e.currentTarget.classList.remove('drag-over');
    const id = e.dataTransfer.getData('application/x-rule-node'); const type = e.dataTransfer.getData('application/x-rule-palette') as RuleNode['type'];
    if (id) move(id, parent.id, position); else if (type) add(parent.id, type, position);
  }} />;

  const render = (node: RuleNode, depth: number, parent?: Group, index = 0): React.ReactNode => {
    const isGroup = 'children' in node;
    return <article key={node.id} className={`rule-node node-${node.type}`} draggable={Boolean(parent)} data-testid={`node-${node.type}`}
      onDragStart={e => { e.stopPropagation(); e.dataTransfer.setData('application/x-rule-node', node.id); e.dataTransfer.effectAllowed = 'move'; }}
      onDragOver={e => { if (isGroup) { e.preventDefault(); e.stopPropagation(); } }}
      onDrop={e => { if (!isGroup) return; e.preventDefault(); e.stopPropagation(); const id = e.dataTransfer.getData('application/x-rule-node'); const type = e.dataTransfer.getData('application/x-rule-palette') as RuleNode['type']; if (id) move(id, node.id); else if (type && !(node.type === 'not' && node.children.length)) add(node.id, type); }}>
      <div className="node-heading">
        {parent && <span className="drag-handle" title="Drag into another group">⠿</span>}
        {isGroup ? <select aria-label="Group logic" value={node.type} onChange={e => setTree(updateNode(draft.expression, node.id, n => ({ ...n, type: e.target.value } as Group)))}>{(['all', 'any', 'not'] as const).map(t => <option key={t} value={t}>{labels[t]}</option>)}</select> : <b>{labels[node.type]}</b>}
        <span className="spacer" />
        {parent && <div className="node-tools"><button aria-label={`Move ${labels[node.type]} up`} disabled={index === 0} onClick={() => reorder(parent, index, -1)}>↑</button><button aria-label={`Move ${labels[node.type]} down`} disabled={index === parent.children.length - 1} onClick={() => reorder(parent, index, 1)}>↓</button><button aria-label={`Remove ${labels[node.type]}`} onClick={() => setTree(removeNode(draft.expression, node.id))}>×</button></div>}
      </div>
      {isGroup ? <>
        <p className="node-help">{node.type === 'all' ? 'Every condition must be true' : node.type === 'any' ? 'At least one condition must be true' : 'Negate one condition · uncertain stays uncertain'}</p>
        <div className="node-children">{node.children.map((child, i) => <div key={child.id}>{dropTarget(node, i)}{render(child, depth + 1, node, i)}</div>)}{node.children.length > 0 && dropTarget(node, node.children.length)}</div>
        {(!node.children.length || node.type !== 'not') && <select aria-label={`Add block to ${labels[node.type]}`} className="add-block" value="" onChange={e => { if (e.target.value) add(node.id, e.target.value as RuleNode['type']); }}><option value="">+ Add condition or group</option>{(['ai', 'standard', ...(depth < 3 ? ['all', 'any', 'not'] : [])] as RuleNode['type'][]).map(type => <option key={type} value={type}>{labels[type]}</option>)}</select>}
        {!node.children.length && <span className="small muted"> Drop a block here</span>}
      </> : node.type === 'ai' ? <>
        <input className="node-label" aria-label="AI display label" placeholder="Display label (optional)" value={node.label} onChange={e => setTree(updateNode(draft.expression, node.id, n => ({ ...n, label: e.target.value } as RuleNode)))} />
        <textarea aria-label="AI condition text" placeholder="Describe what Jev should judge…" maxLength={500} value={node.text} onChange={e => setTree(updateNode(draft.expression, node.id, n => ({ ...n, text: e.target.value } as RuleNode)))} />
        <div className="condition-counts" aria-live="polite">{(['true', 'false', 'uncertain', 'pending', 'error'] as Outcome[]).map(value => <span key={value} className={`count-${value}`}>{c.counts[node.id]?.[value] ?? 0} {value}</span>)}</div>
      </> : <div className="standard-fields">
        <select aria-label="Condition field" value={node.field} onChange={e => { const field = e.target.value as typeof node.field; setTree(updateNode(draft.expression, node.id, n => ({ ...n, field, operator: field === 'amountCents' ? 'gt' : 'eq', value: field === 'review' ? 'needs_review' : field === 'amountCents' ? '100' : '' } as RuleNode))); }}><option value="amountCents">Amount</option><option value="review">Review status</option><option value="vendor">Vendor</option><option value="account">Account</option></select>
        <select aria-label="Comparison" value={node.operator} onChange={e => setTree(updateNode(draft.expression, node.id, n => ({ ...n, operator: e.target.value } as RuleNode)))}>{(node.field === 'amountCents' ? [['gt', 'greater than'], ['lt', 'less than'], ['eq', 'equal to']] : [['eq', 'equals']]).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
        {node.field === 'amountCents' ? <label className="amount-input">$ <input aria-label="Amount in dollars" inputMode="decimal" value={node.value} onChange={e => setTree(updateNode(draft.expression, node.id, n => ({ ...n, value: e.target.value } as RuleNode)))} /></label> : <select aria-label="Condition value" value={node.value} onChange={e => setTree(updateNode(draft.expression, node.id, n => ({ ...n, value: e.target.value } as RuleNode)))}><option value="">Choose…</option>{(node.field === 'review' ? [['needs_review', 'Needs review'], ['reviewed', 'Human reviewed']] : (node.field === 'vendor' ? options.vendors : options.accounts).map(v => [v, v])).map(([v, label]) => <option key={v} value={v}>{label}</option>)}</select>}
        <span className="small muted">Deterministic · evaluated locally</span>
      </div>}
      {parent && <select className="move-target" aria-label={`Move ${labels[node.type]} to group`} value="" onChange={e => e.target.value && move(node.id, e.target.value)}><option value="">Move to group…</option>{groups(draft.expression).filter(g => g.id !== parent.id && !findNode(node, g.id) && !(g.type === 'not' && g.children.length)).map((g, i) => <option key={g.id} value={g.id}>{labels[g.type]} · group {i + 1}</option>)}</select>}
    </article>;
  };
  const updateAction = (id: string, change: Partial<Action>) => c.setDraft({ ...draft, actions: draft.actions.map(a => a.id === id ? { ...a, ...change } : a) });
  return <aside className="rule-panel" aria-label="Rule builder">
    <div className="builder-header"><div className="eyebrow">REVIEW AUTOMATION</div><div className="builder-title"><h2>Rule builder</h2><span className="pill">{c.saved ? `r${c.saved.revision}${c.dirty ? ' · Draft changes' : ''}` : 'Draft'}</span></div>
      <div className="rule-library"><select aria-label="Saved rules" value={c.saved?.id ?? ''} onChange={e => c.selectRule(e.target.value)}><option value="">Unsaved rule</option>{c.store.rules.filter(r => r.companyId === draft.companyId).map(r => <option key={r.id} value={r.id}>{r.name} · r{r.revision}{r.enabled ? ' · enabled' : ''}</option>)}</select><button className="ghost" onClick={c.newRule}>+ New</button><button className="ghost" onClick={c.loadExample}>Load example</button></div>
      <label className="field-label">Rule name<input aria-label="Rule name" value={draft.name} onChange={e => c.setDraft({ ...draft, name: e.target.value })} /></label>
      <p className="small muted">Describe which bills need attention. Choose what happens to matching bills.</p>
    </div>
    <div className="builder-scroll" ref={scrollRef}>
      <div className="palette" aria-label="Block palette">{(['all', 'any', 'not', 'ai', 'standard'] as const).map(type => <button key={type} draggable onDragStart={e => { e.dataTransfer.setData('application/x-rule-palette', type); e.dataTransfer.effectAllowed = 'copy'; }} onClick={() => add(draft.expression.id, type)}>{labels[type]}</button>)}</div>
      <div className="section-label">1. IF <span>Which bills should match?</span></div>
      <p className="independence-note">Each AI condition is judged independently by Jev. ALL, ANY, and NOT combine the results.</p>
      {render(draft.expression, 1)}
      <div className="section-label then-label">2. THEN <span>What should happen?</span></div>
      <datalist id="flag-labels"><option value="Needs clarification" /><option value="Possible mismatch" /></datalist>
      {draft.actions.map(a => <article className="action-block" key={a.id}><div className="node-heading"><b>Action</b><span className="spacer" /><button className="ghost" aria-label="Remove action" onClick={() => c.setDraft({ ...draft, actions: draft.actions.filter(x => x.id !== a.id) })}>×</button></div><select aria-label="Action type" value={a.type} onChange={e => updateAction(a.id, { type: e.target.value as Action['type'], value: e.target.value === 'message' ? DEFAULT_MESSAGE_ASK : '' })}><option value="flag">Add flag</option><option value="assign">Assign to</option><option value="tag">Add tag</option><option value="pass">Mark passed automated check</option><option value="message">Draft vendor message</option></select>{a.type === 'message' ? <><textarea aria-label="Message to ask" placeholder="What should we ask the vendor?" value={a.value} onChange={e => updateAction(a.id, { value: e.target.value })} /><p className="small muted">Creates a local draft to the vendor. Approve, edit, or reject it — nothing is emailed.</p></> : a.type !== 'pass' ? <input aria-label="Action value" list={a.type === 'flag' ? 'flag-labels' : undefined} placeholder={a.type === 'flag' ? 'Choose or type a custom flag' : a.type === 'assign' ? 'Local owner name' : 'Tag name'} value={a.value} onChange={e => updateAction(a.id, { value: e.target.value })} /> : <p className="small muted">Human review status stays separate.</p>}</article>)}
      <button className="add-action" onClick={() => c.setDraft({ ...draft, actions: [...draft.actions, { id: uid(), type: 'tag', value: '' }] })}>+ Add action</button>
      {(treeError || c.validation.length > 0) && <div className="builder-validation" role="status">{treeError || c.validation.join(' ')}</div>}
      <p className="policy-note">Suggested review policy. A match is not proof of an accounting error.</p>
    </div>
    <div className="builder-save"><div className="save-row"><button className="primary" disabled={Boolean(c.validation.length || c.storageError) || (!c.dirty && Boolean(c.saved))} onClick={() => c.save(Boolean(c.saved?.enabled))}>{c.saved?.enabled && c.dirty ? 'Save and activate revision' : 'Save rule'}</button><button aria-label="Toggle rule enabled" aria-pressed={Boolean(c.saved?.enabled)} disabled={!c.saved || c.busy || Boolean(c.storageError)} onClick={c.toggleEnabled}>{c.saved?.enabled ? 'Enabled · Disable' : 'Disabled · Enable'}</button></div><p className="small muted">{c.saved?.enabled && c.dirty ? `Revision ${c.saved.revision} still controls automation until you save and activate.` : 'Enabling applies to future arrivals and updates. No automatic backfill.'}</p></div>
  </aside>;
}

export function RulePreviewBar({ c, total, onInspect }: { c: RulesController; total: number; onInspect: () => void }) {
  return <><section className="rule-preview-bar" aria-live="polite"><div><div className="eyebrow">3. INSPECT & RUN</div><h2>Would act on <strong>{c.matches.length}</strong> transactions</h2><span className="muted">{c.uncertain} uncertain · {c.evaluated}/{total} evaluated · {c.elapsed.toFixed(1)}s · {c.complete ? 'Complete' : c.validation.length ? 'Incomplete rule' : 'Partial preview'}</span></div><div className="preview-controls"><div className="preview-buttons"><button disabled={!c.matches.length} onClick={onInspect}>Inspect a match</button><button className="primary" disabled={!c.complete || c.dirty || !c.saved || c.busy || Boolean(c.storageError)} onClick={c.runOnce}>Run once · {c.matches.length}</button></div><span className="small muted">{c.dirty || !c.saved ? 'Preview is safe · Save this revision to run' : 'Definite matches only · Uncertain bills stay untouched'}</span></div></section>{c.draft && <div className="equation-summary" aria-label="Rule summary"><span className="equation-keyword">IF</span><Equation node={c.draft.expression} /><span className="equation-keyword">THEN</span><span className="equation-actions">{c.draft.actions.length ? c.draft.actions.map(actionLabel).join(' + ') : 'Choose an action'}</span></div>}</>;
}

function Equation({ node }: { node: RuleNode }) {
  if ('children' in node) return <span className="equation-group">{node.type === 'not' && <b className="equation-not">NOT</b>}{node.children.length ? node.children.map((child, i) => <span key={child.id}>{i > 0 && <b className="equation-operator">{node.type === 'any' ? 'OR' : 'AND'}</b>}<Equation node={child} /></span>) : <span className="muted">Add a condition</span>}</span>;
  return <span className={`equation-condition equation-${node.type}`}>{node.type === 'ai' ? node.label || node.text || 'Describe a condition' : `${node.field === 'amountCents' ? 'Amount' : node.field === 'review' ? 'Review status' : node.field} ${node.operator === 'gt' ? '>' : node.operator === 'lt' ? '<' : '='} ${node.value || '…'}`}</span>;
}

export function RuleHistory({ c, companyId, onOpen }: { c: RulesController; companyId: string; onOpen?: (transactionId: string) => void }) {
  const [tab, setTab] = useState<'history' | 'replay' | 'messages'>('history');
  const [open, setOpen] = useState(false);
  const history = c.store.history.filter(h => h.companyId === companyId);
  const messages = (c.store.messages ?? []).filter(m => m.companyId === companyId);
  const pending = messages.filter(m => m.status === 'pending').length;
  return <section className={`rule-history ${open ? 'expanded' : ''}`} aria-label="Action history"><div className="history-toolbar"><button aria-expanded={open} onClick={() => setOpen(!open)}>{open ? '▾' : '▸'} Activity <b>{history.length}</b></button><button className={tab === 'history' ? 'active' : 'ghost'} onClick={() => { setTab('history'); setOpen(true); }}>Action history</button><button className={tab === 'messages' ? 'active' : 'ghost'} onClick={() => { setTab('messages'); setOpen(true); }}>Messages{pending ? ` · ${pending}` : ''}</button><button className={tab === 'replay' ? 'active' : 'ghost'} onClick={() => { setTab('replay'); setOpen(true); }}>Replay log</button><span className="spacer" /><button disabled={c.busy || !c.remaining || Boolean(c.storageError)} onClick={() => { setTab('replay'); setOpen(true); void c.replay(); }}>{c.busy ? 'Evaluating replay…' : 'Replay next original bill'} <b>({c.remaining})</b></button><button className="ghost" disabled={c.busy || Boolean(c.storageError)} onClick={c.reset}>Reset demo action state</button></div>
    {open && <div className="history-body">{tab === 'messages' ? messages.length ? messages.map(m => <MessageCard key={m.id} message={m} onDecide={c.decideMessage} onOpen={onOpen} />) : <p className="muted">No drafts yet. Add a Draft vendor message action, save, and run the rule.</p> : tab === 'history' ? history.length ? history.map(h => <div className="history-entry" key={h.id}>
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
  return <div className="local-editor"><label>Assigned to<input aria-label="Local assignment" value={tx.owner} onChange={e => update({ ...tx, owner: e.target.value })} /></label><label>Flags (comma separated)<input key={`flags-${JSON.stringify(tx.flags)}`} aria-label="Local flags" defaultValue={tx.flags.join(', ')} onBlur={e => update({ ...tx, flags: [...new Set(e.target.value.split(',').map(s => s.trim()).filter(Boolean))] })} /></label><label>Tags (comma separated)<input key={`tags-${JSON.stringify(tx.tags)}`} aria-label="Local tags" defaultValue={tx.tags.join(', ')} onBlur={e => update({ ...tx, tags: [...new Set(e.target.value.split(',').map(s => s.trim()).filter(Boolean))] })} /></label><label className="check"><input type="checkbox" checked={tx.automatedCheck} onChange={e => update({ ...tx, automatedCheck: e.target.checked })} /> Passed automated check</label><p className="small muted">Local review metadata. Automated check does not mark a bill human reviewed.</p></div>;
}

const MESSAGE_STATUS = { pending: 'Pending approval', approved: 'Marked sent · local only', rejected: 'Rejected · not sent' };

export function MessageCard({ message, onDecide, onOpen }: { message: DraftMessage; onDecide: (id: string, status: 'approved' | 'rejected', body?: string) => void; onOpen?: (transactionId: string) => void }) {
  const [editing, setEditing] = useState(false);
  const [open, setOpen] = useState(message.status === 'pending');
  const [draft, setDraft] = useState(message.body);
  const done = message.status !== 'pending';
  return <article className={`message-card status-${message.status}`} aria-label={`Draft message to ${message.to}`}>
    <div className="message-card-head">
      <span className="message-icon" aria-hidden>✉</span>
      <div>
        <div className="message-meta"><span>Message</span><span className={`message-status status-${message.status}`}>{MESSAGE_STATUS[message.status]}</span>{message.edited && <span className="muted">· edited</span>}</div>
        <h3>{message.subject}</h3>
        <p className="muted">To {message.to} · {message.billId} · {message.ruleName} r{message.revision}</p>
        <p className="muted">{message.reason}</p>
      </div>
    </div>
    {!editing && <button className="ghost" onClick={() => setOpen(o => !o)}>{open ? 'Hide draft' : 'View draft'}</button>}
    {editing ? <textarea aria-label="Edit draft message" value={draft} onChange={e => setDraft(e.target.value)} rows={Math.min(12, draft.split('\n').length + 2)} /> : open && <pre className="message-body">{message.body}</pre>}
    {done ? <p className={`message-result status-${message.status}`}>{MESSAGE_STATUS[message.status]}</p> : <div className="message-actions">
      <button className="primary" onClick={() => { onDecide(message.id, 'approved', editing ? draft : undefined); setEditing(false); }}>Approve</button>
      <button onClick={() => { setEditing(e => !e); setOpen(true); }}>{editing ? 'Cancel edit' : 'Edit'}</button>
      <button className="ghost" onClick={() => onDecide(message.id, 'rejected')}>Reject</button>
    </div>}
    {onOpen && <button className="ghost" onClick={() => onOpen(message.transactionId)}>Open bill</button>}
  </article>;
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
