import { describe, expect, it } from 'vitest';
import type { WorkoutSet } from '@/db/schema';
import { carryForward } from './carry';
import type { LoadingProfile } from './plates';
import { makeSet } from './testFactories';

const BAR: LoadingProfile = { mode: 'barbell', barWeight: 20, plates: [25, 20, 15, 10, 5, 2.5, 1.25] };
const EZ: LoadingProfile = { mode: 'barbell', barWeight: 10, plates: [20, 10, 5, 2.5, 1.25] };
const DUMBBELL: LoadingProfile = { mode: 'fixed_step', step: 2.5 };
const STACK: LoadingProfile = { mode: 'fixed_step', step: 5 };
const FREE: LoadingProfile = { mode: 'free' };

const at = (minute: number) => `2026-10-14T17:${String(minute).padStart(2, '0')}:00.000Z`;
const did = (weight: number, reps: number, minute = 1, overrides: Partial<WorkoutSet> = {}): WorkoutSet =>
  makeSet({ weight_kg: weight, reps, completed: true, completed_at: at(minute), ...overrides });

/** The set after `weight × reps` on a range starting at `repLow`. */
const after = (weight: number, reps: number, repLow: number | null, loading: LoadingProfile) =>
  carryForward([did(weight, reps)], repLow, loading);

describe('carry forward, a notch lighter when the set fell short', () => {
  it('is nothing before the first working set is done', () => {
    expect(carryForward([], 8, BAR)).toBeNull();
    expect(carryForward([makeSet({ completed: false, completed_at: null })], 8, BAR)).toBeNull();
  });

  it.each([
    // The plan's worked examples (docs/build7-plan.md, feature 2).
    ['barbell 100 × 5 on 8–10', 100, 5, 8, BAR, 90],
    ['barbell 100 × 7 on 8–10: one rep short rounds down a whole 5kg', 100, 7, 8, BAR, 95],
    ['barbell 100 × 2 on 8–10: held at 10% lighter', 100, 2, 8, BAR, 90],
    ['barbell 60 × 5 on 6–8', 60, 5, 6, BAR, 57.5],
    ['barbell 22.5 × 4 on 6–8, down to the bar', 22.5, 4, 6, BAR, 20],
    ['dumbbells 27.5 × 6 on 8–12', 27.5, 6, 8, DUMBBELL, 25],
    ['stack 40 × 9 on 10–15: one real step beats the 10% cap', 40, 9, 10, STACK, 35],
    // The research table's coarse kit, where one step is more than 10%.
    ['dumbbells 5 × 6 on 10–12: one step is half the weight', 5, 6, 10, DUMBBELL, 2.5],
    ['stack 20 × 5 on 10–12: one step is a quarter', 20, 5, 10, STACK, 15],
    ['an EZ bar 32.5 × 6 on 8–12', 32.5, 6, 8, EZ, 30],
    ['dumbbells typed off the rack, 26 × 6 on 8–12', 26, 6, 8, DUMBBELL, 22.5],
  ])('%s', (_name, weight, reps, repLow, loading, expected) => {
    expect(after(weight, reps, repLow, loading)).toEqual({
      weight_kg: expected,
      reps: repLow,
      stepped: { from: { weight, reps }, repLow },
    });
  });

  it.each([
    ['at the bottom of the range', 100, 8, 8, BAR],
    ['above the range', 100, 11, 8, BAR],
    ['with no range (freestyle)', 100, 5, null, BAR],
    ['a bare bar, which nothing lighter replaces', 20, 5, 8, BAR],
    ['a weight under the bar', 15, 5, 8, BAR],
    ['the lightest dumbbell', 2.5, 6, 10, DUMBBELL],
    ['a stack\'s first plate', 5, 5, 10, STACK],
    ['added weight on bodyweight work, off the watch\'s ladder', 20, 5, 8, FREE],
    ['unloaded bodyweight work, 0 × n', 0, 5, 8, FREE],
    ['unloaded work on kit that steps', 0, 5, 8, DUMBBELL],
  ])('carries exactly as done %s', (_name, weight, reps, repLow, loading) => {
    expect(after(weight, reps, repLow, loading)).toEqual({ weight_kg: weight, reps, stepped: null });
  });

  it('carries an AMRAP set that fell short exactly as done: its reps were never a target', () => {
    expect(carryForward([did(100, 5, 1, { is_amrap: true })], 8, BAR)).toEqual({ weight_kg: 100, reps: 5, stepped: null });
  });

  it('steps down from the latest working set, not a later warm-up, drop or back-off', () => {
    const short = did(100, 5, 1, { id: 'top' });
    const later = [
      did(60, 5, 2, { type: 'warmup' }),
      did(80, 3, 3, { type: 'drop', parent_set_id: 'top' }),
      did(90, 4, 4, { type: 'back_off' }),
    ];
    expect(carryForward([short, ...later], 8, BAR)).toMatchObject({ weight_kg: 90, reps: 8, stepped: { from: { weight: 100, reps: 5 } } });
  });

  it('never steps down off a short warm-up, drop or back-off when the working set made the range', () => {
    const made = did(100, 9, 1, { id: 'top' });
    for (const short of [
      did(60, 2, 2, { type: 'warmup' }),
      did(80, 3, 3, { type: 'drop', parent_set_id: 'top' }),
      did(90, 4, 4, { type: 'back_off' }),
    ]) {
      expect(carryForward([made, short], 8, BAR)).toEqual({ weight_kg: 100, reps: 9, stepped: null });
    }
  });

  it('judges the set done most recently: a short one after a good one steps down, a good one after a short one does not', () => {
    expect(carryForward([did(100, 9, 1), did(100, 6, 4)], 8, BAR)).toMatchObject({ weight_kg: 92.5, reps: 8 });
    expect(carryForward([did(100, 6, 1), did(95, 8, 4)], 8, BAR)).toEqual({ weight_kg: 95, reps: 8, stepped: null });
  });

  it('gives a tie to the later set, as the carry always has', () => {
    expect(carryForward([did(100, 9, 2), did(100, 5, 2)], 8, BAR)).toMatchObject({ weight_kg: 90, stepped: { from: { weight: 100, reps: 5 } } });
    expect(carryForward([did(100, 5, 2), did(100, 9, 2)], 8, BAR)).toEqual({ weight_kg: 100, reps: 9, stepped: null });
  });

  it('is always lighter than the set just done, and never more than 10% lighter unless one step is', () => {
    for (const weight of [22.5, 40, 61.25, 100, 142.5]) {
      for (let reps = 1; reps < 8; reps += 1) {
        const carried = after(weight, reps, 8, BAR)!;
        expect(carried.weight_kg, `${weight} × ${reps}`).toBeLessThan(weight);
        expect(carried.weight_kg, `${weight} × ${reps}`).toBeGreaterThanOrEqual(weight * 0.9 - 2.5 - 1e-9);
      }
    }
  });
});
