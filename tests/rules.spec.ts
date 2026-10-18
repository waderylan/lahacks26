import { expect, test, type Page } from '@playwright/test';

const complete = async (page: Page, total = 50) => {
  await expect(page.getByLabel('Evaluation progress')).toContainText(`${total}/${total} evaluated`, { timeout: 90000 });
  await expect(page.getByLabel('Evaluation progress')).toContainText('Complete');
};
const step = (page: Page, name: string) => page.getByRole('navigation', { name: 'Rule setup steps' }).getByRole('button', { name, exact: true }).click();
const store = async (page: Page) => {
  await expect(page.locator('.app')).toHaveAttribute('aria-busy', 'false');
  return (await (await page.request.get('/api/companies/company-018/rules')).json()).store;
};
const openRules = async (page: Page) => {
  await page.goto('/?workspace=rules');
  await page.locator('.rule-starters > summary').click();
  await page.locator('.starter-more > summary').click();
  await page.locator('.starter-more').getByRole('button', { name: 'Memo needs clarification', exact: true }).click();
};
test.beforeEach(async ({ request }) => {
  await request.patch('/api/settings', { data: { limit: 50, set: 'plain' } });
  await request.post('/api/companies/company-018/rules/commands', { data: { type: 'reset', full: true } });
});

test('English conditions use real independent Jev judgments; AND/OR and action edits reuse them; grouped filters remain editable', async ({ page }) => {
  const errors: string[] = [], requests: { criterion: string; ids: string[] }[] = [];
  page.on('pageerror', error => errors.push(error.message));
  let running = 0, maximum = 0;
  page.on('request', request => { if (request.url().endsWith('/api/evaluate')) { requests.push(request.postDataJSON()); maximum = Math.max(maximum, ++running); } });
  page.on('requestfinished', request => { if (request.url().endsWith('/api/evaluate')) running--; });
  await openRules(page); await complete(page);
  expect(new Set(requests.map(request => request.criterion)).size).toBe(2);
  expect(maximum).toBeLessThanOrEqual(3); expect(requests).toHaveLength(6);
  await step(page, 'Review results'); await page.getByLabel('Preview rows').selectOption('all');
  await expect(page.locator('.wizard-table tbody tr')).toHaveCount(50);
  const order = await page.locator('.wizard-table tbody tr').evaluateAll(rows => rows.map(row => row.getAttribute('data-id')));
  await step(page, 'Describe conditions'); await page.getByLabel('Group logic').first().selectOption('any');
  await step(page, 'Choose actions'); await page.getByLabel('Action value').last().fill('Accounting team');
  await step(page, 'Review results'); await complete(page);
  expect(requests).toHaveLength(6);
  expect(await page.locator('.wizard-table tbody tr').evaluateAll(rows => rows.map(row => row.getAttribute('data-id')))).toEqual(order);
  await step(page, 'Describe conditions');
  await page.getByLabel('Condition 1', { exact: true }).fill('The memo describes a shipment, delivery, or backorder.'); await complete(page);
  expect(requests).toHaveLength(9); expect(requests.slice(6).every(request => request.criterion === 'The memo describes a shipment, delivery, or backorder.')).toBe(true);
  await page.getByLabel('Group logic').first().selectOption('all');
  await page.getByRole('button', { name: 'Add group', exact: true }).click();
  await page.getByLabel('Condition 3', { exact: true }).fill('The memo describes a shipment, delivery, or backorder.'); await complete(page);
  await page.getByLabel('Group logic').last().selectOption('not');
  await expect(page.getByLabel('Group logic').last()).toHaveValue('not');
  await page.locator('.wizard-extra-filter').first().locator('summary').click();
  await page.locator('.wizard-extra-filter').first().getByRole('button', { name: 'Amount', exact: true }).click();
  await page.getByLabel('Amount in dollars').fill('15.01'); await complete(page);
  await page.getByRole('button', { name: 'Remove condition 4', exact: true }).click();
  await page.getByRole('button', { name: 'Remove NOT group', exact: true }).last().click();
  expect(requests).toHaveLength(9);
  await page.getByRole('button', { name: 'Remove condition 1', exact: true }).click();
  await page.getByRole('button', { name: 'Remove NOT group', exact: true }).click();
  await expect(page.locator('.wizard-validation')).toContainText('Add a condition');
  await expect(page.locator('.wizard-bottom').getByRole('button', { name: 'Choose actions', exact: true })).toBeDisabled();
  await page.locator('.starter-more').getByRole('button', { name: 'Memo needs clarification', exact: true }).click(); await complete(page);
  expect(requests).toHaveLength(9);
  await page.screenshot({ path: 'artifacts/verified-guided-conditions.png', fullPage: true });
  expect(errors).toEqual([]);
});

