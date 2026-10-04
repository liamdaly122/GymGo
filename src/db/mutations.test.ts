import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from './db';
import {
  ImmutableWorkoutError,
  addChildSet,
  addExerciseToRoutine,
  addExerciseToWorkout,
  addSet,
  completeSet,
  completeSetWith,
  createRoutine,
  createRoutinesFromPlan,
  finishWorkout,
  removeExerciseFromRoutine,
  removeExerciseFromWorkout,
  removeSet,
  startFreestyleWorkout,
  startWorkoutFromRoutine,
  updateRoutineExercise,
  updateSet,
} from './mutations';
import { seedIfEmpty } from './seed';
import { buildPlan } from '@/domain/programmes/plan';

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

  /**
   * Backup uploads what the outbox names, so a write that skips it is a change
   * the backup never hears about. Finishing a session used to tidy away its
   * untouched sets without queueing it, and a restore brought them back as
   * empty sets in a finished workout.
   */
  it('queues every row a session changes, including what finishing tidies away', async () => {
    await seedIfEmpty();
    const plan = buildPlan(
      { goalId: 'build_muscle', splitId: 'upper_lower', days: 4 },
      await db.exercises.toArray(),
      {},
    );
    const { planId, routineIds } = await createRoutinesFromPlan(plan);
    // A stale week counter, as a crash or an import can leave one.
    await db.plans.update(planId, { current_week: 3 });
    await db.outbox.clear();

    const workoutId = await startWorkoutFromRoutine(routineIds[0]!);
    const queuedNow = async () =>
      new Set((await db.outbox.toArray()).map((entry) => `${entry.table_name}:${entry.row_id}`));
    expect((await queuedNow()).has(`plans:${planId}`), 'the refreshed week counter').toBe(true);

    const [first, second] = (await db.workout_exercises.where({ workout_id: workoutId }).toArray()).sort(
      (a, b) => a.position - b.position,
    );
    const sets = (await db.sets.where({ workout_exercise_id: first!.id }).toArray()).sort(
      (a, b) => a.set_index - b.set_index,
    );
    await completeSetWith(sets[0]!.id, { weight_kg: 100, reps: 5 });
    await completeSetWith(sets[1]!.id, { weight_kg: 100, reps: 5 });
    await addChildSet(sets[1]!.id, 'drop');

    // A backup round mid-session, as the two-minute loop runs one: everything
    // so far is up, and only what changes from here is queued.
    await db.outbox.clear();
    await new Promise((resolve) => setTimeout(resolve, 5));
    const since = Date.now();

    await removeSet(sets[1]!.id);
    await removeExerciseFromWorkout(second!.id);
    await finishWorkout(workoutId);

    const queued = await queuedNow();
    const missed: string[] = [];
    for (const table of ['workouts', 'workout_exercises', 'sets'] as const) {
      for (const row of (await db.table(table).toArray()) as Array<{ id: string; updated_at: string }>) {
        if (Date.parse(row.updated_at) >= since && !queued.has(`${table}:${row.id}`)) missed.push(`${table}:${row.id}`);
      }
    }
    expect(missed, 'rows changed without telling the backup').toEqual([]);
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

describe('logging the numbers on screen', () => {
  it('writes the values and the tick together', async () => {
    const workoutId = await startFreestyleWorkout();
    const workoutExerciseId = await addExerciseToWorkout(workoutId, EXERCISE_A);
    const setId = await addSet(workoutExerciseId);

    // Nothing typed: Done logs the suggestion, not 0kg × 0.
    await completeSetWith(setId, { weight_kg: 102.5, reps: 6 });

    const stored = await db.sets.get(setId);
    expect(stored).toMatchObject({ weight_kg: 102.5, reps: 6, completed: true });
    expect(stored!.completed_at).not.toBeNull();

    const queued = (await db.outbox.toArray()).filter((entry) => entry.row_id === setId);
    expect(queued.at(-1)!.payload).toMatchObject({ weight_kg: 102.5, reps: 6, completed: true });
  });

  it('keeps reps whole', async () => {
    const workoutId = await startFreestyleWorkout();
    const setId = await addSet(await addExerciseToWorkout(workoutId, EXERCISE_A));
    await completeSetWith(setId, { weight_kg: 40, reps: 7.6 });
    expect((await db.sets.get(setId))!.reps).toBe(8);
  });

  it('refuses a number that cannot be lifted', async () => {
    const workoutId = await startFreestyleWorkout();
    const setId = await addSet(await addExerciseToWorkout(workoutId, EXERCISE_A));
    await expect(completeSetWith(setId, { weight_kg: -5, reps: 5 })).rejects.toThrow();
    await expect(completeSetWith(setId, { weight_kg: 50, reps: Number.NaN })).rejects.toThrow();
    expect((await db.sets.get(setId))!.completed).toBe(false);
  });

  it('cannot touch a finished workout', async () => {
    const workoutId = await startFreestyleWorkout();
    const workoutExerciseId = await addExerciseToWorkout(workoutId, EXERCISE_A);
    const logged = await addSet(workoutExerciseId, { weight_kg: 100, reps: 5 });
    await completeSet(logged);
    await finishWorkout(workoutId);

    await expect(completeSetWith(logged, { weight_kg: 200, reps: 1 })).rejects.toThrow(
      ImmutableWorkoutError,
    );
    expect((await db.sets.get(logged))!.weight_kg).toBe(100);
  });
});
