import { chromium } from 'playwright';

const BASE = 'http://127.0.0.1:5180/';
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
// The generic "Failed to load resource" console line carries no URL, so it is
// dropped in favour of the response listener below, which does. The favicon is
// the one expected 404 until the PWA icons are generated.
page.on('console', (m) => {
  if (m.type() !== 'error') return;
  if (/Failed to load resource/i.test(m.text())) return;
  errors.push(`console: ${m.text()}`);
});
page.on('response', (r) => {
  if (r.status() === 404 && !/favicon/i.test(r.url())) errors.push(`404: ${r.url()}`);
});

const step = async (label, fn) => {
  try { await fn(); console.log(`  ok   ${label}`); }
  catch (e) { console.log(`  FAIL ${label}: ${e.message}`); throw e; }
};

await page.goto(BASE, { waitUntil: 'networkidle' });
await step('app loads past seeding', async () => {
  await page.getByRole('heading', { name: 'Train' }).waitFor({ timeout: 30000 });
});

await step('start empty workout', async () => {
  await page.getByRole('button', { name: 'Start empty workout' }).click();
  await page.getByRole('button', { name: 'Add exercise' }).waitFor();
});

await step('open picker and search', async () => {
  await page.getByRole('button', { name: 'Add exercise' }).click();
  await page.getByPlaceholder('Add exercise').fill('barbell squat');
  await page.getByRole('button', { name: /^Barbell Squat/ }).first().click();
});

await step('log a set', async () => {
  await page.getByLabel('Set 1 weight in kilograms').fill('100');
  await page.getByLabel('Set 1 repetitions').fill('5');
  await page.getByLabel(/Mark set 1 done/).click();
  await page.waitForTimeout(300);
});

await step('header shows the volume', async () => {
  const text = await page.locator('header').innerText();
  if (!text.includes('500')) throw new Error(`expected 500 kg tonnage, header said: ${text.replace(/\n/g,' | ')}`);
  if (!/1 set/.test(text)) throw new Error(`expected "1 set", header said: ${text.replace(/\n/g,' | ')}`);
});

await step('add a second set carries the weight forward', async () => {
  await page.getByRole('button', { name: 'Add set' }).click();
  await page.waitForTimeout(300);
  const v = await page.getByLabel('Set 2 weight in kilograms').inputValue();
  if (v !== '100') throw new Error(`expected prefilled 100, got "${v}"`);
});

await page.screenshot({ path: 'e2e/shot-workout.png' });

await step('finish workout', async () => {
  await page.getByRole('button', { name: 'Finish', exact: true }).click();
  await page.getByRole('button', { name: 'Finish and save' }).click();
  await page.waitForTimeout(600);
});

await step('lands on the workout detail route', async () => {
  const url = page.url();
  if (!url.includes('#/history/')) throw new Error(`expected history route, got ${url}`);
});

await step('workout persisted to IndexedDB', async () => {
  const counts = await page.evaluate(async () => {
    const open = indexedDB.open('gymgo');
    const db = await new Promise((res, rej) => { open.onsuccess = () => res(open.result); open.onerror = () => rej(open.error); });
    const read = (store) => new Promise((res, rej) => {
      const r = db.transaction(store).objectStore(store).getAll();
      r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
    });
    const [workouts, sets, exercises] = await Promise.all([read('workouts'), read('sets'), read('exercises')]);
    return {
      exercises: exercises.length,
      finished: workouts.filter(w => w.finished_at !== null).length,
      liveSets: sets.filter(s => s.deleted_at === null).length,
      deletedSets: sets.filter(s => s.deleted_at !== null).length,
    };
  });
  console.log('       IndexedDB:', JSON.stringify(counts));
  if (counts.exercises !== 675) throw new Error(`expected 675 seeded exercises, got ${counts.exercises}`);
  if (counts.finished !== 1) throw new Error(`expected 1 finished workout, got ${counts.finished}`);
  if (counts.liveSets !== 1) throw new Error(`expected 1 live set, got ${counts.liveSets}`);
  if (counts.deletedSets !== 1) throw new Error(`the untouched 2nd set should have been discarded on finish, got ${counts.deletedSets}`);
});

