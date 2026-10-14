import { App } from '@capacitor/app';
import { registerPlugin, type PluginListenerHandle } from '@capacitor/core';
import { liveQuery } from 'dexie';
import { db } from '@/db/db';
import { SETTINGS_ID, type Settings } from '@/db/schema';
import { applyWatchEvents, watchContextFor, type DescribeStation, type WatchDrainResult } from '@/db/watch';
import {
  WATCH_PROTOCOL_VERSION,
  type WatchContext,
  type WatchEvent,
  type WatchStateReport,
} from '@/domain/watchProtocol';
import { stationName, stationOutline } from '@/features/workout/outline';
import { isNativeApp } from './native';
import { snapshotEverything } from './snapshots';
import { getWatchState, phoneClaim, reportFromWatch, subscribeWatchState } from './watchState';

/**
 * The web app's side of the link with the watch. The rules are in
 * docs/watch-protocol.md.
 *
 * The native side (ios/App/App/WatchLink.swift) holds the connection open from
 * launch, and keeps whatever the watch sends, even while this JavaScript is
 * frozen: its events in an inbox, its newest state report on disk. From here:
 *
 *  - **The inbox is drained** on launch, on resume, the moment something lands,
 *    and always before Finish on the phone, because Finish tidies away every
 *    unticked set and a set logged on the wrist must be ticked before that.
 *    One that reaches the phone only after that Finish is put back
 *    (`reviveTidiedSet`). Only what was applied, or skipped for good, is
 *    acknowledged; anything deferred or that threw stays for the next drain.
 *    A drain that finished a workout, or put a set back into one, writes the
 *    phone's snapshot, as Finish on the phone does.
 *  - **The context goes out** a moment after anything it is built from
 *    changes, and at launch, on resume, at local midnight and when the phone
 *    takes logging back, but never while a drain is running: a stale `ready`
 *    must not go out while a start from the watch waits to be applied.
 *  - **The watch's state** feeds `src/platform/watchState.ts`, on every report
 *    and from the native side's copy at launch and on resume.
 *  - **Starting on the phone wakes the watch:** a workout that becomes the live
 *    one, and that the watch has not reported in any state, opens GymGo on the
 *    watch, once.
 *
 * Outside the app every exported function here does nothing.
 */

interface WatchStatus {
  supported: boolean;
  /** Whether the others mean anything yet: until the session is up they all read false. */
  activated?: boolean;
  paired: boolean;
  installed: boolean;
  reachable: boolean;
}

interface WatchBridgePlugin {
  sendContext(options: { json: string }): Promise<void>;
  drainInbox(): Promise<{ events: string[] }>;
  acknowledge(options: { ids: string[] }): Promise<void>;
  lastState(): Promise<{ json: string | null; receivedAt: number | null }>;
  startWatchWorkout(): Promise<{ started: boolean; error?: string }>;
  status(): Promise<WatchStatus>;
  addListener(event: 'inbox', listener: () => void): Promise<PluginListenerHandle>;
  addListener(
    event: 'watchState',
    listener: (state: { json: string | null; receivedAt: number | null }) => void,
  ): Promise<PluginListenerHandle>;
}

const WatchBridge = registerPlugin<WatchBridgePlugin>('WatchBridge');

/** A burst of writes sends one context, this long after the last of them. */
const SEND_DELAY_MS = 400;
/** WatchConnectivity refuses an application context much past 64 KB. */
const CONTEXT_WARN_BYTES = 60_000;
/** The workouts the watch has been woken for (or deliberately not), so each is woken at most once. */
const WOKEN_KEY = 'gymgo.watch.woken';
const WOKEN_KEPT = 50;

const warn = (what: string) => (cause: unknown) => console.warn(`GymGo: ${what}`, cause);

// ---------------------------------------------------------------------------
// The inbox
// ---------------------------------------------------------------------------

let drainChain: Promise<void> = Promise.resolve();
/** Drains queued or running. */
let drainsWaiting = 0;
/** Every drain ever queued, so a send can tell that one ran while it was building. */
let drainsQueued = 0;

const NOTHING_APPLIED: WatchDrainResult = { acknowledge: [], keep: [], finished: [], revived: [] };

