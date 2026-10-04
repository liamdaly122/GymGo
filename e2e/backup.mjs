/**
 * The brief's step 10, automated: back a phone up, wipe it, and restore
 * everything from Supabase.
 *
 * Self-contained. It starts a stand-in Supabase (scripts/fake-supabase.ts —
 * real Postgres with the real migrations, row level security and all), builds
 * a copy of the app pointed at it, serves that, and drives the real supabase-js
 * client in a real browser: sign in with an emailed code, see a workout logged
 * before signing in reach the server, then a brand-new phone — a fresh browser
 * context, storage and all — sign in and get it back.
 *
 * A live project still has to be checked by hand once (supabase/README.md);
 * this is everything short of that.
 */
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const SUPABASE_PORT = Number(process.env.SUPABASE_PORT ?? 54329);
const APP_PORT = Number(process.env.APP_PORT ?? 5191);
const SUPABASE = `http://127.0.0.1:${SUPABASE_PORT}`;
const BASE = `http://127.0.0.1:${APP_PORT}/`;
const EMAIL = 'lifter@example.com';

const children = [];
const outDir = mkdtempSync(join(tmpdir(), 'gymgo-backup-'));
const cleanup = () => {
  for (const child of children) {
    try { process.kill(-child.pid, 'SIGTERM'); } catch { /* already gone */ }
  }
  rmSync(outDir, { recursive: true, force: true });
};
process.on('exit', cleanup);

const bin = (name) => join(ROOT, 'node_modules', '.bin', name);

/** Starts a long-running process and resolves once its output says it is ready. */
const start = (command, args, env, ready) =>
  new Promise((resolveStart, reject) => {
    const child = spawn(command, args, { cwd: ROOT, env: { ...process.env, ...env }, detached: true });
    children.push(child);
    let output = '';
    const timer = setTimeout(() => reject(new Error(`${command} was not ready: ${output}`)), 120000);
    const onData = (data) => {
      output += data;
      if (ready.test(output)) { clearTimeout(timer); resolveStart(child); }
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    child.on('exit', (code) => { clearTimeout(timer); reject(new Error(`${command} exited ${code}: ${output}`)); });
  });

/** Runs a command to completion. */
const run = (command, args, env) =>
  new Promise((resolveRun, reject) => {
    const child = spawn(command, args, { cwd: ROOT, env: { ...process.env, ...env } });
    let output = '';
    child.stdout.on('data', (data) => { output += data; });
    child.stderr.on('data', (data) => { output += data; });
    child.on('exit', (code) => (code === 0 ? resolveRun(output) : reject(new Error(`${command} failed: ${output}`))));
  });

const step = async (label, fn) => {
  try { await fn(); console.log('  ok   ' + label); } catch (e) { console.log('  FAIL ' + label + ': ' + e.message); throw e; }
};

const server = async (path) => (await fetch(`${SUPABASE}${path}`)).json();

await step('start a stand-in Supabase on real Postgres', async () => {
  await start(bin('tsx'), ['scripts/fake-supabase.ts', '--port', String(SUPABASE_PORT)], {}, /listening/);
});

await step('build the app pointed at it, and serve it', async () => {
  await run(bin('vite'), ['build', '--outDir', outDir, '--emptyOutDir'], {
    VITE_SUPABASE_URL: SUPABASE,
    VITE_SUPABASE_ANON_KEY: 'stand-in-anon-public-key',
  });
  await start(
    bin('vite'),
    ['preview', '--outDir', outDir, '--port', String(APP_PORT), '--strictPort', '--host', '127.0.0.1'],
    {},
    /Local/,
  );
});

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
});
const errs = [];

/** A phone: its own storage, as a home-screen install has. */
async function newPhone() {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  const page = await context.newPage();
  page.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
  page.on('console', (m) => {
    if (m.type() === 'error' && !/Failed to load resource|navigator\.vibrate/i.test(m.text())) errs.push('console: ' + m.text());
  });
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.getByRole('heading', { name: 'Today' }).waitFor({ timeout: 40000 });
  return { context, page };
}

