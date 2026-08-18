/**
 * The data model. The same shape exists twice: as Dexie tables here and as
 * Postgres tables in Supabase later. Field names are identical on both sides so
 * the sync layer stays dumb.
 */
import type {
  BodyMetricKind,
  Equipment,
  ExperienceLevel,
  Goal,
  Mode,
  MovementPattern,
  Muscle,
  Readiness,
  SetType,
  Technique,
  Unit,
} from '@/domain/types';

/** Bump when the shape changes in a way an exported file would not survive. */
export const SCHEMA_VERSION = 1;

/**
 * Carried by every table so the sync layer can treat them all alike.
 *
 * - `user_id` stays null until magic-link sign-in exists, then is backfilled once.
 * - Timestamps are ISO 8601 strings in UTC.
 * - `deleted_at` is how deletes work. Rows are NEVER removed, or the delete
 *   cannot propagate to Supabase. Every query filters `deleted_at == null`.
 */
export interface SyncFields {
  user_id: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export interface Exercise extends SyncFields {
  id: string;
  name: string;
  primary_muscle: Muscle;
  secondary_muscles: Muscle[];
  equipment: Equipment;
  movement_pattern: MovementPattern;
  is_compound: boolean;
  is_unilateral: boolean;
  experience_level: ExperienceLevel;
  /** Rough systemic cost, 1 (trivial) to 5 (very taxing). Feeds the generator. */
  fatigue_cost: number;
  demo_url: string | null;
  default_rest_seconds: number;
  /** Seat height, pin position, grip width. Shown during the set. */
  setup_notes: string | null;
  is_custom: boolean;
  /**
   * Stable key from the seed dataset, null for user-created exercises.
   * Lets a reseed refresh metadata without orphaning workout history that
   * references the row by UUID.
   */
  source_id: string | null;
  /** Per-exercise progression increment in kg. Null falls back to the default. */
  increment_kg: number | null;
}

export interface Gym extends SyncFields {
  id: string;
  name: string;
  equipment_available: Equipment[];
  /** Bar weights in kg, e.g. [20, 15, 10]. */
  bar_weights: number[];
  /** Plate denominations in kg available per side, e.g. [25, 20, 15, 10, 5, 2.5, 1.25]. */
  plates_available: number[];
  is_default: boolean;
}

export interface Routine extends SyncFields {
  id: string;
  name: string;
  notes: string | null;
  archived: boolean;
  generated_from_plan_id: string | null;
}

export interface RoutineExercise extends SyncFields {
  id: string;
  routine_id: string;
  exercise_id: string;
  position: number;
  /** Exercises sharing a group id are supersetted or giant-setted together. */
  superset_group: string | null;
  technique: Technique;
  target_sets: number;
  rep_range_low: number;
  rep_range_high: number;
  target_rir: number | null;
  /** Four-digit string such as "3-1-1-0". */
  tempo: string | null;
  rest_seconds: number | null;
}

export interface Workout extends SyncFields {
  id: string;
  /** Null for freestyle sessions. */
  routine_id: string | null;
  gym_id: string | null;
  started_at: string;
  /** Null while in progress. Non-null means finished, and therefore immutable. */
  finished_at: string | null;
  bodyweight_kg: number | null;
  readiness: Readiness | null;
  notes: string | null;
}

/**
 * A snapshot, copied from routine_exercises when the workout starts. It is NOT
 * a live reference — that is what makes editing a routine unable to change a
 * workout already performed.
 */
export interface WorkoutExercise extends SyncFields {
  id: string;
  workout_id: string;
  exercise_id: string;
  position: number;
  superset_group: string | null;
  technique: Technique;
  notes: string | null;
}

export interface WorkoutSet extends SyncFields {
  id: string;
  workout_exercise_id: string;
  /**
   * Non-null makes this a child set: a drop, rest-pause, myo or cluster
   * continuation. Child sets count toward volume but NEVER toward personal
   * records, and never appear as previous performance.
   */
  parent_set_id: string | null;
  set_index: number;
  type: SetType;
  weight_kg: number;
  reps: number;
  rir: number | null;
  is_amrap: boolean;
  completed: boolean;
  completed_at: string | null;
}

export interface Plan extends SyncFields {
  id: string;
  name: string;
  goal: Goal;
  days_per_week: number;
  block_weeks: number;
  current_week: number;
  started_at: string;
  routine_ids: string[];
}

export interface BodyMetric extends SyncFields {
  id: string;
  /** ISO date only, YYYY-MM-DD. */
  date: string;
  metric: BodyMetricKind;
  value: number;
  unit: string;
}

/** Singleton row, keyed by SETTINGS_ID. */
export interface Settings extends SyncFields {
  id: string;
  units: Unit;
  default_gym_id: string | null;
  mode: Mode;
  default_rest_seconds: number;
  sound_on: boolean;
  vibrate_on: boolean;
  /** The only cursor the sync pull needs. */
  last_synced_at: string | null;
}

export const SETTINGS_ID = 'settings';

/**
 * Every mutation is appended here with a sequence number, so it can be flushed
 * to Supabase in order once a connection exists. Not synced itself.
 */
export interface OutboxEntry {
  seq?: number;
  table_name: string;
  row_id: string;
  op: 'put' | 'delete';
  payload: unknown;
  queued_at: string;
}

/** Keeps the free-tier Supabase project from pausing after seven idle days. */
export interface Keepalive {
  id: string;
  pinged_at: string;
}
