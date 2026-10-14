/**
 * What a set is meant to be before anything is typed into it: the numbers it
 * starts at, and what it is called.
 *
 * One rule, read in three places: the phone's set in hand, which logs it; the
 * companion screen, which shows what the watch is about to log; and the list
 * the watch is sent (`buildWatchSnapshot`), which the watch logs from. Worked
 * out separately, the list once treated a set with only its reps typed as
 * fully typed and sent 0kg, so the watch logged a barbell squat at nothing
 * while the phone showed the suggested weight.
 *
 * From the second set on the placeholder is the set just done, so the next
 * set is a nudge of a stepper. In order: a pyramid's scheme target, the
 * working set done most recently today (a notch lighter for the bottom of the
 * range when it fell short of it: `carryForward` in carry.ts), the
 * suggestion, last time. Warm-ups, drops and back-offs are never carried.
 *
 * Pure.
 */
import type { WorkoutSet } from '@/db/schema';
import { carryForward, type StepDown } from './carry';
import type { LoadingProfile } from './plates';
import type { PreviousPerformance } from './previousPerformance';
import type { RepRange } from './progression';
import { schemeTarget, stepsFromTop } from './schemes';
import { CHILD_NAMES, isChildSet } from './sets';
import type { Technique } from './types';

/**
 * Where a placeholder came from. `stepped` is the set just done, a notch
 * lighter because it fell short of the range; `carried` is it as done.
 */
export type HintSource = 'scheme' | 'carried' | 'stepped' | 'suggestion' | 'last';

export interface SetHints {
  /** A drop, rest-pause, myo or cluster piece hanging off another set. */
  child: boolean;
  /** A top-level working set: the only kind a suggestion or last time applies to. */
  hintable: boolean;
  /** Last time's set in the same place, for a working set. */
  lastTime: WorkoutSet | undefined;
  /** For a pyramid's back-off set, how far it sits from the top set. */
  fromTop: number | null;
  /** The working set a pyramid's back-off sets aim off. */
  topSet: WorkoutSet | undefined;
  /** "Ramp" in a pyramid, "Back-off" otherwise, for a back-off set. */
  schemeRole: 'Ramp' | 'Back-off' | null;
  /** The placeholders: what the set starts at while nothing is typed. */
  weightHint: number | null;
  repsHint: number | null;
  /** Where each placeholder came from; null where there is none. */
  weightSource: HintSource | null;
  repsSource: HintSource | null;
  /**
   * When the placeholders are the set just done stepped down a notch (source
   * `stepped`): what that set was, and the bottom of the range it missed.
   * "5 was under 8, so 90kg for 8." Null otherwise.
   */
  stepDown: StepDown | null;
  /** "Set 3 of 4", "Warm-up 1 of 3", "Drop · set 2", "Set 3 of 3 · Back-off". */
  label: string;
}

/** The exercise a set belongs to, as much of it as the rule reads. */
export interface HintEntry {
  technique: Technique;
  loading: LoadingProfile;
  /** Its live sets, in set order. */
  sets: readonly WorkoutSet[];
  /** The range the routine prescribes, for the step-down. Null for freestyle. */
  repRange: RepRange | null;
}

type Numbers = { weight_kg: number; reps: number };

export function setHints(
  entry: HintEntry,
  set: WorkoutSet,
  ordinal: number,
  suggestion: Numbers | null | undefined,
  previous: PreviousPerformance | null | undefined,
): SetHints {
  const child = isChildSet(set);

  // Only a top-level working set is something a suggestion or last time's
  // numbers apply to. A warm-up arrives filled in; a drop carries its weight.
  const hintable = !child && set.type === 'working';
  const lastTime = hintable ? previous?.working_sets[ordinal] : undefined;

  // A pyramid's other sets aim off its top set: lighter and longer the further
  // away they sit. One added by hand off a straight set arrives filled in.
  const technique = entry.technique;
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
  // set is a nudge of a stepper, not two numbers typed again. A notch lighter
  // when it fell short of the range. The suggestion and last time are for the
  // first.
  const carried = hintable ? carryForward(entry.sets, entry.repRange?.low ?? null, entry.loading) : null;
  const candidates: Array<[HintSource, Numbers | null | undefined]> = hintable
    ? [['scheme', schemeHint], [carried?.stepped ? 'stepped' : 'carried', carried], ['suggestion', suggestion], ['last', lastTime]]
    : [['scheme', schemeHint]];
  const first = (field: keyof Numbers) => candidates.find(([, numbers]) => numbers != null && numbers[field] != null);
  const weightFrom = first('weight_kg');
  const repsFrom = first('reps');

  const warmups = entry.sets.filter((candidate) => candidate.parent_set_id === null && candidate.type === 'warmup');
  const label = child
    ? `${CHILD_NAMES[set.type] ?? 'Continuation'} · set ${ordinal + 1}`
    : set.type === 'warmup'
      ? `Warm-up ${ordinal + 1} of ${warmups.length}`
      : `Set ${ordinal + 1} of ${nonWarmups.length}${schemeRole ? ` · ${schemeRole}` : ''}`;

  return {
    child,
    hintable,
    lastTime,
    fromTop,
    topSet,
    schemeRole,
    weightHint: weightFrom?.[1]?.weight_kg ?? null,
    repsHint: repsFrom?.[1]?.reps ?? null,
    weightSource: weightFrom?.[0] ?? null,
    repsSource: repsFrom?.[0] ?? null,
    stepDown: weightFrom?.[0] === 'stepped' || repsFrom?.[0] === 'stepped' ? (carried?.stepped ?? null) : null,
    label,
  };
}

/**
 * The numbers a set will be logged at: each field what was typed into it if
 * anything was, else its placeholder, decided field by field. Unloaded
 * bodyweight work with no placeholder starts at zero. `weightTyped` and
 * `repsTyped` say which came from the set itself.
 */
export function startingNumbers(
  set: Pick<WorkoutSet, 'weight_kg' | 'reps'>,
  hints: Pick<SetHints, 'weightHint' | 'repsHint'>,
  bodyweight: boolean,
): { weight: number | null; reps: number | null; weightTyped: boolean; repsTyped: boolean } {
  const weightTyped = set.weight_kg > 0;
  const repsTyped = set.reps > 0;
  return {
    weight: weightTyped ? set.weight_kg : (hints.weightHint ?? (bodyweight ? 0 : null)),
    reps: repsTyped ? set.reps : hints.repsHint,
    weightTyped,
    repsTyped,
  };
}
