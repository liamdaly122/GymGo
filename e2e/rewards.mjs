/**
 * Records and rewards: the flash on Done, the blue chips, and what a finished
 * session earns — XP, the level, the weekly streak and the badges.
 *
 * History is seeded straight into IndexedDB. The flash needs a record to
 * beat, and the streak needs weeks behind it; logging those sessions through
 * the interface would test the logging screen, not this. Display type is
 * upper-cased by CSS, so text checks match case-insensitively or read
 * accessible names.
 *
 * Run at 375 × 667, the smallest phone the app supports, so the record on the
 * rest screen is proved to fit above the buttons.
 */
import { chromium } from 'playwright';

const BASE = process.env.BASE_URL ?? 'http://127.0.0.1:5185/';
const b = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const c = await b.newContext({ viewport: { width: 375, height: 667 }, deviceScaleFactor: 2 });
const p = await c.newPage();
const errs = [];
p.on('pageerror', e => errs.push('pageerror: ' + e.message));
p.on('console', m => { if (m.type()==='error' && !/Failed to load resource/i.test(m.text())) errs.push('console: '+m.text()); });
const step = async (l, fn) => { try { await fn(); console.log('  ok   '+l); } catch(e) { console.log('  FAIL '+l+': '+e.message); throw e; } };

const BENCH = 'Barbell Bench Press - Medium Grip';
const PULL_UPS = 'Pullups';

/**
 * Finished sessions, straight into the browser's database. Each is
 * `{ daysAgo, lifts: [[exerciseName, [[kg, reps], …]], …] }`.
 */
