/**
 * Read helpers. Every one of these hits Dexie only — nothing here ever touches
 * the network, so no screen can accidentally start waiting on one.
 *
 * Soft-deleted rows are filtered out here so no caller has to remember to.
 */
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from './db';
import { SETTINGS_ID, type Exercise, type Gym, type Plan, type Routine, type RoutineExercise, type Settings, type Workout, type WorkoutExercise, type WorkoutSet } from './schema';
import { previousPerformance, type ExerciseSession, type PreviousPerformance } from '@/domain/previousPerformance';
import { personalRecords } from '@/domain/prs';
import { summariseSession } from '@/domain/sessionSummary';
import { blockProgress, buildSchedule, currentSession, type ScheduledSession } from '@/domain/schedule';
import { weekModifier, type WeekModifier } from '@/domain/programmes/block';
import { suggestNextSet, type Suggestion } from '@/domain/progression';
import { loadingProfileFor } from '@/domain/plates';

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
      readiness: workout.readiness,
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

/**
 * Everything the finish screen needs.
 *
 * "Prior" sets are those from sessions finished strictly before this one, so a
 * session cannot beat its own record, and reopening an old workout still shows
 * the PRs as they stood on the day.
 */
export function useSessionSummary(workoutId: string | undefined) {
  return useLiveQuery(async () => {
    if (!workoutId) return null;
    const view = await composeWorkout(workoutId);
    if (!view) return null;

    const performedAt = Date.parse(view.workout.finished_at ?? view.workout.started_at);

    const exercises = await Promise.all(
      view.exercises.map(async (entry) => {
        const sessions = entry.exercise ? await exerciseSessions(entry.exercise.id) : [];
        const priorSets = sessions
          .filter(
            (session) =>
              session.workout_id !== workoutId && Date.parse(session.performed_at) < performedAt,
          )
          .flatMap((session) => session.sets);
        return { exercise: entry.exercise, sets: entry.sets, priorSets };
      }),
    );

    let previousSameRoutine: { workout: Workout; sets: WorkoutSet[] } | null = null;
    if (view.workout.routine_id) {
      const candidates = live(await db.workouts.where({ routine_id: view.workout.routine_id }).toArray())
        .filter((w) => w.finished_at !== null && w.id !== workoutId)
        .filter((w) => Date.parse(w.finished_at!) < performedAt)
        .sort((a, b) => Date.parse(b.finished_at!) - Date.parse(a.finished_at!));

      const previous = candidates[0];
      if (previous) {
        const previousExercises = live(
          await db.workout_exercises.where({ workout_id: previous.id }).toArray(),
        );
        const previousSets = live(
          await db.sets.where('workout_exercise_id').anyOf(previousExercises.map((we) => we.id)).toArray(),
        );
        previousSameRoutine = { workout: previous, sets: previousSets };
      }
    }

    return {
      view,
      summary: summariseSession({ workout: view.workout, exercises, previousSameRoutine }),
    };
  }, [workoutId]);
}

/** The gym plans are built against. Its equipment filters every suggestion. */
export function useDefaultGym(): Gym | undefined | null {
  return useLiveQuery(async () => {
    const gyms = live(await db.gyms.toArray());
    const settings = await db.settings.get(SETTINGS_ID);
    const preferred = settings?.default_gym_id
      ? gyms.find((gym) => gym.id === settings.default_gym_id)
      : undefined;
    return preferred ?? gyms.find((gym) => gym.is_default) ?? gyms[0] ?? null;
  }, []);
}

/**
 * The plan currently being trained, if there is one.
 *
 * Most recent block that has not been marked finished. Only one runs at a time.
 */
export function useActivePlan(): Plan | undefined | null {
  return useLiveQuery(async () => {
    const plans = live(await db.plans.toArray()).filter((plan) => plan.completed_at === null);
    plans.sort((a, b) => Date.parse(b.started_at) - Date.parse(a.started_at));
    return plans[0] ?? null;
  }, []);
}

export interface PlanScheduleView {
  plan: Plan;
  schedule: ScheduledSession[];
  current: ScheduledSession | null;
  week: WeekModifier;
  progress: ReturnType<typeof blockProgress>;
}

/** The active block laid onto the calendar, with today's session picked out. */
export function usePlanSchedule(): PlanScheduleView | undefined | null {
  return useLiveQuery(async () => {
    const plans = live(await db.plans.toArray()).filter((plan) => plan.completed_at === null);
    plans.sort((a, b) => Date.parse(b.started_at) - Date.parse(a.started_at));
    const plan = plans[0];
    if (!plan) return null;

    const routines = await db.routines.bulkGet(plan.routine_ids);
    // Generated routines are named "<plan> — <session>". The calendar only needs
    // the session part; the full name would swamp the card.
    const routineNames = new Map(
      routines
        .filter(Boolean)
        .map((routine) => [routine!.id, routine!.name.split(' — ').at(-1) ?? routine!.name]),
    );
    const workouts = live(await db.workouts.where({ plan_id: plan.id }).toArray());

    const schedule = buildSchedule({ plan, routineNames, workouts });
    const current = currentSession(schedule);

    return {
      plan,
      schedule,
      current,
      week: weekModifier(current?.week ?? plan.current_week, plan.block_weeks),
      progress: blockProgress(schedule),
    };
  }, []);
}

/**
 * What to lift next for one exercise in the session in progress.
 *
 * Assembles everything the progression engine needs — history, the gym's plates,
 * today's readiness, the block week — so no screen has to know those rules.
 */
export function useSetSuggestion(
  workoutId: string | undefined,
  exerciseId: string | undefined,
): Suggestion | null | undefined {
  return useLiveQuery(async () => {
    if (!workoutId || !exerciseId) return null;

    const exercise = await db.exercises.get(exerciseId);
    const workout = await db.workouts.get(workoutId);
    if (!exercise || !workout) return null;

    const sessions = (await exerciseSessions(exerciseId)).filter(
      (session) => session.workout_id !== workoutId,
    );
    if (sessions.length === 0) return null;

    // Rep range comes from the routine this session was started from; a
    // freestyle session has none, so fall back to a general hypertrophy range.
    let repRange = { low: 8, high: 12 };
    if (workout.routine_id) {
      const routineExercises = live(
        await db.routine_exercises.where({ routine_id: workout.routine_id }).toArray(),
      );
      const match = routineExercises.find((row) => row.exercise_id === exerciseId);
      if (match) repRange = { low: match.rep_range_low, high: match.rep_range_high };
    }

    const gym = workout.gym_id
      ? await db.gyms.get(workout.gym_id)
      : (await db.gyms.toArray()).find((candidate) => candidate.is_default);

    const plan = workout.plan_id ? await db.plans.get(workout.plan_id) : undefined;
    const week =
      plan && workout.plan_week
        ? weekModifier(workout.plan_week, plan.block_weeks)
        : null;

    return suggestNextSet({
      exercise,
      repRange,
      history: sessions,
      loading: loadingProfileFor(exercise.equipment, gym ?? {}),
      readiness: workout.readiness,
      week: week ? { loadMultiplier: week.loadMultiplier, isDeload: week.isDeload } : null,
    });
  }, [workoutId, exerciseId]);
}
