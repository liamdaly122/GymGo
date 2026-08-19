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
import { findSplit, sessionsFor, type Split, type SplitId } from './splits';
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
