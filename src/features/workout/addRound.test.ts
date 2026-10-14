import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '@/db/db';
import { addExerciseToWorkout, addSet, completeSetWith, startFreestyleWorkout } from '@/db/mutations';
import type { WorkoutExerciseView } from '@/db/queries';
import type { LoadingProfile } from '@/domain/plates';
import { startingNumbers } from '@/domain/setHints';
import { setOrdinals } from '@/domain/sets';
import type { SetType, Technique } from '@/domain/types';
import { addRound } from './addRound';
import { lighterReason, setPlan } from './setPlan';

/**
 * "Add set" under "All sets done", and the companion's Add set: one more set
 * on each member of the station. It has to start where the set in hand
 * would have, which after a set short of the range is a notch lighter
 * (`carryForward`), on the phone and on the watch. Copying the last set's
 * numbers into the row marked them typed, so neither the phone's "Lighter"
 * nor the watch's step-down ever reached it.
 */
const STACK: LoadingProfile = { mode: 'fixed_step', step: 5 };
const RANGE = { low: 10, high: 15 };

beforeEach(async () => {
  await db.open();
  await Promise.all(db.tables.map((table) => table.clear()));
});

async function view(workoutExerciseId: string): Promise<WorkoutExerciseView> {
  const workoutExercise = (await db.workout_exercises.get(workoutExerciseId))!;
  const sets = (await db.sets.where({ workout_exercise_id: workoutExerciseId }).toArray())
    .filter((set) => set.deleted_at === null)
    .sort((a, b) => a.set_index - b.set_index);
  return { workoutExercise, exercise: undefined, sets, loading: STACK, repRange: RANGE };
}

/** A leg press with these sets logged, in order. */
async function logged(sets: Array<[number, number, SetType?]>, technique: Technique = 'straight'): Promise<string> {
  const workoutId = await startFreestyleWorkout();
  const workoutExerciseId = await addExerciseToWorkout(workoutId, 'leg-press', { technique });
  for (const [weight, reps, type] of sets) {
    const id = await addSet(workoutExerciseId, { type: type ?? 'working' });
    await completeSetWith(id, { weight_kg: weight, reps });
  }
  return workoutExerciseId;
}

async function addedSet(workoutExerciseId: string) {
  await addRound([await view(workoutExerciseId)]);
  const after = await view(workoutExerciseId);
  const set = after.sets.at(-1)!;
  const plan = setPlan(after, set, setOrdinals(after.sets).get(set.id) ?? 0, null, null);
  const { weightTyped, repsTyped } = startingNumbers(set, plan, false);
  return { set, plan, typed: weightTyped || repsTyped };
}

describe('one more set', () => {
  it('after a set short of the range, starts a notch lighter, untyped, so the phone and the watch step it down', async () => {
    const id = await logged([[100, 15], [100, 12], [100, 9]]);
    const { set, plan, typed } = await addedSet(id);

    expect(set).toMatchObject({ weight_kg: 0, reps: 0, completed: false, type: 'working' });
    // Untyped: the watch's snapshot sends `carries`, and the phone says "Lighter".
    expect(typed).toBe(false);
    expect(plan).toMatchObject({ weightHint: 95, repsHint: 10, stepDown: { from: { weight: 100, reps: 9 }, repLow: 10 } });
    expect(lighterReason(plan, typed)).toBe('9 was under 10, so 95kg for 10.');
  });

  it('after a set in the range, starts at it as done', async () => {
    const id = await logged([[100, 15], [100, 12]]);
    const { set, plan, typed } = await addedSet(id);

    expect(set).toMatchObject({ weight_kg: 0, reps: 0 });
    expect(typed).toBe(false);
    expect(plan).toMatchObject({ weightHint: 100, repsHint: 12, stepDown: null });
  });

  it("after a reverse pyramid's back-off set, copies it, rather than jumping back to the top set", async () => {
    const id = await logged([[100, 8, 'working'], [90, 10, 'back_off'], [80, 12, 'back_off']], 'reverse_pyramid');
    const { set } = await addedSet(id);

    expect(set).toMatchObject({ weight_kg: 80, reps: 12 });
  });

  it('adds one to each member of a superset', async () => {
    const first = await logged([[100, 9]]);
    const second = await logged([[40, 12]]);
    await addRound([await view(first), await view(second)]);

    expect((await view(first)).sets).toHaveLength(2);
    expect((await view(second)).sets).toHaveLength(2);
  });
});
