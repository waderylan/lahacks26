import { expect, test } from '@playwright/test';

test.beforeEach(async ({ request }) => {
  await request.patch('/api/settings', { data: { limit: 50, set: 'plain' } });
});

test('search, assigned tasks, visible filters, completion and a second browser share SQLite state', async ({ page, browser }) => {
  const owner = `Review team ${Date.now()}`;
  await page.goto('/');
  await expect(page.locator('tbody tr[data-id]')).toHaveCount(50);
  const ids = await page.locator('tbody tr[data-id]').evaluateAll(rows => rows.slice(0, 2).map(row => row.getAttribute('data-id')!));
  // Only model inference is controlled here. Bills, previews, mutations, tasks,
  // filters, and receipts use the actual Express API and isolated SQLite file.
  await page.route('**/api/evaluate', route => route.fulfill({ json: { costNanoUsd: '0', results: route.request().postDataJSON().ids.map((id: string) => ({ id, state: ids.includes(id) ? 'match' : 'no_match', pMatch: ids.includes(id) ? .95 : .05 })) } }));
  await page.getByLabel('Select transactions by meaning', { exact: true }).fill('Equipment purchases');
  await expect(page.locator('.progress')).toContainText('50/50');
  await page.getByRole('button', { name: 'Select current matches', exact: true }).click();
  await expect(page.getByLabel('Action scope')).toHaveValue('selected');
  await page.getByLabel('Action assignee').fill(owner);
  await page.getByLabel('Task title', { exact: true }).fill('Verify purchase receipt');
  await page.getByRole('button', { name: 'Preview changes', exact: true }).click();
  await expect(page.getByLabel('Action preview')).toContainText('2 bills will change');
  await page.getByRole('button', { name: 'Create 2 tasks', exact: true }).click();
  await expect(page.getByLabel('Action preview')).toContainText('Action receipt');
  await page.getByLabel('Bill assignee filter').selectOption(owner);
  await expect(page.locator('tbody tr[data-id]')).toHaveCount(2);
  await expect(page.locator('tbody .assigned-owner').first()).toHaveText(owner);
  await page.getByLabel('Select all visible', { exact: true }).check();
  await page.getByRole('button', { name: 'Mark reviewed', exact: true }).click();
  await page.getByLabel('Bill status filter').selectOption('reviewed');
  await expect(page.locator('tbody tr[data-id]')).toHaveCount(2);
  await page.getByLabel('Bill status filter').selectOption('needs_review');
  await expect(page.locator('tbody tr[data-id]')).toHaveCount(0);
  await page.getByRole('button', { name: /^Tasks & activity/ }).click();
  await page.getByLabel('Task assignee filter').selectOption(owner);
  await expect(page.locator('.dashboard-task')).toHaveCount(2);
  await page.locator('.dashboard-task select').first().selectOption('done');
  await expect(page.locator('.dashboard-task')).toHaveCount(1);
  await page.getByLabel('Task status filter').selectOption('done');
  await expect(page.locator('.dashboard-task')).toHaveCount(1);
  const second = await browser.newContext();
  try {
    const other = await second.newPage();
    await other.goto(new URL('/', page.url()).toString());
    await other.getByLabel('Bill assignee filter').selectOption(owner);
    await other.getByLabel('Bill status filter').selectOption('reviewed');
    await expect(other.locator('tbody tr[data-id]')).toHaveCount(2);
    await other.getByRole('button', { name: /^Tasks & activity/ }).click();
    await other.getByLabel('Task assignee filter').selectOption(owner);
    await other.getByLabel('Task status filter').selectOption('done');
    await expect(other.locator('.dashboard-task')).toHaveCount(1);
  } finally { await second.close(); }
});

test('category and memo changes update the spreadsheet, survive reload, and undo from history', async ({ page }) => {
  await page.goto('/'); await expect(page.locator('tbody tr[data-id]')).toHaveCount(50);
  const bill = page.locator('tbody tr[data-id]').nth(2), id = await bill.getAttribute('data-id');
  const oldCategory = await bill.locator('td').nth(7).innerText();
  const oldMemo = await bill.locator('td').nth(6).innerText();
  await page.getByLabel('Select row 3', { exact: true }).check();
  await page.getByLabel('Dashboard action').selectOption('category');
  const category = await page.getByLabel('New category').locator('option').evaluateAll((options, old) => options.map(option => ({ value: (option as HTMLOptionElement).value, text: option.textContent })).find(option => option.value && option.text !== old)!, oldCategory);
  await page.getByLabel('New category').selectOption(category.value);
  await page.getByRole('button', { name: 'Preview changes', exact: true }).click();
  await page.getByRole('button', { name: 'Apply 1 changes', exact: true }).click();
  await expect(bill.locator('td').nth(7)).toHaveText(category.text!);
  await page.getByRole('button', { name: /^Tasks & activity/ }).click();
  const categoryRun = page.locator('.dashboard-history details').filter({ has: page.locator('summary', { hasText: 'Change category' }) }).first();
  await categoryRun.locator('summary').click(); await categoryRun.getByRole('button', { name: 'Undo', exact: true }).click();
  await page.getByRole('button', { name: 'Transactions', exact: true }).click();
  await expect(page.locator(`tr[data-id="${id}"] td`).nth(7)).toHaveText(oldCategory);
  await page.getByLabel('Dashboard action').selectOption('memo');
  const memo = `Receipt verified ${Date.now()}`;
  await page.getByLabel('Action text').fill(memo);
  await page.getByRole('button', { name: 'Preview changes', exact: true }).click();
  await page.getByRole('button', { name: 'Apply 1 changes', exact: true }).click();
  await page.reload(); await expect(page.locator('tbody tr[data-id]')).toHaveCount(50);
  await expect(page.locator(`tr[data-id="${id}"] td`).nth(6)).toHaveText(memo);
  await page.getByRole('button', { name: /^Tasks & activity/ }).click();
  const memoRun = page.locator('.dashboard-history details').filter({ has: page.locator('summary', { hasText: 'Update memo' }) }).first();
  await memoRun.locator('summary').click(); await memoRun.getByRole('button', { name: 'Undo', exact: true }).click();
  await page.getByRole('button', { name: 'Transactions', exact: true }).click();
  await expect(page.locator(`tr[data-id="${id}"] td`).nth(6)).toHaveText(oldMemo);
});

test('original split layout retains visible status and owner filters on desktop and mobile', async ({ page }) => {
  await page.goto('/'); await expect(page.locator('tbody tr[data-id]')).toHaveCount(50);
  const positions = await page.evaluate(() => ({ left: document.querySelector('.dashboard-action-panel')!.getBoundingClientRect().right, right: document.querySelector('.ledger-column')!.getBoundingClientRect().left }));
  expect(positions.left).toBeLessThanOrEqual(positions.right + 1);
  await expect(page.getByLabel('Bill status filter')).toBeVisible();
  await expect(page.getByLabel('Bill assignee filter')).toBeVisible();
  await page.screenshot({ path: 'artifacts/verified-sqlite-desktop.png' });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: 'artifacts/verified-sqlite-mobile.png', fullPage: true });
});
