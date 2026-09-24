/**
 * What to lift next.
 *
 * Double progression, per the brief: hold the weight and climb the rep range,
 * then add one increment and drop back to the bottom. Every suggestion carries a
 * plain-English `reason`, because the brief requires the app to be able to
 * explain each choice — a number with no justification is something you ignore.
 *
 * Suggestions are never enforced. They arrive as placeholders in an empty set
 * row and are overwritten by whatever you actually do.
 */
import type { Exercise, WorkoutSet } from '@/db/schema';
import type { Readiness } from './types';
import type { ExerciseSession } from './previousPerformance';
import { isHeavier, isTopWorkingSet } from './sets';
import { loadableWeight, nextLoadableAbove, nextLoadableBelow, type LoadingProfile } from './plates';

export type SuggestionKind = 'add_weight' | 'add_reps' | 'repeat' | 'deload' | 'estimate';

export interface Suggestion {
  weight_kg: number;
  reps: number;
  kind: SuggestionKind;
  /** Shown under the set row. Plain English, no jargon. */
  reason: string;
  /** Whether low readiness or a deload week pulled the load down. */
  scaled_down: boolean;
}

export interface RepRange {
  low: number;
  high: number;
}

export interface WeekAdjustment {
  loadMultiplier: number;
  isDeload: boolean;
}

export interface ProgressionInput {
  exercise: Exercise;
  /**
   * The range the session prescribes. Null for a freestyle workout, where
   * nothing was prescribed — and where the deload rule therefore cannot apply,
   * since there is no target to have fallen short of.
   */
  repRange: RepRange | null;
  /** Finished sessions containing this exercise. Order does not matter. */
  history: ExerciseSession[];
  loading: LoadingProfile;
  /** Readiness logged for the session being planned, not a past one. */
  readiness?: Readiness | null;
  /** Block week adjustment, when this session belongs to a training block. */
  week?: WeekAdjustment | null;
}

/**
 * Brief rule 5: a session logged as low readiness carries 10% less load.
 *
 * Exported because the cold-start estimate has to apply the same rule. A bad
 * day that moved the numbers on lifts you have done and left the new ones
 * alone would make the control look broken, and re-typing 0.9 at the second
 * call site is how the two drift apart.
 */
export const LOW_READINESS_MULTIPLIER = 0.9;

/** The brief's defaults: 2.5kg for lower-body compounds, 1.25kg for everything else. */
const LOWER_BODY_PATTERNS = new Set(['squat', 'hinge', 'lunge']);
const LOWER_BODY_MUSCLES = new Set(['quadriceps', 'hamstrings', 'glutes', 'calves', 'adductors', 'abductors']);

export function incrementFor(exercise: Exercise): number {
  if (exercise.increment_kg !== null && exercise.increment_kg > 0) return exercise.increment_kg;
  const isLowerBody =
    LOWER_BODY_PATTERNS.has(exercise.movement_pattern) || LOWER_BODY_MUSCLES.has(exercise.primary_muscle);
  return exercise.is_compound && isLowerBody ? 2.5 : 1.25;
}

/** Top working sets only — a drop set can never drive a suggestion. */
function workingSets(session: ExerciseSession) {
  return session.sets.filter(isTopWorkingSet);
}

function heaviestSet(session: ExerciseSession) {
  const sets = workingSets(session);
  if (sets.length === 0) return null;
  return sets.reduce((best, set) => (isHeavier(set, best) ? set : best), sets[0]!);
}

/**
 * Sessions worth judging, newest first.
 *
 * A session logged on a bad day is skipped entirely: the brief says a low
 * readiness session must not count toward the failure counter, and letting it
 * through would trigger deloads off the back of one rough night's sleep.
 */
function judgeableSessions(history: ExerciseSession[]): ExerciseSession[] {
  return history
    .filter((session) => workingSets(session).length > 0)
    .filter((session) => session.readiness !== 'low')
    .sort((a, b) => Date.parse(b.performed_at) - Date.parse(a.performed_at));
}

/**
 * How many sessions in a row fell short of the bottom of the rep range.
 *
 * Judged on ALL of a session's working sets, not just its heaviest. Reading
 * only the heaviest read a successful session as a failure: work up to a top
 * single at 120kg for 3, then do four back-off sets of 10 at 100kg, and a
 * range of 8-12 was "failed" on the strength of the single — even though every
 * set that was actually a working set cleared the range comfortably.
 *
 * Deliberately weight-blind, per the brief: "fail to reach the bottom of the
 * rep range on the same exercise in two consecutive sessions". Backing off and
 * still missing is evidence the lift needs a deload, not evidence of a
 * different lift.
 */
