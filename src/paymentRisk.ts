import type { Row } from './types';

export type RiskVerdict = 'suspicious' | 'cannot_tell' | 'safe';
export interface RiskResult {
  id: string; verdict: RiskVerdict;
  /** Jev's probability for the chosen verdict, and for `suspicious` specifically (used for ordering). */
  probability: number; pSuspicious: number;
  signals: string[]; checkedAt: string;
  /** Enough to list the transaction without loading it. */
  summary: { billId: string; docNumber: string; vendor: string; date: string; amountCents: number; txnType?: Row['txnType'] };
}
export interface RiskState { results: Record<string, RiskResult>; escalated: Record<string, { at: string; by: string }> }
export const RISK_FLAG = 'Possible payment diversion';

const ENDING = /account(?:\s+number)?\s+ending(?:\s+in)?\s+(\d{4})/gi;
const CHANGE_REQUEST = /(bank|account|remit\w*|payment details)[^.]{0,40}\b(changed|new|update[ds]?|switch(ed)?)\b|\bnew (bank|account)\b/i;
const PRESSURE = /\burgent\b|\bimmediately\b|\bprocess today\b|cannot take (confirmation )?calls|do not (call|contact|confirm)|\bconfidential\b|keep this between|don'?t (mention|tell|loop)/i;
const days = (from: string, to: string) => Math.round((Date.UTC(+to.slice(0, 4), +to.slice(5, 7) - 1, +to.slice(8, 10)) - Date.UTC(+from.slice(0, 4), +from.slice(5, 7) - 1, +from.slice(8, 10))) / 86_400_000);

/**
 * Plain, deterministic warning signs shown next to Jev's verdict so a reviewer can see why.
 * They explain; they never decide (a documented, verified change raises the same signs).
 */
export function paymentSignals(row: Row): string[] {
  const vendor = (row.vendorRecord ?? {}) as Record<string, unknown>;
  const details = (row.details ?? {}) as Record<string, unknown>;
  const onFile = String((row.txnType === 'invoice' ? details.remit_to_account_ending : vendor.payee_account_ending) ?? '') || undefined;
  const text = [row.description, row.memo, ...(row.evidence ?? []).map(e => `${e.title}. ${e.text}`)].join('\n');
  const signals: string[] = [];
  const endings = new Set([...text.matchAll(ENDING)].map(m => m[1]));
  if (row.txnType === 'bank' && details.direction === 'withdrawal' && details.counterparty_account_ending) endings.add(String(details.counterparty_account_ending));
  const other = [...endings].filter(e => e !== onFile);
  if (onFile && other.length) signals.push(`Account ${other.join(', ')} differs from ${onFile} on file`);
  const changed = typeof vendor.payee_details_last_changed === 'string' ? vendor.payee_details_last_changed : undefined;
  if (changed && /^\d{4}-\d{2}-\d{2}/.test(changed) && /^\d{4}-\d{2}-\d{2}/.test(row.date)) {
    const gap = days(changed, row.date);
    if (gap >= 0 && gap <= 30) signals.push(gap === 0 ? 'Payee details changed the same day' : `Payee details changed ${gap} day${gap === 1 ? '' : 's'} before`);
  }
  if (CHANGE_REQUEST.test(`${row.description}\n${row.memo}`)) signals.push('Asks to change where payment goes');
  if (PRESSURE.test(`${row.description}\n${row.memo}`)) signals.push('Urgency or secrecy language');
  return signals;
}
