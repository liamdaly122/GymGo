import { describe, expect, it } from 'vitest';
import {
  formatPlateLoad,
  loadableWeight,
  loadingProfileFor,
  plateBreakdown,
} from './plates';

const COMMERCIAL_BAR = {
  mode: 'barbell' as const,
  barWeight: 20,
  plates: [25, 20, 15, 10, 5, 2.5, 1.25],
};

describe('loadable weights', () => {
  it('never suggests a weight the bar cannot make', () => {
    // 82.3kg is not loadable; 82.5 is.
    expect(loadableWeight(82.3, COMMERCIAL_BAR)).toBe(82.5);
  });

  it('snaps to the nearest loadable weight, which is what you do at the rack', () => {
    expect(loadableWeight(100.1, COMMERCIAL_BAR)).toBe(100);
    expect(loadableWeight(84.9, COMMERCIAL_BAR)).toBe(85);
  });

  /** A deload should err light, so it rounds down rather than to nearest. */
  it('rounds down when asked to, for deloads', () => {
    expect(loadableWeight(82.3, COMMERCIAL_BAR, { direction: 'down' })).toBe(80);
    expect(loadableWeight(84.9, COMMERCIAL_BAR, { direction: 'down' })).toBe(82.5);
  });

  it('returns the empty bar for anything at or below it', () => {
    expect(loadableWeight(15, COMMERCIAL_BAR)).toBe(20);
    expect(loadableWeight(20, COMMERCIAL_BAR)).toBe(20);
  });

  it('makes the obvious round numbers exactly', () => {
    for (const weight of [60, 80, 100, 102.5, 140, 180]) {
      expect(loadableWeight(weight, COMMERCIAL_BAR), `${weight}kg`).toBe(weight);
    }
  });

  /**
   * Plate sets are not always neat. A gym with only 25s, 20s and 1.25s cannot
   * make every 2.5kg step, and assuming otherwise would put an impossible
   * number on screen.
   */
  it('respects an awkward plate set rather than assuming 2.5kg steps', () => {
    const awkward = { mode: 'barbell' as const, barWeight: 20, plates: [25, 20] };
    // Per side only 0, 20, 25, 40, 45, 50... are reachable, so the bar can make
    // 20, 60, 70, 100, 110, 120 — and nothing in between.
    expect(loadableWeight(75, awkward)).toBe(70);
    expect(loadableWeight(90, awkward)).toBe(100);
    expect(loadableWeight(75, awkward, { direction: 'down' })).toBe(70);
  });

  it('handles a gym with no plates at all', () => {
    expect(loadableWeight(100, { mode: 'barbell', barWeight: 20, plates: [] })).toBe(20);
  });

  it('steps dumbbells and stacks rather than pretending they take plates', () => {
    const dumbbell = loadingProfileFor('dumbbell');
    expect(loadableWeight(23, dumbbell)).toBe(22.5);
    const machine = loadingProfileFor('machine');
    expect(loadableWeight(63, machine)).toBe(65);
    expect(loadableWeight(63, machine, { direction: 'down' })).toBe(60);
  });

  it('leaves bodyweight work alone', () => {
    expect(loadableWeight(0.5, loadingProfileFor('bodyweight'))).toBe(0.5);
  });

  it('never returns zero or a negative for a real target', () => {
    for (const profile of [COMMERCIAL_BAR, loadingProfileFor('dumbbell'), loadingProfileFor('machine')]) {
      expect(loadableWeight(1, profile)).toBeGreaterThan(0);
    }
  });
});

describe('plate breakdown', () => {
  it('lists what to hang on the bar, heaviest first', () => {
    const load = plateBreakdown(100, COMMERCIAL_BAR)!;
    expect(load.total).toBe(100);
    // 25 + 15 rather than 20 + 15 + 5: fewer plates to handle for the same weight.
    expect(load.perSide).toEqual([25, 15]);
    expect(load.perSide).toEqual([...load.perSide].sort((a, b) => b - a));
  });

  it('adds up to the weight it claims', () => {
    for (const target of [60, 82.5, 100, 142.5, 180]) {
      const load = plateBreakdown(target, COMMERCIAL_BAR)!;
      const sum = load.barWeight + load.perSide.reduce((a, b) => a + b, 0) * 2;
      expect(sum, `${target}kg`).toBeCloseTo(load.total, 6);
    }
  });

  it('flags when it had to round', () => {
    expect(plateBreakdown(100, COMMERCIAL_BAR)!.rounded).toBe(false);
    expect(plateBreakdown(82.3, COMMERCIAL_BAR)!.rounded).toBe(true);
  });

  it('says so when the bar is empty', () => {
    expect(formatPlateLoad(plateBreakdown(20, COMMERCIAL_BAR)!)).toBe('20kg bar, empty');
  });

  it('reads the way you load the bar', () => {
    expect(formatPlateLoad(plateBreakdown(100, COMMERCIAL_BAR)!)).toBe(
      '20kg bar + 25 + 15 per side',
    );
  });

  it('does not apply to equipment without plates', () => {
    expect(plateBreakdown(30, loadingProfileFor('dumbbell'))).toBeNull();
  });
});