function isEvent(value: unknown): value is WatchEvent {
  if (typeof value !== 'object' || value === null) return false;
  const event = value as Partial<Record<keyof WatchEvent, unknown>>;
  return (
    typeof event.id === 'string' &&
    typeof event.kind === 'string' &&
    typeof event.workoutId === 'string' &&
    typeof event.at === 'string'
  );
}

async function drainOnce(): Promise<void> {
  const { events } = await WatchBridge.drainInbox();
  if (events.length === 0) return;
  const readable: WatchEvent[] = [];
  const unreadable: string[] = [];
  for (const json of events) {
    let value: unknown;
    try {
      value = JSON.parse(json);
    } catch {
      value = undefined;
    }
    if (isEvent(value)) {
      readable.push(value);
      continue;
    }
    // Acknowledged anyway, so one bad event cannot block the inbox for ever.
    console.warn('GymGo: an unreadable event from the watch', json);
    const parsedId = (value as { id?: unknown } | null | undefined)?.id;
    const id = typeof parsedId === 'string' ? parsedId : /"id"\s*:\s*"([^"]+)"/.exec(json)?.[1];
    if (id) unreadable.push(id);
  }
  const result = readable.length > 0 ? await applyWatchEvents(readable) : NOTHING_APPLIED;
  const ids = [...result.acknowledge, ...unreadable];
  if (ids.length > 0) await WatchBridge.acknowledge({ ids });
  // Finish on the watch is a Finish: the phone keeps its own copy, as after Finish on the phone.
  // So is a set put back into a finished workout: the copy taken at Finish lacks it.
  if (result.finished.length > 0 || result.revived.length > 0) await snapshotEverything();
}

/**
 * Applies everything the watch has sent, in order, then tells it so. One
 * drain at a time: a second call waits for the first and then runs, so an
 * event landing mid-drain is never left sitting. Never rejects.
 */
export function drainWatchInbox(): Promise<void> {
  if (!isNativeApp()) return Promise.resolve();
  drainsWaiting += 1;
  drainsQueued += 1;
  const run = drainChain
    .then(drainOnce)
    .catch(warn('could not drain the watch inbox'))
    .finally(() => {
      drainsWaiting -= 1;
    });
  drainChain = run;
  return run;
}

async function drainsSettled(): Promise<void> {
  while (drainsWaiting > 0) await drainChain;
}

// ---------------------------------------------------------------------------
// The watch's state
// ---------------------------------------------------------------------------

const SESSIONS = new Set<WatchStateReport['session']>(['running', 'ended', 'none']);
const OWNERS = new Set<WatchStateReport['owner']>(['watch', 'phone']);
const HEALTH = new Set<WatchStateReport['health']>(['recording', 'unavailable', 'denied', 'off']);

const stringOrNull = (value: unknown): string | null => (typeof value === 'string' ? value : null);
const numberOrNull = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;

/** A report as the watch sent it, or null for one this phone cannot read. */
function readReport(json: string): WatchStateReport | null {
  let value: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(json);
    if (typeof parsed !== 'object' || parsed === null) return null;
    value = parsed as Record<string, unknown>;
  } catch {
    return null;
  }
  const { at, seq, session, owner } = value;
  if (typeof at !== 'string' || typeof seq !== 'number' || !Number.isFinite(seq)) return null;
  if (!SESSIONS.has(session as WatchStateReport['session'])) return null;
  if (!OWNERS.has(owner as WatchStateReport['owner'])) return null;
  const rest = value.rest as { endsAt?: unknown; upNext?: { name?: unknown; detail?: unknown } } | null | undefined;
  return {
    v: WATCH_PROTOCOL_VERSION,
    at,
    seq,
    workoutId: stringOrNull(value.workoutId),
    session: session as WatchStateReport['session'],
    owner: owner as WatchStateReport['owner'],
    seenPhoneClaim: stringOrNull(value.seenPhoneClaim),
    setId: stringOrNull(value.setId),
    rest:
      rest && typeof rest.endsAt === 'string'
        ? {
            endsAt: rest.endsAt,
            upNext: {
              name: typeof rest.upNext?.name === 'string' ? rest.upNext.name : '',
              detail: typeof rest.upNext?.detail === 'string' ? rest.upNext.detail : '',
            },
          }
        : null,
    heartRate: numberOrNull(value.heartRate),
    activeKcal: numberOrNull(value.activeKcal),
    health: HEALTH.has(value.health as WatchStateReport['health'])
      ? (value.health as WatchStateReport['health'])
      : 'off',
  };
}

