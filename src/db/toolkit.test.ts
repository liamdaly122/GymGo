import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from './db';
import {
  ImmutableWorkoutError,
  addChildSet,
  addExerciseToWorkout,
  addSet,
  completeSet,
  finishWorkout,
  generateWarmupSets,
  moveWorkoutExercise,
  repeatWorkout,
  startFreestyleWorkout,
  toggleSupersetWithNext,
  updateSet,
} from './mutations';
import { newId } from '@/lib/ids';
import { estimateOpeningWeight } from '@/domain/coldStart';
import { exerciseSessions } from './queries';
import { nowIso } from '@/lib/dates';
import { previousPerformance } from '@/domain/previousPerformance';
import { totalTonnage } from '@/domain/volume';
import type { Exercise } from './schema';

const BENCH = 'exercise-bench';
const ROW = 'exercise-row';

function exercise(id: string, values: Partial<Exercise> = {}): Exercise {
  return {
    id,
    name: id,
    primary_muscle: 'chest',
    secondary_muscles: [],
    equipment: 'barbell',
    movement_pattern: 'horizontal_push',
    is_compound: true,
    is_unilateral: false,
    experience_level: 'beginner',
    fatigue_cost: 3,
    demo_url: null,
    source_id: id,
    setup_notes: null,
    default_rest_seconds: 180,
    increment_kg: null,
    is_custom: false,
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
  await db.exercises.bulkAdd([exercise(BENCH), exercise(ROW, { equipment: 'dumbbell' })]);
  await db.gyms.add({
    id: newId(),
    name: 'Test gym',
    equipment_available: ['barbell', 'dumbbell'],
    bar_weights: [20],
    plates_available: [25, 20, 15, 10, 5, 2.5, 1.25],
    is_default: true,
    user_id: null,
    created_at: nowIso(),
    updated_at: nowIso(),
    deleted_at: null,
  });
});

const liveSets = async (weId: string) =>
  (await db.sets.where({ workout_exercise_id: weId }).toArray())
    .filter((set) => set.deleted_at === null)
    .sort((a, b) => a.set_index - b.set_index);

async function benchAt(weightKg: number) {
  const workoutId = await startFreestyleWorkout();
  const weId = await addExerciseToWorkout(workoutId, BENCH);
  const setId = await addSet(weId, { weight_kg: weightKg, reps: 5 });
  return { workoutId, weId, setId };
}

describe('generating a warm-up ramp', () => {
  it('lays the rungs in front of the working sets', async () => {
    const { weId } = await benchAt(100);

    const count = await generateWarmupSets(weId, 100);

    const sets = await liveSets(weId);
    expect(count).toBe(4);
    expect(sets.map((set) => set.type)).toEqual([
      'warmup', 'warmup', 'warmup', 'warmup', 'working',
    ]);
    // The working set keeps its weight and moves to the end.
    expect(sets.at(-1)!.weight_kg).toBe(100);
    expect(sets.map((set) => set.set_index)).toEqual([0, 1, 2, 3, 4]);
  });

  it('replaces an existing ramp rather than stacking a second one', async () => {
    const { weId } = await benchAt(100);
    await generateWarmupSets(weId, 100);

    await generateWarmupSets(weId, 60);

    const warmups = (await liveSets(weId)).filter((set) => set.type === 'warmup');
    // Four rungs, not eight: the first ramp was cleared rather than added to.
    expect(warmups).toHaveLength(4);
    // And they are the ramp for 60kg, not the one for 100kg.
    expect(warmups.map((set) => set.weight_kg)).toEqual([20, 32.5, 40, 50]);
  });

  it('clears the ramp when there is nothing left to ramp to', async () => {
    const { weId } = await benchAt(100);
    await generateWarmupSets(weId, 100);

    // A bare bar cannot be warmed up to.
    const count = await generateWarmupSets(weId, 20);

    expect(count).toBe(0);
    const sets = await liveSets(weId);
    expect(sets.every((set) => set.type !== 'warmup')).toBe(true);
    expect(sets.map((set) => set.set_index)).toEqual([0]);
  });

  it('never counts toward volume, even once ticked', async () => {
    const { weId, setId, workoutId } = await benchAt(100);
    await generateWarmupSets(weId, 100);
    for (const set of await liveSets(weId)) await completeSet(set.id, true);
    await finishWorkout(workoutId);

    const sets = await liveSets(weId);
    // 100 x 5 only. The ramp is preparation, not training.
    expect(totalTonnage(sets)).toBe(500);
    expect(sets.find((set) => set.id === setId)!.type).toBe('working');
  });

  it('never becomes last session\'s number', async () => {
    const { weId, workoutId } = await benchAt(100);
    await generateWarmupSets(weId, 100);
    for (const set of await liveSets(weId)) await completeSet(set.id, true);
    await finishWorkout(workoutId);

    const previous = previousPerformance([
      { workout_id: workoutId, performed_at: nowIso(), sets: await liveSets(weId), readiness: null },
    ]);

    expect(previous!.top_set.weight_kg).toBe(100);
  });

  it('refuses a finished workout', async () => {
    const { weId, setId, workoutId } = await benchAt(100);
    await completeSet(setId, true);
    await finishWorkout(workoutId);

    await expect(generateWarmupSets(weId, 100)).rejects.toBeInstanceOf(ImmutableWorkoutError);
  });
});

