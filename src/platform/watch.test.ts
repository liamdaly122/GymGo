import 'fake-indexeddb/auto';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { WatchContext, WatchEvent, WatchStateReport } from '@/domain/watchProtocol';
import stateFixtures from '../../fixtures/watch/state.json';

/**
 * The link's web side, against a stand-in for the native plugin. The native
 * side itself (ios/App/App/WatchLink.swift) is checked by building the App
 * target and on the real devices; what is held here is the order things
 * happen in, which is where the build 4 bugs were.
 */
type Listener = (data: never) => void;

const h = vi.hoisted(() => {
  const storage = new Map<string, string>();
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => void storage.set(key, value),
      removeItem: (key: string) => void storage.delete(key),
    },
  });

  const state = {
    native: false,
    log: [] as string[],
    listeners: new Map<string, Listener[]>(),
    inbox: [] as string[],
    acknowledged: [] as string[][],
    sent: [] as string[],
    status: { supported: true, activated: true, paired: true, installed: true, reachable: true },
    lastState: { json: null as string | null, receivedAt: null as number | null },
    drainGate: null as Promise<void> | null,
  };
  const listen = (prefix: string) => async (event: string, listener: Listener) => {
    state.log.push(`${prefix}${event}`);
    state.listeners.set(event, [...(state.listeners.get(event) ?? []), listener]);
    return { remove: async () => {} };
  };
  const bridge = {
    addListener: listen('listen:'),
    drainInbox: async () => {
      state.log.push('drain');
      if (state.drainGate) await state.drainGate;
      return { events: [...state.inbox] };
    },
    acknowledge: async ({ ids }: { ids: string[] }) => {
      state.log.push('ack');
      state.acknowledged.push(ids);
    },
    lastState: async () => {
      state.log.push('lastState');
      return state.lastState;
    },
    sendContext: async ({ json }: { json: string }) => {
      state.log.push('send');
      state.sent.push(json);
    },
    startWatchWorkout: vi.fn(async () => {
      state.log.push('startWatch');
      return { started: true };
    }),
    status: async () => ({ ...state.status }),
  };
  const emit = (event: string, data?: unknown) => {
    for (const listener of state.listeners.get(event) ?? []) listener(data as never);
  };
  return { state, bridge, app: { addListener: listen('app:') }, emit };
});

vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: () => h.state.native },
  registerPlugin: () => h.bridge,
}));
vi.mock('@capacitor/app', () => ({ App: h.app }));
vi.mock('./snapshots', () => ({ snapshotEverything: vi.fn(async () => {}) }));
vi.mock('@/db/watch', () => ({ applyWatchEvents: vi.fn(), watchContextFor: vi.fn() }));

const { db } = await import('@/db/db');
const { applyWatchEvents, watchContextFor } = await import('@/db/watch');
const { snapshotEverything } = await import('./snapshots');
const { getWatchState, reportFromWatch, resetWatchState, takeLoggingBack, clearTakeBack } = await import('./watchState');
const { drainWatchInbox, startWatchLink } = await import('./watch');

const applyMock = vi.mocked(applyWatchEvents);
const contextMock = vi.mocked(watchContextFor);

const context = (liveWorkoutId: string | null = null): WatchContext =>
  ({
    v: 1,
    sentAt: new Date().toISOString(),
    live: liveWorkoutId ? { workoutId: liveWorkoutId } : null,
    home: { today: '2026-10-14', state: 'noPlan', doneToday: [], closed: [], ready: null, week: [] },
    phoneClaim: null,
    settings: { sound: true, vibrate: true },
  }) as unknown as WatchContext;

const event = (id: string, kind: WatchEvent['kind'] = 'completeSet'): string =>
  JSON.stringify({ id, kind, workoutId: 'w-1', at: '2026-10-14T18:00:00.000Z', setId: 's-1', weight: 100, reps: 5 });

const report = (overrides: Partial<WatchStateReport>): string =>
  JSON.stringify({
    v: 1, at: '2026-10-14T18:00:00.000Z', seq: 1, workoutId: 'w-1', session: 'running', owner: 'watch',
    seenPhoneClaim: null, setId: null, rest: null, heartRate: 120, activeKcal: 40, health: 'recording',
    ...overrides,
  });

const sentCount = () => h.state.log.filter((entry) => entry === 'send').length;
const waitFor = (check: () => void) => vi.waitFor(check, { timeout: 3000, interval: 20 });
const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
/** Long enough for a debounced send to have gone, if one was coming. */
const quiet = () => pause(700);

