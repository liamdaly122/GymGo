/**
 * The sync loop.
 *
 * Runs entirely behind the app. Nothing here is ever awaited by a component:
 * the UI subscribes to a status store and carries on. A failure is logged to the
 * status and retried at the next opportunity — never surfaced as a blocking
 * error, never a spinner over the log screen.
 */
import { db } from '@/db/db';
import { SETTINGS_ID } from '@/db/schema';
import { nowIso } from '@/lib/dates';
import { backfillUserId, currentAccount } from './auth';
import { getClient } from './client';
import { isSyncConfigured } from './config';
import { readLedger, writeLedger } from './ledger';
import { pullSince } from './pull';
import { pendingCount, pushOutbox, uploadEverything } from './push';
import { dropPlaceholderGyms } from './restore';
import { setSyncStatus } from './status';

/** Long enough not to chatter, short enough that a session is backed up before you leave the gym. */
const INTERVAL_MS = 2 * 60 * 1000;

/** How often everything changed since the last pass goes up, queued or not. */
const CATCH_UP_EVERY_MS = 24 * 60 * 60 * 1000;

/** Overlap between catch-up passes, so a write that lands during one is in the next. */
const CATCH_UP_OVERLAP_MS = 60 * 60 * 1000;

let timer: number | null = null;
let running = false;
let backfilled = false;

async function refreshPending(): Promise<number> {
  const pending = await pendingCount();
  setSyncStatus({ pending });
  return pending;
}

/**
 * One round.
 *
 *  1. A phone that has never finished a round takes the cloud's copy first.
 *     On a fresh install that is the restore, and it comes before any upload,
 *     so the placeholders a new install makes for itself never reach the
 *     cloud. On the phone that made the backup it finds nothing.
 *  2. The outbox goes up: everything changed since the last round.
 *  3. The first time an account backs up from this phone, every row on it goes
 *     up — months of training can predate signing in, and none of it was ever
 *     queued. After that, once a day, everything changed since the last pass
 *     goes up whether it was queued or not: the safety net under the outbox.
 *  4. Whatever changed elsewhere comes down.
 *
 * Guarded against overlapping runs — a slow round on a bad connection must not
 * stack up behind the interval and push the same rows twice.
 */
export async function syncNow(): Promise<void> {
  if (running) return;
  if (!isSyncConfigured()) {
    setSyncStatus({ state: 'unconfigured' });
    return;
  }
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    setSyncStatus({ state: 'offline' });
    await refreshPending();
    return;
  }

  const account = await currentAccount();
  if (!account) {
    setSyncStatus({ state: 'signed_out' });
    await refreshPending();
    return;
  }

  running = true;
  setSyncStatus({ state: 'syncing', message: null, phase: null });

  try {
    // Rows created before sign-in carry no user_id, and row level security
    // rejects them. Stamp them once per session.
    if (!backfilled) {
      await backfillUserId(account.userId);
      backfilled = true;
    }

    const settings = await db.settings.get(SETTINGS_ID);
    let cursor = settings?.last_synced_at ?? null;

    if (cursor === null) {
      setSyncStatus({ phase: 'restoring' });
      const madeHere = new Set((await db.gyms.toArray()).map((gym) => gym.id));
      const restore = await pullSince(null);
      await dropPlaceholderGyms(madeHere);
      cursor = restore.cursor;
      const workouts = restore.byTable.workouts ?? 0;
      if (workouts > 0) setSyncStatus({ restoredWorkouts: workouts });
    }

    setSyncStatus({ phase: 'uploading' });
    await pushOutbox(account.userId);

    const ledger = readLedger(account.userId);
    const startedAt = nowIso();
    if (!ledger.fullUploadAt) {
      await uploadEverything(account.userId);
      writeLedger(account.userId, { fullUploadAt: startedAt, catchUpAt: startedAt });
    } else if (!ledger.catchUpAt || Date.now() - Date.parse(ledger.catchUpAt) > CATCH_UP_EVERY_MS) {
      const since = new Date(
        Date.parse(ledger.catchUpAt ?? ledger.fullUploadAt) - CATCH_UP_OVERLAP_MS,
      ).toISOString();
      await uploadEverything(account.userId, { since });
      writeLedger(account.userId, { catchUpAt: startedAt });
    }

    const { cursor: next } = await pullSince(cursor);
    // Bookkeeping, not an edit: updated_at is left alone, or the settings row
    // would look freshly changed every two minutes.
    await db.settings.update(SETTINGS_ID, { last_synced_at: next ?? nowIso() });

    const backedUpAt = nowIso();
    writeLedger(account.userId, { lastBackupAt: backedUpAt });
    setSyncStatus({ state: 'idle', lastSyncedAt: backedUpAt, message: null, phase: null });
  } catch (cause) {
    // Silent by design. It will be retried on the next opportunity.
    setSyncStatus({
      state: 'error',
      phase: null,
      message: cause instanceof Error ? cause.message : String(cause),
    });
  } finally {
    running = false;
    await refreshPending();
  }
}

/**
 * Starts the background loop.
 *
 * Called once at startup and never awaited. Syncs on an interval, when the app
 * comes back to the foreground, and the moment the network returns — which is
 * the one that matters after a session in a basement.
 */
export function startSync(): () => void {
  if (typeof window === 'undefined') return () => {};

  if (!isSyncConfigured()) {
    setSyncStatus({ state: 'unconfigured' });
    return () => {};
  }

  void currentAccount().then((account) => {
    setSyncStatus({
      state: account ? 'idle' : 'signed_out',
      // Said at once rather than after the first round of the session.
      lastSyncedAt: account ? readLedger(account.userId).lastBackupAt : null,
    });
  });
  void refreshPending();

  const kick = () => void syncNow();

  timer = window.setInterval(kick, INTERVAL_MS);
  const onVisible = () => {
    if (document.visibilityState === 'visible') kick();
  };
  document.addEventListener('visibilitychange', onVisible);
  window.addEventListener('online', kick);
  window.addEventListener('offline', () => setSyncStatus({ state: 'offline' }));

  // Signing in starts a round straight away, and signing out stops claiming
  // to be backed up.
  getClient()?.auth.onAuthStateChange((event) => {
    backfilled = false;
    if (event === 'SIGNED_OUT') setSyncStatus({ lastSyncedAt: null, restoredWorkouts: null });
    kick();
  });

  kick();

  return () => {
    if (timer !== null) window.clearInterval(timer);
    document.removeEventListener('visibilitychange', onVisible);
    window.removeEventListener('online', kick);
  };
}

/** For tests: a fresh session, as reopening the app would be. */
export function resetSyncSession(): void {
  running = false;
  backfilled = false;
}
