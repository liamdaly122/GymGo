import { describe, expect, it } from 'vitest';
import { incrementFor, suggestNextSet } from './progression';
import { makeDropSet, makeExercise, makeSet } from './testFactories';
import type { ExerciseSession } from './previousPerformance';
import type { Readiness } from './types';

const BAR = { mode: 'barbell' as const, barWeight: 20, plates: [25, 20, 15, 10, 5, 2.5, 1.25] };
const RANGE = { low: 5, high: 8 };

const squat = makeExercise({ name: 'Barbell Squat', movement_pattern: 'squat', is_compound: true });
const curl = makeExercise({
  name: 'Dumbbell Curl',
  movement_pattern: 'isolation',
  primary_muscle: 'biceps',
  is_compound: false,
});

let day = 0;
function session(
  sets: Array<{ weight: number; reps: number }>,
  options: { readiness?: Readiness | null } = {},
): ExerciseSession {
  day += 1;
  return {
    workout_id: `w-${day}`,
    performed_at: new Date(Date.UTC(2026, 6, day)).toISOString(),
    sets: sets.map((set, index) =>
      makeSet({ weight_kg: set.weight, reps: set.reps, set_index: index }),
    ),
    readiness: options.readiness ?? null,
  };
}

describe('increments', () => {
  it('uses the brief\'s defaults: 2.5kg lower body compound, 1.25kg otherwise', () => {
    expect(incrementFor(squat)).toBe(2.5);
    expect(incrementFor(curl)).toBe(1.25);
  });

  it('lets a per-exercise override win', () => {
    expect(incrementFor(makeExercise({ increment_kg: 5 }))).toBe(5);
  });
});

describe('double progression', () => {
  it('adds an increment once every set hit the top of the range', () => {
    const suggestion = suggestNextSet({
      exercise: squat,
      repRange: RANGE,
      loading: BAR,
      history: [session([{ weight: 100, reps: 8 }, { weight: 100, reps: 8 }, { weight: 100, reps: 8 }])],
    })!;
    expect(suggestion.kind).toBe('add_weight');
    expect(suggestion.weight_kg).toBe(102.5);
    expect(suggestion.reps).toBe(RANGE.low);
    expect(suggestion.reason).toMatch(/hit 8 on every set/i);
  });

  it('holds the weight and asks for one more rep when short of the top', () => {
    const suggestion = suggestNextSet({
      exercise: squat,
      repRange: RANGE,
      loading: BAR,
      history: [session([{ weight: 100, reps: 6 }, { weight: 100, reps: 6 }])],
    })!;
    expect(suggestion.kind).toBe('add_reps');
    expect(suggestion.weight_kg).toBe(100);
    expect(suggestion.reps).toBe(7);
  });

  it('does not add weight when only the first set hit the top', () => {
    const suggestion = suggestNextSet({
      exercise: squat,
      repRange: RANGE,
      loading: BAR,
      history: [session([{ weight: 100, reps: 8 }, { weight: 100, reps: 6 }, { weight: 100, reps: 5 }])],
    })!;
    expect(suggestion.kind).not.toBe('add_weight');
    expect(suggestion.weight_kg).toBe(100);
  });
});

describe('the deload rule', () => {
  it('takes 10% off after two sessions short of the bottom of the range', () => {
    const suggestion = suggestNextSet({
      exercise: squat,
      repRange: RANGE,
      loading: BAR,
      history: [session([{ weight: 120, reps: 4 }]), session([{ weight: 120, reps: 3 }])],
    })!;
    expect(suggestion.kind).toBe('deload');
    // 120 x 0.9 = 108, rounded down to something the bar can make.
    expect(suggestion.weight_kg).toBeLessThanOrEqual(108);
    expect(suggestion.weight_kg).toBeGreaterThan(100);
    expect(suggestion.reason).toMatch(/10% off/);
  });

  it('does not deload after a single bad session', () => {
    const suggestion = suggestNextSet({
      exercise: squat,
      repRange: RANGE,
      loading: BAR,
      history: [session([{ weight: 100, reps: 6 }]), session([{ weight: 120, reps: 3 }])],
    })!;
    expect(suggestion.kind).not.toBe('deload');
  });

  /**
   * The brief is explicit: a low-readiness session must not count toward the
   * failure counter, or one bad night's sleep triggers a deload.
   */
  it('ignores a bad day when counting failures', () => {
    const suggestion = suggestNextSet({
      exercise: squat,
      repRange: RANGE,
      loading: BAR,
      history: [
        session([{ weight: 120, reps: 6 }]),
        session([{ weight: 120, reps: 3 }], { readiness: 'low' }),
        session([{ weight: 120, reps: 3 }], { readiness: 'low' }),
      ],
    })!;
    expect(suggestion.kind).not.toBe('deload');
  });
});

