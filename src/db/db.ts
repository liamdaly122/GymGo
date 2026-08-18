import Dexie, { type EntityTable } from 'dexie';
import type {
  BodyMetric,
  Exercise,
  Gym,
  Keepalive,
  OutboxEntry,
  Plan,
  Routine,
  RoutineExercise,
  Settings,
  Workout,
  WorkoutExercise,
  WorkoutSet,
} from './schema';

/**
 * The local working store. Every read and write in the UI hits this, and only
 * this. Nothing in the interface ever waits on the network.
 *
 * A note on indexes: IndexedDB cannot index `null`, so `deleted_at` and
 * `parent_set_id` are deliberately NOT indexed — a query for "not deleted"
 * would silently miss every row. Those are filtered in memory instead, which is
 * free at single-user data volumes. Use the `active()` helper below.
 */
export class GymGoDB extends Dexie {
  exercises!: EntityTable<Exercise, 'id'>;
  gyms!: EntityTable<Gym, 'id'>;
  routines!: EntityTable<Routine, 'id'>;
  routine_exercises!: EntityTable<RoutineExercise, 'id'>;
  workouts!: EntityTable<Workout, 'id'>;
  workout_exercises!: EntityTable<WorkoutExercise, 'id'>;
  sets!: EntityTable<WorkoutSet, 'id'>;
  plans!: EntityTable<Plan, 'id'>;
  body_metrics!: EntityTable<BodyMetric, 'id'>;
  settings!: EntityTable<Settings, 'id'>;
  outbox!: EntityTable<OutboxEntry, 'seq'>;
  keepalive!: EntityTable<Keepalive, 'id'>;

  constructor(name = 'gymgo') {
    super(name);
    // Every table from the brief exists from version 1, including the ones no
    // V1 screen touches yet. Adding them now costs nothing and avoids a
    // migration when Pro mode and plans land.
    this.version(1).stores({
      exercises: 'id, name, primary_muscle, movement_pattern, equipment, source_id, is_custom',
      gyms: 'id, name',
      routines: 'id, name, updated_at',
      routine_exercises: 'id, routine_id, exercise_id, [routine_id+position]',
      workouts: 'id, started_at, finished_at, routine_id, gym_id',
      workout_exercises: 'id, workout_id, exercise_id, [workout_id+position]',
      sets: 'id, workout_exercise_id, [workout_exercise_id+set_index]',
      plans: 'id, name',
      body_metrics: 'id, date, metric, [metric+date]',
      settings: 'id',
      outbox: '++seq, table_name, row_id',
      keepalive: 'id',
    });
  }
}

export const db = new GymGoDB();

/** Drops soft-deleted rows. Every read path must pass through this. */
export function active<T extends { deleted_at: string | null }>(rows: T[]): T[] {
  return rows.filter((row) => row.deleted_at === null);
}
