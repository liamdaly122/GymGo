/**
 * Rule 1, carry forward: from the second set on, start at the set just done,
 * a notch lighter when it fell short of the range.
 *
 * The set carried is the working set done most recently today
 * (`latestWorkingSet`): warm-ups, drops, back-offs and old 0 × 0 ticks are
 * never carried. When that set fell short of the bottom of the rep range, the
 * next one starts lighter and aims for the bottom of the range, rather than
 * asking again for the weight just missed:
 *
 *  1. the weight that should give `repLow` reps, by the same estimate as the
 *     records (`estimate1RM`): e1RM / (1 + repLow / 30);
 *  2. but never more than 10% lighter than the set just done;
 *  3. rounded down through what the equipment makes;
 *  4. and at least one real step lighter, which on coarse kit (a 5kg stack, a
 *     light dumbbell) is more than 10%.
 *
 * It is left exactly as done:
 *  - at or above the bottom of the range, or with no range (freestyle);
 *  - for an AMRAP set, whose reps were never a target;
 *  - for unloaded bodyweight work (0kg) and `free` loading (bodyweight with
 *    weight added, bands), whose numbers fall off the watch's Crown ladder;
 *  - when nothing lighter can be loaded (a bare bar, the lightest dumbbell, a
 *    stack's first plate): asking for more reps at the weight just missed
 *    would be wrong.
 *
 * The watch ports this rule (`carriedSet` in GymGoKit), held to it by
 * fixtures/watch/carry.json. Pure.
 */
import type { WorkoutSet } from '@/db/schema';
import { estimate1RM } from './epley';
import { loadableWeight, nextLoadableBelow, type LoadingProfile } from './plates';
import { latestWorkingSet } from './sets';

/** At most this much lighter, unless one real step is already more. */
export const STEP_DOWN_FLOOR = 0.9;

/** Why a carried set is lighter than the set just done. */
export interface StepDown {
  /** The set just done, which fell short. */
  from: { weight: number; reps: number };
  /** The bottom of the range it fell short of: the reps the next set aims for. */
  repLow: number;
}

export interface Carried {
  weight_kg: number;
  reps: number;
  /** Set when the set just done fell short of the range and this is lighter. */
  stepped: StepDown | null;
}

export type CarrySet = Pick<
  WorkoutSet,
  'type' | 'completed' | 'completed_at' | 'deleted_at' | 'parent_set_id' | 'reps' | 'weight_kg' | 'is_amrap'
>;

/**
 * The numbers the next set starts at, from the sets of the lift done today,
 * or null before the first working set is done.
 */
export function carryForward(
  sets: readonly CarrySet[],
  repLow: number | null | undefined,
  loading: LoadingProfile,
): Carried | null {
  const latest = latestWorkingSet(sets);
  if (!latest) return null;
  const asDone: Carried = { weight_kg: latest.weight_kg, reps: latest.reps, stepped: null };

  if (repLow == null || !(repLow > 0) || latest.reps >= repLow) return asDone;
  if (latest.is_amrap || !(latest.weight_kg > 0) || loading.mode === 'free') return asDone;

  const oneStep = nextLoadableBelow(latest.weight_kg, loading);
  if (!(oneStep < latest.weight_kg)) return asDone;

  const forRepLow = estimate1RM(latest.weight_kg, latest.reps) / (1 + repLow / 30);
  const target = loadableWeight(Math.max(forRepLow, latest.weight_kg * STEP_DOWN_FLOOR), loading, { direction: 'down' });
  return {
    weight_kg: Math.min(target, oneStep),
    reps: repLow,
    stepped: { from: { weight: latest.weight_kg, reps: latest.reps }, repLow },
  };
}
