import { expect, test } from '@playwright/test';
import { startRuleApp } from './fixtures/ruleApp';
import type { Rule } from '../src/rules';

test('tasks, owners, status, and review filters remain shared between browsers', async ({ page, browser }) => {
  const app = await startRuleApp();
  try {
    const base = `${app.url}/api/companies/company-101`;
    const plan = await (await page.request.post(`${base}/actions/preview`, { data: { selection: { ids: ['company-101:bill-1'], scope: 'selected' }, action: { type: 'task', owner: 'Bookkeeper', title: 'Check receipt', dueDate: '2026-11-01' } } })).json();
    expect((await page.request.post(`${base}/actions/${plan.id}/apply`)).ok()).toBe(true);
    const state = await (await page.request.get(`${base}/workspace`)).json();
    expect(state.rows.find((row: any) => row.id === 'company-101:bill-1').dashboard.owner).toBe('');
    const assignment = await (await page.request.post(`${base}/actions/preview`, { data: { selection: { ids: ['company-101:bill-1'], scope: 'selected' }, action: { type: 'assign', owner: 'Bookkeeper' } } })).json();
    expect((await page.request.post(`${base}/actions/${assignment.id}/apply`)).ok()).toBe(true);
    await page.goto(app.url);
    await page.getByLabel('Explore assignee').selectOption('Bookkeeper');
    await expect(page.getByRole('table', { name: 'Explore results' }).locator('tbody tr')).toHaveCount(1);
    await page.getByRole('navigation', { name: 'Workspace', exact: true }).getByRole('button', { name: /^Tasks/ }).click();
    await expect(page.locator('.dashboard-task')).toContainText('Check receipt');
    await page.locator('.dashboard-task select').selectOption('done');
    await page.getByLabel('Task status filter').selectOption('done');
    await expect(page.locator('.dashboard-task')).toHaveCount(1);
    const context = await browser.newContext();
    try {
      const other = await context.newPage(); await other.goto(`${app.url}/?workspace=tasks`);
      await other.getByLabel('Task status filter').selectOption('done');
      await expect(other.locator('.dashboard-task')).toContainText('Bookkeeper');
    } finally { await context.close(); }
  } finally { await app.close(); }
});

test('stale rule edits cannot overwrite a newer saved revision', async ({ page, browser }) => {
  const app = await startRuleApp();
  const rule: Rule = { id: 'shared', companyId: 'company-101', name: 'Shared rule', revision: 1, enabled: false, expression: { id: 'amount', type: 'standard', field: 'amountCents', operator: 'gt', value: '500' }, actions: [{ id: 'flag', type: 'flag', value: 'Check receipt' }] };
  const context = await browser.newContext();
  try {
    const base = `${app.url}/api/companies/company-101`;
    await page.request.post(`${base}/rules/commands`, { data: { type: 'save', rule, expectedRevision: null } });
    const other = await context.newPage();
    for (const target of [page, other]) {
      await target.goto(`${app.url}/?workspace=rules`);
      await target.getByRole('button', { name: 'Edit', exact: true }).click();
      await target.getByRole('navigation', { name: 'Rule setup steps' }).getByRole('button', { name: 'Preview', exact: true }).click();
    }
    await page.getByLabel('Rule name').fill('Saved revision');
    await page.getByRole('button', { name: 'Save rule', exact: true }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Rule saved.' })).toBeVisible();
    await other.getByLabel('Rule name').fill('Stale revision');
    await other.getByRole('button', { name: 'Save rule', exact: true }).click();
    await expect(other.locator('.rules-notice')).toContainText('another session');
    const state = (await (await page.request.get(`${base}/rules`)).json()).store;
    expect(state.rules[0].name).toBe('Saved revision'); expect(state.history).toEqual([]);
  } finally { await context.close(); await app.close(); }
});
