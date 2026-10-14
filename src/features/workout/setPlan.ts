import type { WorkoutExerciseView } from '@/db/queries';
import type { WorkoutSet } from '@/db/schema';
import type { PreviousPerformance } from '@/domain/previousPerformance';
import type { Suggestion } from '@/domain/progression';
import { isChildSet, latestWorkingSet } from '@/domain/sets';
import { schemeTarget, stepsFromTop } from '@/domain/schemes';
import { CHILD_NAMES } from './setNames';

/** The chip beside the plan line: what the engine wants you to do, in a word. */
export const VERB: Record<string, string> = {
  add_weight: 'Go up',
  add_reps: 'More reps',
  repeat: 'Hold',
  deload: 'Back off',
  estimate: 'Estimate',
};

export const VERB_TONE: Record<string, string> = {
  estimate: 'chip-hot',
  deload: 'chip-warn',
};

/** What a set is meant to be, before anything is typed into it. */
export interface SetPlan {
  /** A drop, rest-pause, myo or cluster piece hanging off another set. */
  child: boolean;
  /** A top-level working set: the only kind a suggestion or last time applies to. */
  hintable: boolean;
  /** Last time's set in the same place, for a working set. */
  lastTime: WorkoutSet | undefined;
  /** For a pyramid's back-off set, how far it sits from the top set. */
  fromTop: number | null;
  /** "Ramp" in a pyramid, "Back-off" otherwise, for a back-off set. */
  schemeRole: 'Ramp' | 'Back-off' | null;
  /** The placeholders: what the set starts at while nothing is typed. */
  weightHint: number | null;
  repsHint: number | null;
  /** "Set 3 of 4", "Warm-up 1 of 3", "Drop · set 2", "Set 3 of 3 · Back-off". */
  label: string;
}

/**
 * The numbers a set starts at, and what it is called.
 *
 * From the second set on the placeholder is the set just done, so the next
 * set is a nudge of a stepper. In order: a pyramid's scheme target, the
 * working set done most recently today, the suggestion, last time. Warm-ups,
 * drops and back-offs are never carried.
 *
 * Shared by the set in hand, which logs it, and the companion screen, which
 * shows what the watch is about to log, so the two cannot disagree.
 */
export function setPlan(
  entry: WorkoutExerciseView,
  set: WorkoutSet,
  ordinal: number,
  suggestion: Suggestion | null | undefined,
  previous: PreviousPerformance | null | undefined,
): SetPlan {
  const child = isChildSet(set);

  // Only a top-level working set is something a suggestion or last time's
  // numbers apply to. A warm-up arrives filled in; a drop carries its weight.
  const hintable = !child && set.type === 'working';
  const lastTime = hintable ? previous?.working_sets[ordinal] : undefined;

  // A pyramid's other sets aim off its top set: lighter and longer the further
  // away they sit. One added by hand off a straight set arrives filled in.
  const technique = entry.workoutExercise.technique;
  const nonWarmups = entry.sets.filter((candidate) => candidate.parent_set_id === null && candidate.type !== 'warmup');
  const fromTop = stepsFromTop(
    technique,
    nonWarmups.map((candidate) => candidate.type),
    nonWarmups.findIndex((candidate) => candidate.id === set.id),
  );
  // Today's top set once it is done — a reverse pyramid's comes first — else
  // what it is meant to be.
  const workingSets = nonWarmups.filter((candidate) => candidate.type === 'working');
  const topSet = technique === 'reverse_pyramid' ? workingSets[0] : workingSets.at(-1);
  const topDone = topSet?.completed && (topSet.weight_kg > 0 || topSet.reps > 0) ? topSet : null;
  const topTarget = topDone ?? suggestion ?? previous?.top_set ?? null;
  const schemeHint = fromTop !== null && topTarget ? schemeTarget(topTarget, fromTop, entry.loading) : null;
  const schemeRole = set.type === 'back_off' ? (technique === 'pyramid' ? 'Ramp' : 'Back-off') : null;

  // From the second set on, the fields start at what was just done: the next
  // set is a nudge of a stepper, not two numbers typed again. The suggestion
  // and last time are for the first.
  const carried = hintable ? latestWorkingSet(entry.sets) : null;
  const weightHint =
    schemeHint?.weight_kg ??
    (hintable ? (carried?.weight_kg ?? suggestion?.weight_kg ?? lastTime?.weight_kg ?? null) : null);
  const repsHint = schemeHint?.reps ?? (hintable ? (carried?.reps ?? suggestion?.reps ?? lastTime?.reps ?? null) : null);

  const warmups = entry.sets.filter((candidate) => candidate.parent_set_id === null && candidate.type === 'warmup');
  const label = child
    ? `${CHILD_NAMES[set.type] ?? 'Continuation'} · set ${ordinal + 1}`
    : set.type === 'warmup'
      ? `Warm-up ${ordinal + 1} of ${warmups.length}`
      : `Set ${ordinal + 1} of ${nonWarmups.length}${schemeRole ? ` · ${schemeRole}` : ''}`;

  return { child, hintable, lastTime, fromTop, schemeRole, weightHint, repsHint, label };
}
