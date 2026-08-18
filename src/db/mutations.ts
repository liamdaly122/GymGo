/**
 * The ONLY module that writes to Dexie.
 *
 * Everything funnels through here so that three things are true without any
 * component having to remember them:
 *
 *  1. `updated_at` is always stamped, so last-write-wins conflict resolution works.
 *  2. Deletes are always soft, so they can propagate to Supabase later.
 *  3. Every mutation is queued in the outbox, so sync has an ordered log to flush.
 *
 * Components call these functions. They never call `db.table.put` directly.
 */
import { db } from './db';
import {
  SETTINGS_ID,
  type Exercise,
  type Routine,
  type RoutineExercise,
  type Settings,
  type SyncFields,
  type Workout,
  type WorkoutExercise,
  type WorkoutSet,
} from './schema';
import { newId } from '@/lib/ids';
import { nowIso } from '@/lib/dates';
import type { Readiness, SetType, Technique } from '@/domain/types';

/** Thrown when something tries to edit a workout that has already been finished. */
export class ImmutableWorkoutError extends Error {
  constructor(workoutId: string) {
    super(
      `Workout ${workoutId} is finished and cannot be changed. ` +
        'Finished sets are immutable — history must stay exactly as it was performed.',
    );
    this.name = 'ImmutableWorkoutError';
  }
}

function freshSyncFields(): SyncFields {
  const now = nowIso();
  return { user_id: null, created_at: now, updated_at: now, deleted_at: null };
}

/**
 * Queues a mutation for the sync layer. A no-op as far as the UI is concerned —
 * it is never awaited on a user's critical path beyond the local write itself.
 */
async function enqueue(table: string, rowId: string, op: 'put' | 'delete', payload: unknown) {
  await db.outbox.add({
    table_name: table,
    row_id: rowId,
    op,
    payload,
    queued_at: nowIso(),
  });
}

/**
 * A finished workout is frozen. This is the guard behind the brief's central
 * rule: every chart, PR and progression suggestion reads from the workout
 * tables, so if history can drift, all of it becomes worthless.
 */
async function assertWorkoutEditable(workoutId: string): Promise<void> {
  const workout = await db.workouts.get(workoutId);
  if (!workout) throw new Error(`Workout ${workoutId} not found`);
  if (workout.finished_at !== null) throw new ImmutableWorkoutError(workoutId);
}

async function assertSetEditable(setId: string): Promise<void> {
  const set = await db.sets.get(setId);
  if (!set) throw new Error(`Set ${setId} not found`);
  const workoutExercise = await db.workout_exercises.get(set.workout_exercise_id);
  if (!workoutExercise) throw new Error(`Workout exercise ${set.workout_exercise_id} not found`);
  await assertWorkoutEditable(workoutExercise.workout_id);
}

// ---------------------------------------------------------------------------
// Workouts
// ---------------------------------------------------------------------------

export async function startFreestyleWorkout(options: {
  gymId?: string | null;
  readiness?: Readiness | null;
} = {}): Promise<string> {
  const workout: Workout = {
    id: newId(),
    routine_id: null,
    gym_id: options.gymId ?? null,
    started_at: nowIso(),
    finished_at: null,
    bodyweight_kg: null,
    readiness: options.readiness ?? null,
    notes: null,
    ...freshSyncFields(),
  };
  await db.workouts.add(workout);
  await enqueue('workouts', workout.id, 'put', workout);
  return workout.id;
}

/**
 * Starts a workout from a routine by COPYING the routine's exercises into
 * workout_exercises.
 *
 * This copy is the whole point. The workout holds a snapshot, never a live
 * reference, which is what makes editing a routine afterwards unable to change
 * a session already performed. Do not "optimise" this into a join.
 */
