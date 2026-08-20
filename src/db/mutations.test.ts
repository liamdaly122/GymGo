import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from './db';
import {
  ImmutableWorkoutError,
  addExerciseToRoutine,
  addExerciseToWorkout,
  addSet,
  completeSet,
  createRoutine,
  finishWorkout,
  removeExerciseFromRoutine,
  startFreestyleWorkout,
  startWorkoutFromRoutine,
  updateRoutineExercise,
  updateSet,
} from './mutations';

const EXERCISE_A = 'exercise-a';
const EXERCISE_B = 'exercise-b';

beforeEach(async () => {
  await db.open();
  await Promise.all(db.tables.map((table) => table.clear()));
});

/**
 * The brief's central rule: "Editing a routine must never change a workout I
 * have already done." It is enforced structurally — starting a workout copies
 * the routine's exercises rather than referencing them — so these tests poke at
 * the structure, not just the happy path.
 */
describe('the routine prescription reaches the session', () => {
  it('copies rest and tempo onto the workout exercise', async () => {
    const routineId = await createRoutine('Strength A');
    const reId = await addExerciseToRoutine(routineId, EXERCISE_A);
    // A strength primary rests far longer than the exercise default.
    await updateRoutineExercise(reId, { rest_seconds: 210, tempo: '3-1-1-0' });

    const workoutId = await startWorkoutFromRoutine(routineId);

    const [copied] = await db.workout_exercises.where({ workout_id: workoutId }).toArray();
    expect(copied!.rest_seconds).toBe(210);
    expect(copied!.tempo).toBe('3-1-1-0');
  });

  it('but editing the routine afterwards cannot change what was performed', async () => {
    const routineId = await createRoutine('Strength A');
    const reId = await addExerciseToRoutine(routineId, EXERCISE_A);
    await updateRoutineExercise(reId, { rest_seconds: 210 });
    const workoutId = await startWorkoutFromRoutine(routineId);

    await updateRoutineExercise(reId, { rest_seconds: 60 });

    const [copied] = await db.workout_exercises.where({ workout_id: workoutId }).toArray();
    // Copied, not referenced — the same guarantee that protects the sets.
    expect(copied!.rest_seconds).toBe(210);
  });

  it('leaves rest null when the routine prescribes none, meaning use the default', async () => {
    const routineId = await createRoutine('Freestyle-ish');
    await addExerciseToRoutine(routineId, EXERCISE_A);

    const workoutId = await startWorkoutFromRoutine(routineId);

    const [copied] = await db.workout_exercises.where({ workout_id: workoutId }).toArray();
    expect(copied!.rest_seconds).toBeNull();
  });
});

describe('routine edits cannot reach finished workouts', () => {
  it('copies routine exercises into the workout instead of referencing them', async () => {
    const routineId = await createRoutine('Lower A');
    await addExerciseToRoutine(routineId, EXERCISE_A);
    const workoutId = await startWorkoutFromRoutine(routineId);

    const copied = await db.workout_exercises.where({ workout_id: workoutId }).toArray();
    expect(copied).toHaveLength(1);
    expect(copied[0]!.exercise_id).toBe(EXERCISE_A);
    // The copy is its own row, not the routine_exercise row.
    const routineExercises = await db.routine_exercises.toArray();
    expect(copied[0]!.id).not.toBe(routineExercises[0]!.id);
  });

  it('lays out the number of sets the routine plans for, unticked', async () => {
    const routineId = await createRoutine('Lower A');
    await addExerciseToRoutine(routineId, EXERCISE_A, { target_sets: 4 });
    const workoutId = await startWorkoutFromRoutine(routineId);

    const workoutExercises = await db.workout_exercises.where({ workout_id: workoutId }).toArray();
    const sets = await db.sets.where({ workout_exercise_id: workoutExercises[0]!.id }).toArray();

    expect(sets).toHaveLength(4);
    expect(sets.every((set) => !set.completed)).toBe(true);
    expect(sets.map((set) => set.set_index).sort()).toEqual([0, 1, 2, 3]);
  });

  it('discards planned sets that were never logged, so a plan is not fake history', async () => {
    const routineId = await createRoutine('Lower A');
    await addExerciseToRoutine(routineId, EXERCISE_A, { target_sets: 3 });
    const workoutId = await startWorkoutFromRoutine(routineId);
    const workoutExercises = await db.workout_exercises.where({ workout_id: workoutId }).toArray();
    const planned = (await db.sets.where({ workout_exercise_id: workoutExercises[0]!.id }).toArray())
      .sort((a, b) => a.set_index - b.set_index);

    await updateSet(planned[0]!.id, { weight_kg: 80, reps: 8 });
    await completeSet(planned[0]!.id);
    await finishWorkout(workoutId);

    const remaining = (await db.sets.where({ workout_exercise_id: workoutExercises[0]!.id }).toArray())
      .filter((set) => set.deleted_at === null);
    expect(remaining).toHaveLength(1);
    expect(remaining[0]!.weight_kg).toBe(80);
  });

  it('leaves a finished workout untouched when the routine is edited afterwards', async () => {
    const routineId = await createRoutine('Lower A');
    const routineExerciseId = await addExerciseToRoutine(routineId, EXERCISE_A, {
      target_sets: 3,
      rep_range_low: 5,
      rep_range_high: 8,
    });

    const workoutId = await startWorkoutFromRoutine(routineId);
    const workoutExercises = await db.workout_exercises.where({ workout_id: workoutId }).toArray();

    // Starting the routine laid out its planned sets; log the first one.
    const planned = (await db.sets.where({ workout_exercise_id: workoutExercises[0]!.id }).toArray())
      .sort((a, b) => a.set_index - b.set_index);
    await updateSet(planned[0]!.id, { weight_kg: 100, reps: 5 });
    await completeSet(planned[0]!.id);
    await finishWorkout(workoutId);

    // Now rewrite the routine completely.
    await updateRoutineExercise(routineExerciseId, {
      target_sets: 10,
      rep_range_low: 20,
      rep_range_high: 30,
    });
    await removeExerciseFromRoutine(routineExerciseId);
    await addExerciseToRoutine(routineId, EXERCISE_B);

    const afterEdit = await db.workout_exercises.where({ workout_id: workoutId }).toArray();
    expect(afterEdit).toHaveLength(1);
    expect(afterEdit[0]!.exercise_id).toBe(EXERCISE_A);

    const kept = (await db.sets.where({ workout_exercise_id: afterEdit[0]!.id }).toArray())
      .filter((set) => set.deleted_at === null);
    expect(kept).toHaveLength(1);
    expect(kept[0]!.weight_kg).toBe(100);
    expect(kept[0]!.reps).toBe(5);
  });
});

