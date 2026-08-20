import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from './db';
import {
  ChildOfChildError,
  toggleSupersetWithNext,
  ImmutableWorkoutError,
  addBackOffSet,
  addChildSet,
  addExerciseToWorkout,
  addSet,
  completeSet,
  finishWorkout,
  startFreestyleWorkout,
  updateSet,
} from './mutations';
import { newId } from '@/lib/ids';
import { nowIso } from '@/lib/dates';
import { personalRecords } from '@/domain/prs';
import { setsPerMuscle } from '@/domain/volume';
import type { Exercise } from './schema';

const BENCH = 'exercise-bench';

function exercise(values: Partial<Exercise> = {}): Exercise {
  return {
    id: BENCH,
    name: 'Barbell Bench Press',
    primary_muscle: 'chest',
    secondary_muscles: [],
    equipment: 'barbell',
    movement_pattern: 'horizontal_push',
    is_compound: true,
    is_unilateral: false,
    experience: 'beginner',
    instructions: [],
    source_id: 'bench',
    setup_notes: null,
    default_rest_seconds: 180,
    increment_kg: null,
    user_id: null,
    created_at: nowIso(),
    updated_at: nowIso(),
    deleted_at: null,
    ...values,
  } as Exercise;
}

beforeEach(async () => {
  await db.open();
  await Promise.all(db.tables.map((table) => table.clear()));
  await db.exercises.add(exercise());
  await db.gyms.add({
    id: newId(),
    name: 'Test gym',
    equipment_available: ['barbell'],
    bar_weights: [20],
    plates_available: [25, 20, 15, 10, 5, 2.5, 1.25],
    is_default: true,
    user_id: null,
    created_at: nowIso(),
    updated_at: nowIso(),
    deleted_at: null,
  });
});

/** A completed 100kg top set on a fresh bench-press session. */
async function topSetOf100kg() {
  const workoutId = await startFreestyleWorkout();
  const weId = await addExerciseToWorkout(workoutId, BENCH);
  const setId = await addSet(weId, { weight_kg: 100, reps: 5 });
  await completeSet(setId, true);
  return { workoutId, weId, setId };
}

const liveSets = async (weId: string) =>
  (await db.sets.where({ workout_exercise_id: weId }).toArray())
    .filter((set) => set.deleted_at === null)
    .sort((a, b) => a.set_index - b.set_index);

describe('drop sets', () => {
  it('loads roughly 20% lighter, rounded down to real plates', async () => {
    const { setId, weId } = await topSetOf100kg();

    await addChildSet(setId, 'drop');

    const [, drop] = await liveSets(weId);
    // 80kg is exactly loadable on a 20kg bar with 25 + 5 per side.
    expect(drop!.weight_kg).toBe(80);
    expect(drop!.type).toBe('drop');
    expect(drop!.parent_set_id).toBe(setId);
  });

  it('steps down a real increment when 80% rounds back onto the parent', async () => {
    await db.exercises.update(BENCH, { equipment: 'dumbbell' });
    const workoutId = await startFreestyleWorkout();
    const weId = await addExerciseToWorkout(workoutId, BENCH);
    const setId = await addSet(weId, { weight_kg: 10, reps: 10 });
    await completeSet(setId, true);

    await addChildSet(setId, 'drop');

    const [, drop] = await liveSets(weId);
    // Dumbbells move in 2.5kg steps: 8kg is not a dumbbell, 7.5kg is.
    expect(drop!.weight_kg).toBe(7.5);
  });

  it('leaves a bare bar alone, because nothing lighter can be loaded', async () => {
    const workoutId = await startFreestyleWorkout();
    const weId = await addExerciseToWorkout(workoutId, BENCH);
    const setId = await addSet(weId, { weight_kg: 20, reps: 10 });
    await completeSet(setId, true);

    await addChildSet(setId, 'drop');

    const [, drop] = await liveSets(weId);
    // A 20kg bar with no plates is the floor. Reporting anything lighter would
    // be a weight the lifter cannot actually load.
    expect(drop!.weight_kg).toBe(20);
  });

  it('leaves bodyweight work at zero rather than inventing a load', async () => {
    const workoutId = await startFreestyleWorkout();
    const weId = await addExerciseToWorkout(workoutId, BENCH);
    const setId = await addSet(weId, { weight_kg: 0, reps: 12 });
    await completeSet(setId, true);

    await addChildSet(setId, 'drop');

    const [, drop] = await liveSets(weId);
    expect(drop!.weight_kg).toBe(0);
  });
});

describe('the counting rules apply to what this creates', () => {
  it('a drop set never becomes the personal record', async () => {
    const { setId, weId, workoutId } = await topSetOf100kg();
    const dropId = await addChildSet(setId, 'drop');
    await updateSet(dropId, { reps: 8 });
    await completeSet(dropId, true);
    await finishWorkout(workoutId);

    const records = personalRecords(await liveSets(weId));

    // The whole reason child sets exist as a concept: 80kg for 8 is real work,
    // but it is not a heavier bench press than 100kg.
    expect(records.heaviest?.weight_kg).toBe(100);
  });

  it('but it does count toward weekly volume', async () => {
    const { setId, weId, workoutId } = await topSetOf100kg();
    const dropId = await addChildSet(setId, 'drop');
    await completeSet(dropId, true);
    await finishWorkout(workoutId);

    const sets = await liveSets(weId);
    const volume = setsPerMuscle(sets, new Map(sets.map((set) => [set.id, exercise()])));

    // Two hard sets were performed, and both trained the chest.
    expect(volume.get('chest')).toBe(2);
  });
});

