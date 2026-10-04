import 'fake-indexeddb/auto';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FakeSupabase } from './testing/fakeSupabase';

/**
 * Push, pull and the whole backup round, against a stand-in Supabase that runs
 * the real migrations on real Postgres (see `testing/`): row level security and
 * the newest-write-wins trigger are in force, and a column the server lacks is
 * refused, as it would be in production.
 *
 * The Docker daemon is not available here, so this is as close to a live
 * project as these tests can get. The browser suite `test:backup` drives the
 * real supabase-js client against the same stand-in over HTTP.
 */

const holder = vi.hoisted(() => ({ fake: null as FakeSupabase | null }));

vi.mock('./client', async () => {
  const actual = await vi.importActual<typeof import('./client')>('./client');
  return { ...actual, isSyncConfigured: () => true, getClient: () => holder.fake!.client };
});
vi.mock('./config', () => ({
  SUPABASE_URL: 'http://stand-in',
  SUPABASE_ANON_KEY: 'anon',
  isSyncConfigured: () => true,
}));

const { createFakeSupabase } = await import('./testing/fakeSupabase');
const { ensureUser, upsertRows } = await import('./testing/pgRest');
const { db } = await import('@/db/db');
const { FACTORY_DEFAULT, SETTINGS_ID } = await import('@/db/schema');
const { seedIfEmpty } = await import('@/db/seed');
const { pushOutbox, pendingCount, UPLOAD_BATCH } = await import('./push');
const { pullSince } = await import('./pull');
const { syncNow, resetSyncSession } = await import('./engine');
const { currentAccount, signInWithPassword } = await import('./auth');
const { forgetLedgers, readLedger, writeLedger } = await import('./ledger');
const { getSyncStatus, setSyncStatus } = await import('./status');
const { exportAsJson, importFromJson } = await import('@/db/backup');
const {
  startFreestyleWorkout,
  addExerciseToWorkout,
  addSet,
  updateSet,
  completeSetWith,
  finishWorkout,
  discardWorkout,
  createRoutine,
  updateRoutine,
  updateSettings,
  updateExercise,
} = await import('@/db/mutations');

const EMAIL = 'lifter@example.com';
let fake: FakeSupabase;
let userId: string;

beforeAll(async () => {
  fake = await createFakeSupabase();
  holder.fake = fake;
});

/** A phone with nothing on it, as after a wipe. */
async function wipeThePhone() {
  await db.open();
  await Promise.all(db.tables.map((table) => table.clear()));
  forgetLedgers();
  resetSyncSession();
  fake.forgetSession();
  setSyncStatus({ restoredWorkouts: null, lastSyncedAt: null });
}

beforeEach(async () => {
  // Every test gets an empty server too: a fresh account each time.
  await fake.pg.exec(
    'truncate public.exercises, public.gyms, public.routines, public.routine_exercises, public.plans, ' +
      'public.workouts, public.workout_exercises, public.sets, public.body_metrics, public.settings',
  );
  await wipeThePhone();
  fake.failUploads(null);
  fake.uploads.length = 0;
  userId = await ensureUser(fake.pg, EMAIL);
});

const serverRow = async (table: string, id: string) =>
  (await fake.rows(table)).find((row) => row['id'] === id);

async function logASession(weights: number[] = [100, 102.5]) {
  const workoutId = await startFreestyleWorkout();
  const workoutExerciseId = await addExerciseToWorkout(workoutId, '0b6a3a63-4ac2-4c5a-9a2b-5d1f0d7c0e01');
  for (const weight of weights) {
    const setId = await addSet(workoutExerciseId);
    await completeSetWith(setId, { weight_kg: weight, reps: 5 });
  }
  await finishWorkout(workoutId);
  return workoutId;
}

describe('signing in', () => {
  const PASSWORD = 'correct horse battery staple';

  it('signs the app in with an email and password', async () => {
    await fake.createUser(EMAIL, PASSWORD);

    await signInWithPassword(` ${EMAIL} `, PASSWORD);

    expect((await currentAccount())?.email).toBe(EMAIL);
  });

  /**
   * Supabase gives one answer for a wrong password and an account nobody made
   * — "Invalid login credentials" — and the second is the likelier on a first
   * sign-in, so the app says how to make one.
   */
  it('says how to make the account when the sign-in is refused', async () => {
    await fake.createUser(EMAIL, PASSWORD);

    await expect(signInWithPassword(EMAIL, 'wrong')).rejects.toThrow(/Add user, with Auto Confirm User ticked/);
    await expect(signInWithPassword('nobody@example.com', PASSWORD)).rejects.toThrow(/Wrong email or password/);
    expect(await currentAccount()).toBeNull();
  });
});