describe('finished workouts are immutable', () => {
  it('refuses to edit a set after the workout is finished', async () => {
    const workoutId = await startFreestyleWorkout();
    const workoutExerciseId = await addExerciseToWorkout(workoutId, EXERCISE_A);
    const setId = await addSet(workoutExerciseId, { weight_kg: 100, reps: 5 });
    await completeSet(setId);
    await finishWorkout(workoutId);

    await expect(updateSet(setId, { weight_kg: 200 })).rejects.toThrow(ImmutableWorkoutError);
    const stored = await db.sets.get(setId);
    expect(stored!.weight_kg).toBe(100);
  });

  it('refuses to add an exercise after the workout is finished', async () => {
    const workoutId = await startFreestyleWorkout();
    const workoutExerciseId = await addExerciseToWorkout(workoutId, EXERCISE_A);
    const setId = await addSet(workoutExerciseId, { weight_kg: 60, reps: 10 });
    await completeSet(setId);
    await finishWorkout(workoutId);

    await expect(addExerciseToWorkout(workoutId, EXERCISE_B)).rejects.toThrow(ImmutableWorkoutError);
  });

  it('refuses to finish a workout twice', async () => {
    const workoutId = await startFreestyleWorkout();
    const workoutExerciseId = await addExerciseToWorkout(workoutId, EXERCISE_A);
    await completeSet(await addSet(workoutExerciseId, { weight_kg: 60, reps: 10 }));
    await finishWorkout(workoutId);

    await expect(finishWorkout(workoutId)).rejects.toThrow(ImmutableWorkoutError);
  });
});

describe('finishing a workout', () => {
  it('discards sets that were never completed', async () => {
    const workoutId = await startFreestyleWorkout();
    const workoutExerciseId = await addExerciseToWorkout(workoutId, EXERCISE_A);
    const done = await addSet(workoutExerciseId, { weight_kg: 100, reps: 5 });
    const skipped = await addSet(workoutExerciseId, { weight_kg: 100, reps: 5 });
    await completeSet(done);

    await finishWorkout(workoutId);

    expect((await db.sets.get(done))!.deleted_at).toBeNull();
    // A set you did not do must not land in history as a set you did.
    expect((await db.sets.get(skipped))!.deleted_at).not.toBeNull();
  });

  it('drops exercises that were added but never logged against', async () => {
    const workoutId = await startFreestyleWorkout();
    const used = await addExerciseToWorkout(workoutId, EXERCISE_A);
    const unused = await addExerciseToWorkout(workoutId, EXERCISE_B);
    await completeSet(await addSet(used, { weight_kg: 80, reps: 8 }));

    await finishWorkout(workoutId);

    expect((await db.workout_exercises.get(used))!.deleted_at).toBeNull();
    expect((await db.workout_exercises.get(unused))!.deleted_at).not.toBeNull();
  });
});

describe('the outbox', () => {
  it('records every mutation in order for the sync layer to flush', async () => {
    const workoutId = await startFreestyleWorkout();
    const workoutExerciseId = await addExerciseToWorkout(workoutId, EXERCISE_A);
    await addSet(workoutExerciseId, { weight_kg: 100, reps: 5 });

    const entries = await db.outbox.orderBy('seq').toArray();
    expect(entries.map((entry) => entry.table_name)).toEqual([
      'workouts',
      'workout_exercises',
      'sets',
    ]);
    expect(entries.every((entry) => entry.op === 'put')).toBe(true);
  });
});

describe('deletes are soft', () => {
  it('marks rows deleted rather than removing them, so the delete can propagate', async () => {
    const routineId = await createRoutine('Scratch');
    const routineExerciseId = await addExerciseToRoutine(routineId, EXERCISE_A);

    await removeExerciseFromRoutine(routineExerciseId);

    const row = await db.routine_exercises.get(routineExerciseId);
    expect(row).toBeDefined();
    expect(row!.deleted_at).not.toBeNull();
  });
});
