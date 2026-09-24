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
    expect(suggestion.reason).toMatch(/short of 5 reps twice/i);
    expect(suggestion.reason).toMatch(/build back up/i);
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

/**
 * Found by driving the real app: on a cable stack that moves in 5kg plates, a
 * 1.25kg increment rounded straight back to the weight you already lifted. The
 * suggestion read "Add 1.25kg" next to an unchanged number, and progression
 * would have stalled for ever on every machine and cable lift without once
 * saying so.
 */
describe('coarse equipment', () => {
  const cable = { mode: 'fixed_step' as const, step: 5 };

  it('raises the increment to the equipment\'s own step rather than stalling', () => {
    const suggestion = suggestNextSet({
      exercise: curl,
      repRange: RANGE,
      loading: cable,
      history: [session([{ weight: 100, reps: 8 }, { weight: 100, reps: 8 }])],
    })!;
    expect(suggestion.kind).toBe('add_weight');
    expect(suggestion.weight_kg).toBeGreaterThan(100);
    expect(suggestion.weight_kg).toBe(105);
  });

  it('never claims a jump it did not make', () => {
    const suggestion = suggestNextSet({
      exercise: curl,
      repRange: RANGE,
      loading: cable,
      history: [session([{ weight: 100, reps: 8 }, { weight: 100, reps: 8 }])],
    })!;
    const claimed = /Add ([\d.]+)kg/.exec(suggestion.reason);
    expect(claimed, 'the reason should state the increment').not.toBeNull();
    expect(Number(claimed![1])).toBe(suggestion.weight_kg - 100);
  });

  it('makes a deload actually land lighter on a coarse stack', () => {
    const suggestion = suggestNextSet({
      exercise: curl,
      repRange: RANGE,
      loading: cable,
      history: [session([{ weight: 50, reps: 3 }]), session([{ weight: 50, reps: 2 }])],
    })!;
    expect(suggestion.kind).toBe('deload');
    expect(suggestion.weight_kg).toBeLessThan(50);
  });

  it('still adds the full increment when the bar is finer than it', () => {
    const suggestion = suggestNextSet({
      exercise: squat,
      repRange: RANGE,
      loading: BAR,
      history: [session([{ weight: 100, reps: 8 }, { weight: 100, reps: 8 }])],
    })!;
    expect(suggestion.weight_kg).toBe(102.5);
  });
});

/**
 * Found by driving the app: a freestyle session has no prescribed rep range, so
 * a default of 8-12 was assumed. Log heavy fives twice and the engine read it as
 * two failures and suggested a deload off the back of a perfectly good session.
 */
describe('freestyle sessions', () => {
  it('never deloads against a range nobody prescribed', () => {
    const suggestion = suggestNextSet({
      exercise: squat,
      repRange: null,
      loading: BAR,
      history: [session([{ weight: 100, reps: 5 }]), session([{ weight: 110, reps: 5 }])],
    })!;
    expect(suggestion.kind).not.toBe('deload');
    expect(suggestion.weight_kg).toBeGreaterThanOrEqual(110);
  });

  it('judges against what was actually done last time', () => {
    const suggestion = suggestNextSet({
      exercise: squat,
      repRange: null,
      loading: BAR,
      history: [session([{ weight: 100, reps: 5 }, { weight: 100, reps: 5 }])],
    })!;
    // Every set matched last time's reps, so the weight goes up.
    expect(suggestion.kind).toBe('add_weight');
    expect(suggestion.weight_kg).toBe(102.5);
  });

  it('still deloads when a routine DID prescribe a range', () => {
    const suggestion = suggestNextSet({
      exercise: squat,
      repRange: { low: 8, high: 12 },
      loading: BAR,
      history: [session([{ weight: 100, reps: 5 }]), session([{ weight: 110, reps: 5 }])],
    })!;
    expect(suggestion.kind).toBe('deload');
  });
});

