import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from './db';
import {
  ImmutableWorkoutError,
  addExerciseToRoutine,
  addSet,
  completePlan,
  completeSet,
  createRoutine,
  finishWorkout,
  startFreestyleWorkout,
  startWorkoutFromRoutine,
  swapRoutineExercise,
  swapWorkoutExercise,
  addExerciseToWorkout,
} from './mutations';
import { personalRecords } from '@/domain/prs';
import { newId } from '@/lib/ids';
import { nowIso } from '@/lib/dates';

const BENCH = 'exercise-bench';
const DUMBBELL = 'exercise-dumbbell';
const ROW = 'exercise-row';
const DEADLIFT = 'exercise-deadlift';
const HIP_THRUST = 'exercise-hip-thrust';
const SQUAT = 'exercise-squat';

beforeEach(async () => {
  await db.open();
  await Promise.all(db.tables.map((table) => table.clear()));
});

const liveSets = async (workoutExerciseId: string) =>
  (await db.sets.where({ workout_exercise_id: workoutExerciseId }).toArray()).filter(
    (set) => set.deleted_at === null,
  );

describe('swapping with nothing logged', () => {
  it('replaces the exercise in place', async () => {
    const workoutId = await startFreestyleWorkout();
    const weId = await addExerciseToWorkout(workoutId, BENCH);
    await addSet(weId, { weight_kg: 0, reps: 0 });

    const result = await swapWorkoutExercise(weId, DUMBBELL);

    expect(result.outcome).toBe('replaced');
    expect((await db.workout_exercises.get(weId))!.exercise_id).toBe(DUMBBELL);
    // Still one exercise in the session, not two.
    const rows = (await db.workout_exercises.where({ workout_id: workoutId }).toArray()).filter(
      (we) => we.deleted_at === null,
    );
    expect(rows).toHaveLength(1);
  });

  it('keeps the planned sets to type into', async () => {
    const workoutId = await startFreestyleWorkout();
    const weId = await addExerciseToWorkout(workoutId, BENCH);
    await addSet(weId);
    await addSet(weId);

    await swapWorkoutExercise(weId, DUMBBELL);

    expect(await liveSets(weId)).toHaveLength(2);
  });
});

/**
 * The reason this mutation exists rather than a one-line update. Repointing a
 * row that already holds a completed 100kg bench would file that set in history
 * as a 100kg dumbbell press — a record never set, against a lift never done.
 */
describe('swapping after logging sets', () => {
  async function loggedThenSwapped() {
    const workoutId = await startFreestyleWorkout();
    const weId = await addExerciseToWorkout(workoutId, BENCH);
    const first = await addSet(weId, { weight_kg: 100, reps: 5 });
    await completeSet(first);
    const second = await addSet(weId, { weight_kg: 100, reps: 5 });
    await completeSet(second);
    // Two more planned but never touched.
    await addSet(weId);
    await addSet(weId);

    const result = await swapWorkoutExercise(weId, DUMBBELL);
    return { workoutId, weId, result };
  }

  it('leaves the logged sets on the exercise that produced them', async () => {
    const { weId } = await loggedThenSwapped();

    const original = await db.workout_exercises.get(weId);
    expect(original!.exercise_id, 'the original row must not be repointed').toBe(BENCH);

    const kept = await liveSets(weId);
    expect(kept).toHaveLength(2);
    expect(kept.every((set) => set.completed)).toBe(true);
    expect(kept[0]!.weight_kg).toBe(100);
  });

  it('adds the replacement below it, carrying what was left', async () => {
    const { workoutId, result } = await loggedThenSwapped();

    expect(result.outcome).toBe('appended');
    const rows = (await db.workout_exercises.where({ workout_id: workoutId }).toArray())
      .filter((we) => we.deleted_at === null)
      .sort((a, b) => a.position - b.position);

    expect(rows).toHaveLength(2);
    expect(rows[0]!.exercise_id).toBe(BENCH);
    expect(rows[1]!.exercise_id).toBe(DUMBBELL);
    // Two sets were left unstarted, so two come across.
    expect(await liveSets(rows[1]!.id)).toHaveLength(2);
  });

  it('drops the sets that were planned but never started', async () => {
    const { weId } = await loggedThenSwapped();
    const all = await db.sets.where({ workout_exercise_id: weId }).toArray();
    expect(all.filter((set) => set.deleted_at !== null)).toHaveLength(2);
  });

  /** The whole point, stated as the thing a user would notice. */
  it('still credits the 100kg to the bench press, not the replacement', async () => {
    const { weId, result } = await loggedThenSwapped();

    const benchSets = await liveSets(weId);
    const replacementSets = await liveSets(result.workoutExerciseId);

    expect(personalRecords(benchSets).heaviest?.weight_kg).toBe(100);
    expect(personalRecords(replacementSets).heaviest).toBeNull();
  });

  it('keeps the exercises that came after it in order', async () => {
    const workoutId = await startFreestyleWorkout();
    const benchWe = await addExerciseToWorkout(workoutId, BENCH);
    const rowWe = await addExerciseToWorkout(workoutId, ROW);
    await completeSet(await addSet(benchWe, { weight_kg: 100, reps: 5 }));

    await swapWorkoutExercise(benchWe, DUMBBELL);

    const rows = (await db.workout_exercises.where({ workout_id: workoutId }).toArray())
      .filter((we) => we.deleted_at === null)
      .sort((a, b) => a.position - b.position);
    expect(rows.map((we) => we.exercise_id)).toEqual([BENCH, DUMBBELL, ROW]);
    expect(await db.workout_exercises.get(rowWe)).toBeDefined();
  });
});

