import { expect, test, type Page } from '@playwright/test';

const company = 'company-101', name = 'Parcelmint Online Goods';
const query = 'This transaction is a customer invoice.';
const definition = { query: '', type: 'invoice', status: 'needs_review', assignee: 'unassigned', tab: 'all', matchesOnly: false, sort: { key: 'date', dir: 1 } };
const searches = async (page: Page, id = company) => (await (await page.request.get(`/api/companies/${id}/searches`)).json()).searches;
const pick = async (page: Page, companyName = name) => {
  await page.getByLabel('Company', { exact: true }).fill(companyName);
  await expect(page.getByRole('option', { name: new RegExp(companyName) })).toBeVisible();
  await page.getByLabel('Company', { exact: true }).press('Enter');
  await expect(page.getByLabel('Company', { exact: true })).toHaveValue(companyName);
  await expect(page.locator('.pill.sample')).toContainText('transactions');
};
const openPage = async (page: Page) => { await page.goto('/?workspace=transactions'); await pick(page); await expect(page.getByLabel('Saved searches', { exact: true })).toBeEnabled(); };
test.beforeEach(async ({ request }) => {
  await request.patch('/api/settings', { data: { limit: 50, set: 'plain' } });
  for (const id of [company, 'company-102']) {
    const previous = (await (await request.get(`/api/companies/${id}/searches`)).json()).searches;
    for (const search of previous) await request.delete(`/api/companies/${id}/searches/${search.id}`, { data: { revision: search.revision } });
  }
});

test('named English searches reopen their filters across browsers, can be edited, renamed, copied, and deleted', async ({ page, browser }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await openPage(page);
  await page.getByLabel('Select transactions by meaning').fill(query);
  await expect(page.locator('.semantic .progress')).toContainText('50/50', { timeout: 90000 });
  await page.getByLabel('Transaction type filter').selectOption('invoice');
  await page.getByLabel('Bill status filter').selectOption('needs_review');
  await page.getByLabel('Bill assignee filter').selectOption('unassigned');
  await page.getByRole('tab', { name: /^Needs review/ }).click();
  await page.getByLabel('Show matches only').check();
  await page.getByRole('columnheader', { name: /^Amount/ }).click();
  const before = await (await page.request.get(`/api/companies/${company}/rules`)).json();
  await page.locator('.saved-search-row').getByRole('button', { name: 'Save search', exact: true }).click();
  const editor = page.getByRole('form', { name: 'Save search' });
  await page.getByLabel('Search name', { exact: true }).fill('Invoice review');
  await editor.getByRole('button', { name: 'Save search', exact: true }).click();
  await expect(page.getByLabel('Saved searches', { exact: true })).toContainText('Invoice review');
  const saved = (await searches(page))[0];
  expect(saved.definition).toMatchObject({ query, type: 'invoice', status: 'needs_review', assignee: 'unassigned', tab: 'needs', matchesOnly: true, sort: { key: 'amountCents', dir: 1 } });
  expect((await (await page.request.get(`/api/companies/${company}/rules`)).json()).store.history).toEqual(before.store.history);
  await page.getByLabel('Select transactions by meaning').clear();
  await page.getByLabel('Transaction type filter').selectOption('bank');
  await page.getByLabel('Bill status filter').selectOption('all');
  await page.getByLabel('Bill assignee filter').selectOption('all');
  await page.getByLabel('Show matches only').uncheck();
  await page.getByRole('tab', { name: /^All / }).click();
  await page.getByLabel('Saved searches', { exact: true }).selectOption('');
  await page.getByLabel('Saved searches', { exact: true }).selectOption(saved.id);
  await expect(page.getByLabel('Select transactions by meaning')).toHaveValue(query);
  await expect(page.getByLabel('Transaction type filter')).toHaveValue('invoice');
  await expect(page.getByLabel('Bill status filter')).toHaveValue('needs_review');
  await expect(page.getByLabel('Bill assignee filter')).toHaveValue('unassigned');
  await expect(page.getByLabel('Show matches only')).toBeChecked();
  await expect(page.getByRole('tab', { name: /^Needs review/ })).toHaveAttribute('aria-selected', 'true');
  const second = await browser.newContext();
  try {
    const other = await second.newPage(); await openPage(other);
    await other.getByLabel('Saved searches', { exact: true }).selectOption(saved.id);
    await expect(other.getByLabel('Select transactions by meaning')).toHaveValue(query);
    await expect(other.getByLabel('Transaction type filter')).toHaveValue('invoice');
    await other.close();
  } finally { await second.close(); }
  await page.getByLabel('Select transactions by meaning').clear();
  await page.getByLabel('Transaction type filter').selectOption('bank');
  await page.getByLabel('Show matches only').uncheck();
  await page.locator('.saved-search-row').getByRole('button', { name: 'Save changes', exact: true }).click();
  await page.getByLabel('Search name', { exact: true }).fill('Bank review');
  await editor.getByRole('button', { name: 'Save changes', exact: true }).click();
  await expect(page.getByLabel('Saved searches', { exact: true })).toContainText('Bank review');
  expect((await searches(page))[0]).toMatchObject({ id: saved.id, name: 'Bank review', revision: 2, definition: { query: '', type: 'bank' } });
  await page.locator('.saved-search-row').getByRole('button', { name: 'Edit search', exact: true }).click();
  await page.getByLabel('Search name', { exact: true }).fill('Bank review copy');
  await editor.getByRole('button', { name: 'Save as new', exact: true }).click();
  await expect.poll(async () => (await searches(page)).length).toBe(2);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator('.saved-search-row').getByRole('button', { name: 'Edit search', exact: true }).click();
  await expect(page.getByLabel('Search name', { exact: true })).toHaveValue('Bank review copy');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: 'artifacts/saved-searches-mobile.png', fullPage: true });
  await editor.getByRole('button', { name: 'Delete search', exact: true }).click();
  await expect.poll(async () => (await searches(page)).length).toBe(1);
  await expect(page.getByLabel('Select transactions by meaning')).toHaveValue('');
  await page.reload(); await pick(page);
  await expect(page.getByLabel('Saved searches', { exact: true })).toContainText('Bank review');
  await pick(page, 'Tallowfield Home Renovations');
  await expect(page.getByLabel('Saved searches', { exact: true })).not.toContainText('Bank review');
  expect(errors).toEqual([]);
});

