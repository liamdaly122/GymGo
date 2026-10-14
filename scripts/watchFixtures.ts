/**
 * The cases that hold the watch's Swift rules to the TypeScript ones.
 *
 * The watch keeps rules of its own because the phone may be locked: carry
 * forward (with its step-down), the back-off target, the record check, where
 * the session goes after a station, and how Up next words what follows
 * (docs/watch-protocol.md, "The watch's own rules"). Each is ported to Swift
 * in ios/GymGoKit. These cases run the TypeScript functions and record their
 * answers; `npm run fixtures:watch` writes them to fixtures/watch/, Vitest
 * fails if the files fall behind the TypeScript, and GymGoKit's tests run the
 * Swift port over the same files. A change on either side fails the other
 * side's tests. The protocol files (context, events, state) are decoded by the
 * Swift side, so the two halves of the contract cannot drift apart.
 */
import type { RoutineExercise, WorkoutSet } from '../src/db/schema';
import { carryForward } from '../src/domain/carry';
import { staleAfter } from '../src/domain/companion';
import { loadableWeight, nextLoadableBelow, type LoadingProfile } from '../src/domain/plates';
import { weekModifier } from '../src/domain/programmes/block';
import type { SuggestionKind } from '../src/domain/progression';
import { setBreaksRecord, type RecordMarks } from '../src/domain/prs';
import { schemeTarget } from '../src/domain/schemes';
import { estimateDurationMinutes } from '../src/domain/sessionSummary';
import { latestWorkingSet } from '../src/domain/sets';
import { layoutFromRoutine, rowsFromLayout } from '../src/domain/startLayout';
import { nextStation } from '../src/domain/supersets';
import {
  buildWatchSnapshot,
  upNextFor,
  weightLadder,
  type UpNextSet,
  type WatchEntryInput,
  type WatchInput,
  type WatchSnapshot,
} from '../src/domain/watch';
import {
  WATCH_PROTOCOL_VERSION,
  type WatchContext,
  type WatchEvent,
  type WatchReady,
  type WatchStateReport,
  type WatchWeekDay,
} from '../src/domain/watchProtocol';
import { makeSet } from '../src/domain/testFactories';

const BAR: LoadingProfile = { mode: 'barbell', barWeight: 20, plates: [25, 20, 15, 10, 5, 2.5, 1.25] };
const EZ: LoadingProfile = { mode: 'barbell', barWeight: 10, plates: [20, 10, 5, 2.5, 1.25] };
const DUMBBELL: LoadingProfile = { mode: 'fixed_step', step: 2.5 };
const STACK: LoadingProfile = { mode: 'fixed_step', step: 5 };
const FREE: LoadingProfile = { mode: 'free' };
const PROFILES = { BAR, EZ, DUMBBELL, STACK, FREE };

interface Logged { weight: number; reps: number; type?: string; parent?: boolean; amrap?: boolean; at: string }

function asSet(id: string, logged: Logged, index: number): WorkoutSet {
  return makeSet({
    id, set_index: index, weight_kg: logged.weight, reps: logged.reps,
    type: (logged.type ?? 'working') as WorkoutSet['type'],
    parent_set_id: logged.parent ? 'parent' : null,
    is_amrap: logged.amrap ?? false,
    completed: true, completed_at: logged.at,
  });
}

/**
 * Rule 1, `carryForward`. The first cases carry no range and no loading: the
 * carry as it was before the step-down, which every port must still answer.
 * The rest give the bottom of the range (`repLow`), the loading and the
 * lift's ladder (a barbell's `loadableWeight` reads it on the watch), and
 * expect `stepped` when the set fell short and steps down. `below` is
 * `nextLoadableBelow` of the set carried, for the port's own check, wherever
 * the loading can step.
 */