const seed = (sessions) => p.evaluate(async (sessions) => {
  const open = indexedDB.open('gymgo');
  const db = await new Promise((res, rej) => { open.onsuccess = () => res(open.result); open.onerror = () => rej(open.error); });
  const getAll = (name) => new Promise((res, rej) => { const r = db.transaction(name).objectStore(name).getAll(); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
  const put = (name, row) => new Promise((res, rej) => { const r = db.transaction(name, 'readwrite').objectStore(name).put(row); r.onsuccess = res; r.onerror = () => rej(r.error); });
  const exercises = await getAll('exercises');
  const sync = (at) => ({ user_id: null, created_at: at, updated_at: at, deleted_at: null });

  for (const session of sessions) {
    const start = new Date(Date.now() - session.daysAgo * 864e5);
    start.setHours(session.hour ?? 18, 0, 0, 0);
    const at = start.toISOString();
    const finished = new Date(start.getTime() + 3600e3).toISOString();
    const workout = {
      id: crypto.randomUUID(), routine_id: null, plan_id: null, plan_week: null, plan_session_index: null,
      gym_id: null, started_at: at, finished_at: finished, bodyweight_kg: null, readiness: null, notes: null, ...sync(at),
    };
    await put('workouts', workout);
    for (const [position, [name, sets]] of session.lifts.entries()) {
      const exercise = exercises.find(e => e.name === name);
      if (!exercise) throw new Error(`no exercise called ${name}`);
      const we = {
        id: crypto.randomUUID(), workout_id: workout.id, exercise_id: exercise.id, position,
        superset_group: null, technique: 'straight', notes: null, rest_seconds: null, tempo: null, ...sync(at),
      };
      await put('workout_exercises', we);
      for (const [index, [kg, reps]] of sets.entries()) {
        await put('sets', {
          id: crypto.randomUUID(), workout_exercise_id: we.id, parent_set_id: null, set_index: index,
          type: 'working', weight_kg: kg, reps, rir: null, is_amrap: false,
          completed: true, completed_at: at, ...sync(at),
        });
      }
    }
  }
}, sessions);

const addExercise = async (search, name) => {
  await p.getByRole('button', { name: 'Add exercise' }).click();
  await p.getByPlaceholder('Add exercise').fill(search);
  await p.getByRole('button', { name: new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`) }).first().click();
  await p.waitForTimeout(400);
};

const logSet = async (n, kg, reps) => {
  if (kg !== null) await p.getByLabel(`Set ${n} weight in kilograms`).fill(String(kg));
  await p.getByLabel(`Set ${n} repetitions`).fill(String(reps));
  await p.getByRole('button', { name: new RegExp(`^Mark set ${n} done`) }).click();
  await p.waitForTimeout(500);
};

const rest = () => p.getByRole('dialog', { name: 'Rest' });

await p.goto(BASE, { waitUntil: 'networkidle' });
await step('app loads', async () => { await p.getByRole('heading', { name: 'Today' }).waitFor({ timeout: 40000 }); });

await step('seed a bench press and some pull-ups to beat', async () => {
  await seed([{ daysAgo: 3, lifts: [[BENCH, [[100, 5], [100, 5]]], [PULL_UPS, [[0, 10]]]] }]);
  await p.reload({ waitUntil: 'networkidle' });
  await p.getByRole('heading', { name: 'Today' }).waitFor({ timeout: 20000 });
});

await step('a heavier set flashes a record on the rest screen', async () => {
  await p.getByRole('button', { name: 'Start empty workout' }).click();
  await addExercise('barbell bench press', BENCH);
  await logSet(1, 102.5, 5);
  const news = rest().getByRole('status');
  await news.waitFor({ timeout: 5000 });
  const text = await news.innerText();
  if (!/new record/i.test(text) || !/heaviest ever/i.test(text) || !/was 100kg/i.test(text)) {
    throw new Error(`expected the record and what it beat, saw: ${text.replace(/\n/g, ' | ')}`);
  }
  await p.screenshot({ path: 'e2e/shot-record.png' });
});

await step('the record fits above the rest buttons on a small phone', async () => {
  const skip = await rest().getByRole('button', { name: 'Skip rest' }).boundingBox();
  const record = await rest().getByRole('status').boundingBox();
  if (!skip || skip.y + skip.height > 667) throw new Error(`Skip rest is off the screen: ${JSON.stringify(skip)}`);
  if (!record || record.y < 0) throw new Error(`the record is off the screen: ${JSON.stringify(record)}`);
});

await step('the record set’s chip is lit and says so', async () => {
  await rest().getByRole('button', { name: 'Skip rest' }).click();
  await p.waitForTimeout(300);
  await p.getByRole('button', { name: 'Edit set 1, 102.5kg × 5, done, record' }).waitFor({ timeout: 3000 });
});

await step('equalling it today is not another record', async () => {
  await p.getByRole('button', { name: 'Add set' }).click();
  await p.waitForTimeout(300);
  await logSet(2, 102.5, 5);
  await rest().waitFor({ timeout: 5000 });
  if (await rest().getByRole('status').count()) throw new Error('a tie flashed as a record');
  await rest().getByRole('button', { name: 'Skip rest' }).click();
  await p.waitForTimeout(300);
  await p.getByRole('button', { name: 'Edit set 2, 102.5kg × 5, done' }).waitFor({ timeout: 3000 });
});

await step('more pull-ups with nothing added is a record too', async () => {
  await addExercise('pullups', PULL_UPS);
  // Nothing added: 0 typed over whatever the placeholder suggests.
  await logSet(1, 0, 12);
  const news = rest().getByRole('status');
  await news.waitFor({ timeout: 5000 });
  const text = await news.innerText();
  if (!/most reps/i.test(text) || !/was 10/i.test(text)) {
    throw new Error(`expected a reps record, saw: ${text.replace(/\n/g, ' | ')}`);
  }
  await rest().getByRole('button', { name: 'Skip rest' }).click();
  await p.waitForTimeout(300);
});

await step('a record in the first half of a superset round gets the toast', async () => {
  await p.getByRole('button', { name: 'Finish', exact: true }).click();
  await p.getByRole('button', { name: 'Finish and save' }).click();
  await p.waitForTimeout(800);
  await p.goto(BASE + '#/', { waitUntil: 'networkidle' });
  await p.getByRole('button', { name: 'Start empty workout' }).click();
  await addExercise('barbell bench press', BENCH);
  await addExercise('pullups', PULL_UPS);
  await p.getByRole('button', { name: /Barbell Bench Press - Medium Grip, \d+ of \d+ sets done/ }).click();
  await p.getByRole('button', { name: `More for ${BENCH}` }).click();
  await p.getByRole('button', { name: /Superset with next/i }).click();
  await p.waitForTimeout(400);
  await logSet(1, 105, 3);
  const toast = p.locator('.toast.hot');
  await toast.waitFor({ timeout: 3000 });
  const text = await toast.innerText();
  if (!/new record/i.test(text) || !/105kg × 3/.test(text)) throw new Error(`expected the record toast, saw: ${text}`);
  if (await p.getByRole('timer').count()) throw new Error('the first half of a round should go straight on, not rest');
});

await step('in Pro, the record and the technique row both fit a small phone', async () => {
  await p.goto(BASE + '#/settings', { waitUntil: 'networkidle' });
  await p.getByRole('button', { name: /^Pro$/i }).first().click();
  await p.waitForTimeout(400);
  await p.goBack();
  await p.waitForTimeout(800);
  // The pull-ups are the second half of the round, so a rest follows them.
  await logSet(1, 0, 13);
  await rest().getByRole('status').waitFor({ timeout: 5000 });
  const techniques = await rest().getByRole('group', { name: 'Add to the set just done' }).boundingBox();
  const shorten = await rest().getByRole('button', { name: /−30s/ }).boundingBox();
  const skip = await rest().getByRole('button', { name: 'Skip rest' }).boundingBox();
  await p.screenshot({ path: 'e2e/shot-record-pro.png' });
  if (!techniques || !shorten || techniques.y + techniques.height + 8 > shorten.y) {
    throw new Error(`the technique row runs into the rest buttons: ${JSON.stringify({ techniques, shorten })}`);
  }
  if (!skip || skip.y + skip.height > 667) throw new Error(`Skip rest is off the screen: ${JSON.stringify(skip)}`);
  await rest().getByRole('button', { name: 'Skip rest' }).click();
});

if (errs.length) { console.log('ERRORS:\n' + errs.join('\n')); await b.close(); process.exit(1); }
await b.close();
console.log('rewards: all steps passed');
