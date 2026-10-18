import { expect, test } from '@playwright/test';
import { startRuleApp } from './fixtures/ruleApp';
import { chooseCompany } from './support';

test('the company rules table toggles, runs, edits and deletes saved rules with persistent results', async ({ page }) => {
  const app = await startRuleApp();
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  try {
    const command = (data: unknown) => page.request.post(`${app.url}/api/companies/company-101/rules/commands`, { data });
    await command({ type: 'add-preset', presetId: 'missing-documentation', sender: 'emp-ap' });
    await command({ type: 'add-preset', presetId: 'payment-fraud', sender: 'emp-ap' });
    let evaluations = 0; page.on('request', request => { if (request.url().endsWith('/api/evaluate')) evaluations++; });
    await page.goto(`${app.url}/?workspace=rules`);
    const table = page.getByRole('table', { name: 'Company rules', exact: true });
    await expect(table.locator('tbody tr')).toHaveCount(2);
    await expect(page.locator('.rules-payment-risk')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Ask your books', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Preview', exact: true }).first()).toBeVisible();
    let row = table.getByRole('row').filter({ hasText: 'Missing documentation' });
    await expect(row.getByRole('switch')).not.toBeChecked();
    await row.getByRole('button', { name: 'Run all records', exact: true }).click();
    await row.getByRole('button', { name: 'Run rule on all records', exact: true }).click();
    await expect(row).toContainText('1 match · 1 uncertain · 6 no match');
    await expect(row).toContainText('8 checked');
    expect(evaluations).toBe(0);
    await row.getByRole('switch').click(); await expect(row.getByRole('switch')).toBeChecked();
    await page.reload(); await expect(row.getByRole('switch')).toBeChecked();
    await row.getByRole('switch').click(); await expect(row.getByRole('switch')).not.toBeChecked();
    await row.getByRole('button', { name: 'Edit', exact: true }).click();
    await expect(page.getByRole('main', { name: 'Rule setup', exact: true })).toBeVisible();
    await page.getByRole('navigation', { name: 'Rule setup steps' }).getByRole('button', { name: 'Preview', exact: true }).click();
    await page.getByLabel('Rule name', { exact: true }).fill('Receipt review');
    await page.getByRole('button', { name: 'Save rule', exact: true }).click();
    await page.getByRole('button', { name: 'All rules', exact: true }).click();
    row = table.getByRole('row').filter({ hasText: 'Receipt review' });
    await expect(row).toContainText('Rule changed. Run again to update results.');
    await row.getByRole('button', { name: 'Run all records', exact: true }).click();
    await row.getByRole('button', { name: 'Run rule on all records', exact: true }).click();
    await expect(row).not.toContainText('Rule changed. Run again to update results.');
    await page.setViewportSize({ width: 390, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: 'artifacts/company-rules-mobile.png', fullPage: true });
    await page.setViewportSize({ width: 1600, height: 1000 });
    await page.screenshot({ path: 'artifacts/company-rules-desktop.png', fullPage: true });
    await row.getByRole('button', { name: 'Delete', exact: true }).click();
    await row.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(row).toBeVisible();
    await row.getByRole('button', { name: 'Delete', exact: true }).click();
    await row.getByRole('button', { name: 'Delete rule', exact: true }).click();
    await expect(table.locator('tbody tr')).toHaveCount(1);
    await page.reload(); await expect(table.locator('tbody tr')).toHaveCount(1);
    await expect(table).toContainText('Possible payment fraud');
    const state = await (await page.request.get(`${app.url}/api/companies/company-101/rules`)).json();
    expect(state.store.history.length).toBeGreaterThan(0);
    expect(state.rows.find((row: any) => row.id === 'company-101:bill-2').dashboard.flags).toContain('Needs documentation');
    expect(errors).toEqual([]);
  } finally { await app.close(); }
});

test('the empty table opens new rules and shows only the selected company’s saved rules', async ({ page }) => {
  const app = await startRuleApp({ mode: 'real-four-company' });
  try {
    await page.goto(`${app.url}/?workspace=rules`);
    await expect(page.getByText('No saved rules.', { exact: false })).toBeVisible();
    await page.getByRole('button', { name: 'New rule', exact: true }).click();
    await expect(page.getByLabel('Condition 1', { exact: true })).toHaveValue('');
    await page.getByRole('button', { name: 'All rules', exact: true }).click();
    await page.getByRole('article', { name: 'Possible duplicate charges starter', exact: true }).getByRole('button', { name: 'Add rule', exact: true }).click();
    await expect(page.getByRole('main', { name: 'Rule setup', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'All rules', exact: true }).click();
    const table = page.getByRole('table', { name: 'Company rules', exact: true });
    await expect(table.locator('tbody tr')).toHaveCount(1);
    await chooseCompany(page, 'Tallowfield Home Renovations');
    await expect(table.locator('tbody tr')).toHaveCount(0);
    await chooseCompany(page, 'Parcelmint Online Goods');
    await expect(table.locator('tbody tr')).toHaveCount(1);
  } finally { await app.close(); }
});
