import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ReceivedWatchState } from '@/domain/watchProtocol';
import {
  clearTakeBack,
  getWatchState,
  phoneClaim,
  reportFromWatch,
  resetWatchState,
  subscribeWatchState,
  takeLoggingBack,
} from './watchState';

const report = (overrides: Partial<ReceivedWatchState>): ReceivedWatchState => ({
  v: 1, at: '2026-10-14T18:00:00.000Z', seq: 1, workoutId: 'w-1', session: 'running', owner: 'watch',
  seenPhoneClaim: null, setId: null, inHand: null, rest: null, skipped: [], paused: null,
  heartRate: null, activeKcal: null, health: 'recording',
  receivedAt: 1, ...overrides,
});

afterEach(() => {
  resetWatchState();
  vi.unstubAllGlobals();
});

describe('the watch state store', () => {
  it('starts knowing nothing', () => {
    expect(getWatchState()).toEqual({ report: null, takeBack: null });
  });

  it('tells subscribers, and hands out a new object only when something changed', () => {
    const listener = vi.fn();
    const unsubscribe = subscribeWatchState(listener);
    const before = getWatchState();
    reportFromWatch(report({ seq: 1 }));
    expect(listener).toHaveBeenCalledTimes(1);
    expect(getWatchState()).not.toBe(before);
    unsubscribe();
    reportFromWatch(report({ seq: 2, at: '2026-10-14T18:01:00.000Z' }));
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('ignores an older report, so a slow copy never undoes a fast one', () => {
    reportFromWatch(report({ seq: 5, at: '2026-10-14T18:05:00.000Z', setId: 'new' }));
    reportFromWatch(report({ seq: 4, at: '2026-10-14T18:04:00.000Z', setId: 'old' }));
    expect(getWatchState().report?.setId).toBe('new');
  });

  it('takes a report from a reinstalled watch app, whose count starts again', () => {
    reportFromWatch(report({ seq: 50, at: '2026-10-14T18:05:00.000Z' }));
    reportFromWatch(report({ seq: 1, at: '2026-10-14T18:30:00.000Z', setId: 'after reinstall' }));
    expect(getWatchState().report?.setId).toBe('after reinstall');
  });

  it('keeps a take-back across a reload, and forgets it on request', () => {
    const storage = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => void storage.set(key, value),
      removeItem: (key: string) => void storage.delete(key),
    });
    const claim = takeLoggingBack('w-1', '2026-10-14T18:10:00.000Z');
    expect(phoneClaim()).toEqual(claim);
    expect(JSON.parse(storage.get('gymgo.watch.takeBack')!)).toEqual(claim);
    clearTakeBack();
    expect(phoneClaim()).toBeNull();
    expect(storage.has('gymgo.watch.takeBack')).toBe(false);
  });

  it('still takes logging back where storage refuses', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => { throw new Error('denied'); },
      setItem: () => { throw new Error('denied'); },
      removeItem: () => { throw new Error('denied'); },
    });
    expect(takeLoggingBack('w-1').workoutId).toBe('w-1');
    expect(phoneClaim()?.workoutId).toBe('w-1');
  });
});
