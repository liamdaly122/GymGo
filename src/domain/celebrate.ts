/**
 * Which session's "Done." poster Today still owes: one the watch finished
 * while the phone was not looking.
 *
 * The newest workout that:
 *  - the watch finished (the drain's positive signal, never an inference from
 *    "finished recently", which would fire for an import, a restore or a
 *    seeded test);
 *  - is finished and not deleted (a discarded session has nothing to show);
 *  - finished within the last 12 hours, and not in the future (a watch clock
 *    ahead of the phone's, or a seeded row, cannot hold the banner open);
 *  - and whose poster has not been seen.
 *
 * Newest by `finished_at`, so two wrist finishes in a day offer the latest,
 * and the one before it is simply in the history.
 *
 * Pure. The lists live in src/lib/celebrate.ts; Today asks through
 * `useWatchCelebration`.
 */
import type { Workout } from '@/db/schema';

/** How long a finish on the wrist is news. */
export const CELEBRATE_WITHIN_MS = 12 * 60 * 60_000;

export function celebrationFor<W extends Pick<Workout, 'id' | 'finished_at' | 'deleted_at'>>(
  workouts: ReadonlyArray<W | undefined>,
  finishedOnWatch: ReadonlyArray<{ id: string }>,
  celebrated: ReadonlyArray<string>,
  now: number,
): W | null {
  const fromWatch = new Set(finishedOnWatch.map((entry) => entry.id));
  const seen = new Set(celebrated);
  let newest: W | null = null;
  let newestAt = -Infinity;
  for (const workout of workouts) {
    if (!workout || !fromWatch.has(workout.id) || seen.has(workout.id)) continue;
    if (workout.deleted_at !== null || workout.finished_at === null) continue;
    const at = Date.parse(workout.finished_at);
    if (!Number.isFinite(at) || at > now || now - at > CELEBRATE_WITHIN_MS) continue;
    if (at > newestAt) {
      newest = workout;
      newestAt = at;
    }
  }
  return newest;
}
