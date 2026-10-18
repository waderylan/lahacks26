import fs from 'node:fs';
import path from 'node:path';
import { parse } from 'yaml';

const ROOT = path.resolve(process.env.ACCOUNTING_DATA_ROOT ?? 'data/raw/hackathon-100');
// All bills are loaded per company. Set to a number to cap the spreadsheet to an evenly spaced sample.
export const SAMPLE_SIZE = Infinity;
// The authored scenario fixture is off unless ENABLE_SCENARIO=1.
const SCENARIO_ENABLED = process.env.ENABLE_SCENARIO === '1';

export interface CompanySummary {
  companyId: string;
  name: string;
  industry: string;
  profile: string;
  billCount: number;
  scenario?: boolean;
}

export interface Row {
  id: string; // company-scoped: "<companyId>:<billId>"
  companyId: string;
  billId: string;
  docNumber: string;
  date: string;
  dueDate: string;
  vendor: string;
  vendorId: string;
  description: string;
  itemNames: string[];
  account: string;
  amountCents: number;
  expenseKind: string;
  costCategory: string;
  memo: string;
  project: string | null;
  supplyRole: string | null;
  lines: Record<string, unknown>[];
  payments: { id: string; date: string; amountCents: number; account: string }[];
  vendorRecord: Record<string, unknown> | null;
  projectRecord: Record<string, unknown> | null;
  /** Scenario fixture only: the unmodified original text, for the disclosure view. Never sent to Jev. */
  provenance?: { description: string; memo: string } | null;
}

export interface CompanyBills {
  company: CompanySummary;
  totalBills: number;
  sampled: boolean;
  rows: Row[];
  disclosure?: string;
}

let index: Record<string, any>[] | null = null;
function readIndex() {
  index ??= JSON.parse(fs.readFileSync(path.join(ROOT, 'index.json'), 'utf8'));
  return index!;
}

// --- Synthetic review-scenario fixture (demo-assets/), namespaced away from the original data ---
const SCEN_DIR = path.resolve('demo-assets/semantic-review-demo');
export const SCENARIO_ID = 'scenario-company-030';
let scenarioFile: any = null;
function readScenario() {
  scenarioFile ??= JSON.parse(fs.readFileSync(path.join(SCEN_DIR, 'demo_companies.json'), 'utf8'));
  return scenarioFile as { disclosure: string; companies: any[] };
}

// Review prompts come from queries.json; only the prompt text is read (never expected IDs/labels).
export function listCompanies(): CompanySummary[] {
  const f = SCENARIO_ENABLED ? readScenario().companies[0] : { name: '', industry: '', full_bill_count: 0 };
  const scenario: CompanySummary = {
    companyId: SCENARIO_ID,
    name: f.name,
    industry: f.industry,
    profile: 'scenario',
    billCount: f.full_bill_count,
    scenario: true,
  };
  return [
    ...(SCENARIO_ENABLED ? [scenario] : []),
    ...readIndex().map((r) => ({
      companyId: r.company_id,
      name: r.display_name,
      industry: r.industry_title,
      profile: r.profile,
      billCount: r.entity_counts.bills,
    })),
  ];
}

function worldDir(companyId: string) {
  if (!/^company-\d{3}$/.test(companyId)) throw new Error('bad company id');
  const base = path.join(ROOT, companyId, 'rwm-v4');
  const world = fs.readdirSync(base).find((d) => d.startsWith('world-'));
  if (!world) throw new Error('world dir not found');
  return path.join(base, world);
}

function loadYaml(dir: string, entity: string): any[] {
  const file = path.join(dir, `${entity}.yaml`);
  if (!fs.existsSync(file)) return [];
  return parse(fs.readFileSync(file, 'utf8')) ?? [];
}

/** "1234.56" -> 123456, parsed from the string so no float is involved. */
export function toCents(amount: string | null | undefined): number {
  if (!amount) return 0;
  const m = /^(-?)(\d+)(?:\.(\d{1,2}))?$/.exec(String(amount));
  if (!m) throw new Error(`bad money string: ${amount}`);
  const cents = Number(m[2]) * 100 + Number((m[3] ?? '').padEnd(2, '0') || 0);
  return m[1] ? -cents : cents;
}

// Drop simulation-only metadata (sim_*, provenance_note) from anything shown or sent to Jev.
function strip<T>(obj: T): T {
  if (Array.isArray(obj)) return obj.map(strip) as T;
  if (obj && typeof obj === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj)) {
      if (k.startsWith('sim_') || k === 'provenance_note' || v === undefined) continue;
      out[k] = strip(v);
    }
    return out as T;
  }
  return obj;
}

const cache = new Map<string, CompanyBills>();
const rowById = new Map<string, Row>();

export function getRow(id: string): Row | undefined {
  return rowById.get(id);
}

