/**
 * The Supabase client. The ONLY module allowed to construct one.
 *
 * Nothing under src/features may import this, or anything else in src/sync that
 * touches the network — a test enforces that. The rule from the brief is that no
 * code path lets the UI await a Supabase call, and the cheapest way to guarantee
 * it is to keep the client out of the UI's reach entirely.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_ANON_KEY, SUPABASE_URL, isSyncConfigured } from './config';
import { nativeSessionStore } from '@/platform/durable';

let client: SupabaseClient | null = null;

export { isSyncConfigured };

/**
 * The client, or null when no project is configured.
 *
 * Null is the normal state until Supabase is set up, and every caller handles it
 * — sync being unavailable is never an error, it is just an app that has not
 * been given somewhere to back up to yet.
 */
export function getClient(): SupabaseClient | null {
  if (!isSyncConfigured()) return null;
  client ??= createClient(SUPABASE_URL!, SUPABASE_ANON_KEY!, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      // Inside the iPhone app the session is kept in UserDefaults, which iOS
      // does not reclaim; on the website supabase-js keeps its localStorage.
      storage: nativeSessionStore(),
      // Nothing comes back in a URL: sign-in is a password typed into the app,
      // and the fragment belongs to the app's own router.
      detectSessionInUrl: false,
    },
  });
  return client;
}

/** Tables that sync, in dependency order so a restore never lands an orphan. */
export const SYNCED_TABLES = [
  'exercises',
  'gyms',
  'routines',
  'routine_exercises',
  'plans',
  'workouts',
  'workout_exercises',
  'sets',
  'body_metrics',
  'settings',
] as const;

export type SyncedTable = (typeof SYNCED_TABLES)[number];
