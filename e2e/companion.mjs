/**
 * The phone as the companion while the watch logs (Phase 5.1, decision 8).
 *
 * A watch is faked through the development seam, `window.__gymgoWatch`
 * (src/platform/watchState.ts): `report({...})` is a state report from the
 * watch, stamped with the phone's clock unless the step fakes an old one.
 * Nothing here talks to a real watch.
 *
 * Covers: no logging controls while the watch logs, the watch's station and
 * the whole session on screen, setup notes, fixing a logged set, readiness,
 * a silent rest line, a station skipped on the wrist left out of Up next,
 * picking another station, a swap, the details folded in Beginner and open in
 * Pro, every way logging comes back to the phone (the watch's session ending,
 * five minutes of silence, an hour of a pause, another workout, "Log on this
 * phone"), "Paused" in the watch bar, the watch reclaiming, Finish from the
 * companion and from the watch, a workout deleted from under the screen, and
 * the routine editor refusing a second open workout.
 *
 * Display type is upper-cased by CSS and innerText sees the capitals, so text
 * checks match without case or read accessible names.
 */
import { launchChromium } from './browser.mjs';

const BASE = process.env.BASE_URL ?? 'http://127.0.0.1:5185/';
const STALE_MS = 5 * 60_000;
const PAUSED_STALE_MS = 60 * 60_000;
const BENCH = 'Barbell Bench Press - Medium Grip';
const SQUAT = 'Barbell Squat';
const ROW = 'Bent Over Barbell Row';

const b = await launchChromium();
const c = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
const p = await c.newPage();
const errs = [];
p.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
// navigator.vibrate is blocked before a user gesture in headless Chromium:
// an artifact, not a failure (see toolkit.mjs).
p.on('console', (m) => {
  if (m.type() !== 'error') return;
  if (/Failed to load resource|navigator\.vibrate/i.test(m.text())) return;
  errs.push('console: ' + m.text());
});
// Every cue lands here rather than buzzing or beeping, re-armed on each reload.
await p.addInitScript(() => {
  window.__cues = 0;
  window.__tones = 0;
  Object.defineProperty(navigator, 'vibrate', {
    configurable: true,
    value: () => {
      window.__cues += 1;
      return true;
    },
  });
  const Ctor = window.AudioContext;
  if (Ctor) {
    const create = Ctor.prototype.createOscillator;
    Ctor.prototype.createOscillator = function () {
      window.__tones += 1;
      return create.call(this);
    };
  }
});
const step = async (l, fn) => {
  try {
    await fn();
    console.log('  ok   ' + l);
  } catch (e) {
    console.log('  FAIL ' + l + ': ' + e.message);
    throw e;
  }
};

const idb = (fn, arg) =>
  p.evaluate(
    async ([source, value]) => {
      const open = indexedDB.open('gymgo');
      const db = await new Promise((res, rej) => {
        open.onsuccess = () => res(open.result);
        open.onerror = () => rej(open.error);
      });
      const getAll = (name) =>
        new Promise((res, rej) => {
          const r = db.transaction(name).objectStore(name).getAll();
          r.onsuccess = () => res(r.result);
          r.onerror = () => rej(r.error);
        });
      return new Function('getAll', 'value', `return (async () => { ${source} })()`)(getAll, value);
    },
    [fn, arg],
  );

/** The seam is registered when the store's module loads: wait for it after any reload. */
const seam = () => p.waitForFunction(() => Boolean(window.__gymgoWatch), null, { timeout: 15000 });
const report = async (partial) => {
  await seam();
  await p.evaluate((value) => window.__gymgoWatch.report(value), partial);
  await p.waitForTimeout(300);
};
const endWatch = async () => {
  await p.evaluate(() => window.__gymgoWatch.end());
  await p.waitForTimeout(300);
};
/** A mutation as a tap would make it, through the app's own module, for what the watch's drain would apply. */
const mutate = (name, ...args) =>
  p.evaluate(async ([fn, values]) => (await import('/src/db/mutations.ts'))[fn](...values), [name, args]);

