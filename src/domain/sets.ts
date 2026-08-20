/**
 * Predicates that decide what a set counts for.
 *
 * The brief's counting rules live here and nowhere else. Every screen, chart and
 * suggestion asks these questions rather than re-deriving the answers, because
 * the failure mode of getting them wrong is silent: a drop set quietly
 * overwriting a personal record looks like progress, not like a bug.
 */
import type { WorkoutSet } from '@/db/schema';

/**
 * A child set hangs off a parent: a drop-set continuation, a rest-pause
 * cluster, a myo-rep cluster, a cluster-set piece.
 *
 * Child sets count toward volume, and never toward personal records.
 */
export function isChildSet(set: Pick<WorkoutSet, 'parent_set_id'>): boolean {
  return set.parent_set_id !== null;
}

/** Live rows only — soft-deleted rows are still physically present. */
export function isLive(set: Pick<WorkoutSet, 'deleted_at'>): boolean {
  return set.deleted_at === null;
}

/**
 * Does this set count toward training volume?
 *
 * Yes for completed working, back-off and child sets. No for warm-ups, which
 * are not training, and no for anything not actually performed.
 */
export function countsTowardVolume(
  set: Pick<WorkoutSet, 'type' | 'completed' | 'deleted_at'>,
): boolean {
  return isLive(set) && set.completed && set.type !== 'warmup';
}

/**
 * Is this set eligible to set a personal record, or to be reported as previous
 * performance?
 *
 * Only a completed, top-level working set. A 40kg drop set must never overwrite
 * a 100kg PR, and must never appear as last session's number.
 */
export function isTopWorkingSet(
  set: Pick<WorkoutSet, 'type' | 'completed' | 'deleted_at' | 'parent_set_id'>,
): boolean {
  return isLive(set) && set.completed && set.type === 'working' && !isChildSet(set);
}

/**
 * Ranks two working sets to find the "top set" of a session.
 *
 * Heaviest wins; reps break a tie. This is what the previous-performance line
 * reports, matching how a lifter actually thinks about last session — the
 * heaviest thing they lifted, not an average.
 */
export function isHeavier(
  candidate: Pick<WorkoutSet, 'weight_kg' | 'reps'>,
  incumbent: Pick<WorkoutSet, 'weight_kg' | 'reps'>,
): boolean {
  if (candidate.weight_kg !== incumbent.weight_kg) {
    return candidate.weight_kg > incumbent.weight_kg;
  }
  return candidate.reps > incumbent.reps;
}

/**
 * What number each set wears on the card.
 *
 * Not the array index. A warm-up ramp sits in front of the working sets, and
 * numbering by position would turn the first working set into "Set 4" — which
 * is not what a lifter counts, and not what the rep range refers to.
 *
 * A child set inherits its parent's number, so a drop hanging off set 3 still
 * reads as set 3. Warm-ups are counted on their own sequence — they are not
 * working sets and must not push the first one to "set 4", but they still need
 * a number of their own so four rungs do not all announce themselves the same.
 * The caller knows which sequence a number belongs to from the set's type.
 */
export function setOrdinals(
  sets: Pick<WorkoutSet, 'id' | 'type' | 'parent_set_id'>[],
): Map<string, number> {
  const ordinals = new Map<string, number>();
  let next = 0;
  let nextWarmup = 0;

  for (const set of sets) {
    if (isChildSet(set)) {
      const parent = set.parent_set_id === null ? undefined : ordinals.get(set.parent_set_id);
      if (parent !== undefined) ordinals.set(set.id, parent);
      continue;
    }
    if (set.type === 'warmup') {
      ordinals.set(set.id, nextWarmup);
      nextWarmup += 1;
      continue;
    }
    ordinals.set(set.id, next);
    next += 1;
  }

  return ordinals;
}
