import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from './db';
import {
  addExerciseToWorkout,
  addSet,
  completeSet,
  completeSetWith,
  createRoutinesFromPlan,
  discardWorkout,
  finishWorkout,
  planRoutineStart,
  removeSet,
  startFreestyleWorkout,
  startWorkoutFromRoutine,
  swapRoutineExercise,
  updateRoutineExercise,
} from './mutations';
import { exerciseSessions, planScheduleFor, sessionPreview, setSuggestion, suggestionFor } from './queries';
import type { Plan, Workout, WorkoutExercise, WorkoutSet } from './schema';
import { seedIfEmpty } from './seed';
import {
  applyWatchEvent,
  applyWatchEvents,
  CLOSED_KEPT,
  watchContextFor,
  watchSnapshotFor,
  WATCH_EVENT_TTL_MS,
  type WatchEvent,
} from './watch';
import { buildPlan } from '@/domain/programmes/plan';
import { localIsoDate } from '@/domain/schedule';
import { parseStartLayout, type StartLayout } from '@/domain/startLayout';
import type { Equipment } from '@/domain/types';
import type { WatchContext, WatchReady } from '@/domain/watchProtocol';
import { stationName, stationOutline } from '@/features/workout/outline';

const describeStation = (entries: Parameters<typeof stationName>[0]) => ({
  name: stationName(entries),
  outline: stationOutline(entries),
});

const OPTIONS = { phoneClaim: null, settings: { sound: true, vibrate: false } };
const context = (today = new Date()): Promise<WatchContext> => watchContextFor(today, describeStation, OPTIONS);

const COMMERCIAL: Equipment[] = [
  'barbell', 'dumbbell', 'kettlebell', 'cable', 'machine', 'bands',
  'bodyweight', 'ez_bar', 'exercise_ball', 'medicine_ball', 'other',
];

let exerciseIds: string[] = [];

beforeEach(async () => {
  await db.open();
  await Promise.all(db.tables.map((table) => table.clear()));
  await seedIfEmpty();
  const barbell = (await db.exercises.toArray()).filter((exercise) => exercise.equipment === 'barbell');
  exerciseIds = barbell.slice(0, 2).map((exercise) => exercise.id);
});

/**
 * A block that trains one day a week, today, so the session up next is
 * today's whatever day the suite runs. `weeks: 1` makes that week the deload.
 */
async function blockToday(options: { weeks?: number } = {}): Promise<{ plan: Plan; routineId: string }> {
  const exercises = await db.exercises.toArray();
  const generated = buildPlan({ goalId: 'build_muscle', splitId: 'push_pull_legs', days: 3 }, exercises, {
    equipment: COMMERCIAL,
  });
  const { planId, routineIds } = await createRoutinesFromPlan(generated);
  const start = new Date();
  start.setHours(12, 0, 0, 0);
  await db.plans.update(planId, {
    started_at: start.toISOString(),
    training_days: [start.getDay()],
    block_weeks: options.weeks ?? 5,
  });
  return { plan: (await db.plans.get(planId))!, routineId: routineIds[0]! };
}

async function readyNow(): Promise<WatchReady> {
  const ready = (await context()).home.ready;
  if (!ready) throw new Error('no session ready');
  return ready;
}

const layoutOf = (ready: WatchReady): StartLayout => parseStartLayout(JSON.parse(ready.layout))!;

const event = (overrides: Partial<WatchEvent>): WatchEvent => ({
  id: crypto.randomUUID(), kind: 'completeSet', workoutId: '', at: new Date().toISOString(), ...overrides,
});

const startOf = (ready: WatchReady, at = new Date().toISOString()): WatchEvent =>
  event({ kind: 'startWorkout', workoutId: ready.snapshot.workoutId, at, routineId: ready.routineId, layout: ready.layout });

const DAY = 24 * 60 * 60 * 1000;

/** A minute apart, oldest first, ending now. */
const minutesAgo = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString();

async function rowsOf(workoutId: string): Promise<{ workout: Workout; exercises: WorkoutExercise[]; sets: WorkoutSet[] }> {
  const workout = (await db.workouts.get(workoutId))!;
  const exercises = (await db.workout_exercises.where({ workout_id: workoutId }).toArray()).sort((a, b) => a.position - b.position);
  const sets = (await db.sets.where('workout_exercise_id').anyOf(exercises.map((we) => we.id)).toArray()).sort(
    (a, b) =>
      exercises.findIndex((we) => we.id === a.workout_exercise_id) - exercises.findIndex((we) => we.id === b.workout_exercise_id) ||
      a.set_index - b.set_index,
  );
  return { workout, exercises, sets };
}

/** The rows, with what differs between two starts of the same session taken out. */
async function shapeOf(workoutId: string) {
  const { workout, exercises, sets } = await rowsOf(workoutId);
  const strip = ({ id: _id, created_at: _c, updated_at: _u, ...rest }: { id: string; created_at: string; updated_at: string }) => rest;
  const { started_at: _started, ...header } = strip(workout) as Omit<Workout, 'id' | 'created_at' | 'updated_at'>;
  return {
    workout: header,
    exercises: exercises.map((we) => {
      const { workout_id: _w, ...rest } = strip(we) as Omit<WorkoutExercise, 'id' | 'created_at' | 'updated_at'>;
      return rest;
    }),
    sets: sets.map((set) => {
      const { workout_exercise_id: we, ...rest } = strip(set) as Omit<WorkoutSet, 'id' | 'created_at' | 'updated_at'>;
      return { ...rest, position: exercises.findIndex((row) => row.id === we) };
    }),
  };
}

async function counts() {
  return Object.fromEntries(await Promise.all(db.tables.map(async (table) => [table.name, await table.count()])));
}

async function session() {
  const workoutId = await startFreestyleWorkout();
  const we = await addExerciseToWorkout(workoutId, exerciseIds[0]!);
  const sets = [await addSet(we), await addSet(we), await addSet(we)];
  return { workoutId, we, sets };
}

