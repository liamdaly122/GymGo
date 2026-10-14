import { describe, expect, it } from 'vitest';
import { loggingSurface, watchReclaimed, watchStation, WATCH_STALE_MS, type TakeBack } from './companion';
import type { ReceivedWatchState } from './watchProtocol';

/** The phone's clock for every case: a fixed moment, epoch ms. */
const NOW = Date.parse('2026-10-14T18:30:00.000Z');

const report = (overrides: Partial<ReceivedWatchState> = {}): ReceivedWatchState => ({
  v: 1,
  at: '2026-10-14T18:29:50.000Z',
  seq: 7,
  workoutId: 'w-1',
  session: 'running',
  owner: 'watch',
  seenPhoneClaim: null,
  setId: 's-2',
  rest: null,
  heartRate: 128,
  activeKcal: 210,
  health: 'recording',
  receivedAt: NOW - 10_000,
  ...overrides,
});

const takeBack = (overrides: Partial<TakeBack> = {}): TakeBack => ({
  workoutId: 'w-1',
  at: '2026-10-14T18:25:00.000Z',
  ...overrides,
});

describe('loggingSurface: who logs sets', () => {
  it('the watch logs when it is running this workout, fresh, and owns it', () => {
    expect(loggingSurface(report(), 'w-1', NOW, null)).toEqual({ on: 'watch' });
  });

  it('1. no report at all: the phone, because there is no watch', () => {
    expect(loggingSurface(null, 'w-1', NOW, null)).toEqual({ on: 'phone', why: 'no-watch' });
    expect(loggingSurface(null, 'w-1', NOW, takeBack())).toEqual({ on: 'phone', why: 'no-watch' });
  });

  it('2. a report for another workout, or for none: the phone', () => {
    expect(loggingSurface(report({ workoutId: 'w-2' }), 'w-1', NOW, null)).toEqual({ on: 'phone', why: 'other-workout' });
    expect(loggingSurface(report({ workoutId: null, session: 'none' }), 'w-1', NOW, null)).toEqual({
      on: 'phone',
      why: 'other-workout',
    });
  });

  it('3. a session that ended, or never started: the phone', () => {
    expect(loggingSurface(report({ session: 'ended' }), 'w-1', NOW, null)).toEqual({ on: 'phone', why: 'ended' });
    expect(loggingSurface(report({ session: 'none' }), 'w-1', NOW, null)).toEqual({ on: 'phone', why: 'ended' });
  });

  it('4. stale is more than five minutes on the phone clock, not five minutes exactly', () => {
    expect(WATCH_STALE_MS).toBe(300_000);
    const exactly = report({ receivedAt: NOW - WATCH_STALE_MS });
    expect(loggingSurface(exactly, 'w-1', NOW, null)).toEqual({ on: 'watch' });
    const past = report({ receivedAt: NOW - WATCH_STALE_MS - 1 });
    expect(loggingSurface(past, 'w-1', NOW, null)).toEqual({ on: 'phone', why: 'stale' });
  });

  it('4. staleness ignores the watch clock: an old `at` received just now is fresh', () => {
    const skewed = report({ at: '2026-10-14T17:00:00.000Z', receivedAt: NOW - 1_000 });
    expect(loggingSurface(skewed, 'w-1', NOW, null)).toEqual({ on: 'watch' });
  });

  it('5. the watch says the phone logs, with or without a take-back stored here', () => {
    expect(loggingSurface(report({ owner: 'phone' }), 'w-1', NOW, null)).toEqual({ on: 'phone', why: 'taken-back' });
    const confirmed = report({ owner: 'phone', seenPhoneClaim: takeBack().at });
    expect(loggingSurface(confirmed, 'w-1', NOW, takeBack())).toEqual({ on: 'phone', why: 'taken-back' });
  });

  it('6. a take-back the watch has not seen yet switches at once', () => {
    expect(loggingSurface(report({ seenPhoneClaim: null }), 'w-1', NOW, takeBack())).toEqual({
      on: 'phone',
      why: 'taken-back',
    });
  });

  it('6. a take-back newer than the claim the watch has seen still counts', () => {
    const older = report({ seenPhoneClaim: '2026-10-14T18:20:00.000Z' });
    expect(loggingSurface(older, 'w-1', NOW, takeBack())).toEqual({ on: 'phone', why: 'taken-back' });
  });

  it('6. the watch reclaimed after seeing the take-back: the watch logs', () => {
    const same = report({ seenPhoneClaim: takeBack().at });
    expect(loggingSurface(same, 'w-1', NOW, takeBack())).toEqual({ on: 'watch' });
    const later = report({ seenPhoneClaim: '2026-10-14T18:26:00.000Z' });
    expect(loggingSurface(later, 'w-1', NOW, takeBack())).toEqual({ on: 'watch' });
  });

  it('6. a take-back for another workout is not this one', () => {
    expect(loggingSurface(report(), 'w-1', NOW, takeBack({ workoutId: 'w-0' }))).toEqual({ on: 'watch' });
  });

  it('6. a claim time that will not parse proves nothing, so the phone keeps logging', () => {
    const garbled = report({ seenPhoneClaim: 'not a time' });
    expect(loggingSurface(garbled, 'w-1', NOW, takeBack())).toEqual({ on: 'phone', why: 'taken-back' });
    expect(loggingSurface(report({ seenPhoneClaim: takeBack().at }), 'w-1', NOW, takeBack({ at: 'garbled' }))).toEqual({
      on: 'phone',
      why: 'taken-back',
    });
  });

  it('applies the checks in order: the earliest reason wins', () => {
    // Another workout, ended, stale and owned by the phone: another workout first.
    const everything = report({ workoutId: 'w-2', session: 'ended', receivedAt: 0, owner: 'phone' });
    expect(loggingSurface(everything, 'w-1', NOW, takeBack())).toEqual({ on: 'phone', why: 'other-workout' });
    // Ended and stale: ended.
    expect(loggingSurface(report({ session: 'ended', receivedAt: 0 }), 'w-1', NOW, null)).toEqual({
      on: 'phone',
      why: 'ended',
    });
    // Stale and owned by the phone: stale.
    expect(loggingSurface(report({ receivedAt: 0, owner: 'phone' }), 'w-1', NOW, null)).toEqual({
      on: 'phone',
      why: 'stale',
    });
  });
});

