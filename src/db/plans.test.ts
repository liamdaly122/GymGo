import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from './db';
import { createRoutinesFromPlan, startWorkoutFromRoutine } from './mutations';
import { seedIfEmpty } from './seed';
import { buildPlan } from '@/domain/programmes/plan';
import type { Equipment } from '@/domain/types';

const COMMERCIAL: Equipment[] = [
  'barbell', 'dumbbell', 'kettlebell', 'cable', 'machine', 'bands',
  'bodyweight', 'ez_bar', 'exercise_ball', 'medicine_ball', 'other',
];

beforeEach(async () => {
  await db.open();
  await Promise.all(db.tables.map((table) => table.clear()));
  await seedIfEmpty();
});

async function generate(days = 6) {
  const exercises = await db.exercises.toArray();
  const plan = buildPlan(
    { goalId: 'build_muscle', splitId: 'push_pull_legs', days },
    exercises,
    { equipment: COMMERCIAL },
  );
  return { plan, result: await createRoutinesFromPlan(plan) };
}

describe('building routines from a plan', () => {
  it('creates one routine per training day', async () => {
    const { result } = await generate(6);
    expect(result.routineIds).toHaveLength(6);
    expect(await db.routines.count()).toBe(6);
  });

  it('names routines so they are distinguishable in the list', async () => {
    await generate(6);
    const names = (await db.routines.toArray()).map((routine) => routine.name);
    expect(names.some((name) => name.includes('Push A'))).toBe(true);
    expect(names.some((name) => name.includes('Push B'))).toBe(true);
    expect(new Set(names).size).toBe(names.length);
  });

  it('carries the prescription onto every routine exercise', async () => {
    const { plan } = await generate(6);
    const rows = await db.routine_exercises.toArray();
    const expected = plan.sessions.flatMap((session) => session.exercises).length;
    expect(rows).toHaveLength(expected);
    expect(rows.every((row) => row.target_sets > 0)).toBe(true);
    expect(rows.every((row) => row.rep_range_low <= row.rep_range_high)).toBe(true);
    expect(rows.every((row) => (row.rest_seconds ?? 0) > 0)).toBe(true);
  });

  it('records a plan row and links the routines back to it', async () => {
    const { result } = await generate(3);
    const plans = await db.plans.toArray();
    expect(plans).toHaveLength(1);
    expect(plans[0]!.routine_ids).toEqual(result.routineIds);

    const routines = await db.routines.toArray();
    expect(routines.every((routine) => routine.generated_from_plan_id === result.planId)).toBe(true);
  });

  it('queues everything it wrote for sync', async () => {
    await generate(3);
    const tables = (await db.outbox.toArray()).map((entry) => entry.table_name);
    expect(tables).toContain('plans');
    expect(tables).toContain('routines');
    expect(tables).toContain('routine_exercises');
  });

  /**
   * A generated routine is an ordinary routine. That is the whole point: it
   * starts, copies and freezes exactly like one built by hand, so this feature
   * cannot reach a finished workout.
   */
  it('produces routines that start a workout like any other', async () => {
    const { result } = await generate(3);
    const routineId = result.routineIds[0]!;

    const workoutId = await startWorkoutFromRoutine(routineId);

    const copied = await db.workout_exercises.where({ workout_id: workoutId }).toArray();
    expect(copied.length).toBeGreaterThan(0);

    const routineExercises = await db.routine_exercises.where({ routine_id: routineId }).toArray();
    expect(copied.map((we) => we.exercise_id).sort()).toEqual(
      routineExercises.map((re) => re.exercise_id).sort(),
    );

    // It is a snapshot, not a reference.
    const copiedIds = new Set(copied.map((we) => we.id));
    expect(routineExercises.some((re) => copiedIds.has(re.id))).toBe(false);
  });

  it('lays out the planned sets when one of its routines is started', async () => {
    const { result } = await generate(3);
    const workoutId = await startWorkoutFromRoutine(result.routineIds[0]!);
    const workoutExercises = await db.workout_exercises.where({ workout_id: workoutId }).toArray();
    const sets = await db.sets
      .where('workout_exercise_id')
      .anyOf(workoutExercises.map((we) => we.id))
      .toArray();
    expect(sets.length).toBeGreaterThan(0);
    expect(sets.every((set) => !set.completed)).toBe(true);
  });
});
