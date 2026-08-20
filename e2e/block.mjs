/**
 * The expanded block view on Train: what is coming up in later weeks.
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

await step('build a plan so there is a block to look at', async () => {
  await p.goto(BASE + '#/plans/build_muscle', { waitUntil: 'networkidle' });
  await p.waitForTimeout(700);
  const href = await p.locator('a[href*="/plans/build_muscle/"]').first().getAttribute('href');
  await p.goto(BASE + href.replace(/^#?\/?/, '#/').replace('##', '#'), { waitUntil: 'networkidle' });
  await p.getByRole('button', { name: /Use this plan/i }).click();
  await p.waitForTimeout(1500);
});

await step('Train shows this week collapsed, not the whole block', async () => {
  await p.goto(BASE + '#/', { waitUntil: 'networkidle' });
  await p.waitForTimeout(900);
  const body = await p.locator('body').innerText();
  if (!/Week 1\/5/i.test(body)) throw new Error(`expected the week label, saw: ${body.replace(/\n/g,' | ').slice(0,300)}`);
  if (/Week 4/.test(body)) throw new Error('later weeks should be hidden until expanded');
});
await p.screenshot({ path: 'e2e/shot-block-collapsed.png', fullPage: true });

await step('expanding reveals every week of the block', async () => {
  await p.getByRole('button', { name: /See the whole 5-week block/i }).click();
  await p.waitForTimeout(700);
  const body = await p.locator('body').innerText();
  for (const week of ['Week 1', 'Week 2', 'Week 3', 'Week 4', 'Week 5']) {
    if (!body.includes(week)) throw new Error(`${week} missing from the expanded view`);
  }
  if (!/Deload/i.test(body)) throw new Error('the deload week should be named');
  if (!/sets/i.test(body)) throw new Error('each week should state its volume');
});
await p.screenshot({ path: 'e2e/shot-block-expanded.png', fullPage: true });

await step('the deload really is lighter than the peak', async () => {
  const sets = await p.locator('li').evaluateAll(els =>
    els.map(e => e.innerText).filter(t => /^Week \d/.test(t))
       .map(t => {
         const week = Number(t.match(/Week (\d)/)[1]);
         const s = Number(t.match(/(\d+) sets/)[1]);
         return { week, sets: s };
       }));
  console.log('       sets per week:', JSON.stringify(sets));
  if (sets.length !== 5) throw new Error(`expected five weeks, got ${sets.length}`);
  const peak = Math.max(...sets.map(s => s.sets));
  const deload = sets.find(s => s.week === 5).sets;
  if (deload >= peak) throw new Error(`the deload (${deload}) should be lighter than the peak (${peak})`);
  // Weeks 1-4 must not go down.
  for (let i = 1; i < 4; i++) {
    if (sets[i].sets < sets[i-1].sets) throw new Error(`week ${i+1} drops below week ${i} before the deload`);
  }
});

await step('collapsing hides it again', async () => {
  await p.getByRole('button', { name: /Week 1\/5/ }).click();
  await p.waitForTimeout(600);
  const body = await p.locator('body').innerText();
  if (/Week 4/.test(body)) throw new Error('the block should collapse');
});

console.log(errs.length ? '\nBrowser errors:\n' + errs.join('\n') : '\nNo browser errors.');
await b.close();
process.exit(errs.length ? 1 : 0);