describe('readiness', () => {
  it('scales the suggestion down 10% when today is a bad day', () => {
    const history = [session([{ weight: 100, reps: 8 }, { weight: 100, reps: 8 }])];
    const normal = suggestNextSet({ exercise: squat, repRange: RANGE, loading: BAR, history })!;
    const rough = suggestNextSet({
      exercise: squat,
      repRange: RANGE,
      loading: BAR,
      history,
      readiness: 'low',
    })!;
    expect(rough.weight_kg).toBeLessThan(normal.weight_kg);
    expect(rough.scaled_down).toBe(true);
    expect(rough.reason).toMatch(/low readiness/i);
  });
});

describe('loadability', () => {
  it('never suggests a weight the gym cannot make', () => {
    const awkward = { mode: 'barbell' as const, barWeight: 20, plates: [20] };
    const suggestion = suggestNextSet({
      exercise: squat,
      repRange: RANGE,
      loading: awkward,
      history: [session([{ weight: 60, reps: 8 }, { weight: 60, reps: 8 }])],
    })!;
    // Only 20, 60, 100... are possible with a 20kg bar and 20kg plates.
    expect([20, 60, 100]).toContain(suggestion.weight_kg);
  });

  it('steps a dumbbell lift in dumbbell increments', () => {
    const suggestion = suggestNextSet({
      exercise: curl,
      repRange: RANGE,
      loading: { mode: 'fixed_step', step: 2.5 },
      history: [session([{ weight: 20, reps: 8 }, { weight: 20, reps: 8 }])],
    })!;
    expect(suggestion.weight_kg % 2.5).toBe(0);
  });
});

describe('what cannot drive a suggestion', () => {
  it('returns nothing for an exercise never performed', () => {
    expect(
      suggestNextSet({ exercise: squat, repRange: RANGE, loading: BAR, history: [] }),
    ).toBeNull();
  });

  it('ignores drop sets entirely', () => {
    const { parent, children } = makeDropSet({ weight_kg: 100, reps: 8 }, [60, 40]);
    const suggestion = suggestNextSet({
      exercise: squat,
      repRange: RANGE,
      loading: BAR,
      history: [
        {
          workout_id: 'w-drop',
          performed_at: '2026-07-20T10:00:00.000Z',
          sets: [parent, ...children],
          readiness: null,
        },
      ],
    })!;
    // Driven by the 100kg top set, not the 40kg drop.
    expect(suggestion.weight_kg).toBeGreaterThanOrEqual(100);
  });

  it('ignores warm-ups and sets that were never completed', () => {
    const suggestion = suggestNextSet({
      exercise: squat,
      repRange: RANGE,
      loading: BAR,
      history: [
        {
          workout_id: 'w-mixed',
          performed_at: '2026-07-20T10:00:00.000Z',
          sets: [
            makeSet({ type: 'warmup', weight_kg: 200, reps: 1 }),
            makeSet({ weight_kg: 300, reps: 10, completed: false }),
            makeSet({ weight_kg: 100, reps: 6 }),
          ],
          readiness: null,
        },
      ],
    })!;
    expect(suggestion.weight_kg).toBe(100);
  });
});

describe('block weeks', () => {
  it('goes lighter on a deload week and says why', () => {
    const history = [session([{ weight: 100, reps: 8 }, { weight: 100, reps: 8 }])];
    const suggestion = suggestNextSet({
      exercise: squat,
      repRange: RANGE,
      loading: BAR,
      history,
      week: { loadMultiplier: 0.9, isDeload: true },
    })!;
    expect(suggestion.weight_kg).toBeLessThan(102.5);
    expect(suggestion.reason).toMatch(/deload week/i);
    expect(suggestion.scaled_down).toBe(true);
  });
});

describe('every suggestion explains itself', () => {
  it('carries a readable reason, always', () => {
    const cases: ExerciseSession[][] = [
      [session([{ weight: 100, reps: 8 }, { weight: 100, reps: 8 }])],
      [session([{ weight: 100, reps: 6 }])],
      [session([{ weight: 120, reps: 3 }]), session([{ weight: 120, reps: 2 }])],
    ];
    for (const history of cases) {
      const suggestion = suggestNextSet({ exercise: squat, repRange: RANGE, loading: BAR, history })!;
      expect(suggestion.reason.length).toBeGreaterThan(15);
      expect(suggestion.reason).toMatch(/[.!]$/);
    }
  });
});
