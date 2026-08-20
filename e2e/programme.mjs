/**
 * The Programme tab: the plan as the primary object, and a block that can
 * actually end.
 */
import { chromium } from 'playwright';

const BASE = process.env.BASE_URL ?? 'http://127.0.0.1:5185/';
const b = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const c = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
const p = await c.newPage();
const errs = [];
p.on('pageerror', e => errs.push('pageerror: ' + e.message));
p.on('console', m => { if (m.type()==='error' && !/Failed to load resource/i.test(m.text())) errs.push('console: '+m.text()); });
const step = async (l, fn) => { try { await fn(); console.log('  ok   '+l); } catch(e) { console.log('  FAIL '+l+': '+e.message); throw e; } };

await p.goto(BASE, { waitUntil: 'networkidle' });
await step('app loads', async () => { await p.getByRole('heading', {name:'Train'}).waitFor({timeout:40000}); });

await step('the tab is Programme, not Routines', async () => {
  const nav = await p.locator('nav').innerText();
  if (!/Programme/i.test(nav)) throw new Error(`expected a Programme tab, saw: ${nav.replace(/\n/g,' | ')}`);
  if (/Routines/i.test(nav)) throw new Error('the Routines tab should be gone');
});

await step('with no plan it says so and points at Plans', async () => {
  await p.getByRole('link', { name: 'Programme' }).click();
  await p.getByRole('heading', { name: 'Programme' }).waitFor({ timeout: 15000 });
  const body = await p.locator('body').innerText();
  if (!/No plan running/i.test(body)) throw new Error('expected the empty state');
  if (!/Pick a plan/i.test(body)) throw new Error('expected a route into Plans');
});

await step('build a plan', async () => {
  await p.goto(BASE + '#/plans/build_muscle', { waitUntil: 'networkidle' });
  await p.waitForTimeout(700);
  const href = await p.locator('a[href*="/plans/build_muscle/"]').first().getAttribute('href');
  await p.goto(BASE + href.replace(/^#?\/?/, '#/').replace('##', '#'), { waitUntil: 'networkidle' });
  await p.getByRole('button', { name: /Use this plan/i }).click();
  await p.waitForTimeout(1500);
});

await step('the plan is now the subject of the screen', async () => {
  await p.goto(BASE + '#/routines', { waitUntil: 'networkidle' });
  await p.waitForTimeout(900);
  const body = await p.locator('body').innerText();
  if (!/Week 1\/5/i.test(body)) throw new Error('expected the block header');
  if (!/sessions done/i.test(body)) throw new Error('expected adherence');
  if (!/SESSIONS IN THIS PLAN/i.test(body)) throw new Error('expected the plan sessions section');
  if (!/YOUR OWN ROUTINES/i.test(body)) throw new Error('expected standalone routines to be separated');
});

await step('each session says what it contains', async () => {
  const body = await p.locator('body').innerText();
  if (!/\d+ exercises · ~\d+ min/.test(body)) {
    throw new Error(`sessions should state contents, saw: ${body.replace(/\n/g,' | ').slice(0,400)}`);
  }
});
await p.screenshot({ path: 'e2e/shot-programme.png', fullPage: true });

await step('a hand-made routine lands under "your own", not in the plan', async () => {
  await p.getByRole('button', { name: 'New routine' }).click();
  await p.getByPlaceholder(/Lower A, Push/).fill('My own thing');
  await p.getByRole('button', { name: 'Create' }).click();
  await p.waitForTimeout(900);
  await p.goto(BASE + '#/routines', { waitUntil: 'networkidle' });
  await p.waitForTimeout(900);

  const sections = await p.locator('section').evaluateAll(els => els.map(e => e.innerText));
  const own = sections.find(t => /YOUR OWN ROUTINES/i.test(t)) ?? '';
  const inPlan = sections.find(t => /SESSIONS IN THIS PLAN/i.test(t)) ?? '';
  if (!/My own thing/.test(own)) throw new Error('the new routine should be under "your own"');
  if (/My own thing/.test(inPlan)) throw new Error('it must not appear as a plan session');
});

await step('a finished block offers the next one', async () => {
  // Age the plan so every session of all five weeks is behind us.
  await p.evaluate(async () => {
    const open = indexedDB.open('gymgo');
    const db = await new Promise((res, rej) => { open.onsuccess = () => res(open.result); open.onerror = () => rej(open.error); });
    const store = () => db.transaction('plans', 'readwrite').objectStore('plans');
    const all = await new Promise((res, rej) => { const r = store().getAll(); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
    const plan = all.find(x => x.completed_at === null);
    plan.started_at = new Date(Date.now() - 70 * 864e5).toISOString();
    await new Promise((res, rej) => { const r = store().put(plan); r.onsuccess = res; r.onerror = () => rej(r.error); });
  });
  await p.reload({ waitUntil: 'networkidle' });
  await p.waitForTimeout(1200);

  const body = await p.locator('body').innerText();
  if (!/This block is finished/i.test(body)) {
    throw new Error(`a block whose sessions are all past should offer the next one, saw: ${body.replace(/\n/g,' | ').slice(0,400)}`);
  }
});
await p.screenshot({ path: 'e2e/shot-block-finished.png', fullPage: true });

await step('starting the next block reuses the same sessions', async () => {
  const before = await p.locator('section').evaluateAll(els =>
    (els.map(e => e.innerText).find(t => /SESSIONS IN THIS PLAN/i.test(t)) ?? ''));

  await p.getByRole('button', { name: 'Start the next block' }).click();
  await p.waitForTimeout(1200);

  await p.goto(BASE + '#/routines', { waitUntil: 'networkidle' });
  await p.waitForTimeout(900);
  const body = await p.locator('body').innerText();
  if (!/\(block 2\)/i.test(body)) throw new Error(`expected the new block to be numbered, saw: ${body.replace(/\n/g,' | ').slice(0,300)}`);
  if (!/Week 1\/5/i.test(body)) throw new Error('the new block should start at week 1');

  const after = await p.locator('section').evaluateAll(els =>
    (els.map(e => e.innerText).find(t => /SESSIONS IN THIS PLAN/i.test(t)) ?? ''));
  // Same routines: new exercise ids would throw away the history the
  // progression engine reads to carry weights forward.
  if (after !== before) throw new Error('block two should run the same sessions');
});

await step('ending the block early stops it being the active plan', async () => {
  await p.getByRole('button', { name: /End this block early/i }).click();
  await p.getByRole('button', { name: 'End block' }).click();
  await p.waitForTimeout(1000);

  const body = await p.locator('body').innerText();
  if (!/No plan running/i.test(body)) {
    throw new Error(`the block should be closed, saw: ${body.replace(/\n/g,' | ').slice(0,300)}`);
  }

  // Train must stop advertising a block that is over.
  await p.goto(BASE + '#/', { waitUntil: 'networkidle' });
  await p.waitForTimeout(900);
  const train = await p.locator('body').innerText();
  if (/Week 1\/5/i.test(train)) throw new Error('Train still shows the closed block');
});

await step('the routines survive the block being closed', async () => {
  await p.goto(BASE + '#/routines', { waitUntil: 'networkidle' });
  await p.waitForTimeout(900);
  const body = await p.locator('body').innerText();
  if (!/My own thing/.test(body)) throw new Error('a hand-made routine must not vanish with the plan');
});

console.log(errs.length ? '\nBrowser errors:\n' + errs.join('\n') : '\nNo browser errors.');
await b.close();
process.exit(errs.length ? 1 : 0);
