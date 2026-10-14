import { App } from '@capacitor/app';
import { registerPlugin, type PluginListenerHandle } from '@capacitor/core';
import { liveQuery, type Subscription } from 'dexie';
import { db } from '@/db/db';
import { applyWatchEvents, watchSnapshotFor, type WatchEvent } from '@/db/watch';
import { stationName, stationOutline } from '@/features/workout/outline';
import { isNativeApp } from './native';

/**
 * The web app's side of the link with the watch.
 *
 * The native side (ios/App/App/WatchLink.swift) holds the connection open
 * from launch and puts whatever the watch sends into an inbox file, even while
 * this JavaScript is frozen. From here:
 *
 *  - whenever the workout under way changes, a new list goes to the watch, so
 *    anything the watch worked out for itself is corrected;
 *  - the inbox is drained on launch, on resume, the moment something lands,
 *    and always before Finish, because Finish tidies away every unticked set
 *    and a set logged on the wrist must be ticked before that.
 *
 * Outside the app every function here does nothing.
 */
interface WatchBridgePlugin {
  sendSnapshot(options: { json: string }): Promise<void>;
  drainInbox(): Promise<{ events: string[] }>;
  acknowledge(options: { ids: string[] }): Promise<void>;
  status(): Promise<{ supported: boolean; paired: boolean; installed: boolean; reachable: boolean }>;
  addListener(event: 'inbox', listener: () => void): Promise<PluginListenerHandle>;
}

const WatchBridge = registerPlugin<WatchBridgePlugin>('WatchBridge');

let draining: Promise<void> | null = null;

/** Applies everything the watch has sent, in order, then tells it so. */
export function drainWatchInbox(): Promise<void> {
  if (!isNativeApp()) return Promise.resolve();
  // One drain at a time: a second call waits for the first and runs again,
  // so an event landing mid-drain is never left sitting.
  const run = async () => {
    const { events } = await WatchBridge.drainInbox();
    if (events.length === 0) return;
    const parsed: WatchEvent[] = [];
    const unreadable: string[] = [];
    for (const json of events) {
      try {
        parsed.push(JSON.parse(json) as WatchEvent);
      } catch {
        // Cleared anyway, so one bad event cannot block the inbox for ever.
        console.warn('GymGo: an unreadable event from the watch', json);
        const id = /"id"\s*:\s*"([^"]+)"/.exec(json)?.[1];
        if (id) unreadable.push(id);
      }
    }
    const done = await applyWatchEvents(parsed);
    await WatchBridge.acknowledge({ ids: [...done, ...unreadable] });
  };
  draining = (draining ?? Promise.resolve()).then(run, run).catch((cause) => {
    console.warn('GymGo: could not drain the watch inbox', cause);
  });
  return draining;
}

async function activeWorkoutId(): Promise<string | null> {
  const open = (await db.workouts.toArray()).filter((w) => w.deleted_at === null && w.finished_at === null);
  open.sort((a, b) => Date.parse(b.started_at) - Date.parse(a.started_at));
  return open[0]?.id ?? null;
}

async function workoutTitle(workoutId: string): Promise<string> {
  const workout = await db.workouts.get(workoutId);
  const routine = workout?.routine_id ? await db.routines.get(workout.routine_id) : undefined;
  return routine ? (routine.name.split(' — ').at(-1) ?? routine.name) : 'Workout';
}

async function sendCurrentSession(): Promise<void> {
  const workoutId = await activeWorkoutId();
  if (!workoutId) return;
  const settings = await db.settings.toCollection().first();
  const snapshot = await watchSnapshotFor(
    workoutId,
    (entries) => ({ name: stationName(entries), outline: stationOutline(entries) }),
    { defaultRest: settings?.default_rest_seconds, title: await workoutTitle(workoutId) },
  );
  if (snapshot) await WatchBridge.sendSnapshot({ json: JSON.stringify(snapshot) });
}

let started = false;

/** Starts the link. Inside the app only, once. */
export function startWatchLink(): void {
  if (!isNativeApp() || started) return;
  started = true;

  void drainWatchInbox();
  void WatchBridge.addListener('inbox', () => void drainWatchInbox());
  void App.addListener('resume', () => void drainWatchInbox());

  // Any change to a workout, its exercises or its sets sends a new list,
  // a moment later so a burst of writes sends one list, not ten.
  let timer: ReturnType<typeof setTimeout> | null = null;
  const subscription: Subscription = liveQuery(async () => {
    await Promise.all([db.workouts.count(), db.workout_exercises.count(), db.sets.count()]);
    return Date.now();
  }).subscribe({
    next: () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        void sendCurrentSession().catch((cause) => console.warn('GymGo: could not send the session to the watch', cause));
      }, 400);
    },
    error: (cause) => console.warn('GymGo: the watch link stopped watching the workout', cause),
  });
  void subscription;
}
