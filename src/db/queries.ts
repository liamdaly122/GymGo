/**
 * Read helpers. Every one of these hits Dexie only — nothing here ever touches
 * the network, so no screen can accidentally start waiting on one.
 *
 * Soft-deleted rows are filtered out here so no caller has to remember to.
 */
import { useLiveQuery } from 'dexie-react-hooks';
import { scheduleDay, useToday } from '@/hooks/useToday';
import { db } from './db';
import { SETTINGS_ID, type Exercise, type Gym, type Plan, type Routine, type RoutineExercise, type Settings, type Workout, type WorkoutExercise, type WorkoutSet } from './schema';
import { previousPerformance, type ExerciseSession, type PreviousPerformance } from '@/domain/previousPerformance';
import { planSwapTargets } from '@/domain/search';
import { personalRecords, recordsBrokenPerSession } from '@/domain/prs';
import { estimateDurationMinutes, summariseSession } from '@/domain/sessionSummary';
import {
  blockProgress,
  buildSchedule,
  currentSession,
  currentWeek,
  groupByWeek,
  isBlockComplete,
  runningPlan,
  type ScheduledSession,
  type WeekSummary,
} from '@/domain/schedule';
import { setsForWeek, weekModifier, type WeekModifier } from '@/domain/programmes/block';
import { suggestNextSet, LOW_READINESS_MULTIPLIER, type Suggestion } from '@/domain/progression';
import { estimateOpeningWeight } from '@/domain/coldStart';
import { loadableWeight, loadingProfileFor, type LoadingProfile } from '@/domain/plates';
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
  /**
   * The rep range the routine asks for, when the session came from one. Read
   * for display beside the name; the suggestion engine reads the same row.
   * Null for freestyle work, which has no prescription to show.
   */
  repRange: { low: number; high: number } | null;
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

  const prescribed = new Map<string, { low: number; high: number }>();
  if (workout.routine_id) {
    for (const row of live(await db.routine_exercises.where({ routine_id: workout.routine_id }).toArray())) {
      if (!prescribed.has(row.exercise_id)) {
        prescribed.set(row.exercise_id, { low: row.rep_range_low, high: row.rep_range_high });
      }
    }
  }

  return {
    workout,
    exercises: workoutExercises.map((we) => ({
      workoutExercise: we,
      exercise: exerciseById.get(we.exercise_id),
      sets: allSets
        .filter((set) => set.workout_exercise_id === we.id)
        .sort((a, b) => a.set_index - b.set_index),
      loading: loadingProfileFor(exerciseById.get(we.exercise_id)?.equipment ?? 'other', gym ?? {}),
      repRange: prescribed.get(we.exercise_id) ?? null,
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

/**
 * What a workout is called on screen: its routine's session name ("Push"), or
 * "Workout" for one started empty.
 */
export function useWorkoutName(workoutId: string | undefined): string | undefined {
  return useLiveQuery(async () => {
    if (!workoutId) return undefined;
    const workout = await db.workouts.get(workoutId);
    if (!workout) return undefined;
    const routine = workout.routine_id ? await db.routines.get(workout.routine_id) : undefined;
    return routine ? (routine.name.split(' — ').at(-1) ?? routine.name) : 'Workout';
  }, [workoutId]);
}

export interface SessionRow {
  workout: Workout;
  /** The routine's session name ("Push"), or "Workout" for one started empty. */
  name: string;
  durationMs: number;
  tonnage: number;
  /** Working sets, through the same rule as every other volume count. */
  sets: number;
  /** Records broken — beating an earlier best, never a first. */
  records: number;
}

/**
 * Finished sessions, newest first, with the numbers a list row shows.
 *
 * One pass over the tables rather than a query per row, so a long history does
 * not fan out into hundreds of reads. Records are counted oldest first, since a
 * record means beating everything before it.
 */
export function useSessionList(limit = 50): SessionRow[] | undefined {
  return useLiveQuery(async () => {
    const workouts = live(await db.workouts.toArray())
      .filter((workout) => workout.finished_at !== null)
      .sort((a, b) => Date.parse(a.started_at) - Date.parse(b.started_at));
    const workoutExercises = live(
      await db.workout_exercises.where('workout_id').anyOf(workouts.map((w) => w.id)).toArray(),
    );
    const sets = live(
      await db.sets.where('workout_exercise_id').anyOf(workoutExercises.map((we) => we.id)).toArray(),
    );
    // Deleted routines still name the sessions they produced.
    const routineNames = new Map(
      (await db.routines.toArray()).map((routine) => [routine.id, routine.name.split(' — ').at(-1) ?? routine.name]),
    );

    const setsByExercise = new Map<string, WorkoutSet[]>();
    for (const set of sets) {
      const bucket = setsByExercise.get(set.workout_exercise_id);
      if (bucket) bucket.push(set);
      else setsByExercise.set(set.workout_exercise_id, [set]);
    }
    const exercisesByWorkout = new Map<string, WorkoutExercise[]>();
    for (const we of workoutExercises) {
      const bucket = exercisesByWorkout.get(we.workout_id);
      if (bucket) bucket.push(we);
      else exercisesByWorkout.set(we.workout_id, [we]);
    }

    const sessions = workouts.map((workout) => ({
      id: workout.id,
      exercises: (exercisesByWorkout.get(workout.id) ?? []).map((we) => ({
        exerciseId: we.exercise_id,
        sets: setsByExercise.get(we.id) ?? [],
      })),
    }));
    const records = recordsBrokenPerSession(sessions);

    return workouts
      .map((workout, index) => {
        const all = sessions[index]!.exercises.flatMap((entry) => entry.sets);
        return {
          workout,
          name: workout.routine_id ? (routineNames.get(workout.routine_id) ?? 'Workout') : 'Workout',
          durationMs: Date.parse(workout.finished_at!) - Date.parse(workout.started_at),
          tonnage: totalTonnage(all),
          sets: totalWorkingSets(all),
          records: records.get(workout.id) ?? 0,
        };
      })
      .reverse()
      .slice(0, limit);
  }, [limit]);
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

async function defaultGym(): Promise<Gym | null> {
  const gyms = live(await db.gyms.toArray());
  const settings = await db.settings.get(SETTINGS_ID);
  const preferred = settings?.default_gym_id
    ? gyms.find((gym) => gym.id === settings.default_gym_id)
    : undefined;
  return preferred ?? gyms.find((gym) => gym.is_default) ?? gyms[0] ?? null;
}

/** The gym plans are built against. Its equipment filters every suggestion. */
export function useDefaultGym(): Gym | undefined | null {
  return useLiveQuery(() => defaultGym(), []);
}

/**
 * The plan currently being trained, if there is one.
 *
 * Most recent block that has not been marked finished. Only one runs at a time.
 */
export function useActivePlan(): Plan | undefined | null {
  return useLiveQuery(async () => {
    return runningPlan(await db.plans.toArray());
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
  // Live, so a session skipped yesterday rolls onto today without a reload.
  const today = useToday();
  return useLiveQuery(async () => {
    const plan = runningPlan(await db.plans.toArray());
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

    const schedule = buildSchedule({ plan, routineNames, workouts, today: scheduleDay(today) });
    const current = currentSession(schedule);

    return {
      plan,
      schedule,
      current,
      week: weekModifier(current?.week ?? plan.current_week, plan.block_weeks),
      progress: blockProgress(schedule),
    };
  }, [today]);
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
  const today = useToday();
  return useLiveQuery(async () => {
    const plan = runningPlan(await db.plans.toArray());

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
    const schedule = buildSchedule({ plan, routineNames, workouts, today: scheduleDay(today) });

    return {
      plan,
      schedule,
      week: weekModifier(currentWeek(schedule), plan.block_weeks),
      progress: blockProgress(schedule),
      complete: isBlockComplete(schedule),
      sessions,
      standalone,
    };
  }, [today]);
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
  const today = useToday();
  return useLiveQuery(async () => {
    const plan = runningPlan(await db.plans.toArray());
    if (!plan) return null;

    const routines = await db.routines.bulkGet(plan.routine_ids);
    const routineNames = new Map(
      routines
        .filter(Boolean)
        .map((routine) => [routine!.id, routine!.name.split(' — ').at(-1) ?? routine!.name]),
    );
    const workouts = live(await db.workouts.where({ plan_id: plan.id }).toArray());
    const schedule = buildSchedule({ plan, routineNames, workouts, today: scheduleDay(today) });

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
  }, [today]);
}

/**
 * What to lift next for one exercise in the session in progress.
 *
 * Assembles everything the progression engine needs — history, the gym's plates,
 * today's readiness, the block week — so no screen has to know those rules.
 */
/**
 * Lifts with history that an unperformed one could be reasoned from.
 *
 * Narrowed before any set is read: only exercises sharing a movement pattern or
 * a primary muscle can transfer at all, and only ones actually trained are
 * worth loading. That keeps this to a handful of reads even with 675 exercises
 * seeded, and it only ever runs on the first exposure to a lift.
 */
async function referenceLifts(target: Exercise, excludeWorkoutId: string) {
  const trainedIds = [
    ...new Set(live(await db.workout_exercises.toArray()).map((we) => we.exercise_id)),
  ].filter((id) => id !== target.id);

  const candidates = (await db.exercises.bulkGet(trainedIds)).filter(
    (exercise): exercise is Exercise =>
      Boolean(exercise) &&
      exercise!.deleted_at === null &&
      (exercise!.movement_pattern === target.movement_pattern ||
        exercise!.primary_muscle === target.primary_muscle),
  );

  const references = [];
  for (const exercise of candidates) {
    const history = (await exerciseSessions(exercise.id)).filter(
      (session) => session.workout_id !== excludeWorkoutId,
    );
    if (history.length > 0) references.push({ exercise, history });
  }
  return references;
}

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

    const loading = loadingProfileFor(exercise.equipment, gym ?? {});

    /*
     * Never done this lift before.
     *
     * The engine says nothing without history, which is right — a number with
     * nothing behind it still looks authoritative. But a freshly generated plan
     * is entirely made of lifts you have not done, so the whole first block
     * arrived with no guidance at all. Reason from the closest lift you HAVE
     * done instead, clearly labelled as an estimate.
     */
    if (sessions.length === 0) {
      const references = await referenceLifts(exercise, workoutId);
      const estimate = estimateOpeningWeight(exercise, references, loading, { repRange });
      if (!estimate) return null;

      // An estimate is still a suggested load, so a bad day pulls it down like
      // any other. Leaving it alone would make answering "rough" look like it
      // only half worked.
      const rough = workout.readiness === 'low';
      const weight = rough
        ? loadableWeight(estimate.weight_kg * LOW_READINESS_MULTIPLIER, loading, {
            direction: 'down',
          })
        : estimate.weight_kg;

      return {
        weight_kg: weight,
        reps: estimate.reps,
        kind: 'estimate' as const,
        scaled_down: rough,
        reason:
          `You have not done this one before. From your ${estimate.basis}, ` +
          `${weight}kg is a sensible first try — it is an estimate, not ` +
          'history, so change it to whatever it turns out to be.' +
          (rough ? ' Scaled down 10% because you logged low readiness.' : ''),
      };
    }

    return suggestNextSet({
      exercise,
      repRange,
      history: sessions,
      loading,
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

export interface LiftSummary {
  id: string;
  name: string;
  muscle: string;
  sessions: number;
  /** Heaviest top working set per session, oldest first — the sparkline. */
  series: number[];
  best: { weight: number; reps: number };
  bestE1rm: number;
}

/**
 * Every lift you have trained, for Progress → Lifts: how many sessions, the
 * shape of its top set over time, and its records. One pass over the tables,
 * through the same top-working-set gate as every other record.
 */
export function useLiftSummaries(): LiftSummary[] | undefined {
  return useLiveQuery(async () => {
    const workouts = live(await db.workouts.toArray()).filter((w) => w.finished_at !== null);
    const startedAt = new Map(workouts.map((w) => [w.id, Date.parse(w.started_at)]));
    const workoutExercises = live(
      await db.workout_exercises.where('workout_id').anyOf(workouts.map((w) => w.id)).toArray(),
    );
    const sets = live(
      await db.sets.where('workout_exercise_id').anyOf(workoutExercises.map((we) => we.id)).toArray(),
    ).filter(isTopWorkingSet);
    const exercises = await db.exercises.bulkGet([...new Set(workoutExercises.map((we) => we.exercise_id))]);
    const exerciseById = new Map(exercises.filter(Boolean).map((exercise) => [exercise!.id, exercise!]));

    const setsByWe = new Map<string, WorkoutSet[]>();
    for (const set of sets) {
      const bucket = setsByWe.get(set.workout_exercise_id);
      if (bucket) bucket.push(set);
      else setsByWe.set(set.workout_exercise_id, [set]);
    }

    const byExercise = new Map<string, Array<{ at: number; sets: WorkoutSet[] }>>();
    for (const we of workoutExercises) {
      const done = setsByWe.get(we.id);
      if (!done || done.length === 0) continue;
      const bucket = byExercise.get(we.exercise_id) ?? [];
      bucket.push({ at: startedAt.get(we.workout_id) ?? 0, sets: done });
      byExercise.set(we.exercise_id, bucket);
    }

    const summaries: LiftSummary[] = [];
    for (const [id, sessions] of byExercise) {
      const exercise = exerciseById.get(id);
      if (!exercise) continue;
      sessions.sort((a, b) => a.at - b.at);
      const all = sessions.flatMap((session) => session.sets);
      const records = personalRecords(all);
      if (!records.heaviest || !records.bestE1rm) continue;
      summaries.push({
        id,
        name: exercise.name,
        muscle: exercise.primary_muscle,
        sessions: sessions.length,
        series: sessions.slice(-8).map((session) => Math.max(...session.sets.map((set) => set.weight_kg))),
        best: { weight: records.heaviest.weight_kg, reps: records.heaviest.reps },
        bestE1rm: Math.round(records.bestE1rm.value * 10) / 10,
      });
    }
    return summaries.sort((a, b) => b.sessions - a.sessions || a.name.localeCompare(b.name, 'en'));
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

/** A generated routine is named "<plan> — <session>"; the session is the name. */
const sessionLabel = (routine: Routine) => routine.name.split(' — ').at(-1) ?? routine.name;

/**
 * How far a swap can reach from one session, and what is already there.
 *
 * The exercise ids are what a swap must not offer: putting a lift into a
 * session that already has it would double it up.
 */
export interface SwapReach {
  /** This session, by its short name. */
  routine: { id: string; label: string; exerciseIds: ReadonlySet<string> } | null;
  /**
   * The running block, and what a swap across it would change: each session's
   * version of the lift (`planSwapTargets`), in plan order.
   */
  plan: {
    id: string;
    targets: Array<{ session: string; exercise: string }>;
    exerciseIds: ReadonlySet<string>;
  } | null;
}

async function swapReach(routineId: string | null, exercise: Exercise): Promise<SwapReach> {
  if (!routineId) return { routine: null, plan: null };
  const routine = await db.routines.get(routineId);
  if (!routine || routine.deleted_at !== null) return { routine: null, plan: null };

  const plan = runningPlan(await db.plans.toArray(), routine.id);
  const routineIds = plan ? plan.routine_ids : [routine.id];
  const routines = await db.routines.bulkGet(routineIds);
  const rows = live(await db.routine_exercises.where('routine_id').anyOf(routineIds).toArray());
  const exercises = await db.exercises.bulkGet([...new Set(rows.map((row) => row.exercise_id))]);
  const byId = new Map(exercises.filter(Boolean).map((candidate) => [candidate!.id, candidate!]));

  const sessions = routineIds.map((id) =>
    rows
      .filter((row) => row.routine_id === id)
      .sort((a, b) => a.position - b.position)
      .flatMap((row) => {
        const found = byId.get(row.exercise_id);
        return found ? [{ exercise: found }] : [];
      }),
  );
  const idsIn = (index: number) => sessions[index]!.map((item) => item.exercise.id);

  const reach: SwapReach = {
    routine: {
      id: routine.id,
      label: sessionLabel(routine),
      exerciseIds: new Set(idsIn(routineIds.indexOf(routine.id))),
    },
    plan: null,
  };
  if (!plan) return reach;

  const targets = planSwapTargets(sessions, exercise).filter(({ sessionIndex }) => {
    const session = routines[sessionIndex];
    return session !== undefined && session.deleted_at === null;
  });
  return {
    ...reach,
    plan: {
      id: plan.id,
      targets: targets.map(({ sessionIndex, item }) => ({
        session: sessionLabel(routines[sessionIndex]!),
        exercise: item.exercise.name,
      })),
      exerciseIds: new Set(targets.flatMap(({ sessionIndex }) => idsIn(sessionIndex))),
    },
  };
}

export interface SwapOptionsView extends SwapReach {
  /** The exercise being swapped out. */
  current: Exercise;
  /** How many sets are already logged — they stay on the current exercise. */
  loggedSets: number;
  /** What today's session already has. */
  workoutExerciseIds: ReadonlySet<string>;
  /** Every exercise, for the alternatives and the search. */
  library: Exercise[];
  gym: Gym | null;
}

/** What a swap mid-session can offer, and how far it can reach. */
export function useSwapOptions(workoutExerciseId: string | undefined): SwapOptionsView | null | undefined {
  return useLiveQuery(async () => {
    if (!workoutExerciseId) return null;

    const workoutExercise = await db.workout_exercises.get(workoutExerciseId);
    if (!workoutExercise) return null;

    const current = await db.exercises.get(workoutExercise.exercise_id);
    if (!current) return null;

    const workout = await db.workouts.get(workoutExercise.workout_id);
    const sets = live(await db.sets.where({ workout_exercise_id: workoutExerciseId }).toArray());
    const inSession = live(await db.workout_exercises.where({ workout_id: workoutExercise.workout_id }).toArray());
    const sessionGym = workout?.gym_id ? await db.gyms.get(workout.gym_id) : undefined;

    return {
      current,
      loggedSets: sets.filter((set) => set.completed).length,
      workoutExerciseIds: new Set(inSession.map((row) => row.exercise_id)),
      library: live(await db.exercises.toArray()),
      gym: sessionGym && sessionGym.deleted_at === null ? sessionGym : await defaultGym(),
      ...(await swapReach(workout?.routine_id ?? null, current)),
    };
  }, [workoutExerciseId]);
}

export interface RoutineSwapView extends SwapReach {
  current: Exercise;
  library: Exercise[];
  gym: Gym | null;
}

/** What a swap in a planned session can offer, and how far it can reach. */
export function useRoutineSwapOptions(routineExerciseId: string | undefined): RoutineSwapView | null | undefined {
  return useLiveQuery(async () => {
    if (!routineExerciseId) return null;
    const row = await db.routine_exercises.get(routineExerciseId);
    if (!row || row.deleted_at !== null) return null;
    const current = await db.exercises.get(row.exercise_id);
    if (!current) return null;

    return {
      current,
      library: live(await db.exercises.toArray()),
      gym: await defaultGym(),
      ...(await swapReach(row.routine_id, current)),
    };
  }, [routineExerciseId]);
}
