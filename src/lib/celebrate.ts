/**
 * The "Done." poster for a session finished on the watch, owed and paid.
 *
 * Finish on the phone lands on the poster, and so does the watch's Finish
 * while the workout's screen is open. A Finish on the wrist with the phone in
 * a pocket lands nowhere: the drain applies it while the phone is locked, or
 * at the next launch, and the poster was never seen. Today then offers it
 * once (`celebrationFor` in src/domain/celebrate.ts decides which).
 *
 * Two lists, each written by the one thing that knows it, so the order they
 * land in does not matter:
 *  - `finishedOnWatch`: written by the drain (src/platform/watch.ts) for every
 *    workout a watch's Finish finished. A positive signal, never an inference
 *    from "finished recently", which would also fire for an import, a
 *    restore, a backup brought onto a new phone and the browser suites'
 *    seeded history.
 *  - `celebrated`: written by the session summary whenever it shows with
 *    `fresh`, which covers Finish on the phone, the watch's Finish while the
 *    screen is open, and the banner itself. The screen can get there before
 *    the drain has noted the finish; the rule only needs both lists.
 *
 * Device-local, in localStorage, every access in try/catch: losing it costs at
 * most one banner missed or offered again, so it is not mirrored into
 * UserDefaults (src/platform/durable.ts). Where storage refuses, the lists live in
 * memory for the session. Screens read them through `getCelebrations` and
 * `subscribeCelebrations` (a `useSyncExternalStore` pair), so Today hears a
 * drain that lands while it is open.
 */

export interface FinishedOnWatch {
  /** The workout. */
  id: string;
  /** When the phone applied the watch's Finish (phone clock, ISO). */
  at: string;
}

export interface Celebrations {
  finishedOnWatch: readonly FinishedOnWatch[];
  celebrated: readonly string[];
}

const FINISHED_KEY = 'gymgo.celebrate.finishedOnWatch';
const CELEBRATED_KEY = 'gymgo.celebrate.celebrated';
/** Each list keeps its newest entries only: one a session, so a few weeks of them. */
const KEPT = 30;

function read(key: string): unknown[] {
  try {
    const stored: unknown = JSON.parse(globalThis.localStorage?.getItem(key) ?? '[]');
    return Array.isArray(stored) ? stored : [];
  } catch {
    return [];
  }
}

function write(key: string, list: readonly unknown[]): void {
  try {
    globalThis.localStorage?.setItem(key, JSON.stringify(list));
  } catch {
    // Kept in memory for this session; at worst a banner is missed after a reload.
  }
}

function load(): Celebrations {
  return {
    finishedOnWatch: read(FINISHED_KEY).filter(
      (entry): entry is FinishedOnWatch =>
        typeof entry === 'object' &&
        entry !== null &&
        typeof (entry as FinishedOnWatch).id === 'string' &&
        typeof (entry as FinishedOnWatch).at === 'string',
    ),
    celebrated: read(CELEBRATED_KEY).filter((id): id is string => typeof id === 'string'),
  };
}

// One object per change, so useSyncExternalStore sees a new snapshot only when something moved.
let state: Celebrations | null = null;
const listeners = new Set<() => void>();

/** Both lists. The same object until one of them changes. */
export function getCelebrations(): Celebrations {
  state ??= load();
  return state;
}

export function subscribeCelebrations(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function set(next: Celebrations): void {
  state = next;
  for (const listener of listeners) listener();
}

/** The workouts a watch's Finish finished, oldest first. */
export function finishedOnWatch(): readonly FinishedOnWatch[] {
  return getCelebrations().finishedOnWatch;
}

/** The workouts whose "Done." poster has been seen. */
export function celebrated(): readonly string[] {
  return getCelebrations().celebrated;
}

/** The drain applied a watch's Finish for these workouts, now. */
export function recordFinishedOnWatch(ids: readonly string[], at: string = new Date().toISOString()): void {
  if (ids.length === 0) return;
  const current = getCelebrations();
  const fresh = new Set(ids);
  const finished = [...current.finishedOnWatch.filter((entry) => !fresh.has(entry.id)), ...ids.map((id) => ({ id, at }))].slice(
    -KEPT,
  );
  write(FINISHED_KEY, finished);
  set({ ...current, finishedOnWatch: finished });
}

/** The "Done." poster for this workout has been shown. */
export function markCelebrated(id: string): void {
  const current = getCelebrations();
  if (current.celebrated.at(-1) === id) return;
  const seen = [...current.celebrated.filter((each) => each !== id), id].slice(-KEPT);
  write(CELEBRATED_KEY, seen);
  set({ ...current, celebrated: seen });
}

/** For tests: forget both lists, in storage and in memory. */
export function resetCelebrations(): void {
  try {
    globalThis.localStorage?.removeItem(FINISHED_KEY);
    globalThis.localStorage?.removeItem(CELEBRATED_KEY);
  } catch {
    // Nothing stored to forget.
  }
  set({ finishedOnWatch: [], celebrated: [] });
}
