import type { WorkoutExerciseView } from '@/db/queries';
import type { WorkoutSet } from '@/db/schema';
import type { PreviousPerformance } from '@/domain/previousPerformance';
import type { Suggestion } from '@/domain/progression';
import { setHints } from '@/domain/setHints';

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
 * The numbers a set starts at, and what it is called: `setHints`
 * (src/domain/setHints.ts), the one rule shared by the set in hand, which
 * logs it, the companion screen, which shows what the watch is about to log,
 * and the list the watch is sent, so the three cannot disagree.
 */
export function setPlan(
  entry: WorkoutExerciseView,
  set: WorkoutSet,
  ordinal: number,
  suggestion: Suggestion | null | undefined,
  previous: PreviousPerformance | null | undefined,
): SetPlan {
  const { child, hintable, lastTime, fromTop, schemeRole, weightHint, repsHint, label } = setHints(
    { technique: entry.workoutExercise.technique, loading: entry.loading, sets: entry.sets },
    set,
    ordinal,
    suggestion,
    previous,
  );
  return { child, hintable, lastTime, fromTop, schemeRole, weightHint, repsHint, label };
}
