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
 *
 * The outbox is the everyday path. `uploadEverything` is the other one: rows
 * the outbox never named — the first backup of a phone that has been in use for
 * months, a write that slipped past the queue — go up through it.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { db } from '@/db/db';
import { SYNCED_TABLES, getClient, type SyncedTable } from './client';

/**
 * Rows per request. A year of training is a few thousand sets, and one request
 * holding all of them is the kind that times out on a gym's one bar of signal.
 */
export const UPLOAD_BATCH = 500;

/** Dexie tables keyed by name, so the flush can walk them generically. */
function tableFor(name: SyncedTable) {
  return db.table(name);
}

/** How many rows are queued. Drives the "n waiting" indicator. */
export async function pendingCount(): Promise<number> {
  const entries = await db.outbox.toArray();
  return new Set(entries.map((entry) => `${entry.table_name}:${entry.row_id}`)).size;
}

/** Upserts rows in batches, stamped with the account. Throws on the first refusal. */
async function upload(
  client: SupabaseClient,
  name: SyncedTable,
  rows: Array<Record<string, unknown>>,
  userId: string,
): Promise<void> {
  for (let start = 0; start < rows.length; start += UPLOAD_BATCH) {
    const payload = rows.slice(start, start + UPLOAD_BATCH).map((row) => ({ ...row, user_id: userId }));
    const { error } = await client.from(name).upsert(payload, { onConflict: 'id' });
    if (error) throw new Error(`Backing up ${name} failed: ${error.message}`);
  }
}

export interface PushResult {
  pushed: number;
  tables: number;
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
      await upload(client, name, rows, userId);
      pushed += rows.length;
      tables += 1;
    }

    await db.outbox.bulkDelete(
      forTable.map((entry) => entry.seq).filter((seq): seq is number => seq !== undefined),
    );
  }

  return { pushed, tables };
}

/**
 * Uploads every row on the phone, or every row changed after `since`.
 *
 * Not a replay of the outbox: this reads the tables themselves, so it catches
 * what the outbox never named — months of training logged before backup was
 * switched on, or a write that slipped past the queue. Re-sending a row the
 * server already has is harmless: the upsert is idempotent, and the server
 * keeps whichever copy is newer.
 */
export async function uploadEverything(
  userId: string,
  options: { since?: string | null } = {},
): Promise<number> {
  const client = getClient();
  if (!client) return 0;

  const since = options.since ? Date.parse(options.since) : null;
  let uploaded = 0;

  for (const name of SYNCED_TABLES) {
    let rows = (await tableFor(name).toArray()) as Array<Record<string, unknown>>;
    if (since !== null) rows = rows.filter((row) => Date.parse(row['updated_at'] as string) > since);
    if (rows.length === 0) continue;
    await upload(client, name, rows, userId);
    uploaded += rows.length;
  }

  return uploaded;
}
