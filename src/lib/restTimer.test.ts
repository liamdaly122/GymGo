import { describe, expect, it } from 'vitest';
import { restorable } from './restTimer';

const NOW = 1_800_000_000_000;
const rest = (over: Record<string, unknown> = {}) => ({
  endsAt: NOW + 60_000,
  totalMs: 180_000,
  scopeId: 'workout-1',
  ...over,
});

describe('deciding whether a stored rest is worth restoring', () => {
  it('restores one that is still running', () => {
    expect(restorable(rest(), 'workout-1', NOW)).toEqual({
      endsAt: NOW + 60_000,
      totalMs: 180_000,
      scopeId: 'workout-1',
    });
  });

  it('restores one that finished moments ago, so you still see "rest over"', () => {
    expect(restorable(rest({ endsAt: NOW - 30_000 }), 'workout-1', NOW)).not.toBeNull();
  });

  it('drops one that finished long ago — that was a different session', () => {
    expect(restorable(rest({ endsAt: NOW - 3_600_000 }), 'workout-1', NOW)).toBeNull();
  });

  it('drops one belonging to another workout', () => {
    expect(restorable(rest(), 'workout-2', NOW)).toBeNull();
  });

  it('drops anything malformed rather than throwing', () => {
    expect(restorable(null, 'workout-1', NOW)).toBeNull();
    expect(restorable('nonsense', 'workout-1', NOW)).toBeNull();
    expect(restorable({ endsAt: 'soon' }, 'workout-1', NOW)).toBeNull();
    expect(restorable(rest({ endsAt: Number.NaN }), 'workout-1', NOW)).toBeNull();
  });
});
