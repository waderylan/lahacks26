import type { SearchDefinition } from './savedSearchTypes';
import type { Row } from './types';

export function matchesSearchFilters(row: Row, search: SearchDefinition): boolean {
  const reviewed = Boolean(row.dashboard?.reviewed);
  return (search.type === 'all' || (row.txnType ?? 'bill') === search.type)
    && (search.status === 'all' || (search.status === 'reviewed' ? reviewed : search.status === 'flagged' ? Boolean(row.dashboard?.flags.length) : !reviewed))
    && (search.assignee === 'all' || (search.assignee === 'unassigned' ? !row.dashboard?.owner : row.dashboard?.owner === search.assignee))
    && (search.tab === 'all' || (search.tab === 'reviewed' ? reviewed : !reviewed));
}
