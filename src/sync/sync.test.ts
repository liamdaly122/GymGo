import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Push and pull against a stand-in client.
 *
 * The Docker daemon is not available in this environment, so a real Postgres
 * with row level security cannot be started here. What IS testable without one
 * is the part that actually carries risk: which rows get sent, what shape they
 * are sent in, and how a remote row is merged against a local one. The
 * round trip against a live project is the user's to run.
 */

const upserts: Array<{ table: string; rows: Array<Record<string, unknown>> }> = [];
let remoteRows: Record<string, Array<Record<string, unknown>>> = {};
let upsertError: string | null = null;

vi.mock('./client', async () => {
  const actual = await vi.importActual<typeof import('./client')>('./client');
  return {
    ...actual,
    isSyncConfigured: () => true,
    getClient: () => ({
      from(table: string) {
        return {
          upsert(rows: Array<Record<string, unknown>>) {
            if (upsertError) return Promise.resolve({ error: { message: upsertError } });
            upserts.push({ table, rows });
            return Promise.resolve({ error: null });
          },
          // Chainable and lazy, like the real query builder: nothing runs until
          // it is awaited, so the calls can be made in any order.
          select() {
            let since: string | null = null;
            let range: [number, number] = [0, 999];

            const chain = {
              order: () => chain,
              gt: (_column: string, value: string) => {
                since = value;
                return chain;
              },
              range: (from: number, to: number) => {
                range = [from, to];
                return chain;
              },
              then(resolve: (value: { data: unknown[]; error: null }) => unknown) {
                const all = (remoteRows[table] ?? []).filter((row) =>
                  since ? Date.parse(row['updated_at'] as string) > Date.parse(since) : true,
                );
                return Promise.resolve(
                  resolve({ data: all.slice(range[0], range[1] + 1), error: null }),
                );
              },
            };
            return chain;
          },
        };
      },
    }),
  };
});

const { db } = await import('@/db/db');
const { pushOutbox, pendingCount } = await import('./push');
const { pullSince } = await import('./pull');
const {
  startFreestyleWorkout,
  addExerciseToWorkout,
  addSet,
  updateSet,
} = await import('@/db/mutations');

beforeEach(async () => {
  upserts.length = 0;
  remoteRows = {};
  upsertError = null;
  await db.open();
  await Promise.all(db.tables.map((table) => table.clear()));
});

describe('pushing local changes', () => {
  it('sends the current row, not the queued patch', async () => {
    const workoutId = await startFreestyleWorkout();
    const workoutExerciseId = await addExerciseToWorkout(workoutId, 'exercise-a');
    const setId = await addSet(workoutExerciseId, { weight_kg: 100, reps: 5 });
    // Two edits queue two partial patches for the same row.
    await updateSet(setId, { weight_kg: 105 });
    await updateSet(setId, { reps: 6 });

    await pushOutbox('user-1');

    const sets = upserts.find((entry) => entry.table === 'sets');
    expect(sets, 'sets should have been pushed').toBeDefined();
    // One row, complete and current — not two half-rows that would blank columns.
    expect(sets!.rows).toHaveLength(1);
    expect(sets!.rows[0]).toMatchObject({ id: setId, weight_kg: 105, reps: 6 });
    expect(sets!.rows[0]!['workout_exercise_id']).toBe(workoutExerciseId);
  });

  it('stamps the signed-in account onto everything it sends', async () => {
    const workoutId = await startFreestyleWorkout();
    await addExerciseToWorkout(workoutId, 'exercise-a');

    await pushOutbox('user-1');

    for (const entry of upserts) {
      for (const row of entry.rows) {
        expect(row['user_id'], `${entry.table} must carry the account`).toBe('user-1');
      }
    }
  });

  it('sends parents before children, so a restore never lands an orphan', async () => {
    const workoutId = await startFreestyleWorkout();
    const workoutExerciseId = await addExerciseToWorkout(workoutId, 'exercise-a');
    await addSet(workoutExerciseId, { weight_kg: 60, reps: 10 });

    await pushOutbox('user-1');

    const order = upserts.map((entry) => entry.table);
    expect(order.indexOf('workouts')).toBeLessThan(order.indexOf('workout_exercises'));
    expect(order.indexOf('workout_exercises')).toBeLessThan(order.indexOf('sets'));
  });

  it('clears the outbox only for what went up', async () => {
    const workoutId = await startFreestyleWorkout();
    await addExerciseToWorkout(workoutId, 'exercise-a');
    expect(await pendingCount()).toBeGreaterThan(0);

    await pushOutbox('user-1');

    expect(await pendingCount()).toBe(0);
  });

  it('leaves the queue intact when the server rejects it', async () => {
    const workoutId = await startFreestyleWorkout();
    await addExerciseToWorkout(workoutId, 'exercise-a');
    const before = await pendingCount();
    upsertError = 'network is unreachable';

    await expect(pushOutbox('user-1')).rejects.toThrow(/network is unreachable/);

    // Nothing lost: it will go up on the next opportunity.
    expect(await pendingCount()).toBe(before);
  });

  it('propagates a soft delete rather than skipping the row', async () => {
    const workoutId = await startFreestyleWorkout();
    const { discardWorkout } = await import('@/db/mutations');
    await discardWorkout(workoutId);

    await pushOutbox('user-1');

    const workouts = upserts.find((entry) => entry.table === 'workouts');
    expect(workouts!.rows.at(-1)!['deleted_at']).not.toBeNull();
  });
});

