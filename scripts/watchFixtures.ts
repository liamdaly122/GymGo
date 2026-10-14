/**
 * The cases that hold the watch's Swift rules to the TypeScript ones.
 *
 * The watch keeps three rules of its own because the phone may be locked:
 * carry forward, the back-off target and the record check
 * (docs/native-roadmap.md, 4.6). Each is ported to Swift in ios/GymGoKit.
 * These cases run the TypeScript functions and record their answers;
 * `npm run fixtures:watch` writes them to fixtures/watch/, Vitest fails if the
 * files fall behind the TypeScript, and GymGoKit's tests run the Swift port
 * over the same files. A change on either side fails the other side's tests.
 */
import type { WorkoutSet } from '../src/db/schema';
import { loadableWeight, type LoadingProfile } from '../src/domain/plates';
import { setBreaksRecord, type RecordMarks } from '../src/domain/prs';
import { schemeTarget } from '../src/domain/schemes';
import { latestWorkingSet } from '../src/domain/sets';
import { buildWatchSnapshot, weightLadder, type WatchEntryInput, type WatchInput } from '../src/domain/watch';
import { makeSet } from '../src/domain/testFactories';

const BAR: LoadingProfile = { mode: 'barbell', barWeight: 20, plates: [25, 20, 15, 10, 5, 2.5, 1.25] };
const EZ: LoadingProfile = { mode: 'barbell', barWeight: 10, plates: [20, 10, 5, 2.5, 1.25] };
const DUMBBELL: LoadingProfile = { mode: 'fixed_step', step: 2.5 };
const STACK: LoadingProfile = { mode: 'fixed_step', step: 5 };
const FREE: LoadingProfile = { mode: 'free' };
const PROFILES = { BAR, EZ, DUMBBELL, STACK, FREE };

interface Logged { weight: number; reps: number; type?: string; parent?: boolean; at: string }

function asSet(id: string, logged: Logged, index: number): WorkoutSet {
  return makeSet({
    id, set_index: index, weight_kg: logged.weight, reps: logged.reps,
    type: (logged.type ?? 'working') as WorkoutSet['type'],
    parent_set_id: logged.parent ? 'parent' : null,
    completed: true, completed_at: logged.at,
  });
}

function carryCases() {
  const t = (minute: number) => `2026-10-14T17:${String(minute).padStart(2, '0')}:00.000Z`;
  const cases: Array<{ name: string; logged: Logged[] }> = [
    { name: 'nothing logged yet', logged: [] },
    { name: 'one working set', logged: [{ weight: 100, reps: 5, at: t(1) }] },
    { name: 'the latest, not the heaviest', logged: [{ weight: 105, reps: 5, at: t(1) }, { weight: 100, reps: 6, at: t(4) }] },
    { name: 'a warm-up is never carried', logged: [{ weight: 100, reps: 5, at: t(1) }, { weight: 60, reps: 5, type: 'warmup', at: t(3) }] },
    { name: 'a drop is never carried', logged: [{ weight: 100, reps: 5, at: t(1) }, { weight: 80, reps: 8, type: 'drop', parent: true, at: t(2) }] },
    { name: 'a back-off is never carried', logged: [{ weight: 100, reps: 5, at: t(1) }, { weight: 90, reps: 7, type: 'back_off', at: t(3) }] },
    { name: 'an empty tick is not a number', logged: [{ weight: 100, reps: 5, at: t(1) }, { weight: 0, reps: 0, at: t(5) }] },
    { name: 'a tie goes to the later set', logged: [{ weight: 100, reps: 5, at: t(2) }, { weight: 102.5, reps: 4, at: t(2) }] },
    { name: 'unloaded bodyweight work carries its reps', logged: [{ weight: 0, reps: 12, at: t(1) }] },
  ];
  return cases.map((c) => {
    const carried = latestWorkingSet(c.logged.map((l, i) => asSet(`s${i}`, l, i)));
    return { ...c, expected: carried ? { weight: carried.weight_kg, reps: carried.reps } : null };
  });
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
    suggestion: { weight_kg: 100, reps: 5 }, previous: null, priorMarks: { weight: 100, e1rm: 116.7, unloadedReps: 0 },
    ...overrides,
  };
}

function snapshotCases() {
  const base = { workoutId: 'w-1', title: 'Push A', startedAt: '2026-10-14T17:00:00.000Z', sentAt: '2026-10-14T17:05:00.000Z' };
  const cases: Array<{ name: string; input: WatchInput }> = [
    {
      name: 'two straight lifts',
      input: { ...base, entries: [entry('a'), entry('b', { equipment: 'dumbbell', loading: DUMBBELL, suggestion: { weight_kg: 22.5, reps: 10 }, restSeconds: 90, setupNote: 'Bench at 30°' })],
        stations: [{ members: [0], name: 'Lift a', outline: 'Barbell · 3 × 5' }, { members: [1], name: 'Lift b', outline: 'Dumbbell · 3 × 10' }] },
    },
    {
      name: 'a superset and a pyramid',
      input: { ...base, entries: [
        entry('a', { technique: 'reverse_pyramid', sets: ['working', 'back_off', 'back_off'].map((type, index) => makeSet({ id: `a-s${index}`, workout_exercise_id: 'a', set_index: index, type: type as WorkoutSet['type'], weight_kg: 0, reps: 0, completed: false, completed_at: null })) }),
        entry('b', { loading: STACK, equipment: 'cable', suggestion: { weight_kg: 40, reps: 12 }, restSeconds: 90 }),
        entry('c', { loading: STACK, equipment: 'cable', suggestion: { weight_kg: 25, reps: 15 }, restSeconds: 90 }),
      ], stations: [{ members: [0], name: 'Lift a', outline: 'Barbell · 3 × 5' }, { members: [1, 2], name: 'Lift b + Lift c', outline: 'Superset · Cable' }] },
    },
  ];
  return cases.map((c) => ({ name: c.name, snapshot: buildWatchSnapshot(c.input) }));
}

export function watchFixtures(): Record<string, unknown> {
  return {
    'carry.json': carryCases(),
    'scheme.json': schemeCases(),
    'records.json': recordCases(),
    'snapshots.json': snapshotCases(),
  };
}