function consecutiveFailures(sessions: ExerciseSession[], repRange: RepRange): number {
  let count = 0;
  for (const session of sessions) {
    const sets = workingSets(session);
    if (sets.length === 0) break;
    if (sets.some((set) => set.reps >= repRange.low)) break;
    count += 1;
  }
  return count;
}

function formatWeight(kg: number): string {
  return Number.isInteger(kg) ? `${kg}kg` : `${kg.toFixed(2).replace(/0+$/, '').replace(/\.$/, '')}kg`;
}

/**
 * The next set to aim for, or null when there is no history to reason from.
 *
 * Null rather than a guess: inventing a starting weight for a lift you have
 * never done is worse than saying nothing, because it looks authoritative.
 */
/**
 * How much was left in the tank — but only when the lifter actually said.
 *
 * Two things make a reading untrustworthy, and both are common.
 *
 * Beginner mode never logs RIR at all, so null is the normal case and every
 * rule built on this has to fall through to the unaided behaviour.
 *
 * And plan sessions used to arrive with the block week's PRESCRIBED rir already
 * stamped on every set. Those rows are still in the database. An identical
 * value across every set is the fingerprint of that stamping — nobody assesses
 * four sets and finds exactly the same answer each time — so it is not read
 * back. The cost is that a genuinely uniform session is ignored, which errs
 * conservative, and conservative is the only safe direction for a number the
 * lifter reports about themselves.
 *
 * AMRAP sets are excluded: an open-ended set is taken to failure by definition,
 * so its RIR says nothing about how the prescribed work felt.
 */
function loggedRir(sets: WorkoutSet[]): number | null {
  const assessed = sets.filter((set) => !set.is_amrap);
  if (assessed.length < 2) return null;
  if (assessed.some((set) => set.rir === null)) return null;

  const values = assessed.map((set) => set.rir!);
  if (new Set(values).size === 1) return null;

  // The easiest set flatters the session; take the hardest reading.
  return Math.min(...values);
}

/** By how much an open-ended final set beat the top of the range. */
function amrapOvershoot(sets: WorkoutSet[], repRange: RepRange): number {
  const amrap = sets.filter((set) => set.is_amrap);
  if (amrap.length === 0) return 0;
  return Math.max(0, Math.max(...amrap.map((set) => set.reps)) - repRange.high);
}

/** Two increments rather than one, when the evidence says the jump was earned. */
const BIG_JUMP_RIR = 3;
const BIG_JUMP_AMRAP_OVERSHOOT = 3;

