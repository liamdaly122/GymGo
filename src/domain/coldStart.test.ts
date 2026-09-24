import { describe, expect, it } from 'vitest';
import { estimateOpeningWeight, type ExerciseHistory } from './coldStart';
import { makeExercise, makeSet } from './testFactories';
import type { ExerciseSession } from './previousPerformance';
import type { LoadingProfile } from './plates';

const BAR: LoadingProfile = {
  mode: 'barbell',
  barWeight: 20,
  plates: [25, 20, 15, 10, 5, 2.5, 1.25],
};
const DUMBBELL: LoadingProfile = { mode: 'fixed_step', step: 2.5 };
const STACK: LoadingProfile = { mode: 'fixed_step', step: 5 };
const BODYWEIGHT: LoadingProfile = { mode: 'free' };

const benchPress = makeExercise({
  id: 'bench', name: 'Barbell Bench Press', movement_pattern: 'horizontal_push',
  primary_muscle: 'chest', equipment: 'barbell', is_compound: true,
});
const inclinePress = makeExercise({
  id: 'incline', name: 'Barbell Incline Press', movement_pattern: 'horizontal_push',
  primary_muscle: 'chest', equipment: 'barbell', is_compound: true,
});
const dumbbellPress = makeExercise({
  id: 'db-press', name: 'Dumbbell Bench Press', movement_pattern: 'horizontal_push',
  primary_muscle: 'chest', equipment: 'dumbbell', is_compound: true,
});
const squat = makeExercise({
  id: 'squat', name: 'Barbell Squat', movement_pattern: 'squat',
  primary_muscle: 'quadriceps', equipment: 'barbell', is_compound: true,
});

let day = 0;
function sessionAt(weight: number, reps: number): ExerciseSession {
  day += 1;
  return {
    workout_id: `w-${day}`,
    performed_at: new Date(Date.UTC(2026, 6, day)).toISOString(),
    sets: [makeSet({ weight_kg: weight, reps, set_index: 0 })],
    readiness: null,
  };
}

const trained = (exercise: typeof benchPress, weight: number, reps = 5): ExerciseHistory => ({
  exercise,
  history: [sessionAt(weight, reps)],
});

describe('opening a lift you have never done', () => {
  it('reasons from the closest lift you have', () => {
    const estimate = estimateOpeningWeight(inclinePress, [trained(benchPress, 100)], BAR)!;

    expect(estimate.basis).toBe('Barbell Bench Press');
    expect(estimate.weight_kg).toBeGreaterThan(0);
  });

  it('opens below the lift it reasoned from', () => {
    const estimate = estimateOpeningWeight(inclinePress, [trained(benchPress, 100)], BAR)!;

    // An opener has to be beatable. Fifteen percent light costs one easy set;
    // fifteen percent heavy costs a failed rep under a bar.
    expect(estimate.weight_kg).toBeLessThan(100);
  });

  it('only ever suggests a weight the equipment can make', () => {
    for (const weight of [60, 82.5, 100, 137.5]) {
      const estimate = estimateOpeningWeight(inclinePress, [trained(benchPress, weight)], BAR);
      if (!estimate) continue;
      // 2.5kg granularity on a 20kg bar with these plates.
      expect((estimate.weight_kg - 20) % 2.5).toBe(0);
    }
  });

  it('rounds down onto a coarse stack rather than up', () => {
    const machineRow = makeExercise({
      id: 'machine-row', name: 'Machine Row', movement_pattern: 'horizontal_pull',
      primary_muscle: 'middle back', equipment: 'machine', is_compound: true,
    });
    const cableRow = makeExercise({
      id: 'cable-row', name: 'Cable Row', movement_pattern: 'horizontal_pull',
      primary_muscle: 'middle back', equipment: 'machine', is_compound: true,
    });

    const estimate = estimateOpeningWeight(machineRow, [trained(cableRow, 60)], STACK)!;

    expect(estimate.weight_kg % 5).toBe(0);
    expect(estimate.weight_kg).toBeLessThan(60);
  });

  it('says nothing when nothing related has been trained', () => {
    // Saying nothing stays better than guessing, which is the engine's own rule.
    expect(estimateOpeningWeight(inclinePress, [trained(squat, 140)], BAR)).toBeNull();
  });

  it('says nothing when there are no references at all', () => {
    expect(estimateOpeningWeight(inclinePress, [], BAR)).toBeNull();
  });

  it('says nothing for bodyweight work, which carries no load', () => {
    expect(estimateOpeningWeight(inclinePress, [trained(benchPress, 100)], BODYWEIGHT)).toBeNull();
  });

  it('ignores a reference that has been added but never performed', () => {
    const untouched: ExerciseHistory = { exercise: benchPress, history: [] };
    expect(estimateOpeningWeight(inclinePress, [untouched], BAR)).toBeNull();
  });

  it('never reasons from the lift it is estimating', () => {
    expect(estimateOpeningWeight(benchPress, [trained(benchPress, 100)], BAR)).toBeNull();
  });
});

describe('choosing which lift to reason from', () => {
  it('prefers the same equipment over a closer movement on different kit', () => {
    // Crossing equipment types is the shakiest comparison the app can make, so
    // a same-equipment reference wins even when both are direct matches.
    const estimate = estimateOpeningWeight(
      inclinePress,
      [trained(dumbbellPress, 40), trained(benchPress, 100)],
      BAR,
    )!;

    expect(estimate.basis).toBe('Barbell Bench Press');
  });

  it('opens much lighter when it has to cross equipment types', () => {
    const sameKit = estimateOpeningWeight(inclinePress, [trained(benchPress, 100)], BAR)!;
    const crossKit = estimateOpeningWeight(dumbbellPress, [trained(benchPress, 100)], DUMBBELL)!;

    expect(crossKit.weight_kg).toBeLessThan(sameKit.weight_kg);
  });

  it('gives the same answer whatever order the references arrive in', () => {
    const forwards = estimateOpeningWeight(
      inclinePress, [trained(benchPress, 100), trained(dumbbellPress, 40)], BAR,
    )!;
    const backwards = estimateOpeningWeight(
      inclinePress, [trained(dumbbellPress, 40), trained(benchPress, 100)], BAR,
    )!;

    expect(forwards).toEqual(backwards);
  });

  it('aims at the top of the range, to find a weight rather than test one', () => {
    const estimate = estimateOpeningWeight(
      inclinePress, [trained(benchPress, 100)], BAR, { repRange: { low: 5, high: 8 } },
    )!;

    expect(estimate.reps).toBe(8);
  });
});