export async function startWorkoutFromRoutine(
  routineId: string,
  options: { gymId?: string | null; readiness?: Readiness | null } = {},
): Promise<string> {
  const routine = await db.routines.get(routineId);
  if (!routine) throw new Error(`Routine ${routineId} not found`);

  const routineExercises = (await db.routine_exercises.where({ routine_id: routineId }).toArray())
    .filter((re) => re.deleted_at === null)
    .sort((a, b) => a.position - b.position);

  const workout: Workout = {
    id: newId(),
    routine_id: routineId,
    gym_id: options.gymId ?? null,
    started_at: nowIso(),
    finished_at: null,
    bodyweight_kg: null,
    readiness: options.readiness ?? null,
    notes: null,
    ...freshSyncFields(),
  };

  const copied: WorkoutExercise[] = routineExercises.map((re, index) => ({
    id: newId(),
    workout_id: workout.id,
    exercise_id: re.exercise_id,
    position: index,
    superset_group: re.superset_group,
    technique: re.technique,
    notes: null,
    ...freshSyncFields(),
  }));

  /*
   * Lay out the sets the routine plans for, empty and unticked.
   *
   * The routine says "3 sets of 5 to 8"; starting it should put three rows on
   * screen ready to type into, not an exercise with nothing under it. They
   * count for nothing until ticked, and finishWorkout discards any left
   * untouched, so an abandoned plan never becomes fake history.
   */
  const plannedSets: WorkoutSet[] = copied.flatMap((we, index) => {
    const source = routineExercises[index];
    const targetSets = Math.max(1, source?.target_sets ?? 1);
    return Array.from({ length: targetSets }, (_unused, setIndex) => ({
      id: newId(),
      workout_exercise_id: we.id,
      parent_set_id: null,
      set_index: setIndex,
      type: 'working' as const,
      weight_kg: 0,
      reps: 0,
      rir: source?.target_rir ?? null,
      is_amrap: false,
      completed: false,
      completed_at: null,
      ...freshSyncFields(),
    }));
  });

  await db.transaction('rw', db.workouts, db.workout_exercises, db.sets, db.outbox, async () => {
    await db.workouts.add(workout);
    if (copied.length > 0) await db.workout_exercises.bulkAdd(copied);
    if (plannedSets.length > 0) await db.sets.bulkAdd(plannedSets);
  });

  await enqueue('workouts', workout.id, 'put', workout);
  for (const we of copied) await enqueue('workout_exercises', we.id, 'put', we);
  for (const set of plannedSets) await enqueue('sets', set.id, 'put', set);

  return workout.id;
}

export async function updateWorkout(
  workoutId: string,
  changes: Partial<Pick<Workout, 'gym_id' | 'bodyweight_kg' | 'readiness' | 'notes'>>,
): Promise<void> {
  await assertWorkoutEditable(workoutId);
  const patch = { ...changes, updated_at: nowIso() };
  await db.workouts.update(workoutId, patch);
  await enqueue('workouts', workoutId, 'put', patch);
}

/**
 * Finishes a workout. After this the session is immutable.
 *
 * Incomplete sets are discarded rather than saved as zeroes — a set you did not
 * do must not land in history as a set you did.
 */
export async function finishWorkout(workoutId: string): Promise<void> {
  await assertWorkoutEditable(workoutId);
  const finishedAt = nowIso();

  await db.transaction('rw', db.workouts, db.workout_exercises, db.sets, db.outbox, async () => {
    const workoutExercises = await db.workout_exercises.where({ workout_id: workoutId }).toArray();
    const exerciseIds = workoutExercises.map((we) => we.id);
    const sets = await db.sets.where('workout_exercise_id').anyOf(exerciseIds).toArray();

    const abandoned = sets.filter((set) => !set.completed && set.deleted_at === null);
    for (const set of abandoned) {
      await db.sets.update(set.id, { deleted_at: finishedAt, updated_at: finishedAt });
    }

    // Drop exercises left with nothing logged against them at all.
    for (const we of workoutExercises) {
      const kept = sets.some((set) => set.workout_exercise_id === we.id && set.completed);
      if (!kept) {
        await db.workout_exercises.update(we.id, {
          deleted_at: finishedAt,
          updated_at: finishedAt,
        });
      }
    }

    await db.workouts.update(workoutId, { finished_at: finishedAt, updated_at: finishedAt });
  });

  await enqueue('workouts', workoutId, 'put', { finished_at: finishedAt });
}

/** Soft-deletes an in-progress workout the user abandoned. */
export async function discardWorkout(workoutId: string): Promise<void> {
  const now = nowIso();
  await db.workouts.update(workoutId, { deleted_at: now, updated_at: now });
  await enqueue('workouts', workoutId, 'delete', { deleted_at: now });
}

// ---------------------------------------------------------------------------
// Workout exercises
// ---------------------------------------------------------------------------

export async function addExerciseToWorkout(
  workoutId: string,
  exerciseId: string,
  options: { technique?: Technique; supersetGroup?: string | null } = {},
): Promise<string> {
  await assertWorkoutEditable(workoutId);
  const siblings = await db.workout_exercises.where({ workout_id: workoutId }).toArray();
  const position = siblings.filter((we) => we.deleted_at === null).length;

  const row: WorkoutExercise = {
    id: newId(),
    workout_id: workoutId,
    exercise_id: exerciseId,
    position,
    superset_group: options.supersetGroup ?? null,
    technique: options.technique ?? 'straight',
    notes: null,
    ...freshSyncFields(),
  };
  await db.workout_exercises.add(row);
  await enqueue('workout_exercises', row.id, 'put', row);
  return row.id;
}

