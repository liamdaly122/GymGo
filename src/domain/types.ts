/**
 * Core vocabulary for the whole app. Pure types and constants only — this
 * module must never import Dexie, React, or anything with I/O.
 */

/**
 * What a movement actually does, independent of which exercise fills the slot.
 *
 * This is the field the generator builds sessions from (a lower session is a
 * list of patterns, not a list of exercises) and the field swap suggestions
 * match on when a rack is taken. The source dataset does not carry it, so it is
 * derived at seed time — and it must be populated for EVERY exercise, including
 * custom ones.
 */
export const MOVEMENT_PATTERNS = [
  'squat',
  'hinge',
  'lunge',
  'horizontal_push',
  'vertical_push',
  'horizontal_pull',
  'vertical_pull',
  'carry',
  'core',
  'isolation',
] as const;
export type MovementPattern = (typeof MOVEMENT_PATTERNS)[number];

export function isMovementPattern(value: unknown): value is MovementPattern {
  return MOVEMENT_PATTERNS.includes(value as MovementPattern);
}

/** Normalised equipment vocabulary. Gym profiles list which of these are present. */
export const EQUIPMENT = [
  'barbell',
  'dumbbell',
  'kettlebell',
  'cable',
  'machine',
  'bands',
  'bodyweight',
  'ez_bar',
  'exercise_ball',
  'medicine_ball',
  'other',
] as const;
export type Equipment = (typeof EQUIPMENT)[number];

export const EXPERIENCE_LEVELS = ['beginner', 'intermediate', 'expert'] as const;
export type ExperienceLevel = (typeof EXPERIENCE_LEVELS)[number];

/** Muscle groups, matching the source dataset's vocabulary. */
export const MUSCLES = [
  'abdominals',
  'abductors',
  'adductors',
  'biceps',
  'calves',
  'chest',
  'forearms',
  'glutes',
  'hamstrings',
  'lats',
  'lower back',
  'middle back',
  'neck',
  'quadriceps',
  'shoulders',
  'traps',
  'triceps',
] as const;
export type Muscle = (typeof MUSCLES)[number];

/**
 * Advanced techniques, per the brief. Stored on routine_exercises.technique and
 * workout_exercises.technique. `straight` is the default.
 */
export const TECHNIQUES = [
  'straight',
  'pyramid',
  'reverse_pyramid',
  'superset',
  'giant_set',
  'drop_set',
  'rest_pause',
  'myo_reps',
  'cluster',
  'amrap_final',
  'back_off',
  'tempo',
] as const;
export type Technique = (typeof TECHNIQUES)[number];

/**
 * What a single logged set is.
 *
 * `warmup` never counts toward volume or PRs. `working` is the only type
 * eligible to set a personal record or appear as previous performance.
 * The remaining types are child sets — they hang off a parent via
 * parent_set_id, count toward volume, and are barred from PRs.
 */
export const SET_TYPES = [
  'warmup',
  'working',
  'drop',
  'rest_pause',
  'myo',
  'cluster',
  'back_off',
] as const;
export type SetType = (typeof SET_TYPES)[number];

/**
 * Set types that may hang off a parent set. A set of one of these types with a
 * non-null parent_set_id is a child set.
 */
export const CHILD_SET_TYPES = ['drop', 'rest_pause', 'myo', 'cluster'] as const;

export const GOALS = ['strength', 'hypertrophy', 'general'] as const;
export type Goal = (typeof GOALS)[number];

export const MODES = ['beginner', 'pro'] as const;
export type Mode = (typeof MODES)[number];

export const UNITS = ['kg', 'lb'] as const;
/** Display unit only. Weights are ALWAYS stored in kg as numbers. */
export type Unit = (typeof UNITS)[number];

/**
 * Pre-session readiness. `low` scales suggested loads down 10% for that session
 * and exempts it from the progression engine's failure counter.
 */
export const READINESS = ['low', 'normal', 'high'] as const;
export type Readiness = (typeof READINESS)[number];

export const BODY_METRICS = ['bodyweight', 'waist', 'chest', 'arm', 'thigh', 'hips'] as const;
export type BodyMetricKind = (typeof BODY_METRICS)[number];
