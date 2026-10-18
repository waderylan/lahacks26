import { expect, test } from '@playwright/test';
import { startRuleApp } from './fixtures/ruleApp';
import type { Rule } from '../src/rules';

let app: Awaited<ReturnType<typeof startRuleApp>>;
test.beforeEach(async () => { app = await startRuleApp(); });
test.afterEach(async () => { await app.close(); });
const rule = (id: string): Rule => ({ id, companyId: 'company-018', name: `Review ${id}`, revision: 1, enabled: false,
  expression: { id: `${id}-amount`, type: 'standard', field: 'amountCents', operator: 'gt', value: '500' },
  actions: [{ id: `${id}-flag`, type: 'flag', value: 'Check charge' }] });

test('all saved rules have recurring toggles and Run now opens a preview without applying actions', async ({ page }) => {
  for (const id of ['receipts', 'charges']) expect((await page.request.post(`${app.url}/api/companies/company-018/rules/commands`, { data: { type: 'save', rule: rule(id), expectedRevision: null } })).ok()).toBe(true);
  await page.goto(`${app.url}/?workspace=rules`);
  await expect(page.getByRole('table', { name: 'Company rules', exact: true }).locator('tbody tr')).toHaveCount(2);
  const card = page.getByRole('table', { name: 'Company rules', exact: true }).locator('tr[data-rule-id=receipts]');
  await card.getByLabel('Keep checking: Review receipts').click();
  await expect(card.getByLabel('Keep checking: Review receipts')).toBeChecked();
  const state = async () => (await (await page.request.get(`${app.url}/api/companies/company-018/rules`)).json()).store;
  expect((await state()).history).toEqual([]);
  await card.getByRole('button', { name: 'Run now', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Review the results and actions' })).toBeVisible();
  await expect(page.getByRole('table', { name: 'Rule results and planned actions' }).locator('tbody tr')).toHaveCount(8);
  expect((await state()).history).toEqual([]);
  await page.getByRole('button', { name: /^Run now/ }).click();
  await expect.poll(async () => (await state()).history.length).toBe(8);
  await page.getByRole('button', { name: 'All rules', exact: true }).click();
  await expect(card).toContainText('8 open issues');
  await card.getByLabel('Keep checking: Review receipts').click();
  await expect(card.getByLabel('Keep checking: Review receipts')).not.toBeChecked();
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: 'artifacts/rules-library-mobile.png', fullPage: true });
});

test('trying a saved rule in Explore needs an explicit return and save before changing it', async ({ page }) => {
  await page.request.post(`${app.url}/api/companies/company-018/rules/commands`, { data: { type: 'save', rule: rule('large'), expectedRevision: null } });
  await page.goto(`${app.url}/?workspace=rules`);
  await page.getByRole('button', { name: 'View in Explore', exact: true }).click();
  await page.getByLabel('Amount in dollars').fill('2500');
  const state = async () => (await (await page.request.get(`${app.url}/api/companies/company-018/rules`)).json()).store;
  expect((await state()).rules[0].expression.value).toBe('500');
  await page.getByRole('button', { name: 'Use these conditions in rule', exact: true }).click();
  await expect(page.getByLabel('Amount in dollars')).toHaveValue('2500');
  await page.getByRole('navigation', { name: 'Rule setup steps' }).getByRole('button', { name: 'Review results', exact: true }).click();
  expect((await state()).rules[0].expression.value).toBe('500');
  await page.getByRole('button', { name: 'Save rule', exact: true }).click();
  await expect.poll(async () => (await state()).rules[0].expression.value).toBe('2500');
  expect((await state()).history).toEqual([]);
});

test('legacy plain searches open as views with their original filters', async ({ page }) => {
  await page.request.post(`${app.url}/api/companies/company-018/searches`, { data: { name: 'Existing review', definition: { query: 'This charge lacks a receipt.', type: 'bill', status: 'needs_review', assignee: 'unassigned', tab: 'all', matchesOnly: true, sort: { key: 'date', dir: 1 } } } });
  await page.goto(app.url);
  await page.getByLabel('Saved views').getByRole('button', { name: 'Existing review', exact: true }).click();
  await expect(page.getByLabel('Condition 1', { exact: true })).toHaveValue('This charge lacks a receipt.');
  await expect(page.getByLabel('Explore type')).toHaveValue('bill');
  await expect(page.getByLabel('Explore status')).toHaveValue('needs_review');
  await expect(page.getByLabel('Explore assignee')).toHaveValue('unassigned');
  await expect(page.getByRole('checkbox')).toHaveCount(1); // Only the existing Custom data preference.
  await expect(page.getByRole('button', { name: /All saved searches/ })).toHaveCount(0);
});
