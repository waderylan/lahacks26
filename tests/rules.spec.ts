import { expect, test } from '@playwright/test';
import { startRuleApp } from './fixtures/ruleApp';

test('Run applies to every evaluated preview record, not only the displayed results, and remains idempotent', async ({ page }) => {
  const app = await startRuleApp();
  try {
    await page.goto(`${app.url}/?workspace=rules`);
    await page.getByRole('button', { name: 'New rule', exact: true }).click();
    await page.getByLabel('Condition 1', { exact: true }).fill('This charge is a duplicate.');
    await expect(page.getByLabel('Evaluation progress')).toContainText('8/8 evaluated · Complete');
    await page.getByRole('navigation', { name: 'Rule setup steps' }).getByRole('button', { name: 'Choose actions', exact: true }).click();
    await page.getByRole('button', { name: 'Add action', exact: true }).click();
    await page.getByLabel('Action value').fill('Possible duplicate');
    const uncertain = page.getByRole('group', { name: 'When there is not enough information', exact: true });
    await uncertain.getByRole('button', { name: 'Add action for uncertain results', exact: true }).click();
    await uncertain.getByLabel('Action value').fill('Needs receipt');
    await page.getByRole('navigation', { name: 'Rule setup steps' }).getByRole('button', { name: 'Review results', exact: true }).click();
    await page.getByLabel('Preview rows').selectOption('true');
    await expect(page.locator('.wizard-table tbody tr')).toHaveCount(1);
    await page.getByLabel('Rule name').fill('Duplicate review');
    await page.getByRole('button', { name: 'Save rule', exact: true }).click();
    await page.getByRole('button', { name: /^Run/ }).click();
    const state = async () => (await (await page.request.get(`${app.url}/api/companies/company-101/rules`)).json()).store;
    await expect.poll(async () => (await state()).history.length).toBe(2);
    expect((await state()).history.length).toBe(2);
    expect(Object.keys((await state()).transactions).sort()).toEqual(['company-101:bill-1', 'company-101:bill-2']);
    expect((await state()).transactions['company-101:bill-1'].flags).toEqual(['Needs receipt']);
    await page.getByRole('button', { name: /^Run/ }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Run complete' })).toBeVisible();
    expect((await state()).history).toHaveLength(2);
  } finally { await app.close(); }
});
