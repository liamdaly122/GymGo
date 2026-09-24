/**
 * The logging screen after the rework: one station on screen, focus that only
 * ever moves because you moved it, a readiness answer that visibly changes the
 * numbers, and a first-time lift that says it is guessing.
 */
import { chromium } from 'playwright';

const BASE = process.env.BASE_URL ?? 'http://127.0.0.1:5185/';
const b = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const c = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
const p = await c.newPage();
const errs = [];
p.on('pageerror', e => errs.push('pageerror: ' + e.message));
p.on('console', m => {
  if (m.type() !== 'error') return;
  if (/Failed to load resource/i.test(m.text())) return;
  if (/navigator\.vibrate/i.test(m.text())) return;
  errs.push('console: ' + m.text());
});
const step = async (l, fn) => { try { await fn(); console.log('  ok   '+l); } catch(e) { console.log('  FAIL '+l+': '+e.message); throw e; } };

const addExercise = async (query, name) => {
  await p.getByRole('button', { name: 'Add exercise' }).click();
  await p.getByPlaceholder('Add exercise').fill(query);
  await p.getByRole('button', { name }).first().click();
  await p.waitForTimeout(800);
};

const headerPosition = async () => {
  const text = await p.locator('header').innerText();
  const m = /Exercise (\d+)\/(\d+)/.exec(text);
  if (!m) throw new Error(`header did not say where we are: ${text.replace(/\n/g, ' | ')}`);
  return { at: Number(m[1]), of: Number(m[2]) };
};

const skipRest = async () => {
  const skip = p.getByRole('button', { name: 'Skip', exact: true });
  if (await skip.count()) await skip.click();
  await p.waitForTimeout(300);
};

await p.goto(BASE, { waitUntil: 'networkidle' });
await step('app loads', async () => { await p.getByRole('heading', { name: 'Train' }).waitFor({ timeout: 40000 }); });

