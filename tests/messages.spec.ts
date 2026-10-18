import { expect, test } from '@playwright/test';
import { startRuleApp } from './fixtures/ruleApp';
import type { Rule } from '../src/rules';

test('rule messages remain drafts until the sender approves, then appear in the recipient inbox', async ({ page }) => {
  const app = await startRuleApp();
  const base = `${app.url}/api/companies/company-101`;
  const rule: Rule = { id: 'receipt-message', companyId: 'company-101', name: 'Ask for receipt', revision: 1, enabled: false,
    expression: { id: 'missing', type: 'ai', text: 'This charge lacks support.', label: '' },
    actions: [{ id: 'message', type: 'message', when: 'uncertain', value: 'Ask for the missing receipt.', recipient: 'jev', sender: 'emp-ap' }] };
  try {
    await page.request.post(`${base}/rules/commands`, { data: { type: 'save', rule, expectedRevision: null } });
    await page.request.post(`${base}/rules/commands`, { data: { type: 'run', id: rule.id, revision: 1, ids: ['company-101:bill-1'] } });
    await page.goto(`${app.url}/?workspace=messages`);
    await page.getByRole('navigation', { name: 'Message folders' }).getByRole('button', { name: /^Approvals/ }).click();
    const card = page.locator('.inbox-approvals .message-card');
    await expect(card).toContainText('Please provide the receipt');
    const mailbox = async () => (await (await page.request.get(`${base}/mail?as=emp-controller`)).json()).inbox;
    expect(await mailbox()).toEqual([]);
    await card.getByRole('button', { name: 'Edit', exact: true }).click();
    await card.getByLabel('Edit draft message').fill('Please attach the receipt for this maintenance charge.');
    await card.getByRole('button', { name: 'Approve', exact: true }).click();
    await expect(card).toContainText('Approved · sent to internal inbox');
    await page.getByLabel('Signed in as').selectOption('emp-controller');
    await page.getByRole('navigation', { name: 'Message folders' }).getByRole('button', { name: /^Inbox/ }).click();
    await page.getByLabel('Received messages').getByRole('button').click();
    await expect(page.getByLabel('Conversation')).toContainText('Please attach the receipt for this maintenance charge.');
    await page.reload();
    await expect(page.getByLabel('Received messages').getByRole('button')).toHaveCount(1);
  } finally { await app.close(); }
});
