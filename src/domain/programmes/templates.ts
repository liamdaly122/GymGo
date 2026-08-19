/**
 * Session templates, defined by movement pattern rather than by named exercise.
 *
 * This is the brief's model for the generator, and it is what lets one template
 * serve a commercial gym and a garage with a pair of dumbbells: the slot says
 * "a horizontal press", and the filler finds the best one the gym can offer.
 * Hard-coding exercise ids would break on a reseed and would hand a home lifter
 * a plan they cannot perform.
 *
 * Slot viability was measured against the real seed data, not assumed. Some
 * combinations are genuinely thin — a dumbbell-only gym has NO hamstring
 * isolation at all — so slots that can go unfilled say so explicitly.
 */
import type { MovementPattern, Muscle } from '../types';

export interface SessionSlot {
  pattern: MovementPattern;
  /**
   * Drives the prescription: how many sets, what rep range, how long to rest.
   * Primaries come first in the session, when you are freshest.
   */
  role: 'primary' | 'secondary' | 'accessory';
  /** Restrict to compound lifts. Set on the slots where that is the point. */
  compoundOnly?: boolean;
  /** Preferred primary muscle. A ranking boost unless `requireMuscle` is set. */
  muscle?: Muscle;
  /**
   * Only accept the named muscle. Paired with `optional`, this means "the right
   * muscle or nothing" — better an absent calf slot than a bicep curl on leg day.
   */
  requireMuscle?: boolean;
  /** Patterns to try when the primary one cannot be filled at this gym. */
  fallback?: MovementPattern[];
  /** Droppable. Accessories are; the lifts a session is built around are not. */
  optional?: boolean;
}

export interface SessionTemplate {
  id: SessionTemplateId;
  name: string;
  slots: SessionSlot[];
}

export type SessionTemplateId =
  | 'fb_a' | 'fb_b' | 'fb_c'
  | 'upper_a' | 'lower_a' | 'upper_b' | 'lower_b'
  | 'push' | 'pull' | 'legs'
  | 'bro_chest' | 'bro_back' | 'bro_shoulders' | 'bro_arms' | 'bro_legs';

/** Shorthand for "isolate this muscle, or leave the slot out". */
const iso = (muscle: Muscle, fallback?: MovementPattern[]): SessionSlot => ({
  pattern: 'isolation',
  role: 'accessory',
  muscle,
  requireMuscle: true,
  optional: true,
  ...(fallback ? { fallback } : {}),
});

const core: SessionSlot = { pattern: 'core', role: 'accessory', optional: true };

