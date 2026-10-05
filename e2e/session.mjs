/**
 * The logging screen after the rework: one station on screen; focus that moves
 * because you moved it, or once the rest after an exercise's last set is over,
 * with the rest naming where it goes; a readiness answer that visibly changes
 * the numbers; a first-time lift that says it is guessing; and each set
 * starting at what the last one did.
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
  const skip = p.getByRole('button', { name: 'Skip rest' });
  if (await skip.count()) await skip.click();
  await p.waitForTimeout(300);
};

// Exercise names are display type, upper-cased by CSS, and innerText sees the
// capitals — so names are matched without case.
const shows = (body, name) => new RegExp(name.replace(/[-]/g, '\\$&'), 'i').test(body);

await p.goto(BASE, { waitUntil: 'networkidle' });
await step('app loads', async () => { await p.getByRole('heading', { name: 'Today' }).waitFor({ timeout: 40000 }); });

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

  // The station, not the page: the strip in the header names every exercise.
  const station = await p.locator('main').innerText();
  const named = ['Barbell Bench Press', 'Barbell Squat', 'One-Arm Dumbbell Row']
    .filter((name) => shows(station, name));
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
  const station = await p.locator('main').innerText();
  if (!shows(station, 'Barbell Bench Press')) throw new Error('the bench should be the station on screen');
  if (shows(station, 'Barbell Squat')) throw new Error('only one station may render');
});

await step('the rest names the exercise, and after its last set, the next one', async () => {
  // The gym note: "Up next: Set 1" told the lifter nothing. Every rest names
  // an exercise now, and the one after an exercise's last set names the next.
  await p.getByRole('button', { name: 'Add set' }).first().click();
  await p.waitForTimeout(400);

  await p.getByLabel('Set 1 weight in kilograms').fill('100');
  await p.getByLabel('Set 1 repetitions').fill('8');
  await p.getByLabel(/Mark set 1 done/).click();
  await p.waitForTimeout(400);
  const mid = await p.locator('.rb-next').innerText();
  if (!shows(mid, 'Barbell Bench Press') || !/Set 2 of 2 · 100 × 8/i.test(mid)) {
    throw new Error(`mid-exercise, the rest should name the bench and set 2, it says: ${mid.replace(/\n/g, ' | ')}`);
  }
  await skipRest();

  await p.getByLabel('Set 2 weight in kilograms').fill('100');
  await p.getByLabel('Set 2 repetitions').fill('8');
  await p.getByLabel(/Mark set 2 done/).click();
  await p.waitForTimeout(400);
  const last = await p.locator('.rb-next').innerText();
  if (!shows(last, 'Barbell Squat')) throw new Error(`the last rest should name the squat, it says: ${last.replace(/\n/g, ' | ')}`);
  // And what to go and find for it.
  if (!/Barbell · 1 set/i.test(last)) throw new Error(`the last rest should say what the squat needs, it says: ${last.replace(/\n/g, ' | ')}`);
});

await step('under that rest the finished exercise stays, for a mistyped rep', async () => {
  await p.getByRole('button', { name: 'Show sets' }).click();
  await p.waitForTimeout(300);
  const { at } = await headerPosition();
  if (at !== 1) throw new Error(`the screen moved before the rest was over — header says ${at}`);
  const station = await p.locator('main').innerText();
  if (!shows(station, 'Barbell Bench Press')) throw new Error('the bench should still be on screen');
  if (!/all sets done/i.test(station)) throw new Error('a finished station should say so');
});

await step('when that rest is over, the next exercise is waiting', async () => {
  await skipRest();
  await p.waitForTimeout(300);
  const { at } = await headerPosition();
  if (at !== 2) throw new Error(`expected to have moved on to exercise 2, header says ${at}`);
  if (!shows(await p.locator('main').innerText(), 'Barbell Squat')) throw new Error('the squat should be on screen');
});

await step('the strip goes back, and "Next exercise" goes on', async () => {
  await p.getByRole('button', { name: /^Barbell Bench Press - Medium Grip, \d+ of \d+ sets done$/ }).click();
  await p.waitForTimeout(400);
  if ((await headerPosition()).at !== 1) throw new Error('the strip should go back to the bench');

  await p.getByRole('button', { name: /Next exercise/ }).click();
  await p.waitForTimeout(500);
  const { at } = await headerPosition();
  if (at !== 2) throw new Error(`expected exercise 2, header says ${at}`);
  if (!shows(await p.locator('main').innerText(), 'Barbell Squat')) throw new Error('the squat should be the station on screen');
});

await step('the strip names every exercise', async () => {
  // The gym note: nothing said what was coming, or which machine to go and find.
  const strip = await p.getByRole('list', { name: 'Exercises in this session' }).innerText();
  for (const name of ['Barbell Bench Press', 'Barbell Squat', 'One-Arm Dumbbell Row']) {
    if (!shows(strip, name)) throw new Error(`the strip should name ${name}, it reads: ${strip.replace(/\n/g, ' | ')}`);
  }
});

await step('"Exercise N/M" opens the whole session, kit and all', async () => {
  await p.getByRole('button', { name: /^Exercise 2 of 3, show the whole session$/ }).click();
  const sheet = p.getByRole('dialog', { name: 'This session' });
  await sheet.waitFor({ timeout: 5000 });
  const text = await sheet.innerText();
  for (const line of [
    /Barbell Bench Press/i,
    /Barbell · 2 sets/i,
    /Barbell Squat/i,
    /Barbell · 1 set\b/i,
    /One-Arm Dumbbell Row/i,
    /Dumbbell · 1 set\b/i,
  ]) {
    if (!line.test(text)) throw new Error(`the session list should show ${line}, it shows: ${text.replace(/\n/g, ' | ')}`);
  }
  // Where you are, marked; and the bench, done.
  const here = await sheet.locator('[aria-current="step"]').innerText();
  if (!shows(here, 'Barbell Squat')) throw new Error(`the squat should be marked as where you are, not ${here}`);
  if (!(await sheet.getByRole('button', { name: /Barbell Bench Press.*, done$/ }).count())) {
    throw new Error('the bench should read as done');
  }

  // A tap goes there, and the list gets out of the way.
  await sheet.getByRole('button', { name: /One-Arm Dumbbell Row/ }).click();
  await p.waitForTimeout(400);
  if (await p.getByRole('dialog', { name: 'This session' }).count()) throw new Error('picking a row should close the list');
  const { at } = await headerPosition();
  if (at !== 3) throw new Error(`picking the row should go to exercise 3, header says ${at}`);
});
await p.screenshot({ path: 'e2e/shot-session-strip.png' });

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

await step('an empty set deletes without asking', async () => {
  // Every set but the one in hand is a chip that opens it.
  await p.getByRole('button', { name: 'Add set' }).click();
  await p.waitForTimeout(400);
  const chip = p.getByRole('button', { name: 'Edit set 2' });
  if (!(await chip.count())) throw new Error('expected a second set to delete');
  await chip.click();
  await p.getByRole('button', { name: 'Delete set 2' }).click();
  await p.waitForTimeout(500);
  if (await p.getByRole('button', { name: 'Edit set 2' }).count()) {
    throw new Error('an empty set should go without ceremony');
  }
  if (await p.getByRole('button', { name: /Delete set \d+ for good/ }).count()) {
    throw new Error('an empty set has nothing to lose — it should not ask');
  }
});

await step('a set you have done asks before it goes', async () => {
  await p.getByLabel('Set 1 weight in kilograms').fill('20');
  await p.getByLabel('Set 1 repetitions').fill('10');
  await p.getByLabel(/Mark set 1 done/).click();
  await p.waitForTimeout(500);
  await skipRest();
  // Its last set done, the screen moved on to the bench, still to do, when
  // the rest ended. The strip goes back.
  if ((await headerPosition()).at !== 1) throw new Error('the screen should have moved on to the bench');
  await p.getByRole('button', { name: /^Incline Dumbbell Press, \d+ of \d+ sets done$/ }).click();
  await p.waitForTimeout(400);

  await p.getByRole('button', { name: 'Edit set 1, 20kg × 10, done' }).click();
  await p.getByRole('button', { name: 'Delete set 1' }).click();
  await p.waitForTimeout(400);
  const body = await p.locator('body').innerText();
  if (!/20kg × 10/.test(body)) throw new Error(`the confirm should name what is being lost, saw: ${body.replace(/\n/g,' | ').slice(0,300)}`);
  await p.getByRole('button', { name: 'Keep it' }).click();
  await p.waitForTimeout(400);
  if (await p.getByLabel('Set 1 weight in kilograms').inputValue() !== '20') {
    throw new Error('"Keep it" should have kept the logged set');
  }
  await p.keyboard.press('Escape');
  await p.waitForTimeout(300);
});

await step('a mistyped rep is fixed from its chip', async () => {
  await p.getByRole('button', { name: 'Edit set 1, 20kg × 10, done' }).click();
  await p.getByLabel('Set 1 repetitions').fill('12');
  await p.getByRole('button', { name: 'Done', exact: true }).click();
  await p.waitForTimeout(500);
  if (!(await p.getByRole('button', { name: 'Edit set 1, 20kg × 12, done' }).count())) {
    throw new Error('the corrected reps should be on the chip');
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
  if (!shows(body, 'Incline Dumbbell Press')) throw new Error('"Keep it" should have kept it');
});

await step('the next set starts at what the last one did', async () => {
  // The gym note: every set made you type both numbers again. A lift with no
  // history has nothing to suggest, so set 1 is typed; after that the fields
  // start at the last set done, and the stepper nudges from there.
  // The overflow from the step before is still open.
  if (await p.getByRole('dialog').count()) await p.keyboard.press('Escape');
  await p.waitForTimeout(300);
  await addExercise('dumbbell flyes', /^Dumbbell Flyes/);
  await p.getByRole('button', { name: 'Add set' }).click();
  await p.waitForTimeout(300);
  await p.getByRole('button', { name: 'Add set' }).click();
  await p.waitForTimeout(300);

  await p.getByLabel('Set 1 weight in kilograms').fill('12.5');
  await p.getByLabel('Set 1 repetitions').fill('11');
  await p.getByLabel(/Mark set 1 done/).click();
  await p.waitForTimeout(500);
  await skipRest();

  const weight = await p.getByLabel('Set 2 weight in kilograms').getAttribute('placeholder');
  const reps = await p.getByLabel('Set 2 repetitions').getAttribute('placeholder');
  if (weight !== '12.5' || reps !== '11') throw new Error(`set 2 should start at 12.5 × 11, it shows ${weight} × ${reps}`);

  // One tap up moves from the carried 12.5, by what the dumbbells allow.
  const up = p.getByRole('button', { name: /^Set 2 weight up/ });
  const step = Number(/up ([\d.]+) kilograms/.exec((await up.getAttribute('aria-label')) ?? '')?.[1]);
  if (!step) throw new Error('the weight stepper should say what one tap adds');
  await up.click();
  await p.waitForTimeout(300);
  const stepped = Math.round((12.5 + step) * 100) / 100;
  if (Number(await p.getByLabel('Set 2 weight in kilograms').inputValue()) !== stepped) {
    throw new Error(`one tap up should read ${stepped}`);
  }
  await p.getByLabel(/Mark set 2 done/).click();
  await p.waitForTimeout(500);
  await skipRest();
  if (!(await p.getByRole('button', { name: `Edit set 2, ${stepped}kg × 11, done` }).count())) {
    throw new Error(`set 2 should be logged at ${stepped}kg × 11`);
  }

  // Set 3 follows set 2, the one just done.
  const third = await p.getByLabel('Set 3 weight in kilograms').getAttribute('placeholder');
  if (Number(third) !== stepped) throw new Error(`set 3 should start at ${stepped}, it shows ${third}`);
  console.log(`       12.5 × 11, then ${stepped} × 11, then set 3 starts at ${third}`);
});

console.log(errs.length ? '\nBrowser errors:\n' + errs.join('\n') : '\nNo browser errors.');
await b.close();
process.exit(errs.length ? 1 : 0);
