import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from './db';
import { addExerciseToWorkout, addSet, completeSetWith, finishWorkout, startFreestyleWorkout } from './mutations';
import { exportAsJson, importFromJson } from './backup';
import { loadRewards } from './rewards';
import { nowIso } from '@/lib/dates';
import type { Exercise } from './schema';

const BENCH = 'exercise-bench';

beforeEach(async () => {
  await db.open();
  await Promise.all(db.tables.map((table) => table.clear()));
  await db.exercises.add({
    id: BENCH,
    name: 'Barbell Bench Press',
    primary_muscle: 'chest',
    secondary_muscles: [],
    equipment: 'barbell',
    movement_pattern: 'horizontal_push',
    is_compound: true,
    is_unilateral: false,
    experience_level: 'beginner',
    fatigue_cost: 4,
    demo_url: null,
    default_rest_seconds: 180,
    setup_notes: null,
    is_custom: false,
    source_id: 'bench',
    increment_kg: null,
    user_id: null,
    created_at: nowIso(),
    updated_at: nowIso(),
    deleted_at: null,
  } satisfies Exercise);
});

/** A bench session of `count` sets at `kg` × 5, finished unless told otherwise. */
async function session(kg: number, count = 3, finish = true): Promise<string> {
  const workoutId = await startFreestyleWorkout();
  const weId = await addExerciseToWorkout(workoutId, BENCH);
  for (let index = 0; index < count; index += 1) {
    const setId = await addSet(weId, { weight_kg: kg, reps: 5 });
    await completeSetWith(setId, { weight_kg: kg, reps: 5 });
  }
  if (finish) await finishWorkout(workoutId);
  return workoutId;
}

const today = () => new Date();

describe('rewards read from the database', () => {
  it('counts every finished session, and the record the second one set', async () => {
    const first = await session(100);
    const second = await session(102.5);

    const rewards = await loadRewards(today());
    expect(rewards.sessions.get(first)!.records).toBe(0);
    expect(rewards.sessions.get(second)!.records).toBe(1);
    expect(rewards.families.find((family) => family.family === 'sessions')!.value).toBe(2);
    expect(rewards.xp).toBeGreaterThan(0);
  });

  it('gives a session still under way nothing until it is finished', async () => {
    await session(100);
    const open = await session(110, 3, false);

    const rewards = await loadRewards(today());
    expect(rewards.sessions.has(open)).toBe(false);
    expect(rewards.families.find((family) => family.family === 'records')!.value).toBe(0);
  });

  it('forgets a session once it is deleted', async () => {
    await session(100);
    const deleted = await session(140);
    await db.workouts.update(deleted, { deleted_at: nowIso() });

    const rewards = await loadRewards(today());
    expect(rewards.sessions.has(deleted)).toBe(false);
    // Its 140kg would have been three plates.
    expect(rewards.families.find((family) => family.family === 'plates')!.value).toBe(100);
  });

  it('comes back exactly as it was from a backup, because nothing was stored', async () => {
    await session(100);
    await session(102.5, 4);
    await session(105, 5);
    const before = await loadRewards(today());

    const backup = JSON.stringify(await exportAsJson());
    await Promise.all(db.tables.map((table) => table.clear()));
    expect((await loadRewards(today())).xp).toBe(0);
    await importFromJson(backup);

    const after = await loadRewards(today());
    expect(after.xp).toBe(before.xp);
    expect(after.level).toEqual(before.level);
    expect(after.streak).toEqual(before.streak);
    expect(after.families).toEqual(before.families);
  });
});
