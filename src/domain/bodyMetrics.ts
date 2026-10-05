/**
 * Body weight over time.
 *
 * A daily weigh-in swings by a kilo or more with water, salt and what you ate
 * yesterday, so the number worth reading is the seven-day average: it moves
 * when your weight does and shrugs off the rest. The brief: "Bodyweight gets
 * entered manually."
 *
 * Pure. Dates are ISO date-only strings, the lifter's own calendar day.
 */
import type { BodyMetric } from '@/db/schema';
import type { BodyMetricKind } from './types';

export interface DayValue {
  /** YYYY-MM-DD. */
  date: string;
  value: number;
}

/** Whole days from one ISO date to another, read at noon so a clock change cannot skip one. */
function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T12:00:00`) - Date.parse(`${from}T12:00:00`)) / 86_400_000);
}

/**
 * One value per day for one metric, oldest first.
 *
 * The app keeps one entry a day, but two phones or an import can leave two;
 * the one written last is the one that counts.
 */
export function dailySeries(entries: readonly BodyMetric[], metric: BodyMetricKind): DayValue[] {
  const byDay = new Map<string, BodyMetric>();
  for (const entry of entries) {
    if (entry.deleted_at !== null || entry.metric !== metric || !(entry.value > 0)) continue;
    const held = byDay.get(entry.date);
    if (!held || entry.updated_at > held.updated_at) byDay.set(entry.date, entry);
  }
  return [...byDay.values()]
    .map((entry) => ({ date: entry.date, value: entry.value }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * Each day's average over the `days` calendar days ending on it.
 *
 * Calendar days, not entries: a fortnight away does not stretch the window and
 * average this week against last month.
 */
export function rollingAverage(series: readonly DayValue[], days = 7): DayValue[] {
  return series.map((point) => {
    const window = series.filter((other) => {
      const gap = daysBetween(other.date, point.date);
      return gap >= 0 && gap < days;
    });
    const mean = window.reduce((sum, other) => sum + other.value, 0) / window.length;
    return { date: point.date, value: Math.round(mean * 100) / 100 };
  });
}

/**
 * How far the average has moved over `days`: the latest seven-day average
 * against the one standing `days` before it. Null until there is that much
 * history, rather than a change measured over a week and called a month's.
 */
export function changeOver(series: readonly DayValue[], days: number, window = 7): number | null {
  const averages = rollingAverage(series, window);
  const latest = averages.at(-1);
  if (!latest) return null;
  const earlier = [...averages].reverse().find((point) => daysBetween(point.date, latest.date) >= days);
  if (!earlier) return null;
  return Math.round((latest.value - earlier.value) * 10) / 10;
}