describe('judging a session that had a heavy top set', () => {
  it('does not read a top single plus good back-offs as a failure', () => {
    // Work up to a heavy triple, then four back-off sets that clear the range
    // comfortably. Reading only the heaviest set called this a failed session.
    const topSingleThenBackOffs = () =>
      session([
        { weight: 120, reps: 3 },
        { weight: 100, reps: 8 },
        { weight: 100, reps: 8 },
        { weight: 100, reps: 8 },
      ]);

    const suggestion = suggestNextSet({
      exercise: squat,
      repRange: RANGE,
      loading: BAR,
      history: [topSingleThenBackOffs(), topSingleThenBackOffs()],
    })!;

    expect(suggestion.kind).not.toBe('deload');
  });

  it('still deloads when every working set fell short, twice running', () => {
    const missed = () => session([{ weight: 100, reps: 3 }, { weight: 100, reps: 2 }]);

    const suggestion = suggestNextSet({
      exercise: squat,
      repRange: RANGE,
      loading: BAR,
      history: [missed(), missed()],
    })!;

    expect(suggestion.kind).toBe('deload');
  });

  it('one good set in the session is enough to end the streak', () => {
    const suggestion = suggestNextSet({
      exercise: squat,
      repRange: RANGE,
      loading: BAR,
      history: [
        session([{ weight: 100, reps: 2 }, { weight: 100, reps: 2 }]),
        session([{ weight: 100, reps: 2 }, { weight: 100, reps: 5 }]),
      ],
    })!;

    expect(suggestion.kind).not.toBe('deload');
  });
});

describe('reading back what the lifter logged', () => {
  /**
   * A session where every set hit the top of the range.
   *
   * The two RIR values differ on purpose: an identical reading across every set
   * is the fingerprint of the old prescription stamping and is deliberately not
   * believed, so a fixture that used one number would be testing the guard
   * rather than the rule.
   */
  const topOfRange = (rir: number | null, harder = rir) => {
    day += 1;
    return {
      workout_id: `w-${day}`,
      performed_at: new Date(Date.UTC(2026, 6, day)).toISOString(),
      sets: [
        makeSet({ weight_kg: 100, reps: 8, set_index: 0, rir: harder }),
        makeSet({ weight_kg: 100, reps: 8, set_index: 1, rir }),
      ],
      readiness: null,
    };
  };

  it('adds one increment when nothing was logged about effort', () => {
    const suggestion = suggestNextSet({
      exercise: squat,
      repRange: RANGE,
      loading: BAR,
      history: [topOfRange(null)],
    })!;

    // Beginner mode logs no RIR, so the unaided behaviour must be the default.
    expect(suggestion.kind).toBe('add_weight');
    expect(suggestion.weight_kg).toBe(102.5);
  });

  it('adds two when you finished with reps to spare', () => {
    const suggestion = suggestNextSet({
      exercise: squat,
      repRange: RANGE,
      loading: BAR,
      history: [topOfRange(4, 3)],
    })!;

    expect(suggestion.weight_kg).toBe(105);
    expect(suggestion.reason).toMatch(/double jump/i);
    expect(suggestion.reason).toMatch(/3 left in the tank/i);
  });

  it('still adds one when you only just finished the range', () => {
    const suggestion = suggestNextSet({
      exercise: squat,
      repRange: RANGE,
      loading: BAR,
      history: [topOfRange(2, 1)],
    })!;

    expect(suggestion.weight_kg).toBe(102.5);
    expect(suggestion.reason).not.toMatch(/double jump/i);
  });

  it('judges the session on its hardest set, not its easiest', () => {
    day += 1;
    const mixed = {
      workout_id: `w-${day}`,
      performed_at: new Date(Date.UTC(2026, 6, day)).toISOString(),
      sets: [
        makeSet({ weight_kg: 100, reps: 8, set_index: 0, rir: 4 }),
        makeSet({ weight_kg: 100, reps: 8, set_index: 1, rir: 0 }),
      ],
      readiness: null,
    };

    const suggestion = suggestNextSet({
      exercise: squat, repRange: RANGE, loading: BAR, history: [mixed],
    })!;

    // The easy first set does not make this an easy session: the last one went
    // to failure to reach the top of the range, so the weight is held rather
    // than added to — and certainly not jumped twice.
    expect(suggestion.kind).toBe('repeat');
    expect(suggestion.weight_kg).toBe(100);
    expect(suggestion.reason).not.toMatch(/double jump/i);
  });

  it('takes an AMRAP well past the range as earning a double jump', () => {
    day += 1;
    const amrap = {
      workout_id: `w-${day}`,
      performed_at: new Date(Date.UTC(2026, 6, day)).toISOString(),
      sets: [
        makeSet({ weight_kg: 100, reps: 8, set_index: 0 }),
        makeSet({ weight_kg: 100, reps: 13, set_index: 1, is_amrap: true }),
      ],
      readiness: null,
    };

    const suggestion = suggestNextSet({
      exercise: squat, repRange: RANGE, loading: BAR, history: [amrap],
    })!;

    expect(suggestion.weight_kg).toBe(105);
    expect(suggestion.reason).toMatch(/AMRAP beat the range by 5/i);
  });

  it('holds instead of adding when you had nothing left and still fell short', () => {
    day += 1;
    const ground = {
      workout_id: `w-${day}`,
      performed_at: new Date(Date.UTC(2026, 6, day)).toISOString(),
      sets: [
        makeSet({ weight_kg: 100, reps: 4, set_index: 0, rir: 1 }),
        makeSet({ weight_kg: 100, reps: 4, set_index: 1, rir: 0 }),
      ],
      readiness: null,
    };

    const suggestion = suggestNextSet({
      exercise: squat, repRange: RANGE, loading: BAR, history: [ground],
    })!;

    expect(suggestion.weight_kg).toBe(100);
    expect(suggestion.reason).toMatch(/nothing left in the tank/i);
  });
});