describe('the list the phone sends', () => {
  it('holds every set of the workout under way', async () => {
    const { workoutId, sets } = await session();
    const snapshot = (await watchSnapshotFor(workoutId, describeStation))!;
    expect(snapshot.workoutId).toBe(workoutId);
    expect(snapshot.sets.map((set) => set.id)).toEqual(sets);
    expect(snapshot.stations).toHaveLength(1);
    expect(Object.keys(snapshot.lifts)).toEqual([exerciseIds[0]]);
  });

  it('is nothing once the workout is finished', async () => {
    const { workoutId } = await session();
    await finishWorkout(workoutId);
    expect(await watchSnapshotFor(workoutId, describeStation)).toBeNull();
  });
});

describe('a set logged on the wrist', () => {
  it('lands as a tap would, stamped when it was done, and is queued for backup', async () => {
    const { workoutId, sets } = await session();
    await db.outbox.clear();
    const at = new Date(Date.now() - 60_000).toISOString();
    expect(await applyWatchEvent(event({ workoutId, setId: sets[0], weight: 100, reps: 5, at }))).toBe('applied');

    const set = (await db.sets.get(sets[0]!))!;
    expect(set).toMatchObject({ completed: true, weight_kg: 100, reps: 5, completed_at: at });
    // Stamped a minute ago, but changed now, so it syncs forward.
    expect(Date.parse(set.updated_at)).toBeGreaterThan(Date.parse(set.completed_at!));
    expect((await db.outbox.toArray()).map((entry) => entry.row_id)).toContain(sets[0]);
  });

  it('is skipped when the phone has deleted the set', async () => {
    const { workoutId, sets } = await session();
    await removeSet(sets[1]!);
    expect(await applyWatchEvent(event({ workoutId, setId: sets[1], weight: 100, reps: 5 }))).toBe('skipped');
  });

  it('is skipped once the workout is finished, which is immutable', async () => {
    const { workoutId, sets } = await session();
    await finishWorkout(workoutId);
    expect(await applyWatchEvent(event({ workoutId, setId: sets[0], weight: 100, reps: 5 }))).toBe('skipped');
  });

  it('loses to a later log of the same set on the phone', async () => {
    const { workoutId, sets } = await session();
    await applyWatchEvent(event({ workoutId, setId: sets[0], weight: 105, reps: 5, at: '2026-10-14T18:50:00.000Z' }));
    expect(await applyWatchEvent(event({ workoutId, setId: sets[0], weight: 100, reps: 5, at: '2026-10-14T18:42:00.000Z' }))).toBe('skipped');
    expect((await db.sets.get(sets[0]!))!.weight_kg).toBe(105);
  });

  /** The slow copy of an event, arriving after the phone fixed the set. */
  it('is skipped when the set was completed at exactly its time: it is the same event again', async () => {
    const { workoutId, sets } = await session();
    const logged = event({ workoutId, setId: sets[0], weight: 100, reps: 5, at: '2026-10-14T18:42:00Z' });
    expect(await applyWatchEvent(logged)).toBe('applied');
    await completeSetWith(sets[0]!, { weight_kg: 102.5, reps: 5 }, { completedAt: '2026-10-14T18:42:00Z' });
    expect(await applyWatchEvent({ ...logged, id: crypto.randomUUID() })).toBe('skipped');
    expect((await db.sets.get(sets[0]!))!.weight_kg).toBe(102.5);
  });

  /**
   * Logged on the wrist while the phone was out of range, and Finish pressed
   * on the phone before WatchConnectivity delivered it. Finish tidied the set
   * away as unticked; skipping it then, and acknowledging that, made the
   * watch forget it, so the set was lost on both.
   */
  describe('arriving after Finish on the phone', () => {
    it('goes back into the workout as the watch logged it, queued, and counts', async () => {
      const { workoutId, sets } = await session();
      await completeSetWith(sets[0]!, { weight_kg: 100, reps: 5 }, { completedAt: minutesAgo(6) });
      const late = event({ workoutId, setId: sets[1], weight: 100, reps: 4, at: minutesAgo(3) });
      await finishWorkout(workoutId);
      const finishedAt = (await db.workouts.get(workoutId))!.finished_at;
      await db.outbox.clear();
      const drained = Date.now();

      expect(await applyWatchEvents([late])).toEqual({ acknowledge: [late.id], keep: [], finished: [], revived: [workoutId] });

      const set = (await db.sets.get(sets[1]!))!;
      expect(set).toMatchObject({ completed: true, weight_kg: 100, reps: 4, completed_at: late.at, deleted_at: null });
      expect(Date.parse(set.updated_at)).toBeGreaterThanOrEqual(drained);
      expect((await db.outbox.toArray()).map((entry) => entry.row_id)).toEqual([sets[1]]);
      // Everything else stays as that Finish left it.
      expect((await db.sets.get(sets[2]!))!.deleted_at).toBe(finishedAt);
      expect((await db.workouts.get(workoutId))!.finished_at).toBe(finishedAt);
      // The lift's history has it, which is what records, last time and volume read.
      const history = (await exerciseSessions(exerciseIds[0]!)).find((entry) => entry.workout_id === workoutId)!;
      expect(history.sets.map((entry) => entry.id).sort()).toEqual([sets[0], sets[1]].sort());
    });

    it('brings its exercise back too, when Finish dropped it for having nothing logged', async () => {
      const { workoutId, sets } = await session();
      await completeSetWith(sets[0]!, { weight_kg: 100, reps: 5 }, { completedAt: minutesAgo(8) });
      const other = await addExerciseToWorkout(workoutId, exerciseIds[1]!);
      const otherSet = await addSet(other);
      const late = event({ workoutId, setId: otherSet, weight: 60, reps: 10, at: minutesAgo(2) });
      await finishWorkout(workoutId);
      expect((await db.workout_exercises.get(other))!.deleted_at).not.toBeNull();
      await db.outbox.clear();

      await applyWatchEvents([late]);

      expect((await db.workout_exercises.get(other))!.deleted_at).toBeNull();
      expect(await db.sets.get(otherSet)).toMatchObject({ completed: true, weight_kg: 60, reps: 10, deleted_at: null });
      const queued = (await db.outbox.toArray()).map((entry) => `${entry.table_name}:${entry.row_id}`);
      expect(queued.sort()).toEqual([`sets:${otherSet}`, `workout_exercises:${other}`].sort());
    });

    it('goes back from inside a late Finish from the watch, which finishes nothing again', async () => {
      const { workoutId, sets } = await session();
      const carried = event({ workoutId, setId: sets[0], weight: 100, reps: 5, at: minutesAgo(4) });
      await finishWorkout(workoutId);
      const finishedAt = (await db.workouts.get(workoutId))!.finished_at;
      const finish = event({ workoutId, kind: 'finish', at: minutesAgo(1), sets: [carried] });

      const result = await applyWatchEvents([finish]);

      expect(result.acknowledge.sort()).toEqual([finish.id, carried.id].sort());
      expect(result).toMatchObject({ keep: [], finished: [], revived: [workoutId] });
      expect(await db.sets.get(sets[0]!)).toMatchObject({ completed: true, reps: 5, deleted_at: null });
      expect((await db.workouts.get(workoutId))!.finished_at).toBe(finishedAt);
    });

    it('stays out when logged after that Finish, deleted by the lifter, or already logged on the phone', async () => {
      const { workoutId, sets } = await session();
      await completeSetWith(sets[0]!, { weight_kg: 102.5, reps: 5 }, { completedAt: minutesAgo(9) });
      await removeSet(sets[2]!);
      // Deleted by the lifter some minutes before the Finish.
      await db.sets.update(sets[2]!, { deleted_at: minutesAgo(5) });
      await finishWorkout(workoutId);
      const finishedAt = (await db.workouts.get(workoutId))!.finished_at!;
      const after = new Date(Date.parse(finishedAt) + 1000).toISOString();
      await db.outbox.clear();

      const result = await applyWatchEvents([
        event({ workoutId, setId: sets[1], weight: 100, reps: 5, at: after }),
        event({ workoutId, setId: sets[2], weight: 100, reps: 5, at: minutesAgo(4) }),
        event({ workoutId, setId: sets[0], weight: 100, reps: 5, at: minutesAgo(3) }),
      ]);

      expect(result).toMatchObject({ keep: [], revived: [] });
      expect(result.acknowledge).toHaveLength(3);
      expect((await db.sets.get(sets[1]!))!.deleted_at).toBe(finishedAt);
      expect((await db.sets.get(sets[2]!))!.deleted_at).not.toBeNull();
      expect((await db.sets.get(sets[0]!))!.weight_kg).toBe(102.5);
      expect(await db.outbox.count()).toBe(0);
    });

    it('stays out of a workout thrown away', async () => {
      const { workoutId, sets } = await session();
      await discardWorkout(workoutId);
      expect(await applyWatchEvent(event({ workoutId, setId: sets[0], weight: 100, reps: 5, at: minutesAgo(1) }))).toBe('skipped');
      expect((await db.sets.get(sets[0]!))!.completed).toBe(false);
    });
  });

  it('waits for a workout the phone does not have yet', async () => {
    expect(await applyWatchEvent(event({ workoutId: crypto.randomUUID(), setId: crypto.randomUUID(), weight: 100, reps: 5 }))).toBe('deferred');
  });

  it('is skipped, not retried, when its numbers cannot be logged', async () => {
    const { workoutId, sets } = await session();
    const result = await applyWatchEvents([event({ workoutId, setId: sets[0], weight: -5, reps: 5 })]);
    expect(result.keep).toEqual([]);
    expect((await db.sets.get(sets[0]!))!.completed).toBe(false);
  });
});

