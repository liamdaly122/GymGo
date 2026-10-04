/**
 * Email sign-in. One user, one phone, signed in once.
 *
 * No password to remember and nothing to leak. The only thing the client ever
 * holds is the anon public key and a session token.
 *
 * The email carries a six-digit code as well as a link, and the code is the
 * one that matters on an iPhone. A home-screen app keeps its storage apart
 * from Safari, and a link tapped in Mail opens in Safari — so the link signs
 * Safari in and leaves the app exactly where it was. Typing the code into the
 * app signs in the app itself.
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
 * Emails a sign-in code (and a link, for a browser). Creates the account on
 * first use. A refusal is thrown as what to do about it (`explainSignInError`),
 * not Supabase's own wording.
 */
export async function sendSignInCode(email: string): Promise<void> {
  const client = getClient();
  if (!client) throw new Error('No Supabase project is configured.');

  const redirectTo = typeof window === 'undefined' ? undefined : window.location.origin;
  const { error } = await client.auth.signInWithOtp({
    email,
    options: { shouldCreateUser: true, ...(redirectTo ? { emailRedirectTo: redirectTo } : {}) },
  });
  if (error) throw new Error(explainSignInError(error));
}

/** Signs this app in with the code from the email. */
export async function verifySignInCode(email: string, code: string): Promise<void> {
  const client = getClient();
  if (!client) throw new Error('No Supabase project is configured.');

  const token = code.replace(/\s+/g, '');
  const { error } = await client.auth.verifyOtp({ email, token, type: 'email' });
  if (error) {
    throw new Error(
      error.code === 'otp_expired' || /expired|invalid/i.test(error.message)
        ? 'That code did not work. Codes expire after an hour — check it, or send a new one.'
        : explainSignInError(error),
    );
  }
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