export function suggestNextSet(input: ProgressionInput): Suggestion | null {
  const { exercise, loading } = input;
  const prescribed = input.repRange;
  const sessions = judgeableSessions(input.history);
  const last = sessions[0];
  const lastTop = last ? heaviestSet(last) : null;
  if (!last || !lastTop) return null;

  const lastWorking = workingSets(last);

  /*
   * With no prescribed range, judge against what was actually done last time:
   * matching every set at that weight is the thing to beat.
   *
   * Built from the heaviest NON-AMRAP set, because an open-ended set is not a
   * target. Take one to 15 and a range built from it would demand 15 reps of
   * every set forever — a target nobody set, that gets harder the better the
   * session went.
   */
  const closed = lastWorking.filter((set) => !set.is_amrap);
  const closedTop =
    closed.length > 0
      ? closed.reduce((best, set) => (isHeavier(set, best) ? set : best), closed[0]!)
      : null;
  const repRange: RepRange =
    prescribed ?? { low: (closedTop ?? lastTop).reps, high: (closedTop ?? lastTop).reps };

  // An open-ended set cannot show you held the top of the range: it was taken
  // to failure by definition, so it says nothing about the prescribed work.
  const judged = closed.length > 0 ? closed : lastWorking;
  const atSameWeight = judged.filter((set) => set.weight_kg === lastTop.weight_kg);
  const everySetHitTop =
    atSameWeight.length === judged.length &&
    judged.length > 0 &&
    judged.every((set) => set.reps >= repRange.high);

  // No prescription, no failure: you cannot fall short of a target nobody set.
  const failures = prescribed ? consecutiveFailures(sessions, prescribed) : 0;

  /*
   * What the lifter told us about last session, beyond the numbers.
   *
   * Both are logged today and neither was ever read back. They only ever make
   * the suggestion braver or more cautious by one step, and both are absent in
   * Beginner mode, so the unaided behaviour is the default rather than a
   * fallback.
   */
  const rir = loggedRir(lastWorking);
  const overshoot = prescribed ? amrapOvershoot(lastWorking, prescribed) : 0;
  const earnedBigJump = (rir !== null && rir >= BIG_JUMP_RIR) || overshoot >= BIG_JUMP_AMRAP_OVERSHOOT;
  const atFailure = rir === 0;

  const increment = incrementFor(exercise);
  let signalNote = '';

  const previousWeight = lastTop.weight_kg;
  let weight = previousWeight;
  let reps = repRange.low;
  let kind: SuggestionKind;
  let goingLighter = false;

  if (failures >= 2) {
    // Brief rule 3: two sessions short of the bottom of the range, back off 10%.
    // Floored to the next weight down so a 10% cut on a coarse machine cannot
    // round back to the weight that was already too heavy.
    weight = Math.min(previousWeight * 0.9, nextLoadableBelow(previousWeight, loading));
    kind = 'deload';
    goingLighter = true;
  } else if (everySetHitTop && atFailure) {
    // Top of the range, but the last set went to failure to get there. Adding
    // load now books a failure next session; own this weight first.
    kind = 'repeat';
    reps = repRange.high;
    signalNote = ' The last set went to failure, so own this weight before adding.';
  } else if (everySetHitTop) {
    // Brief rule 1: top of the range on every set, so add one increment. The
    // increment is raised to the equipment's own step where that is coarser —
    // 1.25kg on a 5kg cable stack would otherwise round back to no change and
    // stall progression silently.
    //
    // Two increments when you finished with reps to spare: hitting the top of
    // the range at RIR 3, or running an AMRAP well past it, means one step is
    // leaving progress on the table.
    weight = Math.max(previousWeight + increment, nextLoadableAbove(previousWeight, loading));
    // A second step taken the same way, so a coarse stack moves a real notch
    // rather than an arithmetic one that rounds back.
    if (earnedBigJump) weight = Math.max(weight + increment, nextLoadableAbove(weight, loading));
    kind = 'add_weight';
    if (earnedBigJump) {
      signalNote =
        rir !== null && rir >= BIG_JUMP_RIR
          ? ` You logged ${rir} left in the tank, so this is a double jump.`
          : ` Your AMRAP beat the range by ${overshoot}, so this is a double jump.`;
    }
  } else if (atFailure && lastTop.reps < repRange.low) {
    // Nothing left and still short of the range. Adding weight now would only
    // book another failure; hold and earn the reps first.
    kind = 'add_reps';
    reps = repRange.low;
    signalNote = ' You logged nothing left in the tank, so hold here for now.';
  } else if (lastTop.reps >= repRange.high) {
    kind = 'add_reps';
    reps = lastTop.reps;
  } else {
    kind = 'add_reps';
    reps = Math.min(repRange.high, lastTop.reps + 1);
  }

  // Brief rule 5: a bad day scales the load, and only for this session.
  let scaledDown = false;
  if (input.readiness === 'low') {
    weight *= LOW_READINESS_MULTIPLIER;
    scaledDown = true;
    goingLighter = true;
  }

  if (input.week?.isDeload) {
    weight *= input.week.loadMultiplier;
    scaledDown = true;
    goingLighter = true;
  } else if (input.week && input.week.loadMultiplier !== 1) {
    weight *= input.week.loadMultiplier;
  }

  // Brief rule 2: never suggest a weight this gym cannot make. A deload errs
  // light; everything else snaps to whichever loadable weight is closest.
  weight = loadableWeight(weight, loading, goingLighter ? { direction: 'down' } : {});

  // The reason is written from the weight that actually came out, never from
  // what was asked for, so it can never claim a jump the suggestion did not make.
  const delta = Math.round((weight - previousWeight) * 100) / 100;
  let reason: string;

  if (kind === 'repeat') {
    reason = `You hit ${repRange.high} on every set at ${formatWeight(previousWeight)}.`;
  } else if (kind === 'deload') {
    reason = `Short of ${repRange.low} reps twice running. Down to ${formatWeight(weight)} and build back up.`;
  } else if (kind === 'add_weight') {
    reason =
      delta > 0
        ? `You hit ${repRange.high} on every set at ${formatWeight(previousWeight)}. Add ${formatWeight(delta)}.`
        : `You hit ${repRange.high} on every set at ${formatWeight(previousWeight)}. Hold here and add reps.`;
  } else if (reps === lastTop.reps) {
    reason = `Match ${formatWeight(previousWeight)} × ${reps} on every set to earn the next jump.`;
  } else {
    reason = `Last time ${formatWeight(previousWeight)} × ${lastTop.reps}. Go for ${reps}.`;
  }

  reason += signalNote;
  if (input.readiness === 'low') reason += ' Scaled down 10% because you logged low readiness.';
  if (input.week?.isDeload) reason += ' Deload week — lighter on purpose.';

  return {
    weight_kg: weight,
    reps: Math.max(1, Math.round(reps)),
    kind,
    reason,
    scaled_down: scaledDown,
  };
}
