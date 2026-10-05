/**
 * Personal records.
 *
 * The counting rule that matters: child sets are barred from records entirely.
 * A drop set at 40kg must not overwrite a 100kg PR. Warm-ups and incomplete
 * sets are barred for the same reason — only a completed, top-level working set
 * can be a record.
 *
 * This module is the exact inverse of volume.ts, where child sets DO count.
 *
 * Whether something beats what came before is decided once, by `marksBroken`.
 * The finish screen, the session list, the block report and the flash on Done
 * all ask it, so they can never disagree about what a record is.
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

/** What a record can be: a heavier top set, a better estimated max, or more reps with nothing added. */
export type RecordKind = 'weight' | 'e1rm' | 'reps';

/**
 * Where a lift stands, read from its record-eligible sets.
 *
 * Three marks, because three different things can be beaten. Weight and the
 * estimated max are the usual two. The third exists for unloaded bodyweight
 * work: a pull-up with nothing added logs 0kg, which no later set can be
 * heavier than, and Epley has nothing to multiply — so without it, going from
 * eight pull-ups to twelve was never a record.
 */
export interface RecordMarks {
  /** Heaviest top set, in kg. */
  weight: number;
  /** Best estimated 1RM, in kg. Zero when nothing carried any load. */
  e1rm: number;
  /** Most reps in a set at 0kg. */
  unloadedReps: number;
}

/** The marks a group of sets reaches, or null when none of them can be a record. */
export function recordMarks(sets: readonly WorkoutSet[]): RecordMarks | null {
  const eligible = recordEligibleSets([...sets]);
  if (eligible.length === 0) return null;
  const marks: RecordMarks = { weight: 0, e1rm: 0, unloadedReps: 0 };
  for (const set of eligible) {
    marks.weight = Math.max(marks.weight, set.weight_kg);
    marks.e1rm = Math.max(marks.e1rm, estimate1RM(set.weight_kg, set.reps));
    if (set.weight_kg === 0) marks.unloadedReps = Math.max(marks.unloadedReps, set.reps);
  }
  return marks;
}

/** The best of both: what stands once `b` has been done after `a`. */
export function mergeMarks(a: RecordMarks | null, b: RecordMarks | null): RecordMarks | null {
  if (!a) return b;
  if (!b) return a;
  return {
    weight: Math.max(a.weight, b.weight),
    e1rm: Math.max(a.e1rm, b.e1rm),
    unloadedReps: Math.max(a.unloadedReps, b.unloadedReps),
  };
}

/** Nothing done yet. Measuring against it lists what a first session reached. */
const NO_MARKS: RecordMarks = { weight: 0, e1rm: 0, unloadedReps: 0 };

/**
 * Which marks `during` beats `before` on — the one test every record in the
 * app passes through. Strictly beats: equalling a record is not breaking it.
 *
 * Reps count only where neither side carried any load. At 0kg the weight and
 * the estimated max cannot move; anywhere else, more reps at the same weight
 * already raises the estimated max, and counting it twice would double every
 * rep record.
 */
export function marksBroken(during: RecordMarks, before: RecordMarks): RecordKind[] {
  const broken: RecordKind[] = [];
  if (during.weight > before.weight) broken.push('weight');
  if (during.e1rm > 0 && during.e1rm > before.e1rm) broken.push('e1rm');
  if (during.weight === 0 && before.weight === 0 && during.unloadedReps > before.unloadedReps) {
    broken.push('reps');
  }
  return broken;
}

export interface PrHit {
  kind: RecordKind;
  set: WorkoutSet;
  /** The value achieved: kg for weight and e1RM, a rep count for reps. */
  value: number;
  /** What the record was before this session. Null if there was no prior record. */
  previous: number | null;
}

/**
 * Records broken during one session.
 *
 * `priorSets` must exclude the session being judged, or every session trivially
 * ties its own record. A lift's first session lists what it reached with a
 * null `previous` — the finish screen calls that a first, not a record.
 */
