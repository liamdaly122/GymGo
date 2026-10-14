import type { WorkoutExerciseView } from '@/db/queries';
import { addSet } from '@/db/mutations';

/**
 * One more set on each member of a station: one more round of a superset, or
 * one more set of a solo exercise. Each starts where its member's next set
 * would, so it is a nudge rather than two numbers typed again.
 *
 * After a working set (or one never touched) the new set is left empty, and
 * the carry is its placeholder (`setHints`): the last set as done when it
 * reached the range, a notch lighter when it fell short. Copied into the row,
 * those numbers counted as typed, so neither the phone's "Lighter" nor the
 * watch's step-down reached the set, and it asked again for the set just
 * missed. After a pyramid's back-off set the numbers are still copied: the
 * carry skips back-offs, and would jump back to the top set's weight.
 */
export async function addRound(entries: readonly WorkoutExerciseView[]): Promise<void> {
  for (const entry of entries) {
    const last = entry.sets.filter((set) => set.parent_set_id === null && set.type !== 'warmup').at(-1);
    const copy = last && last.type !== 'working' ? { weight_kg: last.weight_kg, reps: last.reps } : {};
    await addSet(entry.workoutExercise.id, copy);
  }
}
