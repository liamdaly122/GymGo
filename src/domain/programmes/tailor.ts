/**
 * Shaping a filled week to the lifter: the muscles they want more of, and the
 * time they have.
 *
 * The brief's generator takes "minutes per session ... priority muscle groups,
 * excluded exercises and injuries". Exclusions happen during the fill, where a
 * slot can still look for something else (`avoidFamilies`). Priorities and
 * time work on the filled week, after any swaps are pinned, so they shape what
 * the lifter actually chose.
 *
 * Pure, and deterministic: the same week and the same options always come out
 * the same.
 */
import type { Muscle } from '../types';
import { estimateDurationMinutes } from '../sessionSummary';
import { blockWeeks, setsForWeek } from './block';
import { WEEKLY_SET_TARGET } from './prescribe';
import {
  weeklySetsPerMuscle,
  type GeneratedPlan,
  type PlannedExercise,
  type PlannedSession,
  type TrimmedLift,
} from './plan';

/** What the builder offers as a time limit, in minutes. */
export const TIME_LIMITS = [30, 45, 60, 75, 90] as const;

/** Muscles a lifter can ask for more of, in the words people use. */
export const PRIORITY_MUSCLES: ReadonlyArray<{ muscle: Muscle; label: string }> = [
  { muscle: 'chest', label: 'Chest' },
  { muscle: 'lats', label: 'Lats' },
  { muscle: 'middle back', label: 'Upper back' },
  { muscle: 'shoulders', label: 'Shoulders' },
  { muscle: 'biceps', label: 'Biceps' },
  { muscle: 'triceps', label: 'Triceps' },
  { muscle: 'quadriceps', label: 'Quads' },
  { muscle: 'hamstrings', label: 'Hamstrings' },
  { muscle: 'glutes', label: 'Glutes' },
  { muscle: 'calves', label: 'Calves' },
  { muscle: 'abdominals', label: 'Abs' },
];

/** More than two priorities is no priority: everything comes first. */
export const MAX_PRIORITIES = 2;

/**
 * Lifts a lifter can rule out, by family (`liftFamily`), so "no deadlifts"
 * means every deadlift. Named the way people say it. There is deliberately no
 * list of injuries mapped to lifts: which movements a bad shoulder tolerates
 * is for the lifter and their physio, not for a rules engine to guess.
 */
export const AVOIDABLE_LIFTS: ReadonlyArray<{ family: string; label: string }> = [
  { family: 'deadlift', label: 'Deadlifts' },
  { family: 'squat', label: 'Squats' },
  { family: 'lunge', label: 'Lunges' },
  { family: 'leg press', label: 'Leg press' },
  { family: 'chest press', label: 'Bench pressing' },
  { family: 'overhead press', label: 'Overhead pressing' },
  { family: 'dip', label: 'Dips' },
  { family: 'pull up', label: 'Pull-ups' },
  { family: 'upright row', label: 'Upright rows' },
  { family: 'olympic', label: 'Olympic lifts' },
  { family: 'good morning', label: 'Good mornings' },
  { family: 'hip thrust', label: 'Hip thrusts' },
];

export interface TailorOptions {
  priorities?: readonly Muscle[];
  /** What the block's hardest week must fit in. Null or absent: no limit. */
  minutes?: number | null;
}

/** The block's hardest week: the most sets added. The deload halves, so it never is. */
const PEAK = blockWeeks().reduce((hardest, week) =>
  setsForWeek(10, week) > setsForWeek(10, hardest) ? week : hardest,
);

/**
 * How long a session runs in the block's hardest week, by the same estimate
 * and the same week shaping the screens use for "about N min".
 */
export function peakMinutes(exercises: readonly PlannedExercise[]): number {
  return estimateDurationMinutes(
    exercises.map((entry) => ({
      sets: setsForWeek(entry.prescription.sets, PEAK),
      restSeconds: entry.prescription.restSeconds,
    })),
  );
}

export function tailorPlan(plan: GeneratedPlan, options: TailorOptions = {}): GeneratedPlan {
  const priorities = new Set(options.priorities ?? []);
  const withPriorities = addPrioritySets(plan, priorities);
  const minutes = options.minutes ?? null;
  if (minutes === null) return withPriorities;
  return {
    ...withPriorities,
    sessions: withPriorities.sessions.map((session) => fitSession(session, minutes, priorities)),
  };
}

