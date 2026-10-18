import { randomUUID } from 'node:crypto';
import type { Express, Request, Response } from 'express';
import type { ActionStore } from './actionStore.ts';
import type { SavedSearch, SearchDefinition } from '../src/savedSearchTypes.ts';
import { SearchMonitor, searchCriteria, type SearchSource, type StoredSearch } from './searchMonitor.ts';

const kind = 'saved-search';
class SearchError extends Error {
  constructor(message: string, readonly status = 400) { super(message); }
}
const object = (input: unknown): Record<string, unknown> => {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new SearchError('Invalid saved search.');
  return input as Record<string, unknown>;
};
function validate(input: unknown): { name: string; definition: SearchDefinition } {
  const value = object(input), definition = object(value.definition), sort = object(definition.sort);
  if (typeof value.name !== 'string' || !value.name.trim() || value.name.trim().length > 80) throw new SearchError('Name the search using 1–80 characters.');
  if (typeof definition.query !== 'string' || definition.query.length > 500) throw new SearchError('Keep the search text to 500 characters.');
  if (!['all', 'bill', 'invoice', 'bank'].includes(definition.type as string) || !['all', 'needs_review', 'reviewed', 'flagged'].includes(definition.status as string)
    || typeof definition.assignee !== 'string' || !definition.assignee || definition.assignee.length > 100
    || !['all', 'needs', 'reviewed'].includes(definition.tab as string) || typeof definition.matchesOnly !== 'boolean'
    || !['date', 'vendor', 'account', 'amountCents', 'match'].includes(sort.key as string) || ![1, -1].includes(sort.dir as number)) throw new SearchError('Choose valid search filters.');
  return { name: value.name.trim(), definition: { query: definition.query, type: definition.type as SearchDefinition['type'], status: definition.status as SearchDefinition['status'], assignee: definition.assignee,
    tab: definition.tab as SearchDefinition['tab'], matchesOnly: definition.matchesOnly, sort: { key: sort.key as SearchDefinition['sort']['key'], dir: sort.dir as 1 | -1 } } };
}

