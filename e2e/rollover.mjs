/**
 * Missed workouts roll forward. A plan started over a week ago with nothing
 * trained must offer its first session today, say it moved, and — once that
 * session is trained — put the next one on the following day, not today.
 */
import { chromium } from 'playwright';

const BASE = process.env.BASE_URL ?? 'http://127.0.0.1:5185/';
const b = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const c = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
const p = await c.newPage();
const errs = [];
p.on('pageerror', e => errs.push('pageerror: ' + e.message));
p.on('console', m => { if (m.type() === 'error' && !/Failed to load resource|navigator\.vibrate/i.test(m.text())) errs.push('console: ' + m.text()); });
const step = async (l, fn) => { try { await fn(); console.log('  ok   ' + l); } catch (e) { console.log('  FAIL ' + l + ': ' + e.message); throw e; } };

const readDb = () => p.evaluate(async () => {
  const open = indexedDB.open('gymgo');
  const db = await new Promise((res, rej) => { open.onsuccess = () => res(open.result); open.onerror = () => rej(open.error); });
  const getAll = (name) => new Promise((res, rej) => { const r = db.transaction(name).objectStore(name).getAll(); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
  const [plans, routines, workouts] = await Promise.all([getAll('plans'), getAll('routines'), getAll('workouts')]);
  const plan = plans.find(x => x.completed_at === null && x.deleted_at === null);
  const names = plan.routine_ids.map(id => (routines.find(r => r.id === id)?.name ?? '').split(' — ').at(-1));
  return { plan, names, workouts: workouts.filter(w => w.deleted_at === null && w.plan_id === plan.id) };
});

await p.goto(BASE, { waitUntil: 'networkidle' });
await step('app loads', async () => { await p.getByRole('heading', { name: 'Train' }).waitFor({ timeout: 40000 }); });

await step('build a plan', async () => {
  await p.goto(BASE + '#/plans/build_muscle', { waitUntil: 'networkidle' });
  await p.waitForTimeout(700);
  const href = await p.locator('a[href*="/plans/build_muscle/"]').first().getAttribute('href');
  await p.goto(BASE + href.replace(/^#?\/?/, '#/').replace('##', '#'), { waitUntil: 'networkidle' });
  await p.getByRole('button', { name: /Use this plan/i }).click();
  await p.waitForTimeout(1500);
});

await step('start the block over a week ago and train nothing', async () => {
  await p.evaluate(async () => {
    const open = indexedDB.open('gymgo');
    const db = await new Promise((res, rej) => { open.onsuccess = () => res(open.result); open.onerror = () => rej(open.error); });
    const store = () => db.transaction('plans', 'readwrite').objectStore('plans');
    const all = await new Promise((res, rej) => { const r = store().getAll(); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
    const plan = all.find(x => x.completed_at === null);
    // Back to a day that is the plan's first training day, 7-13 days ago, so
    // week 1 is whole and its first session is both the earliest and missed.
    const first = [...plan.training_days].sort((a, b) => a - b)[0];
    let start = new Date(Date.now() - 7 * 864e5);
    while (start.getDay() !== first) start = new Date(start.getTime() - 864e5);
    plan.started_at = start.toISOString();
    await new Promise((res, rej) => { const r = store().put(plan); r.onsuccess = res; r.onerror = () => rej(r.error); });
  });
  // A write straight to IndexedDB is invisible to Dexie's live queries in this
  // tab, and a hash change is not a reload — so reload for real.
  await p.goto(BASE + '#/', { waitUntil: 'networkidle' });
  await p.reload({ waitUntil: 'networkidle' });
  await p.waitForTimeout(1200);
});

let firstName = '';
await step('the first session is offered today and says it moved', async () => {
  const { names } = await readDb();
  firstName = names[0];
  const body = await p.locator('body').innerText();
  if (!/today's workout/i.test(body)) throw new Error(`expected a session today, saw: ${body.replace(/\n/g, ' | ').slice(0, 400)}`);
  if (!/moved from/i.test(body)) throw new Error('a rolled session should say where it moved from');
  const hero = await p.locator('h2').first().innerText();
  if (hero.trim() !== firstName) throw new Error(`expected week 1's first session (${firstName}) today, got ${hero}`);
  if (/missed/i.test(body)) throw new Error('nothing should be reported as missed any more');
});

await step('training it ticks off the slot it rolled from', async () => {
  await p.getByRole('button', { name: 'Start workout', exact: true }).click();
  await p.waitForURL(/#\/workout\//, { timeout: 15000 });
  await p.getByLabel('Set 1 weight in kilograms').first().fill('40');
  await p.getByLabel('Set 1 repetitions').first().fill('8');
  await p.getByLabel(/Mark set 1 done/).first().click();
  await p.waitForTimeout(400);
  await p.getByRole('button', { name: 'Finish', exact: true }).click();
  await p.getByRole('button', { name: 'Finish and save' }).click();
  await p.waitForURL(/#\/history\//, { timeout: 15000 });

  const { workouts } = await readDb();
  const trained = workouts.find(w => w.finished_at);
  if (!trained) throw new Error('the workout was not saved against the plan');
  if (trained.plan_week !== 1 || trained.plan_session_index !== 0) {
    throw new Error(`expected week 1 session 0, got week ${trained.plan_week} session ${trained.plan_session_index}`);
  }
});

await step('the next session waits for tomorrow', async () => {
  await p.goto(BASE + '#/', { waitUntil: 'networkidle' });
  await p.waitForTimeout(1000);
  const { names } = await readDb();
  const body = await p.locator('body').innerText();
  if (/today's workout/i.test(body)) throw new Error('one session a day: nothing else should be offered today');
  if (!/Next · Tomorrow/i.test(body)) throw new Error(`the next session should be tomorrow, saw: ${body.replace(/\n/g, ' | ').slice(0, 400)}`);
  const hero = await p.locator('h2').first().innerText();
  if (hero.trim() !== names[1]) throw new Error(`expected ${names[1]} next, got ${hero}`);
});

await step('the week strip shows today as done', async () => {
  const today = await p.locator('ul li button[aria-current="date"]').getAttribute('aria-label');
  if (!/done/.test(today ?? '')) throw new Error(`today's day should read done, got: ${today}`);
});

console.log(errs.length ? '\nBrowser errors:\n' + errs.join('\n') : '\nNo browser errors.');
await b.close();
process.exit(errs.length ? 1 : 0);
