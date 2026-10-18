import { expect, test } from '@playwright/test';
import { startRuleApp } from './fixtures/ruleApp';

test('a new user can search, preview and run a rule with help collapsed', async ({ page }) => {
  const app = await startRuleApp();
  try {
    await page.goto(app.url);
    await page.getByLabel('Search transactions', { exact: true }).fill('Charges needing documentation');
    await expect(page.getByLabel('Explore check progress')).toContainText('1 match · 1 uncertain');
    await page.screenshot({ path: 'artifacts/concise-explore-desktop.png', fullPage: true });
    await page.getByRole('button', { name: 'Create rule', exact: true }).click();
    const steps = page.getByRole('navigation', { name: 'Rule setup steps' });
    await steps.getByRole('button', { name: 'Actions', exact: true }).click();
    for (const [branch, flag] of [['Match', 'Check documentation'], ['Uncertain', 'Request receipt']]) {
      const section = page.getByRole('group', { name: branch, exact: true });
      await section.getByRole('button', { name: /^Add action/ }).click();
      await section.getByLabel('Action value').fill(flag);
    }
    await steps.getByRole('button', { name: 'Preview', exact: true }).click();
    await expect(page.getByLabel('Evaluation progress')).toContainText('8/8 checked · Complete');
    await page.getByLabel('Preview rows').selectOption('true');
    await expect(page.locator('.wizard-table tbody tr')).toHaveCount(1);
    await expect(page.locator('.wizard-table tbody tr')).toContainText('Check documentation');
    const run = page.getByRole('button', { name: 'Run on 2 transactions', exact: true });
    await expect(run).toBeDisabled();
    await page.getByLabel('Rule name').fill('Documentation review');
    await page.getByRole('button', { name: 'Save rule', exact: true }).click();
    await expect(run).toBeEnabled();
    await expect(run).toBeInViewport();
    expect(await page.locator('.wizard-help[open], .condition-help[open], .rules-help[open]').count()).toBe(0);
    await expect(page.locator('.wizard-summary')).not.toContainText('Actions by result');
    await page.screenshot({ path: 'artifacts/concise-preview-desktop.png', fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: 'artifacts/concise-preview-mobile.png', fullPage: true });
    await run.click();
    const state = async () => (await (await page.request.get(app.url + '/api/companies/company-101/rules')).json()).store;
    await expect.poll(async () => (await state()).history.length).toBe(2);
    expect((await state()).transactions['company-101:bill-1'].flags).toEqual(['Request receipt']);
    expect((await state()).transactions['company-101:bill-2'].flags).toEqual(['Check documentation']);
  } finally { await app.close(); }
});
