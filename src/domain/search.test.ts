import { describe, expect, it } from 'vitest';
import {
  exerciseAlternatives,
  filterExercises,
  liftFamily,
  muscleOverlap,
  planSwapTargets,
  swapSuggestions,
} from './search';
import { makeExercise } from './testFactories';
import type { Exercise } from '@/db/schema';
import type { Muscle } from './types';

// Secondary muscles are set explicitly: the factory's defaults would otherwise
// make every fixture match a search for "hamstrings".
const lift = (overrides: Parameters<typeof makeExercise>[0]) =>
  makeExercise({ secondary_muscles: [], ...overrides });

const squat = lift({ name: 'Barbell Squat', primary_muscle: 'quadriceps', movement_pattern: 'squat', equipment: 'barbell' });
const legPress = lift({ name: 'Leg Press', primary_muscle: 'quadriceps', movement_pattern: 'squat', equipment: 'machine' });
const gobletSquat = lift({ name: 'Goblet Squat', primary_muscle: 'quadriceps', movement_pattern: 'squat', equipment: 'dumbbell' });
const romanianDeadlift = lift({ name: 'Romanian Deadlift', primary_muscle: 'hamstrings', movement_pattern: 'hinge', equipment: 'barbell' });
const inclineDbPress = lift({ name: 'Incline Dumbbell Press', primary_muscle: 'chest', movement_pattern: 'horizontal_push', equipment: 'dumbbell' });

const all = [squat, legPress, gobletSquat, romanianDeadlift, inclineDbPress];

describe('exercise search', () => {
  it('matches terms in any order', () => {
    expect(filterExercises(all, { query: 'dumbbell incline' })).toEqual([inclineDbPress]);
    expect(filterExercises(all, { query: 'incline dumbbell' })).toEqual([inclineDbPress]);
  });

  it('ignores punctuation and case, so "pull up" finds "Pull-Up"', () => {
    const pullUp = lift({ name: 'Pull-Up', movement_pattern: 'vertical_pull' });
    expect(filterExercises([pullUp], { query: 'pull up' })).toEqual([pullUp]);
    expect(filterExercises([pullUp], { query: 'PULLUP' })).toEqual([]);
  });

  it('searches muscle and equipment as well as name', () => {
    expect(filterExercises(all, { query: 'hamstrings' })).toEqual([romanianDeadlift]);
  });

  it('filters by movement pattern', () => {
    expect(filterExercises(all, { pattern: 'squat' })).toEqual([squat, legPress, gobletSquat]);
  });

  it('restricts to equipment available at the gym', () => {
    const homeGym = filterExercises(all, { availableEquipment: ['dumbbell'] });
    expect(homeGym).toEqual([gobletSquat, inclineDbPress]);
  });

  it('excludes soft-deleted exercises', () => {
    const removed = lift({ name: 'Old Lift', deleted_at: '2026-08-01T00:00:00.000Z' });
    expect(filterExercises([removed], {})).toEqual([]);
  });
});