test('guided save and run persist, remain idempotent, protect later edits on undo, and keep enabled replay', async ({ page }) => {
  await openRules(page); await complete(page); await step(page, 'Review results');
  await page.getByLabel('Preview rows').selectOption('true');
  await page.getByRole('button', { name: 'Save rule', exact: true }).click();
  await store(page);
  await expect(page.getByLabel('Saved rules')).not.toHaveValue('');
  const ruleId = await page.getByLabel('Saved rules').inputValue();
  await page.getByRole('button', { name: /^Run once/ }).click();
  const first = await store(page); expect(first.history.length).toBeGreaterThan(0);
  await page.getByRole('button', { name: /^Run once/ }).click(); expect((await store(page)).history).toHaveLength(first.history.length);
  await page.locator('.wizard-vendor').first().click();
  await page.getByText('Edit assignment, flags & tags', { exact: true }).click();
  const bill = (await page.locator('.drawer-head .muted').innerText()).split(' · ').pop()!;
  await page.getByLabel('Bill assignment').fill('Rylan Wade'); await page.getByLabel('Bill assignment').press('Tab');
  await expect.poll(async () => (await store(page)).transactions[`company-018:${bill}`].owner).toBe('Rylan Wade');
  await page.getByLabel('Close detail', { exact: true }).click();
  await page.locator('.wizard-history > summary').click();
  await page.getByRole('button', { name: 'Action history', exact: true }).click();
  const owner = page.locator('.history-entry').filter({ hasText: bill }).filter({ hasText: 'Assign to:' });
  await owner.getByRole('button', { name: 'Undo', exact: true }).click(); await expect(page.locator('.rules-notice')).toContainText('Undo conflict');
  const flag = page.locator('.history-entry').filter({ hasText: bill }).filter({ hasText: 'Add flag:' });
  await flag.getByRole('button', { name: 'Undo', exact: true }).click(); await expect(flag.getByRole('button', { name: 'Undone', exact: true })).toBeDisabled();
  await page.reload(); await page.getByLabel('Saved rules').selectOption(ruleId); await complete(page); await step(page, 'Review results');
  expect((await store(page)).transactions[`company-018:${bill}`].flags).toEqual([]);
  await page.getByRole('button', { name: /^Run once/ }).click(); expect((await store(page)).transactions[`company-018:${bill}`].flags).toEqual([]);
  await page.getByLabel('Run automatically', { exact: true }).click(); await expect(page.getByLabel('Run automatically', { exact: true })).toBeChecked(); await store(page);
  await step(page, 'Describe conditions');
  await page.getByLabel('Condition 1', { exact: true }).fill('The transaction has a vendor name.');
  await page.getByLabel('Condition 2', { exact: true }).fill('The transaction amount is negative.'); await complete(page);
  await step(page, 'Review results'); await page.getByRole('button', { name: 'Save rule', exact: true }).click();
  expect((await store(page)).rules.find((rule: any) => rule.id === ruleId).revision).toBe(2);
  await page.locator('.wizard-history > summary').click();
  await page.getByRole('button', { name: /^Replay next original bill/ }).click(); await store(page); await complete(page, 51);
  const arrived = (await store(page)).arrivals['company-018']; expect(arrived).toHaveLength(1);
  expect((await store(page)).transactions[arrived[0]].owner).toBe('Bookkeeper');
  await page.reload(); await complete(page, 51);
  expect((await store(page)).arrivals['company-018']).toEqual(arrived);
  expect(await page.evaluate(() => localStorage.getItem('tr.rules.v1'))).toBeNull();
});

test('switching companies clears stale judgments, and row inspection preserves original bill evidence', async ({ page }) => {
  await openRules(page);
  await page.getByLabel('Company', { exact: true }).fill('Pistonhouse'); await page.getByLabel('Company', { exact: true }).press('Enter');
  await page.getByLabel('Company', { exact: true }).fill('Stitchform'); await page.getByLabel('Company', { exact: true }).press('Enter');
  await expect(page.getByLabel('Company', { exact: true })).toHaveValue('Stitchform Apparel Co'); await complete(page);
  await step(page, 'Review results'); await page.getByLabel('Preview rows').selectOption('all');
  expect(await page.locator('.wizard-table tbody tr').evaluateAll(rows => rows.every(row => row.getAttribute('data-id')?.startsWith('company-004:')))).toBe(true);
  await page.getByLabel('Company', { exact: true }).fill('Shipwise'); await page.getByLabel('Company', { exact: true }).press('Enter');
  await page.getByLabel('Rows to load').selectOption('0'); await complete(page, 411); await step(page, 'Review results');
  await page.getByLabel('Preview rows').selectOption('all'); await page.getByLabel('Search visible bills', { exact: true }).fill('bill-00540');
  await expect(page.locator('.wizard-table tbody tr')).toHaveCount(1); await page.locator('.wizard-vendor').click();
  await expect(page.getByLabel('Transaction detail')).toContainText('Standing overhead charge for the period.');
  await expect(page.getByLabel('Transaction detail')).toContainText('earbuds');
});

