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
  it('only offers the same movement pattern', () => {
    const suggestions = swapSuggestions(squat, all);
    expect(suggestions).not.toContain(romanianDeadlift);
    expect(suggestions.every((ex) => ex.movement_pattern === 'squat')).toBe(true);
  });

  it('never suggests the exercise itself', () => {
    expect(swapSuggestions(squat, all)).not.toContain(squat);
  });

  it('respects the equipment available at the current gym', () => {
    // The rack is taken and this gym has no machines.
    const suggestions = swapSuggestions(squat, all, { availableEquipment: ['dumbbell', 'barbell'] });
    expect(suggestions).toEqual([gobletSquat]);
  });

  it('ranks a shared primary muscle above a shared implement', () => {
    const otherBarbellSquat = lift({ name: 'Front Squat', primary_muscle: 'glutes', movement_pattern: 'squat', equipment: 'barbell' });
    const suggestions = swapSuggestions(squat, [legPress, otherBarbellSquat]);
    expect(suggestions[0]).toBe(legPress);
  });
});
