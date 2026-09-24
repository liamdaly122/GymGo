/**
 * Swapping an exercise mid-session, including the case that matters: work
 * already logged stays on the lift that produced it.
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

/** Swap, warm-up, move and remove all live behind the exercise overflow now. */
const openMore = async (page, name) => {
  await page.getByRole('button', { name: `More for ${name}` }).first().click();
};

await p.goto(BASE, { waitUntil: 'networkidle' });
await step('app loads', async () => { await p.getByRole('heading', {name:'Train'}).waitFor({timeout:40000}); });

await step('start a session with bench press', async () => {
  await p.getByRole('button', { name: 'Start empty workout' }).click();
  await p.getByRole('button', { name: 'Add exercise' }).click();
  await p.getByPlaceholder('Add exercise').fill('barbell bench press');
  await p.getByRole('button', { name: /^Barbell Bench Press - Medium Grip/ }).first().click();
  await p.getByLabel('Set 1 weight in kilograms').first().waitFor({ timeout: 20000 });
});

await step('swap with nothing logged replaces cleanly', async () => {
  await openMore(p, 'Barbell Bench Press - Medium Grip');
  await p.getByRole('link', { name: /Swap Barbell Bench Press/ }).click();
  await p.getByRole('heading', { name: 'Swap exercise' }).waitFor({ timeout: 15000 });
  await p.waitForTimeout(700);
  const body = await p.locator('body').innerText();
  if (!/DIRECT SWAPS/i.test(body)) throw new Error('expected a direct swaps section');
  if (!/ALTERNATIVES/i.test(body)) throw new Error('expected an alternatives section');
  if (/already logged/i.test(body)) throw new Error('nothing is logged, so there should be no warning');
  await p.getByRole('button', { name: /Dumbbell Bench Press/ }).first().click();
  await p.getByRole('button', { name: 'Add exercise' }).waitFor({ timeout: 15000 });
  await p.waitForTimeout(500);
  const after = await p.locator('body').innerText();
  if (/Barbell Bench Press/.test(after)) throw new Error('the original should have been replaced');
  if (!/Dumbbell Bench Press/.test(after)) throw new Error('the replacement is missing');
});

await step('log two sets on the replacement', async () => {
  // A freestyle exercise opens with a single row; add the second.
  await p.getByRole('button', { name: 'Add set' }).first().click();
  await p.waitForTimeout(400);
  for (const s of [1, 2]) {
    await p.getByLabel(`Set ${s} weight in kilograms`).first().fill('40');
    await p.getByLabel(`Set ${s} repetitions`).first().fill('10');
    await p.getByLabel(new RegExp(`Mark set ${s} done`)).first().click();
    await p.waitForTimeout(200);
    const skip = p.getByRole('button', { name: 'Skip', exact: true });
    if (await skip.count()) await skip.click();
  }
});

await step('swapping now warns that logged sets stay put', async () => {
  await openMore(p, 'Dumbbell Bench Press');
  await p.getByRole('link', { name: /Swap Dumbbell Bench Press/ }).click();
  await p.getByRole('heading', { name: 'Swap exercise' }).waitFor({ timeout: 15000 });
  await p.waitForTimeout(600);
  const body = await p.locator('body').innerText();
  if (!/2 sets already logged/i.test(body)) throw new Error(`expected the logged-sets notice, saw: ${body.replace(/\n/g,' | ').slice(0,300)}`);
});
await p.screenshot({ path: 'e2e/shot-swap.png' });

await step('the logged sets stay on the exercise that produced them', async () => {
  await p.getByRole('button', { name: /Incline Dumbbell Press/ }).first().click();
  await p.getByRole('button', { name: 'Add exercise' }).waitFor({ timeout: 15000 });
  await p.waitForTimeout(700);

  const state = await p.evaluate(async () => {
    const open = indexedDB.open('gymgo');
    const db = await new Promise((res, rej) => { open.onsuccess = () => res(open.result); open.onerror = () => rej(open.error); });
    const get = (s) => new Promise((res, rej) => { const r = db.transaction(s).objectStore(s).getAll(); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
    const [wes, sets, exercises] = await Promise.all([get('workout_exercises'), get('sets'), get('exercises')]);
    const byId = new Map(exercises.map(e => [e.id, e.name]));
    return wes.filter(w => w.deleted_at === null).sort((a,b) => a.position - b.position).map(w => ({
      name: byId.get(w.exercise_id),
      logged: sets.filter(s => s.workout_exercise_id === w.id && s.deleted_at === null && s.completed)
                  .map(s => `${s.weight_kg}x${s.reps}`),
    }));
  });
  console.log('       session now:', JSON.stringify(state));

  if (state.length !== 2) throw new Error(`expected two exercises in the session, got ${state.length}`);
  if (state[0].name !== 'Dumbbell Bench Press') throw new Error(`first row should still be the dumbbell press, got ${state[0].name}`);
  if (state[0].logged.length !== 2) throw new Error('the two logged sets should have stayed on the original');
  if (state[1].logged.length !== 0) throw new Error('the replacement should carry no logged sets');
});

console.log(errs.length ? '\nBrowser errors:\n' + errs.join('\n') : '\nNo browser errors.');
await b.close();
process.exit(errs.length ? 1 : 0);
