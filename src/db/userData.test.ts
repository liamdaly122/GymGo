import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from './db';
import { createRoutine, startFreestyleWorkout } from './mutations';
import { hasUserData } from './queries';
import { seedIfEmpty } from './seed';

beforeEach(async () => {
  await db.open();
  await Promise.all(db.tables.map((table) => table.clear()));
  await seedIfEmpty();
});

/**
 * The snapshot offer on launch rests on this: the seed alone is "nothing of
 * the lifter's own", and anything they made or logged is.
 */
describe('hasUserData', () => {
  it('is false on a fresh install, seed and all', async () => {
    expect(await db.exercises.count()).toBeGreaterThan(0);
    expect(await hasUserData()).toBe(false);
  });

  it('is true once a session has been started', async () => {
    await startFreestyleWorkout();
    expect(await hasUserData()).toBe(true);
  });

  it('is true once a routine exists', async () => {
    await createRoutine('Push');
    expect(await hasUserData()).toBe(true);
  });
});
