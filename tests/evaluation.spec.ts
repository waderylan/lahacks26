import { expect, test } from '@playwright/test';
import { startRuleApp } from './fixtures/ruleApp';

test('Evaluation opens from navigation and reloads saved model results', async ({ page }) => {
  const app = await startRuleApp();
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  try {
    await page.goto(app.url);
    await page.getByRole('navigation', { name: 'Workspace', exact: true }).getByRole('button', { name: 'Evaluation', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'How Jev compares' })).toBeVisible();
    await expect(page.locator('table.score').first()).toContainText('Gemini 3.5 Flash-Lite');
    await expect(page.locator('table.score').first()).toContainText('Jev');
    await page.reload();
    await expect(page.locator('table.score').first().locator('tbody tr')).toHaveCount(5);
    expect(errors).toEqual([]);
  } finally { await app.close(); }
});

test('Evaluation handles a missing or invalid API response and retries without losing navigation', async ({ page }) => {
  const app = await startRuleApp();
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  let failure: 'missing' | 'invalid' | null = 'missing';
  try {
    await page.route('**/api/evaluation', route => failure === 'missing'
      ? route.fulfill({ status: 404, json: { error: 'API endpoint not found.' } })
      : failure === 'invalid' ? route.fulfill({ json: { error: 'Invalid summary' } }) : route.continue());
    await page.goto(app.url + '/?workspace=evaluation');
    await expect(page.getByRole('alert')).toContainText('Restart the app server');
    await expect(page.getByRole('navigation', { name: 'Workspace', exact: true })).toBeVisible();
    failure = 'invalid';
    await page.getByRole('button', { name: 'Retry', exact: true }).click();
    await expect(page.getByRole('alert')).toContainText('could not be read');
    failure = null;
    await page.getByRole('button', { name: 'Retry', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'How Jev compares' })).toBeVisible();
    expect(errors).toEqual([]);
  } finally { await app.close(); }
});