describe('a batch from the watch', () => {
  it('applies every set before Finish, so Finish never tidies a wrist set away', async () => {
    const { workoutId, sets } = await session();
    const finish = event({ workoutId, kind: 'finish', at: '2026-10-14T18:40:00.000Z' });
    const logged = event({ workoutId, setId: sets[0], weight: 100, reps: 5, at: '2026-10-14T18:45:00.000Z' });
    const result = await applyWatchEvents([finish, logged]);

    expect(result.acknowledge.sort()).toEqual([finish.id, logged.id].sort());
    expect(result.keep).toEqual([]);
    expect(result.finished).toEqual([workoutId]);
    const workout = (await db.workouts.get(workoutId))!;
    expect(workout.finished_at).not.toBeNull();
    // Finish soft-deletes unticked sets; the wrist's set survived it.
    expect((await db.sets.get(sets[0]!))).toMatchObject({ completed: true, deleted_at: null });
    expect((await db.sets.get(sets[1]!))!.deleted_at).not.toBeNull();
  });

  it('saves the sets a Finish carries before it tidies, and lets the watch forget them', async () => {
    const { workoutId, sets } = await session();
    const carried = [
      event({ workoutId, setId: sets[0], weight: 100, reps: 5, at: minutesAgo(6) }),
      event({ workoutId, setId: sets[1], weight: 100, reps: 4, at: minutesAgo(3) }),
    ];
    const finish = event({ workoutId, kind: 'finish', at: minutesAgo(1), sets: carried });

    const result = await applyWatchEvents([finish]);

    expect(result.finished).toEqual([workoutId]);
    expect(result.acknowledge.sort()).toEqual([finish.id, ...carried.map((set) => set.id)].sort());
    expect(await db.sets.get(sets[0]!)).toMatchObject({ completed: true, reps: 5, completed_at: carried[0]!.at, deleted_at: null });
    expect(await db.sets.get(sets[1]!)).toMatchObject({ completed: true, reps: 4, deleted_at: null });
    expect((await db.sets.get(sets[2]!))!.deleted_at).not.toBeNull();
  });

  it('applies a set once when it arrives on its own and inside the Finish', async () => {
    const { workoutId, sets } = await session();
    const logged = event({ workoutId, setId: sets[0], weight: 100, reps: 5, at: minutesAgo(4) });
    const finish = event({ workoutId, kind: 'finish', at: minutesAgo(1), sets: [logged] });
    await db.outbox.clear();

    const result = await applyWatchEvents([finish, logged]);

    expect(result.acknowledge.sort()).toEqual([finish.id, logged.id].sort());
    const queued = (await db.outbox.toArray()).filter((entry) => entry.row_id === sets[0] && entry.table_name === 'sets');
    expect(queued).toHaveLength(1);
  });

  it('skips a rest without writing anything, and acknowledges it', async () => {
    const { workoutId } = await session();
    await db.outbox.clear();
    const skip = event({ workoutId, kind: 'skipRest' });
    expect(await applyWatchEvents([skip])).toEqual({ acknowledge: [skip.id], keep: [], finished: [], revived: [] });
    expect(await db.outbox.count()).toBe(0);
  });

  it('throws a workout away on Discard from the wrist', async () => {
    const { workoutId } = await session();
    const discard = event({ workoutId, kind: 'discard' });
    expect(await applyWatchEvents([discard])).toEqual({ acknowledge: [discard.id], keep: [], finished: [], revived: [] });
    expect((await db.workouts.get(workoutId))!.deleted_at).not.toBeNull();
  });

  it('never throws away sets the phone logged, whatever the wrist says', async () => {
    const { workoutId, sets } = await session();
    await completeSetWith(sets[0]!, { weight_kg: 100, reps: 5 });
    const result = await applyWatchEvents([event({ workoutId, kind: 'discard' })]);
    expect(result.keep).toEqual([]);
    expect((await db.workouts.get(workoutId))!.deleted_at).toBeNull();
  });

  it('drops an event still waiting after seven days', async () => {
    const stale = event({ workoutId: crypto.randomUUID(), setId: crypto.randomUUID(), weight: 100, reps: 5, at: '2026-10-01T10:00:00.000Z' });
    const fresh = event({ ...stale, id: crypto.randomUUID(), at: '2026-10-07T10:00:00.000Z' });
    const now = new Date(Date.parse('2026-10-01T10:00:00.000Z') + WATCH_EVENT_TTL_MS + 60_000);
    expect(await applyWatchEvents([stale, fresh], now)).toEqual({ acknowledge: [stale.id], keep: [fresh.id], finished: [], revived: [] });
  });

  it('acknowledges an event it cannot read, rather than keeping it for ever', async () => {
    const garbled = event({ workoutId: crypto.randomUUID(), at: 'yesterday-ish' });
    expect(await applyWatchEvents([garbled])).toEqual({ acknowledge: [garbled.id], keep: [], finished: [], revived: [] });
  });
});

