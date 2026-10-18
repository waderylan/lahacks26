// Scripted, screen-recordable walkthrough of the Transaction Review demo against real Jev/Gemini calls.
//
//   npm run demo                 headed Chrome, full pacing, fresh scratch database
//   npm run demo -- --fast       quick rehearsal at ~40% of the pacing
//   npm run demo -- --warm       silent headless pre-pass first, so Jev answers are cached when recording
//   npm run demo -- --gemini-model gemini-2.5-flash   draft messages with another Gemini model (separate free-tier quota)
//
// It starts its own server on a scratch SQLite file (never workspace/actions.sqlite), so every take starts clean.
import { chromium } from '@playwright/test';
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const args = process.argv.slice(2);
const flag = name => args.includes(`--${name}`);
const option = (name, fallback) => { const i = args.indexOf(`--${name}`); return i >= 0 && args[i + 1] ? args[i + 1] : fallback; };
const PACE = flag('fast') ? 0.4 : Number(option('pace', 1));
const PORT = Number(option('port', 5180));
const WIDTH = Number(option('width', 1600)), HEIGHT = Number(option('height', 900));
const ZOOM = Number(option('zoom', 0.9));
const CAPTIONS = !flag('no-captions');
const COMPANY = 'company-101';
const SENDER = 'emp-controller';

// What the demo searches for, and what each rule asks. Recipients are never set: Jev chooses them.
const SEARCH = {
  payment: 'asks to change where payment is sent',
  bypass: 'tries to tell the reviewer to skip a check or not flag it',
  duplicate: 'billed twice for the same goods under a different product name',
};
const RULES = {
  duplicate: { name: 'Renamed duplicate goods', flag: 'Possible duplicate', ask: 'Confirm whether these goods actually arrived once or twice, and what was received against each.' },
  payment: { name: 'Payment redirection', flag: 'Possible fraud', ask: 'Someone may be trying to redirect our payments. Escalate to whoever must approve before any money moves.' },
};
const PEOPLE = { 'Priya Natarajan': 'emp-ap', 'Marcus Bell': 'emp-controller', 'Elena Ruiz': 'emp-procurement', 'Dev Okafor': 'emp-ops', 'Hannah Cho': 'emp-facilities', 'Sam Whitaker': 'emp-it', 'Grace Adeyemi': 'emp-projects', 'Aisha Rahman': 'emp-tax', 'Robert Lindqvist': 'emp-cfo' };
const CHAT = ['plot expenses by supplier', 'plot expenses by month'];

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const pause = ms => sleep(ms * PACE);
const log = message => console.log(`[demo] ${message}`);

// ---- server --------------------------------------------------------------------------------------------------
async function startServer() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'review-demo-'));
  const child = spawn('npx', ['tsx', '--env-file-if-exists=.env', 'scripts/demo/server.ts'], { shell: true, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, ...(option('gemini-model') && { GEMINI_MODEL: option('gemini-model') }), PORT: String(PORT), WORKSPACE_DB: path.join(dir, 'demo.sqlite') } });
  let output = '';
  child.stdout.on('data', chunk => { output += chunk; });
  child.stderr.on('data', chunk => { output += chunk; });
  const stop = () => { try { spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' }); } catch { /* already gone */ } fs.rmSync(dir, { recursive: true, force: true }); };
  const url = `http://localhost:${PORT}`;
  for (let i = 0; i < 60; i++) {
    try { if ((await fetch(url)).ok) return { url, stop, output: () => output }; } catch { /* not up yet */ }
    await sleep(1000);
  }
  stop();
  throw new Error(`Server did not start:\n${output.slice(-1500)}`);
}

const status = async url => (await fetch(`${url}/api/status`)).json();
async function resetCompany(url) {
  const response = await fetch(`${url}/api/companies/${COMPANY}/rules/commands`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ type: 'reset', full: true }) });
  if (!response.ok) throw new Error(`Reset failed: ${response.status}`);
}

