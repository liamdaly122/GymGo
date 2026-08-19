import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from './db';
import { createRoutinesFromPlan, discardWorkout, startWorkoutFromRoutine } from './mutations';
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

async function generate(days = 6, splitId: 'push_pull_legs' | 'upper_lower' = 'push_pull_legs') {
  const exercises = await db.exercises.toArray();
  const plan = buildPlan({ goalId: 'build_muscle', splitId, days }, exercises, {
    equipment: COMMERCIAL,
  });
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

describe('training blocks', () => {
  it('creates a five-week block with a deload at the end', async () => {
    const { result } = await generate(3);
    const plan = (await db.plans.get(result.planId))!;
    expect(plan.block_weeks).toBe(5);
    expect(plan.deload_week).toBe(5);
    expect(plan.phase_name).toBe('Foundations');
    expect(plan.training_days).toHaveLength(3);
  });

  it('spreads training days across the week rather than bunching them', async () => {
    const { result } = await generate(4, 'upper_lower');
    const plan = (await db.plans.get(result.planId))!;
    // Mon, Tue, Thu, Fri — not four days back to back.
    expect(plan.training_days).toEqual([1, 2, 4, 5]);
  });

  it('stamps the block, week and session onto the workout it starts', async () => {
    const { result } = await generate(3);
    const workoutId = await startWorkoutFromRoutine(result.routineIds[1]!);
    const workout = (await db.workouts.get(workoutId))!;
    expect(workout.plan_id).toBe(result.planId);
    expect(workout.plan_week).toBe(1);
    expect(workout.plan_session_index).toBe(1);
  });

  /** Without this the block would be five identical weeks. */
  it('adds sets in the accumulation weeks and halves them on the deload', async () => {
    const { result } = await generate(3);

    const setsInWeek = async (week: number) => {
      // Wind the plan back so the calendar puts us in the week under test.
      const plan = (await db.plans.get(result.planId))!;
      const started = new Date();
      started.setDate(started.getDate() - (week - 1) * 7);
      await db.plans.update(plan.id, {
        started_at: started.toISOString(),
        training_days: [started.getDay()],
      });

      const workoutId = await startWorkoutFromRoutine(result.routineIds[0]!);
      const workoutExercises = await db.workout_exercises.where({ workout_id: workoutId }).toArray();
      const sets = await db.sets
        .where('workout_exercise_id')
        .anyOf(workoutExercises.map((we) => we.id))
        .toArray();
      const first = sets.filter((set) => set.workout_exercise_id === workoutExercises[0]!.id);
      await discardWorkout(workoutId);
      return first.length;
    };

    const week1 = await setsInWeek(1);
    const week3 = await setsInWeek(3);
    const week5 = await setsInWeek(5);

    expect(week3, 'week 3 should add sets').toBeGreaterThan(week1);
    expect(week5, 'the deload should cut them back').toBeLessThan(week3);
    expect(week5).toBeGreaterThanOrEqual(1);
  });

  it('records the week\'s RIR target on the sets it lays out', async () => {
    const { result } = await generate(3);
    const workoutId = await startWorkoutFromRoutine(result.routineIds[0]!);
    const workoutExercises = await db.workout_exercises.where({ workout_id: workoutId }).toArray();
    const sets = await db.sets
      .where('workout_exercise_id')
      .anyOf(workoutExercises.map((we) => we.id))
      .toArray();
    // Week 1 is Foundations: stop three reps shy of failure.
    expect(sets[0]!.rir).toBe(3);
  });
});