export async function updateWorkoutExercise(
  workoutExerciseId: string,
  changes: Partial<Pick<WorkoutExercise, 'technique' | 'notes' | 'position' | 'superset_group'>>,
): Promise<void> {
  const row = await db.workout_exercises.get(workoutExerciseId);
  if (!row) throw new Error(`Workout exercise ${workoutExerciseId} not found`);
  await assertWorkoutEditable(row.workout_id);
  const patch = { ...changes, updated_at: nowIso() };
  await db.workout_exercises.update(workoutExerciseId, patch);
  await enqueue('workout_exercises', workoutExerciseId, 'put', patch);
}

export async function removeExerciseFromWorkout(workoutExerciseId: string): Promise<void> {
  const row = await db.workout_exercises.get(workoutExerciseId);
  if (!row) return;
  await assertWorkoutEditable(row.workout_id);
  const now = nowIso();
  await db.transaction('rw', db.workout_exercises, db.sets, db.outbox, async () => {
    await db.workout_exercises.update(workoutExerciseId, { deleted_at: now, updated_at: now });
    const sets = await db.sets.where({ workout_exercise_id: workoutExerciseId }).toArray();
    for (const set of sets) {
      await db.sets.update(set.id, { deleted_at: now, updated_at: now });
    }
  });
  await enqueue('workout_exercises', workoutExerciseId, 'delete', { deleted_at: now });
}

// ---------------------------------------------------------------------------
// Sets
// ---------------------------------------------------------------------------

export async function addSet(
  workoutExerciseId: string,
  values: {
    weight_kg?: number;
    reps?: number;
    type?: SetType;
    rir?: number | null;
    is_amrap?: boolean;
    parent_set_id?: string | null;
  } = {},
): Promise<string> {
  const workoutExercise = await db.workout_exercises.get(workoutExerciseId);
  if (!workoutExercise) throw new Error(`Workout exercise ${workoutExerciseId} not found`);
  await assertWorkoutEditable(workoutExercise.workout_id);

  const siblings = (await db.sets.where({ workout_exercise_id: workoutExerciseId }).toArray())
    .filter((set) => set.deleted_at === null);

  const row: WorkoutSet = {
    id: newId(),
    workout_exercise_id: workoutExerciseId,
    parent_set_id: values.parent_set_id ?? null,
    set_index: siblings.length,
    type: values.type ?? 'working',
    weight_kg: values.weight_kg ?? 0,
    reps: values.reps ?? 0,
    rir: values.rir ?? null,
    is_amrap: values.is_amrap ?? false,
    completed: false,
    completed_at: null,
    ...freshSyncFields(),
  };
  await db.sets.add(row);
  await enqueue('sets', row.id, 'put', row);
  return row.id;
}

export async function updateSet(
  setId: string,
  changes: Partial<Pick<WorkoutSet, 'weight_kg' | 'reps' | 'rir' | 'type' | 'is_amrap'>>,
): Promise<void> {
  await assertSetEditable(setId);
  const patch = { ...changes, updated_at: nowIso() };
  await db.sets.update(setId, patch);
  await enqueue('sets', setId, 'put', patch);
}

/** Ticks a set off. `completed_at` is what the rest timer counts from. */
export async function completeSet(setId: string, completed = true): Promise<void> {
  await assertSetEditable(setId);
  const now = nowIso();
  const patch = { completed, completed_at: completed ? now : null, updated_at: now };
  await db.sets.update(setId, patch);
  await enqueue('sets', setId, 'put', patch);
}

export async function removeSet(setId: string): Promise<void> {
  await assertSetEditable(setId);
  const now = nowIso();
  await db.transaction('rw', db.sets, db.outbox, async () => {
    await db.sets.update(setId, { deleted_at: now, updated_at: now });
    // A child set cannot outlive its parent.
    const children = await db.sets.toArray();
    for (const child of children) {
      if (child.parent_set_id === setId && child.deleted_at === null) {
        await db.sets.update(child.id, { deleted_at: now, updated_at: now });
      }
    }
  });
  await enqueue('sets', setId, 'delete', { deleted_at: now });
}

// ---------------------------------------------------------------------------
// Exercises
// ---------------------------------------------------------------------------

export async function createCustomExercise(
  values: Omit<Exercise, keyof SyncFields | 'id' | 'is_custom' | 'source_id'>,
): Promise<string> {
  const row: Exercise = {
    ...values,
    id: newId(),
    is_custom: true,
    source_id: null,
    ...freshSyncFields(),
  };
  await db.exercises.add(row);
  await enqueue('exercises', row.id, 'put', row);
  return row.id;
}