// ---- on-screen helpers ---------------------------------------------------------------------------------------
const OVERLAY = `
  const style = document.createElement('style');
  style.textContent = \`
    #demo-cursor{position:fixed;z-index:2147483647;width:22px;height:22px;margin:-4px 0 0 -4px;pointer-events:none;transition:transform .08s linear;
      background:url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='22' height='22' viewBox='0 0 22 22'><path d='M3 2l14 8-6 1.6L8.4 18z' fill='black' stroke='white' stroke-width='1.6' stroke-linejoin='round'/></svg>") no-repeat}
    .demo-ripple{position:fixed;z-index:2147483646;width:34px;height:34px;margin:-17px 0 0 -17px;border-radius:50%;border:3px solid #1e7a4d;pointer-events:none;animation:demo-ripple .55s ease-out forwards}
    @keyframes demo-ripple{from{transform:scale(.3);opacity:1}to{transform:scale(1.5);opacity:0}}
    #demo-caption{position:fixed;z-index:2147483647;left:50%;bottom:26px;transform:translateX(-50%);max-width:min(1100px,86vw);padding:13px 26px;border-radius:12px;
      background:rgba(20,27,24,.93);color:#fff;font:600 21px/1.35 system-ui,sans-serif;text-align:center;box-shadow:0 8px 28px rgba(0,0,0,.3);pointer-events:none;transition:opacity .25s}
    #demo-caption:empty{opacity:0}
  \`;
  const mount = () => {
    if (!document.head || document.getElementById('demo-cursor')) return;
    document.head.appendChild(style);
    const cursor = document.createElement('div'); cursor.id = 'demo-cursor'; cursor.style.transform = 'translate(-40px,-40px)';
    const caption = document.createElement('div'); caption.id = 'demo-caption';
    document.body.append(cursor, caption);
    window.addEventListener('mousemove', event => { cursor.style.transform = 'translate(' + event.clientX + 'px,' + event.clientY + 'px)'; }, true);
    window.addEventListener('mousedown', event => { const ripple = document.createElement('div'); ripple.className = 'demo-ripple'; ripple.style.left = event.clientX + 'px'; ripple.style.top = event.clientY + 'px'; document.body.appendChild(ripple); setTimeout(() => ripple.remove(), 600); }, true);
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount); else mount();
`;

let shot = 0;
const started = Date.now();
function screen(page, { silent }) {
  if (flag('shots')) fs.mkdirSync('artifacts/demo/shots', { recursive: true });
  let mouse = { x: 800, y: 450 };
  const api = {
    async caption(text) {
      if (flag('timing') && text) log(`${Math.round((Date.now() - started) / 1000)}s  ${text.slice(0, 70)}`);
      if (silent || !CAPTIONS) return;
      await page.evaluate(value => { const el = document.getElementById('demo-caption'); if (el) el.textContent = value; }, text).catch(() => {});
      if (flag('shots') && text) { shot += 1; await sleep(1500); await page.screenshot({ path: `artifacts/demo/shots/${String(shot).padStart(2, '0')}.png` }).catch(() => {}); }
    },
    async move(locator) {
      const target = locator.first();
      await target.scrollIntoViewIfNeeded();
      const box = await target.boundingBox();
      if (!box) throw new Error('Element has no box');
      const to = { x: box.x + Math.min(box.width / 2, 120), y: box.y + box.height / 2 };
      if (silent) await page.mouse.move(to.x, to.y);
      else for (let i = 1; i <= 12; i++) { await page.mouse.move(mouse.x + (to.x - mouse.x) * i / 12, mouse.y + (to.y - mouse.y) * i / 12); await sleep(14 * Math.max(PACE, 0.3)); }
      mouse = to;
    },
    async click(locator, hold = 350) {
      await api.move(locator);
      await pause(hold);
      await locator.first().click();
      await pause(250);
    },
    async type(locator, text, perChar = 48) {
      // The app can re-render while it finishes loading and drop what was typed, so check the field and retype if needed.
      for (let attempt = 0; attempt < 4; attempt++) {
        await api.click(locator, 200);
        // insertText appends without selecting the field's text (fill() flashes a selection on every update).
        await locator.first().fill('');
        if (silent) await page.keyboard.insertText(text);
        else {
          const step = text.length > 40 ? 3 : 2;
          for (let at = 0; at < text.length; at += step) {
            await page.keyboard.insertText(text.slice(at, at + step));
            await sleep(perChar * step * Math.max(PACE, 0.5));
          }
        }
        await sleep(250);
        if ((await locator.first().inputValue()) === text) return;
        await sleep(1000);
      }
      throw new Error(`Could not enter "${text}"`);
    },
    async select(locator, value, hold = 300) {
      await api.move(locator);
      await pause(hold);
      await locator.first().selectOption(value);
      await pause(250);
    },
    async scrollTo(locator, block = 'start') {
      if (silent) return;
      await locator.first().evaluate((el, where) => el.scrollIntoView({ behavior: 'smooth', block: where }), block);
      await pause(900);
    },
    async hold(ms) { if (!silent) await pause(ms); },
  };
  return api;
}

