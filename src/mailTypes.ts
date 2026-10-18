/** An internal message between two (fictional) employees, stored in SQLite. Nothing is emailed. */
export interface Mail {
  id: string; companyId: string; threadId: string; replyTo?: string;
  from: string; to: string; subject: string; body: string;
  sentAt: string; readAt: string | null;
  /** 'rule' when it was an approved rule draft; links back to the draft and the bills it covers. */
  source: 'direct' | 'rule'; draftId?: string; ruleName?: string;
  items: { transactionId: string; billId: string }[];
}
export interface MailboxView { inbox: Mail[]; sent: Mail[]; unread: Record<string, number> }
export interface MailInput { from: string; to: string; subject: string; body: string; replyTo?: string }
