import { expect, test, type Page } from '@playwright/test';

const complete = async (page: Page, total = 50) => {
  await expect(page.getByLabel('Evaluation progress')).toContainText(`${total}/${total} evaluated`, { timeout: 90000 });
  await expect(page.getByLabel('Evaluation progress')).toContainText('Complete');
};
const store = async (page: Page) => (await (await page.request.get('/api/companies/company-018/rules')).json()).store;

test('message actions: one synthesized draft per run, routed by Jev or to a chosen employee', async ({ page }) => {
  const status = await (await page.request.get('/api/status')).json();
  test.skip(!status.gemini?.configured, 'Live message generation needs GEMINI_API_KEY. Shared approvals are covered by workspace.spec.ts.');
  await page.request.patch('/api/settings', { data: { limit: 50 } });
  await page.request.post('/api/companies/company-018/rules/commands', { data: { type: 'reset', full: true } });
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto('/?workspace=rules');
  await page.locator('.starter-more > summary').click();
  await page.locator('.starter-more').getByRole('button', { name: 'Memo needs clarification', exact: true }).click(); await complete(page);
  await page.getByRole('navigation', { name: 'Rule setup steps' }).getByRole('button', { name: 'Choose actions', exact: true }).click();
  await page.getByRole('button', { name: 'Add action', exact: true }).click();
  await page.getByLabel('Action type').last().selectOption('message');
  await expect(page.getByLabel('Message recipient')).toHaveValue('jev');
  await page.getByLabel('Message request').fill('Ask whether this was a one-off purchase or the monthly service, and whether it should be recoded.');
  await page.getByRole('button', { name: 'Add action', exact: true }).click();
  await page.getByLabel('Action type').last().selectOption('message');
  await page.getByLabel('Message recipient').last().selectOption('emp-ap');
  await expect(page.getByLabel('Message recipient').last()).toHaveValue('emp-ap');
  await page.getByLabel('Message request').last().fill('Ask them to fix the memo so it matches the line items.');
  await page.getByRole('button', { name: 'Review results', exact: true }).click();
  await page.getByRole('button', { name: 'Save rule', exact: true }).click();
  await expect(page.locator('.app')).toHaveAttribute('aria-busy', 'false');
  const count = Number(await page.locator('.wizard-results .count-true b').innerText());
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
  expect(messages.every((message: any) => message.items.every((item: any) => item.context.every((condition: any) => ['true', 'false', 'uncertain'].includes(condition.result))))).toBe(true);

  await page.getByRole('navigation', { name: 'Workspace' }).getByRole('button', { name: /^Messages/ }).click();
  await page.getByRole('navigation', { name: 'Message folders' }).getByRole('button', { name: /^Approvals/ }).click();
  const card = page.locator('.message-card').filter({ hasText: 'Recipient chosen by Jev' }).first();
  await expect(card).toContainText('Request: Ask whether this was a one-off purchase');
  await card.getByRole('button', { name: 'Approve' }).click();
  await expect(card).toContainText('Sent to inbox · not emailed');

  // Signed in as Priya (default), the approval is in her Sent folder and the recipient's inbox.
  const recipient = jev[0].to as string;
  const folders = page.getByRole('navigation', { name: 'Message folders' });
  await folders.getByRole('button', { name: /^Sent/ }).click();
  await expect(page.getByLabel('Sent messages')).toContainText(`To ${recipient}`);
  const accounts = page.getByLabel('Signed in as', { exact: true });
  await accounts.selectOption(jev[0].employeeId);
  await expect(page).toHaveURL(new RegExp(`as=${jev[0].employeeId}`));
  await folders.getByRole('button', { name: /^Inbox/ }).click();
  await page.getByLabel('Received messages').getByRole('button', { name: /Priya Natarajan/ }).first().click();
  await expect(page.getByLabel('Conversation')).toContainText(jev[0].subject);
  await page.getByRole('button', { name: 'Reply', exact: true }).click();
  await page.getByLabel('Message body').fill('Checked these. Recoding two of them today.');
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await accounts.selectOption('emp-ap');
  await folders.getByRole('button', { name: /^Inbox/ }).click();
  await expect(page.getByLabel('Received messages')).toContainText('Recoding two of them today');
  console.log(`Jev recipient for ${count} bills: ${jev[0].to} (${Math.round(jev[0].routingProbability * 100)}%)`);
  console.log('Sample draft:\n' + jev[0].subject + '\n' + jev[0].body);
  expect(errors).toEqual([]);
});