describe('reordering exercises mid-session', () => {
  const order = async (workoutId: string) =>
    (await db.workout_exercises.where({ workout_id: workoutId }).toArray())
      .filter((we) => we.deleted_at === null)
      .sort((a, b) => a.position - b.position)
      .map((we) => we.exercise_id);

  it('moves an exercise later and renumbers consecutively', async () => {
    const workoutId = await startFreestyleWorkout();
    const first = await addExerciseToWorkout(workoutId, BENCH);
    await addExerciseToWorkout(workoutId, ROW);

    await moveWorkoutExercise(workoutId, first, 'down');

    expect(await order(workoutId)).toEqual([ROW, BENCH]);
    const positions = (await db.workout_exercises.where({ workout_id: workoutId }).toArray())
      .map((we) => we.position)
      .sort();
    expect(positions).toEqual([0, 1]);
  });

  it('is a no-op at either end', async () => {
    const workoutId = await startFreestyleWorkout();
    const first = await addExerciseToWorkout(workoutId, BENCH);
    await addExerciseToWorkout(workoutId, ROW);

    await moveWorkoutExercise(workoutId, first, 'up');

    expect(await order(workoutId)).toEqual([BENCH, ROW]);
  });

  it('queues every changed row for sync', async () => {
    const workoutId = await startFreestyleWorkout();
    const first = await addExerciseToWorkout(workoutId, BENCH);
    await addExerciseToWorkout(workoutId, ROW);
    await db.outbox.clear();

    await moveWorkoutExercise(workoutId, first, 'down');

    const queued = await db.outbox.where({ table_name: 'workout_exercises' }).toArray();
    expect(queued).toHaveLength(2);
  });

  it('refuses a finished workout', async () => {
    const workoutId = await startFreestyleWorkout();
    const first = await addExerciseToWorkout(workoutId, BENCH);
    const setId = await addSet(first, { weight_kg: 60, reps: 5 });
    await addExerciseToWorkout(workoutId, ROW);
    await completeSet(setId, true);
    await finishWorkout(workoutId);

    await expect(moveWorkoutExercise(workoutId, first, 'down')).rejects.toBeInstanceOf(
      ImmutableWorkoutError,
    );
  });

  it('keeps a superset together and moves the rest with it', async () => {
    const workoutId = await startFreestyleWorkout();
    const first = await addExerciseToWorkout(workoutId, BENCH);
    await addExerciseToWorkout(workoutId, ROW);
    await toggleSupersetWithNext(first);

    await moveWorkoutExercise(workoutId, first, 'down');

    const rows = (await db.workout_exercises.where({ workout_id: workoutId }).toArray())
      .sort((a, b) => a.position - b.position);
    // Grouping lives on the rows, so swapping the pair does not dissolve it.
    expect(rows[0]!.superset_group).toBe(rows[1]!.superset_group);
    expect(rows[0]!.superset_group).not.toBeNull();
  });
});