function carryCases() {
  const t = (minute: number) => `2026-10-14T17:${String(minute).padStart(2, '0')}:00.000Z`;
  const one = (weight: number, reps: number, extra: Partial<Logged> = {}): Logged[] => [{ weight, reps, at: t(1), ...extra }];
  const cases: Array<{ name: string; logged: Logged[]; repLow?: number; loading?: LoadingProfile }> = [
    { name: 'nothing logged yet', logged: [] },
    { name: 'one working set', logged: [{ weight: 100, reps: 5, at: t(1) }] },
    { name: 'the latest, not the heaviest', logged: [{ weight: 105, reps: 5, at: t(1) }, { weight: 100, reps: 6, at: t(4) }] },
    { name: 'a warm-up is never carried', logged: [{ weight: 100, reps: 5, at: t(1) }, { weight: 60, reps: 5, type: 'warmup', at: t(3) }] },
    { name: 'a drop is never carried', logged: [{ weight: 100, reps: 5, at: t(1) }, { weight: 80, reps: 8, type: 'drop', parent: true, at: t(2) }] },
    { name: 'a back-off is never carried', logged: [{ weight: 100, reps: 5, at: t(1) }, { weight: 90, reps: 7, type: 'back_off', at: t(3) }] },
    { name: 'an empty tick is not a number', logged: [{ weight: 100, reps: 5, at: t(1) }, { weight: 0, reps: 0, at: t(5) }] },
    { name: 'a tie goes to the later set', logged: [{ weight: 100, reps: 5, at: t(2) }, { weight: 102.5, reps: 4, at: t(2) }] },
    { name: 'unloaded bodyweight work carries its reps', logged: [{ weight: 0, reps: 12, at: t(1) }] },

    // The step-down: the plan's worked examples (docs/build7-plan.md, feature 2).
    { name: 'barbell 100 × 5 on 8–10 steps down to 90 × 8', logged: one(100, 5), repLow: 8, loading: BAR },
    { name: 'barbell 100 × 7 on 8–10: one rep short rounds down to 95', logged: one(100, 7), repLow: 8, loading: BAR },
    { name: 'barbell 100 × 2 on 8–10 is held at 10% lighter', logged: one(100, 2), repLow: 8, loading: BAR },
    { name: 'barbell 60 × 5 on 6–8', logged: one(60, 5), repLow: 6, loading: BAR },
    { name: 'barbell 22.5 × 4 on 6–8 goes down to the bar', logged: one(22.5, 4), repLow: 6, loading: BAR },
    { name: 'dumbbells 27.5 × 6 on 8–12', logged: one(27.5, 6), repLow: 8, loading: DUMBBELL },
    { name: 'a stack 40 × 9 on 10–15: one real step beats the 10% cap', logged: one(40, 9), repLow: 10, loading: STACK },
    { name: 'a bare bar 20 × 5 on 8–10 carries unchanged', logged: one(20, 5), repLow: 8, loading: BAR },
    // Coarse kit, where one step is more than 10%.
    { name: 'dumbbells 5 × 6 on 10–12: one step is half the weight', logged: one(5, 6), repLow: 10, loading: DUMBBELL },
    { name: 'a stack 20 × 5 on 10–12: one step is a quarter', logged: one(20, 5), repLow: 10, loading: STACK },
    // Nothing lighter can be loaded: the set carries exactly as done.
    { name: 'the lightest dumbbell carries unchanged', logged: one(2.5, 6), repLow: 10, loading: DUMBBELL },
    { name: 'a stack\'s first plate carries unchanged', logged: one(5, 5), repLow: 10, loading: STACK },
    { name: 'a weight under the bar carries unchanged', logged: one(15, 5), repLow: 8, loading: BAR },
    // nextLoadableBelow on the other profiles.
    { name: 'an EZ bar 32.5 × 6 on 8–12 steps down a pair of plates', logged: one(32.5, 6), repLow: 8, loading: EZ },
    { name: 'dumbbells typed off the rack, 26 × 6 on 8–12, step from the rack above', logged: one(26, 6), repLow: 8, loading: DUMBBELL },
    // No step-down.
    { name: 'at the bottom of the range, carried as done', logged: one(100, 8), repLow: 8, loading: BAR },
    { name: 'above the range, carried as done', logged: one(100, 11), repLow: 8, loading: BAR },
    { name: 'no range (freestyle), carried as done', logged: one(100, 5), loading: BAR },
    { name: 'an AMRAP set that fell short is carried as done', logged: one(100, 5, { amrap: true }), repLow: 8, loading: BAR },
    { name: 'added weight on bodyweight work is carried as done', logged: one(20, 5), repLow: 8, loading: FREE },
    { name: 'unloaded bodyweight work 0 × 5 is carried as done', logged: one(0, 5), repLow: 8, loading: FREE },
    // Which set is judged.
    {
      name: 'a warm-up after a short working set: the working set steps down',
      logged: [{ weight: 100, reps: 5, at: t(1) }, { weight: 60, reps: 5, type: 'warmup', at: t(3) }], repLow: 8, loading: BAR,
    },
    {
      name: 'a short drop after a working set that made the range does not step down',
      logged: [{ weight: 100, reps: 9, at: t(1) }, { weight: 80, reps: 4, type: 'drop', parent: true, at: t(2) }], repLow: 8, loading: BAR,
    },
    {
      name: 'a short back-off after a working set that made the range does not step down',
      logged: [{ weight: 100, reps: 9, at: t(1) }, { weight: 90, reps: 4, type: 'back_off', at: t(3) }], repLow: 8, loading: BAR,
    },
    {
      name: 'a short set after one that made the range steps down',
      logged: [{ weight: 100, reps: 9, at: t(1) }, { weight: 100, reps: 6, at: t(4) }], repLow: 8, loading: BAR,
    },
    {
      name: 'a set that made the range after a short one carries as done',
      logged: [{ weight: 100, reps: 6, at: t(1) }, { weight: 95, reps: 8, at: t(4) }], repLow: 8, loading: BAR,
    },
    {
      name: 'a tie goes to the later set, which fell short',
      logged: [{ weight: 100, reps: 9, at: t(2) }, { weight: 100, reps: 5, at: t(2) }], repLow: 8, loading: BAR,
    },
  ];
  return cases.map((c) => {
    const sets = c.logged.map((l, i) => asSet(`s${i}`, l, i));
    const carried = carryForward(sets, c.repLow ?? null, c.loading ?? FREE);
    const latest = latestWorkingSet(sets);
    const reach = Math.max(0, ...c.logged.map((l) => l.weight));
    return {
      ...c,
      ...(c.loading ? { ladder: weightLadder(c.loading, reach) } : {}),
      expected: carried ? { weight: carried.weight_kg, reps: carried.reps, stepped: carried.stepped } : null,
      ...(c.loading && c.loading.mode !== 'free' && latest && latest.weight_kg > 0
        ? { below: nextLoadableBelow(latest.weight_kg, c.loading) }
        : {}),
    };
  });
}

