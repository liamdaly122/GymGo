/**
 * The contract between the phone and the watch. Every message either side
 * sends has its shape here, and its Swift mirror in
 * ios/GymGoKit/Sources/GymGoKit/Protocol.swift. The rules for when each is
 * sent and how it is applied are in docs/watch-protocol.md.
 *
 * Types only: nothing here runs.
 */
import type { WatchSnapshot } from './watch';

export const WATCH_PROTOCOL_VERSION = 1;

// ---------------------------------------------------------------------------
// Phone → watch: the application context, one JSON string under "context".
// Sent whole every time: updateApplicationContext replaces the dictionary.
// ---------------------------------------------------------------------------

export interface WatchContext {
  v: typeof WATCH_PROTOCOL_VERSION;
  /** Phone clock, ISO. Newer contexts replace older ones; an older one is ignored. */
  sentAt: string;
  /** The workout open on the phone, as the watch should run it. Null when none is open. */
  live: WatchSnapshot | null;
  /** What the watch shows when no workout is running, and which workouts ended on the phone. */
  home: WatchHome;
  /** The phone took logging back for this workout at this time (phone clock). Null when it has not. */
  phoneClaim: { workoutId: string; at: string } | null;
  /** The phone's own settings that the watch respects. */
  settings: { sound: boolean; vibrate: boolean };
}

export interface WatchHome {
  /** The phone's local date when this was built, YYYY-MM-DD. */
  today: string;
  /**
   * ready: a planned session is up next (`ready` is set);
   * running: a workout is open on the phone (`ready` is null);
   * blockDone: the running block has no session left;
   * noPlan: no block is running.
   */
  state: 'ready' | 'running' | 'blockDone' | 'noPlan';
  /** Workouts finished today on either device, newest first. */
  doneToday: Array<{ workoutId: string; name: string }>;
  /**
   * Workouts that ended on the phone in the last 24 hours. The watch ends its
   * session for any of these: finished saves the Health workout, discarded
   * throws it away.
   */
  closed: Array<{ workoutId: string; how: 'finished' | 'discarded'; at: string }>;
  /** The next planned session, ready to start on the wrist. */
  ready: WatchReady | null;
  /** The current calendar week, in the order the phone's calendar shows it. */
  week: WatchWeekDay[];
}

export interface WatchReady {
  /** `${planId}:${week}:${sessionIndex}`, or the routine ID outside a block. A key is started at most once. */
  key: string;
  routineId: string;
  /** The session name, as Today shows it ("Push A"). */
  name: string;
  /** The day it is planned for, YYYY-MM-DD, after any rollover. */
  date: string;
  status: 'today' | 'upcoming';
  /** Where it was meant to be before it rolled forward, YYYY-MM-DD. */
  movedFrom: string | null;
  week: { week: number; totalWeeks: number; label: string } | null;
  /** "About N min", the same number Today shows. */
  minutes: number;
  /** One line per exercise, in order. */
  exercises: Array<{
    name: string;
    /** "Barbell", or null for "other" kit. */
    kit: string | null;
    /** "4 × 6–8", or "3 sets" when there is no rep range. */
    work: string;
    /** A short tag the phone shows beside it ("Main"), or null. */
    badge: string | null;
    /** A superset's group, so members can be drawn together. Null for a solo exercise. */
    superset: string | null;
  }>;
  /**
   * Echoed back in the startWorkout event. Unchanged, except that after a
   * Discard on the wrist the watch may re-mint the workout, exercise and set
   * IDs in it and in the snapshot (FreshIds.swift). A new row ID in the
   * layout must be added to LayoutIds there too.
   */
  layout: string;
  /** The session as it will run. Its workout, exercise and set IDs are the layout's. */
  snapshot: WatchSnapshot;
}

export interface WatchWeekDay {
  /** YYYY-MM-DD. */
  date: string;
  /** "Mon". */
  weekday: string;
  state: 'done' | 'planned' | 'today' | 'rest';
  /** The session name on a training day, else null. */
  name: string | null;
}

// ---------------------------------------------------------------------------
// Watch → phone: events. transferUserInfo ["event": json], and sendMessage
// ["event": json] as well when the phone is reachable. Applied once each by
// ID; acknowledged with transferUserInfo ["ack": [ids]] once applied or
// definitely skipped. A deferred event is not acknowledged.
// ---------------------------------------------------------------------------

export type WatchEventKind = 'completeSet' | 'skipRest' | 'finish' | 'discard' | 'startWorkout';

export interface WatchEvent {
  /** A UUID made on the watch. */
  id: string;
  kind: WatchEventKind;
  workoutId: string;
  /** Watch clock, ISO: when it happened on the wrist. */
  at: string;
  /** completeSet. */
  setId?: string | null;
  weight?: number | null;
  reps?: number | null;
  /** startWorkout: the ready session's routine and its layout, echoed back (see WatchReady.layout). */
  routineId?: string | null;
  layout?: string | null;
  /**
   * finish: every completeSet for this workout the watch has not had
   * confirmed, in the order they were logged, so a Finish that overtakes its
   * last sets cannot tidy them away.
   */
  sets?: WatchEvent[] | null;
}

// ---------------------------------------------------------------------------
// Watch → phone: state. The watch's applicationContext ["state": json], and
// sendMessage ["state": json] as well when reachable, on every change and
// every 30 seconds while a workout session runs. Not an event: never queued,
// never acknowledged; the newest `seq` wins.
// ---------------------------------------------------------------------------

export interface WatchStateReport {
  v: typeof WATCH_PROTOCOL_VERSION;
  /** Watch clock, ISO. */
  at: string;
  /** Increases with every report the watch sends. */
  seq: number;
  /** The workout the watch is running, or null. */
  workoutId: string | null;
  session: 'running' | 'ended' | 'none';
  /** Who logs sets for `workoutId`. 'phone' once the watch has seen a phone claim and not reclaimed. */
  owner: 'watch' | 'phone';
  /** The `phoneClaim.at` the watch has seen, or null. */
  seenPhoneClaim: string | null;
  /** The set in hand on the watch. */
  setId: string | null;
  /**
   * The set in hand as the watch's set screen shows it: the lift, and
   * "Set 2 of 4 · 100 × 5". Null with no set in hand. For the iPhone's Live
   * Activity, which cannot read Dexie while the phone is locked.
   */
  inHand: { name: string; detail: string } | null;
  /**
   * The running rest. `startedAt` (watch clock, ISO) is when it began, so a
   * bar can drain exactly; a build 6 watch leaves it out.
   */
  rest: { endsAt: string; startedAt?: string; upNext: { name: string; detail: string } } | null;
  /**
   * Set IDs skipped on the watch ("Skip this set", "Done with this lift"):
   * neither done nor left to do. Always present, `[]` when none. The
   * companion leaves them out of what is open, so its Up next is the watch's.
   */
  skipped: string[];
  /**
   * When the watch paused the workout (watch clock, ISO), or null while it
   * records. `session` stays `running` while paused: a build 6 phone refuses
   * a `session` it does not know.
   */
  paused: string | null;
  /** Beats per minute, most recent. */
  heartRate: number | null;
  /** Active energy since the workout began, kcal. */
  activeKcal: number | null;
  /** The HealthKit workout session: recording, or why not. */
  health: 'recording' | 'unavailable' | 'denied' | 'off';
}

/** A state report as the phone holds it: with the phone's own clock reading when it arrived. */
export interface ReceivedWatchState extends WatchStateReport {
  /** Phone clock, epoch ms. Staleness is judged on this, never on the watch's clock. */
  receivedAt: number;
}