describe('pulling remote changes', () => {
  const remoteRoutine = (overrides: Record<string, unknown> = {}) => ({
    id: 'routine-remote',
    user_id: 'user-1',
    name: 'From the other device',
    notes: null,
    archived: false,
    generated_from_plan_id: null,
    created_at: '2026-08-01T10:00:00.000Z',
    updated_at: '2026-08-10T10:00:00.000Z',
    deleted_at: null,
    ...overrides,
  });

  it('writes down rows that do not exist locally', async () => {
    remoteRows = { routines: [remoteRoutine()] };

    const result = await pullSince(null);

    expect(result.pulled).toBe(1);
    expect((await db.routines.get('routine-remote'))!.name).toBe('From the other device');
  });

  it('returns the newest timestamp as the next cursor', async () => {
    remoteRows = {
      routines: [
        remoteRoutine({ id: 'a', updated_at: '2026-08-10T10:00:00.000Z' }),
        remoteRoutine({ id: 'b', updated_at: '2026-08-12T10:00:00.000Z' }),
      ],
    };

    expect((await pullSince(null)).cursor).toBe('2026-08-12T10:00:00.000Z');
  });

  it('only asks for what changed since the cursor', async () => {
    remoteRows = {
      routines: [
        remoteRoutine({ id: 'old', updated_at: '2026-08-01T10:00:00.000Z' }),
        remoteRoutine({ id: 'new', updated_at: '2026-08-20T10:00:00.000Z' }),
      ],
    };

    const result = await pullSince('2026-08-10T00:00:00.000Z');

    expect(result.pulled).toBe(1);
    expect(await db.routines.get('new')).toBeDefined();
    expect(await db.routines.get('old')).toBeUndefined();
  });

  /** Last write wins on updated_at, per the brief. */
  it('keeps the newer of the two versions', async () => {
    await db.routines.put(remoteRoutine({ name: 'Local, edited later', updated_at: '2026-08-15T10:00:00.000Z' }) as never);
    remoteRows = { routines: [remoteRoutine({ name: 'Remote, older', updated_at: '2026-08-10T10:00:00.000Z' })] };

    await pullSince(null);

    expect((await db.routines.get('routine-remote'))!.name).toBe('Local, edited later');
  });

  it('takes the remote version when it is the newer one', async () => {
    await db.routines.put(remoteRoutine({ name: 'Local, older', updated_at: '2026-08-05T10:00:00.000Z' }) as never);
    remoteRows = { routines: [remoteRoutine({ name: 'Remote, newer', updated_at: '2026-08-20T10:00:00.000Z' })] };

    await pullSince(null);

    expect((await db.routines.get('routine-remote'))!.name).toBe('Remote, newer');
  });

  it('brings a remote delete down as a tombstone', async () => {
    await db.routines.put(remoteRoutine({ updated_at: '2026-08-05T10:00:00.000Z' }) as never);
    remoteRows = {
      routines: [remoteRoutine({ deleted_at: '2026-08-20T10:00:00.000Z', updated_at: '2026-08-20T10:00:00.000Z' })],
    };

    await pullSince(null);

    expect((await db.routines.get('routine-remote'))!.deleted_at).not.toBeNull();
  });
});
