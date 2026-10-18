import { expect, test } from '@playwright/test';
import { startRuleApp } from './fixtures/ruleApp';

test('mixed transaction types have clear filters and retain their detail screens on mobile', async ({ page }) => {
  const app = await startRuleApp({ synthetic: true });
  try {
    await page.goto(app.url);
    for (const [type, heading] of [['bill', 'Bill'], ['invoice', 'Customer invoice'], ['bank', 'Bank transaction']]) {
      await page.getByLabel('Explore type').selectOption(type);
      const rows = page.getByRole('table', { name: 'Explore results' }).locator('tbody tr');
      await expect(rows).toHaveCount(type === 'bank' ? 2 : 3);
      await rows.first().getByRole('button').click();
      await expect(page.getByLabel('Transaction detail').getByRole('heading', { name: heading, exact: true })).toBeVisible();
      await page.getByLabel('Close detail', { exact: true }).click();
    }
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.getByLabel('Explore type')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  } finally { await app.close(); }
});