describe('swap suggestions', () => {
  const benchPress = lift({ name: 'Barbell Bench Press', primary_muscle: 'chest', movement_pattern: 'horizontal_push', equipment: 'barbell', is_compound: true });
  const dumbbellPress = lift({ name: 'Dumbbell Bench Press', primary_muscle: 'chest', movement_pattern: 'horizontal_push', equipment: 'dumbbell', is_compound: true });
  const machinePress = lift({ name: 'Leverage Chest Press', primary_muscle: 'chest', movement_pattern: 'horizontal_push', equipment: 'machine', is_compound: true });
  const dips = lift({ name: 'Dips - Triceps Version', primary_muscle: 'triceps', movement_pattern: 'horizontal_push', equipment: 'bodyweight', is_compound: true });
  const flyes = lift({ name: 'Cable Crossover', primary_muscle: 'chest', movement_pattern: 'isolation', equipment: 'cable', is_compound: false });
  const chestPool = [benchPress, dumbbellPress, machinePress, dips, flyes, romanianDeadlift, squat];

  it('puts same movement, same muscle in the direct tier', () => {
    const { direct } = swapSuggestions(benchPress, chestPool);
    expect(direct).toContain(dumbbellPress);
    expect(direct).toContain(machinePress);
    for (const candidate of direct) {
      expect(candidate.movement_pattern).toBe('horizontal_push');
      expect(candidate.primary_muscle).toBe('chest');
    }
  });

  /** Same press, different muscle; and same muscle, different movement. */
  it('puts a looser match in the alternative tier', () => {
    const { alternative } = swapSuggestions(benchPress, chestPool);
    expect(alternative).toContain(dips);
    expect(alternative).toContain(flyes);
  });

  it('never puts the same exercise in both tiers', () => {
    const { direct, alternative } = swapSuggestions(benchPress, chestPool);
    const overlap = direct.filter((candidate) => alternative.includes(candidate));
    expect(overlap).toEqual([]);
  });

  it('offers nothing that shares neither the movement nor the muscle', () => {
    const { direct, alternative } = swapSuggestions(benchPress, chestPool);
    const all = [...direct, ...alternative];
    expect(all).not.toContain(romanianDeadlift);
    expect(all).not.toContain(squat);
  });

  it('never suggests the exercise you are already doing', () => {
    const { direct, alternative } = swapSuggestions(benchPress, chestPool);
    expect([...direct, ...alternative]).not.toContain(benchPress);
  });

  it('respects the equipment at the current gym', () => {
    // A garage with dumbbells and a bar: no machine, no cable.
    const { direct, alternative } = swapSuggestions(benchPress, chestPool, {
      availableEquipment: ['dumbbell', 'barbell', 'bodyweight'],
    });
    const all = [...direct, ...alternative];
    expect(all).not.toContain(machinePress);
    expect(all).not.toContain(flyes);
    expect(direct).toContain(dumbbellPress);
  });

  /**
   * The swap list has the same failure mode generated plans had: without a sense
   * of what a normal lift is, every variant ranks the same and the tiebreak picks
   * one at random.
   */
  it('opens with the recognisable lift rather than an obscure variant', () => {
    const guillotine = lift({ name: 'Barbell Guillotine Bench Press', primary_muscle: 'chest', movement_pattern: 'horizontal_push', equipment: 'barbell', is_compound: true, source_id: 'Barbell_Guillotine_Bench_Press' });
    const proper = lift({ name: 'Dumbbell Bench Press', primary_muscle: 'chest', movement_pattern: 'horizontal_push', equipment: 'dumbbell', is_compound: true, source_id: 'Dumbbell_Bench_Press' });
    const { direct } = swapSuggestions(benchPress, [guillotine, proper]);
    expect(direct[0]).toBe(proper);
  });

  it('returns empty tiers rather than throwing when nothing matches', () => {
    expect(swapSuggestions(benchPress, [])).toEqual({ direct: [], alternative: [] });
  });

  it('caps each tier so the screen stays scannable', () => {
    const many = Array.from({ length: 30 }, (_unused, index) =>
      lift({ name: `Press ${index}`, primary_muscle: 'chest', movement_pattern: 'horizontal_push' }),
    );
    expect(swapSuggestions(benchPress, many, { limit: 6 }).direct).toHaveLength(6);
  });
});

