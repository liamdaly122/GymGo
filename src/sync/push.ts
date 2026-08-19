/**
 * Sending local changes up.
 *
 * The outbox records WHAT changed, not how. Push then reads the current row out
 * of Dexie and upserts the whole thing, rather than replaying the queued patch.
 *
 * That matters: outbox payloads are partial (a set edit queues just the weight),
 * and upserting a partial row would blank every column it did not mention. Send
 * the row as it stands now and the operation is idempotent, order-insensitive
 * within a table, and correct after a crash mid-flush.
 */
import { db } from '@/db/db';
import { SYNCED_TABLES, getClient, type SyncedTable } from './client';

/** Dexie tables keyed by name, so the flush can walk them generically. */
function tableFor(name: SyncedTable) {
  return db.table(name);
}

export interface PushResult {
  pushed: number;
  tables: number;
}

/** How many rows are queued. Drives the "n waiting" indicator. */
export async function pendingCount(): Promise<number> {
  const entries = await db.outbox.toArray();
  return new Set(entries.map((entry) => `${entry.table_name}:${entry.row_id}`)).size;
}

/**
 * Flushes the outbox.
 *
 * Rows go up in table order so a restore never lands a set before the workout it
 * belongs to. Outbox entries are only cleared once their table has been accepted,
 * so a failure halfway leaves the rest queued rather than dropping it.
 */
export async function pushOutbox(userId: string): Promise<PushResult> {
  const client = getClient();
  if (!client) return { pushed: 0, tables: 0 };

  const entries = await db.outbox.orderBy('seq').toArray();
  if (entries.length === 0) return { pushed: 0, tables: 0 };

  let pushed = 0;
  let tables = 0;

  for (const name of SYNCED_TABLES) {
    const forTable = entries.filter((entry) => entry.table_name === name);
    if (forTable.length === 0) continue;

    const rowIds = [...new Set(forTable.map((entry) => entry.row_id))];
    const rows = (await tableFor(name).bulkGet(rowIds)).filter(Boolean) as Array<
      Record<string, unknown>
    >;

    // A row queued and then hard-removed has nothing to send; drop its entries.
    if (rows.length > 0) {
      const payload = rows.map((row) => ({ ...row, user_id: userId }));
      const { error } = await client.from(name).upsert(payload, { onConflict: 'id' });
      if (error) throw new Error(`Pushing ${name} failed: ${error.message}`);
      pushed += payload.length;
      tables += 1;
    }

    await db.outbox.bulkDelete(
      forTable.map((entry) => entry.seq).filter((seq): seq is number => seq !== undefined),
    );
  }

  return { pushed, tables };
}
