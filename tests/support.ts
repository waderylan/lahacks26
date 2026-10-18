import type { Page } from '@playwright/test';

/** Chooses a company in the toolbar picker by (part of) its name. */
export async function chooseCompany(page: Page, name: string) {
  const value = await page.locator('select[aria-label="Company"] option', { hasText: name }).first().getAttribute('value');
  await page.getByLabel('Company', { exact: true }).selectOption(value!);
}
