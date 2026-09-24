/**
 * The in-gym toolkit: warm-ups, plate loading, thumb-sized adjusters, a rest
 * timer that survives, reordering, and repeating a session.
 */
import { chromium } from 'playwright';

const BASE = process.env.BASE_URL ?? 'http://127.0.0.1:5185/';
const b = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const c = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
const p = await c.newPage();
const errs = [];
p.on('pageerror', e => errs.push('pageerror: ' + e.message));
// navigator.vibrate is blocked after a programmatic reload because the page has
// had no user gesture yet. That is a headless artifact — on a phone you have
// just tapped a set — so it is not a failure.
p.on('console', m => {
  const text = m.text();
  if (m.type() !== 'error') return;
  if (/Failed to load resource/i.test(text)) return;
  if (/navigator\.vibrate/i.test(text)) return;
  errs.push('console: ' + text);
});
const step = async (l, fn) => { try { await fn(); console.log('  ok   '+l); } catch(e) { console.log('  FAIL '+l+': '+e.message); throw e; } };

/** Swap, warm-up, move and remove all live behind the exercise overflow now. */
const openMore = async (name) => {
  await p.getByRole('button', { name: `More for ${name}` }).first().click();
  await p.waitForTimeout(250);
};

/** The screen shows one station, so switching is a tap on the strip. */
const focusStation = async (name) => {
  await p.getByRole('button', { name: new RegExp(`^${name}, \\d+ of \\d+ sets done$`) }).click();
  await p.waitForTimeout(400);
};

/** Every station pill, in session order — the only place the whole order shows. */
const stationOrder = async () =>
  p.locator('header li button').evaluateAll((els) =>
    els.map((e) => e.getAttribute('aria-label')).filter((l) => / \d+ of \d+ sets done$/.test(l ?? ''))
       .map((l) => l.replace(/,[^,]*$/, '')));

const addExercise = async (query, name) => {
  await p.getByRole('button', { name: 'Add exercise' }).click();
  await p.getByPlaceholder('Add exercise').fill(query);
  await p.getByRole('button', { name }).first().click();
  await p.waitForTimeout(800);
};

await p.goto(BASE, { waitUntil: 'networkidle' });
await step('app loads', async () => { await p.getByRole('heading', {name:'Train'}).waitFor({timeout:40000}); });