/**
 * Where the session goes after a station (`nextStation` in
 * src/domain/supersets.ts): the next one with work left, else one skipped
 * earlier, never the station itself. `open[i]`: station i has a set left.
 */
function stationCases() {
  const cases: Array<{ name: string; open: boolean[]; from: number }> = [
    { name: 'the next station with work left', open: [true, true, true], from: 0 },
    { name: 'past a station already done', open: [true, false, true], from: 0 },
    { name: 'from a station done in the middle', open: [true, false, true, true], from: 1 },
    { name: 'round to a station skipped earlier', open: [true, false, false], from: 2 },
    { name: 'from the last station, round to the first open one', open: [false, true, false, false], from: 3 },
    { name: 'everything after it done, back to an earlier one', open: [true, true, false, false], from: 1 },
    { name: 'never the station itself', open: [false, true, false], from: 1 },
    { name: 'nothing open', open: [false, false, false], from: 0 },
    { name: 'one station, even with work left', open: [true], from: 0 },
  ];
  return cases.map((c) => ({ ...c, expected: nextStation(c.open, c.from) }));
}

/**
 * How Up next words the set after a set at station `from` (`upNextFor` in
 * src/domain/watch.ts). `next` carries the lift's name and the numbers the
 * set starts at; null after the last set.
 */
function upNextCases() {
  const stations = [
    { name: 'Barbell Bench Press', outline: 'Barbell · 4 × 6–10', exerciseIds: ['ex-bench'] },
    { name: 'Cable Crossover + Side Lateral Raise', outline: 'Superset · Cable + Dumbbell', exerciseIds: ['ex-fly', 'ex-raise'] },
    { name: 'Pull-up', outline: 'Bodyweight · 3 × 6–10', exerciseIds: ['ex-pullup'] },
  ];
  const next = (station: number, name: string, label: string, weight: number | null, reps: number | null): UpNextSet => ({
    station, name, label, weight, reps,
  });
  const cases: Array<{ name: string; from: number; next: UpNextSet | null }> = [
    { name: 'the same lift\'s next set, with its numbers', from: 0, next: next(0, 'Barbell Bench Press', 'Set 2 of 4', 82.5, 8) },
    { name: 'a weight to two places', from: 0, next: next(0, 'Barbell Bench Press', 'Set 3 of 4', 101.25, 5) },
    { name: 'unloaded bodyweight work says BW', from: 2, next: next(2, 'Pull-up', 'Set 2 of 3', 0, 9) },
    { name: 'no numbers without reps', from: 0, next: next(0, 'Barbell Bench Press', 'Set 2 of 4', 82.5, null) },
    { name: 'no numbers at zero reps', from: 0, next: next(0, 'Barbell Bench Press', 'Set 2 of 4', 82.5, 0) },
    { name: 'no numbers without a weight', from: 0, next: next(0, 'Barbell Bench Press', 'Set 2 of 4', null, 8) },
    { name: 'a warm-up of the same lift', from: 0, next: next(0, 'Barbell Bench Press', 'Warm-up 2 of 3', 60, 5) },
    { name: 'a superset partner, by its own name', from: 1, next: next(1, 'Side Lateral Raise', 'Set 1 of 3', 7.5, 15) },
    { name: 'a new station: its name and outline', from: 0, next: next(1, 'Cable Crossover', 'Set 1 of 3', 25, 12) },
    { name: 'back to an earlier station', from: 2, next: next(0, 'Barbell Bench Press', 'Set 4 of 4', 82.5, 8) },
    { name: 'the last set: Finish', from: 1, next: null },
  ];
  return cases.map((c) => ({ ...c, stations, expected: upNextFor(c.from, c.next, stations) }));
}

