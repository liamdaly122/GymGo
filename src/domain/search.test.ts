import { describe, expect, it } from 'vitest';
import { filterExercises, swapSuggestions } from './search';
import { makeExercise } from './testFactories';

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
