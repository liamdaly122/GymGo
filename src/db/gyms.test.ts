import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from './db';
import { SETTINGS_ID } from './schema';
import {
  DEFAULT_PLATES,
  LastGymError,
  createGym,
  defaultGymId,
  deleteGym,
  setDefaultGym,
  startFreestyleWorkout,
  updateGym,
} from './mutations';

beforeEach(async () => {
  await db.open();
  await Promise.all(db.tables.map((table) => table.clear()));
  await db.settings.add({
    id: SETTINGS_ID,
    units: 'kg',
    default_gym_id: null,
    mode: 'beginner',
    default_rest_seconds: 120,
    sound_on: true,
    week_starts_on: 1,
    vibrate_on: true,
    last_synced_at: null,
    user_id: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    deleted_at: null,
  });
});

const live = async () => (await db.gyms.toArray()).filter((gym) => gym.deleted_at === null);

describe('creating gyms', () => {
  it('makes the first gym the default and leaves later ones alone', async () => {
    const first = await createGym('Home');
    const second = await createGym('Commercial');

    expect((await db.gyms.get(first))!.is_default).toBe(true);
    expect((await db.gyms.get(second))!.is_default).toBe(false);
    expect((await db.settings.get(SETTINGS_ID))!.default_gym_id).toBe(first);
  });

  it('starts empty rather than fully equipped', async () => {
    const id = await createGym('Garage');
    const gym = (await db.gyms.get(id))!;

    // Ticking what you own is quicker and more honest than un-ticking what you
    // do not: a gym that claims everything makes plan filtering inert.
    expect(gym.equipment_available).toEqual(['bodyweight']);
    expect(gym.plates_available).toEqual(DEFAULT_PLATES);
  });

  it('queues the new row for sync', async () => {
    const id = await createGym('Home');
    const queued = await db.outbox.where({ table_name: 'gyms' }).toArray();
    expect(queued.some((entry) => entry.row_id === id && entry.op === 'put')).toBe(true);
  });
});

describe('choosing the default', () => {
  it('leaves exactly one gym holding the flag', async () => {
    const home = await createGym('Home');
    const commercial = await createGym('Commercial');

    await setDefaultGym(commercial);

    const flagged = (await live()).filter((gym) => gym.is_default);
    expect(flagged.map((gym) => gym.id)).toEqual([commercial]);
    expect((await db.settings.get(SETTINGS_ID))!.default_gym_id).toBe(commercial);
    expect(await defaultGymId()).toBe(commercial);
    expect(home).not.toBe(commercial);
  });
});

describe('editing a gym', () => {
  it('persists the equipment list and restamps updated_at', async () => {
    const id = await createGym('Garage');
    const before = (await db.gyms.get(id))!.updated_at;

    await updateGym(id, { equipment_available: ['dumbbell', 'bodyweight'], bar_weights: [] });

    const gym = (await db.gyms.get(id))!;
    expect(gym.equipment_available).toEqual(['dumbbell', 'bodyweight']);
    expect(gym.bar_weights).toEqual([]);
    expect(gym.updated_at >= before).toBe(true);
  });
});

describe('deleting a gym', () => {
  it('refuses to remove the last one', async () => {
    const only = await createGym('Home');

    await expect(deleteGym(only)).rejects.toBeInstanceOf(LastGymError);
    expect(await live()).toHaveLength(1);
  });

  it('soft deletes so the delete can propagate', async () => {
    const home = await createGym('Home');
    const commercial = await createGym('Commercial');

    await deleteGym(commercial);

    // The row survives with a tombstone; removing it outright would leave the
    // remote copy alive forever.
    expect(await db.gyms.get(commercial)).toBeDefined();
    expect((await db.gyms.get(commercial))!.deleted_at).not.toBeNull();
    expect((await live()).map((gym) => gym.id)).toEqual([home]);

    const queued = await db.outbox.where({ table_name: 'gyms' }).toArray();
    expect(queued.some((entry) => entry.row_id === commercial && entry.op === 'delete')).toBe(true);
  });

  it('hands the default to a survivor and strips the flag from the tombstone', async () => {
    const home = await createGym('Home');
    const commercial = await createGym('Commercial');
    await setDefaultGym(commercial);

    await deleteGym(commercial);

    expect((await db.gyms.get(commercial))!.is_default).toBe(false);
    expect((await db.gyms.get(home))!.is_default).toBe(true);
    expect((await db.settings.get(SETTINGS_ID))!.default_gym_id).toBe(home);
    expect(await defaultGymId()).toBe(home);
  });
});

describe('the gym a session is recorded against', () => {
  it('ignores deleted gyms when settings still point at one', async () => {
    const home = await createGym('Home');
    const commercial = await createGym('Commercial');
    await setDefaultGym(commercial);
    await deleteGym(commercial);

    expect(await defaultGymId()).toBe(home);
  });

  it('stamps the workout with the default gym', async () => {
    const home = await createGym('Home');
    const workoutId = await startFreestyleWorkout();

    // Without this the progression engine rounds to a fallback plate set rather
    // than the plates the session was actually performed with.
    expect((await db.workouts.get(workoutId))!.gym_id).toBe(home);
  });
});
