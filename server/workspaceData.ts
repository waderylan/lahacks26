import { loadCompanyBills, companyAccounts } from './data.ts';
import type { ActionStore } from './actionStore.ts';
import type { CompanyBills, Row } from '../src/types.ts';
import type { AccountOption } from '../src/actionTypes.ts';

export class WorkspaceData {
  private imported = new Set<string>();
  private accountCache = new Map<string, AccountOption[]>();
  constructor(readonly store: ActionStore, private loadOriginal = loadCompanyBills, private loadAccounts = companyAccounts) {}
  bills(companyId: string): CompanyBills {
    const original = this.loadOriginal(companyId);
    if (!this.imported.has(companyId)) { this.store.seed(companyId, original.rows); this.imported.add(companyId); }
    return { ...original, company: { ...original.company, source: 'workspace' }, rows: this.store.rows(companyId) };
  }
  row(companyId: string, id: string): Row {
    if (!this.imported.has(companyId)) this.bills(companyId);
    if (!id.startsWith(`${companyId}:`)) throw new Error('Cross-company bill access refused.');
    const row = this.store.row(companyId, id); if (!row) throw new Error('Bill not found in this company.'); return row;
  }
  accounts(companyId: string): AccountOption[] {
    if (this.accountCache.has(companyId)) return this.accountCache.get(companyId)!;
    const data = this.bills(companyId);
    const accounts = this.loadAccounts(companyId);
    const options = accounts.length ? accounts : [...new Set(data.rows.map(row => row.account))].filter(Boolean).map((name, index) => ({ id: `account-${index}`, name }));
    this.accountCache.set(companyId, options); return options;
  }
}
