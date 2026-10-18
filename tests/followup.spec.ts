import { expect, test } from '@playwright/test';
import { startRuleApp } from './fixtures/ruleApp';

test('failed chart deletion stays visible, reports the failure, and persists only after retry', async ({ page }) => {
  const app = await startRuleApp();
  try {
    await page.goto(app.url + '/?workspace=dashboard');
    await expect(page.locator('.chart-card')).toHaveCount(4);
    await page.route('**/api/companies/company-101/dashboard', async route => {
      if (route.request().method() === 'PUT') await route.fulfill({ status: 500, json: { error: 'Controlled save failure' } });
      else await route.continue();
    });
    await page.getByRole('button', { name: 'Remove Monthly billed spend', exact: true }).click();
    await expect(page.getByRole('alert')).toContainText('Controlled save failure');
    await expect(page.locator('.chart-card')).toHaveCount(4);
    await page.unroute('**/api/companies/company-101/dashboard');
    await page.getByRole('button', { name: 'Retry', exact: true }).click();
    await expect(page.locator('.chart-card')).toHaveCount(3);
    await page.reload(); await expect(page.locator('.chart-card')).toHaveCount(3);
  } finally { await app.close(); }
});

test('stale dashboard edits receive a conflict and revisit reloads shared charts', async ({ page, context }) => {
  const app = await startRuleApp(); const other = await context.newPage();
  try {
    await Promise.all([page.goto(app.url + '/?workspace=dashboard'), other.goto(app.url + '/?workspace=dashboard')]);
    await expect(page.locator('.chart-card')).toHaveCount(4); await expect(other.locator('.chart-card')).toHaveCount(4);
    await page.getByRole('button', { name: 'Remove Monthly billed spend', exact: true }).click();
    await expect(page.locator('.chart-card')).toHaveCount(3);
    await other.getByRole('button', { name: 'Remove Spend by account', exact: true }).click();
    await expect(other.getByRole('alert')).toContainText('another session');
    await expect(other.locator('.chart-card')).toHaveCount(3);
    await other.getByRole('button', { name: 'Retry', exact: true }).click(); await expect(other.locator('.chart-card')).toHaveCount(2);
    await page.getByRole('navigation', { name: 'Workspace', exact: true }).getByRole('button', { name: 'Explore', exact: true }).click();
    await page.getByRole('navigation', { name: 'Workspace', exact: true }).getByRole('button', { name: 'Dashboard', exact: true }).click();
    await expect(page.locator('.chart-card')).toHaveCount(2);
  } finally { await other.close(); await app.close(); }
});

