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
import { swapSuggestions, type SwapSuggestions } from '@/domain/search';
import { personalRecords } from '@/domain/prs';
import { estimateDurationMinutes, summariseSession } from '@/domain/sessionSummary';
import {
  blockProgress,
  buildSchedule,
  currentSession,
  currentWeek,
  groupByWeek,
  isBlockComplete,
  type ScheduledSession,
  type WeekSummary,
} from '@/domain/schedule';
import { setsForWeek, weekModifier, type WeekModifier } from '@/domain/programmes/block';
import { suggestNextSet, type Suggestion } from '@/domain/progression';
import { loadingProfileFor, type LoadingProfile } from '@/domain/plates';
import { bestEstimated1RM, setsPerMuscle, totalTonnage, totalWorkingSets } from '@/domain/volume';
import { isTopWorkingSet } from '@/domain/sets';

const live = <T extends { deleted_at: string | null }>(rows: T[]) =>
  rows.filter((row) => row.deleted_at === null);

/** One exercise, with its sets, as shown in the active workout and history. */
export interface WorkoutExerciseView {
  workoutExercise: WorkoutExercise;
  exercise: Exercise | undefined;
  sets: WorkoutSet[];
  /**
   * What this exercise can actually be loaded with, at the gym the session is
   * being performed at. Built here rather than per screen so the plate
   * breakdown and the weight steppers agree with the progression engine.
   */
  loading: LoadingProfile;
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

  // One lookup for the whole session rather than one per exercise.
  const gym = workout.gym_id
    ? await db.gyms.get(workout.gym_id)
    : live(await db.gyms.toArray()).find((candidate) => candidate.is_default);

  return {
    workout,
    exercises: workoutExercises.map((we) => ({
      workoutExercise: we,
      exercise: exerciseById.get(we.exercise_id),
      sets: allSets
        .filter((set) => set.workout_exercise_id === we.id)
        .sort((a, b) => a.set_index - b.set_index),
      loading: loadingProfileFor(exerciseById.get(we.exercise_id)?.equipment ?? 'other', gym ?? {}),
    })),
  };
}

export function useWorkout(workoutId: string | undefined): WorkoutView | undefined {
  return useLiveQuery(
    async () => (workoutId ? composeWorkout(workoutId) : undefined),
    [workoutId],
  );
}

export interface RepeatCandidate {
  workout: Workout;
  exerciseCount: number;
  setCount: number;
  names: string[];
}

/**
 * The last session worth repeating.
 *
 * Skips anything with no exercises left: finishWorkout soft-deletes exercises
 * that were never logged against, so a session you started and immediately
 * finished has nothing to repeat and must not be offered as an empty button.
 */
