import { expect, test } from '@playwright/test';
import { startRuleApp } from './fixtures/ruleApp';

test('typing must stop for a full second before checks start, including cached searches', async ({ page }) => {
  const app = await startRuleApp();
  const queries: string[] = [];
  try {
    await page.clock.install({ time: new Date('2026-10-17T12:00:00Z') });
    await page.route('**/api/evaluate', route => {
      const { criterion, ids } = route.request().postDataJSON(); queries.push(criterion);
      return route.fulfill({ json: { results: ids.map((id: string) => ({ id, state: 'match', scoreKind: 'jev_probability', pMatch: .95 })), costNanoUsd: '0' } });
    });
    await page.goto(app.url);
    await expect(page.getByRole('table', { name: 'Explore results' }).locator('tbody tr')).toHaveCount(8);
    await page.clock.pauseAt(new Date(await page.evaluate(() => Date.now()) + 10_000));
    const input = page.getByLabel('Search transactions', { exact: true });
    await input.fill('Draft search');
    await page.clock.runFor(900);
    expect(queries).toEqual([]);
    await input.fill('Finished search');
    await page.clock.runFor(999);
    expect(queries).toEqual([]);
    await page.clock.runFor(1);
    await expect.poll(() => queries).toEqual(['Finished search']);
    await expect(page.getByLabel('Explore check progress')).toContainText('8/8 checked');
    await page.getByRole('button', { name: 'Clear search', exact: true }).click();
    await input.fill('Finished search');
    await page.clock.runFor(999);
    await expect(page.getByLabel('Explore check progress')).toContainText('0/8 checked');
    await expect(page.locator('.explore-table .m-match')).toHaveCount(0);
    await page.clock.runFor(1);
    await expect(page.getByLabel('Explore check progress')).toContainText('8/8 checked');
    expect(queries).toEqual(['Finished search']);
  } finally { await app.close(); }
});

test('the simple bar streams highlighted matches, shows scores, sorts by confidence, and clears back to the original rows', async ({ page }) => {
  const app = await startRuleApp({ rowCount: 24 });
  let release = () => {};
  const slowBatch = new Promise<void>(resolve => { release = resolve; });
  try {
    await page.goto(app.url);
    const table = page.getByRole('table', { name: 'Explore results', exact: true });
    await expect(table.locator('tbody tr')).toHaveCount(24);
    const original = await table.locator('tbody tr').evaluateAll(rows => rows.map(row => row.getAttribute('data-id')!));
    const scores: Record<string, number> = { [original[0]]: .8, [original[1]]: .95, [original[20]]: .9 };
    await page.route('**/api/evaluate', async route => {
      const { ids } = route.request().postDataJSON();
      if (ids.length === 20) await slowBatch;
      await route.fulfill({ json: { results: ids.map((id: string) => ({ id, state: scores[id] ? 'match' : 'no_match', scoreKind: 'jev_probability', pMatch: scores[id] ?? .1 })), costNanoUsd: '0' } });
    });
    await expect(page.getByLabel('Group logic')).toHaveCount(0);
    await page.getByLabel('Search transactions', { exact: true }).fill('Purchases for tools');
    await expect(page.getByLabel('Explore check progress')).toContainText('4/24 checked');
    await expect(table.locator('tbody tr').first()).toHaveAttribute('data-id', original[20]);
    await expect(table.locator('tr.m-match .explore-confidence')).toHaveText('90% Jev match probability');
    release();
    await expect(page.getByLabel('Explore check progress')).toContainText('24/24 checked · Complete');
    const matches = table.locator('tbody tr.m-match');
    expect(await matches.evaluateAll(rows => rows.map(row => row.getAttribute('data-id')))).toEqual([original[1], original[20], original[0]]);
    expect(await matches.locator('.explore-confidence').allTextContents()).toEqual(['95% Jev match probability', '90% Jev match probability', '80% Jev match probability']);
    await page.getByLabel('Reverse sort', { exact: true }).click();
    expect(await matches.locator('.explore-confidence').allTextContents()).toEqual(['80% Jev match probability', '90% Jev match probability', '95% Jev match probability']);
    await page.getByRole('button', { name: 'Clear search', exact: true }).click();
    await expect(matches).toHaveCount(0);
    expect(await table.locator('tbody tr').evaluateAll(rows => rows.map(row => row.getAttribute('data-id')))).toEqual(original);
    await expect(table.locator('.explore-confidence').first()).toHaveText('-');
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.getByLabel('Search transactions', { exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: 'artifacts/explore-simple-mobile.png', fullPage: true });
  } finally { release(); await app.close(); }
});

