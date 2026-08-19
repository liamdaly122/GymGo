/**
 * Drives the smart layer: build a plan, see it on the calendar, log week 1,
 * and confirm the progression engine suggests the next jump.
 */
import { chromium } from 'playwright';

const BASE = process.env.BASE_URL ?? 'http://127.0.0.1:5183/';
const b = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const c = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
const p = await c.newPage();
const errs = [];
p.on('pageerror', e => errs.push('pageerror: ' + e.message));
p.on('console', m => { if (m.type()==='error' && !/Failed to load resource/i.test(m.text())) errs.push('console: '+m.text()); });
const step = async (l, fn) => { try { await fn(); console.log('  ok   '+l); } catch(e) { console.log('  FAIL '+l+': '+e.message); throw e; } };

await p.goto(BASE, { waitUntil: 'networkidle' });
await step('app loads', async () => { await p.getByRole('heading', {name:'Train'}).waitFor({timeout:40000}); });

await step('build a 3-day plan', async () => {
  await p.getByRole('link', { name: 'Plans', exact: true }).click();
  await p.getByRole('link', { name: /Build muscle/ }).click();
  await p.getByRole('button', { name: '3', exact: true }).click();
  await p.waitForTimeout(600);
  await p.getByRole('link', { name: /Push \/ Pull \/ Legs/ }).click();
  await p.getByRole('button', { name: /Use this plan/ }).waitFor({ timeout: 20000 });
  await p.getByRole('button', { name: /Use this plan/ }).click();
  await p.getByRole('heading', { name: 'Routines' }).waitFor({ timeout: 20000 });
  await p.waitForTimeout(800);
});

await step('the block appears on the Train calendar', async () => {
  await p.getByRole('link', { name: 'Train', exact: true }).click();
  await p.getByRole('heading', { name: 'Train' }).waitFor();
  await p.waitForTimeout(1000);
  const body = await p.locator('body').innerText();
  if (!/Week 1\/5 — Foundations/.test(body)) throw new Error(`expected the week label, saw: ${body.replace(/\n/g,' | ').slice(0,400)}`);
  if (!/exercises/.test(body)) throw new Error('expected the session stat strip');
  if (!/~\d+ min/.test(body)) throw new Error('expected a duration estimate');
});

await step('the week strip shows a full week with training days marked', async () => {
  const dots = await p.locator('ul li button[aria-label]').count();
  if (dots !== 7) throw new Error(`expected a 7 day strip, got ${dots}`);
  const trainable = await p.locator('ul li button[aria-label]:not([disabled])').count();
  if (trainable < 1 || trainable > 3) throw new Error(`expected 1-3 training days this week, got ${trainable}`);
});

await step('a plan created today shows nothing already missed', async () => {
  const missed = await p.locator('button[aria-label*="missed"]').count();
  if (missed !== 0) throw new Error(`a brand new plan showed ${missed} missed session(s)`);
  const body = await p.locator('body').innerText();
  if (/\d+ missed/.test(body)) throw new Error(`block progress reported missed sessions on day one: ${body.match(/\d+ of \d+ sessions done[^\n]*/)?.[0]}`);
});
await p.screenshot({ path: 'e2e/shot-train.png' });

// Remember which routine the calendar offered, so the second run is the SAME
// session — the Routines list is alphabetical and would hand back a different one.
let plannedRoutineHref = '';
await step('start the planned session and log it', async () => {
  await p.getByRole('button', { name: 'Start workout', exact: true }).click();
  await p.getByLabel('Set 1 weight in kilograms').first().waitFor({ timeout: 20000 });
  // Log every set of the first exercise at the top of the rep range.
  const weights = await p.getByLabel(/Set \d+ weight in kilograms/).all();
  const first = Math.min(weights.length, 4);
  for (let i = 1; i <= first; i++) {
    await p.getByLabel(`Set ${i} weight in kilograms`).first().fill('100');
    await p.getByLabel(`Set ${i} repetitions`).first().fill('10');
    await p.getByLabel(new RegExp(`Mark set ${i} done`)).first().click();
    await p.waitForTimeout(150);
  }
  await p.waitForTimeout(400);
  const skip = p.getByRole('button', { name: 'Skip' });
  if (await skip.count()) await skip.click();
  plannedRoutineHref = await p.evaluate(async () => {
    const open = indexedDB.open('gymgo');
    const db = await new Promise((res, rej) => { open.onsuccess = () => res(open.result); open.onerror = () => rej(open.error); });
    const get = (s) => new Promise((res, rej) => { const r = db.transaction(s).objectStore(s).getAll(); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
    const workouts = await get('workouts');
    const live = workouts.filter(w => w.deleted_at === null && w.finished_at === null);
    return live.length ? live[live.length - 1].routine_id : '';
  });
  await p.getByRole('button', { name: 'Finish', exact: true }).click();
  await p.getByRole('button', { name: 'Finish and save' }).click();
  await p.waitForTimeout(1000);
});

await step('the calendar marks that session done', async () => {
  await p.goto(BASE, { waitUntil: 'networkidle' });
  await p.waitForTimeout(1200);
  const done = await p.locator('button[aria-label*="done"]').count();
  if (done < 1) throw new Error('expected at least one session marked done in the strip');
  const body = await p.locator('body').innerText();
  // Total depends on which weekday the block was created; only the count of
  // completed sessions is fixed.
  if (!/1 of \d+ sessions done/.test(body)) throw new Error(`expected block progress, saw: ${body.replace(/\n/g,' | ').slice(0,300)}`);
  if (/-\d+ days ago/.test(body)) throw new Error('a future session rendered as a negative day count');
});

await step('the progression engine suggests the next jump', async () => {
  // The SAME routine again: every set hit the top of the range, so it should add weight.
  if (!plannedRoutineHref) throw new Error('did not capture the routine that was logged');
  await p.goto(`${BASE}#/routines/${plannedRoutineHref}`, { waitUntil: 'networkidle' });
  await p.getByRole('button', { name: 'Start this workout' }).waitFor({ timeout: 15000 });
  await p.getByRole('button', { name: 'Start this workout' }).click();
  await p.waitForTimeout(1500);
  const body = await p.locator('body').innerText();
  if (!/Suggested/i.test(body)) throw new Error(`expected a suggestion, saw: ${body.replace(/\n/g,' | ').slice(0,500)}`);
  if (!/hit 10 on every set/i.test(body)) throw new Error(`expected the reason to explain itself, saw: ${body.replace(/\n/g,' | ').slice(0,500)}`);
  // The suggested weight must actually be heavier than what was logged, and the
  // reason must not claim a jump the number does not show.
  const suggested = /SUGGESTED[^]*?\n([\d.]+)kg × (\d+)/.exec(body);
  if (!suggested) throw new Error(`could not read the suggested weight from: ${body.replace(/\n/g,' | ').slice(0,400)}`);
  if (Number(suggested[1]) <= 100) throw new Error(`suggestion did not go up: ${suggested[1]}kg after logging 100kg`);
  const claimed = /Add ([\d.]+)kg/.exec(body);
  if (claimed && Number(suggested[1]) - 100 !== Number(claimed[1])) {
    throw new Error(`reason claims +${claimed[1]}kg but suggests ${suggested[1]}kg`);
  }
});
await p.screenshot({ path: 'e2e/shot-suggestion.png' });

console.log(errs.length ? '\nBrowser errors:\n' + errs.join('\n') : '\nNo browser errors.');
await b.close();
process.exit(errs.length ? 1 : 0);
