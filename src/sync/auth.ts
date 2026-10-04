/**
 * Sign-in for backup: email and password. One user, one phone, signed in once.
 *
 * The brief asked for an emailed magic link, and that cannot reach a
 * home-screen app on an iPhone: the app keeps its storage apart from Safari,
 * and a link tapped in Mail opens Safari, which signs Safari in and leaves the
 * app signed out. A code typed into the app would get round that, but
 * Supabase's built-in email sends fixed templates — a link, no code — and only
 * a custom SMTP server unlocks them, which means another service. A password
 * involves no email at all. The account is made once in the Supabase
 * dashboard, signing in happens inside the app, and the phone can keep the
 * password in its keychain.
 *
 * The client only ever holds the anon public key and a session token; the
 * password goes to Supabase and is not kept.
 */
import { db } from '@/db/db';
import { SETTINGS_ID } from '@/db/schema';
import { SYNCED_TABLES, getClient } from './client';
import { explainSignInError } from './signInErrors';

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

/**
 * Signs this app in. A refusal is thrown as what to do about it
 * (`explainSignInError`), not in Supabase's own wording.
 */
export async function signInWithPassword(email: string, password: string): Promise<void> {
  const client = getClient();
  if (!client) throw new Error('No Supabase project is configured.');

  const { error } = await client.auth.signInWithPassword({ email: email.trim(), password });
  if (error) throw new Error(explainSignInError(error));
}

/**
 * Signs out, and forgets where the pull was up to: the next account to sign in
 * on this phone starts from a clean slate, not from someone else's cursor.
 */
export async function signOut(): Promise<void> {
  await getClient()?.auth.signOut();
  await resetSyncCursor();
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

/**
 * Clears the cursor so the next round starts as a phone's first: everything
 * the account has comes down before anything goes up. Bookkeeping, not an
 * edit, so `updated_at` is left alone.
 */
export async function resetSyncCursor(): Promise<void> {
  await db.settings.update(SETTINGS_ID, { last_synced_at: null });
}
