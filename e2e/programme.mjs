/**
 * The Plan tab: the plan as the primary object, and a block that can
 * actually end.
 *
 * Headings and list titles are display type, upper-cased by CSS, and
 * innerText sees the capitals — text checks here match without case.
 */
import { launchChromium } from './browser.mjs';

const BASE = process.env.BASE_URL ?? 'http://127.0.0.1:5185/';
const b = await launchChromium();
const c = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
const p = await c.newPage();
const errs = [];
p.on('pageerror', e => errs.push('pageerror: ' + e.message));
p.on('console', m => { if (m.type()==='error' && !/Failed to load resource/i.test(m.text())) errs.push('console: '+m.text()); });
const step = async (l, fn) => { try { await fn(); console.log('  ok   '+l); } catch(e) { console.log('  FAIL '+l+': '+e.message); throw e; } };

await p.goto(BASE, { waitUntil: 'networkidle' });
await step('app loads', async () => { await p.getByRole('heading', {name:'Today'}).waitFor({timeout:40000}); });

await step('three tabs: Today, Plan, Progress', async () => {
  // textContent, not innerText: the tab labels are upper-cased by CSS.
  const tabs = (await p.locator('nav a').allTextContents()).map(t => t.trim());
  if (tabs.join('|') !== 'Today|Plan|Progress') throw new Error(`expected Today, Plan, Progress, saw: ${tabs.join(' | ')}`);
});

await step('with no plan it says so and points at the builder', async () => {
  await p.getByRole('link', { name: 'Plan', exact: true }).click();
  await p.getByRole('heading', { name: 'Plan', exact: true }).waitFor({ timeout: 15000 });
  const body = await p.locator('body').innerText();
  if (!/No plan running/i.test(body)) throw new Error('expected the empty state');
  if (!/Pick a plan/i.test(body)) throw new Error('expected a route into Plans');
});

