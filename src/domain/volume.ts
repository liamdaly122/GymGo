/**
 * Training volume.
 *
 * The counting rule that matters: child sets DO count here. A drop set is real
 * work and belongs in the weekly total, even though it is barred from personal
 * records. This module is the exact inverse of prs.ts, and the pair is easy to
 * get backwards, so both directions are unit tested.
 */
import type { Exercise, WorkoutSet } from '@/db/schema';
import type { Muscle } from './types';
import { countsTowardVolume } from './sets';
import { estimate1RM } from './epley';

/**
 * Fractional set counting: a set credits its primary muscle in full and each
 * secondary muscle at half. This is the usual convention in the hypertrophy
 * literature, and it stops a bench press from claiming a full triceps set.
 */
export const SECONDARY_MUSCLE_CREDIT = 0.5;

/** Total tonnage in kg: sum of weight x reps over every set that counts. */
export function totalTonnage(sets: WorkoutSet[]): number {
  return sets
    .filter(countsTowardVolume)
    .reduce((total, set) => total + set.weight_kg * set.reps, 0);
}

/** Number of sets that count, ignoring which muscle they worked. */
export function totalWorkingSets(sets: WorkoutSet[]): number {
  return sets.filter(countsTowardVolume).length;
}

/** Total reps performed across every set that counts. */
export function totalReps(sets: WorkoutSet[]): number {
  return sets.filter(countsTowardVolume).reduce((total, set) => total + set.reps, 0);
}

/**
 * Sets per muscle group — the number the brief's volume targets are expressed
 * in ("10 to 20 working sets per muscle group per week").
 *
 * `exerciseBySetId` maps each set to the exercise it was performed on; callers
 * build it by walking set -> workout_exercise -> exercise.
 */
export function setsPerMuscle(
  sets: WorkoutSet[],
  exerciseBySetId: Map<string, Exercise>,
): Map<Muscle, number> {
  const totals = new Map<Muscle, number>();

  const add = (muscle: Muscle, amount: number) => {
    totals.set(muscle, (totals.get(muscle) ?? 0) + amount);
  };

  for (const set of sets) {
    if (!countsTowardVolume(set)) continue;
    const exercise = exerciseBySetId.get(set.id);
    if (!exercise) continue;

    add(exercise.primary_muscle, 1);
    for (const secondary of exercise.secondary_muscles) {
      add(secondary, SECONDARY_MUSCLE_CREDIT);
    }
  }

  return totals;
}

/** Tonnage per muscle group, credited the same way as `setsPerMuscle`. */
export function tonnagePerMuscle(
  sets: WorkoutSet[],
  exerciseBySetId: Map<string, Exercise>,
): Map<Muscle, number> {
  const totals = new Map<Muscle, number>();

  for (const set of sets) {
    if (!countsTowardVolume(set)) continue;
    const exercise = exerciseBySetId.get(set.id);
    if (!exercise) continue;

    const load = set.weight_kg * set.reps;
    totals.set(exercise.primary_muscle, (totals.get(exercise.primary_muscle) ?? 0) + load);
    for (const secondary of exercise.secondary_muscles) {
      totals.set(secondary, (totals.get(secondary) ?? 0) + load * SECONDARY_MUSCLE_CREDIT);
    }
  }

  return totals;
}

/**
 * Best estimated 1RM across a group of sets.
 *
 * Child sets are excluded: a drop set produces a low estimate that would drag
 * the charted trend down and misrepresent the session.
 */
export function bestEstimated1RM(sets: WorkoutSet[]): number {
  return sets
    .filter((set) => countsTowardVolume(set) && set.parent_set_id === null && set.type === 'working')
    .reduce((best, set) => Math.max(best, estimate1RM(set.weight_kg, set.reps)), 0);
}
