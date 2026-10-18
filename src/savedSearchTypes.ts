export interface SearchDefinition {
  query: string;
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
}