describe('alternatives: same muscles, different exercise', () => {
  // Shaped like the seed data: a deadlift is filed under lower back, with a
  // long list of secondaries.
  const hinge = (name: string, primary: Muscle, extra: Partial<Exercise> = {}) =>
    lift({
      name,
      primary_muscle: primary,
      movement_pattern: 'hinge',
      equipment: 'barbell',
      is_compound: true,
      source_id: null,
      ...extra,
    });

  const deadlift = hinge('Barbell Deadlift', 'lower back', {
    secondary_muscles: ['glutes', 'hamstrings', 'quadriceps', 'traps', 'forearms'],
  });
  const rdl = hinge('Romanian Deadlift', 'hamstrings', { secondary_muscles: ['glutes', 'lower back'] });
  const sumo = hinge('Sumo Deadlift', 'hamstrings', { secondary_muscles: ['glutes', 'quadriceps'] });
  const hipThrust = hinge('Barbell Hip Thrust', 'glutes', { secondary_muscles: ['hamstrings'] });
  const goodMorning = hinge('Good Morning', 'hamstrings', { secondary_muscles: ['glutes', 'lower back'] });
  const seatedGoodMorning = hinge('Seated Good Mornings', 'lower back', { secondary_muscles: ['glutes', 'hamstrings'] });
  const powerClean = hinge('Power Clean', 'hamstrings', { secondary_muscles: ['glutes', 'lower back', 'quadriceps', 'traps'] });
  const backSquat = lift({ name: 'Barbell Squat', primary_muscle: 'quadriceps', movement_pattern: 'squat', source_id: null });
  const pool = [deadlift, rdl, sumo, hipThrust, goodMorning, seatedGoodMorning, powerClean, backSquat];

  const families = (list: Exercise[]) => list.map((exercise) => liftFamily(exercise.name));

  it('keeps other deadlifts apart from different exercises', () => {
    // Not wanting to deadlift is not answered by a sumo deadlift.
    const { different, variations } = exerciseAlternatives(deadlift, pool);
    expect(families(different)).toEqual(expect.arrayContaining(['hip thrust', 'good morning']));
    expect(families(different)).not.toContain('deadlift');
    expect(variations).toEqual(expect.arrayContaining([rdl, sumo]));
  });

  it('offers one of each kind of exercise, not two good mornings', () => {
    // The seated one wins the slot: it shares the deadlift's lower-back focus.
    const { different } = exerciseAlternatives(deadlift, pool);
    expect(different).toContain(seatedGoodMorning);
    expect(different).not.toContain(goodMorning);
  });

  it('sinks Olympic lifts below real alternatives', () => {
    const { different } = exerciseAlternatives(deadlift, pool);
    expect(different.at(-1)).toBe(powerClean);
  });

  it('never offers something that trains other muscles', () => {
    expect(exerciseAlternatives(deadlift, pool).different).not.toContain(backSquat);
  });

  it('does not match isolation work on the label alone', () => {
    // A curl and a lateral raise are both "isolation" in the data.
    const lateralRaise = lift({ name: 'Side Lateral Raise', primary_muscle: 'shoulders', movement_pattern: 'isolation', equipment: 'dumbbell', source_id: null });
    const frontRaise = lift({ name: 'Front Dumbbell Raise', primary_muscle: 'shoulders', movement_pattern: 'isolation', equipment: 'dumbbell', source_id: null });
    const curl = lift({ name: 'Dumbbell Bicep Curl', primary_muscle: 'biceps', movement_pattern: 'isolation', equipment: 'dumbbell', source_id: null });
    const { different } = exerciseAlternatives(lateralRaise, [lateralRaise, frontRaise, curl]);
    expect(different).toEqual([frontRaise]);
  });

  it('needs shared muscles before a shared movement counts', () => {
    // The data files a glute-ham raise under rows.
    const row = lift({ name: 'Bent Over Barbell Row', primary_muscle: 'middle back', secondary_muscles: ['lats', 'biceps'], movement_pattern: 'horizontal_pull', source_id: null });
    const gluteHam = lift({ name: 'Glute Ham Raise', primary_muscle: 'hamstrings', secondary_muscles: ['glutes'], movement_pattern: 'horizontal_pull', source_id: null });
    const pulldown = lift({ name: 'Wide-Grip Lat Pulldown', primary_muscle: 'lats', secondary_muscles: ['middle back', 'biceps'], movement_pattern: 'vertical_pull', source_id: null });
    const seatedRow = lift({ name: 'Seated Cable Rows', primary_muscle: 'middle back', secondary_muscles: ['lats', 'biceps'], movement_pattern: 'horizontal_pull', equipment: 'cable', source_id: null });
    const { different, variations } = exerciseAlternatives(row, [row, gluteHam, pulldown, seatedRow]);
    expect(different).not.toContain(gluteHam);
    expect(variations).toEqual([seatedRow]);
  });

  it('respects the gym and keeps out exercises already in the session', () => {
    const dumbbellOnly = exerciseAlternatives(deadlift, pool, { availableEquipment: ['dumbbell'] });
    expect([...dumbbellOnly.different, ...dumbbellOnly.variations]).toEqual([]);

    const without = exerciseAlternatives(deadlift, pool, { excludeIds: new Set([hipThrust.id]) });
    expect(without.different).not.toContain(hipThrust);
  });
});

