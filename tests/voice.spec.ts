import { expect, test } from '@playwright/test';
import { startRuleApp } from './fixtures/ruleApp';

test('voice input fills Explore search and leaves transactions unchanged', async ({ page }) => {
  const app = await startRuleApp();
  try {
    await page.addInitScript(() => {
      (window as any).SpeechRecognition = class {
        onresult: any; onend: any;
        start() {
          const result: any = [{ transcript: 'Missing receipt' }];
          result.isFinal = true;
          this.onresult({ resultIndex: 0, results: [result] });
          this.onend();
        }
        stop() { this.onend?.(); }
        abort() {}
      };
    });
    await page.goto(app.url);
    const before = await (await page.request.get(app.url + '/api/companies/company-101/workspace')).json();
    await page.getByRole('button', { name: 'Search by voice', exact: true }).click();
    await expect(page.getByRole('textbox', { name: 'Search transactions', exact: true })).toHaveValue('Missing receipt');
    await expect(page.getByLabel('Explore check progress')).toContainText('8/8');
    const after = await (await page.request.get(app.url + '/api/companies/company-101/workspace')).json();
    expect(after.tasks).toEqual(before.tasks);
    expect(after.runs).toEqual(before.runs);
  } finally { await app.close(); }
});

test('unsupported speech recognition keeps typed Explore search available', async ({ page }) => {
  const app = await startRuleApp();
  try {
    await page.addInitScript(() => {
      (window as any).SpeechRecognition = undefined;
      (window as any).webkitSpeechRecognition = undefined;
    });
    await page.goto(app.url);
    await expect(page.getByRole('textbox', { name: 'Search transactions', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Search by voice', exact: true })).toHaveCount(0);
  } finally { await app.close(); }
});