describe('not believing an RIR the lifter never assessed', () => {
  /** A plan session as the old code wrote it: the week's target on every set. */
  const stamped = (rir: number) => {
    day += 1;
    return {
      workout_id: `w-${day}`,
      performed_at: new Date(Date.UTC(2026, 6, day)).toISOString(),
      sets: [
        makeSet({ weight_kg: 100, reps: 8, set_index: 0, rir }),
        makeSet({ weight_kg: 100, reps: 8, set_index: 1, rir }),
        makeSet({ weight_kg: 100, reps: 8, set_index: 2, rir }),
      ],
      readiness: null,
    };
  };

  it('ignores an identical reading across every set', () => {
    // startWorkoutFromRoutine used to stamp the block week's prescribed RIR on
    // every planned set. Believing it would hand a double jump to every
    // exercise in week one on the strength of a number the app wrote itself.
    const stampedAtThree = suggestNextSet({
      exercise: squat, repRange: RANGE, loading: BAR, history: [stamped(3)],
    })!;
    const unlogged = suggestNextSet({
      exercise: squat, repRange: RANGE, loading: BAR, history: [stamped(null as never)],
    })!;

    expect(stampedAtThree.weight_kg).toBe(unlogged.weight_kg);
    expect(stampedAtThree.reason).not.toMatch(/double jump/i);
  });

  it('ignores a single set, which cannot show a pattern either way', () => {
    day += 1;
    const one = {
      workout_id: `w-${day}`,
      performed_at: new Date(Date.UTC(2026, 6, day)).toISOString(),
      sets: [makeSet({ weight_kg: 100, reps: 8, set_index: 0, rir: 4 })],
      readiness: null,
    };

    const suggestion = suggestNextSet({
      exercise: squat, repRange: RANGE, loading: BAR, history: [one],
    })!;

    expect(suggestion.weight_kg).toBe(102.5);
    expect(suggestion.reason).not.toMatch(/double jump/i);
  });
});

describe('an open-ended set is not a target', () => {
  const amrapOnly = () => {
    day += 1;
    return {
      workout_id: `w-${day}`,
      performed_at: new Date(Date.UTC(2026, 6, day)).toISOString(),
      sets: [
        makeSet({ weight_kg: 100, reps: 8, set_index: 0 }),
        makeSet({ weight_kg: 100, reps: 15, set_index: 1, is_amrap: true }),
      ],
      readiness: null,
    };
  };

  it('never becomes the rep target of a freestyle session', () => {
    // With no prescribed range the engine builds one from last time. Built from
    // an AMRAP that got 15, it would demand 15 of every set forever — a target
    // nobody set, that gets harder the better the session went.
    const suggestion = suggestNextSet({
      exercise: squat, repRange: null, loading: BAR, history: [amrapOnly()],
    })!;

    expect(suggestion.reps).not.toBe(15);
    expect(suggestion.reps).toBeLessThanOrEqual(8);
  });

  it('is not read as a set taken to failure', () => {
    day += 1;
    const withAmrap = {
      workout_id: `w-${day}`,
      performed_at: new Date(Date.UTC(2026, 6, day)).toISOString(),
      sets: [
        makeSet({ weight_kg: 100, reps: 8, set_index: 0, rir: 2 }),
        makeSet({ weight_kg: 100, reps: 8, set_index: 1, rir: 1 }),
        makeSet({ weight_kg: 100, reps: 12, set_index: 2, is_amrap: true, rir: 0 }),
      ],
      readiness: null,
    };

    const suggestion = suggestNextSet({
      exercise: squat, repRange: RANGE, loading: BAR, history: [withAmrap],
    })!;

    // An AMRAP is taken to failure by definition, so its RIR 0 says nothing
    // about how the prescribed work felt. The weight should still go up.
    expect(suggestion.kind).toBe('add_weight');
  });
});
