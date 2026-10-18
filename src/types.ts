export interface CompanySummary {
  companyId: string;
  name: string;
  industry: string;
  profile: string;
  billCount: number;
  scenario?: boolean;
  synthetic?: boolean;
  derivedFrom?: string;
  source?: 'workspace';
}

export interface Evidence { id: string; kind: string; date: string; title: string; text: string }
export interface RelatedBill { id: string; docNumber: string; vendor: string; date: string; amountCents: number; description: string; memo: string }

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
  evidence?: Evidence[];
  related?: RelatedBill[];
  txnType?: 'bill' | 'invoice' | 'bank';
  details?: Record<string, string>;
  provenance?: { description: string; memo: string } | null;
  workspaceChanges?: { account?: string; memo?: string };
  sourceVersion?: string;
  dashboard?: { owner: string; flags: string[]; tags: string[]; reviewed: boolean; automatedCheck: boolean; taskIds: string[] };
}

export interface CompanyBills {
  company: CompanySummary;
  totalBills: number;
  sampled: boolean;
  rows: Row[];
  disclosure?: string;
  datasetVersion?: string;
  reservedRows?: Row[];
  curatedSample?: boolean;
  referenceOptions?: { vendors: string[]; accounts: string[] };
}

export type MatchState = 'match' | 'no_match' | 'uncertain';
export interface RecordResult {
  id: string;
  state: MatchState;
  pMatch: number;
}

export interface JevStatus {
  configured: boolean;
  model: string;
  via: string;
}
