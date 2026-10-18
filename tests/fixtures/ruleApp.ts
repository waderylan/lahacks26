import { createServer } from 'node:http';
import { createServer as createVite } from 'vite';
import { createReviewApp } from '../../server/app.ts';
import { ActionStore } from '../../server/actionStore.ts';
import type { Row } from '../../src/types.ts';

export interface RuleAppOptions {
  /** controlled: eight rows in company-101; real-four-company: all unmodified authored examples. */
  mode?: 'controlled' | 'real-four-company';
  rowCount?: number;
  scores?: 'missing' | 'raw' | 'calibrated';
  /** Compatibility option: mixed transaction types in the controlled fixture. */
  synthetic?: boolean;
}

/** Production routes/SQLite and UI, with controlled external model responses. */
export async function startRuleApp(options: RuleAppOptions = {}) {
  const db = new ActionStore(':memory:');
  const companyId = 'company-101';
  const count = options.rowCount ?? 8;
  const company = { companyId, name: 'Workflow test company', industry: 'Services', profile: '', billCount: count, synthetic: true };
  const rows: Row[] = Array.from({ length: count }, (_, index) => ({
    id: `${companyId}:bill-${index + 1}`, companyId, billId: `bill-${index + 1}`, docNumber: `INV-${index + 1}`,
    date: '2026-10-01', dueDate: '2026-11-01', vendor: `Supplier ${index + 1}`, vendorId: `vendor-${index + 1}`,
    txnType: options.synthetic ? (['bill', 'invoice', 'bank'] as const)[index % 3] : 'bill',
    description: 'Monthly maintenance', itemNames: [], account: 'Maintenance', amountCents: 125000,
    expenseKind: 'operating', costCategory: 'service', memo: index === 0 ? 'Needs receipt' : index === 1 ? 'Duplicate charge' : 'Receipt checked',
    project: null, supplyRole: null, lines: [], payments: [], vendorRecord: null, projectRecord: null,
  }));
  const runtime = createReviewApp({
    database: db, configured: () => true, draftConfigured: () => true,
    ...(options.mode !== 'real-four-company' && {
      companies: () => [company], load: () => ({ company, rows, totalBills: rows.length, sampled: false }),
      accounts: () => [], sample: () => null,
    }),
    evaluate: async (_request, _signal, batch = []) => ({ costNanoUsd: '0', results: batch.map(row => ({
      id: row.id, state: row.evidence?.length || row.memo === 'Receipt checked' ? 'no_match' as const : row.memo === 'Needs receipt' ? 'uncertain' as const : 'match' as const, pMatch: options.scores === 'missing' ? null : 0.5, ...(options.scores && options.scores !== 'missing' && { scoreKind: options.scores === 'calibrated' ? 'validation_calibrated' as const : 'candidate_score_uncalibrated' as const }),
    })) }),
    evaluateProvider: async (_provider, _request, _signal, batch = []) => ({ costKind: 'gpu_time_unavailable' as const, costNanoUsd: '0', results: batch.map(row => ({
      id: row.id, state: row.evidence?.length || row.memo === 'Receipt checked' ? 'no_match' as const : row.memo === 'Needs receipt' ? 'uncertain' as const : 'match' as const, pMatch: options.scores === 'missing' ? null : 0.5, ...(options.scores && options.scores !== 'missing' && { scoreKind: options.scores === 'calibrated' ? 'validation_calibrated' as const : 'candidate_score_uncalibrated' as const }),
    })) }),
    writer: async request => ({ employeeId: request.recipient === 'jev' ? 'emp-controller' : request.recipient,
      subject: 'Please provide the receipt', body: 'Please attach the missing receipt so Accounting can finish reviewing this charge.' }),
    timers: { scanMs: 100, draftMs: 100 },
  });
  const server = createServer(runtime.app);
  const vite = await createVite({ server: { middlewareMode: true, hmr: { port: 0 }, ws: false }, appType: 'spa', logLevel: 'error' });
  runtime.app.use(vite.middlewares);
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Test server did not start.');
  return {
    url: `http://127.0.0.1:${address.port}`,
    close: async () => {
      await runtime.stop();
      const closing = new Promise<void>(resolve => server.close(() => resolve()));
      server.closeAllConnections(); await closing; await vite.close(); db.db.close();
    },
  };
}
