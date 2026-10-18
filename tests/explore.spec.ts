import { expect, test } from '@playwright/test';
import { startRuleApp } from './fixtures/ruleApp';

let app: Awaited<ReturnType<typeof startRuleApp>>;
test.beforeEach(async () => { app = await startRuleApp(); });
test.afterEach(async () => { await app.close(); });

test('grouped views reopen across browsers without actions and convert into independent rule drafts', async ({ page, browser }) => {
  await page.goto(app.url);
  await page.getByLabel('Search transactions', { exact: true }).fill('This charge needs supporting documents.');
  await page.getByRole('button', { name: 'Combine conditions', exact: true }).click();
  await page.getByRole('button', { name: 'Add group', exact: true }).click();
  await page.getByLabel('Condition 2', { exact: true }).fill('A receipt supports the charge.');
  await page.getByLabel('Group logic').last().selectOption('not');
  await expect(page.getByLabel('Explore check progress')).toContainText('8/8 checked · Complete');
  await page.getByLabel('Explore result', { exact: true }).selectOption('uncertain');
  await page.getByRole('button', { name: 'Save view', exact: true }).click();
  await page.getByLabel('View name').fill('Missing evidence');
  await page.getByRole('button', { name: 'Save new view', exact: true }).click();
  await expect(page.getByLabel('Saved views')).toContainText('Missing evidence');
  const getState = async () => (await (await page.request.get(`${app.url}/api/companies/company-101/rules`)).json()).store;
  expect((await getState()).rules).toEqual([]); expect((await getState()).history).toEqual([]);
  const context = await browser.newContext();
  try {
    const other = await context.newPage(); await other.goto(app.url);
    await other.getByLabel('Saved views').getByRole('button', { name: 'Missing evidence', exact: true }).click();
    await expect(other.getByLabel('Condition 1', { exact: true })).toHaveValue('This charge needs supporting documents.');
    await expect(other.getByLabel('Group logic').last()).toHaveValue('not');
    await expect(other.getByLabel('Explore result', { exact: true })).toHaveValue('uncertain');
    await other.getByRole('button', { name: 'Create rule', exact: true }).click();
    await other.getByRole('navigation', { name: 'Rule setup steps' }).getByRole('button', { name: 'Describe conditions', exact: true }).click();
    await other.getByLabel('Condition 1', { exact: true }).fill('A changed rule condition');
    await other.getByRole('navigation', { name: 'Workspace', exact: true }).getByRole('button', { name: 'Explore', exact: true }).click();
    await expect(other.getByLabel('Condition 1', { exact: true })).toHaveValue('This charge needs supporting documents.');
    expect((await getState()).rules).toEqual([]);
  } finally { await context.close(); }
});

test('views can be renamed, copied, deleted, and filtered without modifying transactions', async ({ page }) => {
  await page.goto(app.url);
  await page.getByLabel('Explore type').selectOption('bank');
  await page.getByRole('button', { name: 'Save view', exact: true }).click();
  await page.getByLabel('View name').fill('Bank entries');
  await page.getByRole('button', { name: 'Save new view', exact: true }).click();
  await expect(page.getByLabel('Saved views')).toContainText('Bank entries');
  await page.getByRole('button', { name: 'Save view', exact: true }).click();
  await page.getByLabel('View name').fill('Bank review');
  await page.getByRole('button', { name: 'Update view', exact: true }).click();
  await expect(page.getByLabel('Saved views')).toContainText('Bank review');
  await page.getByRole('button', { name: 'Save view', exact: true }).click();
  await page.getByLabel('View name').fill('Bank review copy');
  await page.getByRole('button', { name: 'Save as new view', exact: true }).click();
  await expect(page.getByLabel('Saved views')).toContainText('Bank review copy');
  await page.getByRole('button', { name: 'Delete saved view', exact: true }).click();
  await expect(page.getByLabel('Saved views')).not.toContainText('Bank review copy');
  await expect(page.getByRole('button', { name: 'Create rule', exact: true })).toBeDisabled();
  expect((await (await page.request.get(`${app.url}/api/companies/company-101/rules`)).json()).store.history).toEqual([]);
});

test('Jev answers are reused when regrouping, refreshing, and converting to a rule', async ({ page }) => {
  let checks = 0; page.on('request', request => { if (request.url().endsWith('/api/evaluate')) checks++; });
  await page.goto(app.url);
  await page.getByLabel('Search transactions', { exact: true }).fill('Check the receipt.');
  await expect(page.getByLabel('Explore check progress')).toContainText('8/8 checked · Complete');
  const first = checks;
  await page.getByRole('button', { name: 'Combine conditions', exact: true }).click();
  await page.getByLabel('Group logic').selectOption('any');
  await page.getByRole('button', { name: 'Refresh records', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Records refreshed' })).toBeVisible();
  expect(checks).toBe(first);
  await page.getByRole('button', { name: 'Create rule', exact: true }).click();
  await expect(page.getByLabel('Evaluation progress')).toContainText('8/8 evaluated · Complete');
  expect(checks).toBe(first);
});

test('Explore is usable on a phone and has no transaction action controls', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(app.url);
  await expect(page.getByLabel('Explore type')).toBeVisible();
  await expect(page.getByLabel('Explore status')).toBeVisible();
  await expect(page.getByLabel('Explore assignee')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Mark reviewed', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Preview changes', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /All saved searches/ })).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: 'artifacts/explore-mobile.png', fullPage: true });
  expect(errors).toEqual([]);
});