test('stale edits preserve the newer search and reopening restores absent assignees', async ({ page, request }) => {
  const response = await request.post(`/api/companies/${company}/searches`, { data: { name: 'Shared search', definition } });
  const { search } = await response.json();
  await openPage(page); await page.getByLabel('Saved searches', { exact: true }).selectOption(search.id);
  await request.patch(`/api/companies/${company}/searches/${search.id}`, { data: { name: 'Changed elsewhere', definition: { ...definition, type: 'bank', assignee: 'Former reviewer' }, revision: 1 } });
  await page.locator('.saved-search-row').getByRole('button', { name: 'Edit search', exact: true }).click();
  await page.getByLabel('Search name', { exact: true }).fill('My stale name');
  await page.getByRole('form', { name: 'Save search' }).getByRole('button', { name: 'Save changes', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('changed in another session');
  await expect(page.getByLabel('Search name', { exact: true })).toHaveValue('My stale name');
  expect((await searches(page))[0].name).toBe('Changed elsewhere');
  await page.getByRole('button', { name: 'Reopen saved search', exact: true }).click();
  await expect(page.getByLabel('Transaction type filter')).toHaveValue('bank');
  await expect(page.getByLabel('Bill assignee filter')).toHaveValue('Former reviewer');
  await expect(page.getByLabel('Saved searches', { exact: true })).toContainText('Changed elsewhere');
});

test('load and save failures keep the query and name available for retry', async ({ page }) => {
  await page.route(`**/api/companies/${company}/searches`, async route => {
    await route.fulfill({ status: 503, json: { error: 'Searches are temporarily unavailable.' } });
  }, { times: 1 });
  await page.goto('/?workspace=transactions'); await pick(page);
  await expect(page.getByRole('alert')).toContainText('temporarily unavailable');
  await page.getByRole('button', { name: 'Retry', exact: true }).click();
  await expect(page.getByLabel('Saved searches', { exact: true })).toBeEnabled();
  await page.locator('.saved-search-row').getByRole('button', { name: 'Save search', exact: true }).click();
  await page.getByLabel('Search name', { exact: true }).fill('Retry this name');
  let failed = false;
  await page.route(`**/api/companies/${company}/searches`, async route => {
    if (route.request().method() !== 'POST' || failed) { await route.continue(); return; }
    failed = true;
    await route.fulfill({ status: 503, json: { error: 'Save failed. Try again.' } });
  });
  const save = page.getByRole('form', { name: 'Save search' }).getByRole('button', { name: 'Save search', exact: true });
  await save.click(); await expect(page.getByRole('alert')).toContainText('Save failed');
  await expect(page.getByLabel('Search name', { exact: true })).toHaveValue('Retry this name');
  await save.click(); await expect(page.getByLabel('Saved searches', { exact: true })).toContainText('Retry this name');
});