export function prsHitInSession(sessionSets: WorkoutSet[], priorSets: WorkoutSet[]): PrHit[] {
  const during = personalRecords(sessionSets);
  const now = recordMarks(sessionSets);
  if (!now || !during.heaviest || !during.bestE1rm) return [];
  const before = recordMarks(priorSets);
  const broken = marksBroken(now, before ?? NO_MARKS);
  const hits: PrHit[] = [];

  if (broken.includes('weight')) {
    hits.push({ kind: 'weight', set: during.heaviest, value: now.weight, previous: before?.weight ?? null });
  }
  if (broken.includes('e1rm')) {
    hits.push({ kind: 'e1rm', set: during.bestE1rm.set, value: during.bestE1rm.value, previous: before?.e1rm ?? null });
  }
  if (broken.includes('reps')) {
    // Every eligible set was at 0kg, so the heaviest is the one with most reps.
    hits.push({ kind: 'reps', set: during.heaviest, value: now.unloadedReps, previous: before?.unloadedReps ?? null });
  }

  return hits;
}

/** One set's record: what it beat, and what stood before it. */
export interface SetRecord {
  kind: RecordKind;
  /** kg for weight and e1RM, a rep count for reps. */
  value: number;
  previous: number;
}

/**
 * Whether one set beats everything before it: every earlier session of the
 * lift (`prior`) and the sets of it already done this session (`earlier`).
 * What the flash on Done and the blue chip read.
 *
 * Null for a first — a lift's first session has nothing to beat, the same
 * rule as `recordsBrokenPerSession` — for a tie, and for any set the record
 * gate refuses, so a drop, a warm-up or a back-off set never flashes. A set
 * that beats more than one mark reports the biggest news: weight, then the
 * estimated max, then reps.
 */
export function setBreaksRecord(
  set: WorkoutSet,
  prior: RecordMarks | null,
  earlier: readonly WorkoutSet[],
): SetRecord | null {
  if (!prior || !isTopWorkingSet(set)) return null;
  const now = recordMarks([set]);
  if (!now) return null;
  const before = mergeMarks(prior, recordMarks(earlier.filter((other) => other.id !== set.id)))!;
  const broken = marksBroken(now, before);
  if (broken.includes('weight')) return { kind: 'weight', value: now.weight, previous: before.weight };
  if (broken.includes('e1rm')) return { kind: 'e1rm', value: now.e1rm, previous: before.e1rm };
  if (broken.includes('reps')) return { kind: 'reps', value: now.unloadedReps, previous: before.unloadedReps };
  return null;
}

/**
 * Which of a session's sets of one lift were records when they were done:
 * each judged against history and the sets ticked before it. Derived rather
 * than remembered, so the chips still light the right sets after a reload.
 */
export function recordSetIds(sets: readonly WorkoutSet[], prior: RecordMarks | null): Set<string> {
  const ids = new Set<string>();
  if (!prior) return ids;
  const done = sets
    .filter(isTopWorkingSet)
    .sort(
      (a, b) =>
        (a.completed_at ?? '').localeCompare(b.completed_at ?? '') || a.set_index - b.set_index,
    );
  done.forEach((set, index) => {
    if (setBreaksRecord(set, prior, done.slice(0, index))) ids.add(set.id);
  });
  return ids;
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
 * everywhere else — `marksBroken` — counted once per exercise, and through the
 * same gate, so a drop set never scores.
 *
 * Kept as running bests rather than calling `prsHitInSession` per row, which
 * would re-read the whole history for every session in the list.
 */
export function recordsBrokenPerSession(sessions: SessionForRecords[]): Map<string, number> {
  const best = new Map<string, RecordMarks>();
  const counts = new Map<string, number>();

  for (const session of sessions) {
    let broken = 0;
    const updates: Array<[string, RecordMarks]> = [];

    for (const { exerciseId, sets } of session.exercises) {
      const during = recordMarks(sets);
      if (!during) continue;
      const before = best.get(exerciseId) ?? null;
      if (before && marksBroken(during, before).length > 0) broken += 1;
      updates.push([exerciseId, mergeMarks(before, during)!]);
    }

    // Applied after the session, so two entries of one lift in a session
    // cannot beat each other.
    for (const [exerciseId, value] of updates) best.set(exerciseId, mergeMarks(best.get(exerciseId) ?? null, value)!);
    counts.set(session.id, broken);
  }

  return counts;
}
