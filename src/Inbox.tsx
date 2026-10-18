import { useEffect, useState, type ReactNode } from 'react';
import { EMPLOYEES, employeeById } from './employees';
import type { Mail } from './mailTypes';
import type { MailboxController } from './useMailbox';

const nameOf = (id: string) => employeeById(id)?.name ?? id;
const firstName = (id: string) => nameOf(id).split(' ')[0];
const initials = (id: string) => nameOf(id).split(' ').map(part => part[0]).join('').slice(0, 2);
const when = (iso: string) => {
  const date = new Date(iso);
  return date.toDateString() === new Date().toDateString() ? date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : date.toLocaleDateString([], { month: 'short', day: 'numeric' });
};

/** One tab per employee. The selected employee is who you are: whose inbox you see and who approvals are sent from. */
export function EmployeeTabs({ value, unread, onChange }: { value: string; unread: Record<string, number>; onChange: (id: string) => void }) {
  return <nav className="employee-tabs" role="tablist" aria-label="Signed in as">
    <span className="employee-tabs-label">Signed in as</span>
    {EMPLOYEES.map(e => <button key={e.id} role="tab" aria-selected={e.id === value} className={e.id === value ? 'on' : ''} title={`${e.name} · ${e.title}`} onClick={() => onChange(e.id)}>
      <span className="avatar" aria-hidden>{initials(e.id)}</span>{firstName(e.id)}
      {unread[e.id] > 0 && <b className="employee-unread" aria-label={`${unread[e.id]} unread`}>{unread[e.id]}</b>}
    </button>)}
  </nav>;
}

type Folder = 'inbox' | 'sent' | 'approvals';
type Compose = { to: string; subject: string; body: string; replyTo?: string };

