import type { Row } from './types.ts';

/** Only business records visible in the UI reach Jev; no provenance or evaluation labels. */
export function supportingContext(row: Row) {
  if (!row.evidence) return {};
  const vendor = row.vendorRecord ?? {};
  const project = row.projectRecord ?? {};
  const payee = vendor.payee_account_ending ? { bank: vendor.payee_bank, account_ending: vendor.payee_account_ending, last_changed: vendor.payee_details_last_changed, verification: vendor.payee_change_verification } : undefined;
  return JSON.parse(JSON.stringify({
    type: { bill: 'vendor_bill', invoice: 'customer_invoice', bank: 'bank_transaction' }[row.txnType ?? 'bill'],
    doc_number: row.docNumber,
    ...(payee && { vendor_payee: payee }),
    ...(row.details && { details: row.details }),
    ...(row.project && { project: { name: row.project, status: project.status, started: project.started_date, cancelled: project.cancelled_date, completed: project.completed_date } }),
    ...(row.evidence.length && { evidence: row.evidence.map(e => ({ kind: e.kind, date: e.date, title: e.title, text: e.text })) }),
    ...(row.related?.length && { related_bills: row.related.map(r => ({ doc_number: r.docNumber, billed_as: r.vendor, date: r.date, amount: (r.amountCents / 100).toFixed(2), description: r.description, memo: r.memo })) }),
  }));
}

/** The same evidence defines both the model payload and client/server cache validity. */
export const evaluationEvidence = (row: Row) => ({
  date: row.date,
  vendor: row.vendor,
  account: row.account,
  expense_kind: row.expenseKind,
  amount: (row.amountCents / 100).toFixed(2),
  item_names: row.itemNames,
  description: row.description,
  memo: row.memo,
  ...supportingContext(row),
});
