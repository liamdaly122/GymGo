/**
 * Read helpers. Every one of these hits Dexie only — nothing here ever touches
 * the network, so no screen can accidentally start waiting on one.
 *
 * Soft-deleted rows are filtered out here so no caller has to remember to.
 */
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from './db';
import { SETTINGS_ID, type Exercise, type Routine, type RoutineExercise, type Settings, type Workout, type WorkoutExercise, type WorkoutSet } from './schema';
import { previousPerformance, type ExerciseSession, type PreviousPerformance } from '@/domain/previousPerformance';
import { personalRecords } from '@/domain/prs';

const live = <T extends { deleted_at: string | null }>(rows: T[]) =>
  rows.filter((row) => row.deleted_at === null);

/** One exercise, with its sets, as shown in the active workout and history. */
export interface WorkoutExerciseView {
  workoutExercise: WorkoutExercise;
  exercise: Exercise | undefined;
  sets: WorkoutSet[];
}

export interface WorkoutView {
  workout: Workout;
  exercises: WorkoutExerciseView[];
}

async function composeWorkout(workoutId: string): Promise<WorkoutView | undefined> {
  const workout = await db.workouts.get(workoutId);
  if (!workout || workout.deleted_at !== null) return undefined;

  const workoutExercises = live(await db.workout_exercises.where({ workout_id: workoutId }).toArray())
    .sort((a, b) => a.position - b.position);

  const ids = workoutExercises.map((we) => we.id);
  const allSets = live(await db.sets.where('workout_exercise_id').anyOf(ids).toArray());
  const exercises = await db.exercises.bulkGet(workoutExercises.map((we) => we.exercise_id));
  const exerciseById = new Map(exercises.filter(Boolean).map((ex) => [ex!.id, ex!]));

  return {
    workout,
    exercises: workoutExercises.map((we) => ({
      workoutExercise: we,
      exercise: exerciseById.get(we.exercise_id),
      sets: allSets
        .filter((set) => set.workout_exercise_id === we.id)
        .sort((a, b) => a.set_index - b.set_index),
    })),
  };
}

export function useWorkout(workoutId: string | undefined): WorkoutView | undefined {
  return useLiveQuery(
    async () => (workoutId ? composeWorkout(workoutId) : undefined),
    [workoutId],
  );
}

/** The session in progress, if there is one. At most one exists at a time. */
export function useActiveWorkout(): Workout | undefined | null {
  return useLiveQuery(async () => {
    const open = live(await db.workouts.toArray()).filter((w) => w.finished_at === null);
    open.sort((a, b) => Date.parse(b.started_at) - Date.parse(a.started_at));
    return open[0] ?? null;
  }, []);
}

export function useFinishedWorkouts(limit = 100): Workout[] | undefined {
  return useLiveQuery(async () => {
    const finished = live(await db.workouts.toArray()).filter((w) => w.finished_at !== null);
    finished.sort((a, b) => Date.parse(b.started_at) - Date.parse(a.started_at));
    return finished.slice(0, limit);
  }, [limit]);
}

export function useExercises(): Exercise[] | undefined {
  return useLiveQuery(async () => {
    const all = live(await db.exercises.toArray());
    return all.sort((a, b) => a.name.localeCompare(b.name, 'en'));
  }, []);
}

export function useExercise(exerciseId: string | undefined): Exercise | undefined {
  return useLiveQuery(
    async () => (exerciseId ? db.exercises.get(exerciseId) : undefined),
    [exerciseId],
  );
}

export function useSettings(): Settings | undefined {
  return useLiveQuery(async () => db.settings.get(SETTINGS_ID), []);
}

export function useRoutines(): Routine[] | undefined {
  return useLiveQuery(async () => {
    const all = live(await db.routines.toArray()).filter((r) => !r.archived);
    return all.sort((a, b) => a.name.localeCompare(b.name, 'en'));
  }, []);
}

export interface RoutineView {
  routine: Routine;
  exercises: Array<{ routineExercise: RoutineExercise; exercise: Exercise | undefined }>;
}

export function useRoutine(routineId: string | undefined): RoutineView | undefined {
  return useLiveQuery(async () => {
    if (!routineId) return undefined;
    const routine = await db.routines.get(routineId);
    if (!routine || routine.deleted_at !== null) return undefined;

    const routineExercises = live(await db.routine_exercises.where({ routine_id: routineId }).toArray())
      .sort((a, b) => a.position - b.position);
    const exercises = await db.exercises.bulkGet(routineExercises.map((re) => re.exercise_id));
    const exerciseById = new Map(exercises.filter(Boolean).map((ex) => [ex!.id, ex!]));

    return {
      routine,
      exercises: routineExercises.map((re) => ({
        routineExercise: re,
        exercise: exerciseById.get(re.exercise_id),
      })),
    };
  }, [routineId]);
}

/**
 * Every past session in which an exercise was performed, newest first.
 *
 * Only finished workouts count: a session still in progress is not yet history,
 * and including it would let the current session report itself as "last time".
 */
export async function exerciseSessions(exerciseId: string): Promise<ExerciseSession[]> {
  const workoutExercises = live(await db.workout_exercises.where({ exercise_id: exerciseId }).toArray());
  if (workoutExercises.length === 0) return [];

  const workouts = await db.workouts.bulkGet([...new Set(workoutExercises.map((we) => we.workout_id))]);
  const workoutById = new Map(
    workouts
      .filter((w): w is Workout => Boolean(w) && w!.deleted_at === null && w!.finished_at !== null)
      .map((w) => [w.id, w]),
  );

  const sets = live(await db.sets.where('workout_exercise_id').anyOf(workoutExercises.map((we) => we.id)).toArray());

  const sessions: ExerciseSession[] = [];
  for (const we of workoutExercises) {
    const workout = workoutById.get(we.workout_id);
    if (!workout) continue;
    sessions.push({
      workout_id: workout.id,
      performed_at: workout.finished_at ?? workout.started_at,
      sets: sets.filter((set) => set.workout_exercise_id === we.id),
    });
  }
  return sessions;
}

/** Every set ever performed on an exercise, across finished sessions. */
export async function allSetsForExercise(exerciseId: string): Promise<WorkoutSet[]> {
  const sessions = await exerciseSessions(exerciseId);
  return sessions.flatMap((session) => session.sets);
}

/**
 * The "last time" line. Excludes the workout in progress so the session cannot
 * report itself.
 */
export function usePreviousPerformance(
  exerciseId: string | undefined,
  excludeWorkoutId?: string,
): PreviousPerformance | null | undefined {
  return useLiveQuery(async () => {
    if (!exerciseId) return null;
    const sessions = await exerciseSessions(exerciseId);
    return previousPerformance(sessions, excludeWorkoutId ? { excludeWorkoutId } : {});
  }, [exerciseId, excludeWorkoutId]);
}

/** Personal records for one exercise, computed from finished sessions only. */
export function useExerciseRecords(exerciseId: string | undefined) {
  return useLiveQuery(async () => {
    if (!exerciseId) return null;
    const sessions = await exerciseSessions(exerciseId);
    const sets = sessions.flatMap((session) => session.sets);
    return { records: personalRecords(sets), sessionCount: sessions.length };
  }, [exerciseId]);
}
