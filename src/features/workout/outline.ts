import type { WorkoutExerciseView } from '@/db/queries';
import { EQUIPMENT_LABELS } from '@/features/exercises/labels';

/** A station's name: one exercise, or a superset's members joined. */
export function stationName(entries: readonly WorkoutExerciseView[]): string {
  return entries.map((entry) => entry.exercise?.name ?? 'Exercise').join(' + ');
}

/**
 * What an exercise asks of you, in a line: the kit to find, then the work.
 * "Machine · 3 × 10–15", or "Dumbbell · 2 sets" when nothing set a rep range.
 *
 * From the gym: knowing what comes next means knowing which machine to go
 * and claim before someone else does.
 */
export function exerciseOutline(entry: WorkoutExerciseView): string {
  const working = entry.sets.filter((set) => set.parent_set_id === null && set.type !== 'warmup').length;
  const range = entry.repRange;
  const work = range
    ? `${working} × ${range.low === range.high ? range.low : `${range.low}–${range.high}`}`
    : `${working} ${working === 1 ? 'set' : 'sets'}`;
  const equipment = entry.exercise?.equipment;
  return equipment && equipment !== 'other' ? `${EQUIPMENT_LABELS[equipment]} · ${work}` : work;
}

/**
 * A station's outline, for the rest screen's "up next": the one exercise's
 * line, or a superset's kit, each piece of it named once.
 */
export function stationOutline(entries: readonly WorkoutExerciseView[]): string {
  if (entries.length === 1) return exerciseOutline(entries[0]!);
  const kit = [
    ...new Set(
      entries
        .map((entry) => entry.exercise?.equipment)
        .filter((equipment) => equipment !== undefined && equipment !== 'other')
        .map((equipment) => EQUIPMENT_LABELS[equipment!]),
    ),
  ];
  return kit.length > 0 ? `Superset · ${kit.join(' + ')}` : 'Superset';
}