describe('pushing local changes', () => {
  beforeEach(async () => {
    await fake.signIn(EMAIL);
  });

  it('sends the current row, not the queued patch', async () => {
    const workoutId = await startFreestyleWorkout();
    const workoutExerciseId = await addExerciseToWorkout(workoutId, '0b6a3a63-4ac2-4c5a-9a2b-5d1f0d7c0e01');
    const setId = await addSet(workoutExerciseId, { weight_kg: 100, reps: 5 });
    // Two edits queue two partial patches for the same row.
    await updateSet(setId, { weight_kg: 105 });
    await updateSet(setId, { reps: 6 });

    await pushOutbox(userId);

    // One row, complete and current — not two half-rows that would blank columns.
    expect(await serverRow('sets', setId)).toMatchObject({
      weight_kg: 105,
      reps: 6,
      workout_exercise_id: workoutExerciseId,
      user_id: userId,
    });
  });

  it('sends parents before children, so a restore never lands an orphan', async () => {
    await logASession();

    await pushOutbox(userId);

    const order = fake.uploads.map((upload) => upload.table);
    expect(order.indexOf('workouts')).toBeLessThan(order.indexOf('workout_exercises'));
    expect(order.indexOf('workout_exercises')).toBeLessThan(order.indexOf('sets'));
  });

  it('clears the outbox only for what went up', async () => {
    await logASession();
    expect(await pendingCount()).toBeGreaterThan(0);

    await pushOutbox(userId);

    expect(await pendingCount()).toBe(0);
  });

  it('leaves the queue intact when the server is unreachable', async () => {
    await logASession();
    const before = await pendingCount();
    fake.failUploads('network is unreachable');

    await expect(pushOutbox(userId)).rejects.toThrow(/network is unreachable/);

    // Nothing lost: it goes up at the next opportunity.
    expect(await pendingCount()).toBe(before);
  });

  it('propagates a soft delete rather than skipping the row', async () => {
    const workoutId = await startFreestyleWorkout();
    await pushOutbox(userId);
    await discardWorkout(workoutId);

    await pushOutbox(userId);

    expect((await serverRow('workouts', workoutId))!['deleted_at']).not.toBeNull();
  });
});

describe('pulling remote changes', () => {
  const remoteRoutine = (overrides: Record<string, unknown> = {}) => ({
    id: '5f0c1e2a-0000-4000-8000-000000000001',
    user_id: userId,
    name: 'From the other device',
    notes: null,
    archived: false,
    generated_from_plan_id: null,
    created_at: '2026-08-01T10:00:00.000Z',
    updated_at: '2026-08-10T10:00:00.000Z',
    deleted_at: null,
    ...overrides,
  });
  const ROUTINE = '5f0c1e2a-0000-4000-8000-000000000001';

  beforeEach(async () => {
    await fake.signIn(EMAIL);
  });

  it('writes down rows that do not exist locally', async () => {
    await upsertRows(fake.pg, userId, 'routines', [remoteRoutine()]);

    const result = await pullSince(null);

    expect(result.pulled).toBe(1);
    expect((await db.routines.get(ROUTINE))!.name).toBe('From the other device');
  });

  it('keeps timestamps in the app’s own form', async () => {
    await upsertRows(fake.pg, userId, 'routines', [remoteRoutine()]);

    await pullSince(null);

    // Postgres writes "2026-08-10T10:00:00+00:00"; the store holds toISOString().
    expect((await db.routines.get(ROUTINE))!.updated_at).toBe('2026-08-10T10:00:00.000Z');
  });

  it('returns the newest timestamp as the next cursor, and asks only for what is newer', async () => {
    await upsertRows(fake.pg, userId, 'routines', [
      remoteRoutine({ id: '5f0c1e2a-0000-4000-8000-00000000000a', updated_at: '2026-08-01T10:00:00.000Z' }),
      remoteRoutine({ id: '5f0c1e2a-0000-4000-8000-00000000000b', updated_at: '2026-08-20T10:00:00.000Z' }),
    ]);

    expect((await pullSince(null)).cursor).toBe('2026-08-20T10:00:00.000Z');
    await db.routines.clear();
    const later = await pullSince('2026-08-10T00:00:00.000Z');
    expect(later.pulled).toBe(1);
    expect(await db.routines.get('5f0c1e2a-0000-4000-8000-00000000000b')).toBeDefined();
  });

  /** Last write wins on updated_at, per the brief. */
  it('keeps the newer of the two versions, either way round', async () => {
    await db.routines.put(remoteRoutine({ name: 'Local, edited later', updated_at: '2026-08-15T10:00:00.000Z' }) as never);
    await upsertRows(fake.pg, userId, 'routines', [remoteRoutine({ name: 'Remote, older' })]);
    await pullSince(null);
    expect((await db.routines.get(ROUTINE))!.name).toBe('Local, edited later');

    await upsertRows(fake.pg, userId, 'routines', [
      remoteRoutine({ name: 'Remote, newer', updated_at: '2026-08-20T10:00:00.000Z' }),
    ]);
    await pullSince(null);
    expect((await db.routines.get(ROUTINE))!.name).toBe('Remote, newer');
  });

  it('brings a remote delete down as a tombstone', async () => {
    await db.routines.put(remoteRoutine({ updated_at: '2026-08-05T10:00:00.000Z' }) as never);
    await upsertRows(fake.pg, userId, 'routines', [
      remoteRoutine({ deleted_at: '2026-08-20T10:00:00.000Z', updated_at: '2026-08-20T10:00:00.000Z' }),
    ]);

    await pullSince(null);

    expect((await db.routines.get(ROUTINE))!.deleted_at).not.toBeNull();
  });

  /**
   * A first backup stamps hundreds of rows with one timestamp. Paged by
   * timestamp alone, ties can come back in a different order on each page —
   * Postgres documents that a plan can change with LIMIT and OFFSET — and a
   * restore would silently skip some rows and fetch others twice; the pull
   * orders by id within a timestamp for that reason. The embedded Postgres
   * here happens to order ties consistently, so this guards the outcome, every
   * row back, rather than reproducing the hazard.
   */
  it('restores every row when a thousand share one timestamp', async () => {
    const rows = Array.from({ length: 1234 }, (_unused, index) =>
      remoteRoutine({
        id: `5f0c1e2a-0000-4000-8000-${String(index).padStart(12, '0')}`,
        name: `Routine ${index}`,
        updated_at: '2026-08-10T10:00:00.000Z',
      }),
    );
    // Stored out of id order, so nothing but the query's own ordering lines
    // the pages up.
    for (let index = rows.length - 1; index > 0; index -= 1) {
      const swap = (index * 7919) % (index + 1);
      [rows[index], rows[swap]] = [rows[swap]!, rows[index]!];
    }
    for (let start = 0; start < rows.length; start += 100) {
      await upsertRows(fake.pg, userId, 'routines', rows.slice(start, start + 100));
    }

    await pullSince(null);

    expect(await db.routines.count()).toBe(1234);
  });
});

