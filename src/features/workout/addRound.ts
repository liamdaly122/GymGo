import type { WorkoutExerciseView } from '@/db/queries';
import { addSet } from '@/db/mutations';

/**
 * One more set on each member of a station: one more round of a superset, or
 * one more set of a solo exercise. Each starts at its member's last working
 * set, so the next set is a nudge rather than two numbers typed again.
 */
export async function addRound(entries: readonly WorkoutExerciseView[]): Promise<void> {
  for (const entry of entries) {
    const last = entry.sets.filter((set) => set.parent_set_id === null && set.type !== 'warmup').at(-1);
    await addSet(entry.workoutExercise.id, { weight_kg: last?.weight_kg ?? 0, reps: last?.reps ?? 0 });
  }
}
