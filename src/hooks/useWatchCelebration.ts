import { useSyncExternalStore } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '@/db/db';
import type { Workout } from '@/db/schema';
import { celebrationFor } from '@/domain/celebrate';
import { getCelebrations, subscribeCelebrations } from '@/lib/celebrate';

/**
 * The session Today still owes a "Done." poster: one the watch finished while
 * no screen showed it, or null. The rule is `celebrationFor`
 * (src/domain/celebrate.ts); the lists are src/lib/celebrate.ts, heard live,
 * so a drain that lands while Today is open puts the banner up, and the
 * poster being shown takes it down.
 *
 * Reads only the workouts the watch finished, so a phone with nothing from a
 * watch (the website, every seeded browser suite) never shows it. Twelve
 * hours is judged when Today renders, which `useToday` keeps doing at
 * midnight and on every return to the foreground.
 */
export function useWatchCelebration(): Workout | null {
  const { finishedOnWatch, celebrated } = useSyncExternalStore(subscribeCelebrations, getCelebrations);
  const key = finishedOnWatch.map((entry) => entry.id).join(',');
  const workouts = useLiveQuery(
    async () => (key === '' ? [] : db.workouts.bulkGet(key.split(','))),
    [key],
  );
  if (!workouts) return null;
  return celebrationFor(workouts, finishedOnWatch, celebrated, Date.now());
}