function schemeCases() {
  const cases: Array<{ name: string; profile: keyof typeof PROFILES; top: { weight: number; reps: number }; steps: number }> = [
    { name: 'one step off a barbell top set', profile: 'BAR', top: { weight: 100, reps: 5 }, steps: 1 },
    { name: 'two steps off a barbell top set', profile: 'BAR', top: { weight: 100, reps: 5 }, steps: 2 },
    { name: 'an awkward barbell weight rounds down', profile: 'BAR', top: { weight: 117.5, reps: 6 }, steps: 1 },
    { name: 'near the bare bar', profile: 'BAR', top: { weight: 22.5, reps: 8 }, steps: 1 },
    { name: 'an EZ bar', profile: 'EZ', top: { weight: 32.5, reps: 10 }, steps: 1 },
    { name: 'dumbbells', profile: 'DUMBBELL', top: { weight: 27.5, reps: 8 }, steps: 1 },
    { name: 'a light dumbbell floors at one step', profile: 'DUMBBELL', top: { weight: 2.5, reps: 12 }, steps: 2 },
    { name: 'a stack', profile: 'STACK', top: { weight: 65, reps: 10 }, steps: 1 },
    { name: 'added weight on bodyweight work', profile: 'FREE', top: { weight: 17.5, reps: 6 }, steps: 1 },
    { name: 'unloaded bodyweight work takes the reps', profile: 'FREE', top: { weight: 0, reps: 10 }, steps: 1 },
    { name: 'the top set itself', profile: 'BAR', top: { weight: 100, reps: 5 }, steps: 0 },
  ];
  return cases.map((c) => {
    const loading = PROFILES[c.profile];
    const target = schemeTarget({ weight_kg: c.top.weight, reps: c.top.reps }, c.steps, loading);
    return {
      ...c, loading, ladder: weightLadder(loading, c.top.weight),
      expected: { weight: target.weight_kg, reps: target.reps },
      // The rounding on its own, for the port's own check.
      roundedDown: loadableWeight(c.top.weight * 0.85, loading, { direction: 'down' }),
    };
  });
}

function recordCases() {
  const t = (minute: number) => `2026-10-14T17:${String(minute).padStart(2, '0')}:00.000Z`;
  const cases: Array<{ name: string; prior: RecordMarks | null; earlier: Logged[]; set: Logged }> = [
    { name: 'a first is not a record', prior: null, earlier: [], set: { weight: 100, reps: 5, at: t(5) } },
    { name: 'heavier is a weight record', prior: { weight: 100, e1rm: 116.7, unloadedReps: 0 }, earlier: [], set: { weight: 102.5, reps: 5, at: t(5) } },
    { name: 'more reps at the same weight raises the estimate', prior: { weight: 100, e1rm: 116.67, unloadedReps: 0 }, earlier: [], set: { weight: 100, reps: 6, at: t(5) } },
    { name: 'a tie is not a record', prior: { weight: 100, e1rm: 116.66666666666667, unloadedReps: 0 }, earlier: [], set: { weight: 100, reps: 5, at: t(5) } },
    { name: 'already beaten earlier today', prior: { weight: 100, e1rm: 116.7, unloadedReps: 0 }, earlier: [{ weight: 105, reps: 5, at: t(1) }], set: { weight: 102.5, reps: 5, at: t(5) } },
    { name: 'beating today\'s earlier record again', prior: { weight: 100, e1rm: 116.7, unloadedReps: 0 }, earlier: [{ weight: 102.5, reps: 5, at: t(1) }], set: { weight: 105, reps: 5, at: t(5) } },
    { name: 'a warm-up never flashes', prior: { weight: 100, e1rm: 116.7, unloadedReps: 0 }, earlier: [], set: { weight: 120, reps: 5, type: 'warmup', at: t(5) } },
    { name: 'a drop never flashes', prior: { weight: 100, e1rm: 116.7, unloadedReps: 0 }, earlier: [], set: { weight: 120, reps: 5, type: 'drop', parent: true, at: t(5) } },
    { name: 'a back-off never flashes', prior: { weight: 100, e1rm: 116.7, unloadedReps: 0 }, earlier: [], set: { weight: 120, reps: 5, type: 'back_off', at: t(5) } },
    { name: 'more unloaded reps is a rep record', prior: { weight: 0, e1rm: 0, unloadedReps: 8 }, earlier: [], set: { weight: 0, reps: 12, at: t(5) } },
    { name: 'weight on a lift done unloaded is a weight record', prior: { weight: 0, e1rm: 0, unloadedReps: 12 }, earlier: [], set: { weight: 5, reps: 8, at: t(5) } },
    { name: 'an earlier warm-up today does not raise the bar', prior: { weight: 100, e1rm: 116.7, unloadedReps: 0 }, earlier: [{ weight: 110, reps: 3, type: 'warmup', at: t(1) }], set: { weight: 102.5, reps: 5, at: t(5) } },
  ];
  return cases.map((c) => {
    const earlier = c.earlier.map((l, i) => asSet(`e${i}`, l, i));
    const record = setBreaksRecord(asSet('now', c.set, earlier.length), c.prior, earlier);
    return { ...c, expected: record };
  });
}

function entry(we: string, overrides: Partial<WatchEntryInput> = {}): WatchEntryInput {
  return {
    workoutExerciseId: we, exerciseId: `ex-${we}`, name: `Lift ${we}`, equipment: 'barbell',
    technique: 'straight', restSeconds: 150, setupNote: null, loading: BAR,
    sets: [0, 1, 2].map((index) => makeSet({
      id: `${we}-s${index}`, workout_exercise_id: we, set_index: index,
      weight_kg: 0, reps: 0, completed: false, completed_at: null,
    })),
    suggestion: { weight_kg: 100, reps: 5, kind: 'add_weight', reason: 'You hit 5 on every set at 97.5kg. Add 2.5kg.' },
    previous: null, priorMarks: { weight: 100, e1rm: 116.7, unloadedReps: 0 }, repRange: null,
    ...overrides,
  };
}

