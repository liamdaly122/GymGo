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
import type { Exercise } from '@/db/schema';
import type { Readiness } from './types';
import type { ExerciseSession } from './previousPerformance';
import { isHeavier, isTopWorkingSet } from './sets';
import { loadableWeight, nextLoadableAbove, nextLoadableBelow, type LoadingProfile } from './plates';

export type SuggestionKind = 'add_weight' | 'add_reps' | 'repeat' | 'deload';

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
  repRange: RepRange;
  /** Finished sessions containing this exercise. Order does not matter. */
  history: ExerciseSession[];
  loading: LoadingProfile;
  /** Readiness logged for the session being planned, not a past one. */
  readiness?: Readiness | null;
  /** Block week adjustment, when this session belongs to a training block. */
  week?: WeekAdjustment | null;
}

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

/** How many sessions in a row failed to reach the bottom of the rep range. */
function consecutiveFailures(sessions: ExerciseSession[], repRange: RepRange): number {
  let count = 0;
  for (const session of sessions) {
    const top = heaviestSet(session);
    if (!top || top.reps >= repRange.low) break;
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
export function suggestNextSet(input: ProgressionInput): Suggestion | null {
  const { exercise, repRange, loading } = input;
  const sessions = judgeableSessions(input.history);
  const last = sessions[0];
  const lastTop = last ? heaviestSet(last) : null;
  if (!last || !lastTop) return null;

  const lastWorking = workingSets(last);
  const atSameWeight = lastWorking.filter((set) => set.weight_kg === lastTop.weight_kg);
  const everySetHitTop =
    atSameWeight.length === lastWorking.length &&
    lastWorking.length > 0 &&
    lastWorking.every((set) => set.reps >= repRange.high);

  const failures = consecutiveFailures(sessions, repRange);
  const increment = incrementFor(exercise);

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
  } else if (everySetHitTop) {
    // Brief rule 1: top of the range on every set, so add one increment. The
    // increment is raised to the equipment's own step where that is coarser —
    // 1.25kg on a 5kg cable stack would otherwise round back to no change and
    // stall progression silently.
    weight = Math.max(previousWeight + increment, nextLoadableAbove(previousWeight, loading));
    kind = 'add_weight';
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
    weight *= 0.9;
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

  if (kind === 'deload') {
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