describe('a session laid out for the watch', () => {
  it('writes nothing: no rows, no outbox, not even the block week', async () => {
    const { plan, routineId } = await blockToday();
    // A stale week counter, which a tap start would refresh.
    await db.plans.update(plan.id, { current_week: 3 });
    const before = await counts();

    const layout = (await planRoutineStart(routineId))!;

    expect(await counts()).toEqual(before);
    expect((await db.plans.get(plan.id))!.current_week).toBe(3);
    expect(layout.slot).toEqual({ planId: plan.id, week: 1, sessionIndex: 0 });
    expect(await db.workouts.get(layout.workoutId)).toBeUndefined();
    // Every start is a new session: fresh IDs each time.
    expect((await planRoutineStart(routineId))!.workoutId).not.toBe(layout.workoutId);
  });

  it('is nothing for a routine that does not exist', async () => {
    expect(await planRoutineStart(crypto.randomUUID())).toBeNull();
  });

  it('starts on the wrist into the same rows a tap would write, apart from IDs and times', async () => {
    const { routineId } = await blockToday();
    const tapped = await startWorkoutFromRoutine(routineId);
    const byTap = await shapeOf(tapped);
    await discardWorkout(tapped);

    const ready = await readyNow();
    const result = await applyWatchEvents([startOf(ready)]);

    expect(result.keep).toEqual([]);
    expect(await shapeOf(ready.snapshot.workoutId)).toEqual(byTap);
  });

  it('shows the watch exactly the session the replayed workout becomes', async () => {
    // The deload week, and history on the first lift, so the week's lighter
    // load has to reach the ready session's suggestion for the two to match.
    const { routineId } = await blockToday({ weeks: 1 });
    const firstLift = (await db.routine_exercises.where({ routine_id: routineId }).toArray()).sort((a, b) => a.position - b.position)[0]!.exercise_id;
    const earlier = await startFreestyleWorkout();
    const we = await addExerciseToWorkout(earlier, firstLift);
    for (let index = 0; index < 3; index += 1) await completeSetWith(await addSet(we), { weight_kg: 100, reps: 10 });
    await finishWorkout(earlier);

    const ready = await readyNow();
    await applyWatchEvents([startOf(ready)]);
    const live = (await context()).live!;

    const without = (snapshot: typeof live) => ({ ...snapshot, sentAt: '', startedAt: '' });
    expect(without(live)).toEqual(without(ready.snapshot));
    expect(live.workoutId).toBe(ready.snapshot.workoutId);

    // And the deload really did reach it: off the block, the same lift would ask for more.
    const replayed = (await db.workouts.get(ready.snapshot.workoutId))!;
    const inBlock = (await setSuggestion(replayed.id, firstLift))!;
    const offBlock = (await suggestionFor({ ...replayed, plan_id: null, plan_week: null }, firstLift))!;
    expect(inBlock.weight_kg).toBeLessThan(offBlock.weight_kg);
    expect(ready.snapshot.sets[0]).toMatchObject({ weight: inBlock.weight_kg, source: 'suggestion' });
  });

  it('writes the layout as it is: its IDs, the time Start was pressed, the slot it was offered, all queued', async () => {
    const { plan } = await blockToday();
    const ready = await readyNow();
    const layout = layoutOf(ready);
    await db.outbox.clear();
    const pressed = minutesAgo(25);

    expect(await applyWatchEvent(startOf(ready, pressed))).toBe('applied');

    const { workout, exercises, sets } = await rowsOf(layout.workoutId);
    expect(workout).toMatchObject({
      routine_id: ready.routineId,
      plan_id: plan.id,
      plan_week: 1,
      plan_session_index: 0,
      started_at: pressed,
      finished_at: null,
      readiness: null,
    });
    expect(exercises.map((we) => we.id)).toEqual(layout.exercises.map((entry) => entry.id));
    expect(sets.map((set) => set.id)).toEqual(layout.exercises.flatMap((entry) => entry.sets.map((set) => set.id)));

    const queued = new Set((await db.outbox.toArray()).map((entry) => entry.row_id));
    for (const id of [workout.id, ...exercises.map((we) => we.id), ...sets.map((set) => set.id)]) {
      expect(queued.has(id), id).toBe(true);
    }
    // Today's session is done once it finishes, under the block and week it was offered for.
    await finishWorkout(workout.id);
    const schedule = (await planScheduleFor(new Date()))!;
    expect(schedule.schedule.find((slot) => slot.week === 1 && slot.sessionIndex === 0)).toMatchObject({
      status: 'done',
      workoutId: workout.id,
    });
  });

  it('applies a whole session sent in reverse order', async () => {
    await blockToday();
    const ready = await readyNow();
    const layout = layoutOf(ready);
    const workoutId = layout.workoutId;
    const [first, second] = layout.exercises[0]!.sets;
    const start = startOf(ready, minutesAgo(30));
    const one = event({ workoutId, setId: first!.id, weight: 60, reps: 10, at: minutesAgo(20) });
    const two = event({ workoutId, setId: second!.id, weight: 60, reps: 9, at: minutesAgo(15) });
    const finish = event({ workoutId, kind: 'finish', at: minutesAgo(1) });

    const result = await applyWatchEvents([finish, two, one, start]);

    expect(result.acknowledge.sort()).toEqual([start.id, one.id, two.id, finish.id].sort());
    expect(result.keep).toEqual([]);
    expect(result.finished).toEqual([workoutId]);
    expect(await db.sets.get(first!.id)).toMatchObject({ completed: true, reps: 10, deleted_at: null });
    expect(await db.sets.get(second!.id)).toMatchObject({ completed: true, reps: 9, deleted_at: null });
    expect((await db.workouts.get(workoutId))!.finished_at).not.toBeNull();
  });

  /**
   * The phone stays locked while the watch runs the session, so its drain
   * comes long after the Finish. Stamped at the drain, a 55-minute session
   * read as two hours and ten, and one drained next morning fell on the next day.
   */
  it('finishes when Finish was pressed on the wrist, not when the phone drained it', async () => {
    await blockToday();
    const ready = await readyNow();
    const layout = layoutOf(ready);
    const workoutId = layout.workoutId;
    const t0 = Date.now() - 130 * 60_000;
    const at = (minutes: number) => new Date(t0 + minutes * 60_000).toISOString();
    const drained = Date.now();

    const result = await applyWatchEvents([
      startOf(ready, at(0)),
      event({ workoutId, setId: layout.exercises[0]!.sets[0]!.id, weight: 60, reps: 10, at: at(50) }),
      event({ workoutId, kind: 'finish', at: at(55) }),
    ]);

    expect(result.finished).toEqual([workoutId]);
    const { workout, sets } = await rowsOf(workoutId);
    expect(workout).toMatchObject({ started_at: at(0), finished_at: at(55) });
    expect(Date.parse(workout.updated_at)).toBeGreaterThanOrEqual(drained);
    const tidied = sets.filter((set) => set.deleted_at !== null);
    expect(tidied.length).toBeGreaterThan(0);
    expect(tidied.every((set) => set.deleted_at === at(55) && Date.parse(set.updated_at) >= drained)).toBe(true);
    expect((await context()).home.closed).toContainEqual({ workoutId, how: 'finished', at: at(55) });
  });

  it('discards when Discard was pressed on the wrist', async () => {
    await blockToday();
    const ready = await readyNow();
    const workoutId = ready.snapshot.workoutId;
    const pressed = minutesAgo(40);
    await applyWatchEvents([startOf(ready, minutesAgo(45)), event({ workoutId, kind: 'discard', at: pressed })]);
    expect((await db.workouts.get(workoutId))!.deleted_at).toBe(pressed);
    expect((await context()).home.closed).toContainEqual({ workoutId, how: 'discarded', at: pressed });
  });

  it('keeps a set that arrives before its start, and applies it once the start lands', async () => {
    await blockToday();
    const ready = await readyNow();
    const layout = layoutOf(ready);
    const setId = layout.exercises[0]!.sets[0]!.id;
    const logged = event({ workoutId: layout.workoutId, setId, weight: 60, reps: 10, at: minutesAgo(5) });

    expect(await applyWatchEvents([logged])).toEqual({ acknowledge: [], keep: [logged.id], finished: [], revived: [] });

    const start = startOf(ready, minutesAgo(10));
    expect(await applyWatchEvents([logged, start])).toEqual({ acknowledge: [start.id, logged.id], keep: [], finished: [], revived: [] });
    expect(await db.sets.get(setId)).toMatchObject({ completed: true, weight_kg: 60, reps: 10 });
  });

  it('starts once, however many times the start arrives', async () => {
    await blockToday();
    const ready = await readyNow();
    const start = startOf(ready);
    expect(await applyWatchEvent(start)).toBe('applied');
    const queued = await db.outbox.count();

    expect(await applyWatchEvent({ ...start, id: crypto.randomUUID() })).toBe('skipped');
    expect(await applyWatchEvents([start])).toEqual({ acknowledge: [start.id], keep: [], finished: [], revived: [] });
    expect((await db.workouts.toArray()).filter((workout) => workout.routine_id === ready.routineId)).toHaveLength(1);
    expect(await db.outbox.count()).toBe(queued);
  });

  it('never brings back a workout the phone discarded', async () => {
    await blockToday();
    const ready = await readyNow();
    await applyWatchEvent(startOf(ready));
    await discardWorkout(ready.snapshot.workoutId);

    expect(await applyWatchEvent(startOf(ready))).toBe('skipped');
    expect((await db.workouts.get(ready.snapshot.workoutId))!.deleted_at).not.toBeNull();
    const setId = layoutOf(ready).exercises[0]!.sets[0]!.id;
    expect(await applyWatchEvent(event({ workoutId: ready.snapshot.workoutId, setId, weight: 60, reps: 8 }))).toBe('skipped');
  });

  it('writes what the watch ran even after the routine was changed on the phone', async () => {
    const { routineId } = await blockToday();
    const ready = await readyNow();
    const layout = layoutOf(ready);
    const rows = (await db.routine_exercises.where({ routine_id: routineId }).toArray()).sort((a, b) => a.position - b.position);
    const other = (await db.exercises.toArray()).find((exercise) => !rows.some((row) => row.exercise_id === exercise.id))!;
    await swapRoutineExercise(rows[0]!.id, other.id);
    await updateRoutineExercise(rows[1]!.id, { target_sets: rows[1]!.target_sets + 3 });

    await applyWatchEvent(startOf(ready));

    const { exercises, sets } = await rowsOf(layout.workoutId);
    expect(exercises.map((we) => we.exercise_id)).toEqual(layout.exercises.map((entry) => entry.exerciseId));
    expect(sets).toHaveLength(layout.exercises.reduce((total, entry) => total + entry.sets.length, 0));
  });

  it('files without a slot once that slot was trained on the phone, and never takes next week', async () => {
    const { plan, routineId } = await blockToday();
    const ready = await readyNow();
    const tapped = await startWorkoutFromRoutine(routineId);
    const { sets: tappedSets } = await rowsOf(tapped);
    await completeSetWith(tappedSets[0]!.id, { weight_kg: 60, reps: 10 });
    await finishWorkout(tapped);

    expect(await applyWatchEvent(startOf(ready))).toBe('applied');

    expect(await db.workouts.get(ready.snapshot.workoutId)).toMatchObject({
      plan_id: plan.id,
      plan_week: null,
      plan_session_index: null,
    });
  });

  it('files under no block once the block has ended', async () => {
    const { plan } = await blockToday();
    const ready = await readyNow();
    await db.plans.update(plan.id, { completed_at: new Date().toISOString() });

    await applyWatchEvent(startOf(ready));

    expect(await db.workouts.get(ready.snapshot.workoutId)).toMatchObject({ plan_id: null, plan_week: null });
  });

  it('discards an empty workout left open on the phone, so the watch takes the slot', async () => {
    const { plan, routineId } = await blockToday();
    const ready = await readyNow();
    const empty = await startWorkoutFromRoutine(routineId);
    await db.outbox.clear();

    await applyWatchEvent(startOf(ready));

    expect((await db.workouts.get(empty))!.deleted_at).not.toBeNull();
    expect((await db.outbox.toArray()).some((entry) => entry.row_id === empty && entry.op === 'delete')).toBe(true);
    expect(await db.workouts.get(ready.snapshot.workoutId)).toMatchObject({ plan_id: plan.id, plan_week: 1, plan_session_index: 0 });
  });

  /**
   * Finish on the phone drains the inbox first. When that drain gives an empty
   * phone workout's place to the watch's, the phone's Finish must not then
   * finish it as well: the watch would be told it was finished, not discarded.
   */
  it('lets no Finish on the phone finish the empty workout a start from the watch discarded', async () => {
    const { routineId } = await blockToday();
    const ready = await readyNow();
    const empty = await startWorkoutFromRoutine(routineId);

    await applyWatchEvents([startOf(ready)]);

    expect(await finishWorkout(empty)).toBe(false);
    const workout = (await db.workouts.get(empty))!;
    expect(workout.finished_at).toBeNull();
    expect(workout.deleted_at).not.toBeNull();
    expect((await context()).home.closed.find((entry) => entry.workoutId === empty)).toMatchObject({ how: 'discarded' });
  });

  /**
   * Discard on the wrist frees the ready session, and the next context offers
   * it again with fresh IDs. Applied after the second start, the discard left
   * the first workout holding the slot while that start was filed, so the
   * session actually trained became an extra and the slot stayed to do.
   */
  describe('started again on the wrist after a Discard', () => {
    async function twice() {
      const { plan } = await blockToday();
      const first = await readyNow();
      const second = await readyNow();
      expect(second.key).toBe(first.key);
      expect(second.snapshot.workoutId).not.toBe(first.snapshot.workoutId);
      const w1 = first.snapshot.workoutId;
      const w2 = second.snapshot.workoutId;
      const setId = layoutOf(second).exercises[0]!.sets[0]!.id;
      return {
        plan,
        w1,
        w2,
        startW1: startOf(first, minutesAgo(30)),
        discardW1: event({ workoutId: w1, kind: 'discard', at: minutesAgo(29) }),
        startW2: startOf(second, minutesAgo(28)),
        set: event({ workoutId: w2, setId, weight: 60, reps: 10, at: minutesAgo(20) }),
        finishW2: event({ workoutId: w2, kind: 'finish', at: minutesAgo(10) }),
      };
    }

    async function expectSlotTrainedBy(planId: string, workoutId: string) {
      expect(await db.workouts.get(workoutId)).toMatchObject({ plan_id: planId, plan_week: 1, plan_session_index: 0 });
      const schedule = (await planScheduleFor(new Date()))!;
      expect(schedule.schedule.find((slot) => slot.week === 1 && slot.sessionIndex === 0)).toMatchObject({
        status: 'done',
        workoutId,
      });
    }

    it('files the second under the slot when all of it arrives in one batch', async () => {
      const { plan, w1, w2, startW1, discardW1, startW2, set, finishW2 } = await twice();

      const result = await applyWatchEvents([startW1, discardW1, startW2, set, finishW2]);

      expect(result.keep).toEqual([]);
      expect((await db.workouts.get(w1))!.deleted_at).not.toBeNull();
      await expectSlotTrainedBy(plan.id, w2);
    });

    it('files the second under the slot when the first was applied in an earlier drain', async () => {
      const { plan, w1, w2, startW1, discardW1, startW2, set, finishW2 } = await twice();
      await applyWatchEvents([startW1]);

      const result = await applyWatchEvents([startW2, set, finishW2, discardW1]);

      expect(result.keep).toEqual([]);
      expect((await db.workouts.get(w1))!.deleted_at).not.toBeNull();
      await expectSlotTrainedBy(plan.id, w2);
    });
  });

  it('keeps a workout open on the phone with sets logged, and opens the watch one beside it', async () => {
    await blockToday();
    const ready = await readyNow();
    const { workoutId, sets } = await session();
    await completeSetWith(sets[0]!, { weight_kg: 80, reps: 5 });

    await applyWatchEvent(startOf(ready));

    const open = (await db.workouts.toArray()).filter((workout) => workout.deleted_at === null && workout.finished_at === null);
    expect(open.map((workout) => workout.id).sort()).toEqual([workoutId, ready.snapshot.workoutId].sort());
  });

  it('drops an exercise no longer in the library, with its sets', async () => {
    await blockToday();
    const ready = await readyNow();
    const layout = layoutOf(ready);
    const gone = { ...layout, exercises: layout.exercises.map((entry, index) => (index === 0 ? { ...entry, exerciseId: crypto.randomUUID() } : entry)) };

    expect(await applyWatchEvent({ ...startOf(ready), layout: JSON.stringify(gone) })).toBe('applied');

    const { exercises, sets } = await rowsOf(layout.workoutId);
    expect(exercises.map((we) => we.id)).toEqual(layout.exercises.slice(1).map((entry) => entry.id));
    expect(sets.some((set) => layout.exercises[0]!.sets.some((planned) => planned.id === set.id))).toBe(false);
  });

  it('skips a start whose layout does not match it', async () => {
    await blockToday();
    const ready = await readyNow();
    const result = await applyWatchEvents([{ ...startOf(ready), workoutId: crypto.randomUUID() }, { ...startOf(ready), layout: '{' }]);
    expect(result.keep).toEqual([]);
    expect(await db.workouts.get(ready.snapshot.workoutId)).toBeUndefined();
  });

  it('keeps a start that fails, and every event for its workout with it', async () => {
    await blockToday();
    const ready = await readyNow();
    const layout = layoutOf(ready);
    // A set ID the database already holds: the write fails part way, as a full disk would.
    const { sets: taken } = await session();
    const clash = {
      ...layout,
      exercises: layout.exercises.map((entry, index) =>
        index === 1 ? { ...entry, sets: entry.sets.map((set, at) => (at === 0 ? { ...set, id: taken[0]! } : set)) } : entry,
      ),
    };
    const start = { ...startOf(ready, minutesAgo(10)), layout: JSON.stringify(clash) };
    const logged = event({ workoutId: layout.workoutId, setId: layout.exercises[0]!.sets[0]!.id, weight: 60, reps: 10, at: minutesAgo(5) });
    const skip = event({ workoutId: layout.workoutId, kind: 'skipRest', at: minutesAgo(4) });
    const finish = event({ workoutId: layout.workoutId, kind: 'finish', at: minutesAgo(1) });

    const result = await applyWatchEvents([start, logged, skip, finish]);

    expect(result.acknowledge).toEqual([]);
    expect(result.keep.sort()).toEqual([start.id, logged.id, skip.id, finish.id].sort());
    expect(await db.workouts.get(layout.workoutId)).toBeUndefined();
    expect(await db.workout_exercises.get(layout.exercises[0]!.id)).toBeUndefined();
  });
});

