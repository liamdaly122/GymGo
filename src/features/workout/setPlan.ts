import type { WorkoutExerciseView } from '@/db/queries';
import type { WorkoutSet } from '@/db/schema';
import type { StepDown } from '@/domain/carry';
import type { PreviousPerformance } from '@/domain/previousPerformance';
import type { Suggestion } from '@/domain/progression';
import { setHints } from '@/domain/setHints';
import { formatNumber } from './setNames';

/** The chip beside the plan line: what the engine wants you to do, in a word. The watch is sent the same words. */
export { SUGGESTION_VERB as VERB } from '@/domain/progression';

export const VERB_TONE: Record<string, string> = {
  estimate: 'chip-hot',
  deload: 'chip-warn',
};

/**
 * The chip when the set just done fell short of the range and this one starts
 * a notch lighter (`carryForward` in src/domain/carry.ts). The watch's header
 * says the same word. Amber, as "Back off" is: a lighter load, said plainly;
 * blue is for what improved, chalk for the button to press.
 */
export const LIGHTER = 'Lighter';
export const LIGHTER_TONE = 'chip-warn';

/**
 * The plan line beside "Lighter": what fell short, and what the set is now.
 * "5 was under 8, so 90kg for 8." `weight` is the stepped placeholder.
 */
export function stepDownReason(stepDown: StepDown, weight: number): string {
  return `${stepDown.from.reps} was under ${stepDown.repLow}, so ${formatNumber(weight)}kg for ${stepDown.repLow}.`;
}

/**
 * The "Lighter" line's words, or null when it should not show. It describes
 * the stepped placeholders, so it shows only while both fields still show
 * them: once either is typed into (a stepper tap is typing), the numbers on
 * screen, and the ones Done logs, are the lifter's, and the line would claim
 * a weight and reps that are not there. The watch drops its "Lighter" for a
 * typed set too (`carries` is false). The plan line then falls back to what
 * it shows for any other set.
 */
export function lighterReason(plan: Pick<SetPlan, 'hintable' | 'stepDown' | 'weightHint'>, typed: boolean): string | null {
  if (typed || !plan.hintable || !plan.stepDown || plan.weightHint === null) return null;
  return stepDownReason(plan.stepDown, plan.weightHint);
}

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
  /**
   * When the placeholders are the set just done a notch lighter, because it
   * fell short of the range: what it was, and the reps aimed for now. The
   * plan line then says "Lighter" rather than the suggestion's verb, since
   * the numbers on screen are no longer the suggestion's.
   */
  stepDown: StepDown | null;
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
  const { child, hintable, lastTime, fromTop, schemeRole, weightHint, repsHint, stepDown, label } = setHints(
    { technique: entry.workoutExercise.technique, loading: entry.loading, sets: entry.sets, repRange: entry.repRange },
    set,
    ordinal,
    suggestion,
    previous,
  );
  return { child, hintable, lastTime, fromTop, schemeRole, weightHint, repsHint, stepDown, label };
}
