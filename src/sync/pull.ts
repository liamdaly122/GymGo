/**
 * Bringing remote changes down.
 *
 * `last_synced_at` in settings is the only cursor, per the brief. Everything
 * changed since it comes down and is written locally under last-write-wins on
 * `updated_at` — which is safe precisely because finished sets are immutable, so
 * the only rows that can genuinely conflict are routines and settings.
 *
 * With no cursor this is the restore: everything the account has comes down.
 */
import { db } from '@/db/db';
import { SYNCED_TABLES, getClient, type SyncedTable } from './client';

export interface PullResult {
  pulled: number;
  /** Rows written per table — what a restore says it brought back. */
  byTable: Partial<Record<SyncedTable, number>>;
  /** The newest updated_at seen, to become the next cursor. */
  cursor: string | null;
}

/** Rows are fetched in pages so a long absence cannot blow up memory. */
const PAGE_SIZE = 500;

function tableFor(name: SyncedTable) {
  return db.table(name);
}

/**
 * Timestamps back in the app's own form.
 *
 * Postgres writes them in JSON as "2026-08-01T10:00:00+00:00"; everything the
 * app writes is `toISOString()`, "2026-08-01T10:00:00.000Z". Both parse to the
 * same instant, but a string comparison between the two forms orders them
 * wrongly within a second, and the project's rule is one form in the store.
 */
function normalise(row: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...row };
  for (const [key, value] of Object.entries(row)) {
    if (key.endsWith('_at') && typeof value === 'string') {
      const parsed = Date.parse(value);
      if (!Number.isNaN(parsed)) out[key] = new Date(parsed).toISOString();
    }
  }
  return out;
}

export async function pullSince(since: string | null): Promise<PullResult> {
  const client = getClient();
  if (!client) return { pulled: 0, byTable: {}, cursor: since };

  let pulled = 0;
  let newest = since;
  const byTable: Partial<Record<SyncedTable, number>> = {};

  for (const name of SYNCED_TABLES) {
    let from = 0;

    for (;;) {
      const base = client.from(name).select('*');
      const filtered = since ? base.gt('updated_at', since) : base;
      // Ordered by id within a timestamp, so the order is total. Hundreds of
      // rows share one updated_at — the seeded library, everything a plan
      // writes at once — and Postgres may order ties differently from one page
      // query to the next, which would skip some rows and repeat others.
      const { data, error } = await filtered
        .order('updated_at', { ascending: true })
        .order('id', { ascending: true })
        .range(from, from + PAGE_SIZE - 1);
      if (error) throw new Error(`Pulling ${name} failed: ${error.message}`);
      if (!data || data.length === 0) break;

      const rows = (data as Array<Record<string, unknown>>).map(normalise);
      const table = tableFor(name);

      await db.transaction('rw', table, async () => {
        const incomingIds = rows.map((row) => row['id'] as string);
        const existing = await table.bulkGet(incomingIds);
        const existingById = new Map(
          existing
            .filter(Boolean)
            .map((row) => [(row as Record<string, unknown>)['id'] as string, row as Record<string, unknown>]),
        );

        const toWrite = rows.filter((row) => {
          const local = existingById.get(row['id'] as string);
          if (!local) return true;
          // Last write wins. A tie keeps the local row: it is already there, and
          // rewriting it would churn the outbox for no change.
          return Date.parse(row['updated_at'] as string) > Date.parse(local['updated_at'] as string);
        });

        if (toWrite.length > 0) await table.bulkPut(toWrite);
        pulled += toWrite.length;
        byTable[name] = (byTable[name] ?? 0) + toWrite.length;
      });

      for (const row of rows) {
        const updatedAt = row['updated_at'] as string;
        if (!newest || Date.parse(updatedAt) > Date.parse(newest)) newest = updatedAt;
      }

      if (rows.length < PAGE_SIZE) break;
      from += PAGE_SIZE;
    }
  }

  return { pulled, byTable, cursor: newest };
}