describe('watchReclaimed: the watch took logging back from this phone', () => {
  it('only once the watch has seen the take-back and logs again', () => {
    expect(watchReclaimed(report({ seenPhoneClaim: takeBack().at }), 'w-1', NOW, takeBack())).toBe(true);
    expect(watchReclaimed(report({ seenPhoneClaim: null }), 'w-1', NOW, takeBack())).toBe(false);
    expect(watchReclaimed(report({ owner: 'phone', seenPhoneClaim: takeBack().at }), 'w-1', NOW, takeBack())).toBe(false);
  });

  it('never without a take-back for this workout', () => {
    expect(watchReclaimed(report(), 'w-1', NOW, null)).toBe(false);
    expect(watchReclaimed(report({ seenPhoneClaim: takeBack().at }), 'w-1', NOW, takeBack({ workoutId: 'w-0' }))).toBe(false);
    expect(watchReclaimed(null, 'w-1', NOW, takeBack())).toBe(false);
  });

  it('not from a watch that has since gone quiet or ended', () => {
    const quiet = report({ seenPhoneClaim: takeBack().at, receivedAt: NOW - WATCH_STALE_MS - 1 });
    expect(watchReclaimed(quiet, 'w-1', NOW, takeBack())).toBe(false);
    const ended = report({ seenPhoneClaim: takeBack().at, session: 'ended' });
    expect(watchReclaimed(ended, 'w-1', NOW, takeBack())).toBe(false);
  });
});

describe('watchStation: where the watch is', () => {
  // Bench alone, then a superset of curls and pushdowns, then rows.
  const exercises = [
    { sets: [{ id: 'bench-w1' }, { id: 'bench-1' }, { id: 'bench-2' }] },
    { sets: [{ id: 'curl-1' }, { id: 'curl-1-drop' }] },
    { sets: [{ id: 'row-1' }] },
    { sets: [{ id: 'push-1' }, { id: 'push-2' }] },
  ];
  const stations = [[0], [1, 3], [2]];

  it('finds a solo exercise, a warm-up included', () => {
    expect(watchStation(stations, exercises, 'bench-2')).toBe(0);
    expect(watchStation(stations, exercises, 'bench-w1')).toBe(0);
  });

  it('finds the superset by either member, wherever the member sits', () => {
    expect(watchStation(stations, exercises, 'curl-1')).toBe(1);
    expect(watchStation(stations, exercises, 'push-2')).toBe(1);
  });

  it('finds a child set by its exercise', () => {
    expect(watchStation(stations, exercises, 'curl-1-drop')).toBe(1);
  });

  it('says nothing for a set the session does not have, or for none', () => {
    expect(watchStation(stations, exercises, 'gone')).toBeNull();
    expect(watchStation(stations, exercises, null)).toBeNull();
    expect(watchStation([], [], 'bench-1')).toBeNull();
  });

  it('copes with a station pointing past the list', () => {
    expect(watchStation([[5]], exercises, 'bench-1')).toBeNull();
  });
});
