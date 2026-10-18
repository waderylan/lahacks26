import { expect, test, type Page } from '@playwright/test';
import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import { completeDraft, EMPTY_STORE, executeRule, type Rule, type RuleStore } from '../src/rules';
import type { Row } from '../src/types';

const companyId = 'company-090';
const databasePath = process.env.RULES_TEST_DB;
const settled = async (page: Page) => expect(page.locator('.app')).toHaveAttribute('aria-busy', 'false');
test('migrated messages, approvals, notifications, rules and preferences are shared across browsers in SQLite', async ({ page, browser, request }) => {
  test.skip(!databasePath, 'Set RULES_TEST_DB to the isolated server database under artifacts/.');
  const filename = path.resolve(databasePath!);
  if (!filename.startsWith(path.resolve('artifacts') + path.sep)) throw new Error('Browser fixtures may only change an isolated database under artifacts/.');
  const fixture = new DatabaseSync(filename);
  // Fixture cleanup is limited to this test company in the explicitly selected scratch database.
  fixture.prepare('DELETE FROM documents WHERE company=?').run(companyId);
  fixture.prepare("UPDATE bills SET body=json_set(original,'$.dashboard',json(?)),revision=0 WHERE company=?").run(JSON.stringify({ owner: '', flags: [], tags: [], reviewed: false, automatedCheck: false, taskIds: [] }), companyId);
  fixture.close();
  await request.patch('/api/settings', { data: { limit: 50, set: 'plain' } });
  const companies = await (await request.get('/api/companies')).json();
  const name = companies.find((company: any) => company.companyId === companyId).name;
  const bills: Row[] = (await (await request.get(`/api/companies/${companyId}/bills?limit=50&reserve=1`)).json()).rows.slice(0, 2);
  const rule: Rule = { id: `migration-${Date.now()}`, companyId, name: 'Review bill coding', revision: 1, enabled: false,
    expression: { id: 'amount', type: 'standard', field: 'amountCents', operator: 'gt', value: '-9999999' },
    actions: [{ id: 'assign', type: 'assign', value: 'Shared review team' }, { id: 'message', type: 'message', value: 'Confirm the coding of these bills.', recipient: 'emp-ap' }] };
  let legacy: RuleStore = { ...structuredClone(EMPTY_STORE), rules: [rule] };
  for (const bill of bills) legacy = executeRule(legacy, rule, bill, 'legacy-v1', { result: 'true', conditions: { amount: 'true' } }, 'run', 'migration-batch');
  const messageId = legacy.messages[0].id;
  legacy = completeDraft(legacy, messageId, { employeeId: 'emp-ap', subject: 'Confirm coding for two bills', body: 'Hi Priya, please confirm the coding of these two bills.' });
  await page.addInitScript(({ legacy, reviewed }) => { localStorage.setItem('tr.rules.v1', JSON.stringify(legacy)); localStorage.setItem('tr.reviewed.v1', JSON.stringify(reviewed)); }, { legacy, reviewed: [bills[0].id] });
  const pick = async (target: Page) => {
    await target.getByLabel('Company', { exact: true }).fill(name);
    await expect(target.getByRole('option', { name: new RegExp(name) })).toBeVisible();
    await target.getByLabel('Company', { exact: true }).press('Enter');
    await expect(target.locator('.active-company strong')).toHaveText(name);
  };
  await page.goto('/'); await pick(page);
  await page.getByRole('navigation', { name: 'Workspace' }).getByRole('button', { name: /^Messages/ }).click();
  await page.getByRole('navigation', { name: 'Message folders' }).getByRole('button', { name: /^Approvals/ }).click();
  const card = page.locator('.dashboard-board .message-card');
  await expect(card).toContainText('Confirm coding for two bills');
  await card.getByRole('button', { name: 'Edit', exact: true }).click();
  await card.getByLabel('Edit draft message').fill('Hi Priya, please verify both receipt categories before close.');
  await card.getByRole('button', { name: 'Approve', exact: true }).click();
  await expect(card).toContainText('Sent to inbox · not emailed'); await settled(page);
  await page.getByRole('button', { name: 'Transactions', exact: true }).click();
  await page.getByLabel('Bill assignee filter').selectOption('Shared review team');
  await expect(page.locator('tbody tr[data-id]')).toHaveCount(2);
  await page.getByLabel('Bill status filter').selectOption('reviewed'); await expect(page.locator('tbody tr[data-id]')).toHaveCount(1);
  await page.getByLabel('Rows to load').selectOption('100'); await expect(page.getByLabel('Rows to load')).toHaveValue('100');
  // Remove the old browser copy. Shared state must remain available without it.
  await page.evaluate(() => localStorage.clear());
  const second = await browser.newContext();
  try {
    const other = await second.newPage(); await other.goto(new URL('/', page.url()).toString()); await pick(other);
    await expect(other.getByLabel('Rows to load')).toHaveValue('100');
    await other.getByRole('navigation', { name: 'Workspace' }).getByRole('button', { name: /^Messages/ }).click();
    await other.getByRole('navigation', { name: 'Message folders' }).getByRole('button', { name: /^Approvals/ }).click();
    await expect(other.locator('.dashboard-board .message-card')).toContainText('Sent to inbox · not emailed');
    await other.locator('.dashboard-board .message-card').getByRole('button', { name: 'View draft', exact: true }).click();
    await expect(other.locator('.dashboard-board .message-card')).toContainText('please verify both receipt categories');
    await other.getByRole('button', { name: /^Notifications/ }).click(); await settled(other);
    await expect(page.getByRole('button', { name: 'Notifications', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Rules', exact: false }).first().click();
    await other.getByRole('button', { name: /^Notifications/ }).click();
    await other.getByRole('button', { name: 'Rules', exact: false }).first().click();
    await expect(other.getByLabel('Rule name', { exact: true })).toHaveValue(rule.name);
    await page.getByLabel('Rule name', { exact: true }).fill('Saved by the first browser');
    await page.getByRole('button', { name: 'Save rule', exact: true }).click(); await settled(page);
    await expect.poll(async () => (await (await request.get(`/api/companies/${companyId}/rules`)).json()).store.rules[0].revision).toBe(2);
    await other.getByLabel('Rule name', { exact: true }).fill('Stale edit from the second browser');
    await other.getByRole('button', { name: 'Save rule', exact: true }).click();
    await expect(other.locator('.rules-notice')).toContainText('another session');
    const state = (await (await request.get(`/api/companies/${companyId}/rules`)).json()).store;
    expect(state.rules[0].name).toBe('Saved by the first browser'); expect(state.messages[0].status).toBe('approved');
    expect(state.messages[0].edited).toBe(true); expect(state.notices.every((notice: any) => notice.read)).toBe(true);
    await other.getByRole('button', { name: 'Reload saved rule', exact: true }).click();
    await expect(other.getByLabel('Rule name', { exact: true })).toHaveValue('Saved by the first browser');
    expect(await other.evaluate(() => localStorage.length)).toBe(0);
    await other.screenshot({ path: 'artifacts/verified-shared-sqlite-workspace.png' });
  } finally { await second.close(); }
});