describe('what the watch shows at home', () => {
  it('has no plan, and nothing to start, without a block', async () => {
    const { home, live } = await context();
    expect(live).toBeNull();
    expect(home).toMatchObject({ state: 'noPlan', ready: null, week: [], today: localIsoDate(new Date()) });
  });

  it('offers today\'s session, laid out, with the numbers Today shows', async () => {
    const { plan, routineId } = await blockToday();
    const sent = await context();
    const ready = sent.home.ready!;
    const current = (await planScheduleFor(new Date()))!.current!;
    const preview = await sessionPreview(routineId, current.modifier);

    expect(sent).toMatchObject({ v: 1, live: null, phoneClaim: null, settings: OPTIONS.settings });
    expect(sent.home.state).toBe('ready');
    expect(ready).toMatchObject({
      key: `${plan.id}:1:0`,
      routineId,
      name: current.name,
      date: localIsoDate(new Date()),
      status: 'today',
      movedFrom: null,
      week: { week: 1, totalWeeks: 5, label: 'Foundations' },
      minutes: preview.minutes,
    });
    expect(ready.exercises.map((line) => line.name)).toEqual(preview.items.map((item) => item.name));
    expect(ready.exercises[0]!.work).toBe(`${preview.items[0]!.sets} × ${preview.items[0]!.reps}`);
    expect(ready.exercises.every((line) => line.kit === null || /^[A-Z]/.test(line.kit))).toBe(true);
    // The snapshot is the layout's session.
    const layout = layoutOf(ready);
    expect(ready.snapshot.workoutId).toBe(layout.workoutId);
    expect(ready.snapshot.sets.map((set) => set.id).sort()).toEqual(
      layout.exercises.flatMap((entry) => entry.sets.map((set) => set.id)).sort(),
    );
    expect(ready.snapshot.title).toBe(current.name);
    // And laying it out wrote nothing.
    expect(await db.workouts.count()).toBe(0);
  });

  it('draws the week as the phone\'s calendar strip does', async () => {
    const { routineId } = await blockToday();
    const today = localIsoDate(new Date());
    const { week } = (await context()).home;
    expect(week).toHaveLength(7);
    expect(week[0]!.weekday).toBe('Mon');
    expect(week.filter((day) => day.state !== 'rest')).toEqual([
      { date: today, weekday: week.find((day) => day.date === today)!.weekday, state: 'today', name: expect.any(String) },
    ]);

    const done = await startWorkoutFromRoutine(routineId);
    await completeSet((await rowsOf(done)).sets[0]!.id);
    await finishWorkout(done);
    expect((await context()).home.week.find((day) => day.date === today)).toMatchObject({ state: 'done' });
  });

  it('offers the next session as upcoming once today\'s is trained, and lists what was done', async () => {
    const { plan, routineId } = await blockToday();
    const done = await startWorkoutFromRoutine(routineId);
    await completeSet((await rowsOf(done)).sets[0]!.id);
    await finishWorkout(done);

    const { home } = await context();

    expect(home.state).toBe('ready');
    expect(home.ready).toMatchObject({ key: `${plan.id}:2:0`, status: 'upcoming', week: { week: 2 } });
    expect(home.ready!.date > localIsoDate(new Date())).toBe(true);
    expect(home.doneToday).toEqual([{ workoutId: done, name: home.ready!.name }]);
  });

  it('runs the open workout and offers nothing to start while one is open', async () => {
    const { routineId } = await blockToday();
    const open = await startWorkoutFromRoutine(routineId);
    const { home, live } = await context();
    expect(home).toMatchObject({ state: 'running', ready: null });
    expect(live!.workoutId).toBe(open);
    expect(live!.title).toBe((await planScheduleFor(new Date()))!.current!.name);
  });

  it('says the block is done once every session is trained', async () => {
    const { routineId } = await blockToday({ weeks: 1 });
    const done = await startWorkoutFromRoutine(routineId);
    await completeSet((await rowsOf(done)).sets[0]!.id);
    await finishWorkout(done);
    const { home } = await context();
    expect(home).toMatchObject({ state: 'blockDone', ready: null });
    expect(home.week.some((day) => day.state === 'done')).toBe(true);
  });

  it('lists the workouts that ended on the phone, finished or thrown away, newest first', async () => {
    const finished = (await session()).workoutId;
    await completeSet((await rowsOf(finished)).sets[0]!.id);
    await finishWorkout(finished);
    const discarded = (await session()).workoutId;
    await discardWorkout(discarded);
    await db.workouts.update(discarded, { deleted_at: new Date(Date.now() - 3_600_000).toISOString() });
    const open = (await session()).workoutId;

    const { home } = await context();

    expect(home.closed.map(({ workoutId, how }) => ({ workoutId, how }))).toEqual([
      { workoutId: finished, how: 'finished' },
      { workoutId: discarded, how: 'discarded' },
    ]);
    expect(home.closed.some((entry) => entry.workoutId === open)).toBe(false);
    const stamped = (await db.workouts.get(finished))!.finished_at;
    expect(home.closed.find((entry) => entry.workoutId === finished)!.at).toBe(stamped);
  });

  /**
   * The watch ends a session only when its workout is listed. Listed for a
   * day only, a Finish on the phone never reached a watch that heard nothing
   * that day, and its session ran on, holding Start back for good.
   */
  it('lists them by count, not by age, so a watch out of touch for days still hears', async () => {
    const days = (count: number) => new Date(Date.now() - count * DAY).toISOString();
    const finishedLongAgo = (await session()).workoutId;
    await finishWorkout(finishedLongAgo);
    await db.workouts.update(finishedLongAgo, { finished_at: days(3) });
    const discardedLongAgo = (await session()).workoutId;
    await discardWorkout(discardedLongAgo);
    await db.workouts.update(discardedLongAgo, { deleted_at: days(4) });

    expect((await context()).home.closed.map(({ workoutId, how }) => ({ workoutId, how }))).toEqual([
      { workoutId: finishedLongAgo, how: 'finished' },
      { workoutId: discardedLongAgo, how: 'discarded' },
    ]);

    // The newest CLOSED_KEPT, however recent.
    const newer: string[] = [];
    for (let index = 0; index < CLOSED_KEPT; index += 1) {
      const workoutId = (await session()).workoutId;
      await finishWorkout(workoutId);
      await db.workouts.update(workoutId, { finished_at: new Date(Date.now() - (index + 1) * 60_000).toISOString() });
      newer.push(workoutId);
    }
    const { closed } = (await context()).home;
    expect(closed.map((entry) => entry.workoutId)).toEqual(newer);
  });

  it('carries the phone\'s claim and switches through untouched', async () => {
    const { workoutId } = await session();
    const claim = { workoutId, at: new Date().toISOString() };
    const sent = await watchContextFor(new Date(), describeStation, { phoneClaim: claim, settings: { sound: false, vibrate: true } });
    expect(sent.phoneClaim).toEqual(claim);
    expect(sent.settings).toEqual({ sound: false, vibrate: true });
  });
});
