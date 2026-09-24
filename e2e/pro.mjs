/**
 * Pro mode: RIR on every set, and the advanced techniques the counting rules
 * were written for. The point of the last step is that logging a drop set
 * cannot damage the record it hangs off.
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

await step('beginner mode shows no RIR', async () => {
  await p.getByRole('button', { name: 'Start empty workout' }).click();
  await p.getByRole('button', { name: 'Add exercise' }).click();
  await p.getByPlaceholder('Add exercise').fill('barbell bench press');
  await p.getByRole('button', { name: /^Barbell Bench Press - Medium Grip/ }).first().click();
  await p.getByLabel('Set 1 weight in kilograms').first().waitFor({ timeout: 20000 });
  const body = await p.locator('body').innerText();
  if (/\bRIR\b/.test(body)) throw new Error('beginner mode should not show RIR');
  if (/Drop/i.test(body)) throw new Error('beginner mode should not offer drop sets');
});

await step('switching to Pro reveals RIR', async () => {
  await p.goto(BASE + '#/settings', { waitUntil: 'networkidle' });
  await p.getByRole('button', { name: /^Pro$/i }).first().click();
  await p.waitForTimeout(400);
  await p.goBack();
  await p.waitForTimeout(800);
  const body = await p.locator('body').innerText();
  if (!/\bRIR\b/.test(body)) throw new Error(`Pro mode should show RIR, saw: ${body.replace(/\n/g,' | ').slice(0,300)}`);
});

await step('log a 100kg top set with RIR 2', async () => {
  await p.getByLabel('Set 1 weight in kilograms').first().fill('100');
  await p.getByLabel('Set 1 repetitions').first().fill('5');
  await p.getByLabel('Set 1 reps in reserve 2').first().click();
  await p.waitForTimeout(300);
  await p.getByLabel(/Mark set 1 done/).first().click();
  await p.waitForTimeout(500);
  const skip = p.getByRole('button', { name: 'Skip', exact: true });
  if (await skip.count()) await skip.click();
});

await step('a completed working set offers the techniques', async () => {
  const body = await p.locator('body').innerText();
  for (const label of ['+ Drop', '+ Rest-pause', '+ Myo']) {
    if (!body.includes(label.toUpperCase()) && !body.includes(label)) {
      throw new Error(`expected ${label}, saw: ${body.replace(/\n/g,' | ').slice(0,400)}`);
    }
  }
});
await p.screenshot({ path: 'e2e/shot-pro.png', fullPage: true });

await step('adding a drop set loads it 20% lighter, on real plates', async () => {
  await p.getByRole('button', { name: '+ Drop' }).first().click();
  await p.waitForTimeout(700);
  const sets = await p.evaluate(async () => {
    const open = indexedDB.open('gymgo');
    const db = await new Promise((res, rej) => { open.onsuccess = () => res(open.result); open.onerror = () => rej(open.error); });
    const r = db.transaction('sets').objectStore('sets').getAll();
    const all = await new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
    return all.filter(s => s.deleted_at === null).sort((a,b) => a.set_index - b.set_index)
      .map(s => ({ type: s.type, weight: s.weight_kg, rir: s.rir, child: s.parent_set_id !== null }));
  });
  console.log('       sets:', JSON.stringify(sets));
  if (sets.length !== 2) throw new Error(`expected two sets, got ${sets.length}`);
  if (sets[0].rir !== 2) throw new Error(`RIR did not persist, got ${sets[0].rir}`);
  if (sets[1].type !== 'drop' || !sets[1].child) throw new Error('the second set should be a drop child');
  if (sets[1].weight !== 80) throw new Error(`expected an 80kg drop, got ${sets[1].weight}`);
});

await step('the drop is indented and labelled, not shown as set 2', async () => {
  const body = await p.locator('body').innerText();
  if (!/\bD\b/.test(body)) throw new Error('the drop set should carry its D label');
});

await step('finishing leaves the 100kg record intact', async () => {
  await p.getByLabel('Drop under set 1 repetitions').first().fill('8');
  await p.getByLabel(/Mark drop under set 1 done/).first().click();
  await p.waitForTimeout(600);
  const skip = p.getByRole('button', { name: 'Skip', exact: true });
  if (await skip.count()) await skip.click();
  await p.getByRole('button', { name: 'Finish', exact: true }).click();
  await p.getByRole('button', { name: 'Finish and save' }).click();
  // The summary is the history detail for this session.
  await p.waitForURL(/#\/history\//, { timeout: 15000 });
  await p.waitForTimeout(900);

  const body = await p.locator('body').innerText();
  console.log('       summary:', body.replace(/\n/g, ' | ').slice(0, 340));

  // Both sets are real work, so both are in the record of the session.
  if (!/100/.test(body)) throw new Error('the 100kg top set is missing from the summary');
  if (!/80/.test(body)) throw new Error('the 80kg drop is missing from the summary');

  // But only one of them is a bench press personal record.
  const records = await p.evaluate(async () => {
    const open = indexedDB.open('gymgo');
    const db = await new Promise((res, rej) => { open.onsuccess = () => res(open.result); open.onerror = () => rej(open.error); });
    const get = (s) => new Promise((res, rej) => { const r = db.transaction(s).objectStore(s).getAll(); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
    const sets = (await get('sets')).filter(s => s.deleted_at === null && s.completed);
    const eligible = sets.filter(s => s.parent_set_id === null && s.type === 'working');
    return {
      heaviestOverall: Math.max(...sets.map(s => s.weight_kg)),
      heaviestEligible: Math.max(...eligible.map(s => s.weight_kg)),
      eligibleCount: eligible.length,
    };
  });
  console.log('       records:', JSON.stringify(records));
  if (records.eligibleCount !== 1) throw new Error(`only the top set is record-eligible, got ${records.eligibleCount}`);
  if (records.heaviestEligible !== 100) throw new Error('the record should be the 100kg top set');
});
await p.screenshot({ path: 'e2e/shot-pro-summary.png', fullPage: true });

await step('a routine can prescribe rest and tempo in Pro mode', async () => {
  await p.goto(BASE + '#/routines', { waitUntil: 'networkidle' });
  await p.getByRole('button', { name: /New|Add/i }).first().click();
  await p.getByPlaceholder(/Lower A, Push/).fill('Strength A');
  await p.getByRole('button', { name: 'Create' }).click();
  await p.waitForTimeout(900);
  await p.getByRole('button', { name: 'Add exercise' }).first().click();
  await p.getByPlaceholder('Add to routine').fill('barbell bench press');
  await p.getByRole('button', { name: /^Barbell Bench Press - Medium Grip/ }).first().click();
  await p.waitForTimeout(800);

  const restField = p.getByLabel(/rest seconds/i).first();
  if (!(await restField.count())) throw new Error('Pro mode should expose a per-exercise rest field');
  await restField.fill('210');
  await p.getByLabel(/tempo/i).first().fill('3-1-1-0');
  await p.locator('body').click({ position: { x: 5, y: 5 } });
  await p.waitForTimeout(600);
});

await step('starting it copies the prescription onto the session', async () => {
  await p.getByRole('button', { name: /Start workout|Start/i }).first().click();
  await p.waitForURL(/#\/workout\//, { timeout: 15000 });
  await p.waitForTimeout(900);

  // Scope to this workout: getAll() returns rows in uuid order, so "the last
  // one" is arbitrary once earlier sessions exist.
  const workoutId = new URL(p.url()).hash.split('/')[2];
  const copied = await p.evaluate(async (id) => {
    const open = indexedDB.open('gymgo');
    const db = await new Promise((res, rej) => { open.onsuccess = () => res(open.result); open.onerror = () => rej(open.error); });
    const get = (s) => new Promise((res, rej) => { const r = db.transaction(s).objectStore(s).getAll(); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
    const mine = (await get('workout_exercises')).filter(w => w.deleted_at === null && w.workout_id === id);
    return { count: mine.length, rest: mine[0]?.rest_seconds, tempo: mine[0]?.tempo };
  }, workoutId);
  console.log('       copied:', JSON.stringify(copied));
  if (copied.rest !== 210) throw new Error(`expected the prescribed 210s, got ${copied.rest}`);
  if (copied.tempo !== '3-1-1-0') throw new Error(`expected the prescribed tempo, got ${copied.tempo}`);
});

await step('and the rest timer runs for the prescribed 210s, not the default', async () => {
  await p.getByLabel('Set 1 weight in kilograms').first().fill('60');
  await p.getByLabel('Set 1 repetitions').first().fill('5');
  await p.getByLabel(/Mark set 1 done/).first().click();
  await p.waitForTimeout(800);

  const body = await p.locator('body').innerText();
  // 210s is 3:30. The exercise default for a barbell bench is 180s (3:00), so
  // a clock reading 3:2x proves the routine's prescription won.
  if (!/3:2\d|3:30/.test(body)) {
    throw new Error(`expected a 3:30 rest, saw: ${body.replace(/\n/g,' | ').slice(0,300)}`);
  }
  console.log('       timer shows:', (body.match(/\d:\d\d/) ?? ['?'])[0]);
});

await step('AMRAP relabels the reps field', async () => {
  const amrap = p.getByLabel(/Set 1 as many reps as possible/).first();
  if (!(await amrap.count())) throw new Error('Pro mode should offer an AMRAP flag');
  await amrap.click();
  await p.waitForTimeout(500);
  const suffix = await p.locator('body').innerText();
  if (!/AMRAP/.test(suffix)) throw new Error('the reps field should say AMRAP');
});

await step('supersetting two exercises stops the timer running between them', async () => {
  // A fresh session: the previous one has a ticked set and a running timer,
  // which would make "the first unticked set" ambiguous. Close it properly
  // rather than resuming it.
  const skip = p.getByRole('button', { name: 'Skip', exact: true });
  if (await skip.count()) await skip.click();
  await p.getByRole('button', { name: 'Finish', exact: true }).click();
  await p.getByRole('button', { name: 'Finish and save' }).click();
  await p.waitForURL(/#\/history\//, { timeout: 15000 });

  await p.goto(BASE + '#/', { waitUntil: 'networkidle' });
  await p.getByRole('button', { name: 'Start empty workout' }).click();
  await p.waitForURL(/#\/workout\//, { timeout: 15000 });

  for (const [query, name] of [
    ['barbell bench press', /^Barbell Bench Press - Medium Grip/],
    ['one-arm dumbbell row', /^One-Arm Dumbbell Row/],
  ]) {
    await p.getByRole('button', { name: 'Add exercise' }).click();
    await p.getByPlaceholder('Add exercise').fill(query);
    await p.getByRole('button', { name }).first().click();
    await p.waitForTimeout(800);
  }

  // Adding an exercise focuses it, and only an exercise with something after
  // it can be paired — so the bench has to come back on screen first. Pairing
  // lives in the overflow now.
  await p.getByRole('button', { name: /^Barbell Bench Press - Medium Grip, \d+ of \d+ sets done$/ }).click();
  await p.waitForTimeout(400);
  await p.getByRole('button', { name: 'More for Barbell Bench Press - Medium Grip' }).first().click();
  await p.waitForTimeout(250);

  const pair = p.getByRole('button', { name: 'Superset with next' }).first();
  if (!(await pair.count())) throw new Error('Pro mode should offer to superset with the next exercise');
  await pair.click();
  await p.waitForTimeout(700);

  const body = await p.locator('body').innerText();
  if (!/A1/.test(body) || !/A2/.test(body)) {
    throw new Error(`expected A1 / A2 badges, saw: ${body.replace(/\n/g,' | ').slice(0,400)}`);
  }
});
await p.screenshot({ path: 'e2e/shot-superset.png', fullPage: true });

await step('finishing the first half of the pair starts no rest', async () => {
  await p.getByLabel('Set 1 weight in kilograms').first().fill('60');
  await p.getByLabel('Set 1 repetitions').first().fill('5');
  await p.getByLabel(/Mark set 1 done/).first().click();
  await p.waitForTimeout(1000);

  const body = await p.locator('body').innerText();
  // Case-insensitive: the label is uppercased by CSS, and innerText respects
  // text-transform, so /Resting/ would never match and the check would pass
  // whatever happened.
  if (/resting/i.test(body)) throw new Error('rest must not run between the halves of a superset');
});

await step('finishing the second half does start the rest', async () => {
  // The first card's button now reads "tap to undo", so the only remaining
  // "Mark set 1 done" is the second half of the pair.
  await p.getByLabel('Set 1 weight in kilograms').nth(1).fill('30');
  await p.getByLabel('Set 1 repetitions').nth(1).fill('10');
  await p.getByLabel(/Mark set 1 done/).first().click();
  await p.waitForTimeout(1000);

  const body = await p.locator('body').innerText();
  if (!/resting/i.test(body)) {
    throw new Error(`rest should run after the round, saw: ${body.replace(/\n/g,' | ').slice(0,400)}`);
  }
  console.log('       rest after the round:', (body.match(/\d:\d\d/) ?? ['?'])[0]);
});

console.log(errs.length ? '\nBrowser errors:\n' + errs.join('\n') : '\nNo browser errors.');
await b.close();
process.exit(errs.length ? 1 : 0);
