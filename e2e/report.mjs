/**
 * The end of a block: the report, and the next block with its accessories
 * rotated.
 *
 * A finished block is seeded straight into IndexedDB — five weeks of sessions
 * with real sets, the main lifts climbing and the deload lighter — because
 * logging twenty sessions through the interface would test the logging
 * screen, not this. Display type is upper-cased by CSS, so text checks match
 * without case or read accessible names.
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

/** The plan's routine rows, in the browser's own database. */
const planRows = () => p.evaluate(async () => {
  const open = indexedDB.open('gymgo');
  const db = await new Promise((res, rej) => { open.onsuccess = () => res(open.result); open.onerror = () => rej(open.error); });
  const getAll = (name) => new Promise((res, rej) => { const r = db.transaction(name).objectStore(name).getAll(); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
  const plans = (await getAll('plans')).filter(x => x.deleted_at === null);
  const first = plans.sort((a, b) => a.started_at.localeCompare(b.started_at))[0];
  return (await getAll('routine_exercises'))
    .filter(row => row.deleted_at === null && first.routine_ids.includes(row.routine_id))
    .map(row => ({ id: row.id, exercise_id: row.exercise_id, low: row.rep_range_low, rir: row.target_rir }));
});

await p.goto(BASE, { waitUntil: 'networkidle' });
await step('app loads', async () => { await p.getByRole('heading', { name: 'Today' }).waitFor({ timeout: 40000 }); });

await step('build a four-day upper / lower plan', async () => {
  await p.goto(BASE + '#/plan/new/build_muscle', { waitUntil: 'networkidle' });
  await p.waitForTimeout(700);
  const href = await p.locator('a[href*="/plan/new/build_muscle/upper_lower"]').first().getAttribute('href');
  await p.goto(BASE + href.replace(/^#?\/?/, '#/').replace('##', '#'), { waitUntil: 'networkidle' });
  await p.waitForTimeout(500);
  await p.getByRole('button', { name: /Use this plan \(4 routines\)/i }).click();
  await p.waitForTimeout(1500);
});

const before = await planRows();

await step('train the whole block, the main lifts climbing and the deload lighter', async () => {
  const seeded = await p.evaluate(async () => {
    const open = indexedDB.open('gymgo');
    const db = await new Promise((res, rej) => { open.onsuccess = () => res(open.result); open.onerror = () => rej(open.error); });
    const getAll = (name) => new Promise((res, rej) => { const r = db.transaction(name).objectStore(name).getAll(); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
    const put = (name, row) => new Promise((res, rej) => { const r = db.transaction(name, 'readwrite').objectStore(name).put(row); r.onsuccess = res; r.onerror = () => rej(r.error); });

    const plan = (await getAll('plans')).find(x => x.completed_at === null);
    const start = Date.now() - 45 * 864e5;
    plan.started_at = new Date(start).toISOString();
    await put('plans', plan);

    const rows = (await getAll('routine_exercises')).filter(row => row.deleted_at === null);
    const sync = (at) => ({ user_id: null, created_at: at, updated_at: at, deleted_at: null });
    let sessions = 0;
    for (let week = 1; week <= plan.block_weeks; week += 1) {
      for (let index = 0; index < plan.training_days.length; index += 1) {
        const at = new Date(start + ((week - 1) * 7 + index * 1.5) * 864e5).toISOString();
        const workout = {
          id: crypto.randomUUID(), routine_id: plan.routine_ids[index], plan_id: plan.id,
          plan_week: week, plan_session_index: index, gym_id: null,
          started_at: at, finished_at: at, bodyweight_kg: null, readiness: null, notes: null, ...sync(at),
        };
        await put('workouts', workout);
        const mine = rows.filter(row => row.routine_id === plan.routine_ids[index]).sort((a, b) => a.position - b.position);
        for (const row of mine) {
          const we = {
            id: crypto.randomUUID(), workout_id: workout.id, exercise_id: row.exercise_id, position: row.position,
            superset_group: null, technique: 'straight', notes: null, rest_seconds: row.rest_seconds, tempo: null, ...sync(at),
          };
          await put('workout_exercises', we);
          const main = row.target_rir === 2;
          const deload = week === plan.block_weeks;
          const weight = main ? (deload ? 55 : 60 + 2.5 * (week - 1)) : 20 + (deload ? 0 : week - 1);
          for (let set = 0; set < row.target_sets; set += 1) {
            await put('sets', {
              id: crypto.randomUUID(), workout_exercise_id: we.id, parent_set_id: null, set_index: set,
              type: 'working', weight_kg: weight, reps: main ? 8 : 12, rir: null, is_amrap: false,
              completed: true, completed_at: at, ...sync(at),
            });
          }
        }
        sessions += 1;
      }
    }
    return sessions;
  });
  if (seeded !== 20) throw new Error(`expected twenty sessions, seeded ${seeded}`);
  await p.reload({ waitUntil: 'networkidle' });
  await p.waitForTimeout(1200);
});

await step('Today says the block is finished and offers its report', async () => {
  await p.goto(BASE + '#/', { waitUntil: 'networkidle' });
  const hero = p.getByRole('region', { name: 'Block finished' });
  await hero.waitFor({ timeout: 10000 });
  await p.screenshot({ path: 'e2e/shot-report-today.png' });
  await hero.getByRole('button', { name: 'See the block report' }).click();
  await p.getByRole('heading', { name: 'Block report' }).waitFor({ timeout: 10000 });
});

await step('the report counts the sessions', async () => {
  const stats = await p.locator('.stats').innerText();
  if (!/20\/20/.test(stats)) throw new Error(`expected 20/20 sessions, saw: ${stats.replace(/\n/g, ' | ')}`);
});

await step('each main lift shows its estimated max rising, deload left out', async () => {
  const lifts = p.getByRole('region', { name: 'Main lifts' });
  const names = await lifts.getByRole('link').evaluateAll(els => els.map(e => e.getAttribute('aria-label')));
  if (names.length < 2) throw new Error(`expected the main lifts, saw ${JSON.stringify(names)}`);
  for (const name of names) {
    const [, from, to] = name.match(/estimated max ([\d.]+) to ([\d.]+) kilograms/) ?? [];
    // 60 × 8 in week 1 to 67.5 × 8 in week 4. The deload's 55 must not end it.
    if (Number(from) !== 76 || Number(to) !== 85.5) throw new Error(`unexpected change: ${name}`);
  }
  if (!/deload week is left out/i.test(await lifts.innerText())) throw new Error('the deload should be called out');
});

await step('records and weekly sets against the target', async () => {
  const records = p.getByRole('region', { name: 'Records' });
  // Every lift climbed, so every lift set a record: eight on show, the rest a tap away.
  if ((await records.locator('.pr-row').count()) !== 8) throw new Error('the list should open on eight records');
  await records.getByRole('button', { name: /Show all \d+ records/ }).click();
  const rows = await records.locator('.pr-row').count();
  if (rows < 20) throw new Error(`expected a record for every lift that climbed, saw ${rows}`);
  // The main lifts lead.
  const first = await records.locator('.pr-row').first().innerText();
  const lead = await p.getByRole('region', { name: 'Main lifts' }).getByRole('link').first().getAttribute('aria-label');
  if (!lead.startsWith(first.split('\n').find((line) => line.trim() && line.trim() !== 'PR').trim())) {
    throw new Error(`records should lead with the main lifts: ${first} / ${lead}`);
  }
  const muscles = p.getByRole('region', { name: /Sets per muscle/i });
  const text = await muscles.innerText();
  if (!/Lines at 10 and 20 sets: the target for building muscle/i.test(text)) {
    throw new Error(`the bars should mark the goal's target: ${text.replace(/\n/g, ' | ').slice(0, 300)}`);
  }
  if (!/average of 4 training weeks, deload left out/i.test(text)) throw new Error('the average should say what it covers');
});
await p.locator('main').screenshot({ path: 'e2e/shot-report.png' });

let changes = 0;
await step('the next block shows what rotates before it starts', async () => {
  const next = p.getByRole('region', { name: 'Next block' });
  const toggle = next.getByRole('switch', { name: 'Rotate accessories' });
  if ((await toggle.getAttribute('aria-checked')) !== 'true') throw new Error('rotation should be on by default');
  await next.getByRole('button', { name: 'See what changes' }).click();
  changes = await next.getByRole('list', { name: 'Accessories that change' }).getByRole('listitem').count();
  if (changes < 6) throw new Error(`expected the accessories listed, saw ${changes}`);

  // Off keeps them, and says so.
  await toggle.click();
  if (!/Every exercise stays as it is/i.test(await next.innerText())) throw new Error('switching off should say nothing changes');
  await toggle.click();
});
await p.locator('main').screenshot({ path: 'e2e/shot-report-next.png' });

await step('Plan offers the same, from the finished card', async () => {
  await p.goto(BASE + '#/plan', { waitUntil: 'networkidle' });
  await p.waitForTimeout(900);
  const card = p.getByRole('region', { name: 'This block' });
  if (!/This block is finished/i.test(await card.innerText())) throw new Error('the block should read as finished');
  await card.getByRole('link', { name: 'See the block report' }).waitFor();
  await card.getByRole('switch', { name: 'Rotate accessories' }).waitFor();
  await card.screenshot({ path: 'e2e/shot-report-plan.png' });
});

await step('starting it keeps the main lifts and rotates the accessories', async () => {
  await p.getByRole('region', { name: 'This block' }).getByRole('button', { name: 'Start the next block' }).click();
  await p.getByRole('heading', { name: 'Today' }).waitFor({ timeout: 10000 });
  await p.waitForTimeout(600);

  const after = new Map((await planRows()).map(row => [row.id, row]));
  let rotated = 0;
  for (const row of before) {
    const now = after.get(row.id);
    if (!now) throw new Error('a routine row went missing');
    const accessory = row.rir === 1;
    if (!accessory && now.exercise_id !== row.exercise_id) throw new Error('a main lift changed');
    if (accessory && now.exercise_id !== row.exercise_id) rotated += 1;
  }
  if (rotated !== changes) throw new Error(`the preview listed ${changes} changes, ${rotated} happened`);
});

await step('the finished block keeps its report under Progress', async () => {
  await p.goto(BASE + '#/progress', { waitUntil: 'networkidle' });
  await p.waitForTimeout(900);
  const past = p.getByRole('region', { name: 'Past blocks' });
  await past.getByRole('link').first().click();
  await p.getByRole('heading', { name: 'Block report' }).waitFor({ timeout: 10000 });
  if (await p.getByRole('region', { name: 'Next block' }).count()) throw new Error('a past block must not offer to start another');
});

await step('the new block has a report of its own, so far', async () => {
  await p.goto(BASE + '#/progress', { waitUntil: 'networkidle' });
  await p.waitForTimeout(900);
  await p.getByRole('link', { name: 'See the block so far' }).click();
  await p.getByRole('heading', { name: 'Block so far' }).waitFor({ timeout: 10000 });
  if (!/Nothing was trained in this block/i.test(await p.locator('main').innerText())) {
    throw new Error('a block with nothing trained should say so');
  }
});

console.log(errs.length ? '\nBrowser errors:\n' + errs.join('\n') : '\nNo browser errors.');
await b.close();
process.exit(errs.length ? 1 : 0);
