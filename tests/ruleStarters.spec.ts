import { expect, test } from '@playwright/test';
import { startRuleApp } from './fixtures/ruleApp';

test('starters add once, stay editable, retain saved status after reload, and run outcome actions', async ({ page }) => {
  const app = await startRuleApp();
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  const step = (name: string) => page.getByRole('navigation', { name: 'Rule setup steps' }).getByRole('button', { name, exact: true }).click();
  try {
    await page.goto(`${app.url}/?workspace=rules`);
    await page.getByRole('button', { name: 'New rule', exact: true }).click();
    await expect(page.locator('label[for="saved-rule"]')).toBeVisible();
    await expect(page.getByLabel('Saved rules', { exact: true })).toBeDisabled();
    await expect(page.getByLabel('Saved rules', { exact: true })).toContainText('No saved rules yet');
    await expect(page.getByRole('combobox', { name: 'Start from a preset', exact: true })).toHaveCount(0);
    await page.getByRole('button', { name: 'All rules', exact: true }).click();
    const starter = page.getByRole('article', { name: 'Missing documentation starter', exact: true });
    await expect(page.locator('.rule-starters')).not.toHaveAttribute('open');
    await page.locator('.rule-starters > summary').click();
    await expect(starter).toBeVisible();
    await expect(starter).toContainText('Ready to add');
    await starter.getByRole('button', { name: 'Add rule', exact: true }).click();
    await expect(page.getByLabel('Saved rules', { exact: true })).toBeEnabled();
    await expect(page.getByLabel('Condition 1', { exact: true })).toContainText('unitemized receipt');
    await page.getByLabel('Condition 1', { exact: true }).fill('This charge lacks supporting documentation.');
    await step('Choose actions');
    await expect(page.getByLabel('Clear resolved issues')).toBeChecked();
    await expect(page.getByRole('group', { name: 'When there is not enough information', exact: true }).getByLabel('Task owner')).toHaveValue('Priya Natarajan');
    await step('Review results');
    await page.getByLabel('Rule name', { exact: true }).fill('Receipt review for this company');
    await page.getByRole('button', { name: 'Save rule', exact: true }).click();
    await page.getByRole('button', { name: /Run now/ }).click();
    await expect(page.getByLabel('Rule follow-up')).toContainText('2 open');
    const snapshot = await (await page.request.get(`${app.url}/api/companies/company-018/rules`)).json();
    expect(snapshot.store.rules).toHaveLength(1);
    expect(snapshot.store.messages).toHaveLength(1);
    expect(snapshot.rows.find((row: any) => row.id === 'company-018:bill-2').dashboard.flags).toContain('Needs documentation');
    const state = await (await page.request.get(`${app.url}/api/companies/company-018/workspace`)).json();
    expect(state.tasks).toHaveLength(2);
    await page.reload();
    await page.locator('.rule-starters > summary').click();
    await expect(starter).toContainText('Saved · Keep checking off');
    await starter.getByRole('button', { name: 'Open rule', exact: true }).click();
    await expect(page.getByLabel('Condition 1', { exact: true })).toHaveValue('This charge lacks supporting documentation.');
    await page.getByRole('button', { name: 'All rules', exact: true }).click();
    await page.locator('.rule-starters > summary').click();
    await expect(starter).toContainText('Saved as Receipt review for this company');
    await page.locator('.starter-more > summary').click();
    await page.locator('.starter-more').getByRole('button', { name: 'Memo needs clarification', exact: true }).click();
    await expect(page.getByLabel('Condition 1', { exact: true })).toHaveValue('The memo describes a standing overhead or monthly service charge.');
    await page.getByRole('button', { name: 'All rules', exact: true }).click();
    await page.locator('.rule-starters > summary').click();
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(starter.getByRole('button', { name: 'Open rule', exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: 'artifacts/rule-starters-mobile.png', fullPage: true });
    expect(errors).toEqual([]);
  } finally { await app.close(); }
});

test('all four custom companies show a useful starter, public example, and independently saved rules', async ({ page }) => {
  const app = await startRuleApp({ synthetic: true });
  const cases = [
    ['Parcelmint Online Goods', 'Possible duplicate charges', 'phone-case'],
    ['Tallowfield Home Renovations', 'Unsupported expenses', 'stand-down'],
    ['Quillstone Creative Studio', 'Missing documentation', 'itemized'],
    ['Marrow & Vine Catering', 'Possible payment fraud', '7731'],
  ];
  try {
    await page.goto(`${app.url}/?workspace=rules&editRule=1`);
    for (const [company, preset, clue] of cases) {
      await page.getByLabel('Company', { exact: true }).fill(company);
      await page.getByLabel('Company', { exact: true }).press('Enter');
      await page.locator('.rule-starters > summary').click();
      const starter = page.getByRole('article', { name: `${preset} starter`, exact: true });
      await expect(starter).toContainText('Try first for this company');
      await expect(starter).toContainText(clue);
      await expect(page.locator('.rule-starters > summary')).toContainText('Editable examples');
      await starter.getByRole('button', { name: 'Inspect example', exact: true }).click();
      await expect(page.getByLabel('Transaction detail')).toBeVisible();
      await page.getByLabel('Close detail', { exact: true }).click();
      await starter.getByRole('button', { name: 'Add rule', exact: true }).click();
      await page.getByRole('button', { name: 'All rules', exact: true }).click();
      await page.locator('.rule-starters > summary').click();
      await expect(starter).toContainText('Saved · Keep checking off');
      await expect(page.getByRole('table', { name: 'Company rules', exact: true })).toContainText(preset);
      await page.getByRole('button', { name: 'Use demo sample', exact: true }).click();
      await page.locator('.rule-starters > summary').click();
      await expect(page.locator('.starter-intro')).toContainText('Demo sample loaded');
      if (preset === 'Possible payment fraud') {
        await starter.getByRole('button', { name: 'Open rule', exact: true }).click();
        await page.getByRole('navigation', { name: 'Rule setup steps' }).getByRole('button', { name: 'Choose actions', exact: true }).click();
        await expect(page.getByLabel('Message recipient')).toHaveValue('emp-cfo');
        await page.setViewportSize({ width: 1600, height: 1000 });
        await page.screenshot({ path: 'artifacts/rule-starters-desktop.png', fullPage: true });
      }
      await page.getByLabel('Rows to load').selectOption('50');
    }
  } finally { await app.close(); }
});