describe('lift families', () => {
  it('reads the lift a name is a version of', () => {
    expect(liftFamily('Sumo Deadlift')).toBe('deadlift');
    expect(liftFamily('Incline Dumbbell Press')).toBe('chest press');
    expect(liftFamily('Arnold Dumbbell Press')).toBe('overhead press');
    expect(liftFamily('Chin-Up')).toBe('pull up');
    expect(liftFamily('Plank')).toBe('plank');
  });

  it('tries the specific family before the general one', () => {
    expect(liftFamily('Lying Leg Curls')).toBe('leg curl');
    expect(liftFamily('Barbell Curl')).toBe('curl');
    expect(liftFamily('Cable Rear Delt Fly')).toBe('rear delt fly');
    expect(liftFamily('Cable Crossover')).toBe('chest fly');
    expect(liftFamily('Front Squat (Clean Grip)')).toBe('squat');
    expect(liftFamily('Hang Clean')).toBe('olympic');
  });

  it('has no family for a name it does not recognise', () => {
    expect(liftFamily('Farmer Walk')).toBeNull();
  });
});

describe('muscle overlap', () => {
  const a = lift({ primary_muscle: 'chest', secondary_muscles: ['triceps', 'shoulders'] });
  const b = lift({ primary_muscle: 'triceps', secondary_muscles: ['chest'] });
  const c = lift({ primary_muscle: 'calves', secondary_muscles: [] });

  it('is 1 for the same muscles and 0 for none in common', () => {
    expect(muscleOverlap(a, a)).toBe(1);
    expect(muscleOverlap(a, c)).toBe(0);
  });

  it('is the same both ways round', () => {
    expect(muscleOverlap(a, b)).toBeCloseTo(muscleOverlap(b, a));
    expect(muscleOverlap(a, b)).toBeGreaterThan(0);
    expect(muscleOverlap(a, b)).toBeLessThan(1);
  });
});

describe('how far a swap across the plan reaches', () => {
  const conventional = lift({ id: 'dl', name: 'Barbell Deadlift', source_id: null });
  const romanian = lift({ id: 'rdl', name: 'Romanian Deadlift', source_id: null });
  const stiffLegged = lift({ id: 'sldl', name: 'Stiff-Legged Barbell Deadlift', source_id: null });
  const squat = lift({ id: 'squat', name: 'Barbell Squat', source_id: null });
  const plank = lift({ id: 'plank', name: 'Plank', source_id: null });
  const farmer = lift({ id: 'farmer', name: 'Farmer Walk', source_id: null });
  const row = (exercise: Exercise) => ({ exercise });

  it('reaches every version of the lift, one per session', () => {
    // The four-day full body: a different deadlift on three of its days.
    const week = [[row(squat), row(conventional)], [row(romanian), row(plank)], [row(squat)], [row(stiffLegged)]];

    const targets = planSwapTargets(week, conventional);

    expect(targets.map((target) => [target.sessionIndex, target.item.exercise.id])).toEqual([
      [0, 'dl'],
      [1, 'rdl'],
      [3, 'sldl'],
    ]);
  });

  it('prefers the same exercise where a session has two versions', () => {
    const week = [[row(romanian), row(conventional)]];
    expect(planSwapTargets(week, conventional)[0]!.item.exercise).toBe(conventional);
    expect(planSwapTargets(week, romanian)[0]!.item.exercise).toBe(romanian);
  });

  it('reaches only the same exercise when it belongs to no family', () => {
    const week = [[row(farmer)], [row(plank)], [row(farmer)]];
    expect(planSwapTargets(week, farmer).map((target) => target.sessionIndex)).toEqual([0, 2]);
  });
});
