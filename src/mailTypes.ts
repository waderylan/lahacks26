/** An internal message between two (fictional) employees, stored in SQLite. Nothing is emailed. */
export interface Mail {
  id: string; companyId: string; threadId: string; replyTo?: string;
  from: string; to: string; subject: string; body: string;
  sentAt: string; readAt: string | null;
  /** 'rule' when it was an approved rule draft, 'risk' for a payment-risk escalation; both link the bills they cover. */
  source: 'direct' | 'rule' | 'risk'; draftId?: string; ruleName?: string;
  items: { transactionId: string; billId: string }[];
}
export interface MailboxView { inbox: Mail[]; sent: Mail[]; unread: Record<string, number> }
export interface MailInput { from: string; to: string; subject: string; body: string; replyTo?: string; items?: Mail['items'] }