/** A suggestion as the engine words it. */
function suggest(weight_kg: number, reps: number, kind: SuggestionKind, reason: string) {
  return { weight_kg, reps, kind, reason };
}

/** The last session of a lift: finished at midday UTC, so its local day is the same in every time zone the tests run in. */
function lastSession(day: string, sets: Array<[number, number]>): NonNullable<WatchEntryInput['previous']> {
  const working = sets.map(([weight, reps], index) => makeSet({
    id: `old-${index}`, workout_exercise_id: 'old', set_index: index, weight_kg: weight, reps,
    completed: true, completed_at: `${day}T11:${String(index * 3).padStart(2, '0')}:00.000Z`,
  }));
  const top = working.reduce((best, set) => (set.weight_kg > best.weight_kg || (set.weight_kg === best.weight_kg && set.reps > best.reps) ? set : best));
  // Local midday, so the local date sent as lastTime.day is the fixture day in every time zone.
  const [y = 0, m = 1, d = 1] = day.split('-').map(Number);
  return { workout_id: 'w-old', performed_at: new Date(y, m - 1, d, 12).toISOString(), top_set: top, working_sets: working };
}

function snapshotCases() {
  const base = { workoutId: 'w-1', title: 'Push A', startedAt: '2026-10-14T17:00:00.000Z', sentAt: '2026-10-14T17:05:00.000Z' };
  const todo = (we: string, index: number, overrides: Partial<WorkoutSet> = {}) => makeSet({
    id: `${we}-s${index}`, workout_exercise_id: we, set_index: index, weight_kg: 0, reps: 0, completed: false, completed_at: null, ...overrides,
  });
  const cases: Array<{ name: string; input: WatchInput }> = [
    {
      name: 'two straight lifts',
      input: { ...base, entries: [entry('a'), entry('b', { equipment: 'dumbbell', loading: DUMBBELL, suggestion: suggest(22.5, 10, 'repeat', 'You hit 12 on every set at 22.5kg.'), restSeconds: 90, setupNote: 'Bench at 30°' })],
        stations: [{ members: [0], name: 'Lift a', outline: 'Barbell · 3 × 5' }, { members: [1], name: 'Lift b', outline: 'Dumbbell · 3 × 10' }] },
    },
    {
      name: 'a superset and a pyramid',
      input: { ...base, entries: [
        entry('a', { technique: 'reverse_pyramid', sets: ['working', 'back_off', 'back_off'].map((type, index) => makeSet({ id: `a-s${index}`, workout_exercise_id: 'a', set_index: index, type: type as WorkoutSet['type'], weight_kg: 0, reps: 0, completed: false, completed_at: null })) }),
        entry('b', { loading: STACK, equipment: 'cable', suggestion: suggest(40, 12, 'add_reps', 'Last time 40kg × 11. Go for 12.'), restSeconds: 90 }),
        entry('c', { loading: STACK, equipment: 'cable', suggestion: suggest(25, 15, 'repeat', 'You hit 15 on every set at 25kg.'), restSeconds: 90 }),
      ], stations: [{ members: [0], name: 'Lift a', outline: 'Barbell · 3 × 5' }, { members: [1, 2], name: 'Lift b + Lift c', outline: 'Superset · Cable' }] },
    },
    {
      // The bench's first set fell short of its range, so the next steps down;
      // its last set is marked AMRAP. Last time and the plan ride on each lift.
      name: 'a plan, last time, a step down and an AMRAP set',
      input: { ...base, entries: [
        entry('a', {
          repRange: { low: 8, high: 10 },
          previous: lastSession('2026-10-03', [[97.5, 8], [97.5, 8], [97.5, 7]]),
          suggestion: suggest(100, 8, 'add_weight', 'You hit 10 on every set at 97.5kg. Add 2.5kg.'),
          sets: [
            makeSet({ id: 'a-s0', workout_exercise_id: 'a', set_index: 0, weight_kg: 100, reps: 5, completed: true, completed_at: '2026-10-14T17:03:00.000Z' }),
            todo('a', 1), todo('a', 2, { is_amrap: true }),
          ],
        }),
        entry('b', {
          name: 'Incline Dumbbell Press', equipment: 'dumbbell', loading: DUMBBELL, restSeconds: 120, repRange: { low: 8, high: 12 }, priorMarks: null,
          suggestion: suggest(22.5, 8, 'estimate', 'First time on Incline Dumbbell Press. From your Barbell Bench Press, 22.5kg is a sensible first try — it is an estimate, not history, so change it to whatever it turns out to be.'),
        }),
        entry('c', {
          name: 'Pull-up', equipment: 'bodyweight', loading: FREE, restSeconds: 120, repRange: { low: 6, high: 10 }, suggestion: null,
          priorMarks: { weight: 0, e1rm: 0, unloadedReps: 10 },
          previous: lastSession('2026-10-07', [[0, 10], [0, 9]]),
          sets: [
            makeSet({ id: 'c-s0', workout_exercise_id: 'c', set_index: 0, weight_kg: 0, reps: 5, completed: true, completed_at: '2026-10-14T17:20:00.000Z' }),
            todo('c', 1),
          ],
        }),
      ], stations: [
        { members: [0], name: 'Lift a', outline: 'Barbell · 3 × 8–10' },
        { members: [1], name: 'Incline Dumbbell Press', outline: 'Dumbbell · 3 × 8–12' },
        { members: [2], name: 'Pull-up', outline: 'Bodyweight · 2 × 6–10' },
      ] },
    },
  ];
  return cases.map((c) => ({ name: c.name, snapshot: buildWatchSnapshot(c.input) }));
}

