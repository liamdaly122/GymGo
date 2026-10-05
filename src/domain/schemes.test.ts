import { describe, expect, it } from 'vitest';
import { schemeSetTypes, schemeTarget, stepsFromTop } from './schemes';
import { suggestNextSet } from './progression';
import { personalRecords } from './prs';
import { totalWorkingSets } from './volume';
import { makeExercise, makeSet } from './testFactories';
import type { ExerciseSession } from './previousPerformance';
import type { SetType } from './types';

const BAR = { mode: 'barbell' as const, barWeight: 20, plates: [25, 20, 15, 10, 5, 2.5, 1.25] };
const squat = makeExercise({ name: 'Barbell Squat', movement_pattern: 'squat', is_compound: true });

describe('laying out a pyramid', () => {
  it('puts the top set first in a reverse pyramid and last in a pyramid', () => {
    expect(schemeSetTypes('reverse_pyramid', 4)).toEqual(['working', 'back_off', 'back_off', 'back_off']);
    expect(schemeSetTypes('pyramid', 3)).toEqual(['back_off', 'back_off', 'working']);
    expect(schemeSetTypes('straight', 3)).toEqual(['working', 'working', 'working']);
    expect(schemeSetTypes('pyramid', 1)).toEqual(['working']);
    expect(schemeSetTypes('reverse_pyramid', 0)).toEqual([]);
  });

  it('measures each back-off set from its top set', () => {
    const reverse: SetType[] = ['working', 'back_off', 'back_off'];
    expect(stepsFromTop('reverse_pyramid', reverse, 0)).toBeNull();
    expect(stepsFromTop('reverse_pyramid', reverse, 2)).toBe(2);
    const pyramid: SetType[] = ['back_off', 'back_off', 'working'];
    expect(stepsFromTop('pyramid', pyramid, 0)).toBe(2);
    expect(stepsFromTop('pyramid', pyramid, 1)).toBe(1);
    // A back-off added by hand off a straight set is not a pyramid's.
    expect(stepsFromTop('straight', ['working', 'back_off'], 1)).toBeNull();
  });
});

describe('what each set aims for', () => {
  it('takes 10% off and adds two reps per step, rounded down through the plates', () => {
    expect(schemeTarget({ weight_kg: 100, reps: 6 }, 1, BAR)).toEqual({ weight_kg: 90, reps: 8 });
    // 80% of 102.5 is 82: the bar makes 80, not 82.5.
    expect(schemeTarget({ weight_kg: 102.5, reps: 6 }, 2, BAR)).toEqual({ weight_kg: 80, reps: 10 });
    expect(schemeTarget({ weight_kg: 100, reps: 6 }, 0, BAR)).toEqual({ weight_kg: 100, reps: 6 });
  });

  it('leaves unloaded bodyweight work at zero and adds the reps', () => {
    expect(schemeTarget({ weight_kg: 0, reps: 10 }, 1, { mode: 'free' })).toEqual({ weight_kg: 0, reps: 12 });
  });
});

/**
 * Why a pyramid is a working top set and back-off sets around it: the rules
 * that read `working` sets now read exactly the top set.
 */
describe('a pyramid under the counting rules', () => {
  const reverse = [
    makeSet({ weight_kg: 100, reps: 8, type: 'working' }),
    makeSet({ weight_kg: 90, reps: 12, type: 'back_off' }),
    makeSet({ weight_kg: 80, reps: 14, type: 'back_off' }),
  ];

  it('counts every set toward volume', () => {
    expect(totalWorkingSets(reverse)).toBe(3);
  });

  it('never lets a back-off set be a record, however many reps it got', () => {
    const records = personalRecords([makeSet({ weight_kg: 100, reps: 5, type: 'working' }), ...reverse.slice(1)]);
    // 80 × 14 estimates past 100 × 5, and must not count.
    expect(records.bestE1rm!.set.weight_kg).toBe(100);
    expect(records.heaviest!.weight_kg).toBe(100);
  });

  it('progresses the top set against the range, unmoved by the back-off reps', () => {
    const history: ExerciseSession[] = [
      { workout_id: 'w-1', performed_at: '2026-09-01T10:00:00.000Z', sets: reverse, readiness: null },
    ];
    const suggestion = suggestNextSet({ exercise: squat, repRange: { low: 6, high: 8 }, loading: BAR, history })!;
    // The top set hit 8: go up. The back-off sets' 12 and 14 reps are not
    // "every set at the same weight" failing, and not a reason to jump twice.
    expect(suggestion.kind).toBe('add_weight');
    expect(suggestion.weight_kg).toBe(102.5);
  });
});
