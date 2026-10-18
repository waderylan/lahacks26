import { expect, test } from '@playwright/test';
import { startRuleApp } from './fixtures/ruleApp';

test('Rules retains payment and duplicate checks alongside the Explore workflow', async ({ page }) => {
  const app = await startRuleApp();
  const runs: string[] = [];
  try {
    await page.route('**/checks/*/run', route => {
      const kind = route.request().url().split('/').at(-2)!;
      runs.push(kind);
      const id = 'company-018:bill-2';
      return route.fulfill({ json: { results: { [id]: {
        id, verdict: 'flag', probability: .93, pFlag: .93, signals: [], checkedAt: '2026-10-17T12:00:00Z',
        summary: { billId: 'bill-2', docNumber: 'INV-2', vendor: 'Supplier 2', date: '2026-10-01', amountCents: 125000 },
        ...(kind === 'duplicates' && { original: { billId: 'bill-1', docNumber: 'INV-1', date: '2026-09-30', amountCents: 125000 } }),
      } }, escalated: {} } });
    });
    await page.goto(`${app.url}/?workspace=rules`);
    await page.locator('.rules-payment-risk > summary').click();
    const payment = page.getByRole('region', { name: 'Payment risk', exact: true });
    await payment.getByRole('button', { name: 'Check loaded transactions (8)', exact: true }).click();
    await expect(payment).toContainText('93% suspicious');
    await page.getByRole('navigation', { name: 'Fraud checks', exact: true }).getByRole('button', { name: 'Duplicates', exact: true }).click();
    const duplicates = page.getByRole('region', { name: 'Duplicates', exact: true });
    await duplicates.getByRole('button', { name: 'Check loaded transactions (8)', exact: true }).click();
    await expect(duplicates).toContainText('93% duplicate');
    await expect(duplicates).toContainText('Repeats INV-1');
    expect(runs).toEqual(['payment-risk', 'duplicates']);
    await page.getByRole('navigation', { name: 'Workspace', exact: true }).getByRole('button', { name: 'Explore', exact: true }).click();
    await expect(page.getByLabel('Search transactions', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Combine conditions', exact: true })).toBeVisible();
  } finally { await app.close(); }
});
