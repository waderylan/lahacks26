export interface CompanySummary {
  companyId: string;
  name: string;
  industry: string;
  profile: string;
  billCount: number;
  scenario?: boolean;
}

export interface Row {
  id: string;
  companyId: string;
  billId: string;
  docNumber: string;
  date: string;
  dueDate: string;
  vendor: string;
  vendorId: string;
  description: string;
  itemNames: string[];
  account: string;
  amountCents: number;
  expenseKind: string;
  costCategory: string;
  memo: string;
  project: string | null;
  supplyRole: string | null;
  lines: Record<string, unknown>[];
  payments: { id: string; date: string; amountCents: number; account: string }[];
  vendorRecord: Record<string, unknown> | null;
  projectRecord: Record<string, unknown> | null;
  provenance?: { description: string; memo: string } | null;
}

export interface CompanyBills {
  company: CompanySummary;
  totalBills: number;
  sampled: boolean;
  rows: Row[];
  disclosure?: string;
  reservedRows?: Row[];
  referenceOptions?: { vendors: string[]; accounts: string[] };
}

export type MatchState = 'match' | 'no_match' | 'uncertain';
export interface RecordResult {
  id: string;
  state: MatchState;
  pMatch: number | null;
  scoreKind?: 'jev_probability' | 'candidate_score_uncalibrated' | 'validation_calibrated';
}

export interface JevStatus {
  provider?: 'jev' | 'qwen';
  configured: boolean;
  model: string;
  via: string;
}
