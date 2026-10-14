import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from './db';
import { addExerciseToWorkout, addSet, finishWorkout, removeSet, startFreestyleWorkout } from './mutations';
import { seedIfEmpty } from './seed';
import { applyWatchEvent, applyWatchEvents, watchSnapshotFor, type WatchEvent } from './watch';

const describe_ = (entries: readonly { exercise?: { name: string } | undefined }[]) => ({
  name: entries.map((entry) => entry.exercise?.name ?? 'Exercise').join(' + '),
  outline: 'outline',
});

let exerciseIds: string[] = [];

beforeEach(async () => {
  await db.open();
  await Promise.all(db.tables.map((table) => table.clear()));
  await seedIfEmpty();
  const barbell = (await db.exercises.toArray()).filter((exercise) => exercise.equipment === 'barbell');
  exerciseIds = barbell.slice(0, 2).map((exercise) => exercise.id);
});

async function session() {
  const workoutId = await startFreestyleWorkout();
  const we = await addExerciseToWorkout(workoutId, exerciseIds[0]!);
  const sets = [await addSet(we), await addSet(we), await addSet(we)];
  return { workoutId, we, sets };
}

const event = (overrides: Partial<WatchEvent>): WatchEvent => ({
  id: crypto.randomUUID(), kind: 'completeSet', workoutId: '', at: '2026-10-14T18:42:00.000Z', ...overrides,
});

describe('the list the phone sends', () => {
  it('holds every set of the workout under way', async () => {
    const { workoutId, sets } = await session();
    const snapshot = (await watchSnapshotFor(workoutId, describe_))!;
    expect(snapshot.workoutId).toBe(workoutId);
    expect(snapshot.sets.map((set) => set.id)).toEqual(sets);
    expect(snapshot.stations).toHaveLength(1);
    expect(Object.keys(snapshot.lifts)).toEqual([exerciseIds[0]]);
  });

  it('is nothing once the workout is finished', async () => {
    const { workoutId } = await session();
    await finishWorkout(workoutId);
    expect(await watchSnapshotFor(workoutId, describe_)).toBeNull();
  });
});

describe('a set logged on the wrist', () => {
  it('lands as a tap would, stamped when it was done, and is queued for backup', async () => {
    const { workoutId, sets } = await session();
    await db.outbox.clear();
    const at = new Date(Date.now() - 60_000).toISOString();
    expect(await applyWatchEvent(event({ workoutId, setId: sets[0], weight: 100, reps: 5, at }))).toBe('applied');

    const set = (await db.sets.get(sets[0]!))!;
    expect(set).toMatchObject({ completed: true, weight_kg: 100, reps: 5, completed_at: at });
    // Stamped a minute ago, but changed now, so it syncs forward.
    expect(Date.parse(set.updated_at)).toBeGreaterThan(Date.parse(set.completed_at!));
    expect((await db.outbox.toArray()).map((entry) => entry.row_id)).toContain(sets[0]);
  });

  it('is skipped when the phone has deleted the set', async () => {
    const { workoutId, sets } = await session();
    await removeSet(sets[1]!);
    expect(await applyWatchEvent(event({ workoutId, setId: sets[1], weight: 100, reps: 5 }))).toBe('skipped');
  });

  it('is skipped once the workout is finished, which is immutable', async () => {
    const { workoutId, sets } = await session();
    await finishWorkout(workoutId);
    expect(await applyWatchEvent(event({ workoutId, setId: sets[0], weight: 100, reps: 5 }))).toBe('skipped');
  });

  it('loses to a later log of the same set on the phone', async () => {
    const { workoutId, sets } = await session();
    await applyWatchEvent(event({ workoutId, setId: sets[0], weight: 105, reps: 5, at: '2026-10-14T18:50:00.000Z' }));
    expect(await applyWatchEvent(event({ workoutId, setId: sets[0], weight: 100, reps: 5, at: '2026-10-14T18:42:00.000Z' }))).toBe('skipped');
    expect((await db.sets.get(sets[0]!))!.weight_kg).toBe(105);
  });
});

describe('a batch from the watch', () => {
  it('applies every set before Finish, so Finish never tidies a wrist set away', async () => {
    const { workoutId, sets } = await session();
    const finish = event({ workoutId, kind: 'finish', at: '2026-10-14T18:40:00.000Z' });
    const logged = event({ workoutId, setId: sets[0], weight: 100, reps: 5, at: '2026-10-14T18:45:00.000Z' });
    const done = await applyWatchEvents([finish, logged]);

    expect(done.sort()).toEqual([finish.id, logged.id].sort());
    const workout = (await db.workouts.get(workoutId))!;
    expect(workout.finished_at).not.toBeNull();
    // Finish soft-deletes unticked sets; the wrist's set survived it.
    expect((await db.sets.get(sets[0]!))).toMatchObject({ completed: true, deleted_at: null });
    expect((await db.sets.get(sets[1]!))!.deleted_at).not.toBeNull();
  });
});
