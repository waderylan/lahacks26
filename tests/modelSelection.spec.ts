import { expect, test } from '@playwright/test';
import { startRuleApp } from './fixtures/ruleApp';

test('Qwen selection is scoped to Explore and Rules, not Tasks or Messages', async ({ page }) => {
  const app = await startRuleApp();
  try {
    await page.goto(app.url + '/?model=qwen');
    const nav = page.getByRole('navigation', { name: 'Workspace', exact: true });
    await expect(page.getByLabel('Evaluation model')).toHaveValue('qwen');
    for (const name of ['Tasks & activity', 'Messages']) {
      await nav.getByRole('button', { name, exact: true }).click();
      await expect(page.getByLabel('Evaluation model')).toHaveCount(0);
    }
    await nav.getByRole('button', { name: 'Rules', exact: true }).click();
    await expect(page.getByLabel('Evaluation model')).toHaveValue('qwen');
    await page.getByRole('button', { name: 'New rule', exact: true }).click();
    await expect(page.getByLabel('Rule evaluation provider')).toHaveValue('qwen');
    await expect(page.locator('.toolbar select[aria-label="Evaluation model"]')).toHaveValue('qwen');
    await nav.getByRole('button', { name: 'Explore', exact: true }).click();
    await page.getByLabel('Evaluation model').selectOption('jev');
    await expect(page.getByLabel('Evaluation model')).toHaveValue('jev');
  } finally { await app.close(); }
});
