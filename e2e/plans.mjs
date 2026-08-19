/**
 * Drives the plan selector end to end: goal, days, split, preview, and the
 * routines it writes. Run against `npm run dev`.
 */
import { chromium } from 'playwright';
const BASE = process.env.BASE_URL ?? 'http://127.0.0.1:5180/';
const b = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const c = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
const p = await c.newPage();
const errs = [];
p.on('pageerror', e => errs.push('pageerror: ' + e.message));
p.on('console', m => { if (m.type()==='error' && !/Failed to load resource/i.test(m.text())) errs.push('console: '+m.text()); });
const step = async (l, fn) => { try { await fn(); console.log('  ok   '+l); } catch(e) { console.log('  FAIL '+l+': '+e.message); throw e; } };

await p.goto(BASE, { waitUntil: 'networkidle' });
await step('app loads', async () => { await p.getByRole('heading', {name:'Train'}).waitFor({timeout:40000}); });

await step('Plans is a bottom tab', async () => {
  await p.getByRole('link', { name: 'Plans', exact: true }).click();
  await p.getByRole('heading', { name: 'Plans' }).waitFor();
});

await step('six goals offered', async () => {
  const n = await p.locator('a[href*="#/plans/"]').count();
  if (n !== 6) throw new Error('expected 6 goal cards, got ' + n);
});
await p.screenshot({ path: 'e2e/shot-plans.png' });

await step('pick Build muscle', async () => {
  await p.getByRole('link', { name: /Build muscle/ }).click();
  await p.getByRole('heading', { name: 'Build muscle' }).waitFor();
});

await step('day picker offers 2 to 6', async () => {
  for (const d of ['2','3','4','5','6']) await p.getByRole('button', { name: d, exact: true }).waitFor();
});

await step('choosing 6 days offers only push/pull/legs', async () => {
  await p.getByRole('button', { name: '6', exact: true }).click();
  await p.waitForTimeout(700);
  const body = await p.locator('body').innerText();
  if (!/Push \/ Pull \/ Legs/.test(body)) throw new Error('expected PPL at 6 days');
  if (/Bro split/.test(body)) throw new Error('bro split should not be offered at 6 days');
});

await step('choosing 5 days offers the bro split', async () => {
  await p.getByRole('button', { name: '5', exact: true }).click();
  await p.waitForTimeout(700);
  const body = await p.locator('body').innerText();
  if (!/Bro split/.test(body)) throw new Error('expected the bro split at 5 days');
  if (!/6 to 8 hard/.test(body)) throw new Error('expected the bro split trade-off to be stated');
});
await p.screenshot({ path: 'e2e/shot-splits.png' });

await step('open the 6-day push/pull/legs preview', async () => {
  await p.getByRole('button', { name: '6', exact: true }).click();
  await p.waitForTimeout(500);
  await p.getByRole('link', { name: /Push \/ Pull \/ Legs/ }).click();
  await p.getByRole('heading', { name: 'Push / Pull / Legs' }).waitFor({ timeout: 15000 });
  await p.waitForTimeout(600);
});

await step('preview shows six days with real staple lifts', async () => {
  const body = await p.locator('body').innerText();
  for (const d of ['Day 1','Day 2','Day 3','Day 4','Day 5','Day 6']) if (!body.includes(d)) throw new Error('missing '+d);
  if (!/Push A/.test(body) || !/Push B/.test(body)) throw new Error('repeated sessions not labelled A/B');
  if (!/(Bench Press|Squat|Deadlift|Pulldown|Pullups)/.test(body)) throw new Error('no staple lifts in the preview');
  if (/guillotine|frankenstein/i.test(body)) throw new Error('specialist variant leaked into the plan');
});

await step('preview states weekly volume', async () => {
  const body = await p.locator('body').innerText();
  if (!/10 to 20 hard sets/.test(body)) throw new Error('expected the volume guidance');
});
await p.screenshot({ path: 'e2e/shot-preview.png', fullPage: false });

let before = 0;
await step('count routines before', async () => {
  before = await p.evaluate(async () => {
    const open = indexedDB.open('gymgo');
    const db = await new Promise((res, rej) => { open.onsuccess = () => res(open.result); open.onerror = () => rej(open.error); });
    return await new Promise((res, rej) => { const r = db.transaction('routines').objectStore('routines').getAll(); r.onsuccess = () => res(r.result.length); r.onerror = () => rej(r.error); });
  });
});

await step('"Use this plan" builds six routines', async () => {
  await p.getByRole('button', { name: /Use this plan/ }).click();
  await p.getByRole('heading', { name: 'Routines' }).waitFor({ timeout: 20000 });
  await p.waitForTimeout(1200);
  const after = await p.evaluate(async () => {
    const open = indexedDB.open('gymgo');
    const db = await new Promise((res, rej) => { open.onsuccess = () => res(open.result); open.onerror = () => rej(open.error); });
    const get = (s) => new Promise((res, rej) => { const r = db.transaction(s).objectStore(s).getAll(); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
    const [routines, res, plans] = await Promise.all([get('routines'), get('routine_exercises'), get('plans')]);
    return { routines: routines.length, exercises: res.length, plans: plans.length };
  });
  console.log('       after: ' + JSON.stringify(after));
  if (after.routines - before !== 6) throw new Error('expected 6 new routines, got ' + (after.routines - before));
  if (after.plans !== 1) throw new Error('expected 1 plan row, got ' + after.plans);
  if (after.exercises < 30) throw new Error('expected ~36 routine exercises, got ' + after.exercises);
});

await step('a generated routine starts a workout like any other', async () => {
  await p.getByRole('link', { name: /Push A/ }).first().click();
  await p.getByRole('button', { name: 'Start this workout' }).waitFor({ timeout: 15000 });
  await p.getByRole('button', { name: 'Start this workout' }).click();
  await p.getByLabel('Set 1 weight in kilograms').first().waitFor({ timeout: 15000 });
  const body = await p.locator('body').innerText();
  if (!/(Bench Press|Press|Dips)/.test(body)) throw new Error('workout did not carry the plan exercises');
});
await p.screenshot({ path: 'e2e/shot-plan-workout.png' });

console.log(errs.length ? '\nBrowser errors:\n' + errs.join('\n') : '\nNo browser errors.');
await b.close();
process.exit(errs.length ? 1 : 0);
