import { describe, expect, it } from 'vitest';
import { latestWorkingSet } from './sets';
import { makeSet } from './testFactories';

const at = (minute: number) => `2026-10-05T18:${String(minute).padStart(2, '0')}:00.000Z`;

describe('the set carried forward', () => {
  it('is nothing before the first working set is done', () => {
    expect(latestWorkingSet([])).toBeNull();
    expect(latestWorkingSet([makeSet({ completed: false, completed_at: null })])).toBeNull();
  });

  it('is the working set done most recently', () => {
    const first = makeSet({ weight_kg: 60, reps: 10, completed_at: at(1) });
    const second = makeSet({ weight_kg: 62.5, reps: 9, completed_at: at(4) });
    const next = makeSet({ completed: false, completed_at: null, weight_kg: 0, reps: 0 });
    expect(latestWorkingSet([first, second, next])).toBe(second);
  });

  it('follows the order they were done in, not the order on the card', () => {
    const one = makeSet({ weight_kg: 60, completed_at: at(9) });
    const two = makeSet({ weight_kg: 70, completed_at: at(3) });
    expect(latestWorkingSet([one, two])).toBe(one);
  });

  it('never carries a warm-up, a drop, a back-off or a deleted set', () => {
    const working = makeSet({ id: 'top', weight_kg: 100, reps: 5, completed_at: at(1) });
    const others = [
      makeSet({ type: 'warmup', weight_kg: 60, completed_at: at(2) }),
      makeSet({ type: 'drop', parent_set_id: 'top', weight_kg: 80, completed_at: at(3) }),
      makeSet({ type: 'back_off', weight_kg: 90, completed_at: at(4) }),
      makeSet({ weight_kg: 120, completed_at: at(5), deleted_at: at(6) }),
    ];
    expect(latestWorkingSet([working, ...others])).toBe(working);
  });

  it('skips an old empty tick, which logged 0kg × 0', () => {
    const real = makeSet({ weight_kg: 40, reps: 12, completed_at: at(1) });
    const empty = makeSet({ weight_kg: 0, reps: 0, completed_at: at(2) });
    expect(latestWorkingSet([real, empty])).toBe(real);
  });

  it('carries an unloaded bodyweight set, whose 0kg is real', () => {
    const pullUps = makeSet({ weight_kg: 0, reps: 8, completed_at: at(1) });
    expect(latestWorkingSet([pullUps])).toBe(pullUps);
  });
});
