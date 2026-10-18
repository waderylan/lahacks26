import type { Express, Request, Response } from 'express';
import { EMPLOYEES, employeeById } from '../src/employees.ts';
import { draftSender, uid, type DraftMessage } from '../src/rules.ts';
import type { Mail, MailboxView, MailInput } from '../src/mailTypes.ts';
import type { ActionStore } from './actionStore.ts';
import type { WorkspaceData } from './workspaceData.ts';

const newest = (a: Mail, b: Mail) => b.sentAt.localeCompare(a.sentAt);

/** Company-scoped internal mail between employees. Each record is one message; replies share a threadId. */
export class Mailbox {
  constructor(readonly db: ActionStore, readonly data: WorkspaceData) {}

  view(companyId: string, as: string): MailboxView {
    this.data.bills(companyId);
    if (!employeeById(as)) throw new Error('Unknown employee.');
    const mail = this.db.list<Mail>('mail', companyId);
    const unread = Object.fromEntries(EMPLOYEES.map(e => [e.id, mail.filter(m => m.to === e.id && !m.readAt).length]));
    return { inbox: mail.filter(m => m.to === as).sort(newest), sent: mail.filter(m => m.from === as).sort(newest), unread };
  }

  send(companyId: string, input: MailInput): Mail {
    this.data.bills(companyId);
    const { from, to, replyTo } = input ?? {} as MailInput;
    const subject = typeof input?.subject === 'string' ? input.subject.trim() : '', body = typeof input?.body === 'string' ? input.body.trim() : '';
    if (!employeeById(from) || !employeeById(to)) throw new Error('Choose a sender and recipient from the team.');
    if (!subject || subject.length > 200 || !body || body.length > 8000) throw new Error('Add a subject (up to 200 characters) and a message.');
    const original = replyTo === undefined ? undefined : this.db.get<Mail>('mail', String(replyTo));
    if (replyTo !== undefined && (!original || original.companyId !== companyId || ![original.from, original.to].includes(from))) throw new Error('You can only reply to a message you sent or received.');
    // Intentional human Compose/reply can link up to 25 transactions from this company.
    const linked = Array.isArray(input.items) ? input.items.slice(0, 25).map(item => this.data.row(companyId, String(item?.transactionId))).map(row => ({ transactionId: row.id, billId: row.billId })) : [];
    const id = uid();
    const mail: Mail = { id, companyId, threadId: original?.threadId ?? id, ...(original && { replyTo: original.id }), from, to, subject, body,
      sentAt: new Date().toISOString(), readAt: null, source: 'direct', items: original?.items ?? linked };
    this.db.put('mail', id, companyId, mail);
    return mail;
  }

  markRead(companyId: string, id: string, as: string) {
    const mail = this.db.get<Mail>('mail', id);
    if (!mail || mail.companyId !== companyId) throw new Error('Message not found.');
    if (mail.to !== as) throw new Error('Only the recipient can mark a message read.');
    if (!mail.readAt) this.db.put('mail', id, companyId, { ...mail, readAt: new Date().toISOString() });
  }
}

/** Starts a new thread from one employee to another. */
function postMail(db: ActionStore, fields: Omit<Mail, 'id' | 'threadId' | 'sentAt' | 'readAt'>) {
  const id = uid();
  const mail: Mail = { ...fields, id, threadId: id, sentAt: new Date().toISOString(), readAt: null };
  db.put('mail', id, fields.companyId, mail);
  return mail;
}

/** Delivers an approved rule draft from the approving employee to its recipient. Call inside the approval transaction. */
export function deliverDraft(db: ActionStore, message: DraftMessage, from: string) {
  if (message.status !== 'approved' || message.generation !== 'ready' || draftSender(message) !== from || !employeeById(from)) throw new Error('Only the sender can deliver an approved, ready draft.');
  if (!message.employeeId) throw new Error('This draft has no recipient yet.');
  return postMail(db, { companyId: message.companyId, from, to: message.employeeId, subject: message.subject, body: message.body,
    source: 'rule', draftId: message.id, ruleName: message.ruleName, items: message.items.map(({ transactionId, billId }) => ({ transactionId, billId })) });
}

export function mailRoutes(app: Express, mailbox: Mailbox) {
  const route = (fn: (req: Request, res: Response) => unknown) => (req: Request, res: Response) => {
    try { fn(req, res); } catch (error) { res.status(400).json({ error: error instanceof Error ? error.message : 'Could not update messages.' }); }
  };
  app.get('/api/companies/:id/mail', route((req, res) => res.json(mailbox.view(String(req.params.id), String(req.query.as ?? '')))));
  app.post('/api/companies/:id/mail', route((req, res) => {
    const companyId = String(req.params.id);
    mailbox.send(companyId, req.body);
    res.json(mailbox.view(companyId, req.body.from));
  }));
  app.post('/api/companies/:id/mail/:mailId/read', route((req, res) => {
    const companyId = String(req.params.id), as = String(req.body?.as ?? '');
    mailbox.markRead(companyId, String(req.params.mailId), as);
    res.json(mailbox.view(companyId, as));
  }));
}