await step('session summary shows duration, volume and sets', async () => {
  const text = await page.locator('main, body').first().innerText();
  if (!/500 kg/.test(text)) throw new Error(`expected 500 kg volume, saw: ${text.replace(/\n/g, ' | ')}`);
  if (!/sets/i.test(text)) throw new Error('expected a Sets stat');
});

await step('first ever session is reported as a PR', async () => {
  const text = await page.locator('body').innerText();
  if (!/Personal record/i.test(text)) throw new Error('expected a personal record callout');
  if (!/first time/i.test(text)) throw new Error('expected the PR to be marked as a first');
});

await page.screenshot({ path: 'e2e/shot-summary.png', fullPage: true });

// A second, heavier session must beat the first and must not be beaten by a drop set.
await step('second workout logs a heavier top set', async () => {
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: 'Start empty workout' }).click();
  await page.getByRole('button', { name: 'Add exercise' }).click();
  await page.getByPlaceholder('Add exercise').fill('barbell squat');
  await page.getByRole('button', { name: /^Barbell Squat/ }).first().click();
  await page.getByLabel('Set 1 weight in kilograms').fill('110');
  await page.getByLabel('Set 1 repetitions').fill('5');
  await page.getByLabel(/Mark set 1 done/).click();
  await page.waitForTimeout(300);
  await page.getByRole('button', { name: 'Finish', exact: true }).click();
  await page.getByRole('button', { name: 'Finish and save' }).click();
  await page.waitForTimeout(800);
});

await step('reports the weight PR against the previous session', async () => {
  const text = await page.locator('body').innerText();
  if (!/Personal record/i.test(text)) throw new Error('expected a PR callout');
  if (!/was 100kg/.test(text)) throw new Error(`expected "was 100kg", saw: ${text.replace(/\n/g, ' | ')}`);
});

await step('history lists both sessions', async () => {
  await page.goto(`${BASE}#/history`, { waitUntil: 'networkidle' });
  await page.getByRole('heading', { name: 'History' }).waitFor();
  await page.waitForTimeout(500);
  // Scoped to history links: a bare `ul li` also matches the four nav tabs.
  const rows = await page.locator('a[href*="#/history/"]').count();
  if (rows !== 2) throw new Error(`expected 2 history rows, got ${rows}`);
});

await page.screenshot({ path: 'e2e/shot-history.png' });

// ---------------------------------------------------------------------------
// Previous performance inline: the number you are trying to beat.
// ---------------------------------------------------------------------------

await step('a new session shows last time\'s top set inline', async () => {
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: 'Start empty workout' }).click();
  await page.getByRole('button', { name: 'Add exercise' }).click();
  await page.getByPlaceholder('Add exercise').fill('barbell squat');
  await page.getByRole('button', { name: /^Barbell Squat/ }).first().click();
  await page.waitForTimeout(700);
  const body = await page.locator('body').innerText();
  if (!/last time/i.test(body)) throw new Error('expected a "Last time" line');
  // The previous session was 110kg x 5, not the 100kg one before it.
  if (!/110kg × 5/.test(body)) throw new Error(`expected 110kg × 5 inline, saw: ${body.replace(/\n/g, ' | ')}`);
});

await step('the empty set row offers last time as a placeholder', async () => {
  const placeholder = await page.getByLabel('Set 1 weight in kilograms').getAttribute('placeholder');
  if (placeholder !== '110') throw new Error(`expected placeholder 110, got ${placeholder}`);
});

await step('"Use" fills the row without logging it', async () => {
  await page.getByRole('button', { name: 'Use' }).click();
  await page.waitForTimeout(500);
  const value = await page.getByLabel('Set 1 weight in kilograms').inputValue();
  if (value !== '110') throw new Error(`expected the row filled with 110, got "${value}"`);
});

