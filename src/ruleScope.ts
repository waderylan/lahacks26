import type { Row } from './types';
import { ownerLabel, sameOwner } from './employees';

export interface RuleScope {
  type: 'all' | 'bill' | 'invoice' | 'bank';
  status: 'all' | 'needs_review' | 'reviewed' | 'flagged';
  assignee: string;
}
export const ALL_RECORDS: RuleScope = { type: 'all', status: 'all', assignee: 'all' };
export function inScope(row: Row, scope: RuleScope = ALL_RECORDS): boolean {
  return (scope.type === 'all' || (row.txnType ?? 'bill') === scope.type)
    && (scope.status === 'all' || (scope.status === 'reviewed' ? Boolean(row.dashboard?.reviewed) : scope.status === 'flagged' ? Boolean(row.dashboard?.flags.length) : !row.dashboard?.reviewed))
    && (scope.assignee === 'all' || (scope.assignee === 'unassigned' ? !row.dashboard?.owner : sameOwner(row.dashboard?.owner, scope.assignee)));
}
export function scopeLabel(scope: RuleScope = ALL_RECORDS): string {
  return [scope.type === 'all' ? 'All transaction types' : { bill: 'Vendor bills', invoice: 'Customer invoices', bank: 'Bank transactions' }[scope.type],
    scope.status === 'all' ? '' : { needs_review: 'Needs review', reviewed: 'Reviewed', flagged: 'Flagged' }[scope.status],
    scope.assignee === 'all' ? '' : scope.assignee === 'unassigned' ? 'Unassigned' : `Assigned to ${ownerLabel(scope.assignee)}`].filter(Boolean).join(' · ');
}
