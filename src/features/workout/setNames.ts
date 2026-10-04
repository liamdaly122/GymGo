import type { WorkoutSet } from '@/db/schema';
import { isChildSet } from '@/domain/sets';

/**
 * What a continuation is called out loud.
 *
 * A child set inherits its parent's number — a drop hanging off set 3 is still
 * set 3, not a fourth set — so without a name of its own it would share an
 * accessible label with its parent and a screen reader would announce two
 * identical controls.
 */
export const CHILD_NAMES: Record<string, string> = {
  drop: 'Drop',
  rest_pause: 'Rest-pause',
  myo: 'Myo',
  cluster: 'Cluster',
};

/** The short mark a continuation wears on its chip. */
export const CHILD_MARKS: Record<string, string> = {
  drop: 'D',
  rest_pause: 'RP',
  myo: 'M',
  cluster: 'C',
};

/**
 * How long a continuation actually rests for.
 *
 * A rest-pause is 15-20 seconds, not a full inter-set rest — running the normal
 * timer would turn it into an ordinary set and lose the whole point of the
 * technique. A drop has no gap at all: it is done the moment the top set ends.
 */
export const CONTINUATION_REST_SECONDS: Record<string, number> = {
  rest_pause: 20,
  myo: 15,
  cluster: 20,
};

/**
 * "Set 3", "Warm-up 2", "Drop under set 1".
 *
 * `ordinal` is zero-based, from `setOrdinals` — never the array index, or a
 * warm-up ramp would turn the first working set into "Set 5".
 */
export function setName(set: Pick<WorkoutSet, 'type' | 'parent_set_id'>, ordinal: number): string {
  if (isChildSet(set)) return `${CHILD_NAMES[set.type] ?? 'Continuation'} under set ${ordinal + 1}`;
  if (set.type === 'warmup') return `Warm-up ${ordinal + 1}`;
  return `Set ${ordinal + 1}`;
}

/** "102.5kg × 6", or "BW × 12" for unloaded bodyweight work. */
export function formatLogged(weight: number, reps: number): string {
  return `${weight > 0 ? `${formatNumber(weight)}kg` : 'BW'} × ${reps}`;
}

/** A number the way the big fields show it: no trailing zeros, no float dust. */
export function formatNumber(value: number): string {
  return String(Math.round(value * 100) / 100);
}

/**
 * Reads what a field holds. Blank and nonsense both read as nothing, so the
 * placeholder — the suggestion — is what counts as shown.
 */
export function parseEntry(text: string): number | null {
  const trimmed = text.trim().replace(',', '.');
  if (trimmed === '') return null;
  const value = Number.parseFloat(trimmed);
  return Number.isFinite(value) && value >= 0 ? value : null;
}
