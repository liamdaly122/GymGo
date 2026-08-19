/**
 * Sync status, for the small indicator.
 *
 * A store rather than a promise, because the UI subscribes to what happened
 * instead of waiting for it to happen. Per the brief this is an indicator only:
 * it never blocks, never covers the log screen with a spinner, and a failure is
 * retried silently at the next opportunity.
 */
export type SyncState = 'idle' | 'syncing' | 'error' | 'offline' | 'signed_out' | 'unconfigured';

export interface SyncStatus {
  state: SyncState;
  lastSyncedAt: string | null;
  /** Rows still waiting to go up. */
  pending: number;
  /** Last failure, kept for the settings screen. Never shown mid-workout. */
  message: string | null;
}

let status: SyncStatus = {
  state: 'unconfigured',
  lastSyncedAt: null,
  pending: 0,
  message: null,
};

const listeners = new Set<(next: SyncStatus) => void>();

export function getSyncStatus(): SyncStatus {
  return status;
}

export function setSyncStatus(patch: Partial<SyncStatus>): void {
  status = { ...status, ...patch };
  for (const listener of listeners) listener(status);
}

export function subscribeToSyncStatus(listener: (next: SyncStatus) => void): () => void {
  listeners.add(listener);
  listener(status);
  return () => listeners.delete(listener);
}

/** Plain English for the indicator. */
export function describeSyncStatus(current: SyncStatus): string {
  switch (current.state) {
    case 'unconfigured':
      return 'Backup not set up';
    case 'signed_out':
      return 'Not signed in';
    case 'syncing':
      return 'Backing up…';
    case 'offline':
      return current.pending > 0 ? `${current.pending} waiting for signal` : 'Offline';
    case 'error':
      return current.pending > 0 ? `${current.pending} waiting to retry` : 'Retrying later';
    case 'idle':
      if (current.pending > 0) return `${current.pending} waiting`;
      return current.lastSyncedAt ? 'Backed up' : 'Nothing to back up yet';
  }
}