/**
 * One more set on every exercise led by a priority muscle, as long as the
 * muscle stays within the goal's weekly ceiling: past 20 sets a week, more is
 * not more.
 */
function addPrioritySets(plan: GeneratedPlan, priorities: ReadonlySet<Muscle>): GeneratedPlan {
  if (priorities.size === 0) return plan;
  const ceiling = WEEKLY_SET_TARGET[plan.goal.profile].high;
  const weekly = new Map(weeklySetsPerMuscle(plan, { includeSecondary: false }));

  return {
    ...plan,
    sessions: plan.sessions.map((session) => ({
      ...session,
      exercises: session.exercises.map((entry) => {
        const muscle = entry.exercise.primary_muscle;
        if (!priorities.has(muscle)) return entry;
        const sets = weekly.get(muscle) ?? 0;
        if (sets + 1 > ceiling) return entry;
        weekly.set(muscle, sets + 1);
        return {
          ...entry,
          prescription: { ...entry.prescription, sets: entry.prescription.sets + 1 },
          prioritySets: (entry.prioritySets ?? 0) + 1,
        };
      }),
    })),
  };
}

/**
 * Cuts a session until its hardest week fits, least important first:
 *
 * 1. the optional accessories, from the end of the session;
 * 2. a set at a time off the secondaries and accessories, down to two, the
 *    longest first, so the cut is spread rather than taken from one lift;
 * 3. the optional secondaries;
 * 4. a set off the main lifts, down to three;
 * 5. and only then the priority muscles' work, which steps 1 to 4 leave
 *    alone: cutting a priority before anything else would undo the point of
 *    choosing it.
 *
 * A main lift is never dropped, and neither is anything swapped in by hand.
 * A session that still runs over says so through `peakMinutes`.
 */
function fitSession(session: PlannedSession, minutes: number, priorities: ReadonlySet<Muscle>): PlannedSession {
  const exercises = [...session.exercises];
  const trimmed = new Map<string, TrimmedLift>();
  const over = () => peakMinutes(exercises) > minutes;

  const drop = (test: (entry: PlannedExercise) => boolean) => {
    while (over()) {
      let at = -1;
      exercises.forEach((entry, index) => {
        if (test(entry)) at = index;
      });
      if (at === -1) return;
      trimmed.set(exercises[at]!.exercise.id, { exercise: exercises[at]!.exercise, cut: 'dropped' });
      exercises.splice(at, 1);
    }
  };

  const shorten = (test: (entry: PlannedExercise) => boolean, floor: number) => {
    while (over()) {
      let at = -1;
      exercises.forEach((entry, index) => {
        if (!test(entry) || entry.prescription.sets <= floor) return;
        if (at === -1 || entry.prescription.sets >= exercises[at]!.prescription.sets) at = index;
      });
      if (at === -1) return;
      const entry = exercises[at]!;
      exercises[at] = { ...entry, prescription: { ...entry.prescription, sets: entry.prescription.sets - 1 } };
      if (!trimmed.has(entry.exercise.id)) trimmed.set(entry.exercise.id, { exercise: entry.exercise, cut: 'shortened' });
    }
  };

  const isPriority = (entry: PlannedExercise) => priorities.has(entry.exercise.primary_muscle);
  const optional = (role: PlannedExercise['slot']['role']) => (entry: PlannedExercise) =>
    entry.slot.role === role && entry.slot.optional === true && !entry.pinned;

  drop((entry) => optional('accessory')(entry) && !isPriority(entry));
  shorten((entry) => entry.slot.role !== 'primary' && !isPriority(entry), 2);
  drop((entry) => optional('secondary')(entry) && !isPriority(entry));
  shorten((entry) => entry.slot.role === 'primary' && !isPriority(entry), 3);
  // Still over: the priorities give way too, in the same order.
  drop(optional('accessory'));
  shorten((entry) => entry.slot.role !== 'primary', 2);
  drop(optional('secondary'));
  shorten((entry) => entry.slot.role === 'primary', 3);

  return { ...session, exercises, trimmed: [...trimmed.values()], peakMinutes: peakMinutes(exercises) };
}