export const SESSION_TEMPLATES: Record<SessionTemplateId, SessionTemplate> = {
  fb_a: {
    id: 'fb_a',
    name: 'Full body A',
    slots: [
      { pattern: 'squat', role: 'primary', compoundOnly: true, muscle: 'quadriceps' },
      { pattern: 'horizontal_push', role: 'primary', compoundOnly: true, muscle: 'chest' },
      { pattern: 'horizontal_pull', role: 'primary', compoundOnly: true, muscle: 'middle back' },
      { pattern: 'hinge', role: 'secondary', muscle: 'hamstrings' },
      iso('shoulders'),
      core,
    ],
  },
  fb_b: {
    id: 'fb_b',
    name: 'Full body B',
    slots: [
      { pattern: 'hinge', role: 'primary', compoundOnly: true },
      { pattern: 'vertical_push', role: 'primary', compoundOnly: true, muscle: 'shoulders' },
      { pattern: 'vertical_pull', role: 'primary', compoundOnly: true, muscle: 'lats' },
      { pattern: 'lunge', role: 'secondary', fallback: ['squat'], muscle: 'quadriceps' },
      iso('biceps'),
      core,
    ],
  },
  fb_c: {
    id: 'fb_c',
    name: 'Full body C',
    slots: [
      { pattern: 'squat', role: 'primary', compoundOnly: true, muscle: 'quadriceps' },
      { pattern: 'horizontal_push', role: 'primary', compoundOnly: true, muscle: 'chest' },
      { pattern: 'vertical_pull', role: 'primary', compoundOnly: true, muscle: 'lats' },
      { pattern: 'hinge', role: 'secondary' },
      iso('triceps'),
      iso('calves'),
    ],
  },

  upper_a: {
    id: 'upper_a',
    name: 'Upper A',
    slots: [
      { pattern: 'horizontal_push', role: 'primary', compoundOnly: true, muscle: 'chest' },
      { pattern: 'horizontal_pull', role: 'primary', compoundOnly: true, muscle: 'middle back' },
      { pattern: 'vertical_push', role: 'secondary', muscle: 'shoulders' },
      { pattern: 'vertical_pull', role: 'secondary', muscle: 'lats' },
      iso('biceps'),
      iso('triceps'),
    ],
  },
  lower_a: {
    id: 'lower_a',
    name: 'Lower A',
    slots: [
      { pattern: 'squat', role: 'primary', compoundOnly: true, muscle: 'quadriceps' },
      { pattern: 'hinge', role: 'primary', compoundOnly: true },
      { pattern: 'lunge', role: 'secondary', fallback: ['squat'], muscle: 'quadriceps', optional: true },
      iso('hamstrings', ['hinge']),
      iso('calves'),
      core,
    ],
  },
  upper_b: {
    id: 'upper_b',
    name: 'Upper B',
    slots: [
      { pattern: 'vertical_pull', role: 'primary', compoundOnly: true, muscle: 'lats' },
      { pattern: 'vertical_push', role: 'primary', compoundOnly: true, muscle: 'shoulders' },
      { pattern: 'horizontal_pull', role: 'secondary', muscle: 'middle back' },
      { pattern: 'horizontal_push', role: 'secondary', muscle: 'chest' },
      iso('shoulders'),
      iso('biceps'),
    ],
  },
  lower_b: {
    id: 'lower_b',
    name: 'Lower B',
    slots: [
      { pattern: 'hinge', role: 'primary', compoundOnly: true },
      { pattern: 'squat', role: 'primary', compoundOnly: true, muscle: 'quadriceps' },
      { pattern: 'lunge', role: 'secondary', fallback: ['squat'], muscle: 'quadriceps', optional: true },
      iso('quadriceps', ['squat']),
      iso('calves'),
      core,
    ],
  },

  push: {
    id: 'push',
    name: 'Push',
    slots: [
      { pattern: 'horizontal_push', role: 'primary', compoundOnly: true, muscle: 'chest' },
      { pattern: 'vertical_push', role: 'primary', compoundOnly: true, muscle: 'shoulders' },
      { pattern: 'horizontal_push', role: 'secondary', muscle: 'chest' },
      iso('shoulders'),
      iso('triceps'),
      iso('triceps'),
    ],
  },
  pull: {
    id: 'pull',
    name: 'Pull',
    slots: [
      { pattern: 'vertical_pull', role: 'primary', compoundOnly: true, muscle: 'lats' },
      { pattern: 'horizontal_pull', role: 'primary', compoundOnly: true, muscle: 'middle back' },
      { pattern: 'horizontal_pull', role: 'secondary', muscle: 'middle back' },
      iso('lats', ['vertical_pull']),
      iso('biceps'),
      iso('biceps'),
    ],
  },
  legs: {
    id: 'legs',
    name: 'Legs',
    slots: [
      { pattern: 'squat', role: 'primary', compoundOnly: true, muscle: 'quadriceps' },
      { pattern: 'hinge', role: 'primary', compoundOnly: true, muscle: 'hamstrings' },
      { pattern: 'lunge', role: 'secondary', fallback: ['squat'], muscle: 'quadriceps', optional: true },
      // No quad isolation here. Squat plus lunge already cover quads, and on a
      // six-day split this session runs twice — adding a third quad-dominant
      // slot pushed the weekly total to 21 sets, past the brief's ceiling of 20.
      // Hamstrings do need the direct work, since hinges share load with glutes.
      iso('hamstrings', ['hinge']),
      iso('calves'),
      core,
    ],
  },

  bro_chest: {
    id: 'bro_chest',
    name: 'Chest',
    slots: [
      { pattern: 'horizontal_push', role: 'primary', compoundOnly: true, muscle: 'chest' },
      { pattern: 'horizontal_push', role: 'secondary', compoundOnly: true, muscle: 'chest' },
      { pattern: 'horizontal_push', role: 'secondary', muscle: 'chest' },
      iso('chest'),
      iso('chest'),
    ],
  },
  bro_back: {
    id: 'bro_back',
    name: 'Back',
    slots: [
      { pattern: 'vertical_pull', role: 'primary', compoundOnly: true, muscle: 'lats' },
      { pattern: 'horizontal_pull', role: 'primary', compoundOnly: true, muscle: 'middle back' },
      { pattern: 'horizontal_pull', role: 'secondary', muscle: 'middle back' },
      { pattern: 'vertical_pull', role: 'secondary', muscle: 'lats', optional: true },
      iso('traps'),
      iso('lats', ['vertical_pull']),
    ],
  },
  bro_shoulders: {
    id: 'bro_shoulders',
    name: 'Shoulders',
    slots: [
      { pattern: 'vertical_push', role: 'primary', compoundOnly: true, muscle: 'shoulders' },
      { pattern: 'vertical_push', role: 'secondary', muscle: 'shoulders' },
      iso('shoulders'),
      iso('shoulders'),
      iso('traps'),
    ],
  },
  bro_arms: {
    id: 'bro_arms',
    name: 'Arms',
    slots: [
      // No compounds here by design — an arm day is isolation work, so these
      // slots take the primary role for their prescription without demanding
      // a compound that does not exist.
      { pattern: 'isolation', role: 'primary', muscle: 'biceps', requireMuscle: true },
      { pattern: 'isolation', role: 'primary', muscle: 'triceps', requireMuscle: true },
      { pattern: 'isolation', role: 'secondary', muscle: 'biceps', requireMuscle: true },
      { pattern: 'isolation', role: 'secondary', muscle: 'triceps', requireMuscle: true },
      iso('biceps'),
      iso('triceps'),
    ],
  },
  bro_legs: {
    id: 'bro_legs',
    name: 'Legs',
    slots: [
      { pattern: 'squat', role: 'primary', compoundOnly: true, muscle: 'quadriceps' },
      { pattern: 'hinge', role: 'primary', compoundOnly: true },
      { pattern: 'lunge', role: 'secondary', fallback: ['squat'], muscle: 'quadriceps', optional: true },
      iso('quadriceps', ['squat']),
      iso('hamstrings', ['hinge']),
      iso('calves'),
    ],
  },
};

export function template(id: SessionTemplateId): SessionTemplate {
  return SESSION_TEMPLATES[id];
}
