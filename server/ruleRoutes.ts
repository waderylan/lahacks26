import type { Express, Request, Response } from 'express';
import type { RuleService } from './ruleService.ts';

export function ruleRoutes(app: Express, service: RuleService) {
  const company = (req: Request) => String(req.params.id);
  const route = (fn: (req: Request, res: Response) => unknown) => async (req: Request, res: Response) => {
    try { await fn(req, res); } catch (error) { res.status(400).json({ error: error instanceof Error ? error.message : 'Could not save workspace changes.' }); }
  };
  app.get('/api/settings', route((_req, res) => res.json(service.db.get('settings', 'workspace') ?? { set: 'plain', limit: 50 })));
  app.patch('/api/settings', route((req, res) => {
    const previous = service.db.get<Record<string, unknown>>('settings', 'workspace') ?? { set: 'plain', limit: 50 };
    const { set, limit } = req.body ?? {};
    if ((set !== undefined && !['plain', 'text', 'overhead', 'review'].includes(set)) || (limit !== undefined && ![-1, 0, 50, 100].includes(limit))) throw new Error('Invalid display preferences.');
    const next = { ...previous, ...(set !== undefined && { set }), ...(limit !== undefined && { limit }) };
    service.db.put('settings', 'workspace', '', next); res.json(next);
  }));
  app.get('/api/companies/:id/rules', route((req, res) => res.json(service.snapshot(company(req)))));
  app.post('/api/companies/:id/rules/import', route((req, res) => {
    if (!req.body?.store || !Array.isArray(req.body.store.rules) || !Array.isArray(req.body.reviewed)) throw new Error('Invalid legacy workspace.');
    const imported = service.importLegacy(company(req), req.body.store, req.body.reviewed);
    res.json({ imported, ...service.snapshot(company(req)) });
  }));
  app.post('/api/companies/:id/rules/commands', route(async (req, res) => {
    const id = company(req), command = req.body ?? {};
    let replayed, selectedRuleId;
    switch (command.type) {
      case 'save': service.save(id, command.rule, command.expectedRevision, command.activate); break;
      case 'add-preset': selectedRuleId = service.addPreset(id, command.presetId, command.sender); break;
      case 'toggle': service.toggle(id, command.id, command.revision, command.enabled); break;
      case 'run': await service.run(id, command.id, command.revision, command.ids); break;
      case 'replay': replayed = await service.replay(id); break;
      case 'undo': service.undo(id, command.id); break;
      case 'metadata': service.updateMetadata(id, command.id, command.value, command.expectedVersion); break;
      case 'add-evidence': service.addEvidence(id, command.id, command.title, command.text, command.expectedVersion); break;
      case 'decide': service.decide(id, command.id, command.status, command.body, command.expectedBody, command.actor); break;
      case 'retry-draft': service.retry(id, command.id); break;
      case 'read-notices': service.notices(id); break;
      case 'dismiss-notice': service.notices(id, command.id); break;
      case 'retry-automation': await service.scan(); break;
      case 'reset': service.reset(id, command.full === true); break;
      default: throw new Error('Unknown workspace command.');
    }
    res.json({ ...service.snapshot(id), replayed, selectedRuleId });
  }));
}
