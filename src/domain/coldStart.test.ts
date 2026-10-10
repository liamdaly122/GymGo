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

/**
 * The owner's note from the gym: the reason named side lateral raises on
 * exercise after exercise. Every isolation lift shares the pattern label
 * "isolation", which describes no movement, and the estimator counted that as
 * related. A curl is not a lateral raise.
 */
describe('isolation and core are labels, not movements', () => {
  const sideLateral = makeExercise({
    id: 'side-lateral', name: 'Side Lateral Raise', movement_pattern: 'isolation',
    primary_muscle: 'shoulders', equipment: 'dumbbell', is_compound: false,
  });
  const cableLateral = makeExercise({
    id: 'cable-lateral', name: 'Cable Lateral Raise', movement_pattern: 'isolation',
    primary_muscle: 'shoulders', equipment: 'cable', is_compound: false,
  });
  const dumbbellShoulderPress = makeExercise({
    id: 'db-ohp', name: 'Dumbbell Shoulder Press', movement_pattern: 'vertical_push',
    primary_muscle: 'shoulders', equipment: 'dumbbell', is_compound: true,
  });
  const bicepsCurl = makeExercise({
    id: 'curl', name: 'Dumbbell Bicep Curl', movement_pattern: 'isolation',
    primary_muscle: 'biceps', equipment: 'dumbbell', is_compound: false,
  });
  const hammerCurl = makeExercise({
    id: 'hammer', name: 'Hammer Curls', movement_pattern: 'isolation',
    primary_muscle: 'biceps', equipment: 'dumbbell', is_compound: false,
  });
  const legCurl = makeExercise({
    id: 'leg-curl', name: 'Lying Leg Curls', movement_pattern: 'isolation',
    primary_muscle: 'hamstrings', equipment: 'machine', is_compound: false,
  });
  const crunch = makeExercise({
    id: 'crunch', name: 'Cable Crunch', movement_pattern: 'core',
    primary_muscle: 'abdominals', equipment: 'cable', is_compound: false,
  });
  const backExtension = makeExercise({
    id: 'back-ext', name: 'Hyperextensions', movement_pattern: 'core',
    primary_muscle: 'lower back', equipment: 'cable', is_compound: false,
  });

  it('never reasons a curl from a lateral raise', () => {
    expect(estimateOpeningWeight(bicepsCurl, [trained(sideLateral, 10, 12)], DUMBBELL)).toBeNull();
  });

  it('never reasons a leg curl from a lateral raise', () => {
    expect(estimateOpeningWeight(legCurl, [trained(sideLateral, 10, 12)], STACK)).toBeNull();
  });

  it('never reasons one core lift from another that works a different muscle', () => {
    expect(estimateOpeningWeight(crunch, [trained(backExtension, 40, 12)], STACK)).toBeNull();
  });

  it('still reasons from an isolation lift for the same muscle', () => {
    const estimate = estimateOpeningWeight(hammerCurl, [trained(bicepsCurl, 15, 10), trained(sideLateral, 10, 12)], DUMBBELL)!;
    expect(estimate.basis).toBe('Dumbbell Bicep Curl');
  });

  it('prefers another version of the same lift over a different lift on the same kit', () => {
    // A press is far heavier than a raise for the same shoulders: reading a
    // raise off a 25kg press would open at a weight nobody raises.
    const estimate = estimateOpeningWeight(
      sideLateral,
      [trained(dumbbellShoulderPress, 25, 8), trained(cableLateral, 10, 12)],
      DUMBBELL,
    )!;
    expect(estimate.basis).toBe('Cable Lateral Raise');
  });
});
