/**
 * Where to start a lift you have never done.
 *
 * The progression engine reasons from history and says nothing without it,
 * which is right — inventing a number that looks authoritative is worse than
 * silence. But it means a freshly generated plan offers no guidance on any
 * exercise for an entire first block, which is exactly when a lifter most wants
 * a starting point.
 *
 * So: reason from a lift they HAVE done. Not a strength-standards table — this
 * makes no claim about what anyone should lift — just "you press this much, so
 * open here and adjust". Deliberately conservative, because the cost of opening
 * too light is one easy set and the cost of opening too heavy is a failed rep
 * under a bar.
 *
 * Pure.
 */
import type { Exercise } from '@/db/schema';
import type { ExerciseSession } from './previousPerformance';
import { isTopWorkingSet } from './sets';
import { isHeavier } from './sets';
import { loadableWeight, type LoadingProfile } from './plates';
import { swapSuggestions } from './search';

export interface OpeningEstimate {
  weight_kg: number;
  reps: number;
  /** The lift this was reasoned from, for a reason string that names it. */
  basis: string;
}

export interface ExerciseHistory {
  exercise: Exercise;
  history: ExerciseSession[];
}

/**
 * How much of the reference lift to open with.
 *
 * `direct` means the same movement pattern AND the same primary muscle — an
 * incline press read off a flat press. `alternative` matches on one or the
 * other and is a looser read, so it opens lighter.
 *
 * Crossing equipment types is treated much more cautiously than it might be,
 * because the app has no convention for whether a dumbbell weight means per
 * hand or the pair. Until that is settled, a cross-equipment estimate is a
 * rough opener rather than a conversion.
 */
const FRACTIONS = {
  direct: { sameEquipment: 0.85, crossEquipment: 0.55 },
  alternative: { sameEquipment: 0.65, crossEquipment: 0.45 },
} as const;

/** The heaviest working set ever performed on a lift. */
function bestWorkingWeight(history: ExerciseSession[]): number {
  let best = 0;
  for (const session of history) {
    for (const set of session.sets) {
      if (!isTopWorkingSet(set)) continue;
      if (set.weight_kg > best) best = set.weight_kg;
    }
  }
  return best;
}

/** The heaviest set of the most recent session that had one. */
function mostRecentTopSet(history: ExerciseSession[]) {
  const sorted = [...history].sort(
    (a, b) => Date.parse(b.performed_at) - Date.parse(a.performed_at),
  );
  for (const session of sorted) {
    const working = session.sets.filter(isTopWorkingSet);
    if (working.length === 0) continue;
    return working.reduce((best, set) => (isHeavier(set, best) ? set : best), working[0]!);
  }
  return null;
}

/**
 * An opening weight for `target`, reasoned from the closest lift with history.
 *
 * Returns null when nothing related has been trained. Saying nothing stays
 * better than guessing: that is the existing behaviour and it is the right one
 * whenever there is genuinely no evidence.
 */
export function estimateOpeningWeight(
  target: Exercise,
  references: ExerciseHistory[],
  profile: LoadingProfile,
  options: { repRange?: { low: number; high: number } | null } = {},
): OpeningEstimate | null {
  // Bodyweight work has no load to reason about.
  if (profile.mode === 'free') return null;

  const trained = references.filter(
    (entry) => entry.exercise.id !== target.id && bestWorkingWeight(entry.history) > 0,
  );
  if (trained.length === 0) return null;

  // Reuse the swap tiering rather than a second notion of "similar exercise":
  // direct is same pattern and same muscle, alternative is one or the other.
  const { direct, alternative } = swapSuggestions(
    target,
    trained.map((entry) => entry.exercise),
    { limit: 50 },
  );

  const byId = new Map(trained.map((entry) => [entry.exercise.id, entry]));

  for (const [tier, ranked] of [
    ['direct', direct],
    ['alternative', alternative],
  ] as const) {
    // Same equipment first within the tier: it is the only comparison that does
    // not depend on an unsettled convention.
    const ordered = [
      ...ranked.filter((candidate) => candidate.equipment === target.equipment),
      ...ranked.filter((candidate) => candidate.equipment !== target.equipment),
    ];

    for (const candidate of ordered) {
      const entry = byId.get(candidate.id);
      if (!entry) continue;

      const top = mostRecentTopSet(entry.history);
      if (!top || top.weight_kg <= 0) continue;

      const sameEquipment = candidate.equipment === target.equipment;
      const fraction = FRACTIONS[tier][sameEquipment ? 'sameEquipment' : 'crossEquipment'];

      // Down, never up: an opener you cannot load is not an opener, and erring
      // light is the cheap mistake.
      const weight = loadableWeight(top.weight_kg * fraction, profile, { direction: 'down' });
      if (weight <= 0) continue;

      return {
        weight_kg: weight,
        // The top of the range: a first session is for finding a weight you can
        // control, not for testing one.
        reps: options.repRange?.high ?? 10,
        basis: candidate.name,
      };
    }
  }

  return null;
}
