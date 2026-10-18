import { expect, test } from '@playwright/test';
import { startRuleApp } from './fixtures/ruleApp';

test('mixed transaction types have clear filters and retain their detail screens on mobile', async ({ page }) => {
  const app = await startRuleApp({ synthetic: true });
  try {
    await page.goto(app.url);
    await expect(page.getByLabel('Transactions by type')).toContainText('Vendor bills 3');
    await expect(page.getByLabel('Transactions by type')).toContainText('Bank transactions 2');
    for (const [type, heading] of [['bill', 'Vendor bill'], ['invoice', 'Customer invoice'], ['bank', 'Bank transaction']]) {
      await page.getByLabel('Explore type').selectOption(type);
      const rows = page.getByRole('table', { name: 'Explore results' }).locator('tbody tr');
      await expect(rows).toHaveCount(type === 'bank' ? 2 : 3);
      await rows.first().getByRole('button').click();
      await expect(page.getByLabel('Transaction detail')).toContainText(heading);
      await page.getByLabel('Close detail', { exact: true }).click();
    }
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.getByLabel('Explore type')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  } finally { await app.close(); }
});