describe('repeating a session', () => {
  async function finishedSession() {
    const workoutId = await startFreestyleWorkout();
    const weId = await addExerciseToWorkout(workoutId, BENCH);
    const first = await addSet(weId, { weight_kg: 100, reps: 5 });
    const second = await addSet(weId, { weight_kg: 100, reps: 5 });
    await completeSet(first, true);
    await completeSet(second, true);
    await addChildSet(first, 'drop');
    await generateWarmupSets(weId, 100);
    await finishWorkout(workoutId);
    return { workoutId, weId };
  }

  it('copies the shape but none of the numbers', async () => {
    const { workoutId } = await finishedSession();

    const repeatId = await repeatWorkout(workoutId);

    const [copied] = (await db.workout_exercises.where({ workout_id: repeatId }).toArray());
    const sets = await liveSets(copied!.id);
    expect(copied!.exercise_id).toBe(BENCH);
    // Two working sets were completed, so two arrive — empty.
    expect(sets).toHaveLength(2);
    expect(sets.every((set) => set.weight_kg === 0 && set.reps === 0 && !set.completed)).toBe(true);
  });

  it('does not copy warm-ups or child sets', async () => {
    const { workoutId } = await finishedSession();

    const repeatId = await repeatWorkout(workoutId);

    const [copied] = (await db.workout_exercises.where({ workout_id: repeatId }).toArray());
    const sets = await liveSets(copied!.id);
    expect(sets.every((set) => set.type === 'working')).toBe(true);
    expect(sets.every((set) => set.parent_set_id === null)).toBe(true);
  });

  it('leaves the session it copied exactly as it was performed', async () => {
    const { workoutId, weId } = await finishedSession();
    const before = await liveSets(weId);

    const repeatId = await repeatWorkout(workoutId);
    const [copied] = (await db.workout_exercises.where({ workout_id: repeatId }).toArray());
    await updateSet((await liveSets(copied!.id))[0]!.id, { weight_kg: 60, reps: 12 });

    // Copies, never references — the same guarantee that protects a routine.
    expect(await liveSets(weId)).toEqual(before);
  });

  it('does not re-tick the calendar slot of the session it copied', async () => {
    const { workoutId } = await finishedSession();
    await db.workouts.update(workoutId, {
      plan_id: 'plan-1',
      plan_week: 2,
      plan_session_index: 1,
    });

    const repeat = (await db.workouts.get(await repeatWorkout(workoutId)))!;

    expect(repeat.plan_id).toBeNull();
    expect(repeat.plan_week).toBeNull();
    expect(repeat.plan_session_index).toBeNull();
  });

  it('gives a superset a new group id rather than reusing the old one', async () => {
    const workoutId = await startFreestyleWorkout();
    const first = await addExerciseToWorkout(workoutId, BENCH);
    const second = await addExerciseToWorkout(workoutId, ROW);
    await toggleSupersetWithNext(first);
    for (const weId of [first, second]) {
      const setId = await addSet(weId, { weight_kg: 40, reps: 8 });
      await completeSet(setId, true);
    }
    const sourceGroup = (await db.workout_exercises.get(first))!.superset_group;
    await finishWorkout(workoutId);

    const rows = (await db.workout_exercises.where({ workout_id: await repeatWorkout(workoutId) }).toArray())
      .sort((a, b) => a.position - b.position);

    expect(rows[0]!.superset_group).toBe(rows[1]!.superset_group);
    expect(rows[0]!.superset_group).not.toBe(sourceGroup);
  });
});

describe('a lift you have never done', () => {
  it('is estimated from a related lift, against real logged history', async () => {
    const incline = 'exercise-incline';
    await db.exercises.add(
      exercise(incline, { name: 'Barbell Incline Press', equipment: 'barbell' }),
    );

    // Actually train the bench, so the estimate reasons from logged sets rather
    // than from a fixture.
    const workoutId = await startFreestyleWorkout();
    const benchWe = await addExerciseToWorkout(workoutId, BENCH);
    const setId = await addSet(benchWe, { weight_kg: 100, reps: 5 });
    await completeSet(setId, true);
    await finishWorkout(workoutId);

    const benchExercise = (await db.exercises.get(BENCH))!;
    const inclineExercise = (await db.exercises.get(incline))!;

    const estimate = estimateOpeningWeight(
      inclineExercise,
      [{ exercise: benchExercise, history: await exerciseSessions(BENCH) }],
      { mode: 'barbell', barWeight: 20, plates: [25, 20, 15, 10, 5, 2.5, 1.25] },
    )!;

    // Names the lift it reasoned from, so the reason can say so out loud.
    expect(estimate.basis).toBe(benchExercise.name);
    expect(estimate.weight_kg).toBeGreaterThan(0);
    expect(estimate.weight_kg).toBeLessThan(100);
    expect((estimate.weight_kg - 20) % 2.5).toBe(0);
  });

  it('says nothing when the only history is an unrelated lift', async () => {
    const curl = 'exercise-curl';
    await db.exercises.add(
      exercise(curl, {
        name: 'Dumbbell Curl',
        equipment: 'dumbbell',
        movement_pattern: 'isolation',
        primary_muscle: 'biceps',
      }),
    );

    const workoutId = await startFreestyleWorkout();
    const curlWe = await addExerciseToWorkout(workoutId, curl);
    const setId = await addSet(curlWe, { weight_kg: 12.5, reps: 10 });
    await completeSet(setId, true);
    await finishWorkout(workoutId);

    const estimate = estimateOpeningWeight(
      (await db.exercises.get(BENCH))!,
      [{ exercise: (await db.exercises.get(curl))!, history: await exerciseSessions(curl) }],
      { mode: 'barbell', barWeight: 20, plates: [25, 20, 15, 10, 5, 2.5, 1.25] },
    );

    expect(estimate).toBeNull();
  });
});