test('reset remains shared and saved rules survive, while phone layouts expose the three steps', async ({ page, browser }) => {
  await openRules(page); await complete(page); await step(page, 'Review results');
  await page.getByRole('button', { name: 'Save rule', exact: true }).click(); await store(page);
  await page.getByRole('button', { name: /^Run once/ }).click(); await store(page);
  await page.getByLabel('Run automatically', { exact: true }).click(); await expect(page.getByLabel('Run automatically', { exact: true })).toBeChecked(); const before = await store(page);
  await page.goto('/?resetDemo=company-018&resetToken=browser-reset-test&workspace=rules'); await complete(page);
  const after = await store(page); expect(after.transactions).toEqual({}); expect(after.history).toEqual([]); expect(after.executions).toEqual([]);
  expect(after.arrivals['company-018']).toEqual([]); expect(after.rules).toEqual(before.rules.map((rule: any) => ({ ...rule, enabled: false })));
  expect(page.url()).not.toContain('resetDemo');
  const second = await browser.newContext();
  try { const other = await second.newPage(); await other.goto(new URL('/?workspace=rules', page.url()).toString()); await complete(other); expect((await store(other)).history).toEqual([]); } finally { await second.close(); }
  await page.setViewportSize({ width: 390, height: 844 });
  for (const name of ['Describe conditions', 'Choose actions', 'Review results']) {
    await step(page, name); expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
  await page.screenshot({ path: 'artifacts/verified-guided-review-mobile.png', fullPage: true });
});

test('Run once applies actions only to the matching bills in the filtered preview', async ({ page }) => {
  await openRules(page); await complete(page); await step(page, 'Review results');
  await page.getByLabel('Preview rows').selectOption('true');
  const matchingRows = page.locator('.wizard-table tbody tr');
  expect(await matchingRows.count()).toBeGreaterThan(1);
  const firstId = (await matchingRows.first().getAttribute('data-id'))!;
  await page.getByLabel('Search visible bills', { exact: true }).fill(firstId.split(':')[1]);
  await expect(matchingRows).toHaveCount(1);
  await page.getByRole('button', { name: 'Save rule', exact: true }).click(); await store(page);
  await page.getByRole('button', { name: 'Run once · 1 transaction', exact: true }).click();
  const result = await store(page);
  expect(result.history.length).toBeGreaterThan(0);
  expect([...new Set(result.history.map((entry: any) => entry.transactionId))]).toEqual([firstId]);
  expect(Object.keys(result.transactions)).toEqual([firstId]);
  await page.getByLabel('Search visible bills', { exact: true }).clear();
  await page.getByLabel('Bill status filter').selectOption('flagged');
  await page.getByLabel('Bill assignee filter').selectOption('owner:Bookkeeper');
  await expect(matchingRows).toHaveCount(1);
  await expect(matchingRows.first()).toHaveAttribute('data-id', firstId);
});

test('guided review retains invoice and bank type filters and transaction details', async ({ page, request }) => {
  const companies = await (await request.get('/api/companies')).json();
  const company = companies.find((item: any) => item.companyId === 'company-101');
  await page.goto('/?workspace=rules');
  await page.getByLabel('Company', { exact: true }).fill(company.name);
  await page.getByLabel('Company', { exact: true }).press('Enter');
  await page.getByRole('button', { name: 'New rule', exact: true }).click();
  await page.locator('.wizard-extra-filter').first().locator('summary').click();
  await page.locator('.wizard-extra-filter').first().getByRole('button', { name: 'Amount', exact: true }).click();
  await page.getByRole('button', { name: 'Remove condition 1', exact: true }).click();
  await page.getByLabel('Rows to load').selectOption('0');
  await expect(page.getByLabel('Evaluation progress')).toContainText('Complete');
  await step(page, 'Review results');
  await page.getByLabel('Preview rows').selectOption('all');
  for (const type of ['invoice', 'bank']) {
    await page.getByLabel('Transaction type filter').selectOption(type);
    await expect(page.locator('.wizard-table tbody tr').first()).toBeVisible();
    expect(await page.locator('.wizard-table .type-pill').allTextContents()).toEqual(expect.arrayContaining([type === 'invoice' ? 'Invoice' : 'Bank']));
    const expected = (await (await request.get('/api/companies/company-101/bills?limit=0&reserve=1')).json()).rows.filter((row: any) => row.txnType === type);
    await expect(page.locator('.wizard-table tbody tr')).toHaveCount(expected.length);
    await page.locator('.wizard-vendor').first().click();
    await expect(page.getByLabel('Transaction detail')).toContainText('Details');
    await page.getByLabel('Close detail', { exact: true }).click();
  }
  await page.getByRole('button', { name: 'Transactions', exact: true }).click();
  await page.getByLabel('Transaction type filter').selectOption('invoice');
  await expect(page.locator('tbody tr[data-id]').first()).toContainText('Invoice');
});