// ---------------------------------------------------------------------------
// The protocol (src/domain/watchProtocol.ts): what the phone sends, and what
// the watch sends back. The Swift side decodes these, so the two sides of
// the contract cannot drift apart field by field.
// ---------------------------------------------------------------------------

const SENT_AT = '2026-10-14T17:05:00.000Z';
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
function idsFrom(first: number): () => string {
  let next = first;
  return () => uuid(next++);
}

function routineRow(id: string, position: number, overrides: Partial<RoutineExercise>): RoutineExercise {
  return {
    id, routine_id: uuid(900), exercise_id: `ex-${id}`, position, superset_group: null, technique: 'straight',
    target_sets: 3, rep_range_low: 8, rep_range_high: 12, target_rir: null, tempo: null, rest_seconds: null,
    user_id: null, created_at: SENT_AT, updated_at: SENT_AT, deleted_at: null,
    ...overrides,
  };
}

/** A whole week, Monday first, as the phone's calendar strip shows it. */
function week(states: Partial<Record<string, { state: WatchWeekDay['state']; name: string }>>): WatchWeekDay[] {
  const days: Array<[string, string]> = [
    ['2026-10-12', 'Mon'], ['2026-10-13', 'Tue'], ['2026-10-14', 'Wed'], ['2026-10-15', 'Thu'],
    ['2026-10-16', 'Fri'], ['2026-10-17', 'Sat'], ['2026-10-18', 'Sun'],
  ];
  return days.map(([date, weekday]) => ({
    date, weekday, state: states[date]?.state ?? 'rest', name: states[date]?.name ?? null,
  }));
}

/**
 * The session up next, as watchContextFor lays it out: a layout with its own
 * IDs, the rows that layout becomes, and the snapshot built from those rows.
 * Week 2 of the block, so every exercise carries one set more than the routine.
 */
function readySession(): WatchReady {
  const rows = [
    routineRow('bench', 0, { exercise_id: 'ex-bench', target_sets: 3, rep_range_low: 6, rep_range_high: 10, tempo: '3-1-1-0' }),
    routineRow('fly', 1, { exercise_id: 'ex-fly', superset_group: 'ss-1', rep_range_low: 10, rep_range_high: 15 }),
    routineRow('raise', 2, { exercise_id: 'ex-raise', superset_group: 'ss-1', rep_range_low: 12, rep_range_high: 15, rest_seconds: 75 }),
  ];
  const slot = { planId: uuid(902), week: 2, sessionIndex: 0 };
  const modifier = weekModifier(slot.week, 5);
  const layout = layoutFromRoutine(rows, { routineId: uuid(900), gymId: uuid(901), slot }, modifier, idsFrom(1));
  const { workoutExercises, sets } = rowsFromLayout(
    layout,
    { planId: slot.planId, week: slot.week, sessionIndex: slot.sessionIndex },
    { startedAt: SENT_AT, now: SENT_AT, readiness: null },
  );
  const kit = [
    { name: 'Barbell Bench Press', equipment: 'barbell' as const, loading: BAR, rest: 150, suggestion: suggest(82.5, 8, 'add_weight', 'You hit 10 on every set at 80kg. Add 2.5kg.'), label: 'Barbell' },
    { name: 'Cable Crossover', equipment: 'cable' as const, loading: STACK, rest: 90, suggestion: suggest(25, 12, 'add_reps', 'Last time 25kg × 11. Go for 12.'), label: 'Cable' },
    { name: 'Side Lateral Raise', equipment: 'dumbbell' as const, loading: DUMBBELL, rest: 75, suggestion: null, label: 'Dumbbell' },
  ];
  const entries: WatchEntryInput[] = workoutExercises.map((we, index) => ({
    workoutExerciseId: we.id, exerciseId: we.exercise_id, name: kit[index]!.name, equipment: kit[index]!.equipment,
    technique: we.technique, restSeconds: we.rest_seconds ?? kit[index]!.rest,
    setupNote: index === 0 ? 'Bench at 3, feet flat' : null, loading: kit[index]!.loading,
    sets: sets.filter((set) => set.workout_exercise_id === we.id), suggestion: kit[index]!.suggestion,
    previous: index === 0 ? lastSession('2026-10-07', [[80, 10], [80, 10], [80, 10]]) : null,
    priorMarks: index === 0 ? { weight: 80, e1rm: 101.3, unloadedReps: 0 } : null,
    // As composeWorkoutRows reads it: the routine's range for the exercise.
    repRange: { low: rows[index]!.rep_range_low, high: rows[index]!.rep_range_high },
  }));
  const lines = layout.exercises.map((entry, index) => ({
    name: kit[index]!.name,
    kit: kit[index]!.label,
    work: `${entry.sets.length} × ${rows[index]!.rep_range_low}–${rows[index]!.rep_range_high}`,
    badge: entry.supersetGroup ? `A${index}` : null,
    superset: entry.supersetGroup,
  }));
  return {
    key: `${slot.planId}:${slot.week}:${slot.sessionIndex}`,
    routineId: layout.routineId,
    name: 'Push A',
    date: '2026-10-14',
    status: 'today',
    movedFrom: '2026-10-13',
    week: { week: modifier.week, totalWeeks: modifier.totalWeeks, label: modifier.label },
    minutes: estimateDurationMinutes(layout.exercises.map((entry, index) => ({ sets: entry.sets.length, restSeconds: entries[index]!.restSeconds }))),
    exercises: lines,
    layout: JSON.stringify(layout),
    snapshot: buildWatchSnapshot({
      workoutId: layout.workoutId, title: 'Push A', startedAt: SENT_AT, sentAt: SENT_AT, entries,
      stations: [
        { members: [0], name: lines[0]!.name, outline: `Barbell · ${lines[0]!.work}` },
        { members: [1, 2], name: `${lines[1]!.name} + ${lines[2]!.name}`, outline: 'Superset · Cable + Dumbbell' },
      ],
    }),
  };
}

