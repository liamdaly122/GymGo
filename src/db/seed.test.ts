import { describe, expect, it } from 'vitest';
import seedData from './seed.data.json';
import { EQUIPMENT, EXPERIENCE_LEVELS, isMovementPattern, type MovementPattern } from '@/domain/types';

const seed = seedData as Array<Record<string, unknown> & { name: string; movement_pattern: string }>;
const byName = new Map(seed.map((ex) => [ex.name.toLowerCase(), ex]));

/**
 * Movement pattern is derived, not given — the source dataset has no such
 * field. These are the lifts the generator and swap suggestions lean on hardest,
 * so a regression in the classification rules must fail loudly rather than
 * quietly reshuffle which exercise fills a "hinge" slot.
 */
const EXPECTED: Record<string, MovementPattern> = {
  'barbell squat': 'squat',
  'leg press': 'squat',
  'barbell deadlift': 'hinge',
  'romanian deadlift': 'hinge',
  'barbell hip thrust': 'hinge',
  'barbell glute bridge': 'hinge',
  'clean and jerk': 'hinge',
  'dumbbell lunges': 'lunge',
  'barbell bench press - medium grip': 'horizontal_push',
  'incline dumbbell press': 'horizontal_push',
  'standing military press': 'vertical_push',
  pullups: 'vertical_pull',
  'wide-grip lat pulldown': 'vertical_pull',
  'bent over barbell row': 'horizontal_pull',
  'seated cable rows': 'horizontal_pull',
  "farmer's walk": 'carry',
  'sled push': 'carry',
  crunches: 'core',
  'dumbbell bicep curl': 'isolation',
  'dumbbell flyes': 'isolation',
};

describe('seed exercise database', () => {
  it('is not empty', () => {
    expect(seed.length).toBeGreaterThan(500);
  });

  it('gives every exercise a valid movement pattern', () => {
    const bad = seed.filter((ex) => !isMovementPattern(ex.movement_pattern));
    expect(bad.map((ex) => ex.name)).toEqual([]);
  });

  it('gives every exercise valid equipment and experience level', () => {
    const badEquipment = seed.filter((ex) => !EQUIPMENT.includes(ex.equipment as never));
    const badLevel = seed.filter((ex) => !EXPERIENCE_LEVELS.includes(ex.experience_level as never));
    expect(badEquipment.map((ex) => ex.name)).toEqual([]);
    expect(badLevel.map((ex) => ex.name)).toEqual([]);
  });

  it('has no duplicate ids', () => {
    expect(new Set(seed.map((ex) => ex.id)).size).toBe(seed.length);
  });

  it.each(Object.entries(EXPECTED))('classifies "%s" as %s', (name, pattern) => {
    const exercise = byName.get(name);
    expect(exercise, `"${name}" missing from seed data`).toBeDefined();
    expect(exercise!.movement_pattern).toBe(pattern);
  });

  /**
   * A front squat taken with a clean grip must not be swept up by the olympic
   * lift rule. This was a real defect: "clean" matched before "squat" did.
   */
  it('keeps clean-grip front squats in the squat pattern', () => {
    expect(byName.get('front squat (clean grip)')?.movement_pattern).toBe('squat');
  });

  /** Compound-tagged trunk work must not fall through to a chest pattern. */
  it('classifies loaded ab work as core, not a press', () => {
    expect(byName.get('barbell rollout from bench')?.movement_pattern).toBe('core');
  });

  it('excludes stretching and cardio entries entirely', () => {
    expect(byName.has('90/90 hamstring')).toBe(false);
    expect(byName.has('running, treadmill')).toBe(false);
  });
});
