import { expect, test, type Page } from '@playwright/test';
import { startRuleApp } from './fixtures/ruleApp';

async function openChat(page: Page) {
  await page.getByRole('button', { name: 'Ask your books', exact: true }).click();
  return page.getByRole('dialog', { name: 'Ask your books', exact: true });
}

async function ask(page: Page, question: string) {
  const chat = page.getByRole('dialog', { name: 'Ask your books', exact: true });
  await chat.locator('.chat-input input').fill(question);
  await chat.getByRole('button', { name: 'Send', exact: true }).click();
  await chat.locator('.model-choice button').filter({ hasText: 'Fast, one judgment' }).click();
  return chat;
}

test('Ask your books restores semantic answers, previewed tasks and durable conversation history', async ({ page }) => {
  const app = await startRuleApp();
  try {
    await page.goto(app.url);
    await openChat(page);
    const chat = await ask(page, 'Show me bills for repairs');
    await expect(chat.locator('.lead')).toContainText('1 matching bill');
    const base = `${app.url}/api/companies/company-101`;
    expect((await (await page.request.get(base + '/workspace')).json()).tasks).toHaveLength(0);
    await chat.getByRole('button', { name: /Create tasks/ }).click();
    await chat.getByRole('button', { name: 'Preview', exact: true }).click();
    await expect(chat.locator('.act-preview')).toContainText('Jev picked');
    expect((await (await page.request.get(base + '/workspace')).json()).tasks).toHaveLength(0);
    await chat.getByRole('button', { name: 'Apply to 1', exact: true }).click();
    await expect(chat.locator('.act-done')).toContainText('1 tasks created');
    const state = await (await page.request.get(base + '/workspace')).json();
    expect(state.tasks).toHaveLength(1);
    expect(state.tasks[0].owner).toBe('emp-ap');
    expect(state.tasks[0].billId).toBe('company-101:bill-2');
    await expect.poll(async () => (await (await page.request.get(base + '/chat?as=emp-ap')).json()).length).toBe(1);
    await page.reload(); await openChat(page);
    await expect(chat.locator('.msg.user')).toHaveText('Show me bills for repairs');
    await expect(chat.locator('.lead')).toContainText('1 matching bill');
    await chat.getByRole('button', { name: 'Close chat', exact: true }).click();
    await page.getByRole('navigation', { name: 'Workspace', exact: true }).getByRole('button', { name: /^Tasks/ }).click();
    await expect(page.locator('.dashboard-task')).toContainText('Review:');
  } finally { await app.close(); }
});

test('chat graphs use the current Dashboard save flow and survive reload', async ({ page }) => {
  const app = await startRuleApp();
  try {
    await page.goto(app.url); await openChat(page);
    const chat = await ask(page, 'Graph all spending by month');
    await expect(page.getByRole('main', { name: 'Dashboard', exact: true })).toBeVisible();
    await chat.getByRole('button', { name: 'Close chat', exact: true }).click();
    await page.getByRole('button', { name: 'Keep on dashboard', exact: true }).click();
    await expect(page.locator('.chart-card')).toHaveCount(5);
    const data = await (await page.request.get(app.url + '/api/companies/company-101/dashboard')).json();
    expect(data.revision).toBe(1);
    expect(data.charts.at(-1).source.question).toBe('Graph all spending by month');
    await page.reload(); await expect(page.locator('.chart-card')).toHaveCount(5);
  } finally { await app.close(); }
});

test('chat reports failed history saves, retries them and isolates employee conversations', async ({ page }) => {
  const app = await startRuleApp();
  try {
    const path = '**/api/companies/company-101/chat';
    await page.route(path, route => route.request().method() === 'POST'
      ? route.fulfill({ status: 500, json: { error: 'Controlled save failure' } }) : route.continue());
    await page.goto(app.url); await openChat(page);
    const chat = await ask(page, 'How many bills are there in all?');
    await expect(chat.getByRole('alert')).toContainText('Could not save this answer');
    await page.unroute(path);
    await chat.getByRole('button', { name: 'Retry save', exact: true }).click();
    await expect(chat.getByRole('alert')).toHaveCount(0);
    await page.getByLabel('Signed in as').selectOption('emp-cfo');
    await expect(chat.locator('.msg.user')).toHaveCount(0);
    await page.getByLabel('Signed in as').selectOption('emp-ap');
    await expect(chat.locator('.msg.user')).toHaveText('How many bills are there in all?');
  } finally { await app.close(); }
});
