import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import { loggingSurface, watchReclaimed, WATCH_STALE_MS, type LoggingSurface } from '@/domain/companion';
import type { ReceivedWatchState } from '@/domain/watchProtocol';
import { clearTakeBack, getWatchState, subscribeWatchState, takeLoggingBack } from '@/platform/watchState';

export interface CompanionMode {
  /** Who logs sets for this workout: the watch, or this phone and why. */
  surface: LoggingSurface;
  /** The watch's newest report, when it is about this workout. */
  report: ReceivedWatchState | null;
  /** "Log on this phone": takes logging back for this workout, now. */
  takeBack: () => void;
  /** The watch took logging back from this phone ("Log here instead") while this screen was open. */
  reclaimed: boolean;
}

const NO_WATCH: LoggingSurface = { on: 'phone', why: 'no-watch' };

/**
 * The companion rule, live, for one workout.
 *
 * The one way screens learn what the watch is doing: nothing under
 * src/features imports the store itself (scripts/boundaries.test.ts holds
 * that), so the rule in src/domain/companion.ts is applied in one place.
 *
 * A report going stale changes nothing in the store, so the hook keeps its
 * own clock: a timer set for the moment the newest report runs out, and a
 * fresh look whenever the page comes back to the foreground, which is when a
 * web view frozen in a pocket finds out how long it was away.
 *
 * Off the watch, and on the website, the store stays empty and this always
 * says the phone logs, so every screen renders exactly as it does without one.
 */
export function useCompanionMode(workoutId: string | undefined): CompanionMode {
  const { report, takeBack: stored } = useSyncExternalStore(subscribeWatchState, getWatchState);
  // Bumped to re-read the clock; the value itself is never read.
  const [, setTick] = useState(0);
  const now = Date.now();

  const mine = report !== null && workoutId !== undefined && report.workoutId === workoutId ? report : null;
  const staleAt = mine && mine.session === 'running' ? mine.receivedAt + WATCH_STALE_MS : null;

  useEffect(() => {
    if (staleAt === null) return;
    const wait = staleAt - Date.now();
    if (wait < 0) return;
    const id = window.setTimeout(() => setTick((tick) => tick + 1), wait + 1);
    return () => window.clearTimeout(id);
  }, [staleAt]);

  useEffect(() => {
    if (staleAt === null) return;
    const onVisible = () => {
      if (document.visibilityState === 'visible') setTick((tick) => tick + 1);
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [staleAt]);

  const surface = workoutId ? loggingSurface(report, workoutId, now, stored) : NO_WATCH;

  // The watch chose "Log here instead" after seeing this phone's claim. The
  // phone accepts by forgetting its claim, which is then spent; the screen
  // hears about it once, and keeps hearing it until logging moves again.
  const reclaimedNow = workoutId ? watchReclaimed(report, workoutId, now, stored) : false;
  const [reclaimedFor, setReclaimedFor] = useState<string | null>(null);
  useEffect(() => {
    if (!reclaimedNow || !workoutId) return;
    setReclaimedFor(workoutId);
    clearTakeBack();
  }, [reclaimedNow, workoutId]);

  const takeBack = useCallback(() => {
    if (!workoutId) return;
    setReclaimedFor(null);
    takeLoggingBack(workoutId);
  }, [workoutId]);

  return {
    surface,
    report: mine,
    takeBack,
    reclaimed: workoutId !== undefined && reclaimedFor === workoutId && surface.on === 'watch',
  };
}
