/**
 * Magic-link sign-in. One user, one phone, signed in once.
 *
 * No password to remember and nothing to leak. The only thing the client ever
 * holds is the anon public key and a session token.
 */
import { db } from '@/db/db';
import { SETTINGS_ID } from '@/db/schema';
import { nowIso } from '@/lib/dates';
import { SYNCED_TABLES, getClient } from './client';

export interface SyncAccount {
  userId: string;
  email: string | null;
}

export async function currentAccount(): Promise<SyncAccount | null> {
  const client = getClient();
  if (!client) return null;
  const { data } = await client.auth.getSession();
  const user = data.session?.user;
  return user ? { userId: user.id, email: user.email ?? null } : null;
}

/** Sends the link. The user taps it on the same phone and lands back signed in. */
export async function sendMagicLink(email: string): Promise<void> {
  const client = getClient();
  if (!client) throw new Error('No Supabase project is configured.');

  const { error } = await client.auth.signInWithOtp({
    email,
    options: { emailRedirectTo: window.location.origin },
  });
  if (error) throw new Error(error.message);
}

export async function signOut(): Promise<void> {
  await getClient()?.auth.signOut();
}

/**
 * Stamps the account onto every local row, once.
 *
 * Everything logged before signing in has `user_id: null`, because a record has
 * to be valid before a server has ever seen it. This is the one-time backfill
 * the brief describes; without it the first push would be rejected by row level
 * security, which requires `auth.uid() = user_id`.
 */
export async function backfillUserId(userId: string): Promise<number> {
  let stamped = 0;

  for (const name of SYNCED_TABLES) {
    const table = db.table(name);
    await db.transaction('rw', table, async () => {
      const rows = (await table.toArray()) as Array<Record<string, unknown>>;
      const needing = rows.filter((row) => row['user_id'] !== userId);
      if (needing.length === 0) return;
      await table.bulkPut(needing.map((row) => ({ ...row, user_id: userId })));
      stamped += needing.length;
    });
  }

  return stamped;
}

/** Clears the cursor so the next sync re-pulls everything from scratch. */
export async function resetSyncCursor(): Promise<void> {
  await db.settings.update(SETTINGS_ID, { last_synced_at: null, updated_at: nowIso() });
}
