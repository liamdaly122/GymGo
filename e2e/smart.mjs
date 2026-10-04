/**
 * Drives the smart layer: build a plan, see it on the calendar, log week 1,
 * and confirm the progression engine suggests the next jump.
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
await step('app loads', async () => { await p.getByRole('heading', {name:'Today'}).waitFor({timeout:40000}); });

await step('build a 3-day plan', async () => {
  await p.getByRole('link', { name: 'Plan', exact: true }).click();
  await p.getByRole('button', { name: 'Build a new plan' }).click();
  await p.getByRole('link', { name: /Build muscle/ }).click();
  await p.getByRole('button', { name: '3', exact: true }).click();
  await p.waitForTimeout(600);
  await p.getByRole('link', { name: /Push \/ Pull \/ Legs/ }).click();
  await p.getByRole('button', { name: /Use this plan/ }).waitFor({ timeout: 20000 });
  await p.getByRole('button', { name: /Use this plan/ }).click();
  await p.getByRole('heading', { name: 'Plan', exact: true }).waitFor({ timeout: 20000 });
  await p.waitForTimeout(800);
});

const strip = 'ol[aria-label="This week"] li button';

await step('the block appears on Today', async () => {
  await p.getByRole('link', { name: 'Today', exact: true }).click();
  await p.getByRole('heading', { name: 'Today' }).waitFor();
  await p.waitForTimeout(1000);
  // The kicker is display type, upper-cased by CSS.
  const body = await p.locator('body').innerText();
  if (!/week 1 \/ 5 · Foundations/i.test(body)) throw new Error(`expected the week label, saw: ${body.replace(/\n/g,' | ').slice(0,400)}`);
  if (!/\d+ exercises/.test(body)) throw new Error('expected the session contents');
  if (!/about \d+ min/.test(body)) throw new Error('expected a duration estimate');
});

await step('the week strip shows a full week with training days marked', async () => {
  const dots = await p.locator(strip).count();
  if (dots !== 7) throw new Error(`expected a 7 day strip, got ${dots}`);
  // A scheduled day is labelled "<weekday> <date>, <session>, <status>";
  // everything else is a rest day.
  // At most the plan's three days. It can be none: a plan created on a Sunday
  // starts on Monday, and a Monday-to-Sunday strip has nothing left in it.
  const rest = await p.locator(`${strip}[aria-label*="rest day"]`).count();
  if (7 - rest > 3) throw new Error(`expected at most 3 training days this week, got ${7 - rest}`);
  // Every training day goes somewhere — a planned day opens its session — and
  // a rest day is not a button with nowhere to go.
  const live = await p.locator(`${strip}:not([disabled])`).count();
  if (live !== 7 - rest) throw new Error(`expected each of the ${7 - rest} training days to be tappable, ${live} were`);
  const deadRest = await p.locator(`${strip}[aria-label*="rest day"]:not([disabled])`).count();
  if (deadRest !== 0) throw new Error(`${deadRest} rest day(s) were tappable`);
});

await step('a plan created today has nothing moved', async () => {
  // Nothing can be missed any more — a skipped session rolls forward — so on
  // day one nothing has rolled yet.
  const moved = await p.locator(`${strip}[aria-label*="moved"]`).count();
  if (moved !== 0) throw new Error(`a brand new plan showed ${moved} moved session(s)`);
  const body = await p.locator('body').innerText();
  if (/Moved from/i.test(body)) throw new Error('a brand new plan said a session had moved');
});
await p.screenshot({ path: 'e2e/shot-train.png' });

// Remember which routine the calendar offered, so the second run is the SAME
// session — the Routines list is alphabetical and would hand back a different one.
let plannedRoutineHref = '';
await step('start the planned session and log it', async () => {
  // "Start Push A", or "Start early: Push A" when the block starts tomorrow.
  await p.getByRole('region', { name: 'Next session' }).getByRole('button', { name: /^Start/ }).click();
  await p.getByLabel('Set 1 weight in kilograms').first().waitFor({ timeout: 20000 });
  // Log every set of the first exercise at the top of the rep range. One set
  // is in hand at a time, and each Done brings up the next until the station
  // is finished.
  let logged = 0;
  for (let i = 1; i <= 6; i++) {
    const field = p.getByLabel(`Set ${i} weight in kilograms`);
    if (!(await field.count())) break;
    await field.fill('100');
    await p.getByLabel(`Set ${i} repetitions`).fill('10');
    await p.getByLabel(new RegExp(`Mark set ${i} done`)).click();
    await p.waitForTimeout(300);
    const skip = p.getByRole('button', { name: 'Skip rest' });
    if (await skip.count()) await skip.click();
    await p.waitForTimeout(200);
    logged = i;
  }
  if (logged < 2) throw new Error(`expected the plan's sets to come up one after another, logged ${logged}`);
  plannedRoutineHref = await p.evaluate(async () => {
    const open = indexedDB.open('gymgo');
    const db = await new Promise((res, rej) => { open.onsuccess = () => res(open.result); open.onerror = () => rej(open.error); });
    const get = (s) => new Promise((res, rej) => { const r = db.transaction(s).objectStore(s).getAll(); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
    const workouts = await get('workouts');
    const live = workouts.filter(w => w.deleted_at === null && w.finished_at === null);
    return live.length ? live[live.length - 1].routine_id : '';
  });
  await p.getByRole('button', { name: 'Finish', exact: true }).click();
  await p.getByRole('button', { name: 'Finish and save' }).click();
  await p.waitForTimeout(1000);
});

await step('the calendar marks that session done', async () => {
  await p.goto(BASE, { waitUntil: 'networkidle' });
  await p.waitForTimeout(1200);
  const done = p.locator(`${strip}[aria-label*=", done"]`);
  if (await done.count() !== 1) throw new Error(`expected the trained day marked done in the strip, got ${await done.count()}`);
  const body = await p.locator('body').innerText();
  if (!/done today/i.test(body)) throw new Error(`expected today's session at the top of Today, saw: ${body.replace(/\n/g,' | ').slice(0,300)}`);
  if (/-\d+ days ago/.test(body)) throw new Error('a future session rendered as a negative day count');

  // The day you trained opens what you logged.
  await done.first().click();
  await p.waitForURL(/#\/history\//, { timeout: 15000 });
  await p.goBack();
  await p.waitForTimeout(800);

  // Block progress lives on Plan. Total depends on which weekday the block was
  // created; only the count of completed sessions is fixed.
  await p.goto(`${BASE}#/plan`, { waitUntil: 'networkidle' });
  await p.waitForTimeout(800);
  const plan = await p.locator('body').innerText();
  if (!/1 of \d+ sessions done/.test(plan)) throw new Error(`expected block progress, saw: ${plan.replace(/\n/g,' | ').slice(0,300)}`);
});

await step('the progression engine suggests the next jump', async () => {
  // The SAME routine again: every set hit the top of the range, so it should add weight.
  if (!plannedRoutineHref) throw new Error('did not capture the routine that was logged');
  await p.goto(`${BASE}#/routines/${plannedRoutineHref}`, { waitUntil: 'networkidle' });
  await p.getByRole('button', { name: /^Start / }).waitFor({ timeout: 15000 });
  await p.getByRole('button', { name: /^Start / }).click();
  await p.waitForTimeout(1500);

  // The suggestion is a placeholder in the row, not a card above it — that is
  // what the brief specifies, and it is the number the lifter actually reads.
  const weightField = p.getByLabel('Set 1 weight in kilograms').first();
  const suggested = Number(await weightField.getAttribute('placeholder'));
  const suggestedReps = Number(await p.getByLabel('Set 1 repetitions').first().getAttribute('placeholder'));
  if (!suggested) throw new Error('the set row carried no suggested weight');
  if (suggested <= 100) throw new Error(`suggestion did not go up: ${suggested}kg after logging 100kg`);
  if (!suggestedReps) throw new Error('the set row carried no suggested reps');

  // Nothing has been written for the lifter — a placeholder is a hint, not a log.
  if (await weightField.inputValue() !== '') throw new Error('the suggestion must not pre-fill the field');

  const body = await p.locator('body').innerText();
  if (!/go up/i.test(body)) throw new Error(`expected the plan line to say what to do, saw: ${body.replace(/\n/g,' | ').slice(0,500)}`);
  if (!/hit 10 on every set/i.test(body)) throw new Error(`expected the reason to explain itself, saw: ${body.replace(/\n/g,' | ').slice(0,500)}`);

  // The reason must not claim a jump the number does not show.
  const claimed = /Add ([\d.]+)kg/.exec(body);
  if (claimed && suggested - 100 !== Number(claimed[1])) {
    throw new Error(`reason claims +${claimed[1]}kg but suggests ${suggested}kg`);
  }

  // Taking the suggestion is one tap: Done logs the numbers on screen, and
  // with nothing typed those are the suggestion.
  await p.getByLabel(/Mark set 1 done/).click();
  await p.waitForTimeout(600);
  const workoutId = new URL(p.url()).hash.split('/')[2];
  const set1 = await p.evaluate(async (id) => {
    const open = indexedDB.open('gymgo');
    const db = await new Promise((res, rej) => { open.onsuccess = () => res(open.result); open.onerror = () => rej(open.error); });
    const get = (s) => new Promise((res, rej) => { const r = db.transaction(s).objectStore(s).getAll(); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
    const [wes, sets] = await Promise.all([get('workout_exercises'), get('sets')]);
    const first = wes.filter(w => w.workout_id === id && w.deleted_at === null).sort((a, b) => a.position - b.position)[0];
    const done = sets.filter(x => x.workout_exercise_id === first.id && x.completed && x.deleted_at === null);
    return done.map(x => ({ weight: x.weight_kg, reps: x.reps }));
  }, workoutId);
  if (set1.length !== 1 || set1[0].weight !== suggested || set1[0].reps !== suggestedReps) {
    throw new Error(`Done should have logged ${suggested}kg × ${suggestedReps}, logged ${JSON.stringify(set1)}`);
  }
});
await p.screenshot({ path: 'e2e/shot-suggestion.png' });

console.log(errs.length ? '\nBrowser errors:\n' + errs.join('\n') : '\nNo browser errors.');
await b.close();
process.exit(errs.length ? 1 : 0);
