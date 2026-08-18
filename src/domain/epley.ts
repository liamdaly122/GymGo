/**
 * Estimated one-rep max, Epley formula, as specified in the brief:
 *
 *   1RM = weight x (1 + reps / 30)
 */

/** Returns 0 for a set that was not actually performed. */
export function estimate1RM(weightKg: number, reps: number): number {
  if (!Number.isFinite(weightKg) || !Number.isFinite(reps)) return 0;
  if (weightKg <= 0 || reps <= 0) return 0;
  return weightKg * (1 + reps / 30);
}

/** Rounded for display. The stored trend keeps full precision. */
export function estimate1RMRounded(weightKg: number, reps: number, dp = 1): number {
  const factor = 10 ** dp;
  return Math.round(estimate1RM(weightKg, reps) * factor) / factor;
}

/**
 * Percentage-of-1RM table, for planning working weights off a known or
 * estimated max.
 */
export function percentageTable(
  oneRepMax: number,
  percentages: number[] = [95, 90, 85, 80, 75, 70, 65, 60, 50],
): Array<{ percent: number; weight_kg: number }> {
  return percentages.map((percent) => ({
    percent,
    weight_kg: Math.round(oneRepMax * (percent / 100) * 10) / 10,
  }));
}