const doneBar = () => p.getByRole('button', { name: /^Mark (set|warm-up|drop)/i });
const setFields = () => p.getByLabel(/^Set \d+ weight in kilograms$/);
const stripPills = () => p.getByRole('button', { name: /, \d+ of \d+ sets done$/ });
const wholeSession = () => p.getByRole('button', { name: /^Exercise \d+ of \d+, show the whole session$/ });
const watching = () => p.getByRole('region', { name: 'On your watch' });
const sessionRegion = () => p.getByRole('region', { name: 'This session' });
const workoutIdFromUrl = () => /#\/workout\/([^/?]+)/.exec(p.url())?.[1];

const addExercise = async (query, name) => {
  await p.getByRole('button', { name: 'Add exercise' }).click();
  await p.getByPlaceholder('Add exercise').fill(query);
  await p.getByRole('button', { name }).first().click();
  await p.waitForTimeout(700);
};
const skipRest = async () => {
  const skip = p.getByRole('button', { name: 'Skip rest' });
  if (await skip.count()) await skip.click();
  await p.waitForTimeout(300);
};
const setMode = async (label) => {
  const back = p.url();
  await p.goto(BASE + '#/settings', { waitUntil: 'networkidle' });
  await p.getByRole('group', { name: 'Mode' }).getByRole('button', { name: label }).click();
  await p.waitForTimeout(300);
  await p.goto(back, { waitUntil: 'networkidle' });
  await p.waitForTimeout(500);
};
const noSideScroll = async (what) => {
  const { scroll, width } = await p.evaluate(() => ({
    scroll: document.documentElement.scrollWidth,
    width: window.innerWidth,
  }));
  if (scroll > width) throw new Error(`${what}: the page scrolls sideways (${scroll} > ${width})`);
};

await p.goto(BASE, { waitUntil: 'networkidle' });
await step('app loads', async () => {
  await p.getByRole('heading', { name: 'Today' }).waitFor({ timeout: 40000 });
});

