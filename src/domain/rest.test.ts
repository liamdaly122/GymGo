import { describe, expect, it } from 'vitest';
import seedData from '@/db/seed.data.json';
import { REST_SECONDS, restSecondsFor, restTier } from './rest';

const library = seedData as Array<{ name: string; is_compound: boolean; fatigue_cost: number; default_rest_seconds: number }>;
const lift = (name: string) => {
  const found = library.find((exercise) => exercise.name === name);
  if (!found) throw new Error(`${name} is not in the seed`);
  return found;
};

describe('rest follows the size of the lift', () => {
  it('is the owner’s numbers: 2:30, 2:00 and 1:30', () => {
    expect(REST_SECONDS).toEqual({ big: 150, medium: 120, light: 90 });
  });

  it('rests the big lifts 2:30', () => {
    for (const name of [
      'Barbell Squat',
      'Barbell Deadlift',
      'Barbell Hip Thrust',
      'Barbell Bench Press - Medium Grip',
      'Standing Military Press',
      'Bent Over Barbell Row',
      'Dumbbell Bench Press',
      'Leg Press',
    ]) {
      expect(restTier(lift(name)), name).toBe('big');
      expect(restSecondsFor(lift(name)), name).toBe(150);
    }
  });

  it('rests the other compounds 2:00: machines, cables and bodyweight', () => {
    for (const name of ['Pullups', 'Dips - Triceps Version', 'Wide-Grip Lat Pulldown', 'Seated Cable Rows']) {
      expect(restTier(lift(name)), name).toBe('medium');
      expect(restSecondsFor(lift(name)), name).toBe(120);
    }
  });

  it('rests isolation and core 1:30', () => {
    for (const name of ['Barbell Curl', 'Leg Extensions', 'Side Lateral Raise', 'Lying Leg Curls', 'Triceps Pushdown', 'Cable Crunch']) {
      expect(restTier(lift(name)), name).toBe('light');
      expect(restSecondsFor(lift(name)), name).toBe(90);
    }
  });

  it('agrees with what the seed stores, for every exercise', () => {
    for (const exercise of library) expect(exercise.default_rest_seconds, exercise.name).toBe(restSecondsFor(exercise));
  });
});
