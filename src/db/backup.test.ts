import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from './db';
import { exportAsCsv, exportAsJson, importFromJson } from './backup';
import {
  addExerciseToWorkout,
  addSet,
  completeSet,
  createRoutine,
  discardWorkout,
  finishWorkout,
  startFreestyleWorkout,
} from './mutations';
import { ImportError } from '@/lib/export';
import { seedIfEmpty } from './seed';

beforeEach(async () => {
  await db.open();
  await Promise.all(db.tables.map((table) => table.clear()));
});

async function logASession() {
  const workoutId = await startFreestyleWorkout();
  const workoutExerciseId = await addExerciseToWorkout(workoutId, 'exercise-a');
  const setId = await addSet(workoutExerciseId, { weight_kg: 100, reps: 5 });
  await completeSet(setId);
  await finishWorkout(workoutId);
  return workoutId;
}

describe('backup round trip', () => {
  /**
   * The deliberate test the brief asks for: wipe local storage entirely, then
   * restore everything. Until sync exists this is the only route back.
   */
  it('survives a full wipe and restore', async () => {
    await seedIfEmpty();
    await createRoutine('Lower A');
    const workoutId = await logASession();

    const backup = JSON.stringify(await exportAsJson());

    await Promise.all(db.tables.map((table) => table.clear()));
    expect(await db.workouts.count()).toBe(0);
    expect(await db.exercises.count()).toBe(0);

    const result = await importFromJson(backup);

    expect(result.counts.workouts).toBe(1);
    expect(result.live_counts.workouts).toBe(1);
    expect(await db.routines.count()).toBe(1);
    expect(await db.exercises.count()).toBeGreaterThan(500);

    const restored = await db.workouts.get(workoutId);
    expect(restored?.finished_at).not.toBeNull();

    const sets = await db.sets.toArray();
    expect(sets.filter((set) => set.deleted_at === null)).toHaveLength(1);
    expect(sets.find((set) => set.deleted_at === null)?.weight_kg).toBe(100);
  });

  it('reports live rows, not tombstones, as what was restored', async () => {
    const workoutId = await startFreestyleWorkout();
    const workoutExerciseId = await addExerciseToWorkout(workoutId, 'exercise-a');
    await completeSet(await addSet(workoutExerciseId, { weight_kg: 60, reps: 10 }));
    await finishWorkout(workoutId);
    // A discarded session stays in the database as a tombstone.
    await discardWorkout(await startFreestyleWorkout());

    const result = await importFromJson(JSON.stringify(await exportAsJson()));

    expect(result.counts.workouts).toBe(2);
    expect(result.live_counts.workouts).toBe(1);
  });

  it('keeps soft-deleted rows so a restore cannot resurrect them', async () => {
    const workoutId = await startFreestyleWorkout();
    const workoutExerciseId = await addExerciseToWorkout(workoutId, 'exercise-a');
    await completeSet(await addSet(workoutExerciseId, { weight_kg: 60, reps: 10 }));
    // A second set left untouched is soft-deleted by finishWorkout.
    await addSet(workoutExerciseId, { weight_kg: 60, reps: 10 });
    await finishWorkout(workoutId);

    const backup = JSON.stringify(await exportAsJson());
    await Promise.all(db.tables.map((table) => table.clear()));
    await importFromJson(backup);

    const sets = await db.sets.toArray();
    expect(sets).toHaveLength(2);
    expect(sets.filter((set) => set.deleted_at !== null)).toHaveLength(1);
  });

  /**
   * Restoring an export used to empty the queue and queue nothing, so the
   * restored history never reached the cloud: backup uploads what the outbox
   * names, and nothing named it.
   */
  it('queues every restored row for backup, in place of the old queue', async () => {
    await logASession();
    const backup = JSON.stringify(await exportAsJson());
    // An entry describing a row the import is about to replace.
    await db.outbox.add({ table_name: 'routines', row_id: 'gone', op: 'put', payload: {}, queued_at: '2026-08-01T00:00:00.000Z' });

    const result = await importFromJson(backup);

    const queued = await db.outbox.toArray();
    expect(queued.some((entry) => entry.row_id === 'gone')).toBe(false);
    const restored = Object.values(result.counts).reduce((total, count) => total + count, 0);
    expect(restored).toBeGreaterThan(0);
    expect(new Set(queued.map((entry) => `${entry.table_name}:${entry.row_id}`)).size).toBe(restored);
  });

  it('leaves the database untouched when the file is rejected', async () => {
    await logASession();
    const before = await db.workouts.count();

    await expect(importFromJson('{"nope":true}')).rejects.toThrow(ImportError);

    expect(await db.workouts.count()).toBe(before);
  });
});

describe('CSV export from the database', () => {
  it('writes a header plus one row per completed set', async () => {
    await logASession();
    const csv = await exportAsCsv();
    const lines = csv.trim().split('\r\n');
    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain('weight_kg');
    expect(lines[1]).toContain('100');
  });
});
