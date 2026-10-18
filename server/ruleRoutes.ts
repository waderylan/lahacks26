import type { Express, Request, Response } from 'express';
import type { RuleService } from './ruleService.ts';

export function ruleRoutes(app: Express, service: RuleService) {
  const company = (req: Request) => String(req.params.id);
  const route = (fn: (req: Request, res: Response) => unknown) => async (req: Request, res: Response) => {
    try { await fn(req, res); } catch (error) { res.status(400).json({ error: error instanceof Error ? error.message : 'Could not save workspace changes.' }); }
  };
  app.get('/api/settings', route((_req, res) => res.json(service.db.get('settings', 'workspace') ?? { limit: -1 })));
  app.patch('/api/settings', route((req, res) => {
    const previous = service.db.get<Record<string, unknown>>('settings', 'workspace') ?? { limit: -1 };
    const { limit } = req.body ?? {};
    if (limit !== undefined && ![-1, 0, 50, 100].includes(limit)) throw new Error('Invalid display preferences.');
    const next = { ...previous, ...(limit !== undefined && { limit }) };
    service.db.put('settings', 'workspace', '', next); res.json(next);
  }));
  app.get('/api/companies/:id/rules', route((req, res) => res.json(service.snapshot(company(req)))));
  app.post('/api/companies/:id/rules/commands', route(async (req, res) => {
    const id = company(req), command = req.body ?? {};
    let selectedRuleId;
    switch (command.type) {
      case 'save': service.save(id, command.rule, command.expectedRevision, command.activate); break;
      case 'add-preset': selectedRuleId = service.addPreset(id, command.presetId, command.sender); break;
      case 'toggle': service.toggle(id, command.id, command.revision, command.enabled); break;
      case 'run': await service.run(id, command.id, command.revision, command.ids); break;
      case 'run-all': await service.runAll(id, command.id, command.revision); break;
      case 'delete': service.delete(id, command.id, command.revision); break;
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
    res.json({ ...service.snapshot(id), selectedRuleId });
  }));
}