// ---- the walkthrough -----------------------------------------------------------------------------------------
async function walkthrough(page, base, { silent }) {
  const ui = screen(page, { silent });
  const nav = name => page.getByRole('navigation', { name: 'Workspace' }).getByRole('button', { name, exact: false });
  const progress = page.getByLabel('Explore check progress');
  const wizardSteps = page.getByRole('navigation', { name: 'Rule setup steps' });
  const person = page.getByLabel('Signed in as');

  const awaitChecked = async () => {
    await sleep(1400); // the search is debounced, so the previous run's "Complete" is stale until then
    await progress.getByText(/Complete/).waitFor({ timeout: 120_000 });
    await sleep(400);
  };
  const matchCount = async () => Number((await progress.innerText()).match(/(\d+) match/)?.[1] ?? 0);
  const search = async (text, caption, afterCaption) => {
    await ui.caption(caption);
    await ui.type(page.getByLabel('Search transactions', { exact: true }), text);
    await awaitChecked();
    const matches = await matchCount();
    await ui.caption(afterCaption(matches));
    await ui.scrollTo(page.getByRole('heading', { name: 'Results', exact: true }), 'start');
    await ui.hold(4500);
    await page.evaluate(() => window.scrollBy({ top: 330, behavior: 'smooth' }));
    await ui.hold(2600);
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'smooth' }));
    await ui.hold(600);
  };
  const buildRule = async ({ name, flag: flagText, ask }, captions) => {
    const wait = ms => ui.hold(captions.quick ? ms * 0.5 : ms);
    await ui.caption(captions.create);
    await ui.click(page.getByRole('button', { name: 'Create rule', exact: true }));
    await wait(1300);
    await ui.click(wizardSteps.getByRole('button', { name: 'Actions', exact: true }));
    const match = page.getByRole('group', { name: 'Match', exact: true });
    await ui.click(match.getByRole('button', { name: /^Add action/ }));
    await ui.type(match.getByLabel('Action value'), flagText, 40);
    await ui.click(match.getByRole('button', { name: /^Add action/ }));
    await ui.select(match.getByLabel('Action type').nth(1), 'message');
    await ui.type(match.getByLabel('Message request'), ask, 12);
    await ui.select(match.getByLabel('Message sender'), SENDER);
    await ui.caption(captions.recipient);
    await ui.move(match.getByLabel('Message recipient'));
    await wait(3200);
    await ui.click(wizardSteps.getByRole('button', { name: 'Preview', exact: true }));
    await page.getByLabel('Match counts').getByText(/matches?/).first().waitFor();
    await page.getByLabel('Evaluation progress').getByText(/Complete/).waitFor({ timeout: 120_000 }).catch(() => {});
    await wait(1500);
    await ui.type(page.getByLabel('Rule name'), name, 36);
    await ui.click(page.getByRole('button', { name: 'Save rule', exact: true }));
    await wait(700);
    await ui.caption(captions.run);
    await ui.click(page.getByRole('button', { name: /^Run on \d+ transactions/ }));
    await ui.hold(2200);
  };

  await page.goto(`${base}/?company=${COMPANY}&as=${SENDER}`);
  await page.getByLabel('Search transactions', { exact: true }).waitFor({ timeout: 60_000 });
  await page.evaluate(zoom => { document.documentElement.style.zoom = String(zoom); }, ZOOM);
  await page.getByText(/131 of 346/).waitFor();
  await sleep(2000);
  await ui.hold(800);

  // 1. Explore: type a prompt, watch the green matches, change the prompt, watch them change.
  await ui.caption('Parcelmint Online Goods: 131 transactions across vendor bills, customer invoices and bank rows');
  await ui.hold(3200);
  await search(SEARCH.payment, 'Explore: describe a problem in plain English and Jev checks every transaction',
    n => `${n} matches: bills, customer invoices and a bank row that ask to redirect payment`);
  await search(SEARCH.bypass, 'Change the prompt and the matches change: records that try to talk the reviewer out of checking them',
    n => `${n} matches: Jev finds the hidden instructions aimed at the reviewer, in bills, invoices and bank memos`);
  await search(SEARCH.duplicate, 'Same goods, different name: possible duplicate billing across vendors and customers',
    n => `${n} matches: the same product billed under another name`);

  // 2. Rule from the current search, then one from an earlier search. Recipients are left to Jev.
  await buildRule(RULES.duplicate, {
    create: 'Turn this search into a rule with one click',
    recipient: 'On a match it flags the record and drafts a message. Recipient: "Let Jev choose"',
    run: 'Run it: flags, and one drafted message',
  });
  await ui.click(nav('Explore'));
  await search(SEARCH.payment, 'Back to the payment search for a second rule',
    n => `${n} matches, answered instantly this time`);
  await buildRule(RULES.payment, {
    create: 'Same again for the payment search',
    recipient: 'A different problem, same setting: Jev picks the recipient',
    run: 'Run it',
    quick: true,
  });

  // 3. Messages: Jev has chosen the recipients; approve as the sender, then read them as the recipients.
  await ui.caption('Every flag, task and drafted message is logged, with Undo');
  await ui.click(nav('Tasks'));
  await ui.hold(4500);
  await ui.caption('Jev reads each batch and picks who should receive it');
  await ui.click(nav('Messages'));
  await ui.click(page.getByRole('button', { name: /^Approvals/ }));
  await page.getByText('Pending approval').first().waitFor({ timeout: 120_000 });
  await page.waitForFunction(() => !/Choosing recipient|Writing/.test(document.body.innerText) && document.body.innerText.split('Pending approval').length >= 3, null, { timeout: 240_000 });
  await ui.hold(1200);
  // Whoever Jev chose is read off the drafts, so the captions and the sign-ins below always match what actually happened.
  const found = (await page.locator('body').innerText()).matchAll(/ · To ([A-Z][a-z]+ [A-Z][a-z]+)/g);
  const chosen = [...new Set([...found].map(match => match[1]))].map(name => ({ name, id: PEOPLE[name] })).filter(person => person.id && person.id !== SENDER);
  log(`Jev chose: ${chosen.map(person => person.name).join(' | ') || '(nobody found)'}`);
  await ui.caption(chosen.length > 1 ? 'Two different problems, two different recipients, chosen by Jev, not by us' : 'The recipient is chosen by Jev, not by us');
  await ui.scrollTo(page.getByText(/^From .* · To /).first(), 'center');
  await ui.hold(5500);
  await ui.caption('Automated messages need the sender to approve before anything is sent');
  const approvals = page.getByRole('button', { name: 'Approve', exact: true });
  while (await approvals.count()) { await ui.click(approvals.first(), 700); await ui.hold(900); }
  await ui.hold(900);

  const readAs = async ({ name, id }, caption, index) => {
    await ui.caption(caption);
    await ui.select(person, id);
    await ui.click(page.getByRole('button', { name: /^Inbox/ }));
    await ui.hold(900);
    await ui.click(page.locator('.inbox-list button').first());
    await ui.hold(index === 0 ? 5000 : 4000);
  };
  for (const [index, recipient] of chosen.entries()) await readAs(recipient, index === 0 ? `Signed in as ${recipient.name}, the recipient Jev chose` : `And ${recipient.name}, chosen for the other problem`, index);
  await ui.select(person, SENDER);

  // 4. Ask your books: vague graph requests, Jev works out what to aggregate.
  for (const [index, question] of CHAT.entries()) {
    await ui.caption(index === 0 ? 'Ask your books: a vague request, Jev picks what to aggregate' : 'Another one');
    await ui.click(page.getByRole('button', { name: 'Ask your books' }));
    await ui.type(page.getByPlaceholder(/Ask about/), question, 60);
    await ui.hold(500);
    await ui.click(page.getByRole('button', { name: 'Send' }));
    await page.waitForURL(/workspace=dashboard/, { timeout: 120_000 });
    await ui.hold(600);
    await ui.caption(index === 0 ? 'Spend by supplier, built from the question alone' : 'Spend by month');
    await ui.hold(4200);
  }
  await ui.caption('Search in English. Turn it into a rule. Jev routes the work. A human approves.');
  await ui.hold(3200);
  await ui.caption('');
}