await step('start a three exercise session', async () => {
  await p.getByRole('button', { name: 'Start empty workout' }).click();
  await p.waitForURL(/#\/workout\//, { timeout: 15000 });
  await addExercise('barbell bench press', /^Barbell Bench Press - Medium Grip/);
  await addExercise('barbell squat', /^Barbell Squat/);
  await addExercise('one-arm dumbbell row', /^One-Arm Dumbbell Row/);
});

await step('only one exercise is on screen', async () => {
  // Three exercises, one set each. If they all rendered there would be three
  // "Set 1" weight fields — the whole point of the rework is that there is one.
  const fields = await p.getByLabel(/Set \d+ weight in kilograms/).count();
  if (fields !== 1) throw new Error(`expected one set row on screen, found ${fields}`);

  const body = await p.locator('body').innerText();
  const named = ['Barbell Bench Press', 'Barbell Squat', 'One-Arm Dumbbell Row']
    .filter((name) => body.includes(name));
  if (named.length !== 1) throw new Error(`expected one exercise named on screen, saw: ${named.join(', ')}`);

  const { at, of } = await headerPosition();
  if (of !== 3) throw new Error(`expected three stations, header says ${of}`);
  // Adding an exercise focuses it, so we are on the one just added.
  if (at !== 3) throw new Error(`expected to be on the newest exercise, header says ${at}`);
});

await step('the strip jumps back to the first exercise', async () => {
  await p.getByRole('button', { name: /^Barbell Bench Press - Medium Grip, \d+ of \d+ sets done$/ }).click();
  await p.waitForTimeout(500);
  const { at } = await headerPosition();
  if (at !== 1) throw new Error(`the strip should have gone to exercise 1, header says ${at}`);
  const body = await p.locator('body').innerText();
  if (!/Barbell Bench Press/.test(body)) throw new Error('the bench should be the station on screen');
  if (/Barbell Squat/.test(body)) throw new Error('only one station may render');
});

await step('finishing a station does not move the screen', async () => {
  // This is the rule the rework turns on: focus is a tap, never a side effect.
  // If the screen jumped on the last tick, a mistyped rep would be one screen
  // behind you and the rest dial would belong to something else.
  await p.getByRole('button', { name: 'Add set' }).first().click();
  await p.waitForTimeout(400);

  for (const s of [1, 2]) {
    await p.getByLabel(`Set ${s} weight in kilograms`).fill('100');
    await p.getByLabel(`Set ${s} repetitions`).fill('8');
    await p.getByLabel(new RegExp(`Mark set ${s} done`)).click();
    await p.waitForTimeout(400);
    await skipRest();
  }

  const { at } = await headerPosition();
  if (at !== 1) throw new Error(`the screen moved on its own — header says ${at}, should still say 1`);
  const body = await p.locator('body').innerText();
  if (!/Barbell Bench Press/.test(body)) throw new Error('the finished station should still be on screen');
});

await step('"Next exercise" is what moves it', async () => {
  await p.getByRole('button', { name: /Next exercise/ }).click();
  await p.waitForTimeout(500);
  const { at } = await headerPosition();
  if (at !== 2) throw new Error(`expected exercise 2, header says ${at}`);
  const body = await p.locator('body').innerText();
  if (!/Barbell Squat/.test(body)) throw new Error('the squat should be the station on screen');
});

await step('finish the session so the bench has history', async () => {
  await p.getByRole('button', { name: 'Finish', exact: true }).click();
  await p.getByRole('button', { name: 'Finish and save' }).click();
  await p.waitForURL(/#\/history\//, { timeout: 15000 });
});

let beforeReadiness = 0;
await step('a lift with history opens with a suggestion and a plan line', async () => {
  await p.goto(BASE + '#/', { waitUntil: 'networkidle' });
  await p.getByRole('button', { name: 'Start empty workout' }).click();
  await p.waitForURL(/#\/workout\//, { timeout: 15000 });
  await addExercise('barbell bench press', /^Barbell Bench Press - Medium Grip/);

  beforeReadiness = Number(await p.getByLabel('Set 1 weight in kilograms').getAttribute('placeholder'));
  if (!beforeReadiness) throw new Error('expected a suggested weight in the set row');
  console.log('       suggested:', beforeReadiness + 'kg');
});

await step('the readiness question is there to answer', async () => {
  const prompt = p.getByRole('button', { name: 'Readiness low' });
  if (!(await prompt.count())) throw new Error('expected the readiness question before anything is logged');
});

await step('a rough day scales the suggestion down', async () => {
  await p.getByRole('button', { name: 'Readiness low' }).click();
  await p.waitForTimeout(900);

  const after = Number(await p.getByLabel('Set 1 weight in kilograms').getAttribute('placeholder'));
  console.log('       after "rough":', after + 'kg');
  if (!(after < beforeReadiness)) throw new Error(`a rough day should suggest less than ${beforeReadiness}kg, got ${after}`);
  if (after < beforeReadiness * 0.85) throw new Error(`10% down, not ${Math.round((1 - after / beforeReadiness) * 100)}%`);

  const body = await p.locator('body').innerText();
  if (!/low readiness/i.test(body)) throw new Error('the reason should say why the number moved');
  // Answered once, and then out of the way.
  if (await p.getByRole('button', { name: 'Readiness low' }).count()) {
    throw new Error('the readiness question should be gone once answered');
  }
});

await step('a lift never performed is offered a labelled estimate', async () => {
  await addExercise('incline dumbbell press', /^Incline Dumbbell Press/);

  const estimated = Number(await p.getByLabel('Set 1 weight in kilograms').getAttribute('placeholder'));
  if (!estimated) throw new Error('expected an opening weight for a lift with no history');

  const body = await p.locator('body').innerText();
  if (!/estimate/i.test(body)) throw new Error(`the plan line must say it is estimating, saw: ${body.replace(/\n/g,' | ').slice(0,400)}`);
  if (!/not done this one before/i.test(body)) throw new Error('the reason should say there is no history');
  if (!/Barbell Bench Press/i.test(body)) throw new Error('the estimate should name the lift it reasoned from');
  if (estimated > 100) throw new Error(`an estimate must not exceed the lift it came from: ${estimated}kg off a 100kg bench`);
  console.log('       estimated:', estimated + 'kg from the bench');
});
await p.screenshot({ path: 'e2e/shot-session.png' });

await step('an empty set deletes on one tap', async () => {
  await p.getByRole('button', { name: 'Add set' }).click();
  await p.waitForTimeout(400);
  if (await p.getByLabel(/Set \d+ weight in kilograms/).count() !== 2) {
    throw new Error('expected a second set to delete');
  }
  await p.getByRole('button', { name: 'Delete set 2' }).click();
  await p.waitForTimeout(500);
  if (await p.getByLabel(/Set \d+ weight in kilograms/).count() !== 1) {
    throw new Error('an empty row should go without ceremony');
  }
  if (await p.getByRole('button', { name: /Delete set \d+ for good/ }).count()) {
    throw new Error('an empty row has nothing to lose — it should not ask');
  }
});

await step('a set you have done asks before it goes', async () => {
  await p.getByLabel('Set 1 weight in kilograms').fill('20');
  await p.getByLabel('Set 1 repetitions').fill('10');
  await p.getByLabel(/Mark set 1 done/).click();
  await p.waitForTimeout(500);
  await skipRest();
  // The tools follow the set in hand, so set 1's delete only reappears once
  // there is a later unfinished set.
  await p.getByRole('button', { name: 'Add set' }).click();
  await p.waitForTimeout(400);

  await p.getByRole('button', { name: 'Delete set 1' }).click();
  await p.waitForTimeout(400);
  const body = await p.locator('body').innerText();
  if (!/20kg × 10/.test(body)) throw new Error(`the confirm should name what is being lost, saw: ${body.replace(/\n/g,' | ').slice(0,300)}`);
  await p.getByRole('button', { name: 'Keep it' }).click();
  await p.waitForTimeout(400);
  if (await p.getByLabel('Set 1 weight in kilograms').inputValue() !== '20') {
    throw new Error('"Keep it" should have kept the logged set');
  }
});

await step('the overflow holds everything that is not logging', async () => {
  await p.getByRole('button', { name: 'More for Incline Dumbbell Press' }).click();
  await p.waitForTimeout(300);
  // Accessible names, not link text: each control names the exercise it acts
  // on, because there is no longer a card around it to say which one.
  for (const name of [
    /Swap Incline Dumbbell Press for something else/,
    /Move Incline Dumbbell Press earlier/,
    /Move Incline Dumbbell Press later/,
    /Remove from this workout/,
  ]) {
    const control = p.getByRole('button', { name }).or(p.getByRole('link', { name }));
    if (!(await control.count())) throw new Error(`expected ${name} in the overflow`);
  }
});

await step('removing an exercise asks first', async () => {
  await p.getByRole('button', { name: 'Remove from this workout' }).click();
  await p.waitForTimeout(300);
  const confirm = p.getByRole('button', { name: 'Remove Incline Dumbbell Press from this workout' });
  if (!(await confirm.count())) throw new Error('a destructive control beside the most-tapped ones must confirm');
  await p.getByRole('button', { name: 'Keep it' }).click();
  await p.waitForTimeout(300);
  const body = await p.locator('body').innerText();
  if (!/Incline Dumbbell Press/.test(body)) throw new Error('"Keep it" should have kept it');
});

console.log(errs.length ? '\nBrowser errors:\n' + errs.join('\n') : '\nNo browser errors.');
await b.close();
process.exit(errs.length ? 1 : 0);
