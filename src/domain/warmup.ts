/**
 * The ramp up to a working weight.
 *
 * The brief: "a warm up generator that ramps from an empty bar to the working
 * weight in three or four sets based on percentages." That is what a lifter
 * actually does — the bar on its own, then progressively heavier and fewer
 * reps, arriving warm rather than tired.
 *
 * Pure. Every rung is rounded through the gym's real equipment, because a
 * warm-up you cannot load is not a warm-up.
 */
import { loadableWeight, type LoadingProfile } from './plates';

export interface WarmupRung {
  weight_kg: number;
  reps: number;
}

/**
 * Barbell work opens with the empty bar — a percentage of a light squat is
 * often lighter than the bar itself, which is not a set anyone can do.
 * Everything else starts at a percentage, since there is no bar to hold.
 */
const BARBELL_RUNGS: Array<{ fraction: number | 'bar'; reps: number }> = [
  { fraction: 'bar', reps: 10 },
  { fraction: 0.55, reps: 8 },
  { fraction: 0.7, reps: 5 },
  { fraction: 0.85, reps: 3 },
];

const FIXED_RUNGS: Array<{ fraction: number; reps: number }> = [
  { fraction: 0.45, reps: 10 },
  { fraction: 0.65, reps: 6 },
  { fraction: 0.8, reps: 3 },
];

/** The brief asks for three or four sets, so four is the ceiling. */
const MAX_RUNGS = 4;

/**
 * The warm-up sets leading to `workingWeight`, lightest first.
 *
 * Returns an empty ramp rather than a token set when there is nothing sensible
 * to do: bodyweight work carries no load to ramp, and a working weight at or
 * below the bare bar is already the lightest thing that can be lifted.
 */
export function warmupRamp(workingWeight: number, profile: LoadingProfile): WarmupRung[] {
  if (!Number.isFinite(workingWeight) || workingWeight <= 0) return [];

  const isBarbell = profile.mode === 'barbell';
  const bar = profile.barWeight ?? 20;
  if (isBarbell && workingWeight <= bar) return [];

  const source = isBarbell ? BARBELL_RUNGS : FIXED_RUNGS;
  const rungs: WarmupRung[] = [];

  for (const { fraction, reps } of source) {
    const target = fraction === 'bar' ? bar : workingWeight * fraction;
    // Down, never up: a warm-up rung that rounded past the working set would
    // stop being a warm-up.
    const weight = loadableWeight(target, profile, { direction: 'down' });

    if (weight <= 0 || weight >= workingWeight) continue;
    // Two percentages can round onto the same step on a coarse stack or a
    // light dumbbell. Repeating a rung is not a ramp.
    if (rungs.some((rung) => rung.weight_kg === weight)) continue;

    rungs.push({ weight_kg: weight, reps });
  }

  return rungs.slice(0, MAX_RUNGS);
}
