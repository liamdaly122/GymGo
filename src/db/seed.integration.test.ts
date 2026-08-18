import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from './db';
import { seedIfEmpty } from './seed';
import { SETTINGS_ID } from './schema';

beforeEach(async () => {
  await db.open();
  await Promise.all(db.tables.map((table) => table.clear()));
});

describe('seeding', () => {
  it('populates exercises, a default gym and settings on first run', async () => {
    await seedIfEmpty();
    expect(await db.exercises.count()).toBeGreaterThan(500);
    expect(await db.gyms.count()).toBe(1);
    expect(await db.settings.get(SETTINGS_ID)).toBeDefined();
  });

  it('does nothing on a second run', async () => {
    await seedIfEmpty();
    const count = await db.exercises.count();
    await seedIfEmpty();
    expect(await db.exercises.count()).toBe(count);
  });

  /**
   * React StrictMode mounts effects twice in development, and two tabs can open
   * at once in production. Both callers used to observe an empty table and both
   * tried to insert, and the loser failed on every row with a constraint error.
   */
  it('survives concurrent callers without duplicating or throwing', async () => {
    await expect(
      Promise.all([seedIfEmpty(), seedIfEmpty(), seedIfEmpty()]),
    ).resolves.toBeDefined();

    const exercises = await db.exercises.toArray();
    expect(new Set(exercises.map((ex) => ex.id)).size).toBe(exercises.length);
    expect(await db.gyms.count()).toBe(1);
  });

  it('leaves user edits alone when called again', async () => {
    await seedIfEmpty();
    const first = (await db.exercises.toArray())[0]!;
    await db.exercises.update(first.id, { setup_notes: 'Pin 4, seat 3' });

    await seedIfEmpty();

    expect((await db.exercises.get(first.id))!.setup_notes).toBe('Pin 4, seat 3');
  });
});
