/**
 * Whether a Supabase project has been configured.
 *
 * Split out from the client so a screen can ask the question without pulling in
 * the Supabase SDK — and so the boundary test can forbid the client itself from
 * ever being imported by a screen.
 */
const url = import.meta.env['VITE_SUPABASE_URL'] as string | undefined;
const anonKey = import.meta.env['VITE_SUPABASE_ANON_KEY'] as string | undefined;

export const SUPABASE_URL = url ?? null;
export const SUPABASE_ANON_KEY = anonKey ?? null;

/** The app is fully usable without one; this only gates backup and sync. */
export function isSyncConfigured(): boolean {
  return Boolean(url && anonKey);
}
