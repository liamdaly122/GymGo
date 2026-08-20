import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from './db';
import {
  ImmutableWorkoutError,
  addExerciseToRoutine,
  addSet,
  completeSet,
  createRoutine,
  finishWorkout,
  startFreestyleWorkout,
  startWorkoutFromRoutine,
  swapWorkoutExercise,
  addExerciseToWorkout,
} from './mutations';
import { personalRecords } from '@/domain/prs';

const BENCH = 'exercise-bench';
const DUMBBELL = 'exercise-dumbbell';
const ROW = 'exercise-row';

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

    await swapWorkoutExercise(weId, DUMBBELL, { updateRoutine: true });

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
    await swapWorkoutExercise(laterWe.id, DUMBBELL, { updateRoutine: true });

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