await page.screenshot({ path: 'e2e/shot-previous.png' });

await step('discard that scratch session', async () => {
  await page.getByRole('button', { name: 'Finish', exact: true }).click();
  await page.getByRole('button', { name: 'Discard workout' }).click();
  await page.waitForTimeout(600);
});

// ---------------------------------------------------------------------------
// The brief's central rule: editing a routine must never change a workout
// already performed. Verified through the real UI, not just the unit tests.
// ---------------------------------------------------------------------------

await step('create a routine and add an exercise', async () => {
  await page.goto(`${BASE}#/routines`, { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: 'New' }).click();
  await page.getByLabel('Routine name').fill('Lower A');
  await page.getByRole('button', { name: 'Create' }).click();
  await page.getByRole('button', { name: 'Start this workout' }).waitFor();
  await page.getByRole('button', { name: 'Add exercise' }).click();
  await page.getByPlaceholder('Add to routine').fill('barbell squat');
  await page.getByRole('button', { name: /^Barbell Squat/ }).first().click();
  await page.waitForTimeout(400);
});

await step('set the routine to 3 sets of 5 to 8', async () => {
  await page.getByLabel('Barbell Squat target sets').fill('3');
  await page.getByLabel('Barbell Squat rep range low').fill('5');
  await page.getByLabel('Barbell Squat rep range high').fill('8');
  await page.locator('body').click();
  await page.waitForTimeout(400);
});

let routineWorkoutUrl = '';
await step('start a workout from the routine and log it', async () => {
  await page.getByRole('button', { name: 'Start this workout' }).click();
  await page.getByRole('button', { name: 'Add set' }).waitFor();
  // The exercise came across from the routine without being picked again.
  const body = await page.locator('body').innerText();
  if (!/Barbell Squat/.test(body)) throw new Error('routine exercise was not copied into the workout');
  await page.getByLabel('Set 1 weight in kilograms').fill('120');
  await page.getByLabel('Set 1 repetitions').fill('5');
  await page.getByLabel(/Mark set 1 done/).click();
  await page.waitForTimeout(300);
  await page.getByRole('button', { name: 'Finish', exact: true }).click();
  await page.getByRole('button', { name: 'Finish and save' }).click();
  await page.waitForTimeout(800);
  routineWorkoutUrl = page.url();
});

await step('rewrite the routine completely', async () => {
  await page.goto(`${BASE}#/routines`, { waitUntil: 'networkidle' });
  await page.getByRole('link', { name: /Lower A/ }).click();
  await page.getByRole('button', { name: 'Start this workout' }).waitFor();
  // Swap the exercise out for a different one and change every target.
  await page.getByLabel(/Remove Barbell Squat from routine/).click();
  await page.waitForTimeout(400);
  await page.getByRole('button', { name: 'Add exercise' }).click();
  await page.getByPlaceholder('Add to routine').fill('leg press');
  await page.getByRole('button', { name: /^Leg Press/ }).first().click();
  await page.waitForTimeout(500);
});

await step('the finished workout is untouched by that rewrite', async () => {
  await page.goto(routineWorkoutUrl, { waitUntil: 'networkidle' });
  await page.waitForTimeout(700);
  const body = await page.locator('body').innerText();
  if (!/Barbell Squat/.test(body)) {
    throw new Error('finished workout lost its exercise when the routine was edited');
  }
  if (/Leg Press/.test(body)) {
    throw new Error('finished workout picked up an exercise added to the routine afterwards');
  }
  if (!/120kg/.test(body)) throw new Error('finished workout lost its logged weight');
});

console.log(errors.length ? `\nBrowser errors:\n${errors.join('\n')}` : '\nNo browser errors.');
await browser.close();
process.exit(errors.length ? 1 : 0);