/** A workout under way on the phone: the first set of the bench logged. */
function liveSession(workoutId: string): WatchSnapshot {
  const done = makeSet({
    id: 'a-s0', workout_exercise_id: 'a', set_index: 0, weight_kg: 100, reps: 5,
    completed: true, completed_at: '2026-10-14T17:03:00.000Z',
  });
  const bench = entry('a');
  return buildWatchSnapshot({
    workoutId, title: 'Push A', startedAt: '2026-10-14T17:00:00.000Z', sentAt: SENT_AT,
    entries: [{ ...bench, sets: [done, ...bench.sets.slice(1)] }, entry('b', { equipment: 'dumbbell', loading: DUMBBELL, suggestion: suggest(22.5, 10, 'repeat', 'You hit 12 on every set at 22.5kg.'), restSeconds: 90 })],
    stations: [{ members: [0], name: 'Lift a', outline: 'Barbell · 3 × 5' }, { members: [1], name: 'Lift b', outline: 'Dumbbell · 3 × 10' }],
  });
}

function contextCases(): Array<{ name: string; context: WatchContext }> {
  const settings = { sound: true, vibrate: true };
  const base: Pick<WatchContext, 'v' | 'sentAt' | 'phoneClaim' | 'settings'> = { v: WATCH_PROTOCOL_VERSION, sentAt: SENT_AT, phoneClaim: null, settings };
  const today = { state: 'today' as const, name: 'Push A' };
  const ahead = { '2026-10-16': { state: 'planned' as const, name: 'Pull A' }, '2026-10-18': { state: 'planned' as const, name: 'Legs A' } };
  return [
    {
      name: 'a workout under way on the phone, nothing to start',
      context: {
        ...base,
        live: liveSession(uuid(500)),
        home: { today: '2026-10-14', state: 'running', doneToday: [], closed: [], ready: null, week: week({ '2026-10-14': today, ...ahead }) },
      },
    },
    {
      name: 'idle, with today\'s session ready to start on the wrist',
      context: {
        ...base,
        live: null,
        home: {
          today: '2026-10-14', state: 'ready', doneToday: [], closed: [], ready: readySession(),
          week: week({ '2026-10-12': { state: 'done', name: 'Legs B' }, '2026-10-14': today, ...ahead }),
        },
      },
    },
    {
      name: 'ended on the phone, and logging taken back on the phone',
      context: {
        ...base,
        sentAt: '2026-10-14T19:30:00.000Z',
        live: liveSession(uuid(503)),
        phoneClaim: { workoutId: uuid(503), at: '2026-10-14T19:29:41.000Z' },
        settings: { sound: false, vibrate: true },
        home: {
          today: '2026-10-14', state: 'running',
          doneToday: [{ workoutId: uuid(501), name: 'Push A' }],
          closed: [
            { workoutId: uuid(502), how: 'discarded', at: '2026-10-14T19:01:12.000Z' },
            { workoutId: uuid(501), how: 'finished', at: '2026-10-14T18:22:05.000Z' },
          ],
          ready: null,
          week: week({ '2026-10-14': { state: 'done', name: 'Push A' }, ...ahead }),
        },
      },
    },
    {
      name: 'the block is finished',
      context: {
        ...base,
        live: null,
        home: {
          today: '2026-10-14', state: 'blockDone', doneToday: [{ workoutId: uuid(504), name: 'Legs A' }], closed: [], ready: null,
          week: week({ '2026-10-12': { state: 'done', name: 'Push A' }, '2026-10-14': { state: 'done', name: 'Legs A' } }),
        },
      },
    },
    {
      name: 'no plan',
      context: { ...base, live: null, home: { today: '2026-10-14', state: 'noPlan', doneToday: [], closed: [], ready: null, week: [] } },
    },
  ];
}

