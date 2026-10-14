/**
 * What the phone knows about the watch: its newest state report, and whether
 * the phone has taken logging back. A tiny store with no Capacitor in it, so
 * it runs under Vitest and in the browser suites.
 *
 * Fed by src/platform/watch.ts from the native side; read by screens only
 * through `useCompanionMode` (src/hooks/useCompanionMode.ts). The rule that
 * turns it into "the watch logs" or "the phone logs" is `loggingSurface` in
 * src/domain/companion.ts. docs/watch-protocol.md has the protocol.
 */
import type { ReceivedWatchState } from '@/domain/watchProtocol';

/** The phone took logging back for this workout at this time (phone clock, ISO). */
export interface TakeBack {
  workoutId: string;
  at: string;
}

export interface WatchState {
  report: ReceivedWatchState | null;
  takeBack: TakeBack | null;
}

const TAKE_BACK_KEY = 'gymgo.watch.takeBack';

function readTakeBack(): TakeBack | null {
  try {
    const stored = globalThis.localStorage?.getItem(TAKE_BACK_KEY);
    if (!stored) return null;
    const value = JSON.parse(stored) as Partial<TakeBack>;
    return typeof value.workoutId === 'string' && typeof value.at === 'string'
      ? { workoutId: value.workoutId, at: value.at }
      : null;
  } catch {
    return null;
  }
}

function writeTakeBack(value: TakeBack | null): void {
  try {
    if (value) globalThis.localStorage?.setItem(TAKE_BACK_KEY, JSON.stringify(value));
    else globalThis.localStorage?.removeItem(TAKE_BACK_KEY);
  } catch {
    // Kept in memory for this session; after a reload the watch's own report decides.
  }
}

// One object per change, so useSyncExternalStore sees a new snapshot only when something moved.
let state: WatchState = { report: null, takeBack: readTakeBack() };
const listeners = new Set<() => void>();

function set(next: WatchState): void {
  state = next;
  for (const listener of listeners) listener();
}

/** The current state. The same object until something changes. */
export function getWatchState(): WatchState {
  return state;
}

export function subscribeWatchState(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * A report from the watch, stamped with the phone's clock. An older one (a
 * lower `seq` from the same watch app run, and no later `at`) is ignored, so
 * the slow copy of a report never undoes the fast one. A reinstalled watch
 * app starts `seq` again, which a later `at` lets through.
 */
export function reportFromWatch(report: ReceivedWatchState): void {
  const current = state.report;
  if (current && report.seq <= current.seq && report.at <= current.at) return;
  set({ ...state, report });
}

/** "Log on this phone": the phone takes logging back for this workout, now. */
export function takeLoggingBack(workoutId: string, at: string = new Date().toISOString()): TakeBack {
  const takeBack = { workoutId, at };
  writeTakeBack(takeBack);
  set({ ...state, takeBack });
  return takeBack;
}

/** Forget a take-back: the workout ended, or the watch reclaimed and the phone accepted it. */
export function clearTakeBack(): void {
  if (!state.takeBack) return;
  writeTakeBack(null);
  set({ ...state, takeBack: null });
}

/** What goes in the context as `phoneClaim`. */
export function phoneClaim(): TakeBack | null {
  return state.takeBack;
}

/** For tests: back to nothing known. */
export function resetWatchState(): void {
  writeTakeBack(null);
  set({ report: null, takeBack: null });
}

/**
 * The browser suites' way in: `window.__gymgoWatch.report({...})` pretends a
 * watch reported. Development builds only; the production and iPhone builds
 * leave it out.
 */
if (import.meta.env?.DEV && typeof window !== 'undefined') {
  const defaults: Omit<ReceivedWatchState, 'workoutId' | 'receivedAt'> = {
    v: 1,
    at: new Date(0).toISOString(),
    seq: 0,
    session: 'running',
    owner: 'watch',
    seenPhoneClaim: null,
    setId: null,
    rest: null,
    heartRate: null,
    activeKcal: null,
    health: 'recording',
  };
  let seq = 0;
  (window as unknown as { __gymgoWatch: unknown }).__gymgoWatch = {
    report(partial: Partial<ReceivedWatchState> & { workoutId: string | null }) {
      seq += 1;
      reportFromWatch({ ...defaults, at: new Date().toISOString(), seq, receivedAt: Date.now(), ...partial });
    },
    end() {
      seq += 1;
      const workoutId = state.report?.workoutId ?? null;
      reportFromWatch({ ...defaults, at: new Date().toISOString(), seq, receivedAt: Date.now(), workoutId, session: 'ended' });
    },
    clear() {
      resetWatchState();
    },
  };
}
