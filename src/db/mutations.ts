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
  type Gym,
  type Plan,
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
import type { GeneratedPlan } from '@/domain/programmes/plan';
import { DEFAULT_BLOCK_WEEKS, setsForWeek, weekModifier } from '@/domain/programmes/block';
import { buildSchedule, currentWeek } from '@/domain/schedule';

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
    plan_id: null,
    plan_week: null,
    plan_session_index: null,
    // Recorded so weight suggestions round to the plates that were actually
    // there, rather than whichever gym happens to be default when you look back.
    gym_id: options.gymId ?? (await defaultGymId()),
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
/**
 * Which week of the block the plan is actually in.
 *
 * Derived from the calendar rather than read from `current_week`, so a counter
 * that was never bumped — a crash, a skipped week, an import — cannot silently
 * hold the whole block at week 1. `current_week` is kept as a cache for display
 * and refreshed here.
 */
async function resolvePlanWeek(plan: Plan): Promise<number> {
  const routines = await db.routines.bulkGet(plan.routine_ids);
  const routineNames = new Map(
    routines.filter(Boolean).map((routine) => [routine!.id, routine!.name]),
  );
  const workouts = (await db.workouts.where({ plan_id: plan.id }).toArray()).filter(
    (workout) => workout.deleted_at === null,
  );

  const schedule = buildSchedule({ plan, routineNames, workouts });
  const week = schedule.length > 0 ? currentWeek(schedule) : plan.current_week;

  if (week !== plan.current_week) {
    await db.plans.update(plan.id, {
      current_week: week,
      phase_name: weekModifier(week, plan.block_weeks).label,
      updated_at: nowIso(),
    });
  }
  return week;
}