test('Dashboard supports focused chart creation and visibly enforces the shared chart limit', async ({ page }) => {
  const app = await startRuleApp();
  try {
    await page.goto(app.url + '/?workspace=dashboard'); await expect(page.locator('.chart-card')).toHaveCount(4);
    await page.getByRole('button', { name: 'Add chart', exact: true }).click();
    await page.getByLabel('Chart title', { exact: true }).fill('Selected purchase');
    await page.getByLabel('Chart record IDs').fill('company-101:bill-2');
    await page.getByLabel('Measure').selectOption('count');
    await page.getByRole('button', { name: 'Save chart', exact: true }).click();
    await expect(page.getByRole('region', { name: 'Selected purchase', exact: true })).toContainText('1 transaction');
    await page.reload(); await expect(page.getByRole('region', { name: 'Selected purchase', exact: true })).toBeVisible();
    const url = app.url + '/api/companies/company-101/dashboard', current = await (await page.request.get(url)).json();
    const charts = Array.from({ length: 24 }, (_, i) => ({ ...current.charts[0], id: `card-${i}`, title: `Card ${i}` }));
    expect((await page.request.put(url, { data: { charts, expectedRevision: current.revision } })).ok()).toBeTruthy();
    await page.getByRole('button', { name: 'Refresh', exact: true }).click(); await expect(page.locator('.chart-card')).toHaveCount(24);
    await page.getByRole('button', { name: 'Add chart', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Save chart', exact: true })).toBeDisabled();
    await expect(page.locator('.focus-chart')).toContainText('24 charts maximum');
  } finally { await app.close(); }
});

test('scoreless Qwen decisions finish and adjusted/raw scores retain their labels', async ({ page }) => {
  for (const scores of ['missing', 'raw', 'calibrated'] as const) {
    const app = await startRuleApp({ scores });
    try {
      await page.goto(app.url + '/?model=qwen');
      await page.getByRole('textbox', { name: /Search transactions|Jev search|Find transactions/i }).fill('Review purchases');
      await expect(page.getByLabel('Explore check progress')).toContainText('8/8 checked');
      const cells = page.locator('.explore-confidence');
      if (scores === 'missing') { await expect(cells.first()).toHaveText('Score unavailable'); await expect(cells.filter({ hasText: 'Checking' })).toHaveCount(0); }
      else await expect(cells.first()).toContainText(scores === 'raw' ? 'Raw candidate score' : 'Validation-adjusted score');
    } finally { await app.close(); }
  }
});

test('provider switching keeps company 104, search conditions and the unsaved rule without reloading', async ({ page }) => {
  const app = await startRuleApp({ mode: 'real-four-company' });
  try {
    await page.goto(app.url + '/?company=company-104&model=qwen');
    await page.evaluate(() => { (window as any).followupMarker = 'same-document'; });
    const search = page.getByRole('textbox', { name: /Search transactions|Jev search|Find transactions/i });
    await search.fill('Missing evidence');
    await page.getByLabel('Evaluation model').selectOption('jev');
    await expect(search).toHaveValue('Missing evidence'); expect(new URL(page.url()).searchParams.get('company')).toBe('company-104');
    await page.getByRole('navigation', { name: 'Workspace', exact: true }).getByRole('button', { name: 'Rules', exact: true }).click();
    await page.getByRole('button', { name: 'New rule', exact: true }).click();
    await page.getByLabel('Condition 1', { exact: true }).fill('Keep this unsaved condition');
    await expect(page.getByLabel('Evaluation model')).toHaveValue('jev');
    await page.getByLabel('Rule evaluation provider').selectOption('qwen');
    await expect(page.getByLabel('Condition 1', { exact: true })).toHaveValue('Keep this unsaved condition');
    await expect(page.getByLabel('Rule evaluation provider')).toHaveValue('qwen');
    expect(await page.evaluate(() => (window as any).followupMarker)).toBe('same-document');
    expect(new URL(page.url()).searchParams.get('company')).toBe('company-104');
  } finally { await app.close(); }
});

test('Refresh dashboard reloads changed records and restored records without page reload', async ({ page }) => {
  const app = await startRuleApp({ mode: 'real-four-company' });
  try {
    const base = app.url + '/api/companies/company-101';
    const rows = (await (await page.request.get(base + '/bills?limit=0')).json()).rows;
    const row = rows.find((row: any) => row.txnType === 'bill');
    const workspace = await (await page.request.get(base + '/workspace')).json();
    const account = workspace.accounts.find((account: any) => account.name !== row.account);
    const current = await (await page.request.get(base + '/dashboard')).json();
    expect((await page.request.put(base + '/dashboard', { data: { expectedRevision: current.revision, charts: [{ id: 'single', title: 'One record', groupBy: 'account', measure: 'spend', kind: 'hbar', ids: [row.id] }] } })).ok()).toBeTruthy();
    await page.goto(app.url + '/?workspace=dashboard');
    const chart = page.getByRole('region', { name: 'One record', exact: true }); await expect(chart).toContainText(row.account);
    const preview = await (await page.request.post(base + '/actions/preview', { data: { selection: { ids: [row.id], scope: 'selected' }, action: { type: 'category', accountId: account.id } } })).json();
    expect((await page.request.post(base + '/actions/' + preview.id + '/apply', { data: {} })).ok()).toBeTruthy();
    await page.getByRole('button', { name: 'Refresh', exact: true }).click(); await expect(chart).toContainText(account.name);
    expect((await page.request.post(base + '/rules/commands', { data: { type: 'reset', full: true } })).ok()).toBeTruthy();
    await page.getByRole('button', { name: 'Refresh', exact: true }).click(); await expect(chart).toContainText(row.account);
  } finally { await app.close(); }
});
