import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from './db';
import {
  addExerciseToRoutine,
  addSet,
  completePlan,
  completeSet,
  createRoutinesFromPlan,
  discardWorkout,
  finishWorkout,
  startNextBlock,
  startWorkoutFromRoutine,
  updateGym,
} from './mutations';
import { seedIfEmpty } from './seed';
import { defaultGym, nextBlockRotation } from './blocks';
import { buildPlan } from '@/domain/programmes/plan';
import { roleForPrescription } from '@/domain/programmes/prescribe';
import type { Equipment } from '@/domain/types';
import { makeWorkout } from '@/domain/testFactories';

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
    // Rest is not prescribed: each lift rests as its size says.
    expect(rows.every((row) => row.rest_seconds === null)).toBe(true);
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
    const plan = (await db.plans.get(result.planId))!;
    // Week 1 holds only the sessions on or after the start, so a block started
    // on a Friday has no week-1 Wednesday, and the second routine's first slot
    // is in week 2. Start the block on its own first training day, a week or
    // more ago, so every week-1 slot exists whatever day the test runs on.
    // Built on the local calendar at noon: the same day either side of
    // midnight and across a clock change, which "now minus seven days" is not.
    const firstDay = [...plan.training_days].sort((a, b) => a - b)[0]!;
    const start = new Date();
    start.setHours(12, 0, 0, 0);
    start.setDate(start.getDate() - 7 - ((start.getDay() - firstDay + 7) % 7));
    await db.plans.update(result.planId, { started_at: start.toISOString() });
    const workoutId = await startWorkoutFromRoutine(result.routineIds[1]!);
    const workout = (await db.workouts.get(workoutId))!;
    expect(workout.plan_id).toBe(result.planId);
    expect(workout.plan_week).toBe(1);
    expect(workout.plan_session_index).toBe(1);
  });

  /**
   * The next block runs the same routines, and each routine still names the
   * block that first wrote it. Reading that filed every block-two session under
   * block one: the new block never saw them, so its first session rolled
   * forward forever and the block could never finish.
   */
  it('files a session under the block that is running, not the one that wrote the routine', async () => {
    const { result } = await generate(3);
    const second = await startNextBlock(result.planId);

    const workoutId = await startWorkoutFromRoutine(result.routineIds[0]!);

    expect((await db.workouts.get(workoutId))!.plan_id).toBe(second);
    // The closed block's week counter is history and stays put.
    expect((await db.plans.get(result.planId))!.current_week).toBe(1);
  });

  it('files a session under no block once its block has ended', async () => {
    const { result } = await generate(3);
    await completePlan(result.planId);

    const workoutId = await startWorkoutFromRoutine(result.routineIds[0]!);

    const workout = (await db.workouts.get(workoutId))!;
    expect(workout.plan_id).toBeNull();
    expect(workout.plan_week).toBeNull();
  });

  /** Without this the block would be five identical weeks. */
  it('adds sets in the accumulation weeks and halves them on the deload', async () => {
    const { result } = await generate(3);

    const setsInWeek = async (week: number) => {
      // The week a session belongs to comes from what has been trained, not
      // from the calendar — a skipped session rolls forward. So reaching week N
      // means having trained this routine's sessions in the weeks before it.
      const plan = (await db.plans.get(result.planId))!;
      const started = new Date();
      started.setDate(started.getDate() - (week - 1) * 7);
      await db.plans.update(plan.id, {
        started_at: started.toISOString(),
        training_days: [started.getDay()],
      });
      await db.workouts.where({ plan_id: plan.id }).delete();
      for (let earlier = 1; earlier < week; earlier += 1) {
        const day = new Date(started.getTime() + (earlier - 1) * 7 * 86_400_000).toISOString();
        await db.workouts.add(
          makeWorkout({
            id: `trained-${week}-${earlier}`,
            plan_id: plan.id,
            plan_week: earlier,
            plan_session_index: 0,
            started_at: day,
            finished_at: day,
          }),
        );
      }

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

  it('lays out sets with no RIR, because nobody has assessed them yet', async () => {
    const { result } = await generate(3);
    const workoutId = await startWorkoutFromRoutine(result.routineIds[0]!);
    const workoutExercises = await db.workout_exercises.where({ workout_id: workoutId }).toArray();
    const sets = await db.sets
      .where('workout_exercise_id')
      .anyOf(workoutExercises.map((we) => we.id))
      .toArray();

    /*
     * This used to stamp the block week's target — 3 for Foundations — onto
     * every planned set, and this test asserted it did.
     *
     * That conflated two different things under one column. `sets.rir` is what
     * the lifter judged after doing the work; the week's target is what the
     * plan asked for beforehand. Once the progression engine started reading
     * rir back, the stamp meant the engine was reading its own prescription as
     * evidence — a double jump in week one off a number the app wrote itself.
     * The target still reaches the lifter from weekModifier.targetRir and
     * routine_exercises.target_rir, shown as a target rather than an answer.
     */
    expect(sets.every((set) => set.rir === null)).toBe(true);
  });
});

/**
 * The brief: "At the end of a block, keep the main lifts and rotate the
 * accessories." Rotation repoints routine rows in place, as a swap does.
 */
describe('rotating the accessories into the next block', () => {
  const liveRows = async (routineIds: string[]) =>
    (await db.routine_exercises.where('routine_id').anyOf(routineIds).toArray()).filter(
      (row) => row.deleted_at === null,
    );

  it('keeps the main lifts and rotates every accessory, row by row', async () => {
    const { result } = await generate(4, 'upper_lower');
    const before = await liveRows(result.routineIds);

    await startNextBlock(result.planId);

    const after = new Map((await liveRows(result.routineIds)).map((row) => [row.id, row]));
    expect(after.size).toBe(before.length);
    for (const row of before) {
      const now = after.get(row.id)!;
      // The slot's prescription stays with the row.
      expect(now.target_sets).toBe(row.target_sets);
      expect(now.rep_range_low).toBe(row.rep_range_low);
      expect(now.rest_seconds).toBe(row.rest_seconds);
      expect(now.position).toBe(row.position);
      if (roleForPrescription('hypertrophy', row) === 'accessory') {
        expect(now.exercise_id, 'an accessory should rotate').not.toBe(row.exercise_id);
      } else {
        expect(now.exercise_id, 'a main lift must stay').toBe(row.exercise_id);
      }
    }
  });

  it('does what the preview said it would', async () => {
    const { result } = await generate(4, 'upper_lower');
    const preview = await nextBlockRotation((await db.plans.get(result.planId))!);
    expect(preview.length).toBeGreaterThan(0);

    await startNextBlock(result.planId);

    for (const rotation of preview) {
      expect((await db.routine_exercises.get(rotation.rowId))!.exercise_id).toBe(rotation.to.id);
    }
  });

  it('queues every row it rotates for backup', async () => {
    const { result } = await generate(4, 'upper_lower');
    const preview = await nextBlockRotation((await db.plans.get(result.planId))!);
    await db.outbox.clear();

    await startNextBlock(result.planId);

    const queued = new Set(
      (await db.outbox.where({ table_name: 'routine_exercises' }).toArray()).map((entry) => entry.row_id),
    );
    for (const rotation of preview) expect(queued.has(rotation.rowId)).toBe(true);
  });

  it('cannot reach a session already performed', async () => {
    const { result } = await generate(4, 'upper_lower');
    const workoutId = await startWorkoutFromRoutine(result.routineIds[0]!);
    const performed = (await db.workout_exercises.where({ workout_id: workoutId }).toArray()).sort(
      (a, b) => a.position - b.position,
    );
    for (const we of performed) await completeSet(await addSet(we.id, { weight_kg: 20, reps: 10 }));
    await finishWorkout(workoutId);
    const exercisesThen = performed.map((we) => we.exercise_id);

    await startNextBlock(result.planId);

    const exercisesNow = (await db.workout_exercises.where({ workout_id: workoutId }).toArray())
      .filter((we) => we.deleted_at === null)
      .sort((a, b) => a.position - b.position)
      .map((we) => we.exercise_id);
    expect(exercisesNow).toEqual(exercisesThen);
    // And the routine really did change under it, or this proves nothing.
    const routineNow = (await liveRows([result.routineIds[0]!])).map((row) => row.exercise_id);
    expect(routineNow.some((id) => !exercisesThen.includes(id))).toBe(true);
  });

  it('keeps the same accessories when asked to', async () => {
    const { result } = await generate(4, 'upper_lower');
    const before = (await liveRows(result.routineIds)).map((row) => [row.id, row.exercise_id]);

    await startNextBlock(result.planId, { rotate: false });

    const after = (await liveRows(result.routineIds)).map((row) => [row.id, row.exercise_id]);
    expect(after).toEqual(before);
  });

  it('leaves alone a lift the lifter added by hand', async () => {
    const { result } = await generate(4, 'upper_lower');
    const curl = (await db.exercises.toArray()).find((exercise) => exercise.name === 'Concentration Curls')!;
    const added = await addExerciseToRoutine(result.routineIds[0]!, curl.id);

    await startNextBlock(result.planId);

    expect((await db.routine_exercises.get(added))!.exercise_id).toBe(curl.id);
  });

  it('only rotates in what the gym has', async () => {
    const { result } = await generate(4, 'upper_lower');
    const gym = (await defaultGym())!;
    await updateGym(gym.id, { equipment_available: ['dumbbell', 'bodyweight'] });

    const rotations = await nextBlockRotation((await db.plans.get(result.planId))!);

    for (const { to } of rotations) expect(['dumbbell', 'bodyweight']).toContain(to.equipment);
  });
});