function loadScenario(): CompanyBills {
  const file = readScenario();
  const f = file.companies[0];
  const company = listCompanies()[0];
  const rows: Row[] = f.transactions.map((t: any) => {
    const sb = t.source_bill;
    const orig = t.original_source_bill;
    const origLine = [...(orig.item_lines ?? []), ...(orig.account_lines ?? [])][0];
    return {
      id: `${SCENARIO_ID}:${t.transaction_id}`,
      companyId: SCENARIO_ID,
      billId: t.transaction_id,
      docNumber: sb.doc_number,
      date: t.date,
      dueDate: sb.due_date,
      vendor: t.vendor,
      vendorId: sb.vendor_id,
      description: t.description,
      itemNames: t.item_names ?? [],
      account: t.accounts.join(', '),
      amountCents: t.amount_cents,
      expenseKind: sb.expense_kind,
      costCategory: sb.cost_category,
      memo: t.memo,
      project: t.project_record?.name ?? null,
      supplyRole: t.vendor_record?.supply_role ?? null,
      lines: strip([...(sb.item_lines ?? []), ...(sb.account_lines ?? [])]),
      payments: (t.payment_records ?? []).map((p: any) => ({
        id: p.id,
        date: p.txn_date,
        amountCents: toCents(p.applications?.[0]?.amount ?? p.amount),
        account: p.payment_account_id,
      })),
      vendorRecord: t.vendor_record ? strip(t.vendor_record) : null,
      projectRecord: t.project_record ? strip({ ...t.project_record, status_history: undefined, change_orders: undefined, reschedules: undefined }) : null,
      provenance: { description: origLine?.description ?? origLine?.item_name ?? '', memo: orig.memo ?? '' },
    };
  });
  const result: CompanyBills = {
    company,
    totalBills: f.full_bill_count,
    sampled: true,
    rows,
    disclosure: 'Synthetic review scenarios — descriptions and memos modified. ' + file.disclosure,
  };
  cache.set(SCENARIO_ID, result);
  for (const r of rows) rowById.set(r.id, r);
  return result;
}

/** The company's bills, optionally thinned to an evenly spaced sample of `limit` rows (0/undefined = all). */
export function loadCompanyBillsLimited(companyId: string, limit?: number): CompanyBills {
  const full = loadCompanyBills(companyId);
  if (!limit || limit >= full.rows.length) return full;
  const rows = Array.from({ length: limit }, (_, i) => full.rows[Math.floor((i * full.rows.length) / limit)]);
  return { ...full, rows, sampled: true };
}

export function loadCompanyBills(companyId: string): CompanyBills {
  const hit = cache.get(companyId);
  if (hit) return hit;
  if (companyId === SCENARIO_ID && SCENARIO_ENABLED) return loadScenario();
  const summary = listCompanies().find((c) => c.companyId === companyId);
  if (!summary) throw new Error('unknown company');
  const dir = worldDir(companyId);
  const bills = loadYaml(dir, 'bills');
  const vendors = new Map(loadYaml(dir, 'vendors').map((v) => [v.id, v]));
  const accounts = new Map(loadYaml(dir, 'accounts').map((a) => [a.id, a]));
  const projects = new Map(loadYaml(dir, 'projects').map((p) => [p.id, p]));
  const items = new Map(loadYaml(dir, 'items').map((i) => [i.id, i]));
  const payByBill = new Map<string, Row['payments']>();
  for (const p of loadYaml(dir, 'bill_payments')) {
    for (const app of p.applications ?? []) {
      const list = payByBill.get(app.document_id) ?? [];
      list.push({
        id: p.id,
        date: p.txn_date,
        amountCents: toCents(app.amount),
        account: accounts.get(p.payment_account_id)?.name ?? p.payment_account_id,
      });
      payByBill.set(app.document_id, list);
    }
  }

  bills.sort((a, b) => (a.txn_date < b.txn_date ? -1 : a.txn_date > b.txn_date ? 1 : a.id < b.id ? -1 : 1));
  const sampled = bills.length > SAMPLE_SIZE;
  const picked = sampled
    ? Array.from({ length: SAMPLE_SIZE }, (_, i) => bills[Math.floor((i * bills.length) / SAMPLE_SIZE)])
    : bills;

  const rows: Row[] = picked.map((b) => {
    const vendor = vendors.get(b.vendor_id);
    const project = b.project_id ? projects.get(b.project_id) : null;
    const itemLines = b.item_lines ?? [];
    const acctLines = b.account_lines ?? [];
    // description = the bill lines' own description text, verbatim; item names are kept separate.
    const lineText = [...itemLines, ...acctLines].map((l: any) => l.description).filter(Boolean);
    const description = [...new Set<string>(lineText)].join(' | ');
    const itemNames: string[] = itemLines.map((l: any) => l.item_name).filter(Boolean);
    let account = '';
    if (itemLines.length) {
      account = accounts.get(items.get(itemLines[0].item_id)?.purchase_account_id)?.name ?? 'Inventory purchases';
    } else if (acctLines.length) {
      account = acctLines[0].account_name ?? accounts.get(acctLines[0].account_id)?.name ?? '';
    }
    return {
      id: `${companyId}:${b.id}`,
      companyId,
      billId: b.id,
      docNumber: b.doc_number,
      date: b.txn_date,
      dueDate: b.due_date,
      vendor: b.vendor_name,
      vendorId: b.vendor_id,
      description,
      itemNames,
      account,
      amountCents: toCents(b.total_amount),
      expenseKind: b.expense_kind,
      costCategory: b.cost_category,
      memo: b.memo ?? '',
      project: project?.name ?? null,
      supplyRole: vendor?.supply_role ?? null,
      lines: strip([...itemLines, ...acctLines]),
      payments: payByBill.get(b.id) ?? [],
      vendorRecord: vendor ? strip(vendor) : null,
      projectRecord: project ? strip({ ...project, status_history: undefined, change_orders: undefined, reschedules: undefined }) : null,
    };
  });

  const result: CompanyBills = { company: summary, totalBills: bills.length, sampled, rows };
  cache.set(companyId, result);
  for (const r of rows) rowById.set(r.id, r);
  return result;
}