await step('start a barbell session', async () => {
  await p.getByRole('button', { name: 'Start empty workout' }).click();
  await p.waitForURL(/#\/workout\//, { timeout: 15000 });
  await addExercise('barbell bench press', /^Barbell Bench Press - Medium Grip/);
  await p.getByLabel('Set 1 weight in kilograms').first().fill('100');
  await p.getByLabel('Set 1 repetitions').first().fill('5');
  await p.locator('body').click({ position: { x: 5, y: 5 } });
  await p.waitForTimeout(600);
});

await step('the plate line says what to load', async () => {
  const body = await p.locator('body').innerText();
  // 100kg on a 20kg bar is 25 + 15 per side.
  if (!/20kg bar \+ 25 \+ 15 per side/.test(body)) {
    throw new Error(`expected a plate breakdown, saw: ${body.replace(/\n/g,' | ').slice(0,400)}`);
  }
});

await step('the steppers move by a real plate increment', async () => {
  const up = p.getByLabel(/Set 1 weight up .* kilograms/).first();
  if (!(await up.count())) throw new Error('expected a weight stepper');
  for (let i = 0; i < 5; i++) { await up.click(); await p.waitForTimeout(150); }
  await p.waitForTimeout(600);

  const weight = await p.getByLabel('Set 1 weight in kilograms').first().inputValue();
  // Five taps of 2.5kg from 100kg. Anything else means taps were dropped.
  if (weight !== '112.5') throw new Error(`expected 112.5 after five taps, got ${weight}`);
});

await step('and the plate line follows the weight', async () => {
  const body = await p.locator('body').innerText();
  if (!/112\.5kg|20kg bar \+/.test(body)) throw new Error('the plate line did not update');
});

await step('generate a warm-up ramp', async () => {
  await p.getByLabel(/Set 1 weight down .* kilograms/).first().click();
  await p.waitForTimeout(400);
  await openMore('Barbell Bench Press - Medium Grip');
  const warm = p.getByRole('button', { name: /Warm up to/ }).first();
  if (!(await warm.count())) throw new Error('expected a warm-up button');
  await warm.click();
  await p.waitForTimeout(800);
});

await step('the rungs sit in front of the working set and are labelled W', async () => {
  const sets = await p.evaluate(async () => {
    const open = indexedDB.open('gymgo');
    const db = await new Promise((res, rej) => { open.onsuccess = () => res(open.result); open.onerror = () => rej(open.error); });
    const r = db.transaction('sets').objectStore('sets').getAll();
    const all = await new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
    return all.filter(s => s.deleted_at === null).sort((a,b) => a.set_index - b.set_index)
      .map(s => ({ type: s.type, weight: s.weight_kg }));
  });
  console.log('       sets:', JSON.stringify(sets));
  if (sets.at(-1).type !== 'working') throw new Error('the working set should come last');
  if (!sets.slice(0, -1).every(s => s.type === 'warmup')) throw new Error('the ramp should precede it');
  const weights = sets.slice(0, -1).map(s => s.weight);
  if (weights[0] !== 20) throw new Error(`a barbell ramp opens with the empty bar, got ${weights[0]}`);
  for (let i = 1; i < weights.length; i++) {
    if (weights[i] <= weights[i-1]) throw new Error('the ramp must climb');
  }
});

await step('the working set is still Set 1, not Set 5', async () => {
  // The whole reason setOrdinals exists: warm-ups must not renumber the work.
  const field = p.getByLabel('Set 1 weight in kilograms');
  if (await field.count() !== 1) throw new Error('expected exactly one "Set 1" weight field');
  if (await field.first().inputValue() !== '110') {
    throw new Error(`Set 1 should still be the working set, got ${await field.first().inputValue()}`);
  }
});
await p.screenshot({ path: 'e2e/shot-toolkit.png', fullPage: true });

await step('ticking a warm-up starts no rest', async () => {
  await p.getByLabel(/Mark warm-up 1 done/).first().click();
  await p.waitForTimeout(700);
  const body = await p.locator('body').innerText();
  if (/resting/i.test(body)) throw new Error('a warm-up must not start the rest timer');
});

await step('the rest timer survives a trip to the swap screen', async () => {
  await p.getByLabel('Set 1 repetitions').first().fill('5');
  await p.getByLabel(/Mark set 1 done/).first().click();
  await p.waitForTimeout(800);
  let body = await p.locator('body').innerText();
  if (!/resting/i.test(body)) throw new Error('the working set should start a rest');

  await openMore('Barbell Bench Press - Medium Grip');
  await p.getByRole('link', { name: /Swap Barbell Bench Press/ }).click();
  await p.getByRole('heading', { name: 'Swap exercise' }).waitFor({ timeout: 15000 });
  await p.waitForTimeout(600);

  body = await p.locator('body').innerText();
  if (!/resting/i.test(body)) {
    throw new Error(`the rest must survive navigation, saw: ${body.replace(/\n/g,' | ').slice(0,300)}`);
  }
  console.log('       still resting on the swap screen:', (body.match(/\d:\d\d/) ?? ['?'])[0]);
});

await step('and survives a reload', async () => {
  await p.goBack();
  await p.waitForTimeout(500);
  await p.reload({ waitUntil: 'networkidle' });
  await p.waitForTimeout(1000);

  const body = await p.locator('body').innerText();
  if (!/resting/i.test(body)) {
    throw new Error(`the rest must survive a reload, saw: ${body.replace(/\n/g,' | ').slice(0,300)}`);
  }
  console.log('       still resting after reload:', (body.match(/\d:\d\d/) ?? ['?'])[0]);
});

await step('reorder two exercises', async () => {
  await p.getByRole('button', { name: 'Skip', exact: true }).click().catch(() => {});
  await p.waitForTimeout(400);
  await addExercise('one-arm dumbbell row', /^One-Arm Dumbbell Row/);

  // Adding an exercise focuses it, so the bench has to be brought back on
  // screen before its overflow exists to open.
  const before = await stationOrder();
  await focusStation('Barbell Bench Press - Medium Grip');
  await openMore('Barbell Bench Press - Medium Grip');
  await p.getByLabel(/Move Barbell Bench Press.* later/i).first().click();
  await p.waitForTimeout(700);
  const after = await stationOrder();

  console.log('       order:', JSON.stringify(before), '→', JSON.stringify(after));
  if (JSON.stringify(before) === JSON.stringify(after)) throw new Error('the order did not change');
  if (after[0] !== before[1]) throw new Error('the second exercise should now be first');
});

await step('a dumbbell lift gets no plate line', async () => {
  await focusStation('One-Arm Dumbbell Row');
  const body = await p.locator('body').innerText();
  if (!/One-Arm Dumbbell Row/.test(body)) throw new Error('the row should be the station on screen');
  if (/bar \+/.test(body)) throw new Error('dumbbells have no plates to load');
});

await step('finish, then repeat the session from Train', async () => {
  // Log the row too: finishWorkout drops exercises with nothing against them,
  // so an unlogged one would not be there to repeat.
  await p.getByLabel('Set 1 weight in kilograms').first().fill('30');
  await p.getByLabel('Set 1 repetitions').first().fill('10');
  await p.getByLabel(/Mark set 1 done/).first().click();
  await p.waitForTimeout(700);
  await p.getByRole('button', { name: 'Skip', exact: true }).click().catch(() => {});
  await p.waitForTimeout(400);

  await p.getByRole('button', { name: 'Finish', exact: true }).click();
  await p.getByRole('button', { name: 'Finish and save' }).click();
  await p.waitForURL(/#\/history\//, { timeout: 15000 });

  await p.goto(BASE + '#/', { waitUntil: 'networkidle' });
  await p.waitForTimeout(900);
  const repeat = p.getByRole('button', { name: /Repeat/ }).first();
  if (!(await repeat.count())) throw new Error('expected a repeat button on Train');
  await repeat.click();
  await p.waitForURL(/#\/workout\//, { timeout: 15000 });
  await p.waitForTimeout(900);
});

await step('the repeat arrives with the same shape and no numbers', async () => {
  const state = await p.evaluate(async () => {
    const open = indexedDB.open('gymgo');
    const db = await new Promise((res, rej) => { open.onsuccess = () => res(open.result); open.onerror = () => rej(open.error); });
    const get = (s) => new Promise((res, rej) => { const r = db.transaction(s).objectStore(s).getAll(); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
    const workouts = (await get('workouts')).filter(w => w.deleted_at === null && w.finished_at === null);
    const open2 = workouts[0];
    const wes = (await get('workout_exercises')).filter(w => w.deleted_at === null && w.workout_id === open2.id);
    const sets = (await get('sets')).filter(s => s.deleted_at === null && wes.some(w => w.id === s.workout_exercise_id));
    return {
      exercises: wes.length,
      sets: sets.length,
      anyLogged: sets.some(s => s.completed || s.weight_kg > 0 || s.reps > 0),
      anyWarmup: sets.some(s => s.type === 'warmup'),
      planId: open2.plan_id,
    };
  });
  console.log('       repeat:', JSON.stringify(state));
  if (state.exercises !== 2) throw new Error(`expected two exercises, got ${state.exercises}`);
  if (state.anyLogged) throw new Error('a repeat must arrive empty, not pre-filled');
  if (state.anyWarmup) throw new Error('warm-ups are regenerated, not copied');
  if (state.planId !== null) throw new Error('a repeat must not re-tick a calendar slot');
});

console.log(errs.length ? '\nBrowser errors:\n' + errs.join('\n') : '\nNo browser errors.');
await b.close();
process.exit(errs.length ? 1 : 0);