export class SavedSearchService {
  readonly monitor: SearchMonitor;
  constructor(readonly db: ActionStore, private companyExists: (id: string) => boolean, source?: SearchSource) { this.monitor = new SearchMonitor(db, source); }
  private present(search: StoredSearch): SavedSearch { return { ...search, enabled: Boolean(search.enabled), tracking: this.monitor.summary(search.id) }; }
  private company(id: string) { if (!this.companyExists(id)) throw new SearchError('Company not found.', 404); }
  list(company: string) {
    this.company(company);
    return this.db.list<StoredSearch>(kind, company).map(search => this.present(search)).sort((a, b) => a.name.localeCompare(b.name));
  }
  get(company: string, id: string) {
    this.company(company);
    const search = this.db.get<StoredSearch>(kind, id);
    if (!search || search.companyId !== company) throw new SearchError('Saved search not found.', 404);
    return this.present(search);
  }
  private existing(company: string, id: string, revision: unknown) {
    this.company(company);
    const search = this.db.get<StoredSearch>(kind, id);
    if (!search || search.companyId !== company) throw new SearchError('Saved search not found.', 404);
    if (!Number.isSafeInteger(revision) || revision !== search.revision) throw new SearchError('This search changed in another session. Reopen it before saving or deleting.', 409);
    return search;
  }
  private unique(company: string, name: string, id?: string) {
    if (this.list(company).some(search => search.id !== id && search.name.toLowerCase() === name.toLowerCase())) throw new SearchError('A search with that name already exists. Choose another name.', 409);
  }
  create(company: string, input: unknown) {
    this.company(company); const value = validate(input);
    return this.db.atomic(() => {
      this.unique(company, value.name);
      const now = new Date().toISOString();
      const search: StoredSearch = { ...value, enabled: false, id: randomUUID(), companyId: company, revision: 1, createdAt: now, updatedAt: now };
      this.db.put(kind, search.id, company, search); this.monitor.reset(search); return this.present(search);
    });
  }
  update(company: string, id: string, input: unknown) {
    const value = validate(input), revision = object(input).revision;
    return this.db.atomic(() => {
      const previous = this.existing(company, id, revision); this.unique(company, value.name, id);
      const search = { ...previous, ...value, revision: previous.revision + 1, updatedAt: new Date().toISOString() };
      this.db.put(kind, id, company, search);
      if (searchCriteria(previous.definition) !== searchCriteria(search.definition)) this.monitor.reset(search);
      return this.present(search);
    });
  }
  remove(company: string, id: string, revision: unknown) {
    this.db.atomic(() => {
      this.existing(company, id, revision);
      this.db.db.prepare('DELETE FROM documents WHERE kind=? AND id=? AND company=?').run(kind, id, company);
      this.db.db.prepare('DELETE FROM documents WHERE kind=? AND id=? AND company=?').run('search-watch', id, company);
    });
  }
  toggle(company: string, id: string, revision: unknown, enabled: unknown) {
    if (typeof enabled !== 'boolean') throw new SearchError('Choose On or Off.');
    this.db.atomic(() => {
      const previous = this.existing(company, id, revision);
      const search = { ...previous, enabled, revision: previous.revision + 1, updatedAt: new Date().toISOString() };
      this.db.put(kind, id, company, search); this.monitor.invalidate(search);
    });
    if (enabled) void this.monitor.check(id);
    return this.get(company, id);
  }
  check(company: string, id: string) { this.get(company, id); void this.monitor.check(id); return this.get(company, id); }
  newMatches(company: string, id: string) { return this.monitor.newMatches(this.get(company, id)); }
  seen(company: string, id: string, matches: unknown) {
    try { this.monitor.seen(this.get(company, id), matches); }
    catch (error) { if (error instanceof SearchError) throw error; throw new SearchError('Choose the matches you viewed.'); }
    return this.get(company, id);
  }
}

export function savedSearchRoutes(app: Express, service: SavedSearchService) {
  const route = (fn: (req: Request, res: Response) => void) => (req: Request, res: Response) => {
    try { fn(req, res); }
    catch (error) { res.status(error instanceof SearchError ? error.status : 500).json({ error: error instanceof SearchError ? error.message : 'Could not save the search. Try again.' }); }
  };
  const base = '/api/companies/:companyId/searches';
  app.get(base, route((req, res) => res.json({ searches: service.list(String(req.params.companyId)) })));
  app.post(base, route((req, res) => {
    const company = String(req.params.companyId), search = service.create(company, req.body);
    res.status(201).json({ search, searches: service.list(company) });
  }));
  app.patch(`${base}/:searchId`, route((req, res) => {
    const company = String(req.params.companyId), search = service.update(company, String(req.params.searchId), req.body);
    res.json({ search, searches: service.list(company) });
  }));
  app.post(`${base}/:searchId/toggle`, route((req, res) => {
    const company = String(req.params.companyId), search = service.toggle(company, String(req.params.searchId), req.body?.revision, req.body?.enabled);
    res.json({ search, searches: service.list(company) });
  }));
  app.post(`${base}/:searchId/check`, route((req, res) => {
    const company = String(req.params.companyId), search = service.check(company, String(req.params.searchId));
    res.status(202).json({ search, searches: service.list(company) });
  }));
  app.get(`${base}/:searchId/new-matches`, route((req, res) => res.json(service.newMatches(String(req.params.companyId), String(req.params.searchId)))));
  app.post(`${base}/:searchId/seen`, route((req, res) => {
    const company = String(req.params.companyId), search = service.seen(company, String(req.params.searchId), req.body?.matches);
    res.json({ search, searches: service.list(company) });
  }));
  app.delete(`${base}/:searchId`, route((req, res) => {
    const company = String(req.params.companyId); service.remove(company, String(req.params.searchId), req.body?.revision);
    res.json({ searches: service.list(company) });
  }));
}
