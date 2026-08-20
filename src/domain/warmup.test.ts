import { describe, expect, it } from 'vitest';
import { warmupRamp } from './warmup';
import { loadableWeight, type LoadingProfile } from './plates';

const BARBELL: LoadingProfile = {
  mode: 'barbell',
  barWeight: 20,
  plates: [25, 20, 15, 10, 5, 2.5, 1.25],
};
const DUMBBELL: LoadingProfile = { mode: 'fixed_step', step: 2.5 };
const STACK: LoadingProfile = { mode: 'fixed_step', step: 5 };
const BODYWEIGHT: LoadingProfile = { mode: 'free' };

describe('ramping to a barbell working weight', () => {
  it('opens with the empty bar and climbs', () => {
    const ramp = warmupRamp(100, BARBELL);

    expect(ramp[0]!.weight_kg).toBe(20);
    expect(ramp.map((rung) => rung.weight_kg)).toEqual([20, 55, 70, 85]);
  });

  it('drops the reps as the weight climbs', () => {
    const reps = warmupRamp(100, BARBELL).map((rung) => rung.reps);

    // Arrive warm, not tired.
    expect(reps).toEqual([10, 8, 5, 3]);
    expect([...reps].sort((a, b) => b - a)).toEqual(reps);
  });

  it('never suggests a weight the bar cannot make', () => {
    for (const working of [60, 82.5, 100, 142.5, 187.5]) {
      for (const rung of warmupRamp(working, BARBELL)) {
        expect(loadableWeight(rung.weight_kg, BARBELL)).toBe(rung.weight_kg);
      }
    }
  });

  it('never reaches the working weight', () => {
    for (const working of [30, 60, 100, 142.5]) {
      for (const rung of warmupRamp(working, BARBELL)) {
        expect(rung.weight_kg).toBeLessThan(working);
      }
    }
  });

  it('gives at most four sets', () => {
    expect(warmupRamp(200, BARBELL).length).toBeLessThanOrEqual(4);
  });
});

describe('when there is nothing to ramp', () => {
  it('refuses bodyweight work, which carries no load', () => {
    expect(warmupRamp(0, BODYWEIGHT)).toEqual([]);
  });

  it('refuses a bare bar, already the lightest thing that can be lifted', () => {
    expect(warmupRamp(20, BARBELL)).toEqual([]);
    expect(warmupRamp(15, BARBELL)).toEqual([]);
  });

  it('refuses a negative or nonsense weight', () => {
    expect(warmupRamp(-50, BARBELL)).toEqual([]);
    expect(warmupRamp(Number.NaN, BARBELL)).toEqual([]);
  });

  it('collapses to a short ramp when the bar is close to the working weight', () => {
    // For 30kg the middle rungs land under the bar or round back onto it, so
    // the ramp is the bar and one step below the target rather than four
    // near-identical sets.
    expect(warmupRamp(30, BARBELL)).toEqual([
      { weight_kg: 20, reps: 10 },
      { weight_kg: 25, reps: 3 },
    ]);
  });
});

describe('equipment that moves in fixed steps', () => {
  it('starts at a percentage, since there is no bar to hold', () => {
    const ramp = warmupRamp(30, DUMBBELL);

    expect(ramp.map((rung) => rung.weight_kg)).toEqual([12.5, 17.5, 22.5]);
  });

  it('rounds down onto real dumbbells', () => {
    for (const rung of warmupRamp(27.5, DUMBBELL)) {
      expect(rung.weight_kg % 2.5).toBe(0);
    }
  });

  it('does not repeat a rung when two percentages round together', () => {
    // On a 5kg stack at 10kg, 45% and 65% both round down to 5kg.
    const ramp = warmupRamp(10, STACK);
    const weights = ramp.map((rung) => rung.weight_kg);

    expect(new Set(weights).size).toBe(weights.length);
  });

  it('can come back empty when the working weight is one step up', () => {
    // Nothing loadable sits between zero and the first step.
    expect(warmupRamp(5, STACK)).toEqual([]);
  });
});
