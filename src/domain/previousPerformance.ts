/**
 * The "last time" line shown inline while logging.
 *
 * Per the brief this always shows the best WORKING set from the last session
 * containing that exercise. Never a drop set, never a warm-up — otherwise the
 * number you are trying to beat is one you never actually lifted.
 */
import type { WorkoutSet } from '@/db/schema';
import { isHeavier, isTopWorkingSet } from './sets';
import type { Readiness } from './types';

/** One past session's sets for a single exercise. Built by the query layer. */
export interface ExerciseSession {
  workout_id: string;
  /** ISO 8601 UTC. Sessions are ranked by this, most recent first. */
  performed_at: string;
  sets: WorkoutSet[];
  /**
   * How the lifter felt going in. A session trained on a bad day is excluded
   * from the progression engine's failure counter, per the brief.
   */
  readiness?: Readiness | null;
}

export interface PreviousPerformance {
  workout_id: string;
  performed_at: string;
  /** Heaviest top working set of that session. */
  top_set: WorkoutSet;
  /** Every top working set of that session, in the order performed. */
  working_sets: WorkoutSet[];
}

/**
 * Finds the most recent session with at least one countable working set.
 *
 * Sessions consisting only of warm-ups or drop sets are skipped rather than
 * reported empty, so the line keeps showing the last real number.
 */
export function previousPerformance(
  sessions: ExerciseSession[],
  options: { excludeWorkoutId?: string } = {},
): PreviousPerformance | null {
  const candidates = sessions
    .filter((session) => session.workout_id !== options.excludeWorkoutId)
    .sort((a, b) => Date.parse(b.performed_at) - Date.parse(a.performed_at));

  for (const session of candidates) {
    const working = session.sets
      .filter(isTopWorkingSet)
      .sort((a, b) => a.set_index - b.set_index);
    if (working.length === 0) continue;

    let top = working[0]!;
    for (const set of working) {
      if (isHeavier(set, top)) top = set;
    }

    return {
      workout_id: session.workout_id,
      performed_at: session.performed_at,
      top_set: top,
      working_sets: working,
    };
  }

  return null;
}

/** "100kg x 8" — the compact form shown under the set row. */
export function formatSetSummary(set: Pick<WorkoutSet, 'weight_kg' | 'reps'>): string {
  const weight = Number.isInteger(set.weight_kg) ? String(set.weight_kg) : set.weight_kg.toFixed(2).replace(/0+$/, '').replace(/\.$/, '');
  return `${weight}kg × ${set.reps}`;
}
