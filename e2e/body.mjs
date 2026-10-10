/**
 * Body weight, the percentage table and weight step, the plan builder's
 * Adjust sheet, and the in-gym gaps: tempo, pyramids, back-off and cluster
 * sets, and Pro tools reached from Beginner mode.
 *
 * Display type is upper-cased by CSS and innerText sees the capitals, so text
 * checks match without case or read accessible names.
 */
import { launchChromium } from './browser.mjs';

const BASE = process.env.BASE_URL ?? 'http://127.0.0.1:5185/';
const b = await launchChromium();
const c = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
const p = await c.newPage();
const errs = [];
p.on('pageerror', e => errs.push('pageerror: ' + e.message));
p.on('console', m => { if (m.type()==='error' && !/Failed to load resource|navigator\.vibrate/i.test(m.text())) errs.push('console: '+m.text()); });
const step = async (l, fn) => { try { await fn(); console.log('  ok   '+l); } catch(e) { console.log('  FAIL '+l+': '+e.message); throw e; } };

const idb = (fn, arg) => p.evaluate(async ([source, value]) => {
  const open = indexedDB.open('gymgo');
  const db = await new Promise((res, rej) => { open.onsuccess = () => res(open.result); open.onerror = () => rej(open.error); });
  const getAll = (name) => new Promise((res, rej) => { const r = db.transaction(name).objectStore(name).getAll(); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
  const put = (name, row) => new Promise((res, rej) => { const r = db.transaction(name, 'readwrite').objectStore(name).put(row); r.onsuccess = res; r.onerror = () => rej(r.error); });
  return new Function('getAll', 'put', 'value', `return (async () => { ${source} })()`)(getAll, put, value);
}, [fn, arg]);

const setMode = async (label) => {
  await p.goto(BASE + '#/settings', { waitUntil: 'networkidle' });
  await p.getByRole('group', { name: /mode/i }).getByRole('button', { name: new RegExp(label) }).click();
  await p.waitForTimeout(300);
};

await p.goto(BASE, { waitUntil: 'networkidle' });
await step('app loads', async () => { await p.getByRole('heading', { name: 'Today' }).waitFor({ timeout: 40000 }); });

// ---------------------------------------------------------------------------
// Body weight
// ---------------------------------------------------------------------------

await step('Progress has a Body tab for the weight log', async () => {
  await p.goto(BASE + '#/progress', { waitUntil: 'networkidle' });
  await p.getByRole('link', { name: 'Body' }).click();
  await p.getByLabel("Today's weight in kilograms").waitFor({ timeout: 10000 });
});

await step('a second weigh-in the same day replaces the first', async () => {
  await p.getByLabel("Today's weight in kilograms").fill('82.4');
  await p.getByRole('button', { name: 'Save weight' }).click();
  // The first save has to land before the second is typed: saving clears the
  // field once the row is written, which would wipe a number typed too soon.
  await p.getByText('82.4 kg logged today. Saving again replaces it.').waitFor({ timeout: 10000 });
  await p.getByLabel("Today's weight in kilograms").fill('82');
  await p.getByLabel("Today's weight in kilograms").press('Enter');
  await p.getByText('82 kg logged today. Saving again replaces it.').waitFor({ timeout: 10000 });
  const entries = p.getByRole('region', { name: 'Weigh-ins' }).getByRole('listitem');
  if ((await entries.count()) !== 1) throw new Error(`expected one weigh-in, saw ${await entries.count()}`);
});

await step('a month of weigh-ins draws the seven-day average and its change', async () => {
  await idb(`
    for (let back = 40; back >= 1; back -= 1) {
      const d = new Date(Date.now() - back * 864e5);
      const date = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
      await put('body_metrics', { id: crypto.randomUUID(), date, metric: 'bodyweight', value: 86 - (40 - back) * 0.1,
        unit: 'kg', user_id: null, created_at: d.toISOString(), updated_at: d.toISOString(), deleted_at: null });
    }`);
  await p.reload({ waitUntil: 'networkidle' });
  const trend = p.getByRole('region', { name: /Weight, 7-day average/i });
  await trend.waitFor({ timeout: 10000 });
  const text = await trend.innerText();
  if (!/-\d+(\.\d)? kg in 30 days/.test(text)) throw new Error(`the change should show a loss: ${text.replace(/\n/g, ' | ')}`);
});
await p.screenshot({ path: 'e2e/shot-body.png' });

// ---------------------------------------------------------------------------
// The exercise screen: percentage table and weight step
// ---------------------------------------------------------------------------

const squatId = await idb(`return (await getAll('exercises')).find((e) => e.name === 'Barbell Squat').id;`);

await step('the percentage table rounds a typed max down to loadable weights', async () => {
  await p.goto(BASE + '#/exercises/' + squatId, { waitUntil: 'networkidle' });
  const section = p.getByRole('region', { name: 'Percentage table' });
  // Folded away in Beginner.
  await section.getByRole('button', { name: 'Show' }).click();
  await section.getByLabel('Your max in kilograms').fill('117.5');
  const rows = await section.getByRole('row').allInnerTexts();
  const eighty = rows.find((row) => /^80%/.test(row.trim()));
  // 80% of 117.5 is 94; the bar makes 92.5.
  if (!eighty || !/92\.5 kg/.test(eighty)) throw new Error(`80% should be 92.5 kg: ${rows.join(' | ')}`);
});

await step('a lift can have its own weight step', async () => {
  const group = p.getByRole('group', { name: 'Weight step' });
  await group.getByRole('button', { name: '5', exact: true }).click();
  await p.getByText('Set to 5 kg.').waitFor();
  await group.getByRole('button', { name: 'Auto' }).click();
  await p.getByText(/Auto is 2\.5 kg for this lift/).waitFor();
});

// ---------------------------------------------------------------------------
// The plan builder
// ---------------------------------------------------------------------------

await step('Adjust takes a time limit, a priority and a lift to avoid', async () => {
  await p.goto(BASE + '#/plan/new/build_muscle/upper_lower?days=4', { waitUntil: 'networkidle' });
  await p.getByRole('button', { name: 'Adjust plan' }).click();
  const sheet = p.getByRole('dialog', { name: 'Adjust plan' });
  await sheet.getByRole('group', { name: 'Time per session' }).getByRole('button', { name: '60', exact: true }).click();
  await sheet.getByRole('group', { name: 'Priority muscles' }).getByRole('button', { name: 'Shoulders' }).click();
  await sheet.getByRole('group', { name: 'Lifts to avoid' }).getByRole('button', { name: 'Deadlifts' }).click();
  await sheet.getByRole('button', { name: 'Done' }).click();
  await p.waitForTimeout(300);
});

await step('the plan avoids every deadlift and fits each day in 60 minutes', async () => {
  const swaps = await p.getByRole('button', { name: /^Swap / }).evaluateAll(els => els.map(e => e.getAttribute('aria-label')));
  if (swaps.length < 12) throw new Error(`expected the week's exercises, saw ${swaps.length}`);
  const deadlifts = swaps.filter((name) => /deadlift/i.test(name));
  if (deadlifts.length) throw new Error(`deadlifts should be avoided: ${deadlifts.join(', ')}`);
  const heads = await p.locator('section[aria-label^="Day "] .card-head').allInnerTexts();
  for (const head of heads) {
    const minutes = Number(head.match(/(\d+) min/)?.[1]);
    if (!(minutes <= 60)) throw new Error(`a day runs over 60 minutes: ${head}`);
  }
  if (!/Cut to fit 60 min/i.test(await p.locator('main').innerText())) throw new Error('the cuts should be listed');
});

await step('each exercise can say why it was picked', async () => {
  await p.getByRole('switch', { name: 'Why these exercises?' }).click();
  const text = await p.locator('main').innerText();
  if (!/Main lift: a squat for quadriceps/i.test(text)) throw new Error('a main lift should explain itself');
  if (!/because shoulders is a priority/i.test(text)) throw new Error('the priority set should be owned');
});
await p.screenshot({ path: 'e2e/shot-builder-adjusted.png', fullPage: true });

let session = '';
await step('the plan it saves keeps Today inside the limit', async () => {
  await p.getByRole('button', { name: /Use this plan/ }).click();
  await p.waitForTimeout(1200);
  await p.goto(BASE + '#/', { waitUntil: 'networkidle' });
  const hero = p.getByRole('region', { name: 'Next session' });
  await hero.waitFor({ timeout: 10000 });
  session = (await hero.getByRole('heading').innerText()).trim();
  const minutes = Number((await hero.innerText()).match(/about (\d+) min/)?.[1]);
  if (!(minutes <= 60)) throw new Error(`Today's session should fit in 60 minutes, says ${minutes}`);
});

// ---------------------------------------------------------------------------
// In the gym: a reverse pyramid with a tempo, logged in Beginner mode
// ---------------------------------------------------------------------------

let lift = '';
await step('a Pro routine can be a reverse pyramid with a tempo', async () => {
  await setMode('Pro');
  await p.goto(BASE + '#/plan', { waitUntil: 'networkidle' });
  const sessions = p.getByRole('region', { name: /Sessions in this plan/i });
  await sessions.getByRole('link').filter({ hasText: new RegExp(session, 'i') }).first().click();
  const scheme = p.getByRole('group', { name: / set scheme$/ }).first();
  await scheme.waitFor({ timeout: 10000 });
  lift = (await scheme.getAttribute('aria-label')).replace(/ set scheme$/, '');
  await scheme.getByRole('button', { name: 'Reverse' }).click();
  const tempo = p.getByLabel(`${lift} tempo`);
  await tempo.fill('3-1-1-0');
  await tempo.press('Tab');
  await p.waitForTimeout(300);
  await setMode('Beginner');
});

await step('the session lays out the top set first and shows the tempo', async () => {
  await p.goto(BASE + '#/', { waitUntil: 'networkidle' });
  await p.getByRole('region', { name: 'Next session' }).getByRole('button', { name: /^Start/ }).click();
  await p.getByLabel('Set 1 weight in kilograms').waitFor({ timeout: 20000 });
  await p.getByRole('button', { name: 'Tempo 3-1-1-0' }).click();
  await p.getByText('3s down, 1s at the bottom, 1s up, 0s at the top.').waitFor();
});

await step('after the top set, a back-off set aims 10% lighter for two more reps', async () => {
  await p.getByLabel('Set 1 weight in kilograms').fill('100');
  await p.getByLabel('Set 1 repetitions').fill('8');
  await p.getByLabel(/Mark set 1 done/).click();
  await p.waitForTimeout(300);
  if (await p.getByRole('button', { name: 'Skip rest' }).count()) await p.getByRole('button', { name: 'Skip rest' }).click();
  await p.waitForTimeout(300);
  if (!/Set 2 of \d+ · Back-off/i.test(await p.locator('.b-setlabel').innerText())) throw new Error('set 2 should be a back-off set');
  const weight = await p.getByLabel('Set 2 weight in kilograms').getAttribute('placeholder');
  const reps = await p.getByLabel('Set 2 repetitions').getAttribute('placeholder');
  if (weight !== '90' || reps !== '10') throw new Error(`expected 90 × 10 from a 100 × 8 top set, saw ${weight} × ${reps}`);
});
await p.screenshot({ path: 'e2e/shot-pyramid.png' });

await step('Beginner reaches RIR, AMRAP and the techniques through the set sheet', async () => {
  await p.getByRole('button', { name: /^Edit set 1, 100kg × 8, done/ }).click();
  const sheet = p.getByRole('dialog', { name: /Edit set 1/ });
  await sheet.getByLabel('Set 1 reps in reserve 2').waitFor();
  await sheet.getByLabel('Set 1 as many reps as possible').waitFor();
  const techniques = sheet.getByRole('group', { name: 'Add a technique to this set' });
  await techniques.getByRole('button', { name: '+ Back-off' }).waitFor();
  await techniques.getByRole('button', { name: '+ Cluster' }).click();
  await p.getByRole('button', { name: /^Edit cluster under set 1/ }).waitFor({ timeout: 5000 }).catch(async () => {
    // The cluster is the set in hand now, so it may be the current chip rather than a button.
    if (!/Cluster · set 1/i.test(await p.locator('.b-setlabel').innerText())) throw new Error('the cluster should follow set 1');
  });
});

await step('and the superset toggle through the overflow', async () => {
  await p.getByRole('button', { name: `More for ${lift}` }).click();
  await p.getByRole('dialog', { name: `More for ${lift}` }).getByRole('button', { name: /Superset with next/ }).waitFor();
  await p.keyboard.press('Escape');
});

console.log(errs.length ? '\nBrowser errors:\n' + errs.join('\n') : '\nNo browser errors.');
await b.close();
process.exit(errs.length ? 1 : 0);
