import { ModelFeedbackService, feedbackRoutes, type Observation } from '../../server/modelFeedback';
import { decisionMessages } from '../../server/modelContract';
import { visibleInput } from '../../server/evaluator';
import { qwenDeploymentId } from '../../server/qwen';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadCompanyBills, listCompanies, demoSample } from '../../server/data';
import { ChatStore, chatRoutes } from '../../server/chat';
import { paymentRiskCheck } from '../../server/paymentRisk';
import { duplicatesCheck } from '../../server/duplicates';
import { ReviewCheck, reviewCheckRoutes } from '../../server/reviewChecks';
import express from 'express';
import { createServer } from 'node:http';
import { createServer as createVite } from 'vite';
import { ActionStore } from '../../server/actionStore';
import { WorkspaceData } from '../../server/workspaceData';
import { ActionEngine } from '../../server/actionEngine';
import { actionRoutes } from '../../server/actionRoutes';
import { RuleService } from '../../server/ruleService';
import { ruleRoutes } from '../../server/ruleRoutes';
import { Mailbox, mailRoutes } from '../../server/mailbox';
import { SavedSearchService, savedSearchRoutes } from '../../server/savedSearches';
import type { Row } from '../../src/types';

/** Real UI, routes, and SQLite; external model responses are deterministic in these workflow tests. */
export async function startRuleApp(options: { synthetic?: boolean; rowCount?: number; feedback?: boolean } = {}) {
  const db = new ActionStore(':memory:');
  const companyId = 'company-018';
  const count = options.rowCount ?? 8;
  const company = { companyId, name: 'Workflow test company', industry: 'Services', profile: '', billCount: count, synthetic: options.synthetic ?? false };
  const rows: Row[] = Array.from({ length: count }, (_, index) => ({
    id: `${companyId}:bill-${index + 1}`, companyId, billId: `bill-${index + 1}`, docNumber: `INV-${index + 1}`,
    date: '2026-10-01', dueDate: '2026-11-01', vendor: `Supplier ${index + 1}`, vendorId: `vendor-${index + 1}`,
    ...(options.synthetic && { txnType: (['bill', 'invoice', 'bank'] as const)[index % 3] }),
    description: 'Monthly maintenance', itemNames: [], account: 'Maintenance', amountCents: 125000,
    expenseKind: 'operating', costCategory: 'service', memo: index === 0 ? 'Needs receipt' : index === 1 ? 'Duplicate charge' : 'Receipt checked',
    project: null, supplyRole: null, lines: [], payments: [], vendorRecord: null, projectRecord: null,
  }));
  const companies = [company, ...(options.synthetic ? listCompanies().filter(company => company.synthetic) : [])];
  const data = new WorkspaceData(db, id => id === companyId ? { company, rows, totalBills: rows.length, sampled: false } : loadCompanyBills(id), () => []);
  const outcome = (row: Row) => row.evidence?.length || row.memo === 'Receipt checked' ? 'no_match' as const : row.memo === 'Needs receipt' ? 'uncertain' as const : 'match' as const;
  const judge = async (_company: string, _criterion: string, rows: Row[]) => Object.fromEntries(rows.map(row => [row.id, outcome(row)]));
  const rules = new RuleService(db, data, judge, async request => ({ employeeId: request.recipient === 'jev' ? 'emp-controller' : request.recipient, subject: 'Please provide the receipt', body: 'Please attach the missing receipt so Accounting can finish reviewing this charge.' }));
  const searches = new SavedSearchService(db, id => companies.some(company => company.companyId === id), { rows: id => data.bills(id).rows, judge });
  const app = express(); app.use(express.json());
  app.get('/api/status', (_req, res) => res.json({ jev: { configured: true, model: 'test-double', via: 'Workflow test' }, gemini: { configured: true } }));
  app.get('/api/companies', (_req, res) => res.json(companies));
  app.get('/api/companies/:id/bills', (req, res) => {
    const full = data.bills(String(req.params.id));
    const curated = Number(req.query.limit) === -1 ? demoSample(full.company.companyId) : null;
    const limit = Number(req.query.limit);
    const visible = curated ? full.rows.filter(row => curated.ids.has(row.billId)) : limit > 0 ? full.rows.slice(0, limit) : full.rows;
    res.json({ ...full, rows: visible, sampled: visible.length < full.rows.length, curatedSample: Boolean(curated) });
  });
  const feedbackFolder=options.feedback?fs.mkdtempSync(path.join(os.tmpdir(),'feedback-workflow-')):null;
  if(feedbackFolder)feedbackRoutes(app,new ModelFeedbackService(db,data,undefined,feedbackFolder));
  app.post('/api/evaluate',(req,res)=>{
    const results=req.body.ids.map((id:string)=>{
      const row=data.row(req.body.companyId,id),state=outcome(row);
      if(options.feedback&&req.body.model==='qwen') {
        const input=visibleInput({name:company.name,industry:company.industry},req.body.criterion,row);
        const key=createHash('sha256').update(JSON.stringify([input,state])).digest('hex');
        const observation:Observation={id:key,companyId,rowId:id,vendor:row.vendor,criterion:req.body.criterion,deploymentId:qwenDeploymentId()!,input,messages:decisionMessages(input),result:state,createdAt:new Date().toISOString()};
        db.put('model-observation',key,companyId,observation);
      }
      return{id,state,pMatch:.5};
    });res.json({results,costNanoUsd:'0'});
  });
  actionRoutes(app, new ActionEngine(db, data, judge));
  ruleRoutes(app, rules); mailRoutes(app, new Mailbox(db, data));
  savedSearchRoutes(app, searches);
  chatRoutes(app, new ChatStore(db, data));
  reviewCheckRoutes(app, { 'payment-risk': new ReviewCheck(db, data, paymentRiskCheck), duplicates: new ReviewCheck(db, data, duplicatesCheck) });
  const server = createServer(app);
  const vite = await createVite({ server: { middlewareMode: true, hmr: false }, appType: 'spa', logLevel: 'error' });
  app.use(vite.middlewares);
  const timer = setInterval(() => { void rules.scan(); }, 100);
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Test server did not start.');
  return {
    url: `http://127.0.0.1:${address.port}`,
    close: async () => { clearInterval(timer); const closing = new Promise<void>(resolve => server.close(() => resolve())); server.closeAllConnections(); await closing; await vite.close(); db.db.close(); if(feedbackFolder)fs.rmSync(feedbackFolder,{recursive:true,force:true}); },
  };
}
