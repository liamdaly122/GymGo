/**
 * Assembles a whole week: goal + split + days in, a set of ready-to-train
 * sessions out.
 *
 * Everything here is pure. The database layer takes the result and writes it
 * out as ordinary routines, which is what keeps this feature clear of the
 * immutability rule — a generated routine is just a routine.
 */
import type { Exercise } from '@/db/schema';
import type { Equipment, ExperienceLevel } from '../types';
import { findGoal, type TrainingGoal, type TrainingGoalId } from './goals';
import { findSplit, sessionsFor, splitsForDays, type Split, type SplitId } from './splits';
import { template, type SessionSlot, type SessionTemplateId } from './templates';
import { prescribe, type Prescription } from './prescribe';
import { fillWeek } from './fill';
import { SECONDARY_MUSCLE_CREDIT } from '../volume';

export interface PlanSelection {
  goalId: TrainingGoalId;
  splitId: SplitId;
  days: number;
}

export interface PlannedExercise {
  exercise: Exercise;
  slot: SessionSlot;
  prescription: Prescription;
}

export interface PlannedSession {
  templateId: SessionTemplateId;
  /** "Push" — or "Push A" and "Push B" when the week runs it twice. */
  name: string;
  dayIndex: number;
  exercises: PlannedExercise[];
  /** Slots this gym could not cover. Shown to the user, not swept away. */
  unfilled: SessionSlot[];
}

export interface GeneratedPlan {
  goal: TrainingGoal;
  split: Split;
  days: number;
  seed: number;
  sessions: PlannedSession[];
  /** Total slots left unfilled across the week. */
  unfilledCount: number;
}

export interface BuildPlanOptions {
  equipment?: Equipment[] | null;
  experience?: ExperienceLevel;
  excludeExerciseIds?: readonly string[];
  seed?: number;
}

export class InvalidPlanSelectionError extends Error {}

/**
 * Labels a rotation, disambiguating a template that appears more than once.
 * A six-day push/pull/legs runs Push twice, and calling both "Push" would be
 * confusing when they hold different exercises.
 */
function labelSessions(ids: SessionTemplateId[]): string[] {
  const totals = new Map<SessionTemplateId, number>();
  for (const id of ids) totals.set(id, (totals.get(id) ?? 0) + 1);

  const seen = new Map<SessionTemplateId, number>();
  return ids.map((id) => {
    const name = template(id).name;
    if ((totals.get(id) ?? 0) < 2) return name;
    const index = (seen.get(id) ?? 0) + 1;
    seen.set(id, index);

    // A letter suffix only works on a name that does not already end in one.
    // The full-body templates are called "Full body A/B/C", so the letter
    // scheme turned a four-day rotation into "Full body A A" and
    // "Full body A B", which reads as a typo rather than a second pass.
    if (/\s[A-Z]$/.test(name)) return index === 1 ? name : `${name} (${index})`;
    return `${name} ${String.fromCharCode(64 + index)}`;
  });
}

export function buildPlan(
  selection: PlanSelection,
  exercises: Exercise[],
  options: BuildPlanOptions = {},
): GeneratedPlan {
  const goal = findGoal(selection.goalId);
  if (!goal) throw new InvalidPlanSelectionError(`Unknown goal ${selection.goalId}`);

  const split = findSplit(selection.splitId);
  if (!split) throw new InvalidPlanSelectionError(`Unknown split ${selection.splitId}`);

  if (!split.daysSupported.includes(selection.days)) {
    throw new InvalidPlanSelectionError(
      `${split.label} does not divide into ${selection.days} days. ` +
        `It supports ${split.daysSupported.join(', ')}.`,
    );
  }

  const ids = sessionsFor(split.id, selection.days);
  const names = labelSessions(ids);
  const seed = options.seed ?? 0;

  const results = fillWeek(
    ids.map((id) => template(id)),
    exercises,
    {
      ...(options.equipment !== undefined ? { equipment: options.equipment } : {}),
      ...(options.experience ? { experience: options.experience } : {}),
      ...(options.excludeExerciseIds ? { excludeExerciseIds: options.excludeExerciseIds } : {}),
      seed,
    },
  );

  const sessions: PlannedSession[] = results.map((result, dayIndex) => ({
    templateId: result.template.id,
    name: names[dayIndex] ?? result.template.name,
    dayIndex,
    unfilled: result.unfilled,
    exercises: result.filled.map((entry) => ({
      exercise: entry.exercise,
      slot: entry.slot,
      prescription: prescribe(goal.profile, entry.slot.role, {
        isCompound: entry.exercise.is_compound,
        restMultiplier: goal.restMultiplier,
      }),
    })),
  }));

  return {
    goal,
    split,
    days: selection.days,
    seed,
    sessions,
    unfilledCount: sessions.reduce((total, session) => total + session.unfilled.length, 0),
  };
}