/** One of each event the watch sends, as it would send them: the start echoes the ready session's layout. */
function eventCases(): WatchEvent[] {
  const ready = readySession();
  const workoutId = ready.snapshot.workoutId;
  const [first, second] = ready.snapshot.sets;
  const logged = (id: number, set: typeof first, weight: number, reps: number, at: string): WatchEvent => ({
    id: uuid(id), kind: 'completeSet', workoutId, at, setId: set!.id, weight, reps,
  });
  return [
    { id: uuid(700), kind: 'startWorkout', workoutId, at: '2026-10-14T17:06:12.000Z', routineId: ready.routineId, layout: ready.layout },
    logged(701, first, 82.5, 8, '2026-10-14T17:09:40.000Z'),
    { id: uuid(702), kind: 'skipRest', workoutId, at: '2026-10-14T17:11:02.000Z' },
    {
      id: uuid(703), kind: 'finish', workoutId, at: '2026-10-14T17:58:30.000Z',
      sets: [logged(704, second, 82.5, 7, '2026-10-14T17:13:15.500Z')],
    },
    { id: uuid(705), kind: 'discard', workoutId: uuid(503), at: '2026-10-14T19:02:00.000Z' },
  ];
}

/**
 * State reports as the watch writes them (Wire.swift: every nullable key
 * present, null where there is nothing; `rest.startedAt` left out when the
 * watch has none, as a build 6 watch never has). The Swift side decodes these
 * and the phone's `readReport` reads them back field for field.
 */
function stateCases(): Array<{ name: string; report: WatchStateReport }> {
  const workoutId = uuid(500);
  return [
    {
      name: 'every field set: paused mid-rest, a set skipped, the next in hand',
      report: {
        v: WATCH_PROTOCOL_VERSION, at: '2026-10-14T17:31:30.000Z', seq: 42, workoutId, session: 'running', owner: 'watch',
        seenPhoneClaim: '2026-10-14T17:20:00.000Z', setId: 'a-s2',
        inHand: { name: 'Lift a', detail: 'Set 3 of 3 · 100 × 5' },
        rest: { endsAt: '2026-10-14T17:33:00.000Z', startedAt: '2026-10-14T17:30:30.000Z', upNext: { name: 'Lift a', detail: 'Set 3 of 3 · 100 × 5' } },
        skipped: ['a-s1', 'b-s2'], paused: '2026-10-14T17:31:00.000Z',
        heartRate: 128, activeKcal: 210.5, health: 'recording',
      },
    },
    {
      name: 'running with nothing new: nothing skipped, not paused, no set in hand, a rest with no start',
      report: {
        v: WATCH_PROTOCOL_VERSION, at: '2026-10-14T17:12:00.000Z', seq: 7, workoutId, session: 'running', owner: 'phone',
        seenPhoneClaim: null, setId: null, inHand: null,
        rest: { endsAt: '2026-10-14T17:13:30.000Z', upNext: { name: 'Finish', detail: 'Last set done' } },
        skipped: [], paused: null, heartRate: null, activeKcal: null, health: 'denied',
      },
    },
    {
      name: 'nothing running: every nullable field null',
      report: {
        v: WATCH_PROTOCOL_VERSION, at: '2026-10-14T19:00:00.000Z', seq: 1, workoutId: null, session: 'none', owner: 'watch',
        seenPhoneClaim: null, setId: null, inHand: null, rest: null, skipped: [], paused: null,
        heartRate: null, activeKcal: null, health: 'off',
      },
    },
  ];
}

/**
 * How long a state report counts for (`staleAfter` in src/domain/companion.ts):
 * the companion's rule, which the iPhone's Live Activity keeps too
 * (`LiveSession.staleAfter` in GymGoKit). Five minutes, or an hour while the
 * watch says the workout is paused; the Swift tests hold their numbers to these.
 */
function staleCases(): Array<{ name: string; paused: string | null; staleAfterMs: number }> {
  return [
    { name: 'a report of a workout recording', paused: null, staleAfterMs: staleAfter({ paused: null }) },
    {
      name: 'a report of a paused workout',
      paused: '2026-10-14T17:31:00.000Z',
      staleAfterMs: staleAfter({ paused: '2026-10-14T17:31:00.000Z' }),
    },
  ];
}

export function watchFixtures(): Record<string, unknown> {
  return {
    'carry.json': carryCases(),
    'scheme.json': schemeCases(),
    'records.json': recordCases(),
    'stations.json': stationCases(),
    'upnext.json': upNextCases(),
    'snapshots.json': snapshotCases(),
    'context.json': contextCases(),
    'events.json': eventCases(),
    'state.json': stateCases(),
    'stale.json': staleCases(),
  };
}
