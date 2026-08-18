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

console.log(errors.length ? `\nBrowser errors:\n${errors.join('\n')}` : '\nNo browser errors.');
await browser.close();
process.exit(errors.length ? 1 : 0);
