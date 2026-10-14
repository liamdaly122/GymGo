import { describe, expect, it } from 'vitest';
import type { WorkoutSet } from '@/db/schema';
import type { LoadingProfile } from './plates';
import type { PreviousPerformance } from './previousPerformance';
import { setHints, startingNumbers, type HintEntry } from './setHints';
import { makeSet } from './testFactories';

const BAR: LoadingProfile = { mode: 'barbell', barWeight: 20, plates: [25, 20, 15, 10, 5, 2.5, 1.25] };

const todo = (index: number, overrides: Partial<WorkoutSet> = {}): WorkoutSet =>
  makeSet({
    id: `s${index}`, workout_exercise_id: 'we', set_index: index,
    weight_kg: 0, reps: 0, completed: false, completed_at: null, ...overrides,
  });

const done = (index: number, weight: number, reps: number, at: string): WorkoutSet =>
  makeSet({
    id: `s${index}`, workout_exercise_id: 'we', set_index: index,
    weight_kg: weight, reps, completed: true, completed_at: at,
  });

const entry = (sets: WorkoutSet[], overrides: Partial<HintEntry> = {}): HintEntry => ({
  technique: 'straight', loading: BAR, sets, repRange: null, ...overrides,
});

const previous = (weight: number, reps: number): PreviousPerformance => {
  const set = done(0, weight, reps, '2026-10-07T17:00:00.000Z');
  return { workout_id: 'w-0', performed_at: '2026-10-07T18:00:00.000Z', top_set: set, working_sets: [set, set, set] };
};

describe('the numbers a set starts at', () => {
  it('takes the suggestion for the first set, over last time', () => {
    const sets = [todo(0), todo(1)];
    const hints = setHints(entry(sets), sets[0]!, 0, { weight_kg: 100, reps: 5 }, previous(95, 6));
    expect(hints).toMatchObject({ weightHint: 100, repsHint: 5, weightSource: 'suggestion', repsSource: 'suggestion' });
  });

  it('takes last time when there is no suggestion', () => {
    const sets = [todo(0)];
    expect(setHints(entry(sets), sets[0]!, 0, null, previous(95, 6))).toMatchObject({
      weightHint: 95, repsHint: 6, weightSource: 'last', repsSource: 'last',
    });
  });

  it('takes the set just done from the second set on', () => {
    const sets = [done(0, 102.5, 6, '2026-10-14T17:03:00.000Z'), todo(1)];
    expect(setHints(entry(sets), sets[1]!, 1, { weight_kg: 100, reps: 5 }, null)).toMatchObject({
      weightHint: 102.5, repsHint: 6, weightSource: 'carried',
    });
  });

  it('steps the set just done down a notch when it fell short of the range, and says why', () => {
    const sets = [done(0, 100, 5, '2026-10-14T17:03:00.000Z'), todo(1)];
    const hints = setHints(entry(sets, { repRange: { low: 8, high: 10 } }), sets[1]!, 1, { weight_kg: 100, reps: 8 }, null);
    expect(hints).toMatchObject({
      weightHint: 90, repsHint: 8, weightSource: 'stepped', repsSource: 'stepped',
      stepDown: { from: { weight: 100, reps: 5 }, repLow: 8 },
    });
  });

  it('carries the set just done as done when it made the range, or there is no range', () => {
    const sets = [done(0, 100, 8, '2026-10-14T17:03:00.000Z'), todo(1)];
    expect(setHints(entry(sets, { repRange: { low: 8, high: 10 } }), sets[1]!, 1, null, null)).toMatchObject({
      weightHint: 100, repsHint: 8, weightSource: 'carried', stepDown: null,
    });
    const short = [done(0, 100, 5, '2026-10-14T17:03:00.000Z'), todo(1)];
    expect(setHints(entry(short), short[1]!, 1, null, null)).toMatchObject({
      weightHint: 100, repsHint: 5, weightSource: 'carried', stepDown: null,
    });
  });

  it('gives the first set no step-down, and a pyramid\'s back-off set its scheme target over one', () => {
    const first = [todo(0), todo(1)];
    expect(setHints(entry(first, { repRange: { low: 8, high: 10 } }), first[0]!, 0, { weight_kg: 100, reps: 8 }, null)).toMatchObject({
      weightSource: 'suggestion', stepDown: null,
    });
    const pyramid = [done(0, 100, 3, '2026-10-14T17:03:00.000Z'), todo(1, { type: 'back_off' })];
    expect(setHints(entry(pyramid, { technique: 'reverse_pyramid', repRange: { low: 8, high: 10 } }), pyramid[1]!, 1, null, null)).toMatchObject({
      weightHint: 90, repsHint: 5, weightSource: 'scheme', stepDown: null,
    });
  });

  it('aims a pyramid\'s back-off set off the top set, ahead of anything else', () => {
    const sets = [todo(0), todo(1, { type: 'back_off' })];
    const hints = setHints(entry(sets, { technique: 'reverse_pyramid' }), sets[1]!, 1, { weight_kg: 100, reps: 5 }, null);
    expect(hints).toMatchObject({ weightHint: 90, repsHint: 7, weightSource: 'scheme', fromTop: 1, schemeRole: 'Back-off', label: 'Set 2 of 2 · Back-off' });
    expect(hints.topSet?.id).toBe('s0');
  });

  it('gives a warm-up and a drop no placeholder of the suggestion\'s', () => {
    const sets = [todo(0, { type: 'warmup', weight_kg: 20, reps: 10 }), todo(1), todo(2, { type: 'drop', parent_set_id: 's1' })];
    for (const set of [sets[0]!, sets[2]!]) {
      expect(setHints(entry(sets), set, 0, { weight_kg: 100, reps: 5 }, null)).toMatchObject({ weightHint: null, repsHint: null, hintable: false });
    }
  });
});

describe('the numbers a set will be logged at', () => {
  const hints = { weightHint: 100, repsHint: 5 };

  it('keeps each typed field and fills the other from its placeholder', () => {
    expect(startingNumbers({ weight_kg: 0, reps: 8 }, hints, false)).toEqual({ weight: 100, reps: 8, weightTyped: false, repsTyped: true });
    expect(startingNumbers({ weight_kg: 90, reps: 0 }, hints, false)).toEqual({ weight: 90, reps: 5, weightTyped: true, repsTyped: false });
    expect(startingNumbers({ weight_kg: 90, reps: 8 }, hints, false)).toEqual({ weight: 90, reps: 8, weightTyped: true, repsTyped: true });
  });

  it('starts unloaded bodyweight work at zero, and anything else with no placeholder at nothing', () => {
    const none = { weightHint: null, repsHint: null };
    expect(startingNumbers({ weight_kg: 0, reps: 0 }, none, true)).toMatchObject({ weight: 0, reps: null });
    expect(startingNumbers({ weight_kg: 0, reps: 0 }, none, false)).toMatchObject({ weight: null, reps: null });
  });
});