/** Something that sends a context at once, without touching the database. */
async function nudge(): Promise<void> {
  const before = sentCount();
  takeLoggingBack('nudge', new Date().toISOString());
  await waitFor(() => expect(sentCount()).toBeGreaterThan(before));
  clearTakeBack();
  await waitFor(() => expect(sentCount()).toBeGreaterThan(before + 1));
}

beforeEach(() => {
  h.state.status = { supported: true, activated: true, paired: true, installed: true, reachable: true };
  h.state.inbox = [];
  h.state.drainGate = null;
  applyMock.mockReset();
  applyMock.mockResolvedValue({ acknowledge: [], keep: [], finished: [], revived: [] });
  contextMock.mockReset();
  contextMock.mockImplementation(async () => context());
  vi.mocked(snapshotEverything).mockClear();
  h.bridge.startWatchWorkout.mockClear();
});

afterAll(async () => {
  resetWatchState();
  await db.delete();
});

describe('outside the app', () => {
  it('does nothing at all', async () => {
    startWatchLink();
    await drainWatchInbox();
    await pause(50);
    expect(h.state.log).toEqual([]);
    h.state.native = true;
  });
});

describe('the link with the watch, inside the app', () => {
  it('listens before it first drains or reads the state, then sends a context', async () => {
    h.state.lastState = { json: report({ seq: 3, setId: 'from-launch' }), receivedAt: 1_000 };
    startWatchLink();
    await waitFor(() => expect(h.state.log).toContain('send'));
    const at = (entry: string) => h.state.log.indexOf(entry);
    expect(at('listen:inbox')).toBeGreaterThanOrEqual(0);
    expect(at('listen:watchState')).toBeGreaterThanOrEqual(0);
    expect(at('app:resume')).toBeGreaterThanOrEqual(0);
    for (const first of ['lastState', 'drain']) {
      expect(at(first)).toBeGreaterThan(at('listen:inbox'));
      expect(at(first)).toBeGreaterThan(at('listen:watchState'));
    }
    // The report the native side kept, with the phone's clock reading from when it arrived.
    expect(getWatchState().report).toMatchObject({ seq: 3, setId: 'from-launch', receivedAt: 1_000 });
    expect(JSON.parse(h.state.sent.at(-1)!)).toMatchObject({ v: 1, live: null });
    await quiet();
  });

  it('acknowledges what was applied or skipped, and unreadable events, and leaves the rest', async () => {
    h.state.inbox = [event('a'), event('b'), 'not json, "id": "bad-1"', '{"id":"bad-2"}', '{"kind":"finish"}'];
    applyMock.mockResolvedValue({ acknowledge: ['a'], keep: ['b'], finished: [], revived: [] });
    await drainWatchInbox();
    expect(applyMock).toHaveBeenCalledTimes(1);
    expect(applyMock.mock.calls[0]![0].map((e) => e.id)).toEqual(['a', 'b']);
    expect(h.state.acknowledged.at(-1)).toEqual(['a', 'bad-1', 'bad-2']);
    expect(snapshotEverything).not.toHaveBeenCalled();
  });

  it('writes the phone snapshot when a drain finished a workout', async () => {
    h.state.inbox = [event('f', 'finish')];
    applyMock.mockResolvedValue({ acknowledge: ['f'], keep: [], finished: ['w-1'], revived: [] });
    await drainWatchInbox();
    expect(snapshotEverything).toHaveBeenCalledTimes(1);
  });

  it('writes it again when a drain put a late set back into a finished workout', async () => {
    h.state.inbox = [event('late')];
    applyMock.mockResolvedValue({ acknowledge: ['late'], keep: [], finished: [], revived: ['w-1'] });
    await drainWatchInbox();
    expect(snapshotEverything).toHaveBeenCalledTimes(1);
  });

  it('acknowledges nothing when nothing was applied, and survives a drain that throws', async () => {
    const before = h.state.acknowledged.length;
    h.state.inbox = [event('t')];
    applyMock.mockRejectedValue(new Error('IndexedDB went away'));
    await expect(drainWatchInbox()).resolves.toBeUndefined();
    applyMock.mockResolvedValue({ acknowledge: [], keep: ['t'], finished: [], revived: [] });
    await drainWatchInbox();
    expect(h.state.acknowledged.length).toBe(before);
  });

  it('drains when something lands', async () => {
    h.state.inbox = [event('landed')];
    applyMock.mockResolvedValue({ acknowledge: ['landed'], keep: [], finished: [], revived: [] });
    h.emit('inbox');
    await waitFor(() => expect(h.state.acknowledged.at(-1)).toEqual(['landed']));
  });

  it('puts each state report in the store with the receivedAt the phone stamped', async () => {
    h.emit('watchState', { json: report({ seq: 10, at: '2026-10-14T18:10:00.000Z', setId: 's-9' }), receivedAt: 5_000 });
    expect(getWatchState().report).toMatchObject({ seq: 10, setId: 's-9', receivedAt: 5_000, heartRate: 120 });
    h.emit('watchState', { json: '{"seq":"eleven"}', receivedAt: 6_000 });
    h.emit('watchState', { json: report({ seq: 11, at: '2026-10-14T18:11:00.000Z', session: 'paused' as never }), receivedAt: 6_000 });
    expect(getWatchState().report?.seq).toBe(10);
  });

  it('reads every field of the reports the watch writes (fixtures/watch/state.json)', async () => {
    const cases = stateFixtures as unknown as Array<{ name: string; report: WatchStateReport }>;
    expect(cases.length).toBeGreaterThan(1);
    for (const { name, report: sent } of cases) {
      resetWatchState();
      h.emit('watchState', { json: JSON.stringify(sent), receivedAt: 9_000 });
      expect(getWatchState().report, name).toEqual({ ...sent, receivedAt: 9_000 });
    }
  });

  it('reads a build 6 report with nothing skipped, not paused, no set in hand and no rest start', async () => {
    const restWithoutStart = { endsAt: '2026-10-14T18:02:30.000Z', upNext: { name: 'Lift a', detail: 'Set 2 of 3 · 100 × 5' } };
    h.emit('watchState', { json: report({ seq: 12, at: '2026-10-14T18:12:00.000Z', rest: restWithoutStart }), receivedAt: 7_000 });
    const read = getWatchState().report!;
    expect(read).toMatchObject({ seq: 12, skipped: [], paused: null, inHand: null, rest: restWithoutStart });
    expect(read.rest).not.toHaveProperty('startedAt');
  });

  it('keeps only what it can read of the new fields', async () => {
    h.emit('watchState', {
      json: report({
        seq: 13, at: '2026-10-14T18:13:00.000Z',
        skipped: ['s-1', 7, null, 's-2'] as never, paused: 12 as never, inHand: { detail: 'Set 1 of 3' } as never,
        rest: { endsAt: '2026-10-14T18:15:00.000Z', startedAt: 5 as never, upNext: { name: 'Lift a', detail: '' } },
      }),
      receivedAt: 8_000,
    });
    const read = getWatchState().report!;
    expect(read).toMatchObject({ seq: 13, skipped: ['s-1', 's-2'], paused: null, inHand: null });
    expect(read.rest).not.toHaveProperty('startedAt');
  });

  it('never sends while a drain is running, and sends once it is over', async () => {
    let open!: () => void;
    h.state.drainGate = new Promise<void>((resolve) => (open = resolve));
    h.state.inbox = [event('slow')];
    applyMock.mockResolvedValue({ acknowledge: ['slow'], keep: [], finished: [], revived: [] });
    const drained = drainWatchInbox();
    const before = sentCount();
    takeLoggingBack('w-claim', '2026-10-14T18:20:00.000Z');
    await quiet();
    expect(sentCount()).toBe(before);
    open();
    await drained;
    await waitFor(() => expect(sentCount()).toBe(before + 1));
    const log = h.state.log;
    expect(log.lastIndexOf('send')).toBeGreaterThan(log.lastIndexOf('ack'));
    // The take-back went into the context.
    expect(contextMock.mock.calls.at(-1)![2].phoneClaim).toEqual({ workoutId: 'w-claim', at: '2026-10-14T18:20:00.000Z' });
    clearTakeBack();
    await quiet();
  });

  it('builds the context again when a drain ran while it was being built', async () => {
    let open!: () => void;
    const gate = new Promise<void>((resolve) => (open = resolve));
    contextMock.mockImplementationOnce(async () => {
      await gate;
      return context('stale');
    });
    const before = sentCount();
    takeLoggingBack('w-claim-2');
    await waitFor(() => expect(contextMock).toHaveBeenCalledTimes(1));
    const drained = drainWatchInbox();
    open();
    await drained;
    await waitFor(() => expect(sentCount()).toBe(before + 1));
    expect(contextMock).toHaveBeenCalledTimes(2);
    expect(JSON.parse(h.state.sent.at(-1)!).live).toBeNull();
    clearTakeBack();
    await quiet();
  });

  it('sends a context when the database changes, but not for a sync cursor', async () => {
    let before = sentCount();
    await db.table('workouts').put({ id: 'w-db', started_at: '2026-10-14T18:00:00.000Z', finished_at: null, deleted_at: null });
    await waitFor(() => expect(sentCount()).toBe(before + 1));
    before = sentCount();
    await db.table('sets').put({ id: 's-db', workout_exercise_id: 'we-1', set_index: 0, completed: false });
    await waitFor(() => expect(sentCount()).toBe(before + 1));
    before = sentCount();
    await db.table('sets').update('s-db', { completed: true });
    await waitFor(() => expect(sentCount()).toBe(before + 1));

    await db.table('settings').put({ id: 'settings', sound_on: true, vibrate_on: true, last_synced_at: null });
    await waitFor(() => expect(sentCount()).toBe(before + 2));
    before = sentCount();
    await db.table('settings').update('settings', { last_synced_at: '2026-10-14T18:30:00.000Z' });
    await quiet();
    expect(sentCount()).toBe(before);
    await db.table('settings').update('settings', { vibrate_on: false });
    await waitFor(() => expect(sentCount()).toBe(before + 1));
    expect(contextMock.mock.calls.at(-1)![2].settings).toEqual({ sound: true, vibrate: false });
  });

  it('catches up on resume: the newest state, the inbox, then a context', async () => {
    h.state.lastState = { json: report({ seq: 20, at: '2026-10-14T18:40:00.000Z', setId: 'on-resume' }), receivedAt: 9_000 };
    h.state.log.length = 0;
    h.emit('resume');
    await waitFor(() => expect(h.state.log).toContain('send'));
    expect(h.state.log.slice(0, 2)).toEqual(['lastState', 'drain']);
    expect(getWatchState().report?.setId).toBe('on-resume');
  });

  it('opens GymGo on the watch once for a workout started on the phone', async () => {
    contextMock.mockImplementation(async () => context('w-new'));
    h.state.log.length = 0;
    await nudge();
    await waitFor(() => expect(h.bridge.startWatchWorkout).toHaveBeenCalledTimes(1));
    // After the context that carries it, so the watch app finds the session when it opens.
    expect(h.state.log.indexOf('startWatch')).toBeGreaterThan(h.state.log.indexOf('send'));
    await nudge();
    await quiet();
    expect(h.bridge.startWatchWorkout).toHaveBeenCalledTimes(1);
  });

  it('does not open it for a workout the watch is already running', async () => {
    reportFromWatch({ ...JSON.parse(report({ seq: 30, at: '2026-10-14T19:00:00.000Z', workoutId: 'w-watch' })), receivedAt: Date.now() });
    contextMock.mockImplementation(async () => context('w-watch'));
    await nudge();
    await quiet();
    expect(h.bridge.startWatchWorkout).not.toHaveBeenCalled();
  });

  /**
   * Started and finished on the watch out of range: the start reaches the
   * phone before the finish, so the workout is live for a moment, but the
   * watch has already said it ended it. Woken, it started a Health recording
   * that belonged to no workout.
   */
  it('does not open it for a workout the watch has already ended', async () => {
    reportFromWatch({
      ...JSON.parse(report({ seq: 31, at: '2026-10-14T19:05:00.000Z', workoutId: 'w-ended', session: 'ended', health: 'off' })),
      receivedAt: Date.now(),
    });
    contextMock.mockImplementation(async () => context('w-ended'));
    await nudge();
    await quiet();
    expect(h.bridge.startWatchWorkout).not.toHaveBeenCalled();
  });

  it('does not open it without a paired watch with GymGo on it, and decides each workout once', async () => {
    h.state.status.installed = false;
    contextMock.mockImplementation(async () => context('w-no-app'));
    await nudge();
    await quiet();
    h.state.status.installed = true;
    await nudge();
    await quiet();
    expect(h.bridge.startWatchWorkout).not.toHaveBeenCalled();
  });

  it('waits for the session to be up before deciding', async () => {
    h.state.status = { supported: true, activated: false, paired: false, installed: false, reachable: false };
    contextMock.mockImplementation(async () => context('w-early'));
    await nudge();
    await quiet();
    expect(h.bridge.startWatchWorkout).not.toHaveBeenCalled();
    h.state.status = { supported: true, activated: true, paired: true, installed: true, reachable: false };
    await nudge();
    await waitFor(() => expect(h.bridge.startWatchWorkout).toHaveBeenCalledTimes(1));
  });

  it('builds nothing when no watch is paired', async () => {
    h.state.status = { supported: true, activated: true, paired: false, installed: false, reachable: false };
    const before = sentCount();
    takeLoggingBack('w-unpaired');
    await quiet();
    clearTakeBack();
    await quiet();
    expect(contextMock).not.toHaveBeenCalled();
    expect(sentCount()).toBe(before);
  });
});
