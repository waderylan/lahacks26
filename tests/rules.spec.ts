import { expect, test } from '@playwright/test';
import { startRuleApp } from './fixtures/ruleApp';

test('Run now applies actions only to the selected preview results and remains idempotent', async ({ page }) => {
  const app = await startRuleApp();
  try {
    await page.goto(`${app.url}/?workspace=rules`);
    await page.getByRole('button', { name: 'New rule', exact: true }).click();
    await page.getByLabel('Condition 1', { exact: true }).fill('This charge is a duplicate.');
    await expect(page.getByLabel('Evaluation progress')).toContainText('8/8 evaluated · Complete');
    await page.getByRole('navigation', { name: 'Rule setup steps' }).getByRole('button', { name: 'Choose actions', exact: true }).click();
    await page.getByRole('button', { name: 'Add action', exact: true }).click();
    await page.getByLabel('Action value').fill('Possible duplicate');
    await page.getByRole('navigation', { name: 'Rule setup steps' }).getByRole('button', { name: 'Review results', exact: true }).click();
    await page.getByLabel('Preview rows').selectOption('true');
    await expect(page.locator('.wizard-table tbody tr')).toHaveCount(1);
    await page.getByLabel('Rule name').fill('Duplicate review');
    await page.getByRole('button', { name: 'Save rule', exact: true }).click();
    await page.getByRole('button', { name: /^Run now/ }).click();
    const state = async () => (await (await page.request.get(`${app.url}/api/companies/company-018/rules`)).json()).store;
    await expect.poll(async () => (await state()).history.length).toBe(1);
    expect(Object.keys((await state()).transactions)).toEqual(['company-018:bill-2']);
    await page.getByRole('button', { name: /^Run now/ }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Run complete' })).toBeVisible();
    expect((await state()).history).toHaveLength(1);
  } finally { await app.close(); }
});