export async function startWorkoutFromRoutine(
  routineId: string,
  options: { gymId?: string | null; readiness?: Readiness | null } = {},
): Promise<string> {
  const routine = await db.routines.get(routineId);
  if (!routine) throw new Error(`Routine ${routineId} not found`);

  const routineExercises = (await db.routine_exercises.where({ routine_id: routineId }).toArray())
    .filter((re) => re.deleted_at === null)
    .sort((a, b) => a.position - b.position);

  // If this routine came from a training block, record which week and which day
  // of the rotation, so the calendar can mark it done and the progression engine
  // knows which week's targets applied.
  const plan = routine.generated_from_plan_id
    ? await db.plans.get(routine.generated_from_plan_id)
    : undefined;
  const sessionIndex = plan ? plan.routine_ids.indexOf(routineId) : -1;
  const week = plan ? await resolvePlanWeek(plan) : null;

  const workout: Workout = {
    id: newId(),
    routine_id: routineId,
    plan_id: plan?.id ?? null,
    plan_week: week,
    plan_session_index: sessionIndex >= 0 ? sessionIndex : null,
    gym_id: options.gymId ?? (await defaultGymId()),
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
  // A block week reshapes the session: week 3 adds two sets to every exercise,
  // the deload halves them. Without this the block would be five identical weeks.
  const modifier = plan && week ? weekModifier(week, plan.block_weeks) : null;

  const plannedSets: WorkoutSet[] = copied.flatMap((we, index) => {
    const source = routineExercises[index];
    const base = Math.max(1, source?.target_sets ?? 1);
    const targetSets = modifier ? setsForWeek(base, modifier) : base;
    return Array.from({ length: targetSets }, (_unused, setIndex) => ({
      id: newId(),
      workout_exercise_id: we.id,
      parent_set_id: null,
      set_index: setIndex,
      type: 'working' as const,
      weight_kg: 0,
      reps: 0,
      rir: modifier?.targetRir ?? source?.target_rir ?? null,
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

// ---------------------------------------------------------------------------
// Plans
// ---------------------------------------------------------------------------

/**
 * Writes a generated plan out as ordinary routines.
 *
 * "Ordinary" is the important word. A generated routine is the same kind of row
 * as one built by hand, so it edits the same way, starts the same way, and
 * copies into `workout_exercises` the same way. Nothing about this feature can
 * reach a finished workout.
 *
 * Rows are built up front and written in one transaction rather than looping
 * through `addExerciseToRoutine`, which would re-query siblings for every
 * exercise — roughly forty round trips for a six-day plan.
 */
/**
 * Spreads training days across the week rather than bunching them, so a
 * four-day block lands Mon/Tue/Thu/Fri rather than Mon-Thu with three days off.
 */
export function defaultTrainingDays(daysPerWeek: number): number[] {
  const patterns: Record<number, number[]> = {
    1: [1],
    2: [1, 4],
    3: [1, 3, 5],
    4: [1, 2, 4, 5],
    5: [1, 2, 3, 5, 6],
    6: [1, 2, 3, 4, 5, 6],
    7: [0, 1, 2, 3, 4, 5, 6],
  };
  return patterns[Math.min(7, Math.max(1, daysPerWeek))] ?? [1, 3, 5];
}

export async function createRoutinesFromPlan(
  plan: GeneratedPlan,
  options: { namePrefix?: string; trainingDays?: number[] } = {},
): Promise<{ planId: string; routineIds: string[] }> {
  const prefix = options.namePrefix ?? `${plan.goal.label} · ${plan.split.label}`;

  const routines: Routine[] = [];
  const routineExercises: RoutineExercise[] = [];

  for (const session of plan.sessions) {
    const routine: Routine = {
      id: newId(),
      name: `${prefix} — ${session.name}`,
      notes: null,
      archived: false,
      generated_from_plan_id: null,
      ...freshSyncFields(),
    };
    routines.push(routine);

    for (const [position, entry] of session.exercises.entries()) {
      routineExercises.push({
        id: newId(),
        routine_id: routine.id,
        exercise_id: entry.exercise.id,
        position,
        superset_group: null,
        technique: 'straight',
        target_sets: entry.prescription.sets,
        rep_range_low: entry.prescription.repLow,
        rep_range_high: entry.prescription.repHigh,
        target_rir: entry.prescription.targetRir,
        tempo: null,
        rest_seconds: entry.prescription.restSeconds,
        ...freshSyncFields(),
      });
    }
  }

  const planRow: Plan = {
    id: newId(),
    name: prefix,
    goal: plan.goal.profile,
    days_per_week: plan.days,
    block_weeks: DEFAULT_BLOCK_WEEKS,
    current_week: 1,
    started_at: nowIso(),
    routine_ids: routines.map((routine) => routine.id),
    training_days: options.trainingDays ?? defaultTrainingDays(plan.days),
    phase_name: weekModifier(1, DEFAULT_BLOCK_WEEKS).label,
    deload_week: DEFAULT_BLOCK_WEEKS,
    completed_at: null,
    ...freshSyncFields(),
  };

  // Link each routine back, so a routine can say where it came from.
  for (const routine of routines) routine.generated_from_plan_id = planRow.id;

  await db.transaction('rw', db.plans, db.routines, db.routine_exercises, db.outbox, async () => {
    await db.plans.add(planRow);
    await db.routines.bulkAdd(routines);
    if (routineExercises.length > 0) await db.routine_exercises.bulkAdd(routineExercises);
  });

  await enqueue('plans', planRow.id, 'put', planRow);
  for (const routine of routines) await enqueue('routines', routine.id, 'put', routine);
  for (const row of routineExercises) await enqueue('routine_exercises', row.id, 'put', row);

  return { planId: planRow.id, routineIds: routines.map((routine) => routine.id) };
}

export type SwapOutcome = 'replaced' | 'appended';

export interface SwapResult {
  outcome: SwapOutcome;
  /** The row now carrying the replacement — a new one when sets were kept. */
  workoutExerciseId: string;
}

/**
 * Swaps an exercise mid-session, for when the rack is taken.
 *
 * The important part is what happens to sets already logged. Repointing a row
 * that holds a completed 100kg bench press would file that set in history as a
 * 100kg dumbbell press: a personal record you never set, and a previous
 * performance figure you cannot beat because you never hit it.
 *
 * So work already done stays attached to the lift that produced it, and the
 * replacement is inserted below it carrying whatever was left to do. The session
 * ends up showing both, which is what actually happened.
 */
export async function swapWorkoutExercise(
  workoutExerciseId: string,
  newExerciseId: string,
  options: { updateRoutine?: boolean } = {},
): Promise<SwapResult> {
  const current = await db.workout_exercises.get(workoutExerciseId);
  if (!current) throw new Error(`Workout exercise ${workoutExerciseId} not found`);
  await assertWorkoutEditable(current.workout_id);

  if (current.exercise_id === newExerciseId) {
    return { outcome: 'replaced', workoutExerciseId };
  }

  const sets = (await db.sets.where({ workout_exercise_id: workoutExerciseId }).toArray()).filter(
    (set) => set.deleted_at === null,
  );
  const completed = sets.filter((set) => set.completed);
  const pending = sets.filter((set) => !set.completed);
  const now = nowIso();

  // Nothing performed yet, so nothing to protect: repoint the row and keep the
  // sets that were planned for it.
  if (completed.length === 0) {
    await db.workout_exercises.update(workoutExerciseId, {
      exercise_id: newExerciseId,
      updated_at: now,
    });
    await enqueue('workout_exercises', workoutExerciseId, 'put', {
      exercise_id: newExerciseId,
      updated_at: now,
    });
    await maybeUpdateRoutine(current, newExerciseId, options.updateRoutine ?? false);
    return { outcome: 'replaced', workoutExerciseId };
  }

  const replacement: WorkoutExercise = {
    id: newId(),
    workout_id: current.workout_id,
    exercise_id: newExerciseId,
    position: current.position + 1,
    superset_group: current.superset_group,
    technique: current.technique,
    notes: null,
    ...freshSyncFields(),
  };

  // Carry across what was left to do, at least one row to type into.
  const carried = Math.max(1, pending.length);
  const plannedSets: WorkoutSet[] = Array.from({ length: carried }, (_unused, index) => ({
    id: newId(),
    workout_exercise_id: replacement.id,
    parent_set_id: null,
    set_index: index,
    type: 'working' as const,
    weight_kg: 0,
    reps: 0,
    rir: pending[index]?.rir ?? null,
    is_amrap: false,
    completed: false,
    completed_at: null,
    ...freshSyncFields(),
  }));

  const siblings = (await db.workout_exercises.where({ workout_id: current.workout_id }).toArray())
    .filter((we) => we.deleted_at === null && we.position > current.position);

  await db.transaction('rw', db.workout_exercises, db.sets, db.outbox, async () => {
    // Sets never started are not history; drop them so the finished session does
    // not show empty rows against a lift that was abandoned.
    for (const set of pending) {
      await db.sets.update(set.id, { deleted_at: now, updated_at: now });
    }
    for (const sibling of siblings) {
      await db.workout_exercises.update(sibling.id, { position: sibling.position + 1, updated_at: now });
    }
    await db.workout_exercises.add(replacement);
    await db.sets.bulkAdd(plannedSets);
  });

  for (const set of pending) await enqueue('sets', set.id, 'delete', { deleted_at: now });
  for (const sibling of siblings) {
    await enqueue('workout_exercises', sibling.id, 'put', { position: sibling.position + 1 });
  }
  await enqueue('workout_exercises', replacement.id, 'put', replacement);
  for (const set of plannedSets) await enqueue('sets', set.id, 'put', set);

  await maybeUpdateRoutine(current, newExerciseId, options.updateRoutine ?? false);

  return { outcome: 'appended', workoutExerciseId: replacement.id };
}

/**
 * Optionally keeps the swap for next time.
 *
 * Safe to offer because starting a routine COPIES it: editing the routine now
 * cannot reach into a session already performed, whatever it says about the
 * next one.
 */
async function maybeUpdateRoutine(
  original: WorkoutExercise,
  newExerciseId: string,
  update: boolean,
): Promise<void> {
  if (!update) return;

  const workout = await db.workouts.get(original.workout_id);
  if (!workout?.routine_id) return;

  const routineExercises = (
    await db.routine_exercises.where({ routine_id: workout.routine_id }).toArray()
  ).filter((row) => row.deleted_at === null && row.exercise_id === original.exercise_id);

  const now = nowIso();
  for (const row of routineExercises) {
    await db.routine_exercises.update(row.id, { exercise_id: newExerciseId, updated_at: now });
    await enqueue('routine_exercises', row.id, 'put', { exercise_id: newExerciseId, updated_at: now });
  }
}

// ---------------------------------------------------------------------------
// Gyms
//
// What equipment you actually have is load-bearing: plans are filled from it,
// swap suggestions are filtered by it, and the progression engine rounds weights
// to the plates it lists. Until there was a screen for this, every gym claimed to
// own everything and none of that could do its job.
// ---------------------------------------------------------------------------

export const DEFAULT_BAR_WEIGHTS = [20, 15, 10];
export const DEFAULT_PLATES = [25, 20, 15, 10, 5, 2.5, 1.25];

export async function createGym(
  name: string,
  values: Partial<Pick<Gym, 'equipment_available' | 'bar_weights' | 'plates_available' | 'is_default'>> = {},
): Promise<string> {
  const existing = (await db.gyms.toArray()).filter((gym) => gym.deleted_at === null);

  const row: Gym = {
    id: newId(),
    name,
    // A new gym starts empty rather than fully equipped: ticking what you have
    // is quicker and more accurate than un-ticking what you have not.
    equipment_available: values.equipment_available ?? ['bodyweight'],
    bar_weights: values.bar_weights ?? DEFAULT_BAR_WEIGHTS,
    plates_available: values.plates_available ?? DEFAULT_PLATES,
    is_default: values.is_default ?? existing.length === 0,
    ...freshSyncFields(),
  };

  await db.gyms.add(row);
  await enqueue('gyms', row.id, 'put', row);
  if (row.is_default) await setDefaultGym(row.id);
  return row.id;
}

export async function updateGym(
  gymId: string,
  changes: Partial<Pick<Gym, 'name' | 'equipment_available' | 'bar_weights' | 'plates_available'>>,
): Promise<void> {
  const patch = { ...changes, updated_at: nowIso() };
  await db.gyms.update(gymId, patch);
  await enqueue('gyms', gymId, 'put', patch);
}

/** Exactly one gym is the default, so this clears the others in the same pass. */
export async function setDefaultGym(gymId: string): Promise<void> {
  const now = nowIso();
  const gyms = (await db.gyms.toArray()).filter((gym) => gym.deleted_at === null);

  await db.transaction('rw', db.gyms, db.settings, db.outbox, async () => {
    for (const gym of gyms) {
      const shouldBeDefault = gym.id === gymId;
      if (gym.is_default === shouldBeDefault) continue;
      await db.gyms.update(gym.id, { is_default: shouldBeDefault, updated_at: now });
    }
    await db.settings.update(SETTINGS_ID, { default_gym_id: gymId, updated_at: now });
  });

  for (const gym of gyms) {
    await enqueue('gyms', gym.id, 'put', { is_default: gym.id === gymId, updated_at: now });
  }
  await enqueue('settings', SETTINGS_ID, 'put', { default_gym_id: gymId, updated_at: now });
}

export class LastGymError extends Error {
  constructor() {
    super('You need at least one gym — plans and weight suggestions are built from its equipment.');
    this.name = 'LastGymError';
  }
}

export async function deleteGym(gymId: string): Promise<void> {
  const live = (await db.gyms.toArray()).filter((gym) => gym.deleted_at === null);
  const remaining = live.filter((gym) => gym.id !== gymId);
  // Deleting the last one would leave plans and plate rounding with nothing to
  // work from, so it is refused rather than silently degraded.
  if (remaining.length === 0) throw new LastGymError();

  const settings = await db.settings.get(SETTINGS_ID);
  const wasDefault =
    (live.find((gym) => gym.id === gymId)?.is_default ?? false) ||
    settings?.default_gym_id === gymId;

  const now = nowIso();
  // is_default is cleared as part of the delete. A tombstone that still claims
  // to be the default would win the fallback in defaultGymId the moment a pull
  // brought it back, so the flag goes down with the row.
  const patch = { deleted_at: now, is_default: false, updated_at: now };
  await db.gyms.update(gymId, patch);
  await enqueue('gyms', gymId, 'delete', patch);

  if (wasDefault) await setDefaultGym(remaining[0]!.id);
}

/** The gym a new session should be recorded against. */
export async function defaultGymId(): Promise<string | null> {
  const settings = await db.settings.get(SETTINGS_ID);
  const gyms = (await db.gyms.toArray()).filter((gym) => gym.deleted_at === null);
  const preferred = settings?.default_gym_id
    ? gyms.find((gym) => gym.id === settings.default_gym_id)
    : undefined;
  return (preferred ?? gyms.find((gym) => gym.is_default) ?? gyms[0])?.id ?? null;
}