let workoutId = '';
let sets = {};
await step('a session of bench, squat and rows, with bench set 1 logged on the phone', async () => {
  await p.getByRole('button', { name: 'Start empty workout' }).click();
  await p.waitForURL(/#\/workout\//, { timeout: 15000 });
  workoutId = workoutIdFromUrl();
  await addExercise('barbell bench press', /^Barbell Bench Press - Medium Grip/);
  // A freestyle exercise opens with one set; bench gets a second.
  await p.getByRole('button', { name: 'Add set' }).click();
  await p.waitForTimeout(400);
  await addExercise('barbell squat', /^Barbell Squat(?! To)/);
  await addExercise('bent over barbell row', /^Bent Over Barbell Row/);
  await p.getByRole('button', { name: new RegExp(`^${BENCH.replace(/[-]/g, '\\-')}, \\d+ of \\d+ sets done$`) }).click();
  await p.waitForTimeout(400);
  await p.getByLabel('Set 1 weight in kilograms').fill('60');
  await p.getByLabel('Set 1 repetitions').fill('8');
  await p.getByLabel(/Mark set 1 done/).click();
  await p.waitForTimeout(400);
  await skipRest();

  sets = await idb(
    `const [wes, all, exercises] = await Promise.all([getAll('workout_exercises'), getAll('sets'), getAll('exercises')]);
     const name = new Map(exercises.map((e) => [e.id, e.name]));
     const out = {};
     for (const we of wes.filter((w) => w.workout_id === value && w.deleted_at === null)) {
       out[name.get(we.exercise_id)] = all.filter((s) => s.workout_exercise_id === we.id && s.deleted_at === null)
         .sort((a, b) => a.set_index - b.set_index).map((s) => s.id);
     }
     return out;`,
    workoutId,
  );
  if (sets[BENCH]?.length !== 2 || sets[SQUAT]?.length !== 1 || sets[ROW]?.length !== 1) {
    throw new Error(`unexpected session: ${JSON.stringify(sets)}`);
  }
});

await step('with no watch, the logging screen is as it always was', async () => {
  if ((await doneBar().count()) !== 1) throw new Error('expected the Done bar');
  if ((await stripPills().count()) !== 3) throw new Error('expected three station pills');
  if ((await wholeSession().count()) !== 1) throw new Error('expected the "Exercise N of M" button');
  if (await p.getByRole('button', { name: 'Log on this phone' }).count()) throw new Error('no watch, no take-back');
});

await step('while the watch logs: no Done bar, no fields, no strip, one Add exercise', async () => {
  await report({ workoutId, setId: sets[BENCH][1], heartRate: 132, activeKcal: 214 });
  await watching().waitFor({ timeout: 5000 });
  if (await doneBar().count()) throw new Error('the Done bar is still there');
  if (await setFields().count()) throw new Error('a set field is still there');
  if (await p.getByRole('button', { name: /one more rep|weight up/ }).count()) throw new Error('a stepper is still there');
  if (await stripPills().count()) throw new Error('the strip is still there');
  if (await wholeSession().count()) throw new Error('the "Exercise N of M" button is still there');
  if (await p.getByRole('button', { name: 'Dismiss the readiness question' }).count()) {
    throw new Error('the readiness prompt is still there');
  }
  const adds = await p.getByRole('button', { name: 'Add exercise' }).count();
  if (adds !== 1) throw new Error(`expected exactly one Add exercise, got ${adds}`);
});

await step('the watch bar carries heart rate, energy and the take-back', async () => {
  const header = await p.locator('header').innerText();
  if (!/On your watch/i.test(header)) throw new Error(`no watch bar: ${header}`);
  if (!/132 bpm/.test(header) || !/214 kcal/.test(header)) throw new Error(`no heart rate or energy: ${header}`);
  await p.getByRole('button', { name: 'Log on this phone' }).waitFor();
});

await step("'On your watch' names the bench, with the set the watch will log", async () => {
  const region = watching();
  await region.getByRole('heading', { name: BENCH }).waitFor();
  const text = await region.innerText();
  if (!/Set 2 of 2/i.test(text)) throw new Error(`expected "Set 2 of 2": ${text.replace(/\n/g, ' | ').slice(0, 300)}`);
  // From the second set on, the target is the set just done.
  if ((await region.getByText('60kg × 8', { exact: true }).count()) !== 1) {
    throw new Error(`expected the target 60 × 8: ${text.replace(/\n/g, ' | ').slice(0, 300)}`);
  }
  if (!(await region.getByText('Set 2, in hand').count())) throw new Error("the watch's set is not shown in hand");
  await region.getByLabel(`Setup notes for ${BENCH}`).waitFor();
});

await step("'This session' lists all three, the watch's first and current", async () => {
  const rows = sessionRegion().getByRole('listitem');
  if ((await rows.count()) !== 3) throw new Error(`expected 3 rows, got ${await rows.count()}`);
  const current = await sessionRegion().getByRole('button').first().getAttribute('aria-current');
  if (current !== 'step') throw new Error('the first row should be current');
  const others = await sessionRegion().locator('[aria-current="step"]').count();
  if (others !== 1) throw new Error(`expected one current row, got ${others}`);
  await p.getByRole('region', { name: 'Up next' }).getByText(SQUAT).waitFor();
});

await step('a station skipped on the wrist is not Up next on the phone either', async () => {
  const upNext = () => p.getByRole('region', { name: 'Up next' });
  // The watch skipped the squat: it goes to the rows next, and so does the phone.
  await report({ workoutId, setId: sets[BENCH][1], skipped: [sets[SQUAT][0]] });
  await upNext().getByText(ROW).waitFor({ timeout: 5000 });
  if (await upNext().getByText(SQUAT).count()) throw new Error('the skipped squat is still Up next');
  // Nothing skipped any more: the squat is next again.
  await report({ workoutId, setId: sets[BENCH][1] });
  await upNext().getByText(SQUAT).waitFor({ timeout: 5000 });
});

await p.screenshot({ path: 'e2e/shot-companion.png', fullPage: true });

await step('no sideways scroll on a 375 × 667 phone', async () => {
  await p.setViewportSize({ width: 375, height: 667 });
  await p.waitForTimeout(300);
  await noSideScroll('companion, Beginner');
  await p.setViewportSize({ width: 390, height: 844 });
});

await step('setup notes save, and survive a reload', async () => {
  const field = watching().getByLabel(`Setup notes for ${BENCH}`);
  await field.fill('Bench on notch 4, feet flat');
  await field.press('Tab');
  await p.waitForTimeout(500);
  await p.reload({ waitUntil: 'networkidle' });
  await report({ workoutId, setId: sets[BENCH][1] });
  await watching().waitFor({ timeout: 10000 });
  const value = await watching().getByLabel(`Setup notes for ${BENCH}`).inputValue();
  if (value !== 'Bench on notch 4, feet flat') throw new Error(`the note did not survive: "${value}"`);
  const stored = await idb(`return (await getAll('exercises')).find((e) => e.name === value).setup_notes;`, BENCH);
  if (stored !== 'Bench on notch 4, feet flat') throw new Error(`stored as "${stored}"`);
});

await step('a logged set is fixed from its chip', async () => {
  await watching().getByRole('button', { name: /^Edit set 1, 60kg × 8, done/ }).click();
  const sheet = p.getByRole('dialog', { name: 'Edit set 1' });
  await sheet.getByLabel('Set 1 repetitions').fill('9');
  await sheet.getByLabel('Set 1 repetitions').press('Tab');
  await p.waitForTimeout(300);
  await sheet.getByRole('button', { name: 'Done', exact: true }).click();
  await watching().getByRole('button', { name: /^Edit set 1, 60kg × 9, done/ }).waitFor({ timeout: 5000 });
});

await step('the card follows the watch on without losing a note half typed or an open sheet', async () => {
  const note = 'Bench on notch 4, feet flat, arch';
  await watching().getByLabel(`Setup notes for ${BENCH}`).fill(note);
  // The watch moves on while the note is still being typed.
  await report({ workoutId, setId: sets[SQUAT][0] });
  await watching().getByRole('heading', { name: SQUAT }).waitFor({ timeout: 5000 });
  await p.waitForTimeout(400);
  const stored = await idb(`return (await getAll('exercises')).find((e) => e.name === value).setup_notes;`, BENCH);
  if (stored !== note) throw new Error(`the half-typed note was lost: "${stored}"`);

  await report({ workoutId, setId: sets[BENCH][1] });
  await watching().getByRole('button', { name: /^Edit set 1, 60kg × 9, done/ }).click();
  const sheet = p.getByRole('dialog', { name: 'Edit set 1' });
  await sheet.waitFor();
  await report({ workoutId, setId: sets[SQUAT][0] });
  await watching().getByRole('heading', { name: SQUAT }).waitFor({ timeout: 5000 });
  if (!(await sheet.count())) throw new Error('the set sheet closed when the watch moved on');
  await sheet.getByRole('button', { name: 'Done', exact: true }).click();
  await report({ workoutId, setId: sets[BENCH][1] });
  await watching().getByRole('heading', { name: BENCH }).waitFor({ timeout: 5000 });
});

await step('readiness stays on screen, pressed, and says what it did', async () => {
  const low = p.getByRole('button', { name: 'Readiness low' });
  await low.click();
  await p.getByRole('status').filter({ hasText: '10% lighter' }).waitFor({ timeout: 5000 });
  if ((await low.getAttribute('aria-pressed')) !== 'true') throw new Error('Readiness low is not pressed');
  if ((await p.getByRole('button', { name: 'Readiness normal' }).getAttribute('aria-pressed')) !== 'false') {
    throw new Error('Readiness normal should not be pressed');
  }
  await p.waitForTimeout(2800);
});

await step("the watch's rest is one silent line: no takeover, no Skip, no cue", async () => {
  const cuesBefore = await p.evaluate(() => [window.__cues, window.__tones]);
  await report({
    workoutId,
    setId: sets[BENCH][1],
    rest: { endsAt: new Date(Date.now() + 4000).toISOString(), upNext: { name: BENCH, detail: 'Set 2 of 2 · 60 × 9' } },
  });
  const timer = p.getByRole('timer', { name: 'Rest on your watch' });
  await timer.waitFor({ timeout: 3000 });
  const first = await timer.innerText();
  await p.waitForTimeout(1300);
  const second = await timer.innerText();
  if (first === second) throw new Error(`the rest did not tick: ${first}`);
  if (!/then/i.test(first)) throw new Error(`the rest does not say what is next: ${first}`);
  await p.screenshot({ path: 'e2e/shot-companion-rest.png' });
  if (await p.getByRole('button', { name: 'Skip rest' }).count()) throw new Error('the phone offers Skip rest');
  if (await p.getByRole('dialog', { name: 'Rest' }).count()) throw new Error('the phone took the screen over');
  await p.waitForTimeout(3500);
  if (await timer.count()) throw new Error('the rest line outlived its rest');
  const cuesAfter = await p.evaluate(() => [window.__cues, window.__tones]);
  if (cuesAfter[0] !== cuesBefore[0] || cuesAfter[1] !== cuesBefore[1]) {
    throw new Error(`the phone cued the end of the watch's rest: ${cuesBefore} → ${cuesAfter}`);
  }
});

await step('a row shows that station, and the way back to the watch', async () => {
  await sessionRegion().getByRole('button').nth(1).click();
  const coming = p.getByRole('region', { name: 'Coming up' });
  await coming.getByRole('heading', { name: SQUAT }).waitFor({ timeout: 5000 });
  if (await watching().count()) throw new Error("the watch's station should give way to the one picked");
  await p.getByRole('button', { name: "Back to the watch's exercise" }).click();
  await watching().getByRole('heading', { name: BENCH }).waitFor({ timeout: 5000 });
  if (await p.getByRole('button', { name: "Back to the watch's exercise" }).count()) throw new Error('the way back stayed');
});

await step('a station picked from the list follows the watch once the watch gets there', async () => {
  await sessionRegion().getByRole('button').nth(1).click();
  await p.getByRole('region', { name: 'Coming up' }).getByRole('heading', { name: SQUAT }).waitFor({ timeout: 5000 });
  // The watch moves on to the station picked: the card is the watch's now.
  await report({ workoutId, setId: sets[SQUAT][0] });
  await watching().getByRole('heading', { name: SQUAT }).waitFor({ timeout: 5000 });
  if (await p.getByRole('button', { name: "Back to the watch's exercise" }).count()) {
    throw new Error('the way back stayed once the watch got there');
  }
  // And when the watch moves on again, the card goes with it rather than staying behind.
  await report({ workoutId, setId: sets[ROW][0] });
  await watching().getByRole('heading', { name: ROW }).waitFor({ timeout: 5000 });
  await report({ workoutId, setId: sets[BENCH][1] });
  await watching().getByRole('heading', { name: BENCH }).waitFor({ timeout: 5000 });
});

let swappedTo = '';
await step('a swap from the companion leaves it in place, and renames the row', async () => {
  await sessionRegion().getByRole('button').nth(2).click();
  await p.getByRole('region', { name: 'Coming up' }).getByRole('heading', { name: ROW }).waitFor({ timeout: 5000 });
  await p.getByRole('button', { name: `More for ${ROW}` }).click();
  await p.getByRole('link', { name: `Swap ${ROW} for something else` }).click();
  await p.getByRole('heading', { name: 'Swap exercise' }).waitFor({ timeout: 15000 });
  await p.waitForTimeout(600);
  const option = p.locator('main section button.ex-row').first();
  swappedTo = (await option.locator('strong').first().innerText()).trim();
  await option.click();
  await watching().waitFor({ timeout: 15000 });
  if (!(await p.getByRole('button', { name: 'Log on this phone' }).count())) throw new Error('companion mode was lost');
  const names = await sessionRegion().locator('.session-ex strong').allTextContents();
  if (names.some((name) => name === ROW)) throw new Error(`the row was not swapped: ${names}`);
  if (!names.some((name) => name.toLowerCase() === swappedTo.toLowerCase())) {
    throw new Error(`expected ${swappedTo} in the list: ${names}`);
  }
});

await step('details are folded in Beginner', async () => {
  const toggle = watching().getByRole('button', { name: `Details for ${BENCH}` });
  if ((await toggle.getAttribute('aria-expanded')) !== 'false') throw new Error('details should be folded');
  if (await p.getByRole('region', { name: 'Percentage table' }).count()) throw new Error('the table shows in Beginner');
});

await step('and open in Pro, the percentage table with them', async () => {
  await setMode('Pro');
  await report({ workoutId, setId: sets[BENCH][1] });
  await watching().waitFor({ timeout: 10000 });
  const toggle = watching().getByRole('button', { name: `Details for ${BENCH}` });
  if ((await toggle.getAttribute('aria-expanded')) !== 'true') throw new Error('details should be open in Pro');
  const table = watching().getByRole('region', { name: 'Percentage table' });
  await table.getByLabel('Your max in kilograms').waitFor({ timeout: 5000 });
  await p.setViewportSize({ width: 375, height: 667 });
  await p.waitForTimeout(300);
  await noSideScroll('companion, Pro, details open');
  await p.screenshot({ path: 'e2e/shot-companion-pro.png', fullPage: true });
  await p.setViewportSize({ width: 390, height: 844 });
  await setMode('Beginner');
  await report({ workoutId, setId: sets[BENCH][1] });
  await watching().waitFor({ timeout: 10000 });
});

await step("the watch's session ending brings the Done bar back, at the station the watch was on", async () => {
  await report({ workoutId, setId: sets[SQUAT][0] });
  await watching().getByRole('heading', { name: SQUAT }).waitFor({ timeout: 5000 });
  await endWatch();
  await doneBar().first().waitFor({ timeout: 5000 });
  if (await watching().count()) throw new Error('the companion stayed after the watch ended');
  const current = await p.locator('header [aria-current="true"]').getAttribute('aria-label');
  if (!current?.startsWith(SQUAT)) throw new Error(`expected the phone to pick up at the squat, got ${current}`);
  if ((await stripPills().count()) !== 3) throw new Error('the strip is not back');
});

await step('five minutes without a word is stale: the phone logs', async () => {
  await report({ workoutId, setId: sets[BENCH][1] });
  await watching().waitFor({ timeout: 5000 });
  await report({ workoutId, setId: sets[BENCH][1], receivedAt: Date.now() - STALE_MS - 60_000 });
  await doneBar().first().waitFor({ timeout: 5000 });
});

await step('a report going stale while the screen is open hands logging back by itself', async () => {
  await report({ workoutId, setId: sets[BENCH][1], receivedAt: Date.now() - STALE_MS + 2500 });
  await watching().waitFor({ timeout: 2000 });
  await doneBar().first().waitFor({ timeout: 6000 });
});

await step('a paused watch says so, and holds the session for an hour rather than five minutes', async () => {
  const pausedAt = new Date(Date.now() - 20 * 60_000).toISOString();
  // Heard from six minutes ago: stale for a watch that records, not for a paused one.
  await report({ workoutId, setId: sets[BENCH][1], paused: pausedAt, receivedAt: Date.now() - STALE_MS - 60_000 });
  await watching().waitFor({ timeout: 5000 });
  if (await doneBar().count()) throw new Error('a paused watch went stale after five minutes');
  const header = await p.locator('header').innerText();
  if (!/On your watch/i.test(header) || !/Paused/i.test(header)) throw new Error(`the bar does not say Paused: ${header}`);
  await p.getByRole('button', { name: 'Log on this phone' }).waitFor();
  await p.screenshot({ path: 'e2e/shot-companion-paused.png' });
  // Resumed: the word goes.
  await report({ workoutId, setId: sets[BENCH][1], paused: null });
  await watching().waitFor({ timeout: 5000 });
  if (/Paused/i.test(await p.locator('header').innerText())) throw new Error('"Paused" stayed after the watch resumed');
});

await step('a pause running past its hour while the screen is open hands logging back by itself', async () => {
  const pausedAt = new Date(Date.now() - 70 * 60_000).toISOString();
  await report({ workoutId, setId: sets[BENCH][1], paused: pausedAt, receivedAt: Date.now() - PAUSED_STALE_MS + 2500 });
  await watching().waitFor({ timeout: 2000 });
  await doneBar().first().waitFor({ timeout: 6000 });
});

await step('a watch running another workout leaves the phone logging', async () => {
  await report({ workoutId: 'another-workout', setId: null });
  await p.waitForTimeout(300);
  if (await watching().count()) throw new Error('another workout put the phone in companion mode');
  if ((await doneBar().count()) !== 1) throw new Error('expected the Done bar');
});

let claimAt = '';
await step("'Log on this phone' takes logging back at once", async () => {
  await report({ workoutId, setId: sets[BENCH][1] });
  await watching().waitFor({ timeout: 5000 });
  await p.getByRole('button', { name: 'Log on this phone' }).click();
  await doneBar().first().waitFor({ timeout: 5000 });
  if ((await stripPills().count()) !== 3) throw new Error('the strip is not back');
  if ((await wholeSession().count()) !== 1) throw new Error('"Exercise N of M" is not back');
  claimAt = await p.evaluate(() => JSON.parse(localStorage.getItem('gymgo.watch.takeBack') ?? 'null')?.at ?? '');
  if (!claimAt) throw new Error('the take-back was not stored');
});

await step('the take-back holds until the watch has seen it', async () => {
  // A report from before the watch heard of the claim.
  await report({ workoutId, setId: sets[BENCH][1], owner: 'watch', seenPhoneClaim: null });
  if (await watching().count()) throw new Error('a watch that has not seen the claim took logging back');
  // The watch saw it and stood down.
  await report({ workoutId, setId: sets[BENCH][1], owner: 'phone', seenPhoneClaim: claimAt });
  if (await watching().count()) throw new Error('the watch standing down put the companion back');
  if ((await doneBar().count()) !== 1) throw new Error('expected the Done bar');
});

await step("the watch's 'Log here instead' wins after it has seen the claim", async () => {
  await report({ workoutId, setId: sets[BENCH][1], owner: 'watch', seenPhoneClaim: claimAt });
  await watching().waitFor({ timeout: 5000 });
  await p.getByRole('status').filter({ hasText: /back on your watch/i }).waitFor({ timeout: 3000 });
  const stored = await p.evaluate(() => localStorage.getItem('gymgo.watch.takeBack'));
  if (stored !== null) throw new Error(`the spent claim was kept: ${stored}`);
});

await step('Finish from the companion lands on the "Done." summary', async () => {
  await p.getByRole('button', { name: 'Finish', exact: true }).click();
  await p.getByRole('button', { name: 'Finish and save' }).click();
  await p.waitForURL(new RegExp(`#/history/${workoutId}`), { timeout: 10000 });
  await p.getByRole('heading', { name: 'Done.' }).waitFor({ timeout: 10000 });
});

let watchFinished = '';
await step("the watch's Finish takes the open screen to the summary, once", async () => {
  await p.goto(BASE, { waitUntil: 'networkidle' });
  await p.getByRole('button', { name: 'Start empty workout' }).click();
  await p.waitForURL(/#\/workout\//, { timeout: 15000 });
  watchFinished = workoutIdFromUrl();
  await addExercise('barbell squat', /^Barbell Squat(?! To)/);
  await p.getByLabel('Set 1 weight in kilograms').fill('80');
  await p.getByLabel('Set 1 repetitions').fill('5');
  await p.getByLabel(/Mark set 1 done/).click();
  await p.waitForTimeout(400);
  await report({ workoutId: watchFinished, setId: null });
  await watching().waitFor({ timeout: 5000 });
  // What the phone's drain does with the watch's Finish event.
  await mutate('finishWorkout', watchFinished);
  await p.waitForURL(new RegExp(`#/history/${watchFinished}`), { timeout: 10000 });
  await p.getByRole('heading', { name: 'Done.' }).waitFor({ timeout: 10000 });
});

await step('opening a finished workout goes to its summary, without the poster', async () => {
  await p.goto(`${BASE}#/workout/${watchFinished}`, { waitUntil: 'networkidle' });
  await p.waitForURL(new RegExp(`#/history/${watchFinished}`), { timeout: 10000 });
  await p.getByRole('link', { name: 'Sessions' }).waitFor({ timeout: 10000 });
  if (await p.getByRole('heading', { name: 'Done.' }).count()) throw new Error('the "Done." poster showed again');
});

await step('a workout discarded from under the screen says it is gone', async () => {
  await p.goto(BASE, { waitUntil: 'networkidle' });
  await p.getByRole('button', { name: 'Start empty workout' }).click();
  await p.waitForURL(/#\/workout\//, { timeout: 15000 });
  const discarded = workoutIdFromUrl();
  await addExercise('barbell squat', /^Barbell Squat(?! To)/);
  // What the drain does with the watch's Discard.
  await mutate('discardWorkout', discarded);
  await p.getByText('That workout is gone.').waitFor({ timeout: 10000 });
  await p.getByRole('button', { name: 'Back to Today' }).click();
  await p.getByRole('heading', { name: 'Today' }).waitFor({ timeout: 10000 });
});

await step('the routine editor offers the open workout rather than a second one', async () => {
  await p.getByRole('button', { name: 'Start empty workout' }).click();
  await p.waitForURL(/#\/workout\//, { timeout: 15000 });
  const openId = workoutIdFromUrl();
  await p.goto(`${BASE}#/plan`, { waitUntil: 'networkidle' });
  await p.getByRole('button', { name: 'New routine' }).click();
  await p.getByLabel('Routine name').fill('Companion check');
  await p.getByRole('button', { name: 'Create' }).click();
  await p.getByRole('button', { name: /^Resume / }).waitFor({ timeout: 10000 });
  if (await p.getByRole('button', { name: /^Start / }).count()) throw new Error('Start was offered with a workout open');
  const routineUrl = p.url();
  await p.getByRole('button', { name: /^Resume / }).click();
  await p.waitForURL(new RegExp(`#/workout/${openId}`), { timeout: 10000 });
  await p.getByRole('button', { name: 'Finish', exact: true }).click();
  await p.getByRole('button', { name: 'Discard workout' }).click();
  await p.getByRole('heading', { name: 'Today' }).waitFor({ timeout: 10000 });
  await p.goto(routineUrl, { waitUntil: 'networkidle' });
  await p.getByRole('button', { name: /^Start / }).waitFor({ timeout: 10000 });
  const open = await idb(`return (await getAll('workouts')).filter((w) => w.deleted_at === null && w.finished_at === null).length;`);
  if (open !== 0) throw new Error(`expected no open workout, got ${open}`);
});

console.log(errs.length ? '\nBrowser errors:\n' + errs.join('\n') : '\nNo browser errors.');
await b.close();
process.exit(errs.length ? 1 : 0);