await step('build a plan', async () => {
  await p.goto(BASE + '#/plan/new/build_muscle', { waitUntil: 'networkidle' });
  await p.waitForTimeout(700);
  const href = await p.locator('a[href*="/plan/new/build_muscle/"]').first().getAttribute('href');
  await p.goto(BASE + href.replace(/^#?\/?/, '#/').replace('##', '#'), { waitUntil: 'networkidle' });
  await p.getByRole('button', { name: /Use this plan/i }).click();
  await p.waitForTimeout(1500);
});

await step('the plan is now the subject of the screen', async () => {
  await p.goto(BASE + '#/plan', { waitUntil: 'networkidle' });
  await p.waitForTimeout(900);
  const body = await p.locator('body').innerText();
  if (!/Week 1 of 5/i.test(body)) throw new Error('expected the block header');
  if (!/sessions done/i.test(body)) throw new Error('expected adherence');
  if (!/SESSIONS IN THIS PLAN/i.test(body)) throw new Error('expected the plan sessions section');
  if (!/YOUR OWN ROUTINES/i.test(body)) throw new Error('expected standalone routines to be separated');
});

await step('each session says what it contains', async () => {
  const body = await p.locator('body').innerText();
  if (!/\d+ exercises · about \d+ min/.test(body)) {
    throw new Error(`sessions should state contents, saw: ${body.replace(/\n/g,' | ').slice(0,400)}`);
  }
});
await p.screenshot({ path: 'e2e/shot-programme.png', fullPage: true });

await step('a hand-made routine lands under "your own", not in the plan', async () => {
  await p.getByRole('button', { name: 'New routine' }).click();
  await p.getByPlaceholder(/Lower A, Push/).fill('My own thing');
  await p.getByRole('button', { name: 'Create' }).click();
  await p.waitForTimeout(900);
  await p.goto(BASE + '#/plan', { waitUntil: 'networkidle' });
  await p.waitForTimeout(900);

  const sections = await p.locator('section').evaluateAll(els => els.map(e => e.innerText));
  const own = sections.find(t => /YOUR OWN ROUTINES/i.test(t)) ?? '';
  const inPlan = sections.find(t => /SESSIONS IN THIS PLAN/i.test(t)) ?? '';
  if (!/My own thing/i.test(own)) throw new Error('the new routine should be under "your own"');
  if (/My own thing/i.test(inPlan)) throw new Error('it must not appear as a plan session');
});

await step('an old block with nothing trained waits for you', async () => {
  // Age the plan so every session of all five weeks is behind us. Nothing was
  // trained, so nothing is finished: the first session has rolled onto today.
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
  if (/This block is finished/i.test(body)) throw new Error('a block with nothing trained must not finish on the calendar');
  if (!/Week 1 of 5/i.test(body)) throw new Error(`the block should still be on week 1, saw: ${body.replace(/\n/g,' | ').slice(0,300)}`);
});

await step('a finished block offers the next one', async () => {
  // Train every session of the block, then it is finished.
  await p.evaluate(async () => {
    const open = indexedDB.open('gymgo');
    const db = await new Promise((res, rej) => { open.onsuccess = () => res(open.result); open.onerror = () => rej(open.error); });
    const getAll = (name) => new Promise((res, rej) => { const r = db.transaction(name).objectStore(name).getAll(); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
    const plan = (await getAll('plans')).find(x => x.completed_at === null);
    const put = (row) => new Promise((res, rej) => { const r = db.transaction('workouts', 'readwrite').objectStore('workouts').put(row); r.onsuccess = res; r.onerror = () => rej(r.error); });
    const when = new Date(Date.now() - 864e5).toISOString();
    for (let week = 1; week <= plan.block_weeks; week += 1) {
      for (let index = 0; index < plan.training_days.length; index += 1) {
        await put({
          id: crypto.randomUUID(), routine_id: plan.routine_ids[index] ?? null, plan_id: plan.id,
          plan_week: week, plan_session_index: index, gym_id: null,
          started_at: when, finished_at: when, bodyweight_kg: null, readiness: null, notes: null,
          user_id: null, created_at: when, updated_at: when, deleted_at: null,
        });
      }
    }
  });
  await p.reload({ waitUntil: 'networkidle' });
  await p.waitForTimeout(1200);

  const body = await p.locator('body').innerText();
  if (!/This block is finished/i.test(body)) {
    throw new Error(`a block whose sessions are all trained should offer the next one, saw: ${body.replace(/\n/g,' | ').slice(0,400)}`);
  }
});
await p.screenshot({ path: 'e2e/shot-block-finished.png', fullPage: true });

await step('starting the next block reuses the same sessions', async () => {
  const before = await p.locator('section').evaluateAll(els =>
    (els.map(e => e.innerText).find(t => /SESSIONS IN THIS PLAN/i.test(t)) ?? ''));

  await p.getByRole('button', { name: 'Start the next block' }).click();
  await p.waitForTimeout(1200);

  await p.goto(BASE + '#/plan', { waitUntil: 'networkidle' });
  await p.waitForTimeout(900);
  const body = await p.locator('body').innerText();
  if (!/\(block 2\)/i.test(body)) throw new Error(`expected the new block to be numbered, saw: ${body.replace(/\n/g,' | ').slice(0,300)}`);
  if (!/Week 1 of 5/i.test(body)) throw new Error('the new block should start at week 1');

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

  // Today must stop advertising a block that is over.
  await p.goto(BASE + '#/', { waitUntil: 'networkidle' });
  await p.waitForTimeout(900);
  const today = await p.locator('body').innerText();
  if (/week \d+ \/ \d+/i.test(today)) throw new Error('Today still shows the closed block');
  if (!/No plan yet/i.test(today)) throw new Error('Today should offer to build a plan');
});

await step('the routines survive the block being closed', async () => {
  await p.goto(BASE + '#/plan', { waitUntil: 'networkidle' });
  await p.waitForTimeout(900);
  const body = await p.locator('body').innerText();
  if (!/My own thing/i.test(body)) throw new Error('a hand-made routine must not vanish with the plan');
});

console.log(errs.length ? '\nBrowser errors:\n' + errs.join('\n') : '\nNo browser errors.');
await b.close();
process.exit(errs.length ? 1 : 0);
