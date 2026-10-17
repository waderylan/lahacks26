import { expect, test, type Page } from '@playwright/test';

const complete = async (page: Page, total = 50) => {
  await expect(page.locator('.rule-preview-bar')).toContainText(`${total}/${total} evaluated`, { timeout: 90000 });
  await expect(page.locator('.rule-preview-bar')).toContainText('Complete');
};
const store = (page: Page) => page.evaluate(() => JSON.parse(localStorage.getItem('tr.rules.v1') ?? '{"messages":[]}'));

test('message actions: one synthesized draft per run, routed by Jev or to a chosen employee', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
  const drafts: any[] = [];
  page.on('request', req => { if (req.url().endsWith('/api/messages/draft')) drafts.push(req.postDataJSON()); });
  await page.goto('/'); await complete(page);
  await page.getByRole('button', { name: '+ Add action', exact: true }).click();
  await page.getByLabel('Action type').last().selectOption('message');
  await expect(page.getByLabel('Message recipient')).toHaveValue('jev');
  await page.getByLabel('Message request').fill('Ask whether this was a one-off purchase or the monthly service, and whether it should be recoded.');
  await page.getByRole('button', { name: '+ Add action', exact: true }).click();
  await page.getByLabel('Action type').last().selectOption('message');
  await page.getByLabel('Message recipient').last().selectOption('emp-ap');
  await expect(page.locator('.message-action').last()).toContainText('Enters and codes every vendor bill');
  await page.getByLabel('Message request').last().fill('Ask them to fix the memo so it matches the line items.');
  await page.getByRole('button', { name: 'Save rule', exact: true }).click();
  const count = Number(await page.locator('.rule-preview-bar h2 strong').innerText());
  test.skip(count === 0, 'Example rule matched no bills in this sample');
  await page.getByRole('button', { name: /^Run once/ }).click();

  await expect.poll(async () => (await store(page)).messages.filter((m: any) => m.generation !== 'pending').length, { timeout: 180000, intervals: [2000] }).toBe(2);
  const messages = (await store(page)).messages;
  const failed = messages.filter((m: any) => m.generation === 'error');
  expect(failed.map((m: any) => m.generationError)).toEqual([]);
  const jev = messages.filter((m: any) => m.routing === 'jev');
  const manual = messages.filter((m: any) => m.routing === 'manual');
  expect(jev).toHaveLength(1); expect(manual).toHaveLength(1);
  expect(messages.every((m: any) => m.items.length === count)).toBe(true);
  expect(manual.every((m: any) => m.employeeId === 'emp-ap' && m.to === 'Priya Natarajan')).toBe(true);
  expect(jev.every((m: any) => typeof m.employeeId === 'string' && m.routingProbability > 0)).toBe(true);
  expect(messages.every((m: any) => m.subject && m.body && m.items.every((i: any) => i.context.length === 2))).toBe(true);
  expect(drafts.every(d => d.items.length === count && d.items.every((i: any) => i.context.every((c: any) => ['true', 'false', 'uncertain'].includes(c.result))))).toBe(true);
  expect(drafts.some(d => d.recipient === 'jev') && drafts.some(d => d.recipient === 'emp-ap')).toBe(true);

  await page.getByRole('button', { name: /Messages/ }).click();
  const card = page.locator('.message-card').filter({ hasText: 'Recipient chosen by Jev' }).first();
  await expect(card).toContainText('Request: Ask whether this was a one-off purchase');
  await card.getByRole('button', { name: 'Approve' }).click();
  await expect(card).toContainText('Marked sent · local only');
  console.log(`Jev recipient for ${count} bills: ${jev[0].to} (${Math.round(jev[0].routingProbability * 100)}%)`);
  console.log('Sample draft:\n' + jev[0].subject + '\n' + jev[0].body);
  expect(errors).toEqual([]);
});
