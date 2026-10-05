import type { WorkoutSet } from '@/db/schema';
import type { SetRecord } from '@/domain/prs';
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

/**
 * A tempo spelled out: "3-1-1-0" is three seconds down, one paused at the
 * bottom, one up and none at the top. An X is as fast as you can. Null for
 * anything that is not four parts, which is shown as typed.
 */
export function describeTempo(tempo: string): string | null {
  const parts = tempo.split(/[-/:\s]+/).filter(Boolean);
  if (parts.length !== 4 || !parts.every((part) => /^(\d+|x)$/i.test(part))) return null;
  const say = (part: string) => (/^x$/i.test(part) ? 'as fast as you can' : `${part}s`);
  const [down, bottom, up, top] = parts as [string, string, string, string];
  return `${say(down)} down, ${say(bottom)} at the bottom, ${say(up)} up, ${say(top)} at the top.`;
}

/** A record, said three ways: on the rest screen, in a toast, and out loud. */
export interface RecordNews {
  /** "105 × 5", or "BW × 12" — the set, in the display face. */
  headline: string;
  /** "Heaviest ever · was 102.5kg" */
  detail: string;
  /** "New record · 105kg × 5", for when no rest follows the set. */
  toast: string;
  /** The whole thing as a sentence, for a screen reader. */
  spoken: string;
}

/** An estimated max the way the summary prints it: one decimal place. */
const tenth = (value: number) => formatNumber(Math.round(value * 10) / 10);

export function describeRecord(record: SetRecord, weight: number, reps: number): RecordNews {
  const detail =
    record.kind === 'weight'
      ? `Heaviest ever · was ${record.previous > 0 ? `${formatNumber(record.previous)}kg` : 'bodyweight'}`
      : record.kind === 'e1rm'
        ? `Best estimated max ${tenth(record.value)}kg · was ${tenth(record.previous)}kg`
        : `Most reps · was ${record.previous}`;
  const logged = formatLogged(weight, reps);
  return {
    headline: `${weight > 0 ? formatNumber(weight) : 'BW'} × ${reps}`,
    detail,
    toast: `New record · ${logged}`,
    spoken: `New record: ${logged}. ${detail.replace(' · ', ', ')}.`,
  };
}
