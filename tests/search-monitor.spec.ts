import { expect, test } from '@playwright/test';

const company = 'company-101';
const base = `/api/companies/${company}/searches`;
const definition = { query: 'This transaction is a customer invoice.', type: 'invoice', status: 'needs_review', assignee: 'unassigned', tab: 'all', matchesOnly: true, sort: { key: 'date', dir: 1 } };
test.beforeEach(async ({ request }) => {
  await request.patch('/api/settings', { data: { limit: 50, set: 'plain' } });
  const searches = (await (await request.get(base)).json()).searches;
  for (const search of searches) await request.delete(`${base}/${search.id}`, { data: { revision: search.revision } });
});

test('enabled searches find changes with the page closed, show new rows outside the sample, and mark only viewed matches seen', async ({ page, request }) => {
  const reviewer = `Monitor reviewer ${Date.now()}`;
  const response = await request.post(base, { data: { name: 'Watched invoices', definition: { ...definition, assignee: reviewer } } });
  const saved = (await response.json()).search;
  const current = async () => (await (await request.get(base)).json()).searches.find((search: any) => search.id === saved.id);
  const open = async () => {
    await page.goto('/?workspace=transactions');
    await page.getByLabel('Company', { exact: true }).fill('Parcelmint');
    await expect(page.getByRole('option', { name: /Parcelmint Online Goods/ })).toBeVisible();
    await page.getByLabel('Company', { exact: true }).press('Enter');
    await expect(page.getByLabel('Saved searches', { exact: true })).toContainText('Watched invoices');
    await page.getByRole('button', { name: /^All saved searches/ }).click();
  };
  await open();
  const dialog = page.getByRole('dialog', { name: 'All saved searches', exact: true });
  const card = dialog.getByRole('article', { name: 'Watched invoices', exact: true });
  await expect(card).toContainText('Not checked yet');
  const toggle = card.getByRole('switch', { name: 'Automatic checks for Watched invoices' });
  await toggle.click(); await expect(toggle).toHaveAttribute('aria-checked', 'true');
  await expect.poll(async () => (await current()).tracking.status).toBe('ready');
  await expect(card).toContainText('Last checked');
  expect((await current()).tracking.newMatches).toBe(0);
  const sample = (await (await request.get(`/api/companies/${company}/bills?limit=50&reserve=1`)).json()).rows;
  const full = (await (await request.get(`/api/companies/${company}/bills?limit=0&reserve=1`)).json()).rows;
  const row = full.find((row: any) => row.txnType === 'invoice' && !row.dashboard.reviewed && !sample.some((item: any) => item.id === row.id));
  expect(row).toBeTruthy();
  await page.goto('about:blank'); // No app or polling remains open; the server worker must discover the change.
  const assigned = await request.post(`/api/companies/${company}/rules/commands`, { data: { type: 'metadata', id: row.id, expectedVersion: row.sourceVersion, value: { owner: reviewer, flags: row.dashboard.flags, tags: row.dashboard.tags, automatedCheck: row.dashboard.automatedCheck } } });
  expect(assigned.ok()).toBe(true);
  await expect.poll(async () => (await current()).tracking.newMatches, { timeout: 90000, intervals: [1000] }).toBe(1);
  await open();
  await card.getByRole('button', { name: 'View new (1)', exact: true }).click();
  await expect(dialog.getByRole('table', { name: 'New matching transactions' }).locator('tbody tr')).toHaveCount(1);
  await expect(dialog.locator('.new-search-matches tbody tr')).toHaveAttribute('data-id', row.id);
  await dialog.locator('.new-search-matches .bill-inspect').click();
  await expect(page.getByLabel('Transaction detail')).toContainText(row.docNumber);
  await page.getByLabel('Close detail', { exact: true }).click();
  await page.getByRole('button', { name: /^All saved searches/ }).click();
  await card.getByRole('button', { name: 'View new (1)', exact: true }).click();
  await dialog.getByRole('button', { name: 'Mark 1 as seen', exact: true }).click();
  await expect.poll(async () => (await current()).tracking.newMatches).toBe(0);
  await expect(card.getByRole('button', { name: /^View new/ })).toHaveCount(0);
  await toggle.click(); await expect(toggle).toHaveAttribute('aria-checked', 'false');
  await page.reload();
  await page.getByLabel('Company', { exact: true }).fill('Parcelmint');
  await expect(page.getByRole('option', { name: /Parcelmint Online Goods/ })).toBeVisible();
  await page.getByLabel('Company', { exact: true }).press('Enter');
  await expect(page.getByLabel('Saved searches', { exact: true })).toContainText('Watched invoices');
  await page.getByRole('button', { name: /^All saved searches/ }).click();
  await expect(toggle).toHaveAttribute('aria-checked', 'false');
});

test('all saved searches has clear switches, manual checks, editing, and a keyboard-accessible mobile list', async ({ page, request }) => {
  for (const name of ['Invoices needing review', 'Unassigned bank entries']) await request.post(base, { data: { name, definition: { ...definition, query: '', type: name.startsWith('Invoices') ? 'invoice' : 'bank' } } });
  await page.goto('/?workspace=transactions');
  await page.getByLabel('Company', { exact: true }).fill('Parcelmint');
  await expect(page.getByRole('option', { name: /Parcelmint Online Goods/ })).toBeVisible();
  await page.getByLabel('Company', { exact: true }).press('Enter');
  await expect(page.getByLabel('Saved searches', { exact: true })).toContainText('Unassigned bank entries');
  await page.getByRole('button', { name: /^All saved searches/ }).click();
  const dialog = page.getByRole('dialog', { name: 'All saved searches', exact: true });
  await expect(dialog).toContainText('every 10 seconds'); await expect(dialog).toContainText('first check');
  await expect(dialog.getByRole('article')).toHaveCount(2);
  const card = dialog.getByRole('article', { name: 'Invoices needing review', exact: true });
  await card.getByRole('button', { name: 'Check now', exact: true }).click();
  await expect(card).toContainText('Last checked');
  await expect(card.getByRole('switch')).toHaveAttribute('aria-checked', 'false');
  await expect(card.getByRole('button', { name: /^View new/ })).toHaveCount(0);
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(await dialog.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
  await page.screenshot({ path: 'artifacts/saved-searches-library-mobile.png', fullPage: true });
  await page.keyboard.press('Escape'); await expect(dialog).toHaveCount(0);
  await page.getByRole('button', { name: /^All saved searches/ }).click();
  await card.getByRole('button', { name: 'Edit', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByLabel('Search name', { exact: true })).toHaveValue('Invoices needing review');
});
