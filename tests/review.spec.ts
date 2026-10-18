import { expect, test } from '@playwright/test';
import { startRuleApp } from './fixtures/ruleApp';
import type { Rule } from '../src/rules';

const COMPANY = 'company-101';

test('manual review is explicit and separate from task completion; activity shows both', async ({ page }) => {
  const app = await startRuleApp();
  try {
    const base = `${app.url}/api/companies/${COMPANY}`;
    const plan = await (await page.request.post(`${base}/actions/preview`, { data: { selection: { ids: [`${COMPANY}:bill-1`], scope: 'selected' }, action: { type: 'task', owner: 'emp-ap', title: 'Check receipt', dueDate: '2026-11-01' } } })).json();
    expect((await page.request.post(`${base}/actions/${plan.id}/apply`)).ok()).toBe(true);
    await page.goto(`${app.url}/?workspace=tasks`);
    const card = page.locator('.dashboard-task');
    await expect(card).toContainText('Task owner: Priya Natarajan');
    await expect(card).toContainText('Transaction owner:');
    await card.locator('select').selectOption('done');
    await expect(page.locator('.activity-list')).toContainText('Task done: Check receipt');
    const reviewed = async () => (await (await page.request.get(`${base}/workspace`)).json()).rows.find((row: any) => row.id === `${COMPANY}:bill-1`).dashboard?.reviewed;
    expect(await reviewed()).toBeFalsy();
    await page.getByLabel('Task status filter').selectOption('done');
    await card.getByRole('button', { name: 'Check receipt' }).click();
    const drawer = page.getByLabel('Transaction detail');
    await expect(drawer).toContainText('Needs review');
    await drawer.getByRole('button', { name: 'Mark reviewed', exact: true }).click();
    await expect.poll(reviewed).toBe(true);
    await expect(drawer.getByLabel('Human review')).toContainText('Mark needs review');
    await expect(drawer.getByText('Marked reviewed')).toBeVisible();
    await page.reload();
    await expect(page.locator('.activity-list')).toContainText('Marked reviewed');
  } finally { await app.close(); }
});

test('My tasks filters to the signed-in employee without hiding other owners by default', async ({ page }) => {
  const app = await startRuleApp();
  try {
    const base = `${app.url}/api/companies/${COMPANY}`;
    for (const [bill, owner] of [['bill-1', 'emp-ap'], ['bill-2', 'emp-controller']]) {
      const plan = await (await page.request.post(`${base}/actions/preview`, { data: { selection: { ids: [`${COMPANY}:${bill}`], scope: 'selected' }, action: { type: 'task', owner, title: `Task ${bill}`, dueDate: '2026-11-01' } } })).json();
      await page.request.post(`${base}/actions/${plan.id}/apply`);
    }
    await page.goto(`${app.url}/?workspace=tasks&as=emp-controller`);
    await expect(page.locator('.dashboard-task')).toHaveCount(2);
    await page.getByRole('button', { name: 'My tasks', exact: true }).click();
    await expect(page.locator('.dashboard-task')).toHaveCount(1);
    await expect(page.locator('.dashboard-task')).toContainText('Marcus Bell');
  } finally { await app.close(); }
});

test('approvals name their sender and say which employee can approve them', async ({ page }) => {
  const app = await startRuleApp();
  const base = `${app.url}/api/companies/${COMPANY}`;
  const rule: Rule = { id: 'receipt-message', companyId: COMPANY, name: 'Ask for receipt', revision: 1, enabled: false,
    expression: { id: 'missing', type: 'ai', text: 'This charge lacks support.', label: '' },
    actions: [{ id: 'message', type: 'message', when: 'uncertain', value: 'Ask for the missing receipt.', recipient: 'jev', sender: 'emp-ap' }] };
  try {
    await page.request.post(`${base}/rules/commands`, { data: { type: 'save', rule, expectedRevision: null } });
    await page.request.post(`${base}/rules/commands`, { data: { type: 'run', id: rule.id, revision: 1, ids: [`${COMPANY}:bill-1`] } });
    await page.goto(`${app.url}/?workspace=messages&as=emp-controller`);
    await page.getByRole('navigation', { name: 'Message folders' }).getByRole('button', { name: /^Approvals/ }).click();
    const waiting = page.getByLabel('Waiting on others');
    await expect(waiting).toContainText('From Priya Natarajan');
    await expect(waiting).toContainText('Awaiting Priya Natarajan');
    await expect(waiting.getByRole('button', { name: 'Approve' })).toHaveCount(0);
    await waiting.getByRole('button', { name: 'View as Priya Natarajan' }).click();
    await expect(page.getByLabel('Waiting on you').getByRole('button', { name: 'Approve', exact: true })).toBeVisible();
  } finally { await app.close(); }
});

test('the evidence-to-recheck route is shown and a manual recheck resolves a cleared issue', async ({ page }) => {
  const app = await startRuleApp();
  const base = `${app.url}/api/companies/${COMPANY}`;
  const rule: Rule = { id: 'receipt', companyId: COMPANY, name: 'Request receipt', revision: 1, enabled: false, autoResolve: true,
    expression: { id: 'missing', type: 'ai', text: 'This charge lacks support.', label: '' },
    actions: [{ id: 'flag', type: 'flag', value: 'Needs receipt', when: 'uncertain' }] };
  try {
    await page.request.post(`${base}/rules/commands`, { data: { type: 'save', rule, expectedRevision: null } });
    await page.request.post(`${base}/rules/commands`, { data: { type: 'run', id: rule.id, revision: 1, ids: [`${COMPANY}:bill-1`] } });
    await page.goto(`${app.url}/?workspace=tasks`);
    await page.locator('.activity-list').getByRole('button', { name: 'bill-1' }).first().click();
    const drawer = page.getByLabel('Transaction detail');
    await expect(drawer.getByLabel('Add supporting details')).toContainText('Keep checking off');
    await drawer.getByLabel('Supporting details title').fill('Receipt');
    await drawer.getByLabel('Supporting details text').fill('The receipt supports the charge.');
    await drawer.getByRole('button', { name: 'Save supporting details', exact: true }).click();
    await drawer.getByRole('button', { name: 'Recheck now: Request receipt' }).click();
    await expect(drawer.getByLabel('Rule follow-up')).toContainText('Resolved');
  } finally { await app.close(); }
});
