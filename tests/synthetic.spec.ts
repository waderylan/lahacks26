import { expect, test } from '@playwright/test';

for (const companyId of ['company-101', 'company-102', 'company-103', 'company-104']) {
  test(`${companyId}: all transaction types, English matching, scoped actions, and mobile review`, async ({ page, request }) => {
    await request.patch('/api/settings', { data: { limit: 50, set: 'plain' } });
    await request.post(`/api/companies/${companyId}/rules/commands`, { data: { type: 'reset', full: true } });
    const companies = await (await request.get('/api/companies')).json();
    const company = companies.find((item: any) => item.companyId === companyId);
    const full = await (await request.get(`/api/companies/${companyId}/bills?limit=0&reserve=1`)).json();
    expect(full.totalBills).toBe(company.billCount);
    expect(full.rows.length + full.reservedRows.length).toBe(full.totalBills);
    const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
    const state = async () => (await (await request.get(`/api/companies/${companyId}/rules`)).json()).store;
    const step = (name: string) => page.getByRole('navigation', { name: 'Rule setup steps' }).getByRole('button', { name, exact: true }).click();
    await page.goto('/?workspace=rules');
    await page.getByLabel('Company', { exact: true }).fill(company.name);
    const loaded = page.waitForResponse(response => response.url().includes(`/api/companies/${companyId}/bills?`) && response.ok());
    await page.getByLabel('Company', { exact: true }).press('Enter'); await loaded;
    await expect(page.locator('.wizard-page-heading p')).toContainText('transaction');
    await page.getByRole('button', { name: 'New rule', exact: true }).click();
    // Inspect all three source types without consuming hundreds of model judgments.
    await page.locator('.wizard-extra-filter').first().locator('summary').click();
    await page.locator('.wizard-extra-filter').first().getByRole('button', { name: 'Amount', exact: true }).click();
    await page.getByRole('button', { name: 'Remove condition 1', exact: true }).click();
    await page.getByLabel('Rows to load').selectOption('0');
    await expect(page.getByLabel('Evaluation progress')).toContainText(`${full.rows.length}/${full.rows.length} evaluated`);
    await expect(page.getByLabel('Condition field')).toHaveValue('amountCents');
    await step('Review matches'); await page.getByLabel('Preview rows').selectOption('all');
    for (const type of ['bill', 'invoice', 'bank']) {
      await page.getByLabel('Transaction type filter').selectOption(type);
      const expected = full.rows.filter((row: any) => row.txnType === type);
      expect(expected.length).toBeGreaterThan(0);
      await expect(page.locator('.wizard-table tbody tr')).toHaveCount(expected.length);
      await page.locator('.wizard-vendor').first().click();
      const detail = page.getByLabel('Transaction detail');
      await expect(detail.getByRole('heading', { name: type === 'invoice' ? 'Customer invoice' : type === 'bank' ? 'Bank transaction' : 'Bill', exact: true })).toBeVisible();
      if (type !== 'bill') await expect(detail.getByRole('heading', { name: 'Details', exact: true })).toBeVisible();
      await expect(detail.getByRole('heading', { name: type === 'invoice' ? 'Customer' : type === 'bank' ? 'Counterparty' : 'Vendor', exact: true })).toBeVisible();
      await page.getByLabel('Close detail', { exact: true }).click();
    }
    await page.getByRole('button', { name: 'Transactions', exact: true }).click();
    for (const type of ['bill', 'invoice', 'bank']) {
      await page.getByLabel('Transaction type filter').selectOption(type);
      await expect(page.locator('tbody tr[data-id]')).toHaveCount(full.rows.filter((row: any) => row.txnType === type).length);
    }
    await page.getByRole('button', { name: 'Rules', exact: true }).click();
    await page.getByRole('button', { name: 'New rule', exact: true }).click();
    await page.getByLabel('Rows to load').selectOption('50');
    await page.getByLabel('Group logic').selectOption('any');
    await page.getByLabel('Condition 1', { exact: true }).fill('This transaction is a customer invoice.');
    await page.getByRole('button', { name: 'Add condition', exact: true }).click();
    await page.getByLabel('Condition 2', { exact: true }).fill('This transaction is a bank transaction.');
    await expect(page.getByLabel('Evaluation progress')).toContainText('50/50 evaluated · Complete', { timeout: 90000 });
    await step('Choose actions'); await page.getByRole('button', { name: 'Add action', exact: true }).click();
    await page.getByLabel('Action type').selectOption('assign');
    await page.getByLabel('Action value').fill('Synthetic review team');
    await step('Review matches');
    const matchCount = Number(await page.locator('.wizard-results .count-true b').innerText());
    expect(matchCount).toBeGreaterThan(0);
    await expect(page.locator('.wizard-table tbody tr')).toHaveCount(matchCount);
    const acted: string[] = [];
    for (const type of ['invoice', 'bank']) {
      await page.getByLabel('Transaction type filter').selectOption(type);
      await expect(page.locator('.wizard-table tbody tr').first()).toBeVisible();
      const id = (await page.locator('.wizard-table tbody tr').first().getAttribute('data-id'))!;
      acted.push(id);
      await page.getByLabel('Search visible bills', { exact: true }).fill(id.split(':')[1]);
      await expect(page.locator('.wizard-table tbody tr')).toHaveCount(1);
      if (type === 'invoice') {
        await page.getByLabel('Rule name', { exact: true }).fill('Review invoice or bank transaction');
        await page.getByRole('button', { name: 'Save rule', exact: true }).click();
      }
      await page.getByRole('button', { name: 'Run once · 1 match', exact: true }).click();
      await expect.poll(async () => (await state()).transactions[id]?.owner).toBe('Synthetic review team');
      await page.getByLabel('Search visible bills', { exact: true }).clear();
    }
    expect(Object.keys((await state()).transactions).sort()).toEqual(acted.sort());
    await page.getByLabel('Transaction type filter').selectOption('all');
    await page.getByLabel('Bill assignee filter').selectOption('owner:Synthetic review team');
    await page.getByLabel('Bill status filter').selectOption('needs_review');
    await expect(page.locator('.wizard-table tbody tr')).toHaveCount(2);
    await page.setViewportSize({ width: 390, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await expect(page.getByLabel('Transaction type filter')).toBeVisible();
    await page.screenshot({ path: `artifacts/${companyId}-verified-review.png`, fullPage: true });
    await page.reload();
    await page.getByLabel('Company', { exact: true }).fill(company.name);
    await page.getByLabel('Company', { exact: true }).press('Enter');
    await expect(page.getByLabel('Saved rules')).toContainText('Review invoice or bank transaction');
    expect(Object.keys((await state()).transactions).sort()).toEqual(acted.sort());
    expect(errors).toEqual([]);
    console.log(`${company.name}: ${full.totalBills} records; bill/invoice/bank filters; ${matchCount} English OR matches; 2 scoped assignments persisted.`);
  });
}

test('changing synthetic sample sizes preserves unsaved conditions, actions, and name', async ({ page, request }) => {
  await request.patch('/api/settings', { data: { limit: 50, set: 'plain' } });
  const companies = await (await request.get('/api/companies')).json();
  const company = companies.find((item: any) => item.companyId === 'company-101');
  await page.goto('/?workspace=rules');
  await page.getByLabel('Company', { exact: true }).fill(company.name);
  const loaded = page.waitForResponse(response => response.url().includes('/api/companies/company-101/bills?') && response.ok());
  await page.getByLabel('Company', { exact: true }).press('Enter'); await loaded;
  await expect(page.locator('.wizard-page-heading p')).toContainText('transaction');
  await page.getByRole('button', { name: 'New rule', exact: true }).click();
  await page.locator('.wizard-extra-filter').first().locator('summary').click();
  await page.locator('.wizard-extra-filter').first().getByRole('button', { name: 'Amount', exact: true }).click();
  await page.getByRole('button', { name: 'Remove condition 1', exact: true }).click();
  await page.getByLabel('Amount in dollars').fill('123.45');
  const step = (name: string) => page.getByRole('navigation', { name: 'Rule setup steps' }).getByRole('button', { name, exact: true }).click();
  await step('Choose actions'); await page.getByRole('button', { name: 'Add action', exact: true }).click();
  await page.getByLabel('Action value').fill('Keep this unsaved action');
  await step('Review matches'); await page.getByLabel('Rule name', { exact: true }).fill('Unsaved sample rule');
  for (const limit of ['100', '-1', '0', '50']) {
    const response = page.waitForResponse(response => response.url().includes(`/api/companies/company-101/bills?limit=${limit}&`) && response.ok());
    await page.getByLabel('Rows to load').selectOption(limit);
    const rows = (await (await response).json()).rows;
    await expect(page.getByLabel('Evaluation progress')).toContainText(`${rows.length}/${rows.length} evaluated · Complete`);
    await step('Review matches'); await expect(page.getByLabel('Rule name', { exact: true })).toHaveValue('Unsaved sample rule');
    await step('Describe conditions'); await expect(page.getByLabel('Amount in dollars')).toHaveValue('123.45');
    await step('Choose actions'); await expect(page.getByLabel('Action value')).toHaveValue('Keep this unsaved action');
  }
});
