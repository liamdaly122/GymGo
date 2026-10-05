/**
 * Why the builder picked each exercise, in a sentence.
 *
 * The brief: "A local rules engine, not a black box. It must be able to
 * explain each choice in plain English." The reason is built from what the
 * fill actually weighs — the slot's job, the staples list, the barbell
 * preference for main lifts, a fallback when the kit runs out — so it is the
 * real reason rather than a story told afterwards.
 *
 * Pure.
 */
import type { ExperienceLevel, MovementPattern } from '../types';
import type { PlannedExercise } from './plan';
import { stapleTier } from './staples';

const ROLE = { primary: 'Main lift', secondary: 'Second lift', accessory: 'Accessory' } as const;

const JOB: Record<MovementPattern, string> = {
  squat: 'a squat',
  hinge: 'a hip hinge',
  lunge: 'a single-leg movement',
  horizontal_push: 'a press',
  vertical_push: 'an overhead press',
  horizontal_pull: 'a row',
  vertical_pull: 'a vertical pull',
  carry: 'a carry',
  core: 'core work',
  isolation: 'isolation work',
};

function jobOf(pattern: MovementPattern, muscle: string): string {
  if (pattern === 'core') return 'core work';
  return `${JOB[pattern]} for ${muscle}`;
}

export function explainPick(entry: PlannedExercise, context: { experience?: ExperienceLevel } = {}): string {
  const { exercise, slot } = entry;
  const muscle = slot.muscle ?? exercise.primary_muscle;

  let why: string;
  if (entry.pinned) {
    why = 'your swap';
  } else if (exercise.movement_pattern !== slot.pattern) {
    const wanted = slot.pattern === 'isolation' ? `${muscle} isolation` : JOB[slot.pattern];
    why = `nothing in your kit does ${wanted}, so ${JOB[exercise.movement_pattern]} instead`;
  } else if (
    slot.role === 'primary' &&
    slot.compoundOnly &&
    (exercise.equipment === 'barbell' || exercise.equipment === 'ez_bar')
  ) {
    why = 'on a barbell, which loads in the smallest steps';
  } else {
    const tier = stapleTier(exercise.source_id, exercise.name);
    why = tier === 'staple' ? 'a standard pick for the job' : tier === 'common' ? 'a common pick for the job' : 'the closest match your kit has';
  }

  const extras: string[] = [];
  if (context.experience === 'beginner' && exercise.experience_level === 'beginner' && !entry.pinned) {
    extras.push('simple to learn');
  }
  if (entry.prioritySets) {
    extras.push(`+${entry.prioritySets} set because ${exercise.primary_muscle} is a priority`);
  }

  const reasons = [why, ...extras].join('; ');
  return `${ROLE[slot.role]}: ${jobOf(slot.pattern, muscle)}. ${reasons.charAt(0).toUpperCase()}${reasons.slice(1)}.`;
}