describe('ordering', () => {
  it('sits the child directly beneath its parent, ahead of later sets', async () => {
    const workoutId = await startFreestyleWorkout();
    const weId = await addExerciseToWorkout(workoutId, BENCH);
    const first = await addSet(weId, { weight_kg: 100, reps: 5 });
    await addSet(weId, { weight_kg: 100, reps: 5 });
    await completeSet(first, true);

    await addChildSet(first, 'drop');

    const order = (await liveSets(weId)).map((set) => set.type);
    expect(order).toEqual(['working', 'drop', 'working']);
  });

  it('stacks a second continuation after the first', async () => {
    const { setId, weId } = await topSetOf100kg();
    await addChildSet(setId, 'drop');
    await addChildSet(setId, 'drop');

    const sets = await liveSets(weId);
    expect(sets.map((set) => set.type)).toEqual(['working', 'drop', 'drop']);
    // A double drop steps down again from the same working set.
    expect(sets[2]!.weight_kg).toBe(80);
  });
});

describe('rest-pause, myo-reps and clusters', () => {
  it('continue at the working weight — the technique is the short rest', async () => {
    const { setId, weId } = await topSetOf100kg();

    await addChildSet(setId, 'rest_pause');
    await addChildSet(setId, 'myo');

    const sets = await liveSets(weId);
    expect(sets.map((set) => set.weight_kg)).toEqual([100, 100, 100]);
    expect(sets.map((set) => set.type)).toEqual(['working', 'rest_pause', 'myo']);
  });
});

describe('back-off sets', () => {
  it('is a top-level set, so it is not a child — but still cannot set a record', async () => {
    const { setId, weId, workoutId } = await topSetOf100kg();

    const backOffId = await addBackOffSet(setId);
    await updateSet(backOffId, { reps: 8 });
    await completeSet(backOffId, true);
    await finishWorkout(workoutId);

    const backOff = (await liveSets(weId)).find((set) => set.id === backOffId)!;
    expect(backOff.parent_set_id).toBeNull();
    expect(backOff.type).toBe('back_off');
    expect(backOff.weight_kg).toBe(85);

    expect(personalRecords(await liveSets(weId)).heaviest?.weight_kg).toBe(100);
  });
});

describe('guards', () => {
  it('refuses to nest a child under a child', async () => {
    const { setId } = await topSetOf100kg();
    const dropId = await addChildSet(setId, 'drop');

    await expect(addChildSet(dropId, 'drop')).rejects.toBeInstanceOf(ChildOfChildError);
  });

  it('refuses to add a technique to a finished workout', async () => {
    const { setId, workoutId } = await topSetOf100kg();
    await finishWorkout(workoutId);

    await expect(addChildSet(setId, 'drop')).rejects.toBeInstanceOf(ImmutableWorkoutError);
  });
});

describe('supersets', () => {
  const groupsOf = async (workoutId: string) =>
    (await db.workout_exercises.where({ workout_id: workoutId }).toArray())
      .filter((we) => we.deleted_at === null)
      .sort((a, b) => a.position - b.position)
      .map((we) => we.superset_group);

  it('pairs an exercise with the one after it', async () => {
    const workoutId = await startFreestyleWorkout();
    const first = await addExerciseToWorkout(workoutId, BENCH);
    await addExerciseToWorkout(workoutId, BENCH);

    await toggleSupersetWithNext(first);

    const [a, b] = await groupsOf(workoutId);
    expect(a).not.toBeNull();
    expect(a).toBe(b);
  });

  it('clears both ends when the pair is broken', async () => {
    const workoutId = await startFreestyleWorkout();
    const first = await addExerciseToWorkout(workoutId, BENCH);
    await addExerciseToWorkout(workoutId, BENCH);
    await toggleSupersetWithNext(first);

    await toggleSupersetWithNext(first);

    // Leaving one row pointing at a group nothing else belongs to would show a
    // stray A1 with no A2.
    expect(await groupsOf(workoutId)).toEqual([null, null]);
  });

  it('extends an existing pair into a giant set rather than starting a new group', async () => {
    const workoutId = await startFreestyleWorkout();
    const first = await addExerciseToWorkout(workoutId, BENCH);
    const second = await addExerciseToWorkout(workoutId, BENCH);
    await addExerciseToWorkout(workoutId, BENCH);
    await toggleSupersetWithNext(first);

    await toggleSupersetWithNext(second);

    const groups = await groupsOf(workoutId);
    expect(new Set(groups).size).toBe(1);
    expect(groups[0]).not.toBeNull();
  });

  it('does nothing on the last exercise, which has no next', async () => {
    const workoutId = await startFreestyleWorkout();
    const only = await addExerciseToWorkout(workoutId, BENCH);

    await expect(toggleSupersetWithNext(only)).resolves.toBeUndefined();
    expect(await groupsOf(workoutId)).toEqual([null]);
  });

  it('refuses to regroup a finished workout', async () => {
    const workoutId = await startFreestyleWorkout();
    const first = await addExerciseToWorkout(workoutId, BENCH);
    await addExerciseToWorkout(workoutId, BENCH);
    await finishWorkout(workoutId);

    await expect(toggleSupersetWithNext(first)).rejects.toBeInstanceOf(ImmutableWorkoutError);
  });
});
