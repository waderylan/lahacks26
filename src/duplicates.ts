import type { Row } from './types';

export interface Candidate { billId: string; docNumber: string; vendor: string; date: string; amountCents: number; description: string; memo: string }

const day = (iso: string) => Date.parse(`${iso}T12:00:00Z`) / 86_400_000;
const party = (row: Pick<Row, 'vendorId' | 'vendor'>) => row.vendorId || row.vendor;

/**
 * Earlier transactions this one could repeat: same type, same vendor or customer, nearest first.
 * Computed from the whole company (not row.related, which also holds later bills that can crowd the original out).
 */
export function earlierCandidates(row: Row, rows: Row[], limit = 4): Candidate[] {
  const window = row.txnType === 'bank' ? 30 : 60;
  return rows
    .filter(o => o.id !== row.id && (o.txnType ?? 'bill') === (row.txnType ?? 'bill') && party(o) === party(row)
      && (o.date < row.date || (o.date === row.date && o.billId < row.billId)) && day(row.date) - day(o.date) <= window)
    .sort((a, b) => b.date.localeCompare(a.date) || b.billId.localeCompare(a.billId))
    .slice(0, limit)
    .map(o => ({ billId: o.billId, docNumber: o.docNumber, vendor: o.vendor, date: o.date, amountCents: o.amountCents, description: o.description.slice(0, 120), memo: o.memo.slice(0, 120) }));
}

const digits = (doc: string) => doc.replace(/\D/g, '');
/** Same digits in another order, or one character changed: typical of a reissued or altered invoice number. */
export function similarDocNumbers(a: string, b: string): boolean {
  if (!a || !b || a === b) return false;
  const da = digits(a), db = digits(b);
  if (da.length >= 3 && da.length === db.length && da !== db && [...da].sort().join() === [...db].sort().join()) return true;
  if (a.length !== b.length) return false;
  let differences = 0; for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) differences++;
  return differences === 1;
}

/**
 * Plain warning signs shown beside Jev's verdict. They compare against Jev's chosen original when it named one,
 * otherwise against the nearest earlier candidate with the same amount. They explain; they never decide.
 */
export function duplicateSignals(row: Row, candidates: Candidate[], originalBillId?: string): string[] {
  const original = candidates.find(c => c.billId === originalBillId) ?? candidates.find(c => c.amountCents === row.amountCents);
  const signals: string[] = [];
  if (original) {
    const gap = Math.round(day(row.date) - day(original.date));
    if (original.amountCents === row.amountCents) signals.push(`Same amount as ${original.docNumber || original.billId}, ${gap === 0 ? 'same day' : `${gap} day${gap === 1 ? '' : 's'} earlier`}`);
    if (similarDocNumbers(row.docNumber, original.docNumber)) signals.push(`Document number ${row.docNumber} looks like ${original.docNumber}`);
    if (original.vendor !== row.vendor) signals.push(`Billed under another name: "${original.vendor}"`);
  }
  if (signals.length && !row.evidence?.length) signals.push('No supporting records on this transaction');
  return signals;
}