describe('the first backup of a phone already in use', () => {
  /**
   * Months of training can predate signing in, and none of it is in the
   * outbox — an imported export was never queued until recently, and the
   * seeded library and settings never were. Uploading only the outbox would
   * back up the next workout and none of the history.
   */
  it('sends everything on the phone, not just what is queued', async () => {
    await seedIfEmpty();
    const workoutId = await logASession();
    await db.outbox.clear();
    await fake.signIn(EMAIL);

    await syncNow();

    expect(getSyncStatus().state).toBe('idle');
    expect(await serverRow('workouts', workoutId)).toBeDefined();
    expect((await fake.rows('sets')).filter((set) => set['completed'])).toHaveLength(2);
    expect(await serverRow('settings', SETTINGS_ID)).toBeDefined();
    expect((await fake.rows('gyms')).length).toBe(1);
    expect((await fake.rows('exercises')).length).toBe(await db.exercises.count());
  });

  it('goes up in batches small enough for one bar of signal', async () => {
    await seedIfEmpty();
    await fake.signIn(EMAIL);

    await syncNow();

    expect(Math.max(...fake.uploads.map((upload) => upload.rows))).toBeLessThanOrEqual(UPLOAD_BATCH);
    expect(fake.uploads.filter((upload) => upload.table === 'exercises').length).toBeGreaterThan(1);
  });

  it('only does it once: the next round sends what changed', async () => {
    await seedIfEmpty();
    await fake.signIn(EMAIL);
    await syncNow();
    fake.uploads.length = 0;

    const routineId = await createRoutine('Arms');
    await syncNow();

    expect(fake.uploads).toEqual([{ table: 'routines', rows: 1 }]);
    expect(await serverRow('routines', routineId)).toBeDefined();
  });

  it('says it is backed up only once nothing is waiting', async () => {
    await logASession();
    await fake.signIn(EMAIL);

    await syncNow();

    const status = getSyncStatus();
    expect(status.pending).toBe(0);
    expect(status.lastSyncedAt).not.toBeNull();
    expect(readLedger(userId).lastBackupAt).toBe(status.lastSyncedAt);
  });
});