test('older search responses cannot highlight or score a newer search', async ({ page }) => {
  const app = await startRuleApp();
  let release = () => {};
  const oldSearch = new Promise<void>(resolve => { release = resolve; });
  try {
    await page.route('**/api/evaluate', async route => {
      const { criterion, ids } = route.request().postDataJSON();
      if (criterion === 'Slow search') await oldSearch;
      await route.fulfill({ json: { results: ids.map((id: string) => ({ id, state: criterion === 'Slow search' ? 'match' : 'no_match', scoreKind: 'jev_probability', pMatch: criterion === 'Slow search' ? .99 : .05 })), costNanoUsd: '0' } });
    });
    await page.goto(app.url);
    const oldRequest = page.waitForRequest(request => request.url().endsWith('/api/evaluate') && request.postDataJSON().criterion === 'Slow search');
    await page.getByLabel('Search transactions', { exact: true }).fill('Slow search');
    await oldRequest;
    await page.getByLabel('Search transactions', { exact: true }).fill('Current search');
    await expect(page.getByLabel('Explore check progress')).toContainText('8/8 checked · Complete');
    const oldReply = page.waitForResponse(response => response.url().endsWith('/api/evaluate') && response.request().postDataJSON().criterion === 'Slow search');
    release(); await oldReply;
    await expect(page.locator('.explore-table .m-match')).toHaveCount(0);
    await expect(page.locator('.explore-confidence').first()).toHaveText('5% Jev match probability');
  } finally { release(); await app.close(); }
});

test('saved simple searches reopen with their parameters and confidence scores visible', async ({ page }) => {
  const app = await startRuleApp();
  try {
    await page.goto(app.url);
    await page.getByLabel('Search transactions', { exact: true }).fill('Tools and equipment');
    await page.getByLabel('Explore type').selectOption('bill');
    await page.getByLabel('Explore status').selectOption('needs_review');
    await page.getByLabel('Explore assignee').selectOption('unassigned');
    await page.getByLabel('Explore result', { exact: true }).selectOption('true');
    await page.getByRole('button', { name: 'Save view', exact: true }).click();
    await page.getByLabel('View name').fill('Tool purchases');
    await page.getByRole('button', { name: 'Save new view', exact: true }).click();
    await expect(page.getByLabel('Current view parameters')).toContainText('Tools and equipment');
    await page.reload();
    await page.getByLabel('Saved views').getByRole('button', { name: 'Tool purchases', exact: true }).click();
    await expect(page.getByLabel('Search transactions', { exact: true })).toHaveValue('Tools and equipment');
    await expect(page.getByLabel('Group logic')).toHaveCount(0);
    const parameters = page.getByLabel('Current view parameters');
    await expect(parameters).toContainText('Vendor bills');
    await expect(parameters).toContainText('Needs review');
    await expect(parameters).toContainText('Unassigned');
    await expect(parameters).toContainText('Matches');
    await expect(parameters).toContainText('Highest confidence first');
    await expect(page.getByLabel('Explore check progress')).toContainText('8/8 checked · Complete');
    await expect(page.locator('.explore-confidence').first()).toHaveText('50% Jev match probability');
    await page.getByLabel('Search transactions', { exact: true }).fill('Updated search');
    await expect(parameters).toContainText('Updated search');
    await expect(page.locator('.view-title')).toContainText('Unsaved changes');
    await page.getByRole('button', { name: 'Clear search', exact: true }).click();
    await expect(page.getByLabel('Explore result', { exact: true })).toBeDisabled();
    await expect(page.getByLabel('Explore result', { exact: true })).toHaveValue('all');
    await expect(parameters).toContainText('All results (no search)');
    await page.getByLabel('Search transactions', { exact: true }).fill('Tools and equipment');
    await expect(page.getByLabel('Explore result', { exact: true })).toHaveValue('true');
  } finally { await app.close(); }
});