const backupSection = (page) => page.getByRole('region', { name: 'Backup' });

/** Settings → email → code (read from the stand-in, as from an inbox) → signed in. */
async function signIn(page, screenshot = null) {
  await page.goto(BASE + '#/settings', { waitUntil: 'networkidle' });
  const section = backupSection(page);
  await section.getByLabel('Email address').fill(EMAIL);
  await section.getByRole('button', { name: 'Email me a code' }).click();
  await section.getByLabel('Sign-in code').waitFor({ timeout: 15000 });
  if (screenshot) {
    await section.scrollIntoViewIfNeeded();
    await page.screenshot({ path: screenshot });
  }
  const { code } = await server(`/__test/code?email=${encodeURIComponent(EMAIL)}`);
  if (!code) throw new Error('the stand-in never received a sign-in request');
  await section.getByLabel('Sign-in code').fill(code);
  await section.getByRole('button', { name: 'Sign in', exact: true }).click();
}

/** Waits for the round to finish with nothing left to send. */
async function waitUntilBackedUp(page) {
  const status = backupSection(page).getByRole('status').first();
  await page.waitForFunction(
    (el) => el && /^Backed up$/.test(el.textContent?.trim() ?? ''),
    await status.elementHandle({ timeout: 30000 }),
    { timeout: 60000 },
  );
}