/**
 * Weekly sets per muscle.
 *
 * Two readings, because they answer different questions:
 *
 * - `includeSecondary: true` (default) credits the primary muscle in full and
 *   each secondary at a half, matching how the rest of the app counts volume.
 *   This is the richer picture and what the UI shows.
 * - `includeSecondary: false` counts direct work only. This is what the
 *   published volume landmarks actually measure, so it is the number to check a
 *   plan against the brief's 10-20 target with.
 *
 * Counting primary muscles alone would otherwise misread a plan badly: a
 * deadlift is filed under "lower back" in the source data, so a leg day built
 * around hinges looks like it trains almost no hamstrings.
 */
export function weeklySetsPerMuscle(
  plan: GeneratedPlan,
  options: { includeSecondary?: boolean; roles?: readonly SessionSlot['role'][] } = {},
): Map<string, number> {
  const includeSecondary = options.includeSecondary ?? true;
  const roles = options.roles;
  const totals = new Map<string, number>();
  const add = (muscle: string, amount: number) =>
    totals.set(muscle, (totals.get(muscle) ?? 0) + amount);

  for (const session of plan.sessions) {
    for (const entry of session.exercises) {
      if (roles && !roles.includes(entry.slot.role)) continue;
      add(entry.exercise.primary_muscle, entry.prescription.sets);
      if (!includeSecondary) continue;
      for (const secondary of entry.exercise.secondary_muscles) {
        add(secondary, entry.prescription.sets * SECONDARY_MUSCLE_CREDIT);
      }
    }
  }
  return totals;
}

export interface PlanViability {
  viable: boolean;
  unfilledCount: number;
  /** Fewest exercises any one session came out with. */
  thinnestSession: number;
  /** Plain-English reason when a plan is not workable at this gym. */
  reason: string | null;
}

/** A session with fewer than this is not a session, it is a warm-up. */
const MIN_EXERCISES_PER_SESSION = 4;

/**
 * Whether a plan is actually workable at the gym it was built for.
 *
 * This exists because some combinations are genuinely impossible rather than
 * merely thin: a five-day body-part split needs isolation work for every muscle
 * on its own day, and a garage with a barbell cannot supply chest isolation at
 * all. Telling someone that up front beats handing them a Chest day with three
 * exercises on it.
 */
export function assessPlan(plan: GeneratedPlan): PlanViability {
  const thinnest = plan.sessions.reduce(
    (fewest, session) => Math.min(fewest, session.exercises.length),
    Number.POSITIVE_INFINITY,
  );

  const starved = plan.sessions.filter(
    (session) => session.exercises.length < MIN_EXERCISES_PER_SESSION,
  );

  if (starved.length > 0) {
    const names = starved.map((session) => session.name).join(', ');
    return {
      viable: false,
      unfilledCount: plan.unfilledCount,
      thinnestSession: thinnest,
      reason:
        `Your gym cannot fill ${starved.length === 1 ? 'this session' : 'these sessions'}: ` +
        `${names}. ${plan.split.label} needs more variety of equipment than you have — ` +
        `full body or upper/lower will work better.`,
    };
  }

  return {
    viable: true,
    unfilledCount: plan.unfilledCount,
    thinnestSession: thinnest,
    reason: null,
  };
}

/** Splits that are actually workable at this gym, for the day count given. */
export function workableSplits(
  days: number,
  exercises: Exercise[],
  options: BuildPlanOptions = {},
): Array<{ splitId: SplitId; viability: PlanViability }> {
  return splitsForDays(days).map((split) => {
    const plan = buildPlan(
      { goalId: 'build_muscle', splitId: split.id, days },
      exercises,
      options,
    );
    return { splitId: split.id, viability: assessPlan(plan) };
  });
}
