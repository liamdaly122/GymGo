import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from './db';
import {
  addExerciseToRoutine,
  clearGeneratedRests,
  createRoutinesFromPlan,
  finishWorkout,
  startWorkoutFromRoutine,
  updateRoutineExercise,
  completeSetWith,
} from './mutations';
import { seedIfEmpty } from './seed';
import { buildPlan } from '@/domain/programmes/plan';
import type { Equipment } from '@/domain/types';
import type { RoutineExercise } from './schema';

const COMMERCIAL: Equipment[] = [
  'barbell', 'dumbbell', 'kettlebell', 'cable', 'machine', 'bands',
  'bodyweight', 'ez_bar', 'exercise_ball', 'medicine_ball', 'other',
];

/** What the generator wrote for each Build muscle role, keyed by its rep range's floor. */
const OLD_REST: Record<number, number> = { 6: 180, 8: 120, 10: 75 };

beforeEach(async () => {
  await db.open();
  await Promise.all(db.tables.map((table) => table.clear()));
  await seedIfEmpty();
});

/**
 * A Build muscle plan as the generator used to leave it: a rest on every row,
 * by role. Written straight into the table, because no mutation writes those
 * any more, and with the outbox emptied, as if it had long since synced.
 */
async function planWithOldRests(): Promise<{ routineIds: string[]; rows: RoutineExercise[] }> {
  const exercises = await db.exercises.toArray();
  const plan = buildPlan({ goalId: 'build_muscle', splitId: 'upper_lower', days: 4 }, exercises, {
    equipment: COMMERCIAL,
  });
  const { routineIds } = await createRoutinesFromPlan(plan);
  for (const row of await db.routine_exercises.toArray()) {
    await db.routine_exercises.update(row.id, { rest_seconds: OLD_REST[row.rep_range_low]! });
  }
  await db.outbox.clear();
  return { routineIds, rows: await db.routine_exercises.toArray() };
}

describe('a new plan', () => {
  it('stores no rest, so each lift rests as its size says', async () => {
    const exercises = await db.exercises.toArray();
    const plan = buildPlan({ goalId: 'build_strength', splitId: 'upper_lower', days: 4 }, exercises, {
      equipment: COMMERCIAL,
    });
    const { routineIds } = await createRoutinesFromPlan(plan);
    expect((await db.routine_exercises.toArray()).every((row) => row.rest_seconds === null)).toBe(true);

    // And the session it starts carries none either: the timer uses the lift's.
    const workoutId = await startWorkoutFromRoutine(routineIds[0]!);
    const copied = await db.workout_exercises.where({ workout_id: workoutId }).toArray();
    expect(copied.length).toBeGreaterThan(0);
    expect(copied.every((row) => row.rest_seconds === null)).toBe(true);
  });
});

describe('handing an old plan’s rests back to the lift', () => {
  it('clears every rest the generator wrote', async () => {
    const { rows } = await planWithOldRests();
    expect(rows.every((row) => row.rest_seconds !== null)).toBe(true);

    expect(await clearGeneratedRests()).toBe(rows.length);
    expect((await db.routine_exercises.toArray()).every((row) => row.rest_seconds === null)).toBe(true);
  });

  it('leaves a rest the lifter typed, a re-prescribed row and a row added by hand', async () => {
    const { routineIds, rows } = await planWithOldRests();
    const [typed, represcribed] = rows;
    await updateRoutineExercise(typed!.id, { rest_seconds: 100 });
    // Their own rep range: no longer what the generator wrote, so the 3:00 is theirs too.
    await updateRoutineExercise(represcribed!.id, { rep_range_low: 4, rep_range_high: 6, rest_seconds: 180 });
    const added = await addExerciseToRoutine(routineIds[0]!, rows[2]!.exercise_id, { rest_seconds: 90 });

    await clearGeneratedRests();
    expect((await db.routine_exercises.get(typed!.id))!.rest_seconds).toBe(100);
    expect((await db.routine_exercises.get(represcribed!.id))!.rest_seconds).toBe(180);
    expect((await db.routine_exercises.get(added))!.rest_seconds).toBe(90);
  });

  it('queues every row it changes, so the backup hears of it', async () => {
    const { rows } = await planWithOldRests();
    await clearGeneratedRests();

    const queued = (await db.outbox.toArray()).filter((entry) => entry.table_name === 'routine_exercises');
    expect(new Set(queued.map((entry) => entry.row_id))).toEqual(new Set(rows.map((row) => row.id)));
    const before = new Map(rows.map((row) => [row.id, row.updated_at]));
    for (const row of await db.routine_exercises.toArray()) {
      expect(Date.parse(row.updated_at)).toBeGreaterThanOrEqual(Date.parse(before.get(row.id)!));
    }
  });

  it('never reaches a workout, which keeps the rest it was performed with', async () => {
    const { routineIds } = await planWithOldRests();
    const workoutId = await startWorkoutFromRoutine(routineIds[0]!);
    const firstSet = (await db.sets.toArray())[0]!;
    await completeSetWith(firstSet.id, { weight_kg: 60, reps: 8 });
    await finishWorkout(workoutId);
    const performed = (await db.workout_exercises.where({ workout_id: workoutId }).toArray()).filter(
      (row) => row.deleted_at === null,
    );
    expect(performed.length).toBeGreaterThan(0);

    await clearGeneratedRests();
    for (const row of performed) {
      expect((await db.workout_exercises.get(row.id))!.rest_seconds).toBe(row.rest_seconds);
    }
  });

  it('does nothing the second time', async () => {
    await planWithOldRests();
    await clearGeneratedRests();
    const queued = await db.outbox.count();

    expect(await clearGeneratedRests()).toBe(0);
    expect(await db.outbox.count()).toBe(queued);
  });

  it('does nothing without a plan', async () => {
    expect(await clearGeneratedRests()).toBe(0);
    expect(await db.outbox.count()).toBe(0);
  });
});
