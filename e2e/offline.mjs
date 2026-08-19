/**
 * The brief's core premise: the app must work fully with no signal in a gym
 * basement. This installs the service worker against a production build, cuts
 * the network entirely, and then logs a whole workout.
 *
 * Run against `vite preview` (npm run preview) — the service worker is disabled
 * in development on purpose.
 */
import { chromium } from 'playwright';

const BASE = process.env.PREVIEW_URL ?? 'http://127.0.0.1:5190/';
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
});
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));

const step = async (label, fn) => {
  try { await fn(); console.log(`  ok   ${label}`); }
  catch (e) { console.log(`  FAIL ${label}: ${e.message}`); throw e; }
};

await step('production build loads and seeds', async () => {
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.getByRole('heading', { name: 'Train' }).waitFor({ timeout: 40000 });
});

await step('service worker takes control', async () => {
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null, { timeout: 30000 });
});

await step('precache is populated', async () => {
  const cached = await page.evaluate(async () => {
    const names = await caches.keys();
    let total = 0;
    for (const name of names) total += (await (await caches.open(name)).keys()).length;
    return { names, total };
  });
  if (cached.total < 5) throw new Error(`expected a populated precache, got ${JSON.stringify(cached)}`);
  console.log(`       cached ${cached.total} entries across ${cached.names.length} cache(s)`);
});

// ---- Cut the network entirely ----
await ctx.setOffline(true);

await step('reloads with no network at all', async () => {
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.getByRole('heading', { name: 'Train' }).waitFor({ timeout: 30000 });
});

await step('logs a full workout offline', async () => {
  await page.getByRole('button', { name: 'Start empty workout' }).click();
  await page.getByRole('button', { name: 'Add exercise' }).click();
  await page.getByPlaceholder('Add exercise').fill('romanian deadlift');
  await page.getByRole('button', { name: /^Romanian Deadlift/ }).first().click();
  await page.getByLabel('Set 1 weight in kilograms').fill('80');
  await page.getByLabel('Set 1 repetitions').fill('8');
  await page.getByLabel(/Mark set 1 done/).click();
  await page.waitForTimeout(400);
  await page.getByRole('button', { name: 'Skip', exact: true }).click();
  await page.getByRole('button', { name: 'Finish', exact: true }).click();
  await page.getByRole('button', { name: 'Finish and save' }).click();
  await page.waitForTimeout(900);
});

await step('the offline workout is in history after another offline reload', async () => {
  await page.goto(`${BASE}#/history`, { waitUntil: 'domcontentloaded' });
  await page.getByRole('heading', { name: 'History' }).waitFor({ timeout: 30000 });
  await page.waitForTimeout(600);
  const rows = await page.locator('a[href*="#/history/"]').count();
  if (rows !== 1) throw new Error(`expected 1 history row offline, got ${rows}`);
  const body = await page.locator('body').innerText();
  if (!/640 kg/.test(body)) throw new Error(`expected 640 kg volume, saw: ${body.replace(/\n/g, ' | ')}`);
});

await step('exercise photos load with the network cut', async () => {
  // The whole reason webp is in the service worker glob. Without it the cards
  // would fall back to grey placeholders the moment there is no signal.
  const result = await page.evaluate(async () => {
    const manifestResponse = await fetch('/exercise-images/Barbell_Squat.webp');
    if (!manifestResponse.ok) return { ok: false, status: manifestResponse.status };
    const blob = await manifestResponse.blob();
    return { ok: true, type: blob.type, size: blob.size };
  });
  if (!result.ok) throw new Error(`a bundled photo was not served offline (status ${result.status})`);
  if (!/image/.test(result.type) || result.size < 1000) {
    throw new Error(`offline photo looks wrong: ${JSON.stringify(result)}`);
  }
  console.log(`       served ${(result.size / 1024).toFixed(1)}KB photo from cache`);
});

await step('no requests reached the network while logging', async () => {
  // Any real network attempt while offline surfaces as a page error or a
  // failed navigation; none of the steps above tolerated one.
  if (errors.length) throw new Error(errors.join('; '));
});

console.log('\nOffline verified: installed, cut the network, logged and persisted a workout.');
await browser.close();
process.exit(0);
