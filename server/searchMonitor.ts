import { createHash, randomUUID } from 'node:crypto';
import type { ActionStore } from './actionStore.ts';
import type { Judge } from './actionEngine.ts';
import type { Row } from '../src/types.ts';
import type { NewSearchMatch, SavedSearch, SearchDefinition, SearchTracking } from '../src/savedSearchTypes.ts';
import { evaluationEvidence } from '../src/jevEvidence.ts';
import { matchesSearchFilters } from '../src/searchFilters.ts';

export type StoredSearch = Omit<SavedSearch, 'tracking' | 'enabled'> & { enabled?: boolean };
export interface SearchSource { rows: (company: string) => Row[]; judge: Judge }
type Answer = 'match' | 'no_match' | 'uncertain';
interface Watch {
  epoch: string; initialized: boolean; versions: Record<string, string>; answers: Record<string, Answer>;
  unread: Record<string, string>; checkedAt: string | null; changed: number; error: string | null; attempts: number; retryAt: string | null;
}
const empty = (): Watch => ({ epoch: randomUUID(), initialized: false, versions: {}, answers: {}, unread: {}, checkedAt: null, changed: 0, error: null, attempts: 0, retryAt: null });
const version = (row: Row) => createHash('sha256').update(JSON.stringify([evaluationEvidence(row), row.dashboard?.owner ?? '', Boolean(row.dashboard?.reviewed), Boolean(row.dashboard?.flags.length)])).digest('hex');
export const searchCriteria = (d: SearchDefinition) => JSON.stringify([d.query.trim(), d.type, d.status, d.assignee, d.tab]);

