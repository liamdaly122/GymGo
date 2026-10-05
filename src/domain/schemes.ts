/**
 * Pyramids, built from the set types the counting rules already know.
 *
 * The brief: "Pyramid - weight ascends, reps descend across sets" and
 * "Reverse pyramid - heaviest working set first, then back-off sets at
 * reduced weight". So each scheme has one top set, typed `working`, and the
 * rest typed `back_off`, lighter and longer the further they sit from it.
 *
 * That one choice is why nothing else needed a new rule. The progression
 * engine judges `working` sets only, so it moves the top set against the rep
 * range and is never thrown by a back-off set's extra reps. Records and the
 * previous-performance line read the top set. Volume counts every set.
 *
 * Pure.
 */
import type { SetType, Technique } from './types';
import { loadableWeight, type LoadingProfile } from './plates';

export type Scheme = 'straight' | 'pyramid' | 'reverse_pyramid';

export const SCHEMES: readonly Scheme[] = ['straight', 'pyramid', 'reverse_pyramid'];

/** Load taken off per set away from the top set. */
export const SCHEME_LOAD_STEP = 0.1;
/** Reps added per set away from the top set. */
export const SCHEME_REP_STEP = 2;

export function isPyramid(technique: Technique | null | undefined): technique is 'pyramid' | 'reverse_pyramid' {
  return technique === 'pyramid' || technique === 'reverse_pyramid';
}

/**
 * What each planned set is: the top set first in a reverse pyramid, last in a
 * pyramid, and every set working in anything else.
 */
export function schemeSetTypes(technique: Technique, count: number): SetType[] {
  if (count <= 0) return [];
  const backOff = Array.from({ length: count - 1 }, (): SetType => 'back_off');
  if (technique === 'reverse_pyramid') return ['working', ...backOff];
  if (technique === 'pyramid') return [...backOff, 'working'];
  return Array.from({ length: count }, (): SetType => 'working');
}

/**
 * How many sets a set sits from its pyramid's top set, or null when it is
 * not a back-off set of a pyramid. `types` is the exercise's top-level,
 * non-warm-up sets in order.
 */
export function stepsFromTop(technique: Technique, types: readonly SetType[], index: number): number | null {
  if (!isPyramid(technique) || types[index] !== 'back_off') return null;
  const working = types.flatMap((type, at) => (type === 'working' ? [at] : []));
  if (working.length === 0) return null;
  const top = technique === 'reverse_pyramid' ? working[0]! : working.at(-1)!;
  return Math.abs(index - top);
}

/**
 * What a set `steps` away from the top set aims for: 10% lighter per step,
 * rounded down through what the equipment makes, and two reps more. Unloaded
 * bodyweight work keeps its zero and takes the reps.
 */
export function schemeTarget(
  top: { weight_kg: number; reps: number },
  steps: number,
  loading: LoadingProfile,
): { weight_kg: number; reps: number } {
  if (steps <= 0) return top;
  const weight =
    top.weight_kg > 0
      ? loadableWeight(top.weight_kg * (1 - SCHEME_LOAD_STEP * steps), loading, { direction: 'down' })
      : 0;
  return { weight_kg: weight, reps: top.reps + SCHEME_REP_STEP * steps };
}