/** One report, stamped by the native side with the phone's clock, into the store. */
function takeState(json: string | null | undefined, receivedAt: number | null | undefined): void {
  if (typeof json !== 'string' || typeof receivedAt !== 'number') return;
  const report = readReport(json);
  if (!report) {
    console.warn('GymGo: an unreadable state report from the watch', json);
    return;
  }
  reportFromWatch({ ...report, receivedAt });
}

async function readLastState(): Promise<void> {
  const { json, receivedAt } = await WatchBridge.lastState();
  takeState(json, receivedAt);
}

// ---------------------------------------------------------------------------
// The context
// ---------------------------------------------------------------------------

const describe: DescribeStation = (entries) => ({ name: stationName(entries), outline: stationOutline(entries) });

async function buildContext(): Promise<WatchContext> {
  const settings = await db.settings.get(SETTINGS_ID);
  return watchContextFor(new Date(), describe, {
    phoneClaim: phoneClaim(),
    settings: { sound: settings?.sound_on ?? true, vibrate: settings?.vibrate_on ?? true },
  });
}

/** No watch at all, as far as can be told: building a context would be work for nobody. */
function nobodyToSendTo(status: WatchStatus | null): boolean {
  if (!status) return false;
  if (!status.supported) return true;
  // Until the session is up nothing is known: send, and the native side holds it until it can go.
  // Paired without GymGo installed: send too, so it goes the moment GymGo is installed.
  return status.activated !== false && !status.paired;
}

async function sendNow(): Promise<void> {
  if (nobodyToSendTo(await WatchBridge.status().catch(() => null))) return;
  // A drain that runs while the context is being built can make it stale
  // (a start from the watch makes `ready` wrong): build it again after.
  for (let attempt = 0; attempt < 5; attempt += 1) {
    await drainsSettled();
    const before = drainsQueued;
    const context = await buildContext();
    if (drainsWaiting > 0 || drainsQueued !== before) continue;
    const json = JSON.stringify(context);
    if (json.length > CONTEXT_WARN_BYTES) {
      console.warn(`GymGo: the context for the watch is ${json.length} bytes, near WatchConnectivity's limit`);
    }
    await WatchBridge.sendContext({ json });
    // Not awaited: opening the watch app can take a while, and the next context must not wait for it.
    void wakeTheWatch(context).catch(warn('could not open GymGo on the watch'));
    return;
  }
}

let sendTimer: ReturnType<typeof setTimeout> | null = null;
let sending = false;
let sendAgain = false;

/** Sends a context soon. Calls within the delay send one. */
function requestSend(delay = SEND_DELAY_MS): void {
  if (sendTimer) clearTimeout(sendTimer);
  sendTimer = setTimeout(() => {
    sendTimer = null;
    flushSend();
  }, delay);
}

/** One send at a time, so an older context can never go out after a newer one. */
function flushSend(): void {
  if (sending) {
    sendAgain = true;
    return;
  }
  sending = true;
  void (async () => {
    try {
      do {
        sendAgain = false;
        await sendNow().catch(warn('could not send the context to the watch'));
      } while (sendAgain);
    } finally {
      sending = false;
    }
  })();
}

// ---------------------------------------------------------------------------
// Waking the watch
// ---------------------------------------------------------------------------

function readWoken(): string[] {
  try {
    const stored: unknown = JSON.parse(globalThis.localStorage?.getItem(WOKEN_KEY) ?? '[]');
    return Array.isArray(stored) ? stored.filter((id): id is string => typeof id === 'string') : [];
  } catch {
    return [];
  }
}

function rememberWoken(workoutId: string): void {
  const woken = [...readWoken().filter((id) => id !== workoutId), workoutId].slice(-WOKEN_KEPT);
  try {
    globalThis.localStorage?.setItem(WOKEN_KEY, JSON.stringify(woken));
  } catch {
    // Forgotten after a reload: at worst the watch is opened once more, and it ignores a second start.
  }
}