describe('keeping a swap in the routine', () => {
  async function fromRoutine() {
    const routineId = await createRoutine('Push');
    await addExerciseToRoutine(routineId, BENCH);
    const workoutId = await startWorkoutFromRoutine(routineId);
    const we = (await db.workout_exercises.where({ workout_id: workoutId }).toArray())[0]!;
    return { routineId, workoutId, weId: we.id };
  }

  it('leaves the routine alone by default', async () => {
    const { routineId, weId } = await fromRoutine();

    await swapWorkoutExercise(weId, DUMBBELL);

    const rows = await db.routine_exercises.where({ routine_id: routineId }).toArray();
    expect(rows[0]!.exercise_id).toBe(BENCH);
  });

  it('updates the routine when asked', async () => {
    const { routineId, weId } = await fromRoutine();

    await swapWorkoutExercise(weId, DUMBBELL, { scope: 'routine' });

    const rows = await db.routine_exercises.where({ routine_id: routineId }).toArray();
    expect(rows[0]!.exercise_id).toBe(DUMBBELL);
  });

  /**
   * Safe to offer only because starting a routine copies it. Editing the routine
   * now must not reach a session already finished.
   */
  it('cannot reach a workout already finished', async () => {
    const { routineId } = await fromRoutine();
    // A previous session from the same routine, already done.
    const earlier = await startWorkoutFromRoutine(routineId);
    const earlierWe = (await db.workout_exercises.where({ workout_id: earlier }).toArray())[0]!;
    await completeSet(
      (await db.sets.where({ workout_exercise_id: earlierWe.id }).toArray())[0]!.id,
    );
    await finishWorkout(earlier);

    const later = await startWorkoutFromRoutine(routineId);
    const laterWe = (await db.workout_exercises.where({ workout_id: later }).toArray())[0]!;
    await swapWorkoutExercise(laterWe.id, DUMBBELL, { scope: 'routine' });

    expect((await db.workout_exercises.get(earlierWe.id))!.exercise_id).toBe(BENCH);
  });
});

describe('guards', () => {
  it('refuses to rewrite a finished workout', async () => {
    const workoutId = await startFreestyleWorkout();
    const weId = await addExerciseToWorkout(workoutId, BENCH);
    await completeSet(await addSet(weId, { weight_kg: 60, reps: 10 }));
    await finishWorkout(workoutId);

    await expect(swapWorkoutExercise(weId, DUMBBELL)).rejects.toThrow(ImmutableWorkoutError);
  });

  it('does nothing when swapping an exercise for itself', async () => {
    const workoutId = await startFreestyleWorkout();
    const weId = await addExerciseToWorkout(workoutId, BENCH);
    await completeSet(await addSet(weId, { weight_kg: 60, reps: 10 }));

    const result = await swapWorkoutExercise(weId, BENCH);

    expect(result.outcome).toBe('replaced');
    const rows = (await db.workout_exercises.where({ workout_id: workoutId }).toArray()).filter(
      (we) => we.deleted_at === null,
    );
    expect(rows).toHaveLength(1);
  });
});