test('combining keeps the simple search and labels each condition confidence without changing the group result', async ({ page }) => {
  const app = await startRuleApp();
  let checks = 0;
  try {
    await page.route('**/api/evaluate', route => {
      checks++;
      const { criterion, ids } = route.request().postDataJSON();
      return route.fulfill({ json: { results: ids.map((id: string) => ({ id, state: 'match', scoreKind: 'jev_probability', pMatch: criterion === 'Equipment' ? .9 : .7 })), costNanoUsd: '0' } });
    });
    await page.goto(app.url);
    await page.getByLabel('Search transactions', { exact: true }).fill('Equipment');
    await expect(page.getByLabel('Explore check progress')).toContainText('8/8 checked · Complete');
    await page.getByRole('button', { name: 'Combine conditions', exact: true }).click();
    await expect(page.getByLabel('Condition 1', { exact: true })).toHaveValue('Equipment');
    await page.getByRole('button', { name: 'Use simple search', exact: true }).click();
    await expect(page.getByLabel('Search transactions', { exact: true })).toHaveValue('Equipment');
    expect(checks).toBe(1);
    await page.getByRole('button', { name: 'Combine conditions', exact: true }).click();
    await page.getByRole('button', { name: 'Add condition', exact: true }).click();
    await page.getByLabel('Condition 2', { exact: true }).fill('Receipt');
    await expect(page.getByLabel('Explore check progress')).toContainText('8/8 checked · Complete');
    await expect(page.getByRole('button', { name: 'Use simple search', exact: true })).toBeDisabled();
    const firstRow = page.locator('.explore-table tbody tr').first();
    await expect(firstRow.getByRole('group', { name: 'Condition 1 score', exact: true })).toContainText('90% Jev match probability');
    await expect(firstRow.getByRole('group', { name: 'Condition 2 score', exact: true })).toContainText('70% Jev match probability');
    const options = page.getByLabel('Confidence condition').locator('option');
    await page.getByLabel('Confidence condition').selectOption((await options.nth(1).getAttribute('value'))!);
    await expect(page.getByLabel('Explore sort').locator('option:checked')).toHaveText('Condition 2 score');
    await expect(firstRow.getByRole('group', { name: 'Condition 1 score', exact: true })).toContainText('90% Jev match probability');
    await expect(firstRow.getByRole('group', { name: 'Condition 2 score', exact: true })).toContainText('70% Jev match probability');
    await expect(page.locator('.explore-table tbody tr.m-match')).toHaveCount(8);
    expect(checks).toBe(2);
    await expect(page.locator('.explore-confidence-choice')).toContainText('before AND, OR, and NOT');
  } finally { await app.close(); }
});

test('combined results show each condition score separately through AND, OR and NOT', async ({ page }) => {
  const app = await startRuleApp();
  try {
    await page.route('**/api/evaluate', route => {
      const { criterion, ids } = route.request().postDataJSON();
      return route.fulfill({ json: { results: ids.map((id: string) => {
        const matches = criterion === 'Electronics' && id.endsWith(':bill-1');
        return { id, state: matches ? 'match' : 'no_match', scoreKind: 'jev_probability', pMatch: matches ? .99 : .01 };
      }), costNanoUsd: '0' } });
    });
    await page.goto(app.url);
    await page.getByLabel('Search transactions', { exact: true }).fill('Electronics');
    await expect(page.getByLabel('Explore check progress')).toContainText('8/8 checked');
    await page.getByRole('button', { name: 'Combine conditions', exact: true }).click();
    await page.getByRole('button', { name: 'Add condition', exact: true }).click();
    await page.getByLabel('Condition 2', { exact: true }).fill('Memo conflicts with description');
    await expect(page.getByLabel('Explore check progress')).toContainText('8/8 checked');
    const table = page.getByRole('table', { name: 'Explore results', exact: true });
    const row = table.locator('tr[data-id="company-101:bill-1"]');
    const combinedResult = row.locator('td').nth(5).locator('summary');
    await expect(table.getByRole('columnheader', { name: 'Combined result', exact: true })).toBeVisible();
    await expect(table.getByRole('columnheader', { name: 'Match confidence', exact: true })).toHaveCount(0);
    await expect(row.locator('.explore-confidence')).toHaveCount(0);
    await expect(combinedResult).toHaveText('No match');
    await expect(row).not.toHaveClass(/m-match/);
    const first = row.getByRole('group', { name: 'Condition 1 score', exact: true });
    const second = row.getByRole('group', { name: 'Condition 2 score', exact: true });
    await expect(first).toContainText('99% Jev match probability');
    await expect(first.locator('.result')).toHaveText('Match');
    await expect(second).toContainText('1% Jev match probability');
    await expect(second.locator('.result')).toHaveText('No match');
    const neither = table.locator('tr[data-id="company-101:bill-2"]');
    await expect(neither.getByRole('group', { name: /Condition [12] score/ }).locator('.result')).toHaveText(['No match', 'No match']);
    await expect(neither.locator('td').nth(5).locator('summary')).toHaveText('No match');
    await page.getByLabel('Group logic', { exact: true }).selectOption('any');
    await expect(combinedResult).toHaveText('Match');
    await expect(row).toHaveClass(/m-match/);
    await page.getByRole('button', { name: 'Remove condition 2', exact: true }).click();
    await page.getByLabel('Group logic', { exact: true }).selectOption('not');
    await expect(combinedResult).toHaveText('No match');
    await expect(row).not.toHaveClass(/m-match/);
    await expect(first).toContainText('99% Jev match probability');
  } finally { await app.close(); }
});
