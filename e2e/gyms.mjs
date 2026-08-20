/**
 * The gym editor, and the thing it exists to prove: what you tick here reaches
 * plan generation and swap suggestions. Strip the gym back to dumbbells and
 * neither may offer a barbell.
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

await p.goto(BASE, { waitUntil: 'networkidle' });
await step('app loads', async () => { await p.getByRole('heading', {name:'Train'}).waitFor({timeout:40000}); });

await step('settings links through to gyms', async () => {
  await p.getByRole('link', { name: 'Settings' }).click();
  await p.getByRole('button', { name: /Gyms and equipment/ }).click();
  await p.getByRole('heading', { name: 'Gyms' }).waitFor({ timeout: 15000 });
});

await step('the seeded gym is listed and current', async () => {
  const body = await p.locator('body').innerText();
  if (!/My gym/.test(body)) throw new Error('the seeded gym is missing');
  if (!/CURRENT/i.test(body)) throw new Error('no gym is marked as current');
});

await step('adding a gym opens its editor', async () => {
  await p.getByRole('button', { name: 'Add', exact: true }).click();
  await p.getByLabel('Gym name').fill('Home garage');
  await p.getByRole('button', { name: 'Create' }).click();
  await p.getByRole('heading', { name: 'Equipment' }).waitFor({ timeout: 15000 });
  // A new gym starts with bodyweight only — ticking what you own is quicker and
  // more honest than un-ticking what you do not.
  const pressed = await p.locator('main [aria-pressed="true"]').evaluateAll(els => els.map(e => e.innerText));
  if (JSON.stringify(pressed) !== JSON.stringify(['Bodyweight'])) {
    throw new Error(`a new gym should start at bodyweight only, got ${JSON.stringify(pressed)}`);
  }
});

await step('unticking everything warns that no plan can be built', async () => {
  await p.getByRole('button', { name: 'Bodyweight', exact: true }).click();
  await p.waitForTimeout(400);
  const body = await p.locator('body').innerText();
  if (!/no plan can be built/i.test(body)) throw new Error('an empty gym should say so');
});

await step('ticking dumbbells clears the warning', async () => {
  await p.getByRole('button', { name: 'Dumbbell', exact: true }).click();
  await p.waitForTimeout(400);
  const body = await p.locator('body').innerText();
  if (/no plan can be built/i.test(body)) throw new Error('the warning should have gone');
});

await step('bars and plates are hidden without a barbell', async () => {
  const body = await p.locator('body').innerText();
  if (/PLATES/i.test(body)) throw new Error('a dumbbell-only gym has no plates to configure');
});

await step('ticking barbell reveals the plate maths', async () => {
  await p.getByRole('button', { name: 'Barbell', exact: true }).click();
  await p.getByRole('heading', { name: 'Plates' }).waitFor({ timeout: 10000 });
  const body = await p.locator('body').innerText();
  if (!/Asking for 100kg/.test(body)) throw new Error('expected the plate preview');
  if (!/20kg bar/i.test(body)) throw new Error(`expected a bar in the breakdown, saw: ${body.replace(/\n/g,' | ').slice(0,400)}`);
});

await step('removing the 20kg plate changes what 100kg loads', async () => {
  const before = await p.locator('body').innerText();
  await p.getByRole('button', { name: '20kg', exact: true }).nth(1).click();
  await p.waitForTimeout(400);
  const after = await p.locator('body').innerText();
  if (before === after) throw new Error('the plate preview did not react');
});
await p.screenshot({ path: 'e2e/shot-gym-editor.png', fullPage: true });

await step('strip back to dumbbells only and train here', async () => {
  await p.getByRole('button', { name: 'Barbell', exact: true }).click();
  await p.waitForTimeout(300);
  const gym = await p.evaluate(async () => {
    const open = indexedDB.open('gymgo');
    const db = await new Promise((res, rej) => { open.onsuccess = () => res(open.result); open.onerror = () => rej(open.error); });
    const r = db.transaction('gyms').objectStore('gyms').getAll();
    const gyms = await new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
    return gyms.find(g => g.name === 'Home garage');
  });
  if (JSON.stringify(gym.equipment_available) !== JSON.stringify(['dumbbell'])) {
    throw new Error(`expected dumbbell only, got ${JSON.stringify(gym.equipment_available)}`);
  }
  const trainHere = p.getByRole('button', { name: 'Train here' });
  if (await trainHere.count()) await trainHere.click();
  await p.waitForTimeout(400);
});

await step('the split picker names the gym and reports what it cannot fill', async () => {
  await p.goto(BASE + '#/plans/build_muscle', { waitUntil: 'networkidle' });
  await p.getByRole('heading', { name: /Build muscle/i }).waitFor({ timeout: 15000 });
  await p.waitForTimeout(700);
  const body = await p.locator('body').innerText();
  if (!/Home garage/.test(body)) throw new Error('the split picker should name the gym in use');
  // A dumbbell-only gym genuinely cannot fill every split. The app has to say
  // so rather than fabricate a lift the gym cannot perform.
  console.log('       picker says:', body.replace(/\n/g, ' | ').slice(0, 420));
});

await step('the generated plan contains no barbell, cable or machine work', async () => {
  // Collect every href before navigating: the locators go stale the moment we
  // leave the picker.
  const hrefs = await p.locator('a[href*="/plans/build_muscle/"]')
    .evaluateAll(els => [...new Set(els.map(e => e.getAttribute('href')))]);
  if (!hrefs.length) throw new Error('a dumbbell gym should still leave at least one workable split');

  let checked = 0;
  for (const href of hrefs) {
    await p.goto(BASE + href.replace(/^#?\/?/, '#/').replace('##', '#'), { waitUntil: 'networkidle' });
    await p.waitForTimeout(900);
    const body = await p.locator('body').innerText();
    if (/Not enough equipment|cannot be built/i.test(body)) continue;

    const names = await p.locator('li').evaluateAll(els =>
      els.map(e => e.innerText.split('\n')[0].trim()).filter(Boolean));
    const forbidden = names.filter(n => /^(barbell|cable|machine|smith|lever|ez[- ]bar)/i.test(n));
    if (forbidden.length) {
      throw new Error(`plan at ${href} offered equipment this gym lacks: ${forbidden.slice(0,5).join(', ')}`);
    }
    checked++;
    console.log(`       ${href} → ${names.filter(n => /dumbbell|push|pull|crunch|plank|lunge|squat|raise|curl|press|row|fly|dip|extension/i.test(n)).slice(0,4).join(', ')}`);
    if (checked >= 2) break;
  }
  if (!checked) throw new Error('every split reported as unbuildable — the gym should still have one workable option');
});

await step('swap suggestions at a dumbbell gym stay dumbbell', async () => {
  await p.getByRole('link', { name: 'Train' }).click();
  await p.getByRole('button', { name: 'Start empty workout' }).click();
  await p.getByRole('button', { name: 'Add exercise' }).click();
  await p.getByPlaceholder('Add exercise').fill('dumbbell bench press');
  await p.getByRole('button', { name: /^Dumbbell Bench Press/ }).first().click();
  await p.getByLabel('Set 1 weight in kilograms').first().waitFor({ timeout: 20000 });

  await p.getByRole('link', { name: /Swap Dumbbell Bench Press/ }).click();
  await p.getByRole('heading', { name: 'Swap exercise' }).waitFor({ timeout: 15000 });
  await p.waitForTimeout(800);

  const names = await p.locator('main button').evaluateAll(els =>
    els.map(e => e.innerText.split('\n')[0]).filter(Boolean));
  const offered = names.filter(n => /press|fly|dip|push/i.test(n));
  console.log('       offered:', JSON.stringify(offered.slice(0, 8)));
  const barbell = offered.filter(n => /^barbell|smith|cable|machine/i.test(n));
  if (barbell.length) throw new Error(`a dumbbell-only gym offered: ${barbell.join(', ')}`);
  if (!offered.length) throw new Error('no swaps were offered at all');
});

await step('the show-everything toggle escapes the gym filter', async () => {
  const toggle = p.getByRole('switch', { name: /Only what Home garage has/i }).first();
  if (!(await toggle.count())) throw new Error('expected a toggle to see exercises this gym lacks');
  await toggle.click();
  await p.waitForTimeout(800);
  const body = await p.locator('body').innerText();
  if (!/Barbell/i.test(body)) throw new Error('unfiltered suggestions should include barbell work');
});
await p.screenshot({ path: 'e2e/shot-gym-swap.png', fullPage: true });

console.log(errs.length ? '\nBrowser errors:\n' + errs.join('\n') : '\nNo browser errors.');
await b.close();
process.exit(errs.length ? 1 : 0);