export function Inbox({ mailbox, as, approvals, pendingApprovals, onInspect }: { mailbox: MailboxController; as: string; approvals: ReactNode; pendingApprovals: number; onInspect: (transactionId: string) => void }) {
  const [folder, setFolder] = useState<Folder>('inbox');
  const [openId, setOpenId] = useState<string | null>(null);
  const [compose, setCompose] = useState<Compose | null>(null);
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState('');
  useEffect(() => { setOpenId(null); setCompose(null); setSendError(''); }, [as]);
  const list = folder === 'sent' ? mailbox.sent : mailbox.inbox;
  const all = [...mailbox.inbox, ...mailbox.sent];
  const open = all.find(m => m.id === openId) ?? null;
  const thread = open ? [...new Map(all.filter(m => m.threadId === open.threadId).map(m => [m.id, m])).values()].sort((a, b) => a.sentAt.localeCompare(b.sentAt)) : [];
  const select = (mail: Mail) => {
    setOpenId(mail.id); setCompose(null);
    if (mail.to === as && !mail.readAt) void mailbox.markRead(mail.id);
  };
  const reply = (mail: Mail) => setCompose({ to: mail.from === as ? mail.to : mail.from, subject: mail.subject.startsWith('Re: ') ? mail.subject : `Re: ${mail.subject}`, body: '', replyTo: mail.id });
  const send = async () => {
    if (!compose) return;
    setSending(true); setSendError('');
    try { await mailbox.send(compose); setCompose(null); setFolder('sent'); setOpenId(null); }
    catch (error) { setSendError((error as Error).message); }
    finally { setSending(false); }
  };
  const unread = mailbox.unread[as] ?? 0;

  return <section className="dashboard-board inbox" aria-label="Messages">
    <div className="dashboard-board-heading"><h2>Messages · {nameOf(as)}</h2><span className="small muted">Internal messages saved in SQLite · nothing is emailed</span></div>
    {mailbox.error && <div className="rules-notice error" role="alert">{mailbox.error}</div>}
    <div className="inbox-layout">
      <nav className="inbox-folders" aria-label="Message folders">
        <button className="primary" onClick={() => { setCompose({ to: EMPLOYEES.find(e => e.id !== as)!.id, subject: '', body: '' }); setOpenId(null); }}>Compose</button>
        {([['inbox', 'Inbox', unread], ['sent', 'Sent', 0], ['approvals', 'Approvals', pendingApprovals]] as const).map(([id, label, count]) =>
          <button key={id} className={folder === id ? 'on' : ''} aria-pressed={folder === id} onClick={() => { setFolder(id); setOpenId(null); }}>{label}{count > 0 && <b>{count}</b>}</button>)}
      </nav>
      {folder === 'approvals' ? <div className="inbox-approvals">
        <p className="small muted">Drafts written by rules. Approving sends the message from {nameOf(as)} to the recipient's inbox.</p>
        {approvals}
      </div> : <>
        <ul className="inbox-list" aria-label={folder === 'sent' ? 'Sent messages' : 'Received messages'}>
          {list.length ? list.map(mail => {
            const other = folder === 'sent' ? mail.to : mail.from;
            const isUnread = folder === 'inbox' && !mail.readAt;
            return <li key={mail.id}><button className={`${mail.id === openId ? 'on' : ''} ${isUnread ? 'unread' : ''}`} onClick={() => select(mail)}>
              <span className="avatar" aria-hidden>{initials(other)}</span>
              <span className="inbox-item"><span className="inbox-item-top"><b>{folder === 'sent' ? `To ${nameOf(other)}` : nameOf(other)}</b><time>{when(mail.sentAt)}</time></span>
                <span className="inbox-subject">{mail.subject}</span>
                <span className="inbox-preview muted">{mail.body.replace(/\s+/g, ' ').slice(0, 90)}</span></span>
            </button></li>;
          }) : <li className="dashboard-empty">{folder === 'sent' ? 'Nothing sent yet. Compose a message, or approve a rule draft from Approvals.' : `No messages for ${firstName(as)} yet.`}</li>}
        </ul>
        <div className="inbox-reader">
          {compose ? <form className="inbox-compose" onSubmit={e => { e.preventDefault(); void send(); }}>
            <h3>{compose.replyTo ? 'Reply' : 'New message'}</h3>
            <label className="field-label">From<input value={`${nameOf(as)} · ${employeeById(as)?.title}`} disabled /></label>
            <label className="field-label">To<select aria-label="Message to" value={compose.to} disabled={Boolean(compose.replyTo)} onChange={e => setCompose({ ...compose, to: e.target.value })}>
              {EMPLOYEES.filter(e => e.id !== as).map(e => <option key={e.id} value={e.id}>{e.name} — {e.title}</option>)}</select></label>
            <label className="field-label">Subject<input aria-label="Message subject" maxLength={200} value={compose.subject} onChange={e => setCompose({ ...compose, subject: e.target.value })} /></label>
            <label className="field-label">Message<textarea aria-label="Message body" maxLength={8000} rows={8} value={compose.body} onChange={e => setCompose({ ...compose, body: e.target.value })} /></label>
            {sendError && <p className="rules-notice error" role="alert">{sendError}</p>}
            <div className="message-actions"><button className="primary" type="submit" disabled={sending || !compose.subject.trim() || !compose.body.trim()}>{sending ? 'Sending…' : 'Send'}</button><button type="button" className="ghost" onClick={() => setCompose(null)}>Cancel</button></div>
          </form> : open ? <article className="inbox-thread" aria-label="Conversation">
            <h3>{thread[0]?.subject ?? open.subject}</h3>
            {thread.map(mail => <div key={mail.id} className={`inbox-mail ${mail.id === open.id ? 'on' : ''}`}>
              <div className="inbox-mail-head"><span className="avatar" aria-hidden>{initials(mail.from)}</span><div>
                <b>{nameOf(mail.from)}</b> <span className="muted">to {mail.to === as ? 'you' : nameOf(mail.to)} · {new Date(mail.sentAt).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</span>
                {mail.source === 'rule' && <div className="small muted">Approved draft from rule “{mail.ruleName}”</div>}
              </div></div>
              <pre className="message-body">{mail.body}</pre>
            </div>)}
            {open.items.length > 0 && <p className="message-bills"><span className="small muted">Bills:</span>{open.items.map(item => <button key={item.transactionId} className="ghost" onClick={() => onInspect(item.transactionId)}>{item.billId}</button>)}</p>}
            <div className="message-actions"><button className="primary" onClick={() => reply(thread[thread.length - 1] ?? open)}>Reply</button></div>
          </article> : <p className="dashboard-empty">Select a message to read it.</p>}
        </div>
      </>}
    </div>
  </section>;
}
