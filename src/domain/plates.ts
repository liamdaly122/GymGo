/**
 * What weight the gym can actually make.
 *
 * The brief is explicit: never suggest a weight I cannot load with the plates at
 * the selected gym. Suggesting 82.3kg is worse than useless — it makes the whole
 * feature feel broken, because you stand at the bar unable to comply.
 *
 * Pure. Also powers the plate calculator the brief asks for.
 */
import type { Equipment } from './types';

/** Work in hundredths of a kilo so plate sums never drift on floating point. */
const SCALE = 100;
const toGrid = (kg: number) => Math.round(kg * SCALE);
const fromGrid = (units: number) => units / SCALE;

/**
 * How a given piece of equipment changes weight.
 *
 * `free` covers bodyweight, bands and anything else where rounding would be
 * meaningless — the suggestion passes through untouched.
 */
export type LoadingMode = 'barbell' | 'fixed_step' | 'free';

export interface LoadingProfile {
  mode: LoadingMode;
  /** Barbell only: the empty bar. */
  barWeight?: number;
  /** Barbell only: plate denominations available per side. */
  plates?: number[];
  /** Fixed-step only: the smallest jump the equipment allows. */
  step?: number;
}

/**
 * Defaults per equipment type. Dumbbells and stacks come in fixed jumps rather
 * than plates; these are the common gym increments, and can become gym profile
 * fields later without changing any caller.
 */
export const DEFAULT_DUMBBELL_STEP_KG = 2.5;
export const DEFAULT_STACK_STEP_KG = 5;

export function loadingProfileFor(
  equipment: Equipment,
  gym: { bar_weights?: number[]; plates_available?: number[] } = {},
): LoadingProfile {
  switch (equipment) {
    case 'barbell':
    case 'ez_bar':
      return {
        mode: 'barbell',
        barWeight: equipment === 'ez_bar' ? 10 : (gym.bar_weights?.[0] ?? 20),
        plates: gym.plates_available ?? [25, 20, 15, 10, 5, 2.5, 1.25],
      };
    case 'dumbbell':
    case 'kettlebell':
      return { mode: 'fixed_step', step: DEFAULT_DUMBBELL_STEP_KG };
    case 'machine':
    case 'cable':
      return { mode: 'fixed_step', step: DEFAULT_STACK_STEP_KG };
    default:
      return { mode: 'free' };
  }
}

/**
 * Every total a loaded bar can make, up to a ceiling.
 *
 * Reachability rather than arithmetic, because plate sets are not always neat:
 * a gym stocking only 25s, 20s and 1.25s cannot make every 2.5kg step, and
 * assuming it can would put an impossible number on screen.
 */
function reachablePerSide(plates: number[], ceilingKg: number): Set<number> {
  const ceiling = toGrid(Math.max(0, ceilingKg));
  const denominations = plates
    .map(toGrid)
    .filter((value) => value > 0)
    .sort((a, b) => a - b);

  const reachable = new Set<number>([0]);
  if (denominations.length === 0) return reachable;

  // Unbounded reachability: a commercial gym has plenty of each denomination.
  const seen = new Uint8Array(ceiling + 1);
  seen[0] = 1;
  for (let total = 0; total <= ceiling; total += 1) {
    if (!seen[total]) continue;
    reachable.add(total);
    for (const denomination of denominations) {
      const next = total + denomination;
      if (next <= ceiling) seen[next] = 1;
    }
  }
  return reachable;
}

/**
 * The weight the equipment can actually make, closest to `target`.
 *
 * Nearest by default, because that is what a lifter does at the rack: asked for
 * 82.3kg you load 82.5, not 80. `direction: 'down'` is for deloads, where erring
 * light is the whole point.
 */
export function loadableWeight(
  target: number,
  profile: LoadingProfile,
  options: { direction?: 'nearest' | 'down' } = {},
): number {
  if (!Number.isFinite(target) || target <= 0) return 0;
  const direction = options.direction ?? 'nearest';

  if (profile.mode === 'free') return Math.round(target * 100) / 100;

  if (profile.mode === 'fixed_step') {
    const step = profile.step ?? DEFAULT_STACK_STEP_KG;
    if (step <= 0) return target;
    const snapped =
      direction === 'down'
        ? Math.floor(target / step) * step
        : Math.round(target / step) * step;
    return Math.max(step, Math.round(snapped * SCALE) / SCALE);
  }

  const bar = profile.barWeight ?? 20;
  const plates = profile.plates ?? [];
  if (target <= bar) return bar;

  const perSideTarget = (target - bar) / 2;
  // Search a little past the target so "nearest" can look upward as well.
  const smallestPlate = Math.min(...plates.filter((plate) => plate > 0), Infinity);
  const headroom = Number.isFinite(smallestPlate) ? smallestPlate : 0;
  const reachable = reachablePerSide(plates, perSideTarget + headroom);

  const wanted = toGrid(perSideTarget);
  let best = 0;
  let bestDistance = Infinity;

  for (const value of reachable) {
    if (direction === 'down' && value > wanted) continue;
    const distance = Math.abs(value - wanted);
    // On a tie, take the lighter option.
    if (distance < bestDistance || (distance === bestDistance && value < best)) {
      best = value;
      bestDistance = distance;
    }
  }

  return bar + fromGrid(best) * 2;
}

export interface PlateLoad {
  /** Plates for ONE side, heaviest first. */
  perSide: number[];
  total: number;
  barWeight: number;
  /** True when the requested weight could not be made exactly. */
  rounded: boolean;
}

/**
 * What to actually hang on the bar, heaviest plate first — which is the order
 * you load them in.
 */
export function plateBreakdown(target: number, profile: LoadingProfile): PlateLoad | null {
  if (profile.mode !== 'barbell') return null;

  const bar = profile.barWeight ?? 20;
  const total = loadableWeight(target, profile);
  const denominations = [...(profile.plates ?? [])].sort((a, b) => b - a).map(toGrid);

  let remaining = toGrid((total - bar) / 2);
  const perSide: number[] = [];

  // Greedy is exact here because the target was already snapped to something
  // reachable, and gym plate sets are canonical (each is a multiple of the next).
  for (const denomination of denominations) {
    while (remaining >= denomination) {
      perSide.push(fromGrid(denomination));
      remaining -= denomination;
    }
  }

  return {
    perSide,
    total,
    barWeight: bar,
    rounded: Math.abs(total - target) > 1e-9,
  };
}

/** "20kg bar + 20 + 10 + 2.5 per side" */
export function formatPlateLoad(load: PlateLoad): string {
  if (load.perSide.length === 0) return `${load.barWeight}kg bar, empty`;
  return `${load.barWeight}kg bar + ${load.perSide.join(' + ')} per side`;
}
