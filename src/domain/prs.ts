/**
 * Personal records.
 *
 * The counting rule that matters: child sets are barred from records entirely.
 * A drop set at 40kg must not overwrite a 100kg PR. Warm-ups and incomplete
 * sets are barred for the same reason — only a completed, top-level working set
 * can be a record.
 *
 * This module is the exact inverse of volume.ts, where child sets DO count.
 */
import type { WorkoutSet } from '@/db/schema';
import { estimate1RM } from './epley';
import { isHeavier, isTopWorkingSet } from './sets';

export interface PersonalRecords {
  /** Heaviest top working set ever performed. Reps break a tie. */
  heaviest: WorkoutSet | null;
  /** Best estimated 1RM, and the set that produced it. */
  bestE1rm: { set: WorkoutSet; value: number } | null;
  /** Most reps performed at the heaviest weight. */
  bestRepsAtTopWeight: WorkoutSet | null;
}

/** Every set eligible to be a record. The single gate all PR logic passes through. */
export function recordEligibleSets(sets: WorkoutSet[]): WorkoutSet[] {
  return sets.filter(isTopWorkingSet);
}

export function personalRecords(sets: WorkoutSet[]): PersonalRecords {
  const eligible = recordEligibleSets(sets);
  if (eligible.length === 0) {
    return { heaviest: null, bestE1rm: null, bestRepsAtTopWeight: null };
  }

  let heaviest = eligible[0]!;
  let bestE1rm = { set: eligible[0]!, value: estimate1RM(eligible[0]!.weight_kg, eligible[0]!.reps) };

  for (const set of eligible) {
    if (isHeavier(set, heaviest)) heaviest = set;
    const value = estimate1RM(set.weight_kg, set.reps);
    if (value > bestE1rm.value) bestE1rm = { set, value };
  }

  const topWeight = heaviest.weight_kg;
  const bestRepsAtTopWeight = eligible
    .filter((set) => set.weight_kg === topWeight)
    .reduce<WorkoutSet | null>(
      (best, set) => (best === null || set.reps > best.reps ? set : best),
      null,
    );

  return { heaviest, bestE1rm, bestRepsAtTopWeight };
}

export interface PrHit {
  kind: 'weight' | 'e1rm';
  set: WorkoutSet;
  /** The value achieved: kg for a weight PR, estimated kg for an e1RM PR. */
  value: number;
  /** What the record was before this session. Null if there was no prior record. */
  previous: number | null;
}

/**
 * Records broken during one session.
 *
 * `priorSets` must exclude the session being judged, or every session trivially
 * ties its own record.
 */
export function prsHitInSession(sessionSets: WorkoutSet[], priorSets: WorkoutSet[]): PrHit[] {
  const before = personalRecords(priorSets);
  const during = personalRecords(sessionSets);
  const hits: PrHit[] = [];

  if (during.heaviest) {
    const previous = before.heaviest?.weight_kg ?? null;
    if (previous === null || during.heaviest.weight_kg > previous) {
      hits.push({ kind: 'weight', set: during.heaviest, value: during.heaviest.weight_kg, previous });
    }
  }

  if (during.bestE1rm) {
    const previous = before.bestE1rm?.value ?? null;
    if (previous === null || during.bestE1rm.value > previous) {
      hits.push({
        kind: 'e1rm',
        set: during.bestE1rm.set,
        value: during.bestE1rm.value,
        previous,
      });
    }
  }

  return hits;
}

export interface SessionForRecords {
  id: string;
  /** Each exercise in the session with the sets performed on it. */
  exercises: Array<{ exerciseId: string; sets: WorkoutSet[] }>;
}

/**
 * How many records each session broke, for a list of sessions.
 *
 * Sessions must arrive oldest first. A record only counts when there was one
 * to beat: an exercise's first ever session is a first, not a record, or every
 * new lift in a list would read as a PR. Within that, it is the same test as
 * `prsHitInSession` — heaviest top set, then best estimated 1RM — counted once
 * per exercise, and through the same gate, so a drop set never scores.
 *
 * Kept as running bests rather than calling `prsHitInSession` per row, which
 * would re-read the whole history for every session in the list.
 */
export function recordsBrokenPerSession(sessions: SessionForRecords[]): Map<string, number> {
  const best = new Map<string, { weight: number; e1rm: number }>();
  const counts = new Map<string, number>();

  for (const session of sessions) {
    let broken = 0;
    const updates: Array<[string, { weight: number; e1rm: number }]> = [];

    for (const { exerciseId, sets } of session.exercises) {
      const during = personalRecords(sets);
      if (!during.heaviest || !during.bestE1rm) continue;
      const weight = during.heaviest.weight_kg;
      const e1rm = during.bestE1rm.value;
      const before = best.get(exerciseId);
      if (before && (weight > before.weight || e1rm > before.e1rm)) broken += 1;
      updates.push([
        exerciseId,
        { weight: Math.max(weight, before?.weight ?? 0), e1rm: Math.max(e1rm, before?.e1rm ?? 0) },
      ]);
    }

    // Applied after the session, so two entries of one lift in a session
    // cannot beat each other.
    for (const [exerciseId, value] of updates) best.set(exerciseId, value);
    counts.set(session.id, broken);
  }

  return counts;
}
