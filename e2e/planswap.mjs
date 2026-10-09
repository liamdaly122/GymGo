/**
 * Changing exercises in a plan: in the builder before it is saved, across a
 * saved plan, mid-session, and from a day on the calendar three weeks out.
 *
 * The case it is built around is the owner's: a four-day full body puts a
 * deadlift on three days — three different deadlifts — and "no deadlifts"
 * has to reach all of them, without touching a workout already done.
 */
import { launchChromium } from './browser.mjs';

const BASE = process.env.BASE_URL ?? 'http://127.0.0.1:5185/';
const b = await launchChromium();
const c = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
const p = await c.newPage();
const errs = [];
p.on('pageerror', e => errs.push('pageerror: ' + e.message));
p.on('console', m => { if (m.type() === 'error' && !/Failed to load resource|navigator\.vibrate/i.test(m.text())) errs.push('console: ' + m.text()); });
const step = async (l, fn) => { try { await fn(); console.log('  ok   ' + l); } catch (e) { console.log('  FAIL ' + l + ': ' + e.message); throw e; } };

/** Every session of the running plan, by short name, with its exercises in order. */
const readPlan = () => p.evaluate(async () => {
  const open = indexedDB.open('gymgo');
  const db = await new Promise((res, rej) => { open.onsuccess = () => res(open.result); open.onerror = () => rej(open.error); });
  const getAll = (name) => new Promise((res, rej) => { const r = db.transaction(name).objectStore(name).getAll(); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
  const [plans, routines, rows, exercises] = await Promise.all([getAll('plans'), getAll('routines'), getAll('routine_exercises'), getAll('exercises')]);
  const plan = plans.find(x => x.completed_at === null && x.deleted_at === null);
  const name = new Map(exercises.map(e => [e.id, e.name]));
  return plan.routine_ids.map(id => ({
    session: (routines.find(r => r.id === id)?.name ?? '').split(' — ').at(-1),
    exercises: rows.filter(r => r.routine_id === id && r.deleted_at === null)
      .sort((a, b) => a.position - b.position).map(r => name.get(r.exercise_id)),
  }));
});

/** What each finished workout performed, by exercise name. */
const readFinished = () => p.evaluate(async () => {
  const open = indexedDB.open('gymgo');
  const db = await new Promise((res, rej) => { open.onsuccess = () => res(open.result); open.onerror = () => rej(open.error); });
  const getAll = (name) => new Promise((res, rej) => { const r = db.transaction(name).objectStore(name).getAll(); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
  const [workouts, wes, exercises] = await Promise.all([getAll('workouts'), getAll('workout_exercises'), getAll('exercises')]);
  const name = new Map(exercises.map(e => [e.id, e.name]));
  return workouts.filter(w => w.finished_at && w.deleted_at === null).map(w =>
    wes.filter(we => we.workout_id === w.id && we.deleted_at === null).sort((a, b) => a.position - b.position).map(we => name.get(we.exercise_id)));
});

const isDeadlift = (name) => /deadlift/i.test(name ?? '');
/** A session name as the start of a regex. "Full body A (2)", which a four-day full body reaches on a Friday, has brackets. */
const nameStarts = (name) => new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?=\\s|$)`);

await p.goto(BASE, { waitUntil: 'networkidle' });
await step('app loads', async () => { await p.getByRole('heading', { name: 'Today' }).waitFor({ timeout: 40000 }); });

// ---------------------------------------------------------------------------
// In the builder, before anything is saved.
// ---------------------------------------------------------------------------

const dayNames = async () => {
  const out = [];
  for (let d = 1; d <= 4; d++) {
    out.push(await p.getByRole('region', { name: `Day ${d}` }).locator('.ex-name > span:first-child').allTextContents());
  }
  return out;
};

await step('a four-day full body has a deadlift on more than one day', async () => {
  await p.goto(BASE + '#/plan/new/build_muscle/full_body?days=4', { waitUntil: 'networkidle' });
  await p.getByRole('heading', { name: 'Full body', exact: true }).waitFor({ timeout: 20000 });
  await p.waitForTimeout(500);
  const days = await dayNames();
  const withDeadlift = days.filter(day => day.some(isDeadlift));
  console.log('       deadlifts:', JSON.stringify(days.flat().filter(isDeadlift)));
  if (withDeadlift.length < 2) throw new Error('the case this suite is about needs a deadlift on two days or more');
});

let replacement = '';
await step('"Whole plan" names every deadlift it will change, and changes them all', async () => {
  const day = (await dayNames()).findIndex(names => names.some(isDeadlift)) + 1;
  const region = p.getByRole('region', { name: `Day ${day}` });
  await region.getByRole('button', { name: /^Swap .*Deadlift/ }).first().click();
  const panel = p.getByRole('dialog', { name: /^Swap .*Deadlift/ });
  await panel.waitFor();

  // Planning, so a different exercise for the same muscles leads the list.
  const sections = await panel.locator('h2').allTextContents();
  if (!/Different exercise, same muscles/i.test(sections.find(t => /same muscles|another way/i.test(t)) ?? '')) {
    throw new Error(`the builder should lead with a different exercise, saw ${JSON.stringify(sections)}`);
  }
  await panel.getByRole('button', { name: 'Whole plan' }).click();
  const hint = await panel.locator('p[aria-live]').textContent();
  const named = (await dayNames()).flat().filter(isDeadlift);
  for (const lift of named) if (!hint.includes(lift)) throw new Error(`the hint should name ${lift}: ${hint}`);

  const option = panel.locator('section[aria-labelledby="swap-different"] .ex-row').first();
  replacement = (await option.locator('strong').textContent()).trim();
  if (isDeadlift(replacement)) throw new Error(`"different exercise" offered a deadlift: ${replacement}`);
  await option.click();
  await p.waitForTimeout(400);

  const after = (await dayNames()).flat();
  if (after.some(isDeadlift)) throw new Error(`a deadlift survived: ${JSON.stringify(after.filter(isDeadlift))}`);
  const marked = await p.getByText('Your swap', { exact: true }).count();
  if (marked !== named.length) throw new Error(`expected ${named.length} swaps marked, got ${marked}`);
  console.log(`       ${named.length} deadlifts became ${replacement}`);
});

await step('shuffling keeps the swaps and brings no deadlift back', async () => {
  const before = await dayNames();
  await p.getByRole('button', { name: 'Shuffle the rest' }).click();
  await p.waitForTimeout(400);
  const after = await dayNames();
  if (JSON.stringify(after) === JSON.stringify(before)) throw new Error('shuffle changed nothing');
  if (after.flat().some(isDeadlift)) throw new Error('a shuffle brought a deadlift back');
  const kept = after.flat().filter(n => n === replacement).length;
  if (kept < 2) throw new Error(`the swaps should survive a shuffle, ${replacement} appears ${kept} time(s)`);
});
await p.screenshot({ path: 'e2e/shot-planswap-builder.png' });

await step('the saved plan is what the preview showed', async () => {
  const shown = await dayNames();
  await p.getByRole('button', { name: /Use this plan/ }).click();
  await p.getByRole('heading', { name: 'Plan', exact: true }).waitFor({ timeout: 20000 });
  const saved = await readPlan();
  if (JSON.stringify(saved.map(s => s.exercises)) !== JSON.stringify(shown)) {
    throw new Error(`saved ${JSON.stringify(saved.map(s => s.exercises))}, showed ${JSON.stringify(shown)}`);
  }
});

// ---------------------------------------------------------------------------
// A saved plan, with a workout already done.
// ---------------------------------------------------------------------------

let performedLift = '';
await step('train the first session', async () => {
  await p.getByRole('link', { name: 'Today', exact: true }).click();
  await p.getByRole('region', { name: 'Next session' }).getByRole('button', { name: /^Start/ }).click();
  await p.getByLabel('Set 1 weight in kilograms').first().waitFor({ timeout: 20000 });
  await p.getByLabel('Set 1 weight in kilograms').fill('60');
  await p.getByLabel('Set 1 repetitions').fill('8');
  await p.getByLabel(/Mark set 1 done/).click();
  await p.waitForTimeout(300);
  const skip = p.getByRole('button', { name: 'Skip rest' });
  if (await skip.count()) await skip.click();
  await p.getByRole('button', { name: 'Finish', exact: true }).click();
  await p.getByRole('button', { name: 'Finish and save' }).click();
  await p.waitForTimeout(800);
  performedLift = (await readFinished())[0][0];
});

await step('swapping that lift across the plan leaves the done workout alone', async () => {
  const plan = await readPlan();
  const holder = plan.find(s => s.exercises.includes(performedLift));
  await p.goto(BASE + '#/plan', { waitUntil: 'networkidle' });
  // The session list, not "Coming up": a done session there links to its history.
  await p.getByRole('region', { name: 'Sessions in this plan' })
    .getByRole('link', { name: nameStarts(holder.session) }).first().click();
  await p.getByRole('button', { name: `Swap ${performedLift}` }).click();
  const panel = p.getByRole('dialog', { name: `Swap ${performedLift}` });
  await panel.waitFor();
  const whole = panel.getByRole('button', { name: 'Whole plan' });
  if (await whole.count()) await whole.click();
  const option = panel.locator('.ex-row').first();
  const picked = (await option.locator('strong').textContent()).trim();
  await option.click();
  await p.waitForTimeout(600);

  const toast = await p.getByRole('status').textContent();
  if (!toast.includes(picked)) throw new Error(`expected a toast naming ${picked}, saw ${toast}`);
  const after = await readPlan();
  if (after.find(s => s.session === holder.session).exercises.includes(performedLift)) {
    throw new Error('the session still has the swapped lift');
  }
  const finished = await readFinished();
  if (finished[0][0] !== performedLift) {
    throw new Error(`the finished workout changed: ${finished[0][0]} instead of ${performedLift}`);
  }
});

// ---------------------------------------------------------------------------
// Mid-session: this session from now on, and nothing else.
// ---------------------------------------------------------------------------

await step('mid-session, "Every <session>" changes that session and no other', async () => {
  const before = await readPlan();
  await p.getByRole('link', { name: 'Today', exact: true }).click();
  await p.getByRole('region', { name: 'Next session' }).getByRole('button', { name: /^Start/ }).click();
  await p.getByLabel('Set 1 weight in kilograms').first().waitFor({ timeout: 20000 });
  const more = await p.getByRole('button', { name: /^More for / }).first().getAttribute('aria-label');
  const lift = more.replace(/^More for /, '');
  await p.getByRole('button', { name: more, exact: true }).click();
  await p.getByRole('link', { name: `Swap ${lift} for something else` }).click();
  await p.getByRole('heading', { name: 'Swap exercise' }).waitFor({ timeout: 15000 });

  const scopes = await p.getByRole('group', { name: 'Swap for' }).getByRole('button').allTextContents();
  if (scopes[0] !== 'Today') throw new Error(`today only should come first, saw ${JSON.stringify(scopes)}`);
  const every = scopes.find(s => /^Every /.test(s));
  if (!every) throw new Error(`expected "Every <session>", saw ${JSON.stringify(scopes)}`);
  await p.getByRole('button', { name: every, exact: true }).click();
  const option = p.locator('main .ex-row').first();
  const picked = (await option.locator('strong').textContent()).trim();
  await option.click();
  await p.getByRole('button', { name: 'Add exercise' }).waitFor({ timeout: 15000 });

  const after = await readPlan();
  const session = every.replace(/^Every /, '');
  const changed = after.filter((s, i) => JSON.stringify(s.exercises) !== JSON.stringify(before[i].exercises));
  if (changed.length !== 1 || changed[0].session !== session) {
    throw new Error(`expected only ${session} to change, changed: ${JSON.stringify(changed.map(s => s.session))}`);
  }
  if (!changed[0].exercises.includes(picked)) throw new Error(`${session} should now have ${picked}`);
  await p.getByRole('button', { name: 'Finish', exact: true }).click();
  await p.getByRole('button', { name: 'Discard workout' }).click();
  await p.waitForTimeout(600);
});

// ---------------------------------------------------------------------------
// The calendar: page forward, look at a day, change it.
// ---------------------------------------------------------------------------

const calendar = () => p.getByRole('region', { name: 'Calendar' });
const shownWeek = () => calendar().getByRole('list').getAttribute('aria-label');

await step('the calendar pages forward through the block and back again', async () => {
  await p.goto(BASE, { waitUntil: 'networkidle' });
  await calendar().waitFor({ timeout: 15000 });
  await calendar().evaluate(el => el.scrollIntoView({ block: 'center' }));
  if (await shownWeek() !== 'This week') throw new Error('the calendar should open on this week');
  if (!(await calendar().getByRole('button', { name: 'Previous week' }).isDisabled())) {
    throw new Error('a block that starts this week has nothing before it');
  }

  await calendar().getByRole('button', { name: 'Next week' }).click();
  if (await shownWeek() !== 'Next week') throw new Error('Next week should page forward');
  let pages = 1;
  while (!(await calendar().getByRole('button', { name: 'Next week' }).isDisabled()) && pages < 10) {
    await calendar().getByRole('button', { name: 'Next week' }).click();
    pages += 1;
  }
  const last = (await calendar().locator('.cal-title').textContent()) ?? '';
  console.log(`       paged ${pages} weeks ahead to: ${last.trim()}`);
  if (pages < 4) throw new Error(`a five-week block should page at least four weeks ahead, paged ${pages}`);
  if (!/Deload/i.test(last)) throw new Error(`the last week of the block is the deload, saw ${last}`);

  // A swipe pages as well: drag to the right goes back a week.
  const box = await calendar().locator('.cal-swipe').boundingBox();
  await p.mouse.move(box.x + 60, box.y + box.height / 2);
  await p.mouse.down();
  await p.mouse.move(box.x + 230, box.y + box.height / 2, { steps: 6 });
  await p.mouse.up();
  await p.waitForTimeout(300);
  if (await calendar().getByRole('button', { name: 'Next week' }).isDisabled()) throw new Error('the swipe did not page back');
  if (await p.getByRole('dialog').count()) throw new Error('a swipe opened a day');
  while (await shownWeek() !== 'This week') await calendar().getByRole('button', { name: 'Previous week' }).click();
});
await p.screenshot({ path: 'e2e/shot-planswap-calendar.png' });

await step('a day next week opens its session, and a swap there changes that session', async () => {
  await calendar().getByRole('button', { name: 'Next week' }).click();
  const day = calendar().getByRole('list').getByRole('button', { name: /, planned$/ }).first();
  const label = await day.getAttribute('aria-label');
  const session = label.split(', ')[1];
  await day.click();
  const sheet = p.getByRole('dialog', { name: new RegExp(`^${session.replace(/[()]/g, '\\$&')}, `) });
  await sheet.waitFor();
  await sheet.getByRole('button', { name: 'Edit session' }).waitFor();
  const swaps = await sheet.getByRole('button', { name: /^Swap / }).count();
  if (swaps < 4) throw new Error(`expected a swap on every exercise, found ${swaps}`);

  const before = await readPlan();
  const lift = (await sheet.getByRole('button', { name: /^Swap / }).first().getAttribute('aria-label')).replace(/^Swap /, '');
  await sheet.getByRole('button', { name: `Swap ${lift}` }).click();
  const panel = p.getByRole('dialog', { name: `Swap ${lift}` });
  await panel.waitFor();
  const scopes = await panel.getByRole('group', { name: 'Swap for' }).getByRole('button').allTextContents().catch(() => []);
  if (scopes.length && scopes[0] !== `Just ${session}`) throw new Error(`"Just ${session}" should come first, saw ${JSON.stringify(scopes)}`);
  const option = panel.locator('.ex-row').first();
  const picked = (await option.locator('strong').textContent()).trim();
  await option.click();

  // Back on the day, showing the change.
  const again = p.getByRole('dialog', { name: new RegExp(`^${session.replace(/[()]/g, '\\$&')}, `) });
  await again.getByText(picked, { exact: true }).waitFor({ timeout: 5000 });
  const after = await readPlan();
  const changed = after.filter((s, i) => JSON.stringify(s.exercises) !== JSON.stringify(before[i].exercises));
  if (changed.length !== 1 || changed[0].session !== session) {
    throw new Error(`expected only ${session} to change, changed ${JSON.stringify(changed.map(s => s.session))}`);
  }
});
await p.screenshot({ path: 'e2e/shot-planswap-day.png' });

console.log(errs.length ? '\nBrowser errors:\n' + errs.join('\n') : '\nNo browser errors.');
await b.close();
process.exit(errs.length ? 1 : 0);
