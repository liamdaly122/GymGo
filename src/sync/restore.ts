/**
 * Tidying a phone that has just taken the cloud's copy.
 */
import { db } from '@/db/db';
import { FACTORY_DEFAULT, SETTINGS_ID } from '@/db/schema';

/**
 * Drops the starter gym once a restore has brought the user's own.
 *
 * A fresh install makes "My gym", with everything ticked, before anything else,
 * so the app works before backup is ever set up. After a restore that gym is a
 * placeholder nobody chose, and keeping it would leave a second "My gym" in the
 * list for ever. Only an untouched one goes: made on this phone, still stamped
 * as a factory default, and never trained at. "Made on this phone" is what the
 * caller says — the gyms that were here before the restore — because the
 * backup's own starter gym is just as untouched and must stay. It was never
 * uploaded — a phone's first round restores before it sends anything — so
 * there is no copy elsewhere for a soft delete to reach, and removing the row
 * is the whole job.
 *
 * Returns how many were dropped.
 */
export async function dropPlaceholderGyms(madeHere: ReadonlySet<string>): Promise<number> {
  const gyms = await db.gyms.toArray();
  const restored = gyms.filter((gym) => gym.deleted_at === null && !madeHere.has(gym.id));
  if (restored.length === 0) return 0;

  const trainedAt = new Set((await db.workouts.toArray()).map((workout) => workout.gym_id));
  const placeholders = gyms.filter(
    (gym) => madeHere.has(gym.id) && gym.updated_at === FACTORY_DEFAULT && !trainedAt.has(gym.id),
  );
  if (placeholders.length === 0) return 0;

  await db.gyms.bulkDelete(placeholders.map((gym) => gym.id));

  // Factory settings point at the starter gym. Restored settings already point
  // at a restored one; only a phone whose backup had no settings row needs this.
  const settings = await db.settings.get(SETTINGS_ID);
  if (settings && placeholders.some((gym) => gym.id === settings.default_gym_id)) {
    const next = restored.find((gym) => gym.is_default) ?? restored[0]!;
    await db.settings.update(SETTINGS_ID, { default_gym_id: next.id });
  }

  return placeholders.length;
}
