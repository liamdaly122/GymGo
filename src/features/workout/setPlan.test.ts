import { describe, expect, it } from 'vitest';
import type { WorkoutExerciseView } from '@/db/queries';
import type { WorkoutExercise, WorkoutSet } from '@/db/schema';
import type { LoadingProfile } from '@/domain/plates';
import { makeSet } from '@/domain/testFactories';
import { LIGHTER, setPlan, stepDownReason, VERB } from './setPlan';

/**
 * What the set in hand's plan line says, on the phone and on the companion.
 * The numbers themselves are `setHints`'s and are tested there; this holds
 * the plan line to them: "Lighter" exactly when the placeholders are the set
 * just done stepped down, and the words that go with it.
 */
const BAR: LoadingProfile = { mode: 'barbell', barWeight: 20, plates: [25, 20, 15, 10, 5, 2.5, 1.25] };

const todo = (index: number): WorkoutSet =>
  makeSet({ id: `s${index}`, workout_exercise_id: 'we', set_index: index, weight_kg: 0, reps: 0, completed: false, completed_at: null });

const done = (index: number, weight: number, reps: number): WorkoutSet =>
  makeSet({
    id: `s${index}`, workout_exercise_id: 'we', set_index: index, weight_kg: weight, reps,
    completed: true, completed_at: `2026-10-14T17:0${index}:00.000Z`,
  });

const entry = (sets: WorkoutSet[], repRange: { low: number; high: number } | null): WorkoutExerciseView => ({
  workoutExercise: { id: 'we', technique: 'straight' } as WorkoutExercise,
  exercise: undefined,
  sets,
  loading: BAR,
  repRange,
});

describe('the plan line when a set falls short', () => {
  it('words the step down: what fell short, and what the set is now', () => {
    expect(LIGHTER).toBe('Lighter');
    expect(stepDownReason({ from: { weight: 100, reps: 5 }, repLow: 8 }, 90)).toBe('5 was under 8, so 90kg for 8.');
    expect(stepDownReason({ from: { weight: 60, reps: 5 }, repLow: 6 }, 57.5)).toBe('5 was under 6, so 57.5kg for 6.');
  });

  it('steps down after a short set on a ranged lift, with the numbers it says', () => {
    const sets = [done(0, 100, 5), todo(1), todo(2)];
    const plan = setPlan(entry(sets, { low: 8, high: 10 }), sets[1]!, 1, null, null);
    expect(plan).toMatchObject({ weightHint: 90, repsHint: 8, stepDown: { from: { weight: 100, reps: 5 }, repLow: 8 } });
    expect(stepDownReason(plan.stepDown!, plan.weightHint!)).toBe('5 was under 8, so 90kg for 8.');
  });

  it('says nothing of a step down when there was none', () => {
    const short = [done(0, 100, 5), todo(1)];
    // Freestyle: no range to fall short of.
    expect(setPlan(entry(short, null), short[1]!, 1, null, null).stepDown).toBeNull();
    // In the range: carried as done.
    const fine = [done(0, 100, 8), todo(1)];
    expect(setPlan(entry(fine, { low: 8, high: 10 }), fine[1]!, 1, null, null)).toMatchObject({
      weightHint: 100, repsHint: 8, stepDown: null,
    });
    // The first set: the suggestion's, with its own verb.
    const first = [todo(0)];
    expect(setPlan(entry(first, { low: 8, high: 10 }), first[0]!, 0, null, null).stepDown).toBeNull();
    // A bare bar has nothing lighter: carried unchanged, so no "Lighter".
    const bar = [done(0, 20, 5), todo(1)];
    expect(setPlan(entry(bar, { low: 8, high: 10 }), bar[1]!, 1, null, null)).toMatchObject({
      weightHint: 20, repsHint: 5, stepDown: null,
    });
  });

  it("keeps the engine's words for everything else", () => {
    expect(VERB.add_weight).toBe('Go up');
    expect(VERB.deload).toBe('Back off');
  });
});
