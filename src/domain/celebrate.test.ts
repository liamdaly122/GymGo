import { describe, expect, it } from 'vitest';
import { celebrationFor, CELEBRATE_WITHIN_MS } from './celebrate';
import { makeWorkout } from './testFactories';

/** The phone's clock for every case. */
const NOW = Date.parse('2026-10-14T19:00:00.000Z');
const ago = (ms: number) => new Date(NOW - ms).toISOString();
const HOUR = 60 * 60_000;

const finished = (id: string, finishedAgo: number, overrides: Parameters<typeof makeWorkout>[0] = {}) =>
  makeWorkout({ id, started_at: ago(finishedAgo + HOUR), finished_at: ago(finishedAgo), ...overrides });
const onWatch = (...ids: string[]) => ids.map((id) => ({ id, at: ago(0) }));

describe('celebrationFor: the poster Today still owes', () => {
  it('a session the watch finished a moment ago, not yet seen', () => {
    const workout = finished('w-1', 5 * 60_000);
    expect(celebrationFor([workout], onWatch('w-1'), [], NOW)).toBe(workout);
  });

  it('nothing once its poster has been seen', () => {
    expect(celebrationFor([finished('w-1', 5 * 60_000)], onWatch('w-1'), ['w-1'], NOW)).toBeNull();
  });

  it('nothing the watch did not finish: a phone finish, an import, a restore or a seeded session', () => {
    expect(celebrationFor([finished('w-1', 5 * 60_000)], [], [], NOW)).toBeNull();
    expect(celebrationFor([finished('w-1', 5 * 60_000)], onWatch('w-2'), [], NOW)).toBeNull();
  });

  it('nothing unfinished, discarded or gone', () => {
    expect(celebrationFor([finished('w-1', HOUR, { finished_at: null })], onWatch('w-1'), [], NOW)).toBeNull();
    expect(celebrationFor([finished('w-1', HOUR, { deleted_at: ago(0) })], onWatch('w-1'), [], NOW)).toBeNull();
    expect(celebrationFor([undefined], onWatch('w-1'), [], NOW)).toBeNull();
  });

  it('within twelve hours of the finish, not after', () => {
    expect(celebrationFor([finished('w-1', CELEBRATE_WITHIN_MS)], onWatch('w-1'), [], NOW)?.id).toBe('w-1');
    expect(celebrationFor([finished('w-1', CELEBRATE_WITHIN_MS + 1)], onWatch('w-1'), [], NOW)).toBeNull();
  });

  it('never a finish in the future, or one whose time will not parse', () => {
    expect(celebrationFor([finished('w-1', -60_000)], onWatch('w-1'), [], NOW)).toBeNull();
    expect(celebrationFor([finished('w-1', HOUR, { finished_at: 'not a time' })], onWatch('w-1'), [], NOW)).toBeNull();
  });

  it('the newest of two, by when each finished, whatever order they come in', () => {
    const earlier = finished('w-1', 3 * HOUR);
    const later = finished('w-2', HOUR);
    expect(celebrationFor([later, earlier], onWatch('w-1', 'w-2'), [], NOW)).toBe(later);
    expect(celebrationFor([earlier, later], onWatch('w-2', 'w-1'), [], NOW)).toBe(later);
    // The newest seen, the one before it is still owed.
    expect(celebrationFor([earlier, later], onWatch('w-1', 'w-2'), ['w-2'], NOW)).toBe(earlier);
  });
});