// ---- main ----------------------------------------------------------------------------------------------------
const server = flag('url') ? { url: option('url'), stop() {} } : await startServer();
let browser;
try {
  const state = await status(server.url);
  if (!state.jev?.configured || !state.gemini?.configured) throw new Error('Jev and Gemini must both be configured (AI_GATEWAY_API_KEY, GEMINI_API_KEY in .env).');

  const open = async headless => {
    browser = await chromium.launch({ channel: 'chrome', headless, args: headless ? [] : [`--window-size=${WIDTH},${HEIGHT + 90}`, '--window-position=0,0'] });
    const context = await browser.newContext({ viewport: { width: WIDTH, height: HEIGHT } });
    await context.addInitScript(OVERLAY);
    const next = await context.newPage();
    if (flag('debug')) { next.on('load', () => log('page load/reload')); next.on('framenavigated', frame => frame === next.mainFrame() && log(`nav ${frame.url()}`)); next.on('console', m => m.type() === 'error' && log(`console: ${m.text().slice(0, 200)}`)); next.on('pageerror', e => log(`pageerror: ${e.message.slice(0, 200)}`)); }
    return next;
  };

  if (flag('warm')) {
    log('Warming Jev answers in the background (headless)…');
    const page = await open(true);
    await walkthrough(page, server.url, { silent: true });
    await browser.close();
    await resetCompany(server.url);
    log('Warm pass done; company reset.');
  }

  log(`Recording pass at ${server.url}. Start your screen recorder now.`);
  await sleep(flag('warm') ? 1500 : 3000);
  const page = await open(false);
  try { await walkthrough(page, server.url, { silent: false }); }
  catch (error) { fs.mkdirSync('artifacts/demo', { recursive: true }); await page.screenshot({ path: 'artifacts/demo/failure.png' }).catch(() => {}); log('Failed; screenshot in artifacts/demo/failure.png'); if (flag('debug')) log(`server output tail:
${server.output?.().slice(-1500)}`); throw error; }
  log('Done.');
  if (flag('keep-open')) await new Promise(() => {});
} finally {
  await browser?.close().catch(() => {});
  server.stop();
}
