import type { Row } from './types';
const usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });
const usdShort = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', notation: 'compact', maximumFractionDigits: 1 });
export const money = (cents: number) => usd.format(cents / 100);
export const moneyShort = (cents: number) => usdShort.format(cents / 100);
export const sumCents = (rows: Row[]) => rows.reduce((s, r) => s + r.amountCents, 0);
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const monthLabel = (ym: string) => `${MONTHS[Number(ym.slice(5, 7)) - 1]} ${ym.slice(2, 4)}`;

export const openCents = (r: Row) => r.txnType === 'bank' ? 0 : Math.max(0, r.amountCents - r.payments.reduce((s, p) => s + p.amountCents, 0));
export const asOfDate = (rows: Row[]) => rows.flatMap(r => [r.date, ...r.payments.map(p => p.date)]).sort().pop() ?? '';
const addDays = (date: string, n: number) => new Date(Date.parse(`${date}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
export const DUE_WINDOWS = [
  { id: 'overdue', label: 'Overdue' },
  { id: 'week1', label: 'Next 7 days' },
  { id: 'week2', label: '8–14 days' },
  { id: 'month', label: '15–30 days' },
  { id: 'later', label: 'Later' },
] as const;
export type DueWindow = typeof DUE_WINDOWS[number]['id'];
export function dueWindow(dueDate: string, asOf: string): DueWindow {
  if (dueDate < asOf) return 'overdue';
  if (dueDate <= addDays(asOf, 7)) return 'week1';
  if (dueDate <= addDays(asOf, 14)) return 'week2';
  if (dueDate <= addDays(asOf, 30)) return 'month';
  return 'later';
}

export function dashboardTotals(rows: Row[]) {
 const bills=rows.filter(r=>(r.txnType??'bill')==='bill');
 const invoices=rows.filter(r=>r.txnType==='invoice');
 const bank=rows.filter(r=>r.txnType==='bank'); const asOf=asOfDate(rows);
 return { records:rows.length, bills:bills.length, billSpend:sumCents(bills), payables:bills.reduce((s,r)=>s+openCents(r),0),
 overdue:bills.filter(r=>r.dueDate<asOf).reduce((s,r)=>s+openCents(r),0), receivables:invoices.reduce((s,r)=>s+openCents(r),0),
 deposits:sumCents(bank.filter(r=>r.details?.direction==='deposit')), withdrawals:sumCents(bank.filter(r=>r.details?.direction==='withdrawal')), asOf };
}
