import { describe, expect, it } from 'vitest';
import {
  companionTargets,
  loggingSurface,
  openStations,
  staleAfter,
  watchReclaimed,
  watchStation,
  WATCH_PAUSED_STALE_MS,
  WATCH_STALE_MS,
  type TakeBack,
} from './companion';
import { nextStation } from './supersets';
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
  inHand: null,
  rest: null,
  skipped: [],
  paused: null,
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

  it('4. a paused watch counts for an hour, not five minutes', () => {
    expect(WATCH_PAUSED_STALE_MS).toBe(3_600_000);
    const paused = '2026-10-14T18:00:00.000Z';
    // Thirty minutes of silence: a recording watch has gone, a paused one is on a break.
    const halfAnHour = NOW - 30 * 60_000;
    expect(loggingSurface(report({ receivedAt: halfAnHour, paused }), 'w-1', NOW, null)).toEqual({ on: 'watch' });
    expect(loggingSurface(report({ receivedAt: halfAnHour, paused: null }), 'w-1', NOW, null)).toEqual({
      on: 'phone',
      why: 'stale',
    });
    // The hour exactly still counts; a moment past it does not.
    const exactly = report({ receivedAt: NOW - WATCH_PAUSED_STALE_MS, paused });
    expect(loggingSurface(exactly, 'w-1', NOW, null)).toEqual({ on: 'watch' });
    const past = report({ receivedAt: NOW - WATCH_PAUSED_STALE_MS - 1, paused });
    expect(loggingSurface(past, 'w-1', NOW, null)).toEqual({ on: 'phone', why: 'stale' });
  });

  it('4. resuming goes back to five minutes', () => {
    const resumed = report({ receivedAt: NOW - WATCH_STALE_MS - 1, paused: null });
    expect(loggingSurface(resumed, 'w-1', NOW, null)).toEqual({ on: 'phone', why: 'stale' });
  });

  it('4. a pause holds nothing else: an ended session, another workout or a take-back still give the phone', () => {
    const paused = '2026-10-14T18:00:00.000Z';
    expect(loggingSurface(report({ paused, session: 'ended' }), 'w-1', NOW, null)).toEqual({ on: 'phone', why: 'ended' });
    expect(loggingSurface(report({ paused, workoutId: 'w-2' }), 'w-1', NOW, null)).toEqual({
      on: 'phone',
      why: 'other-workout',
    });
    expect(loggingSurface(report({ paused }), 'w-1', NOW, takeBack())).toEqual({ on: 'phone', why: 'taken-back' });
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

describe('staleAfter: how long a report counts for', () => {
  it('five minutes while the watch records, an hour while it is paused', () => {
    expect(staleAfter({ paused: null })).toBe(WATCH_STALE_MS);
    expect(staleAfter({ paused: '2026-10-14T18:00:00.000Z' })).toBe(WATCH_PAUSED_STALE_MS);
    expect(staleAfter(report())).toBe(WATCH_STALE_MS);
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

describe('openStations: which stations have work left', () => {
  // Bench alone, a superset of curls and pushdowns, then rows.
  const set = (id: string, completed = false) => ({ id, completed });
  const exercises = [
    { sets: [set('bench-1', true), set('bench-2')] },
    { sets: [set('curl-1', true), set('curl-2')] },
    { sets: [set('row-1')] },
    { sets: [set('push-1', true), set('push-2')] },
  ];
  const stations = [[0], [1, 3], [2]];

  it('a station is open while anything in it is unticked', () => {
    expect(openStations(stations, exercises)).toEqual([true, true, true]);
    const done = exercises.map((entry) => ({ sets: entry.sets.map((each) => ({ ...each, completed: true })) }));
    expect(openStations(stations, done)).toEqual([false, false, false]);
  });

  it('a set skipped on the wrist is not left to do', () => {
    expect(openStations(stations, exercises, ['row-1'])).toEqual([true, true, false]);
    // Skipping one member of a superset leaves the station open while its partner has work.
    expect(openStations(stations, exercises, ['curl-2'])).toEqual([true, true, true]);
    expect(openStations(stations, exercises, ['curl-2', 'push-2'])).toEqual([true, false, true]);
  });

  it("so the companion's Up next is the station the watch goes to", () => {
    // The watch is on the bench and skipped the superset: rows are next, not the superset.
    expect(nextStation(openStations(stations, exercises, ['curl-2', 'push-2']), 0)).toBe(2);
    expect(nextStation(openStations(stations, exercises), 0)).toBe(1);
  });

  it('skipping a set the session no longer has changes nothing', () => {
    expect(openStations(stations, exercises, ['gone'])).toEqual([true, true, true]);
    expect(openStations([[7]], exercises, [])).toEqual([false]);
  });
});

describe("companionTargets: each member's next set on the companion's card", () => {
  // A1/A2 superset of three rounds: A1 has done two, A2 one.
  const set = (id: string, completed = false) => ({ id, type: 'working', completed, parent_set_id: null });
  const a1 = [set('a1-1', true), set('a1-2', true), set('a1-3')];
  const a2 = [set('a2-1', true), set('a2-2'), set('a2-3')];

  it("shows the partner's next set the watch will ask for, past one it skipped", () => {
    // A2's set 2 was skipped on the wrist, so the watch went on to A1's set 3,
    // and the next A2 set it asks for is set 3, not the one skipped.
    expect(companionTargets([a1, a2], 'a1-3', ['a2-2'])).toEqual({ watchMember: 0, current: 0, targets: ['a1-3', 'a2-3'], skippedOnly: [false, false] });
    // Nothing skipped: A2's set 2 is still to come.
    expect(companionTargets([a1, a2], 'a1-3', [])).toEqual({ watchMember: 0, current: 0, targets: ['a1-3', 'a2-2'], skippedOnly: [false, false] });
  });

  it('with the watch on no set here, the current member is the one the watch goes to next', () => {
    // A skipped set counts as passed rather than taken out, so the rounds stay
    // in line: round 3 starts with A1. Taken out, A2's set 3 would slide into
    // round 2 and A2 would be marked current.
    expect(companionTargets([a1, a2], null, ['a2-2'])).toEqual({ watchMember: -1, current: 0, targets: ['a1-3', 'a2-3'], skippedOnly: [false, false] });
    expect(companionTargets([a1, a2], null, [])).toEqual({ watchMember: -1, current: 1, targets: ['a1-3', 'a2-2'], skippedOnly: [false, false] });
  });

  it('a member whose sets left were all skipped has nothing the watch will ask for', () => {
    const { targets, skippedOnly } = companionTargets([a1, a2], 'a1-3', ['a2-2', 'a2-3']);
    expect(targets).toEqual(['a1-3', null]);
    // Skipped, not done: the card must not say "All sets done".
    expect(skippedOnly).toEqual([false, true]);
  });

  it('a station with only skipped sets left gets them back, as the watch does when it goes there', () => {
    const rows = [set('row-1', true), set('row-2'), set('row-3')];
    expect(companionTargets([rows], null, ['row-2', 'row-3'])).toEqual({
      watchMember: -1,
      current: 0,
      targets: ['row-2'],
      skippedOnly: [false],
    });
  });
});
