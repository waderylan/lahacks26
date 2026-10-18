import type { RuleNode } from './rules';
export interface SearchDefinition {
  mode?: 'simple' | 'combined';
  query: string;
  expression?: RuleNode;
  result?: 'all' | 'true' | 'uncertain' | 'false';
  type: 'all' | 'bill' | 'invoice' | 'bank';
  status: 'all' | 'needs_review' | 'reviewed' | 'flagged';
  assignee: string;
  tab: 'all' | 'needs' | 'reviewed';
  matchesOnly: boolean;
  sort: { key: 'date' | 'vendor' | 'account' | 'amountCents' | 'match'; dir: 1 | -1 };
}

export interface SavedSearch {
  id: string;
  companyId: string;
  name: string;
  definition: SearchDefinition;
  revision: number;
  createdAt: string;
  updatedAt: string;
  enabled: boolean;
  tracking: SearchTracking;
  monitoringRetired?: boolean;
}

export interface SearchTracking {
  status: 'never' | 'checking' | 'ready' | 'error';
  lastCheckedAt: string | null;
  changedRecords: number;
  matches: number;
  uncertain: number;
  newMatches: number;
  error: string | null;
  retryAt: string | null;
}

export interface NewSearchMatch {
  row: import('./types').Row;
  token: string;
}
