/**
 * The rewards, read out of the database.
 *
 * One pass over the finished workouts and everything under them, handed to
 * the pure walk in `src/domain/rewards`. Nothing is written: XP, levels, the
 * streak and the badges are all worked out afresh, so they can never drift
 * from the training log, and a restore brings them back with it.
 */
import { db } from './db';
import { SETTINGS_ID, type WorkoutExercise, type WorkoutSet } from './schema';
import { computeRewards, type RewardSession, type Rewards } from '@/domain/rewards';

const live = <T extends { deleted_at: string | null }>(rows: T[]) => rows.filter((row) => row.deleted_at === null);

export async function loadRewards(today: Date): Promise<Rewards> {
  const workouts = live(await db.workouts.toArray()).filter((workout) => workout.finished_at !== null);
  const workoutExercises = live(
    await db.workout_exercises.where('workout_id').anyOf(workouts.map((workout) => workout.id)).toArray(),
  );
  const sets = live(
    await db.sets.where('workout_exercise_id').anyOf(workoutExercises.map((we) => we.id)).toArray(),
  );
  const exercises = await db.exercises.bulkGet([...new Set(workoutExercises.map((we) => we.exercise_id))]);
  const equipment = new Map(exercises.flatMap((exercise) => (exercise ? [[exercise.id, exercise.equipment] as const] : [])));
  const plans = live(await db.plans.toArray());
  const settings = await db.settings.get(SETTINGS_ID);

  const setsByEntry = new Map<string, WorkoutSet[]>();
  for (const set of sets) {
    const bucket = setsByEntry.get(set.workout_exercise_id);
    if (bucket) bucket.push(set);
    else setsByEntry.set(set.workout_exercise_id, [set]);
  }
  const entriesByWorkout = new Map<string, WorkoutExercise[]>();
  for (const we of workoutExercises) {
    const bucket = entriesByWorkout.get(we.workout_id);
    if (bucket) bucket.push(we);
    else entriesByWorkout.set(we.workout_id, [we]);
  }

  const sessions: RewardSession[] = workouts.map((workout) => ({
    workout,
    exercises: (entriesByWorkout.get(workout.id) ?? []).map((we) => ({
      exerciseId: we.exercise_id,
      equipment: equipment.get(we.exercise_id) ?? 'other',
      sets: setsByEntry.get(we.id) ?? [],
    })),
  }));

  return computeRewards({ sessions, plans, weekStartsOn: settings?.week_starts_on ?? 1, today });
}