/** Workouts being decided on right now, so two sends in quick succession wake the watch once. */
const deciding = new Set<string>();

/**
 * A workout open on the phone that the watch has not reported yet: open GymGo
 * on the watch, which starts its workout session and takes the live session
 * from the context that has just gone. Each workout gets one decision, whether
 * or not it woke anything, so ending the watch's session never brings it back.
 */
async function wakeTheWatch(context: WatchContext): Promise<void> {
  const workoutId = context.live?.workoutId;
  if (!workoutId || deciding.has(workoutId) || readWoken().includes(workoutId)) return;
  deciding.add(workoutId);
  try {
    const status = await WatchBridge.status();
    // Until the session is up there is no telling: decide on a later send.
    if (status.supported && status.activated === false) return;
    rememberWoken(workoutId);
    if (!status.supported || !status.paired || !status.installed) return;
    // The watch knows this workout already: running it, or ended it. Opened for
    // one it has ended, it would start a Health recording that belongs to no
    // workout, and nothing would end it.
    if (getWatchState().report?.workoutId === workoutId) return;
    const { started, error } = await WatchBridge.startWatchWorkout();
    if (!started) console.warn('GymGo: could not open GymGo on the watch', error);
  } finally {
    deciding.delete(workoutId);
  }
}

// ---------------------------------------------------------------------------
// Starting the link
// ---------------------------------------------------------------------------

/** What in the settings row reaches the watch; `last_synced_at` is bookkeeping and must not send a context. */
function settingsFingerprint(settings: Settings | undefined): string {
  return settings ? JSON.stringify({ ...settings, last_synced_at: null }) : '';
}

function watchTheDatabase(): void {
  // Any change to what the context is built from sends a new one. Returning a
  // new value every time makes every change count, including an update that
  // leaves the counts as they were.
  liveQuery(async () => {
    await Promise.all([
      db.workouts.count(),
      db.workout_exercises.count(),
      db.sets.count(),
      db.routines.count(),
      db.routine_exercises.count(),
      db.plans.count(),
      db.exercises.count(),
      db.gyms.count(),
    ]);
    return Date.now();
  }).subscribe({
    next: () => requestSend(),
    error: warn('the watch link stopped watching the database'),
  });

  // Settings separately: a sync round writes its cursor there every time.
  let settingsSeen: string | null = null;
  liveQuery(async () => settingsFingerprint(await db.settings.get(SETTINGS_ID))).subscribe({
    next: (fingerprint) => {
      if (settingsSeen !== null && fingerprint !== settingsSeen) requestSend();
      settingsSeen = fingerprint;
    },
    error: warn('the watch link stopped watching the settings'),
  });
}

function armMidnight(): void {
  const now = new Date();
  const next = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 5);
  setTimeout(() => {
    requestSend(0);
    armMidnight();
  }, next.getTime() - now.getTime());
}

/**
 * Launch and resume: the watch's newest state and everything it sent, then a
 * fresh context. The drain is queued before anything is awaited, so no send
 * can slip in ahead of it.
 */
async function catchUp(): Promise<void> {
  const drained = drainWatchInbox();
  await readLastState().catch(warn('could not read the watch state'));
  await drained;
  requestSend(0);
}

let started = false;

/** Starts the link. Inside the app only, once. */
export function startWatchLink(): void {
  if (!isNativeApp() || started) return;
  started = true;
  void (async () => {
    // Listeners first, so nothing that lands before the first drain is missed.
    await Promise.all([
      WatchBridge.addListener('inbox', () => void drainWatchInbox()),
      WatchBridge.addListener('watchState', (state) => takeState(state.json, state.receivedAt)),
      App.addListener('resume', () => void catchUp()),
    ]);
    const caughtUp = catchUp();
    let takeBack = getWatchState().takeBack;
    subscribeWatchState(() => {
      const next = getWatchState().takeBack;
      if (next === takeBack) return;
      takeBack = next;
      // The watch has to hear "Log on this phone" now, not a moment later.
      requestSend(0);
    });
    watchTheDatabase();
    armMidnight();
    await caughtUp;
  })().catch(warn('could not start the watch link'));
}
