/**
 * Bringing remote changes down.
 *
 * `last_synced_at` in settings is the only cursor, per the brief. Everything
 * changed since it comes down and is written locally under last-write-wins on
 * `updated_at` — which is safe precisely because finished sets are immutable, so
 * the only rows that can genuinely conflict are routines and settings.
 */
import { db } from '@/db/db';
import { SYNCED_TABLES, getClient, type SyncedTable } from './client';

export interface PullResult {
  pulled: number;
  /** The newest updated_at seen, to become the next cursor. */
  cursor: string | null;
}

/** Rows are fetched in pages so a long absence cannot blow up memory. */
const PAGE_SIZE = 500;

function tableFor(name: SyncedTable) {
  return db.table(name);
}

export async function pullSince(since: string | null): Promise<PullResult> {
  const client = getClient();
  if (!client) return { pulled: 0, cursor: since };

  let pulled = 0;
  let newest = since;

  for (const name of SYNCED_TABLES) {
    let from = 0;

    for (;;) {
      const base = client.from(name).select('*');
      const filtered = since ? base.gt('updated_at', since) : base;
      const { data, error } = await filtered
        .order('updated_at', { ascending: true })
        .range(from, from + PAGE_SIZE - 1);
      if (error) throw new Error(`Pulling ${name} failed: ${error.message}`);
      if (!data || data.length === 0) break;

      const rows = data as Array<Record<string, unknown>>;
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
      });

      for (const row of rows) {
        const updatedAt = row['updated_at'] as string;
        if (!newest || Date.parse(updatedAt) > Date.parse(newest)) newest = updatedAt;
      }

      if (rows.length < PAGE_SIZE) break;
      from += PAGE_SIZE;
    }
  }

  return { pulled, cursor: newest };
}