/** Watches only create match notifications. They never write bills, tasks, or rule actions. */
export class SearchMonitor {
  private running = new Map<string, { promise: Promise<void>; epoch: string }>();
  private scanning = false;
  constructor(private db: ActionStore, private source?: SearchSource) {}
  private watch(id: string) { return this.db.get<Watch>('search-watch', id); }
  reset(search: StoredSearch) { this.db.put('search-watch', search.id, search.companyId, empty()); }
  invalidate(search: StoredSearch) {
    const previous = this.watch(search.id) ?? empty();
    this.db.put('search-watch', search.id, search.companyId, { ...previous, epoch: randomUUID(), error: null, retryAt: null, attempts: 0 });
  }
  summary(id: string): SearchTracking {
    const state = this.watch(id);
    return { status: this.running.get(id)?.epoch === state?.epoch && this.running.has(id) ? 'checking' : state?.error ? 'error' : state?.initialized ? 'ready' : 'never',
      lastCheckedAt: state?.checkedAt ?? null, changedRecords: state?.changed ?? 0,
      matches: Object.values(state?.answers ?? {}).filter(answer => answer === 'match').length,
      uncertain: Object.values(state?.answers ?? {}).filter(answer => answer === 'uncertain').length,
      newMatches: Object.keys(state?.unread ?? {}).length, error: state?.error ?? null, retryAt: state?.retryAt ?? null };
  }
  check(id: string): Promise<void> {
    if (!this.watch(id)) {
      const search = this.db.get<StoredSearch>('saved-search', id); if (!search) return Promise.resolve();
      this.reset(search);
    }
    const epoch = this.watch(id)!.epoch, existing = this.running.get(id);
    if (existing?.epoch === epoch) return existing.promise;
    const work = this.perform(id).finally(() => { if (this.running.get(id)?.promise === work) this.running.delete(id); });
    this.running.set(id, { promise: work, epoch }); return work;
  }
  private async perform(id: string) {
    const search = this.db.get<StoredSearch>('saved-search', id);
    if (!search) return;
    if (!this.watch(id)) this.reset(search);
    const before = this.watch(id)!;
    try {
      if (!this.source) throw new Error('Automatic checking is unavailable.');
      const rows = this.source.rows(search.companyId);
      const versions = Object.fromEntries(rows.map(row => [row.id, version(row)]));
      const changed = rows.filter(row => before.versions[row.id] !== versions[row.id]);
      const candidates = changed.filter(row => matchesSearchFilters(row, search.definition));
      const answers: Record<string, Answer> = Object.fromEntries(rows.filter(row => before.answers[row.id]).map(row => [row.id, before.answers[row.id]]));
      for (const row of changed) answers[row.id] = 'no_match';
      if (search.definition.query.trim() && candidates.length) {
        const judged = await this.source.judge(search.companyId, search.definition.query.trim(), candidates);
        for (const row of candidates) {
          if (!['match', 'no_match', 'uncertain'].includes(judged[row.id])) throw new Error('Some records could not be checked. Try again.');
          answers[row.id] = judged[row.id] as Answer;
        }
      } else for (const row of candidates) answers[row.id] = 'match';
      // Ignore judgments for records edited while the model was working.
      const currentRows = new Map(this.source.rows(search.companyId).map(row => [row.id, row]));
      if (changed.some(row => !currentRows.has(row.id) || version(currentRows.get(row.id)!) !== versions[row.id])) return;
      this.db.atomic(() => {
        const current = this.watch(id), latest = this.db.get<StoredSearch>('saved-search', id);
        if (!latest || !current || current.epoch !== before.epoch || searchCriteria(latest.definition) !== searchCriteria(search.definition)) return;
        const unread = Object.fromEntries(Object.entries(current.unread).filter(([rowId]) => answers[rowId] === 'match'));
        if (before.initialized) for (const row of changed) if (answers[row.id] === 'match' && before.answers[row.id] !== 'match') unread[row.id] = randomUUID();
        this.db.put('search-watch', id, search.companyId, { ...current, initialized: true, versions, answers, unread, checkedAt: new Date().toISOString(), changed: changed.length, error: null, attempts: 0, retryAt: null } satisfies Watch);
      });
    } catch (error) {
      this.db.atomic(() => {
        const current = this.watch(id);
        if (!this.db.get('saved-search', id) || !current || current.epoch !== before.epoch) return;
        const attempts = current.attempts + 1;
        console.error('Saved search check:', error instanceof Error ? error.message : 'Check failed.');
        this.db.put('search-watch', id, search.companyId, { ...current, error: 'Some records could not be checked. Try again.', attempts, retryAt: new Date(Date.now() + Math.min(300000, 10000 * 2 ** Math.min(attempts - 1, 5))).toISOString() } satisfies Watch);
      });
    }
  }
  async scan() {
    if (this.scanning) return; this.scanning = true;
    try {
      await Promise.all(this.db.list<StoredSearch>('saved-search').filter(search => search.enabled).map(search => {
        const retry = this.watch(search.id)?.retryAt;
        return retry && Date.parse(retry) > Date.now() ? Promise.resolve() : this.check(search.id);
      }));
    } finally { this.scanning = false; }
  }
  newMatches(search: StoredSearch): { matches: NewSearchMatch[]; changedSinceCheck: boolean } {
    const state = this.watch(search.id);
    if (!state || !this.source) return { matches: [], changedSinceCheck: false };
    const current = new Map(this.source.rows(search.companyId).map(row => [row.id, row]));
    const matches = Object.entries(state.unread).flatMap(([id, token]) => {
      const row = current.get(id);
      return row && version(row) === state.versions[id] && matchesSearchFilters(row, search.definition) ? [{ row, token }] : [];
    });
    return { matches, changedSinceCheck: matches.length < Object.keys(state.unread).length };
  }
  seen(search: StoredSearch, input: unknown) {
    if (!Array.isArray(input) || input.length > 10000 || input.some(item => !item || typeof item.id !== 'string' || typeof item.token !== 'string')) throw new Error('Choose the matches you viewed.');
    this.db.atomic(() => {
      const state = this.watch(search.id); if (!state) return;
      for (const { id, token } of input) if (state.unread[id] === token) delete state.unread[id];
      this.db.put('search-watch', search.id, search.companyId, state);
    });
  }
}
