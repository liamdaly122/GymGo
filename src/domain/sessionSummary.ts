/**
 * What you see when you finish: duration, volume, sets per muscle group, any
 * PRs hit, and how it compared to the last time you ran the same routine.
 *
 * Pure — the query layer assembles the inputs, this decides what they mean.
 */
import type { Exercise, Workout, WorkoutSet } from '@/db/schema';
import type { Muscle } from './types';
import { prsHitInSession, type PrHit } from './prs';
import { setsPerMuscle, totalReps, totalTonnage, totalWorkingSets } from './volume';

export interface SummaryExerciseInput {
  exercise: Exercise | undefined;
  /** Sets performed in the session being summarised. */
  sets: WorkoutSet[];
  /** Every set of this exercise from BEFORE this session. Excludes it, or it ties itself. */
  priorSets: WorkoutSet[];
}

export interface SessionSummaryInput {
  workout: Workout;
  exercises: SummaryExerciseInput[];
  /** The last session of the same routine, for a like-for-like comparison. */
  previousSameRoutine?: { workout: Workout; sets: WorkoutSet[] } | null;
}

export interface SessionComparison {
  workout_id: string;
  performed_at: string;
  tonnage_delta_kg: number;
  set_delta: number;
}

export interface SessionSummary {
  duration_ms: number | null;
  tonnage_kg: number;
  set_count: number;
  rep_count: number;
  exercise_count: number;
  sets_per_muscle: Array<{ muscle: Muscle; sets: number }>;
  prs: Array<PrHit & { exercise_name: string }>;
  comparison: SessionComparison | null;
}

export function summariseSession(input: SessionSummaryInput): SessionSummary {
  const { workout, exercises } = input;
  const allSets = exercises.flatMap((entry) => entry.sets);

  const exerciseBySetId = new Map<string, Exercise>();
  for (const entry of exercises) {
    if (!entry.exercise) continue;
    for (const set of entry.sets) exerciseBySetId.set(set.id, entry.exercise);
  }

  const prs = exercises.flatMap((entry) =>
    entry.exercise
      ? prsHitInSession(entry.sets, entry.priorSets).map((hit) => ({
          ...hit,
          exercise_name: entry.exercise!.name,
        }))
      : [],
  );

  const perMuscle = [...setsPerMuscle(allSets, exerciseBySetId).entries()]
    .map(([muscle, sets]) => ({ muscle, sets }))
    .sort((a, b) => b.sets - a.sets || a.muscle.localeCompare(b.muscle, 'en'));

  const previous = input.previousSameRoutine ?? null;
  const comparison: SessionComparison | null = previous
    ? {
        workout_id: previous.workout.id,
        performed_at: previous.workout.finished_at ?? previous.workout.started_at,
        tonnage_delta_kg: totalTonnage(allSets) - totalTonnage(previous.sets),
        set_delta: totalWorkingSets(allSets) - totalWorkingSets(previous.sets),
      }
    : null;

  return {
    duration_ms: workout.finished_at
      ? Date.parse(workout.finished_at) - Date.parse(workout.started_at)
      : null,
    tonnage_kg: totalTonnage(allSets),
    set_count: totalWorkingSets(allSets),
    rep_count: totalReps(allSets),
    exercise_count: exercises.filter((entry) => entry.sets.some((set) => set.completed)).length,
    sets_per_muscle: perMuscle,
    prs,
    comparison,
  };
}

/**
 * Roughly how long a session will take, in minutes.
 *
 * Sets times the work plus the rest that follows each one. Deliberately an
 * estimate and labelled as such — the alternative shown in commercial apps is a
 * calorie figure, which needs bodyweight and a MET table and is still a guess
 * dressed up with two significant figures.
 */
const SECONDS_PER_WORKING_SET = 40;

export function estimateDurationMinutes(
  exercises: Array<{ sets: number; restSeconds: number }>,
): number {
  const seconds = exercises.reduce(
    (total, entry) => total + entry.sets * (SECONDS_PER_WORKING_SET + entry.restSeconds),
    0,
  );
  // Round to the nearest five: false precision on an estimate reads as a lie.
  return Math.max(5, Math.round(seconds / 60 / 5) * 5);
}
