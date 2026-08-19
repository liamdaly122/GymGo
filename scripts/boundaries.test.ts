import { readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The brief's hardest rule, enforced rather than trusted:
 *
 *   "Never introduce a code path where the UI awaits a Supabase call.
 *    If one appears, it is a bug."
 *
 * A code review cannot hold that line over time. These tests can. They read the
 * source and fail the build if the network gets anywhere near the path between
 * the user and logging a set.
 */

const root = resolve(import.meta.dirname, '..');

function filesUnder(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = resolve(dir, entry);
    if (statSync(full).isDirectory()) out.push(...filesUnder(full));
    else if (/\.(ts|tsx)$/.test(entry) && !entry.endsWith('.test.ts')) out.push(full);
  }
  return out;
}

const relative = (path: string) => path.slice(root.length + 1);

describe('sync stays out of the hot path', () => {
  it('no screen constructs a Supabase client', () => {
    const offenders = filesUnder(resolve(root, 'src/features'))
      .filter((file) => {
        const source = readFileSync(file, 'utf8');
        return source.includes('@supabase/supabase-js') || source.includes("from '@/sync/client'");
      })
      .map(relative);

    expect(offenders, 'only src/sync may construct the client').toEqual([]);
  });

  /**
   * The logging path is the one that must never wait: every read and write hits
   * Dexie, and nothing between tapping a tick and the row landing may touch the
   * network.
   */
  it('the workout screens never import sync at all', () => {
    const offenders = filesUnder(resolve(root, 'src/features/workout'))
      .filter((file) => readFileSync(file, 'utf8').includes("@/sync"))
      .map(relative);

    expect(offenders, 'the logging path must not know sync exists').toEqual([]);
  });

  it('the database layer never imports sync', () => {
    const offenders = ['src/db/mutations.ts', 'src/db/queries.ts', 'src/db/db.ts', 'src/db/seed.ts']
      .filter((path) => readFileSync(resolve(root, path), 'utf8').includes('@/sync'))
      .map((path) => path);

    expect(offenders, 'Dexie must not depend on the network layer').toEqual([]);
  });

  it('only Settings reaches sync, and only for signing in and status', () => {
    const importers = filesUnder(resolve(root, 'src/features'))
      .filter((file) => readFileSync(file, 'utf8').includes("@/sync"))
      .map(relative);

    // Signing in is the one deliberate, user-initiated wait in the whole app.
    expect(importers).toEqual(['src/features/settings/SyncSection.tsx']);
  });

  it('the service role key appears nowhere in the source', () => {
    const offenders = [...filesUnder(resolve(root, 'src')), ...filesUnder(resolve(root, 'scripts'))]
      .filter((file) => /service_role|SERVICE_ROLE/.test(readFileSync(file, 'utf8')))
      .map(relative);

    expect(offenders, 'the service role key is never used in client code').toEqual([]);
  });
});
