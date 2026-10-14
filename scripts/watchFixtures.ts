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
import type { RoutineExercise, WorkoutSet } from '../src/db/schema';
import { loadableWeight, type LoadingProfile } from '../src/domain/plates';
import { weekModifier } from '../src/domain/programmes/block';
import { setBreaksRecord, type RecordMarks } from '../src/domain/prs';
import { schemeTarget } from '../src/domain/schemes';
import { estimateDurationMinutes } from '../src/domain/sessionSummary';
import { latestWorkingSet } from '../src/domain/sets';
import { layoutFromRoutine, rowsFromLayout } from '../src/domain/startLayout';
import { buildWatchSnapshot, weightLadder, type WatchEntryInput, type WatchInput, type WatchSnapshot } from '../src/domain/watch';
import {
  WATCH_PROTOCOL_VERSION,
  type WatchContext,
  type WatchEvent,
  type WatchReady,
  type WatchWeekDay,
} from '../src/domain/watchProtocol';
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
    { name: 'Barbell Bench Press', equipment: 'barbell' as const, loading: BAR, rest: 150, suggestion: { weight_kg: 82.5, reps: 8 }, label: 'Barbell' },
    { name: 'Cable Crossover', equipment: 'cable' as const, loading: STACK, rest: 90, suggestion: { weight_kg: 25, reps: 12 }, label: 'Cable' },
    { name: 'Side Lateral Raise', equipment: 'dumbbell' as const, loading: DUMBBELL, rest: 75, suggestion: null, label: 'Dumbbell' },
  ];
  const entries: WatchEntryInput[] = workoutExercises.map((we, index) => ({
    workoutExerciseId: we.id, exerciseId: we.exercise_id, name: kit[index]!.name, equipment: kit[index]!.equipment,
    technique: we.technique, restSeconds: we.rest_seconds ?? kit[index]!.rest,
    setupNote: index === 0 ? 'Bench at 3, feet flat' : null, loading: kit[index]!.loading,
    sets: sets.filter((set) => set.workout_exercise_id === we.id), suggestion: kit[index]!.suggestion,
    previous: null, priorMarks: index === 0 ? { weight: 80, e1rm: 101.3, unloadedReps: 0 } : null,
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
    entries: [{ ...bench, sets: [done, ...bench.sets.slice(1)] }, entry('b', { equipment: 'dumbbell', loading: DUMBBELL, suggestion: { weight_kg: 22.5, reps: 10 }, restSeconds: 90 })],
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

export function watchFixtures(): Record<string, unknown> {
  return {
    'carry.json': carryCases(),
    'scheme.json': schemeCases(),
    'records.json': recordCases(),
    'snapshots.json': snapshotCases(),
    'context.json': contextCases(),
    'events.json': eventCases(),
  };
}
