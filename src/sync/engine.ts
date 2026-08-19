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
import { pullSince } from './pull';
import { pendingCount, pushOutbox } from './push';
import { setSyncStatus } from './status';

/** Long enough not to chatter, short enough that a session is backed up before you leave the gym. */
const INTERVAL_MS = 2 * 60 * 1000;

let timer: number | null = null;
let running = false;
let backfilled = false;

async function refreshPending(): Promise<number> {
  const pending = await pendingCount();
  setSyncStatus({ pending });
  return pending;
}

/**
 * One round: push what is queued, then pull what changed.
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
  setSyncStatus({ state: 'syncing', message: null });

  try {
    // Rows created before sign-in carry no user_id, and row level security
    // rejects them. Stamp them once, on the first successful round.
    if (!backfilled) {
      await backfillUserId(account.userId);
      backfilled = true;
    }

    await pushOutbox(account.userId);

    const settings = await db.settings.get(SETTINGS_ID);
    const { cursor } = await pullSince(settings?.last_synced_at ?? null);

    const syncedAt = cursor ?? nowIso();
    await db.settings.update(SETTINGS_ID, {
      last_synced_at: syncedAt,
      updated_at: nowIso(),
    });

    setSyncStatus({ state: 'idle', lastSyncedAt: syncedAt, message: null });
  } catch (cause) {
    // Silent by design. It will be retried on the next opportunity.
    setSyncStatus({
      state: 'error',
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
    setSyncStatus({ state: account ? 'idle' : 'signed_out' });
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

  // Sessions logged before a client existed still need to go up.
  getClient()?.auth.onAuthStateChange(() => {
    backfilled = false;
    kick();
  });

  kick();

  return () => {
    if (timer !== null) window.clearInterval(timer);
    document.removeEventListener('visibilitychange', onVisible);
    window.removeEventListener('online', kick);
  };
}