export async function updateExercise(
  exerciseId: string,
  changes: Partial<Omit<Exercise, keyof SyncFields | 'id'>>,
): Promise<void> {
  const patch = { ...changes, updated_at: nowIso() };
  await db.exercises.update(exerciseId, patch);
  await enqueue('exercises', exerciseId, 'put', patch);
}

// ---------------------------------------------------------------------------
// Routines
// ---------------------------------------------------------------------------

export async function createRoutine(name: string, notes: string | null = null): Promise<string> {
  const row: Routine = {
    id: newId(),
    name,
    notes,
    archived: false,
    generated_from_plan_id: null,
    ...freshSyncFields(),
  };
  await db.routines.add(row);
  await enqueue('routines', row.id, 'put', row);
  return row.id;
}

export async function updateRoutine(
  routineId: string,
  changes: Partial<Pick<Routine, 'name' | 'notes' | 'archived'>>,
): Promise<void> {
  const patch = { ...changes, updated_at: nowIso() };
  await db.routines.update(routineId, patch);
  await enqueue('routines', routineId, 'put', patch);
}

export async function deleteRoutine(routineId: string): Promise<void> {
  const now = nowIso();
  await db.routines.update(routineId, { deleted_at: now, updated_at: now });
  await enqueue('routines', routineId, 'delete', { deleted_at: now });
}

export async function addExerciseToRoutine(
  routineId: string,
  exerciseId: string,
  values: Partial<Omit<RoutineExercise, keyof SyncFields | 'id' | 'routine_id' | 'exercise_id'>> = {},
): Promise<string> {
  const siblings = (await db.routine_exercises.where({ routine_id: routineId }).toArray())
    .filter((re) => re.deleted_at === null);

  const row: RoutineExercise = {
    id: newId(),
    routine_id: routineId,
    exercise_id: exerciseId,
    position: values.position ?? siblings.length,
    superset_group: values.superset_group ?? null,
    technique: values.technique ?? 'straight',
    target_sets: values.target_sets ?? 3,
    rep_range_low: values.rep_range_low ?? 8,
    rep_range_high: values.rep_range_high ?? 12,
    target_rir: values.target_rir ?? null,
    tempo: values.tempo ?? null,
    rest_seconds: values.rest_seconds ?? null,
    ...freshSyncFields(),
  };
  await db.routine_exercises.add(row);
  await enqueue('routine_exercises', row.id, 'put', row);
  return row.id;
}

export async function updateRoutineExercise(
  routineExerciseId: string,
  changes: Partial<Omit<RoutineExercise, keyof SyncFields | 'id' | 'routine_id'>>,
): Promise<void> {
  const patch = { ...changes, updated_at: nowIso() };
  await db.routine_exercises.update(routineExerciseId, patch);
  await enqueue('routine_exercises', routineExerciseId, 'put', patch);
}

export async function removeExerciseFromRoutine(routineExerciseId: string): Promise<void> {
  const now = nowIso();
  await db.routine_exercises.update(routineExerciseId, { deleted_at: now, updated_at: now });
  await enqueue('routine_exercises', routineExerciseId, 'delete', { deleted_at: now });
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

export async function updateSettings(changes: Partial<Omit<Settings, keyof SyncFields | 'id'>>) {
  const patch = { ...changes, updated_at: nowIso() };
  await db.settings.update(SETTINGS_ID, patch);
  await enqueue('settings', SETTINGS_ID, 'put', patch);
}

/**
 * Moves an exercise up or down within a routine.
 *
 * Positions are rewritten across the whole routine rather than swapped in
 * place, so a list that has drifted out of sequence (through deletions, say)
 * comes back consecutive rather than preserving the gaps.
 */
export async function moveRoutineExercise(
  routineId: string,
  routineExerciseId: string,
  direction: 'up' | 'down',
): Promise<void> {
  const ordered = (await db.routine_exercises.where({ routine_id: routineId }).toArray())
    .filter((re) => re.deleted_at === null)
    .sort((a, b) => a.position - b.position);

  const index = ordered.findIndex((re) => re.id === routineExerciseId);
  if (index === -1) return;
  const target = direction === 'up' ? index - 1 : index + 1;
  if (target < 0 || target >= ordered.length) return;

  const reordered = [...ordered];
  const [moved] = reordered.splice(index, 1);
  reordered.splice(target, 0, moved!);

  const now = nowIso();
  await db.transaction('rw', db.routine_exercises, db.outbox, async () => {
    for (const [position, row] of reordered.entries()) {
      if (row.position === position) continue;
      await db.routine_exercises.update(row.id, { position, updated_at: now });
    }
  });

  for (const [position, row] of reordered.entries()) {
    await enqueue('routine_exercises', row.id, 'put', { position, updated_at: now });
  }
}