export function useRepeatCandidate(): RepeatCandidate | null | undefined {
  return useLiveQuery(async () => {
    const finished = live(await db.workouts.toArray())
      .filter((workout) => workout.finished_at !== null)
      .sort((a, b) => Date.parse(b.started_at) - Date.parse(a.started_at));

    for (const workout of finished.slice(0, 10)) {
      const exercises = live(await db.workout_exercises.where({ workout_id: workout.id }).toArray())
        .sort((a, b) => a.position - b.position);
      if (exercises.length === 0) continue;

      const sets = live(
        await db.sets.where('workout_exercise_id').anyOf(exercises.map((we) => we.id)).toArray(),
      ).filter((set) => set.completed && set.parent_set_id === null && set.type !== 'warmup');

      const named = await db.exercises.bulkGet(exercises.slice(0, 3).map((we) => we.exercise_id));

      return {
        workout,
        exerciseCount: exercises.length,
        setCount: sets.length,
        names: named.filter(Boolean).map((exercise) => exercise!.name),
      };
    }
    return null;
  }, []);
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

/** One routine as the Programme screen lists it: enough to recognise it by. */
export interface ProgrammeRoutine {
  routine: Routine;
  /** The session part of a generated name — the full one swamps a list row. */
  label: string;
  exerciseCount: number;
  estimatedMinutes: number;
  /** The muscles this session actually trains, most-worked first. */
  muscles: string[];
}

export interface ProgrammeView {
  plan: Plan | null;
  /** Null when there is no plan; otherwise the block laid onto the calendar. */
  schedule: ScheduledSession[];
  week: WeekModifier | null;
  progress: ReturnType<typeof blockProgress> | null;
  complete: boolean;
  /** The sessions of the active plan, in the order the plan runs them. */
  sessions: ProgrammeRoutine[];
  /** Routines the user made themselves, not generated by any plan. */
  standalone: ProgrammeRoutine[];
}

/**
 * Everything the Programme screen shows.
 *
 * Generated routines are separated from hand-made ones using
 * generated_from_plan_id, which the plan builder has always stamped and no
 * screen has ever read — so a list of four plan sessions and one of your own
 * looked like five interchangeable rows.
 */
export function useProgramme(): ProgrammeView | undefined {
  return useLiveQuery(async () => {
    const plans = live(await db.plans.toArray()).filter((plan) => plan.completed_at === null);
    plans.sort((a, b) => Date.parse(b.started_at) - Date.parse(a.started_at));
    const plan = plans[0] ?? null;

    const allRoutines = live(await db.routines.toArray()).filter((routine) => !routine.archived);

    const describe = async (routine: Routine): Promise<ProgrammeRoutine> => {
      const rows = live(await db.routine_exercises.where({ routine_id: routine.id }).toArray())
        .sort((a, b) => a.position - b.position);
      const exercises = await db.exercises.bulkGet(rows.map((row) => row.exercise_id));

      // In the order the session runs them, not by count: a full body day
      // trains six muscles once each, so counting ties and the alphabetical
      // tiebreak put "abdominals" at the front of every session. The exercises
      // are already ordered with the main lifts first, which is what a lifter
      // recognises the day by.
      const muscles: string[] = [];
      for (const exercise of exercises) {
        if (!exercise) continue;
        if (!muscles.includes(exercise.primary_muscle)) muscles.push(exercise.primary_muscle);
      }

      return {
        routine,
        label: routine.name.split(' — ').at(-1) ?? routine.name,
        exerciseCount: rows.length,
        estimatedMinutes: estimateDurationMinutes(
          rows.map((row) => ({ sets: row.target_sets, restSeconds: row.rest_seconds ?? 120 })),
        ),
        muscles: muscles.slice(0, 3),
      };
    };

    const planRoutineIds = new Set(plan?.routine_ids ?? []);
    const sessions: ProgrammeRoutine[] = [];
    // In plan order, not alphabetical: the rotation is the point.
    for (const id of plan?.routine_ids ?? []) {
      const routine = allRoutines.find((candidate) => candidate.id === id);
      if (routine) sessions.push(await describe(routine));
    }

    const standalone: ProgrammeRoutine[] = [];
    for (const routine of allRoutines) {
      if (planRoutineIds.has(routine.id)) continue;
      // Routines from an older, finished block belong to that block's history,
      // not in "routines you made yourself".
      if (routine.generated_from_plan_id !== null) continue;
      standalone.push(await describe(routine));
    }
    standalone.sort((a, b) => a.label.localeCompare(b.label, 'en'));

    if (!plan) {
      return {
        plan: null, schedule: [], week: null, progress: null,
        complete: false, sessions, standalone,
      };
    }

    const routineNames = new Map(
      plan.routine_ids
        .map((id) => allRoutines.find((routine) => routine.id === id))
        .filter(Boolean)
        .map((routine) => [routine!.id, routine!.name.split(' — ').at(-1) ?? routine!.name]),
    );
    const workouts = live(await db.workouts.where({ plan_id: plan.id }).toArray());
    const schedule = buildSchedule({ plan, routineNames, workouts });

    return {
      plan,
      schedule,
      week: weekModifier(currentWeek(schedule), plan.block_weeks),
      progress: blockProgress(schedule),
      complete: isBlockComplete(schedule),
      sessions,
      standalone,
    };
  }, []);
}

export interface BlockWeekView extends WeekSummary {
  /** Working sets prescribed across the whole week, after the week's shaping. */
  sets: number;
}

/**
 * The whole block for the expanded plan view: every week, its sessions, and how
 * much work each one asks for.
 *
 * The set counts are what make the block's shape legible — weeks 1-4 climb and
 * week 5 halves. Reading "Deload" without a number next to it does not tell you
 * how much easier the week actually is.
 */
export function useBlockOverview(): BlockWeekView[] | undefined | null {
  return useLiveQuery(async () => {
    const plans = live(await db.plans.toArray()).filter((plan) => plan.completed_at === null);
    plans.sort((a, b) => Date.parse(b.started_at) - Date.parse(a.started_at));
    const plan = plans[0];
    if (!plan) return null;

    const routines = await db.routines.bulkGet(plan.routine_ids);
    const routineNames = new Map(
      routines
        .filter(Boolean)
        .map((routine) => [routine!.id, routine!.name.split(' — ').at(-1) ?? routine!.name]),
    );
    const workouts = live(await db.workouts.where({ plan_id: plan.id }).toArray());
    const schedule = buildSchedule({ plan, routineNames, workouts });

    // Base set counts per routine, read once rather than per week.
    const baseSets = new Map<string, number[]>();
    for (const routineId of plan.routine_ids) {
      const rows = live(await db.routine_exercises.where({ routine_id: routineId }).toArray());
      baseSets.set(routineId, rows.map((row) => row.target_sets));
    }

    return groupByWeek(schedule, plan.block_weeks, currentWeek(schedule)).map((week) => ({
      ...week,
      sets: week.sessions.reduce((total, session) => {
        const counts = session.routineId ? (baseSets.get(session.routineId) ?? []) : [];
        return (
          total +
          counts.reduce((sum, target) => sum + setsForWeek(target, week.modifier), 0)
        );
      }, 0),
    }));
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

    // Rep range comes from the routine this session was started from. A
    // freestyle session has none, and inventing one would make heavy low-rep
    // work look like repeated failure and trigger a false deload.
    let repRange: { low: number; high: number } | null = null;
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

export interface MuscleVolume {
  muscle: string;
  sets: number;
}

export interface ProgressOverview {
  workoutCount: number;
  totalVolumeKg: number;
  setsThisWeek: number;
  /** Sets per muscle over the last seven days, biggest first. */
  weeklyVolume: MuscleVolume[];
  /** Exercises with at least one completed working set, for the trend picker. */
  trackedExercises: Array<{ id: string; name: string; sessions: number }>;
}

/** Everything the Progress tab leads with. One pass over the database. */
export function useProgressOverview(): ProgressOverview | undefined {
  return useLiveQuery(async () => {
    const workouts = live(await db.workouts.toArray()).filter((w) => w.finished_at !== null);
    const workoutExercises = live(await db.workout_exercises.toArray());
    const sets = live(await db.sets.toArray());
    const exercises = await db.exercises.toArray();

    const exerciseById = new Map(exercises.map((exercise) => [exercise.id, exercise]));
    const workoutById = new Map(workouts.map((workout) => [workout.id, workout]));
    const weByid = new Map(workoutExercises.map((we) => [we.id, we]));

    const exerciseBySetId = new Map<string, Exercise>();
    const setsInFinishedWorkouts: WorkoutSet[] = [];

    for (const set of sets) {
      const we = weByid.get(set.workout_exercise_id);
      if (!we || !workoutById.has(we.workout_id)) continue;
      const exercise = exerciseById.get(we.exercise_id);
      if (!exercise) continue;
      exerciseBySetId.set(set.id, exercise);
      setsInFinishedWorkouts.push(set);
    }

    const weekAgo = Date.now() - 7 * 86_400_000;
    const recentSets = setsInFinishedWorkouts.filter((set) => {
      const we = weByid.get(set.workout_exercise_id);
      const workout = we ? workoutById.get(we.workout_id) : undefined;
      return workout ? Date.parse(workout.finished_at ?? workout.started_at) >= weekAgo : false;
    });

    const perMuscle = setsPerMuscle(recentSets, exerciseBySetId);

    const sessionsPerExercise = new Map<string, number>();
    for (const we of workoutExercises) {
      if (!workoutById.has(we.workout_id)) continue;
      const hasWork = sets.some((set) => set.workout_exercise_id === we.id && set.completed);
      if (!hasWork) continue;
      sessionsPerExercise.set(we.exercise_id, (sessionsPerExercise.get(we.exercise_id) ?? 0) + 1);
    }

    return {
      workoutCount: workouts.length,
      totalVolumeKg: totalTonnage(setsInFinishedWorkouts),
      setsThisWeek: totalWorkingSets(recentSets),
      weeklyVolume: [...perMuscle.entries()]
        .map(([muscle, setCount]) => ({ muscle, sets: setCount }))
        .sort((a, b) => b.sets - a.sets)
        .slice(0, 8),
      trackedExercises: [...sessionsPerExercise.entries()]
        .map(([id, sessions]) => ({ id, name: exerciseById.get(id)?.name ?? 'Unknown', sessions }))
        .sort((a, b) => b.sessions - a.sessions || a.name.localeCompare(b.name, 'en')),
    };
  }, []);
}

export interface TrendPoint {
  /** Full ISO instant. Sorting on the date alone puts two sessions logged on the
   *  same day in arbitrary order, which flips the trend and its delta. */
  performed_at: string;
  date: string;
  /** Best estimated 1RM of that session. */
  e1rm: number;
  /** Heaviest top working set of that session. */
  topWeight: number;
}

/** One exercise's estimated 1RM over time, oldest first. */
export function useExerciseTrend(exerciseId: string | undefined): TrendPoint[] | undefined {
  return useLiveQuery(async () => {
    if (!exerciseId) return [];
    const sessions = await exerciseSessions(exerciseId);

    return sessions
      .map((session) => {
        const working = session.sets.filter(isTopWorkingSet);
        if (working.length === 0) return null;
        return {
          performed_at: session.performed_at,
          date: session.performed_at.slice(0, 10),
          e1rm: Math.round(bestEstimated1RM(session.sets) * 10) / 10,
          topWeight: working.reduce((best, set) => Math.max(best, set.weight_kg), 0),
        };
      })
      .filter((point): point is TrendPoint => point !== null)
      .sort((a, b) => Date.parse(a.performed_at) - Date.parse(b.performed_at));
  }, [exerciseId]);
}

export interface SwapOptionsView {
  /** The exercise being swapped out. */
  current: Exercise;
  /** How many sets are already logged — they stay on the current exercise. */
  loggedSets: number;
  /** The routine this session came from, when it came from one. */
  routineName: string | null;
  gymName: string | null;
  suggestions: SwapSuggestions;
}

/**
 * What to offer instead of the exercise in progress.
 *
 * `anyGym` drops the equipment filter, for a gym profile that is wrong or a
 * session away from home.
 */
export function useSwapOptions(
  workoutExerciseId: string | undefined,
  options: { anyGym?: boolean } = {},
): SwapOptionsView | null | undefined {
  const anyGym = options.anyGym ?? false;

  return useLiveQuery(async () => {
    if (!workoutExerciseId) return null;

    const workoutExercise = await db.workout_exercises.get(workoutExerciseId);
    if (!workoutExercise) return null;

    const current = await db.exercises.get(workoutExercise.exercise_id);
    if (!current) return null;

    const workout = await db.workouts.get(workoutExercise.workout_id);
    const sets = live(await db.sets.where({ workout_exercise_id: workoutExerciseId }).toArray());

    const gym = workout?.gym_id
      ? await db.gyms.get(workout.gym_id)
      : live(await db.gyms.toArray()).find((candidate) => candidate.is_default);

    const routine = workout?.routine_id ? await db.routines.get(workout.routine_id) : undefined;

    return {
      current,
      loggedSets: sets.filter((set) => set.completed).length,
      routineName: routine?.name ?? null,
      gymName: gym?.name ?? null,
      suggestions: swapSuggestions(current, live(await db.exercises.toArray()), {
        availableEquipment: anyGym ? null : (gym?.equipment_available ?? null),
        limit: 10,
      }),
    };
  }, [workoutExerciseId, anyGym]);
}
