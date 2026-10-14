/**
 * The database side of the watch: the list the phone sends it, and applying
 * what the watch sends back.
 *
 * The rules that decide the list live in `src/domain/watch.ts`; this only
 * reads what they need out of Dexie. Applying goes through `mutations.ts`
 * like any tap, so `updated_at`, the outbox and the backup all work unchanged.
 */
import { db } from './db';
import { completeSetWith, finishWorkout } from './mutations';
import { composeWorkout, exerciseSessions, setSuggestion, type WorkoutExerciseView } from './queries';
import { previousPerformance } from '@/domain/previousPerformance';
import { recordMarks } from '@/domain/prs';
import { restSecondsFor } from '@/domain/rest';
import { sessionStations } from '@/domain/supersets';
import { buildWatchSnapshot, type WatchEntryInput, type WatchSnapshot } from '@/domain/watch';
import { nowIso } from '@/lib/dates';

/** A station's name and outline, as the phone's rest screen words them. */
export type DescribeStation = (entries: readonly WorkoutExerciseView[]) => { name: string; outline: string };

/** The list for the workout under way, or null when there is none to send. */
export async function watchSnapshotFor(
  workoutId: string,
  describe: DescribeStation,
  options: { defaultRest?: number; title?: string } = {},
): Promise<WatchSnapshot | null> {
  const view = await composeWorkout(workoutId);
  if (!view || view.workout.finished_at !== null) return null;

  const entries: WatchEntryInput[] = [];
  for (const item of view.exercises) {
    const exercise = item.exercise;
    if (!exercise) continue;
    const history = (await exerciseSessions(exercise.id)).filter((session) => session.workout_id !== workoutId);
    entries.push({
      workoutExerciseId: item.workoutExercise.id,
      exerciseId: exercise.id,
      name: exercise.name,
      equipment: exercise.equipment,
      technique: item.workoutExercise.technique,
      restSeconds: item.workoutExercise.rest_seconds ?? restSecondsFor(exercise) ?? options.defaultRest ?? 120,
      setupNote: exercise.setup_notes,
      loading: item.loading,
      sets: item.sets,
      suggestion: await setSuggestion(workoutId, exercise.id),
      previous: previousPerformance(history),
      priorMarks: recordMarks(history.flatMap((session) => session.sets)),
    });
  }

  // Only the exercises the snapshot kept: one whose exercise row is missing has no lift to show.
  const kept = view.exercises.filter((item) => item.exercise);
  const stations = sessionStations(kept.map((item) => item.workoutExercise)).map((members) => ({
    members,
    ...describe(members.map((index) => kept[index]!)),
  }));

  return buildWatchSnapshot({
    workoutId,
    title: options.title ?? 'Workout',
    startedAt: view.workout.started_at,
    sentAt: nowIso(),
    entries,
    stations,
  });
}

/** What the watch sends: the contract is in src/domain/watchProtocol.ts. */
export type { WatchEvent } from '@/domain/watchProtocol';
import type { WatchEvent } from '@/domain/watchProtocol';

export type WatchEventOutcome = 'applied' | 'skipped';

/**
 * Applies one event from the watch, as the same mutation a tap would make.
 *
 * Safe to apply twice: an event carries its own ID, and the caller drops one
 * it has seen. Beyond that, a set the phone has since deleted, or a workout
 * already finished, skips rather than throws: the watch was out of touch, and
 * neither the deleted set nor a finished workout may be written to.
 */
export async function applyWatchEvent(event: WatchEvent): Promise<WatchEventOutcome> {
  const workout = await db.workouts.get(event.workoutId);
  if (!workout || workout.deleted_at !== null || workout.finished_at !== null) return 'skipped';

  switch (event.kind) {
    case 'completeSet': {
      if (!event.setId || event.weight == null || event.reps == null) return 'skipped';
      const set = await db.sets.get(event.setId);
      if (!set || set.deleted_at !== null) return 'skipped';
      const workoutExercise = await db.workout_exercises.get(set.workout_exercise_id);
      if (!workoutExercise || workoutExercise.workout_id !== event.workoutId || workoutExercise.deleted_at !== null) {
        return 'skipped';
      }
      // The same set logged on both: the later time wins, as everywhere else.
      if (set.completed && set.completed_at && Date.parse(set.completed_at) > Date.parse(event.at)) return 'skipped';
      await completeSetWith(event.setId, { weight_kg: event.weight, reps: event.reps }, { completedAt: event.at });
      return 'applied';
    }
    case 'finish':
      await finishWorkout(event.workoutId);
      return 'applied';
    case 'skipRest':
      // The rest runs on the watch while it runs the session. Nothing to write.
      return 'applied';
    default:
      return 'skipped';
  }
}

/**
 * Applies a batch in order: every set before Finish, so a set logged on the
 * wrist is never tidied away by Finish because it arrived in the same batch.
 * Returns the IDs dealt with, applied or skipped, for the watch to forget.
 */
export async function applyWatchEvents(events: readonly WatchEvent[]): Promise<string[]> {
  const ordered = [...events].sort(
    (a, b) => Number(a.kind === 'finish') - Number(b.kind === 'finish') || a.at.localeCompare(b.at),
  );
  const done: string[] = [];
  for (const event of ordered) {
    try {
      await applyWatchEvent(event);
    } catch (cause) {
      // A bad event must not hold up the rest of the inbox for ever.
      console.warn('GymGo: could not apply a watch event', event, cause);
    }
    done.push(event.id);
  }
  return done;
}