const localSets = (page) =>
  page.evaluate(async () => {
    const open = indexedDB.open('gymgo');
    const db = await new Promise((res, rej) => { open.onsuccess = () => res(open.result); open.onerror = () => rej(open.error); });
    const getAll = (name) => new Promise((res, rej) => { const r = db.transaction(name).objectStore(name).getAll(); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
    const sets = await getAll('sets');
    return sets.filter((s) => s.completed && s.deleted_at === null).map((s) => `${s.weight_kg}x${s.reps}`).sort();
  });

// ---------------------------------------------------------------------------
// The phone in use: training logged before backup was ever switched on.
// ---------------------------------------------------------------------------

const phone = await newPhone();
const { page } = phone;

await step('log a workout before signing in', async () => {
  await page.getByRole('button', { name: 'Start empty workout' }).click();
  await page.getByRole('button', { name: 'Add exercise' }).click();
  await page.getByPlaceholder('Add exercise').fill('barbell bench press');
  await page.getByRole('button', { name: /^Barbell Bench Press - Medium Grip/ }).first().click();
  await page.getByLabel('Set 1 weight in kilograms').first().waitFor({ timeout: 20000 });
  await page.getByLabel('Set 1 weight in kilograms').fill('60');
  await page.getByLabel('Set 1 repetitions').fill('10');
  await page.getByLabel(/Mark set 1 done/).click();
  await page.waitForTimeout(300);
  if (await page.getByRole('button', { name: 'Skip rest' }).count()) await page.getByRole('button', { name: 'Skip rest' }).click();
  await page.getByRole('button', { name: 'Add set' }).first().click();
  await page.getByLabel('Set 2 weight in kilograms').fill('62.5');
  await page.getByLabel('Set 2 repetitions').fill('8');
  await page.getByLabel(/Mark set 2 done/).click();
  await page.waitForTimeout(300);
  if (await page.getByRole('button', { name: 'Skip rest' }).count()) await page.getByRole('button', { name: 'Skip rest' }).click();
  await page.getByRole('button', { name: 'Finish', exact: true }).click();
  await page.getByRole('button', { name: 'Finish and save' }).click();
  await page.waitForTimeout(800);
  const sets = await localSets(page);
  if (sets.join() !== '60x10,62.5x8') throw new Error(`expected two logged sets, got ${sets}`);
});

await step('Settings offers a sign-in, not a setup message', async () => {
  await page.goto(BASE + '#/settings', { waitUntil: 'networkidle' });
  const text = await backupSection(page).textContent();
  if (!/Sign in to back up this phone/.test(text)) throw new Error(`unexpected Backup section: ${text}`);
});

await step('sign in with the emailed code', async () => {
  await signIn(page, 'e2e/shot-backup-code.png');
  await waitUntilBackedUp(page);
});
await page.screenshot({ path: 'e2e/shot-backup-signed-in.png' });

await step('the workout, its sets and the library reached the server', async () => {
  const workouts = (await server('/__test/rows?table=workouts')).filter((w) => w.deleted_at === null);
  if (workouts.length !== 1 || !workouts[0].finished_at) throw new Error(`expected one finished workout, got ${JSON.stringify(workouts)}`);
  const sets = (await server('/__test/rows?table=sets'))
    .filter((s) => s.completed && s.deleted_at === null)
    .map((s) => `${s.weight_kg}x${s.reps}`)
    .sort();
  if (sets.join() !== '60x10,62.5x8') throw new Error(`expected both sets on the server, got ${sets}`);
  const exercises = await server('/__test/rows?table=exercises');
  if (exercises.length < 600) throw new Error(`the first backup should send the whole library, sent ${exercises.length}`);
  const settings = await server('/__test/rows?table=settings');
  if (settings.length !== 1) throw new Error('settings should be backed up');
});

await step('a change made later is backed up too', async () => {
  await page.goto(BASE + '#/settings', { waitUntil: 'networkidle' });
  // Pro mode, through the interface: a settings change the restore must keep.
  await page.getByRole('group', { name: /mode/i }).getByRole('button', { name: /Pro/ }).click();
  await page.getByRole('region', { name: 'Backup' }).getByRole('button', { name: 'Back up now' }).click();
  await waitUntilBackedUp(page);
  const [settings] = await server('/__test/rows?table=settings');
  if (settings.mode !== 'pro') throw new Error(`the server should have Pro mode, has ${settings.mode}`);
});

await phone.context.close();

// ---------------------------------------------------------------------------
// A new phone: nothing on it but the app.
// ---------------------------------------------------------------------------

const fresh = await newPhone();

await step('a new phone starts empty', async () => {
  const sets = await localSets(fresh.page);
  if (sets.length !== 0) throw new Error('a fresh install should have no history');
});

await step('signing in restores everything', async () => {
  await signIn(fresh.page);
  await backupSection(fresh.page).getByText(/Restored 1 workout from your backup/).waitFor({ timeout: 30000 });
  await waitUntilBackedUp(fresh.page);
  const sets = await localSets(fresh.page);
  if (sets.join() !== '60x10,62.5x8') throw new Error(`expected both sets back, got ${sets}`);
});
await fresh.page.screenshot({ path: 'e2e/shot-backup-restored.png' });

await step('the restored settings win over the new phone\'s defaults', async () => {
  const pro = await fresh.page.getByRole('group', { name: /mode/i }).getByRole('button', { name: /Pro/ }).getAttribute('aria-pressed');
  if (pro !== 'true') throw new Error('Pro mode should have come back');
  const [settings] = await server('/__test/rows?table=settings');
  if (settings.mode !== 'pro') throw new Error('the new phone must not push its defaults over the backup');
});

await step('there is still one gym, not a second starter gym', async () => {
  const gyms = (await server('/__test/rows?table=gyms')).filter((g) => g.deleted_at === null);
  if (gyms.length !== 1) throw new Error(`expected one gym on the server, got ${gyms.length}`);
  await fresh.page.goto(BASE + '#/gyms', { waitUntil: 'networkidle' });
  await fresh.page.locator('a[href*="#/gyms/"]').first().waitFor({ timeout: 10000 });
  const listed = await fresh.page.locator('a[href*="#/gyms/"]').count();
  if (listed !== 1) throw new Error(`expected one gym on the phone, got ${listed}`);
});

await step('the restored session is in history', async () => {
  await fresh.page.goto(BASE, { waitUntil: 'networkidle' });
  const body = await fresh.page.locator('body').innerText();
  if (/Nothing logged yet/i.test(body)) throw new Error('Today should list the restored workout');
});

console.log(errs.length ? '\nBrowser errors:\n' + errs.join('\n') : '\nNo browser errors.');
await browser.close();
process.exit(errs.length ? 1 : 0);
