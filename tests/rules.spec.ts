import { expect, test, type Page } from '@playwright/test';

const complete = async (page: Page, total = 50) => {
  await expect(page.locator('.rule-preview-bar')).toContainText(`${total}/${total} evaluated`, { timeout: 90000 });
  await expect(page.locator('.rule-preview-bar')).toContainText('Complete');
};
const store = async (page: Page) => {
  await expect(page.locator('.app')).toHaveAttribute('aria-busy', 'false');
  return (await (await page.request.get('/api/companies/company-018/rules')).json()).store;
};
test.beforeEach(async ({ request }) => {
  await request.patch('/api/settings', { data: { limit: 50, set: 'plain' } });
  await request.post('/api/companies/company-018/rules/commands', { data: { type: 'reset', full: true } });
});
const openRules = async (page: Page) => {
  await page.goto('/?workspace=rules');
  await page.getByRole('button', { name: 'Load example', exact: true }).click();
};
const requests: { criterion: string; ids: string[] }[] = [];

test('independent real AI conditions, live composition, edits, drag/drop, and stable ledger order', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
  requests.length = 0;
  let inFlight = 0, maximum = 0;
  page.on('request', req => { if (req.url().endsWith('/api/evaluate')) { requests.push(req.postDataJSON()); maximum = Math.max(maximum, ++inFlight); } });
  page.on('requestfinished', req => { if (req.url().endsWith('/api/evaluate')) inFlight--; });
  await openRules(page); await complete(page);
  expect(new Set(requests.map(r => r.criterion)).size).toBe(2);
  expect(new Set(requests.slice(0, 3).map(r => r.criterion)).size).toBe(2);
  expect(maximum).toBeLessThanOrEqual(3);
  expect(requests).toHaveLength(6);
  expect(Object.keys((await store(page)).transactions)).toHaveLength(0);
  const order = await page.locator('tbody tr').evaluateAll(rows => rows.map(r => r.getAttribute('data-id')));

  await page.getByLabel('Group logic').first().selectOption('any');
  await complete(page);
  await page.getByLabel('Action value').last().fill('Accounting team');
  await page.waitForTimeout(600);
  expect(requests).toHaveLength(6);
  expect(await page.locator('tbody tr').evaluateAll(rows => rows.map(r => r.getAttribute('data-id')))).toEqual(order);

  await page.getByLabel('AI condition text').first().fill('The memo describes a shipment, delivery, or backorder.');
  await expect(page.getByRole('button', { name: /^Run once/ })).toBeDisabled();
  await complete(page);
  expect(requests).toHaveLength(9);
  expect(requests.slice(6).every(r => r.criterion === 'The memo describes a shipment, delivery, or backorder.')).toBe(true);

  await page.getByLabel('Group logic').first().selectOption('all');
  await page.getByRole('button', { name: 'Standard condition', exact: true }).dragTo(page.getByTestId('node-all').first(), { targetPosition: { x: 10, y: 10 } });
  await expect(page.getByTestId('node-standard')).toHaveCount(1);
  await page.getByLabel('Amount in dollars').fill('15.01');
  await page.getByRole('button', { name: 'Move Standard condition up', exact: true }).click();
  await page.getByRole('button', { name: 'Remove Standard condition', exact: true }).click();
  await expect(page.getByTestId('node-standard')).toHaveCount(0);

  await page.getByRole('button', { name: 'ANY', exact: true }).click();
  await page.getByTestId('node-any').getByLabel('Add block to ANY').selectOption('standard');
  await expect(page.getByTestId('node-standard')).toHaveCount(1);
  await page.getByTestId('node-any').getByLabel('Group logic', { exact: true }).selectOption('not');
  await expect(page.getByTestId('node-not')).toHaveCount(2);
  await page.getByRole('button', { name: 'Remove NOT', exact: true }).last().click();
  await complete(page);
  expect(requests).toHaveLength(9);
  await page.getByRole('button', { name: 'Remove AI condition', exact: true }).last().click();
  await expect(page.locator('.builder-validation')).toContainText('Groups cannot be empty');
  await expect(page.getByRole('button', { name: 'Save rule', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Load example', exact: true }).click(); await complete(page);
  expect(requests).toHaveLength(9);
  await page.screenshot({ path: 'artifacts/verified-rule-builder.png', fullPage: true });
  expect(errors).toEqual([]);
});

test('saved rules, shared metadata, idempotent runs, undo conflicts and enabled replay persist in SQLite', async ({ page }) => {
  await openRules(page); await complete(page);
  await page.getByRole('button', { name: 'Save rule', exact: true }).click();
  const state = await store(page), ruleId = await page.getByLabel('Saved rules').inputValue();
  expect(state.rules.some((rule: any) => rule.id === ruleId)).toBe(true);
  await page.getByRole('button', { name: /^Run once/ }).click();
  const first = await store(page); expect(first.history.length).toBeGreaterThan(0);
  await page.getByRole('button', { name: /^Run once/ }).click();
  expect((await store(page)).history).toHaveLength(first.history.length);
  await page.getByRole('button', { name: 'Inspect a match', exact: true }).click();
  await page.getByText('Edit assignment, flags & tags', { exact: true }).click();
  const bill = (await page.locator('.drawer-head .muted').innerText()).split(' · ').pop()!;
  await page.getByLabel('Bill assignment').fill('Rylan Wade');
  await page.getByLabel('Bill assignment').press('Tab');
  await expect.poll(async () => (await store(page)).transactions['company-018:' + bill].owner).toBe('Rylan Wade');
  await page.getByLabel('Close detail', { exact: true }).click();
  await page.getByRole('button', { name: 'Action history', exact: true }).click();
  const owner = page.locator('.history-entry').filter({ hasText: bill }).filter({ hasText: 'Assign to:' });
  await owner.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(page.locator('.rules-notice')).toContainText('Undo conflict');
  const flag = page.locator('.history-entry').filter({ hasText: bill }).filter({ hasText: 'Add flag:' });
  await flag.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(flag.getByRole('button', { name: 'Undone', exact: true })).toBeDisabled();
  await page.reload(); await page.getByLabel('Saved rules').selectOption(ruleId); await complete(page);
  expect((await store(page)).transactions['company-018:' + bill].flags).toEqual([]);
  await page.getByRole('button', { name: /^Run once/ }).click();
  expect((await store(page)).transactions['company-018:' + bill].flags).toEqual([]);
  await page.getByLabel('Toggle rule enabled').click(); await store(page);
  await page.getByLabel('AI condition text').first().fill('The transaction has a vendor name.');
  await page.getByLabel('AI condition text').last().fill('The transaction amount is negative.'); await complete(page);
  await page.getByRole('button', { name: 'Save and activate revision', exact: true }).click();
  expect((await store(page)).rules.find((rule: any) => rule.id === ruleId).revision).toBe(2);
  await page.getByRole('button', { name: /^Replay next original bill/ }).click(); await store(page); await complete(page, 51);
  const arrived = (await store(page)).arrivals['company-018']; expect(arrived).toHaveLength(1);
  expect((await store(page)).transactions[arrived[0]].owner).toBe('Bookkeeper');
  await page.reload(); await complete(page, 51);
  expect((await store(page)).arrivals['company-018']).toEqual(arrived);
  expect(await page.evaluate(() => localStorage.getItem('tr.rules.v1'))).toBeNull();
});

test('company switching drops stale results and original evidence remains inspectable', async ({ page }) => {
  await openRules(page);
  await page.getByLabel('Rule name', { exact: true }).waitFor();
  await page.getByLabel('Company', { exact: true }).fill('Pistonhouse');
  await page.getByLabel('Company', { exact: true }).press('Enter');
  await page.getByLabel('Company', { exact: true }).fill('Stitchform');
  await page.getByLabel('Company', { exact: true }).press('Enter');
  await expect(page.locator('.ledger-caption')).toContainText('Stitchform Apparel');
  await complete(page);
  expect(await page.locator('tbody tr').evaluateAll(rows => rows.every(r => r.getAttribute('data-id')?.startsWith('company-004:')))).toBe(true);
  await page.getByLabel('Company', { exact: true }).fill('Shipwise');
  await page.getByLabel('Company', { exact: true }).press('Enter');
  await page.getByLabel('Rows to load').selectOption('0'); await complete(page, 411);
  await page.getByLabel('Search visible bills', { exact: true }).fill('bill-00540');
  await expect(page.locator('tbody tr')).toHaveCount(1);
  await page.locator('tbody tr').click();
  await expect(page.getByLabel('Transaction detail')).toContainText('Standing overhead charge for the period.');
  await expect(page.getByLabel('Transaction detail')).toContainText('earbuds');
  await page.screenshot({ path: 'artifacts/verified-original-evidence.png', fullPage: true });
});

test('reset URL changes shared company state and keeps saved rule definitions', async ({ page, browser }) => {
  await openRules(page); await complete(page);
  await page.getByRole('button', { name: 'Save rule', exact: true }).click(); await store(page);
  await page.getByRole('button', { name: /^Run once/ }).click(); await store(page);
  await page.getByLabel('Toggle rule enabled').click();
  const before = await store(page); expect(before.history.length).toBeGreaterThan(0);
  await page.goto('/?resetDemo=company-018&resetToken=browser-reset-test&workspace=rules'); await complete(page);
  const after = await store(page); expect(after.transactions).toEqual({}); expect(after.history).toEqual([]); expect(after.executions).toEqual([]);
  expect(after.arrivals['company-018']).toEqual([]); expect(after.rules).toEqual(before.rules.map((rule: any) => ({ ...rule, enabled: false })));
  expect(page.url()).not.toContain('resetDemo');
  await expect(page.getByRole('button', { name: /^Replay next original bill/ })).toContainText('(5)');
  const second = await browser.newContext();
  try { const other = await second.newPage(); await other.goto(new URL('/?workspace=rules', page.url()).toString()); await complete(other); expect((await store(other)).history).toEqual([]); }
  finally { await second.close(); }
});
