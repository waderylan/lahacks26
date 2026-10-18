import type { Row } from './types';

/** Jev review checks: each asks one question of every transaction and can escalate what it flags. */
export type CheckKind = 'payment-risk' | 'duplicates';
/** `flag`: Jev found the problem; `unsure`: can't tell from the records; `clear`: no problem. */
export type CheckVerdict = 'flag' | 'unsure' | 'clear';
export interface CheckResult {
  id: string; verdict: CheckVerdict;
  /** Jev's probability for the chosen verdict, and for `flag` specifically (used for ordering). */
  probability: number; pFlag: number;
  signals: string[]; checkedAt: string;
  /** Enough to list the transaction without loading it. */
  summary: { billId: string; docNumber: string; vendor: string; date: string; amountCents: number; txnType?: Row['txnType'] };
  /** Duplicates: the earlier transaction Jev says this one repeats. */
  original?: { billId: string; docNumber: string; date: string; amountCents: number };
}
export interface CheckState { results: Record<string, CheckResult>; escalated: Record<string, { at: string; by: string; to?: string }> }

export interface CheckInfo {
  kind: CheckKind; title: string; intro: string;
  /** How a flagged / unsure result reads, e.g. "suspicious". */
  flagged: string; unsure: string;
  /** Flag added to each escalated transaction, and who escalations go to by default. */
  flag: string; escalateTo: string;
  /** Shown when the check needs data only some companies have. */
  needs?: string;
}
export const CHECKS: Record<CheckKind, CheckInfo> = {
  'payment-risk': {
    kind: 'payment-risk', title: 'Payment risk', flagged: 'suspicious', unsure: "can't tell", flag: 'Possible payment diversion', escalateTo: 'emp-cfo',
    intro: "Jev checks whether money is being sent to a bank account the business hasn't verified, using the vendor's details on file, the payment's destination and any change requests or evidence.",
  },
  duplicates: {
    kind: 'duplicates', title: 'Duplicates', flagged: 'duplicate', unsure: "can't tell", flag: 'Possible duplicate', escalateTo: 'emp-ap',
    intro: 'Jev compares each transaction with earlier ones from the same vendor or customer and decides whether it charges or pays for the same thing again, naming the earlier one it repeats. Separate orders, periods, stages, deliveries and scheduled payments are not duplicates.',
    needs: 'Works best on companies with supporting records (the synthetic ones); with no records, similar charges come back as can’t tell or duplicate without proof.',
  },
};
