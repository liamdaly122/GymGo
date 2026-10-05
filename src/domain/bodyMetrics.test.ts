import { describe, expect, it } from 'vitest';
import type { BodyMetric } from '@/db/schema';
import { changeOver, dailySeries, rollingAverage } from './bodyMetrics';
import { loadablePercentageTable } from './epley';
import { loadingProfileFor } from './plates';

let counter = 0;
function entry(date: string, value: number, overrides: Partial<BodyMetric> = {}): BodyMetric {
  counter += 1;
  return {
    id: `metric-${counter}`,
    date,
    metric: 'bodyweight',
    value,
    unit: 'kg',
    user_id: null,
    created_at: `${date}T07:00:00.000Z`,
    updated_at: `${date}T07:00:00.000Z`,
    deleted_at: null,
    ...overrides,
  };
}

describe('the daily series', () => {
  it('keeps one value a day, oldest first, the latest written winning', () => {
    const series = dailySeries(
      [
        entry('2026-10-03', 81),
        entry('2026-10-01', 80),
        // Two phones logged the 3rd; the later write is the correction.
        entry('2026-10-03', 80.6, { updated_at: '2026-10-03T08:00:00.000Z' }),
      ],
      'bodyweight',
    );
    expect(series).toEqual([
      { date: '2026-10-01', value: 80 },
      { date: '2026-10-03', value: 80.6 },
    ]);
  });

  it('leaves out deleted entries and other metrics', () => {
    const series = dailySeries(
      [
        entry('2026-10-01', 80, { deleted_at: '2026-10-02T00:00:00.000Z' }),
        entry('2026-10-02', 90, { metric: 'waist', unit: 'cm' }),
        entry('2026-10-03', 79.5),
      ],
      'bodyweight',
    );
    expect(series).toEqual([{ date: '2026-10-03', value: 79.5 }]);
  });
});

describe('the seven-day average', () => {
  it('averages each day with the six calendar days before it', () => {
    const series = dailySeries(
      ['01', '02', '03', '04', '05', '06', '07', '08'].map((day, index) => entry(`2026-10-${day}`, 80 + index)),
      'bodyweight',
    );
    const average = rollingAverage(series);
    // The 7th averages the 1st to the 7th: 80 to 86.
    expect(average[6]).toEqual({ date: '2026-10-07', value: 83 });
    // The 8th has dropped the 1st.
    expect(average[7]).toEqual({ date: '2026-10-08', value: 84 });
  });

  it('does not stretch the window across a gap', () => {
    const series = dailySeries([entry('2026-09-01', 90), entry('2026-10-01', 80)], 'bodyweight');
    // A month away: the 1st of October stands on its own.
    expect(rollingAverage(series).at(-1)).toEqual({ date: '2026-10-01', value: 80 });
  });
});

describe('the change over a month', () => {
  it('compares the latest average with the one standing a month before', () => {
    const series = dailySeries(
      [entry('2026-09-01', 82), entry('2026-09-15', 81), entry('2026-10-01', 80)],
      'bodyweight',
    );
    expect(changeOver(series, 30)).toBe(-2);
  });

  it('says nothing until there is a month of history', () => {
    const series = dailySeries([entry('2026-09-25', 81), entry('2026-10-01', 80)], 'bodyweight');
    expect(changeOver(series, 30)).toBeNull();
    expect(changeOver([], 30)).toBeNull();
  });
});

describe('the percentage table', () => {
  it('rounds every row down to what the plates make', () => {
    const barbell = loadingProfileFor('barbell', { bar_weights: [20], plates_available: [25, 20, 15, 10, 5, 2.5, 1.25] });
    const rows = loadablePercentageTable(117.5, barbell, [100, 80, 50]);
    // 80% of 117.5 is 94: no bar makes that, and 95 would be over the percentage.
    expect(rows).toEqual([
      { percent: 100, weight_kg: 117.5 },
      { percent: 80, weight_kg: 92.5 },
      { percent: 50, weight_kg: 57.5 },
    ]);
  });

  it('steps a dumbbell down to the rack', () => {
    const dumbbell = loadingProfileFor('dumbbell');
    expect(loadablePercentageTable(40, dumbbell, [90])).toEqual([{ percent: 90, weight_kg: 35 }]);
  });
});
