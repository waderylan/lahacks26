// Links to authored, app-visible business records, never evaluation labels or model results.
export const STARTER_DEMOS: Record<string, { presetId: string; rowId: string; note: string }> = {
  'company-101': { presetId: 'duplicate-charges', rowId: 'bill-00106', note: 'Compare the reissued phone-case invoice with the earlier charge for the same amount and purchase order.' },
  'company-102': { presetId: 'unsupported-expenses', rowId: 'bill-00145', note: 'Compare the sitework bill with the project cancellation and stand-down notice.' },
  'company-103': { presetId: 'missing-documentation', rowId: 'bill-00055', note: 'The production-supplies receipt has no itemized purchases. Ask for the details needed to support it.' },
  'company-104': { presetId: 'payment-fraud', rowId: 'bill-00097', note: 'Fraud review example: account 7731 conflicts with 9631 on file; the request discourages a confirmation call.' },
};