/**
 * "The plan has deadlifts three times a week and I don't want them." A swap
 * that reaches every session of the block, written to the routines only.
 */
describe('swapping across the plan', () => {
  const exercisesIn = async (routineId: string) =>
    (await db.routine_exercises.where({ routine_id: routineId }).toArray())
      .filter((row) => row.deleted_at === null)
      .sort((a, b) => a.position - b.position);

  async function planWithDeadlifts() {
    const pullA = await createRoutine('Build muscle · PPL — Pull A');
    const legs = await createRoutine('Build muscle · PPL — Legs');
    const pullB = await createRoutine('Build muscle · PPL — Pull B');
    const push = await createRoutine('Build muscle · PPL — Push');
    const pullADeadlift = await addExerciseToRoutine(pullA, DEADLIFT, {
      target_sets: 5, rep_range_low: 3, rep_range_high: 5, rest_seconds: 210,
    });
    await addExerciseToRoutine(pullA, ROW);
    await addExerciseToRoutine(legs, SQUAT);
    await addExerciseToRoutine(legs, DEADLIFT, {
      target_sets: 3, rep_range_low: 6, rep_range_high: 8, rest_seconds: 150,
    });
    await addExerciseToRoutine(pullB, DEADLIFT);
    await addExerciseToRoutine(push, BENCH);

    const now = nowIso();
    const planId = newId();
    await db.plans.add({
      id: planId,
      name: 'Build muscle · PPL',
      goal: 'hypertrophy',
      days_per_week: 4,
      block_weeks: 5,
      current_week: 1,
      started_at: now,
      routine_ids: [pullA, legs, pullB, push],
      training_days: [1, 2, 4, 5],
      phase_name: 'Foundations',
      deload_week: 5,
      completed_at: null,
      user_id: null,
      created_at: now,
      updated_at: now,
      deleted_at: null,
    });
    return { planId, pullA, legs, pullB, push, pullADeadlift };
  }

  it('swaps it in every session of the plan that has it', async () => {
    const { pullA, legs, pullB, push, pullADeadlift } = await planWithDeadlifts();

    const changed = await swapRoutineExercise(pullADeadlift, HIP_THRUST, { scope: 'plan' });

    expect(changed).toBe(3);
    for (const routine of [pullA, legs, pullB]) {
      const ids = (await exercisesIn(routine)).map((row) => row.exercise_id);
      expect(ids).toContain(HIP_THRUST);
      expect(ids).not.toContain(DEADLIFT);
    }
    expect((await exercisesIn(push)).map((row) => row.exercise_id)).toEqual([BENCH]);
  });

  /** The sets, reps and rest were written for the slot, not the lift. */
  it('keeps each session its own prescription and order', async () => {
    const { pullA, legs, pullADeadlift } = await planWithDeadlifts();

    await swapRoutineExercise(pullADeadlift, HIP_THRUST, { scope: 'plan' });

    const [first] = await exercisesIn(pullA);
    expect(first).toMatchObject({
      exercise_id: HIP_THRUST, target_sets: 5, rep_range_low: 3, rep_range_high: 5, rest_seconds: 210,
    });
    const legRows = await exercisesIn(legs);
    expect(legRows.map((row) => row.exercise_id)).toEqual([SQUAT, HIP_THRUST]);
    expect(legRows[1]).toMatchObject({ target_sets: 3, rep_range_low: 6, rep_range_high: 8, rest_seconds: 150 });
  });

  it('leaves routines outside the plan alone', async () => {
    const { pullADeadlift } = await planWithDeadlifts();
    const mine = await createRoutine('My own pulls');
    await addExerciseToRoutine(mine, DEADLIFT);

    await swapRoutineExercise(pullADeadlift, HIP_THRUST, { scope: 'plan' });

    expect((await exercisesIn(mine)).map((row) => row.exercise_id)).toEqual([DEADLIFT]);
  });

  it('changes only the one session when asked to', async () => {
    const { pullA, legs, pullB, pullADeadlift } = await planWithDeadlifts();

    const changed = await swapRoutineExercise(pullADeadlift, HIP_THRUST, { scope: 'routine' });

    expect(changed).toBe(1);
    expect((await exercisesIn(pullA))[0]!.exercise_id).toBe(HIP_THRUST);
    expect((await exercisesIn(legs)).map((row) => row.exercise_id)).toContain(DEADLIFT);
    expect((await exercisesIn(pullB)).map((row) => row.exercise_id)).toEqual([DEADLIFT]);
  });

  it('reaches only the routine once its block has ended', async () => {
    const { planId, legs, pullADeadlift } = await planWithDeadlifts();
    await completePlan(planId);

    const changed = await swapRoutineExercise(pullADeadlift, HIP_THRUST, { scope: 'plan' });

    expect(changed).toBe(1);
    expect((await exercisesIn(legs)).map((row) => row.exercise_id)).toContain(DEADLIFT);
  });

  it('starts the next session with the replacement', async () => {
    const { pullB, pullADeadlift } = await planWithDeadlifts();

    await swapRoutineExercise(pullADeadlift, HIP_THRUST, { scope: 'plan' });

    const workoutId = await startWorkoutFromRoutine(pullB);
    const rows = await db.workout_exercises.where({ workout_id: workoutId }).toArray();
    expect(rows.map((row) => row.exercise_id)).toEqual([HIP_THRUST]);
  });

  /** Finished workouts are immutable, and so is one already under way. */
  it('cannot reach a workout already performed, or one in progress', async () => {
    const { pullA, legs, pullADeadlift } = await planWithDeadlifts();
    const done = await startWorkoutFromRoutine(pullA);
    const doneDeadlift = (await db.workout_exercises.where({ workout_id: done }).toArray())
      .find((row) => row.exercise_id === DEADLIFT)!;
    await completeSet((await liveSets(doneDeadlift.id))[0]!.id);
    await finishWorkout(done);
    const underway = await startWorkoutFromRoutine(legs);

    await swapRoutineExercise(pullADeadlift, HIP_THRUST, { scope: 'plan' });

    const performed = await db.workout_exercises.where('workout_id').anyOf([done, underway]).toArray();
    expect(performed.filter((row) => row.exercise_id === DEADLIFT)).toHaveLength(2);
    expect(performed.some((row) => row.exercise_id === HIP_THRUST)).toBe(false);
  });

  it('queues every changed row for sync', async () => {
    const { pullADeadlift } = await planWithDeadlifts();
    await db.outbox.clear();

    await swapRoutineExercise(pullADeadlift, HIP_THRUST, { scope: 'plan' });

    const queued = await db.outbox.where({ table_name: 'routine_exercises' }).toArray();
    expect(queued).toHaveLength(3);
    expect(queued.every((entry) => (entry.payload as { exercise_id: string }).exercise_id === HIP_THRUST)).toBe(true);
  });

  describe('from the middle of a session', () => {
    async function underway() {
      const plan = await planWithDeadlifts();
      const workoutId = await startWorkoutFromRoutine(plan.pullA);
      const weId = (await db.workout_exercises.where({ workout_id: workoutId }).toArray())
        .find((row) => row.exercise_id === DEADLIFT)!.id;
      return { ...plan, workoutId, weId };
    }

    it('changes only today by default', async () => {
      const { pullA, weId } = await underway();

      await swapWorkoutExercise(weId, HIP_THRUST);

      expect((await db.workout_exercises.get(weId))!.exercise_id).toBe(HIP_THRUST);
      expect((await exercisesIn(pullA))[0]!.exercise_id).toBe(DEADLIFT);
    });

    it('keeps it for this session from now on', async () => {
      const { pullA, legs, weId } = await underway();

      await swapWorkoutExercise(weId, HIP_THRUST, { scope: 'routine' });

      expect((await exercisesIn(pullA))[0]!.exercise_id).toBe(HIP_THRUST);
      expect((await exercisesIn(legs)).map((row) => row.exercise_id)).toContain(DEADLIFT);
    });

    it('keeps it across the whole plan', async () => {
      const { pullA, legs, pullB, weId } = await underway();

      await swapWorkoutExercise(weId, HIP_THRUST, { scope: 'plan' });

      for (const routine of [pullA, legs, pullB]) {
        expect((await exercisesIn(routine)).map((row) => row.exercise_id)).not.toContain(DEADLIFT);
      }
    });
  });
});