describe('the daily catch-up', () => {
  /** A write that slips past the outbox still reaches the backup within a day. */
  it('sends anything changed since the last pass, queued or not', async () => {
    await fake.signIn(EMAIL);
    const routineId = await createRoutine('Push');
    await syncNow();
    // Renamed without telling the outbox, as a bug might.
    await db.routines.update(routineId, { name: 'Push (renamed)', updated_at: new Date().toISOString() });
    await db.outbox.clear();

    await syncNow();
    expect((await serverRow('routines', routineId))!['name'], 'not yet: the last pass was today').toBe('Push');

    const ledger = readLedger(userId);
    writeLedger(userId, { catchUpAt: new Date(Date.parse(ledger.catchUpAt!) - 25 * 3_600_000).toISOString() });
    await syncNow();

    expect((await serverRow('routines', routineId))!['name']).toBe('Push (renamed)');
  });
});

describe('restoring onto a wiped phone', () => {
  async function backUpAPhoneInUse() {
    await seedIfEmpty();
    const workoutId = await logASession([100, 105, 110]);
    await updateSettings({ mode: 'pro', default_rest_seconds: 150 });
    const benchId = (await db.exercises.toArray()).find((exercise) => exercise.source_id !== null)!.id;
    await updateExercise(benchId, { setup_notes: 'Pins on 7', increment_kg: 2.5 });
    const gymId = (await db.gyms.toArray())[0]!.id;
    await fake.signIn(EMAIL);
    await syncNow();
    expect(getSyncStatus().state).toBe('idle');
    return { workoutId, benchId, gymId };
  }

  /** The brief's step 10: wipe local storage and restore everything from Supabase. */
  it('brings every workout and set back', async () => {
    const { workoutId } = await backUpAPhoneInUse();

    await wipeThePhone();
    await seedIfEmpty();
    await fake.signIn(EMAIL);
    await syncNow();

    expect(getSyncStatus().state).toBe('idle');
    const workout = await db.workouts.get(workoutId);
    expect(workout?.finished_at).not.toBeNull();
    const sets = (await db.sets.toArray()).filter((set) => set.completed && set.deleted_at === null);
    expect(sets.map((set) => set.weight_kg).sort()).toEqual([100, 105, 110]);
    expect(getSyncStatus().restoredWorkouts).toBe(1);
  });

  /**
   * A fresh install's defaults are factory defaults: they lose every conflict.
   * Stamped with the moment of install, they would have looked newer than the
   * backup and replaced the user's settings and notes — on the phone and, on
   * the next upload, in the cloud.
   */
  it('keeps the settings and exercise notes from the backup, not the fresh defaults', async () => {
    const { benchId } = await backUpAPhoneInUse();

    await wipeThePhone();
    await seedIfEmpty();
    expect((await db.settings.get(SETTINGS_ID))!.updated_at).toBe(FACTORY_DEFAULT);
    await fake.signIn(EMAIL);
    await syncNow();

    const settings = (await db.settings.get(SETTINGS_ID))!;
    expect(settings.mode).toBe('pro');
    expect(settings.default_rest_seconds).toBe(150);
    expect((await db.exercises.get(benchId))!.setup_notes).toBe('Pins on 7');
    // And the cloud still has them after the fresh phone's first full upload.
    expect((await serverRow('settings', SETTINGS_ID))!['mode']).toBe('pro');
    expect((await serverRow('exercises', benchId))!['setup_notes']).toBe('Pins on 7');
  });

  it('does not add a second starter gym', async () => {
    const { gymId } = await backUpAPhoneInUse();

    await wipeThePhone();
    await seedIfEmpty();
    await fake.signIn(EMAIL);
    await syncNow();

    const gyms = (await db.gyms.toArray()).filter((gym) => gym.deleted_at === null);
    expect(gyms.map((gym) => gym.id)).toEqual([gymId]);
    expect((await db.settings.get(SETTINGS_ID))!.default_gym_id).toBe(gymId);
    expect((await fake.rows('gyms')).map((gym) => gym['id'])).toEqual([gymId]);
  });
});

describe('an old export imported on a phone that backs up', () => {
  /**
   * Restoring last month's export must not roll the cloud back to last month.
   * The server keeps the newest copy of every row, and the phone catches up
   * from it.
   */
  it('cannot overwrite newer rows in the cloud, and the phone catches up', async () => {
    await seedIfEmpty();
    await fake.signIn(EMAIL);
    const routineId = await createRoutine('Legs');
    const oldExport = JSON.stringify(await exportAsJson());
    await new Promise((resolve) => setTimeout(resolve, 5));
    await updateRoutine(routineId, { name: 'Legs, heavier' });
    await syncNow();

    await importFromJson(oldExport);
    expect((await db.routines.get(routineId))!.name).toBe('Legs');
    await syncNow();

    expect((await serverRow('routines', routineId))!['name']).toBe('Legs, heavier');
    // The export predates any backup, so the import brought no cursor with it:
    // the next round restores first, and the cloud's newer row comes down.
    expect((await db.routines.get(routineId))!.name).toBe('Legs, heavier');
  });
});
